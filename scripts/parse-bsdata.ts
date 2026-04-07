/**
 * parse-bsdata.ts
 *
 * Parses Warhammer 40k 10e BSData .cat XML files into PostgreSQL via Prisma.
 * Accurately handles:
 *   - Detachments (from sharedSelectionEntryGroups > "Detachment" group)
 *   - Detachment rules (inline <rules> on each detachment selectionEntry)
 *   - Enhancements per detachment (from named Enhancement selectionEntryGroups)
 *   - Units with full stat profiles
 *   - Variable points costs (base + modifiers for larger squad sizes)
 *   - Weapon profiles on units, models, and sub-entries
 *   - Sergeant / leader weapon options (selectionEntryGroups on model entries)
 *   - Squad special weapon slots (separate model entries like "w/ Plasma Pistol")
 *     including conditional max increments for larger squad sizes
 *   - Abilities from profile type "Abilities"
 *   - Leader ability and which units a leader can join
 *   - Keywords from categoryLinks
 *
 * Usage:
 *   npx ts-node scripts/parse-bsdata.ts <path-to.cat> [<path2.cat> ...]
 *
 * The .cat files from BSData may be gzip-compressed (.catz). Decompress first:
 *   gunzip -k "Imperium - Space Marines.catz"
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

// ── Prisma client ─────────────────────────────────────────────────────────────

neonConfig.webSocketConstructor = ws;
const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter } as any);

// ── Type helpers ──────────────────────────────────────────────────────────────

type XmlNode = Record<string, any>;

function attr(node: XmlNode | undefined, key: string): string {
  return node?.$?.[key] ?? '';
}

function nodeText(node: any): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (typeof node === 'object' && node._) return String(node._);
  return '';
}

/** Get a named characteristic value from a profile node */
function getChar(profile: XmlNode, name: string): string {
  const chars: any[] = profile?.characteristics?.[0]?.characteristic ?? [];
  const found = chars.find((c: any) => attr(c, 'name').toLowerCase() === name.toLowerCase());
  return found ? nodeText(found).trim() : '';
}

/** Get pts cost from a costs array */
function getPts(costsNode: any[]): number {
  const costs: any[] = costsNode?.[0]?.cost ?? [];
  const pts = costs.find((c: any) => attr(c, 'name').toLowerCase() === 'pts');
  return pts ? Math.round(parseFloat(attr(pts, 'value')) || 0) : 0;
}

/** Extract keywords from categoryLinks */
function getKeywords(node: XmlNode): string[] {
  const links: any[] = node?.categoryLinks?.[0]?.categoryLink ?? [];
  return links
    .map((l: any) => attr(l, 'name'))
    .filter((n) => n && !n.startsWith('Configuration') && n !== 'Grenades');
}

/** Determine primary battlefield role from keywords */
function getPrimaryRole(keywords: string[]): string {
  const roles = [
    'Character', 'Battleline', 'Monster', 'Vehicle', 'Infantry',
    'Mounted', 'Beast', 'Fly', 'Fortification', 'Titanic',
  ];
  return keywords.find((k) => roles.includes(k)) ?? 'Infantry';
}

// ── Weapon profile extraction ─────────────────────────────────────────────────

interface WeaponData {
  bsdataId: string;
  name: string;
  range: string;
  attacks: string;
  skill: string;
  strength: string;
  armorPen: string;
  damage: string;
  keywords: string[];
  weaponType: 'Ranged' | 'Melee';
}

function extractWeaponsFromProfiles(profiles: any[], contextId: string): WeaponData[] {
  const weapons: WeaponData[] = [];
  for (const p of profiles ?? []) {
    const typeName: string = attr(p, 'typeName');
    if (typeName !== 'Ranged Weapons' && typeName !== 'Melee Weapons') continue;

    const weaponType: 'Ranged' | 'Melee' = typeName === 'Ranged Weapons' ? 'Ranged' : 'Melee';
    const id = attr(p, 'id') || `${contextId}-${attr(p, 'name')}`;
    const kwString = getChar(p, 'Keywords');

    weapons.push({
      bsdataId: id,
      name: attr(p, 'name'),
      range: getChar(p, 'Range'),
      attacks: getChar(p, 'A'),
      skill: getChar(p, 'BS') || getChar(p, 'WS'),
      strength: getChar(p, 'S'),
      armorPen: getChar(p, 'AP'),
      damage: getChar(p, 'D'),
      keywords: kwString ? kwString.split(',').map((s) => s.trim()).filter(Boolean) : [],
      weaponType,
    });
  }
  return weapons;
}

/** Recursively collect weapons from a selectionEntry and all its children/links */
function collectWeaponsFromEntry(
  entry: XmlNode,
  sharedMap: Map<string, XmlNode>,
  seen = new Set<string>(),
  depth = 0,
): WeaponData[] {
  if (depth > 10) return [];
  const id = attr(entry, 'id');
  if (id && seen.has(id)) return [];
  if (id) seen.add(id);

  const weapons = extractWeaponsFromProfiles(entry?.profiles?.[0]?.profile ?? [], id);

  // Follow top-level entryLinks on this entry
  for (const link of entry?.entryLinks?.[0]?.entryLink ?? []) {
    const target = sharedMap.get(attr(link, 'targetId'));
    if (target) weapons.push(...collectWeaponsFromEntry(target, sharedMap, seen, depth + 1));
  }

  // Recurse into nested selectionEntries
  for (const child of entry?.selectionEntries?.[0]?.selectionEntry ?? []) {
    weapons.push(...collectWeaponsFromEntry(child, sharedMap, seen, depth + 1));
  }

  // Recurse into selectionEntryGroups (including arbitrarily nested groups)
  for (const grp of entry?.selectionEntryGroups?.[0]?.selectionEntryGroup ?? []) {
    weapons.push(...collectWeaponsFromGroup(grp, sharedMap, seen, depth + 1));
  }

  return weapons;
}

/** Recursively collect weapons from a selectionEntryGroup (handles nested groups) */
function collectWeaponsFromGroup(
  grp: XmlNode,
  sharedMap: Map<string, XmlNode>,
  seen: Set<string>,
  depth: number,
): WeaponData[] {
  if (depth > 10) return [];
  const weapons: WeaponData[] = [];

  for (const child of grp?.selectionEntries?.[0]?.selectionEntry ?? []) {
    weapons.push(...collectWeaponsFromEntry(child, sharedMap, seen, depth + 1));
  }
  for (const link of grp?.entryLinks?.[0]?.entryLink ?? []) {
    const target = sharedMap.get(attr(link, 'targetId'));
    if (target) weapons.push(...collectWeaponsFromEntry(target, sharedMap, seen, depth + 1));
  }
  // Recurse into nested selectionEntryGroups within this group
  for (const nestedGrp of grp?.selectionEntryGroups?.[0]?.selectionEntryGroup ?? []) {
    weapons.push(...collectWeaponsFromGroup(nestedGrp, sharedMap, seen, depth + 1));
  }

  return weapons;
}

// ── Ability extraction ────────────────────────────────────────────────────────

interface AbilityData {
  bsdataId: string;
  name: string;
  description: string;
}

function extractAbilitiesFromProfiles(profiles: any[], contextId: string): AbilityData[] {
  return (profiles ?? [])
    .filter((p: any) => attr(p, 'typeName') === 'Abilities')
    .map((p: any) => ({
      bsdataId: attr(p, 'id') || `${contextId}-${attr(p, 'name')}`,
      name: attr(p, 'name'),
      description: getChar(p, 'Description'),
    }));
}

// ── Unit stat extraction ──────────────────────────────────────────────────────

interface UnitStats {
  movement: string;
  toughness: number | null;
  save: string;
  wounds: number | null;
  leadership: string;
  objectiveControl: number | null;
  invulnSave: string | null;
}

function extractUnitStats(profiles: any[]): UnitStats {
  const unitProfile = (profiles ?? []).find(
    (p: any) => attr(p, 'typeName') === 'Unit'
  );
  if (!unitProfile) {
    return { movement: '', toughness: null, save: '', wounds: null, leadership: '', objectiveControl: null, invulnSave: null };
  }

  const invulnProfile = (profiles ?? []).find(
    (p: any) => attr(p, 'name').toLowerCase().includes('invulnerable')
  );
  const invulnSave = invulnProfile ? getChar(invulnProfile, 'Description') : null;

  return {
    movement:         getChar(unitProfile, 'M'),
    toughness:        parseInt(getChar(unitProfile, 'T'))   || null,
    save:             getChar(unitProfile, 'SV') || getChar(unitProfile, 'Sv'),
    wounds:           parseInt(getChar(unitProfile, 'W'))   || null,
    leadership:       getChar(unitProfile, 'LD') || getChar(unitProfile, 'Ld'),
    objectiveControl: parseInt(getChar(unitProfile, 'OC'))  || null,
    invulnSave:       invulnSave?.match(/\d\+/)?.[0] ?? null,
  };
}

// ── Variable cost extraction ──────────────────────────────────────────────────

interface PointsCost {
  basePoints: number;
  /** e.g. { minModels: 6, points: 170 } means "if >= 6 models selected, costs 170pts" */
  scaledCosts: Array<{ minModels: number; points: number }>;
}

function extractVariableCosts(entry: XmlNode): PointsCost {
  const basePoints = getPts(entry?.costs);

  const scaledCosts: Array<{ minModels: number; points: number }> = [];

  // Modifiers of type "set" on pts field indicate a cost change at a threshold
  const modifiers: any[] = entry?.modifiers?.[0]?.modifier ?? [];
  for (const mod of modifiers) {
    if (attr(mod, 'type') !== 'set') continue;

    // The field attribute on 10e pts modifiers is the costType ID "51b2-306e-1021-d207"
    const field = attr(mod, 'field');
    const newValue = parseFloat(attr(mod, 'value'));
    if (!field || isNaN(newValue) || newValue === 0) continue;

    // Find the condition that triggers it — atLeast X selections
    const conditions: any[] = mod?.conditions?.[0]?.condition ?? [];
    for (const cond of conditions) {
      if (attr(cond, 'type') === 'atLeast') {
        const minModels = parseInt(attr(cond, 'value'));
        if (!isNaN(minModels) && minModels > 1) {
          scaledCosts.push({ minModels, points: Math.round(newValue) });
        }
      }
    }
  }

  return { basePoints, scaledCosts };
}

// ── Weapon option extraction (per squad) ──────────────────────────────────────

interface WeaponOption {
  bsdataId: string;
  slotName: string;            // e.g. "Weapon 1", "Weapon 2", "Special Weapon"
  modelType: string;           // "sergeant", "trooper", "special_model"
  modelName: string;           // e.g. "Assault Intercessor Sergeant with Jump Pack"
  choices: string[];           // weapon names available in this slot
  minSelections: number;
  maxSelections: number;       // base max
  /** If squad size >= this threshold, max increases to conditionalMax */
  conditionalThreshold: number | null;
  conditionalMax: number | null;
  defaultChoice: string | null;
}

/**
 * Extract weapon options from a unit's selectionEntryGroups.
 * Handles:
 *   - Sergeant / leader model weapon slots (selectionEntryGroups on sergeant model)
 *   - Trooper weapon options
 *   - Special weapon models (e.g. "w/ Plasma Pistol") with conditional max
 */
function extractWeaponOptions(unitEntry: XmlNode): WeaponOption[] {
  const options: WeaponOption[] = [];

  const unitGroups: any[] = unitEntry?.selectionEntryGroups?.[0]?.selectionEntryGroup ?? [];

  for (const group of unitGroups) {
    const groupModels: any[] = group?.selectionEntries?.[0]?.selectionEntry ?? [];

    for (const model of groupModels) {
      const modelName = attr(model, 'name');
      const modelId   = attr(model, 'id');
      const hidden    = attr(model, 'hidden') === 'true';
      if (hidden) continue;

      // Determine model type
      const isSergeant = /sergeant|leader|champion|ancient/i.test(modelName);
      const isSpecialModel = /w\//i.test(modelName); // e.g. "w/ Plasma Pistol"
      const modelType = isSergeant ? 'sergeant' : isSpecialModel ? 'special_model' : 'trooper';

      // --- Special weapon models (e.g. "Assault Intercessors w/ Plasma Pistol") ---
      // These represent a separate model slot with a fixed weapon, conditional max
      if (isSpecialModel) {
        const constraints: any[] = model?.constraints?.[0]?.constraint ?? [];
        const maxConstraint = constraints.find((c: any) => attr(c, 'type') === 'max');
        const baseMax = maxConstraint ? parseInt(attr(maxConstraint, 'value')) : 1;

        // Look for a modifier that increments max based on squad size
        const modifiers: any[] = model?.modifiers?.[0]?.modifier ?? [];
        let conditionalThreshold: number | null = null;
        let conditionalMax: number | null = null;

        for (const mod of modifiers) {
          if (attr(mod, 'type') !== 'increment') continue;
          const incrementValue = parseInt(attr(mod, 'value'));
          const conditions: any[] = mod?.conditions?.[0]?.condition ?? [];
          for (const cond of conditions) {
            if (attr(cond, 'type') === 'atLeast') {
              conditionalThreshold = parseInt(attr(cond, 'value'));
              conditionalMax = baseMax + incrementValue;
            }
          }
        }

        // Weapon names come from the entryLinks on this special model
        const weaponLinks: any[] = model?.entryLinks?.[0]?.entryLink ?? [];
        const choices = weaponLinks
          .filter((l: any) => attr(l, 'name') !== 'Weapon Modifications')
          .map((l: any) => attr(l, 'name'));

        options.push({
          bsdataId: `${modelId}-special`,
          slotName: `Special: ${modelName}`,
          modelType,
          modelName,
          choices,
          minSelections: 0,
          maxSelections: baseMax,
          conditionalThreshold,
          conditionalMax,
          defaultChoice: null,
        });
        continue;
      }

      // --- Sergeant / trooper weapon slots (selectionEntryGroups on this model) ---
      const weaponGroups: any[] = model?.selectionEntryGroups?.[0]?.selectionEntryGroup ?? [];
      for (const wg of weaponGroups) {
        const slotName    = attr(wg, 'name'); // e.g. "Weapon 1", "Weapon 2"
        const defaultId   = attr(wg, '$defaultSelectionEntryId') || attr(wg, 'defaultSelectionEntryId');
        const wgId        = attr(wg, 'id');

        const constraints: any[] = wg?.constraints?.[0]?.constraint ?? [];
        const minC = constraints.find((c: any) => attr(c, 'type') === 'min');
        const maxC = constraints.find((c: any) => attr(c, 'type') === 'max');
        const minSelections = minC ? parseInt(attr(minC, 'value')) : 1;
        const maxSelections = maxC ? parseInt(attr(maxC, 'value')) : 1;

        // Choices come from entryLinks in the weapon group
        const wgLinks: any[] = wg?.entryLinks?.[0]?.entryLink ?? [];
        const choices = wgLinks
          .filter((l: any) => attr(l, 'name') !== 'Weapon Modifications')
          .map((l: any) => attr(l, 'name'));

        // Also check inline selectionEntries for weapon choices
        const wgInlineEntries: any[] = wg?.selectionEntries?.[0]?.selectionEntry ?? [];
        for (const we of wgInlineEntries) {
          const weName = attr(we, 'name');
          if (weName && !choices.includes(weName)) choices.push(weName);
        }

        if (choices.length === 0) continue;

        // Find the default choice name from defaultSelectionEntryId
        let defaultChoice: string | null = null;
        if (defaultId) {
          const defaultLink = wgLinks.find((l: any) => attr(l, 'id') === defaultId);
          defaultChoice = defaultLink ? attr(defaultLink, 'name') : null;
        }

        options.push({
          bsdataId: `${wgId}-${modelId}`,
          slotName,
          modelType,
          modelName,
          choices,
          minSelections,
          maxSelections,
          conditionalThreshold: null,
          conditionalMax: null,
          defaultChoice,
        });
      }

      // Also handle entryLinks directly on the model (fixed/required weapons)
      // These are min=1 max=1 weapons that don't offer a choice — still useful to record
      const modelLinks: any[] = model?.entryLinks?.[0]?.entryLink ?? [];
      const fixedWeapons = modelLinks.filter((l: any) => {
        const name = attr(l, 'name');
        if (name === 'Weapon Modifications' || name === 'Terminator Honours upgrade') return false;
        const lConstraints: any[] = l?.constraints?.[0]?.constraint ?? [];
        const minC2 = lConstraints.find((c: any) => attr(c, 'type') === 'min');
        const maxC2 = lConstraints.find((c: any) => attr(c, 'type') === 'max');
        // Only include if min === max === 1 (fixed weapon, not a choice group)
        const min2 = minC2 ? parseInt(attr(minC2, 'value')) : 0;
        const max2 = maxC2 ? parseInt(attr(maxC2, 'value')) : 1;
        return min2 === 1 && max2 === 1;
      });

      if (fixedWeapons.length > 0 && weaponGroups.length === 0) {
        options.push({
          bsdataId: `${modelId}-fixed`,
          slotName: 'Fixed Loadout',
          modelType,
          modelName,
          choices: fixedWeapons.map((l: any) => attr(l, 'name')),
          minSelections: fixedWeapons.length,
          maxSelections: fixedWeapons.length,
          conditionalThreshold: null,
          conditionalMax: null,
          defaultChoice: null,
        });
      }
    }
  }

  return options;
}

// ── Leader ability extraction ─────────────────────────────────────────────────

function extractLeaderInfo(profiles: any[]): { isLeader: boolean; leaderOf: string[] } {
  const leaderProfile = (profiles ?? []).find(
    (p: any) => attr(p, 'name') === 'Leader' && attr(p, 'typeName') === 'Abilities'
  );
  if (!leaderProfile) return { isLeader: false, leaderOf: [] };

  const desc = getChar(leaderProfile, 'Description');
  // Parse "■ Unit Name" lines from the leader description
  const leaderOf = desc
    .split('\n')
    .filter((line) => line.trim().startsWith('■'))
    .map((line) => line.replace(/^■\s*/, '').trim())
    .filter(Boolean);

  return { isLeader: true, leaderOf };
}

// ── Unit constraints ──────────────────────────────────────────────────────────

interface SquadConstraints {
  minModels: number;
  maxModels: number;
}

function extractSquadConstraints(unitEntry: XmlNode): SquadConstraints {
  const groups: any[] = unitEntry?.selectionEntryGroups?.[0]?.selectionEntryGroup ?? [];

  for (const group of groups) {
    const name = attr(group, 'name');
    if (/crusade|wargear/i.test(name)) continue;

    // Pattern A: constraints on the group itself
    const constraints: any[] = group?.constraints?.[0]?.constraint ?? [];
    const minC = constraints.find((c: any) => attr(c, 'type') === 'min');
    const maxC = constraints.find((c: any) => attr(c, 'type') === 'max');
    if (minC || maxC) {
      return {
        minModels: minC ? parseInt(attr(minC, 'value')) : 1,
        maxModels: maxC ? parseInt(attr(maxC, 'value')) : 1,
      };
    }

    // Pattern B: no group constraints — sum child entry constraints (e.g. Aggressor Squad)
    // Each entry has min/max for how many of that model type can be selected.
    // Skip "w/" special weapon models — they are optional extras, not base squad members.
    const entries: any[] = group?.selectionEntries?.[0]?.selectionEntry ?? [];
    if (entries.length > 0) {
      let totalMin = 0, totalMax = 0;
      for (const entry of entries) {
        if (/w\//i.test(attr(entry, 'name'))) continue;
        const ecs: any[] = entry?.constraints?.[0]?.constraint ?? [];
        const eMin = ecs.find((c: any) => attr(c, 'type') === 'min');
        const eMax = ecs.find((c: any) => attr(c, 'type') === 'max');
        totalMin += eMin ? parseInt(attr(eMin, 'value')) : 0;
        totalMax += eMax ? parseInt(attr(eMax, 'value')) : 0;
      }
      if (totalMax > 0) {
        return { minModels: totalMin, maxModels: totalMax };
      }
    }
  }

  return { minModels: 1, maxModels: 1 };
}

// ── Detachment & Enhancement parsing ─────────────────────────────────────────

interface EnhancementData {
  bsdataId: string;
  name: string;
  points: number;
  description: string;
  restriction: string | null; // e.g. "Captain model only"
}

interface DetachmentData {
  bsdataId: string;
  name: string;
  ruleName: string;
  ruleDescription: string;
  enhancements: EnhancementData[];
}

function parseEnhancementGroup(group: XmlNode): EnhancementData[] {
  const entries: any[] = group?.selectionEntries?.[0]?.selectionEntry ?? [];
  return entries
    .filter((e: any) => attr(e, 'hidden') !== 'true')
    .map((e: any) => {
      const profiles: any[] = e?.profiles?.[0]?.profile ?? [];
      const abilityProfile = profiles.find((p: any) => attr(p, 'typeName') === 'Abilities');
      const description = abilityProfile ? getChar(abilityProfile, 'Description') : '';

      // Extract restriction hint (e.g. "Captain model only", "Adeptus Astartes model only")
      const restrictionMatch = description.match(/^([^.]+model only)[.]/i);
      const restriction = restrictionMatch ? restrictionMatch[1] : null;

      return {
        bsdataId:    attr(e, 'id'),
        name:        attr(e, 'name'),
        points:      getPts(e?.costs),
        description,
        restriction,
      };
    });
}

function parseDetachments(catalogue: XmlNode): DetachmentData[] {
  const sharedGroups: any[] =
    catalogue?.sharedSelectionEntryGroups?.[0]?.selectionEntryGroup ?? [];
  const sharedEntries: any[] =
    catalogue?.sharedSelectionEntries?.[0]?.selectionEntry ?? [];
  const sharedRules: any[] =
    catalogue?.sharedRules?.[0]?.rule ?? [];

  // Build a sharedRules map for infoLink resolution
  const rulesMap = new Map<string, any>(
    sharedRules.map((r: any) => [attr(r, 'id'), r])
  );

  // ── Build per-detachment enhancement map ──────────────────────────────────────
  // Pattern A (SM): top-level "Enhancements" group contains nested groups
  //   named "[Detachment Name] Enhancements" or just "[Detachment Name]"
  // Pattern B (Necrons): top-level "Enhancements" group contains direct entries (no sub-grouping)
  const enhancementMap = new Map<string, EnhancementData[]>();
  const ungroupedEnhancements: EnhancementData[] = [];

  const topEnhGrp = sharedGroups.find((g: any) => attr(g, 'name') === 'Enhancements');
  if (topEnhGrp) {
    const nestedGrps: any[] = topEnhGrp?.selectionEntryGroups?.[0]?.selectionEntryGroup ?? [];
    if (nestedGrps.length > 0) {
      // Pattern A: per-detachment nested groups
      for (const grp of nestedGrps) {
        const grpName: string = attr(grp, 'name');
        const detachmentName = grpName.replace(/\s*Enhancements$/i, '').trim();
        enhancementMap.set(detachmentName, parseEnhancementGroup(grp));
      }
    } else {
      // Pattern B: all enhancements in one flat list (will be attached to first/any detachment)
      ungroupedEnhancements.push(...parseEnhancementGroup(topEnhGrp));
    }
  }

  // ── Find detachment entries ───────────────────────────────────────────────────
  // Pattern A (SM): sharedSelectionEntryGroups > "Detachment" > selectionEntries
  //   Rules: inline <rules> on each selectionEntry
  // Pattern B (Necrons): sharedSelectionEntries > "Detachment" (upgrade) >
  //   selectionEntryGroups > "Detachment" > selectionEntries
  //   Rules: infoLinks → sharedRules

  let detachmentEntries: any[] = [];
  let useInfoLinks = false;

  const detachmentGroup = sharedGroups.find((g: any) => attr(g, 'name') === 'Detachment');
  if (detachmentGroup) {
    detachmentEntries = detachmentGroup?.selectionEntries?.[0]?.selectionEntry ?? [];
  } else {
    const detachmentSharedEntry = sharedEntries.find((e: any) => attr(e, 'name') === 'Detachment');
    if (detachmentSharedEntry) {
      const innerGrp = (detachmentSharedEntry?.selectionEntryGroups?.[0]?.selectionEntryGroup ?? [])
        .find((g: any) => attr(g, 'name') === 'Detachment');
      detachmentEntries = innerGrp?.selectionEntries?.[0]?.selectionEntry ?? [];
      useInfoLinks = true;
    }
  }

  if (detachmentEntries.length === 0) {
    console.warn('  ⚠️  No detachment entries found');
    return [];
  }

  // ── Parse each detachment ─────────────────────────────────────────────────────
  const detachments: DetachmentData[] = [];
  let ungroupedAssigned = false;

  for (const entry of detachmentEntries) {
    if (attr(entry, 'hidden') === 'true') continue;

    const name = attr(entry, 'name');
    const id   = attr(entry, 'id');

    let ruleName = '';
    let ruleDescription = '';

    if (useInfoLinks) {
      // Necron pattern: rule via infoLink → sharedRules
      const infoLinks: any[] = entry?.infoLinks?.[0]?.infoLink ?? [];
      const ruleLink = infoLinks.find((l: any) => attr(l, 'type') === 'rule');
      if (ruleLink) {
        const rule = rulesMap.get(attr(ruleLink, 'targetId'));
        if (rule) {
          ruleName        = attr(rule, 'name');
          ruleDescription = nodeText(rule?.description?.[0]);
        }
      }
    } else {
      // SM pattern: inline rules
      const rules: any[] = entry?.rules?.[0]?.rule ?? [];
      const primaryRule  = rules[0];
      ruleName        = primaryRule ? attr(primaryRule, 'name') : '';
      ruleDescription = primaryRule ? nodeText(primaryRule?.description?.[0]) : '';
    }

    // Assign enhancements — per-detachment map takes priority; ungrouped go on the first detachment
    let enhancements = enhancementMap.get(name) ?? [];
    if (enhancements.length === 0 && ungroupedEnhancements.length > 0 && !ungroupedAssigned) {
      enhancements = ungroupedEnhancements;
      ungroupedAssigned = true;
    }

    detachments.push({ bsdataId: id, name, ruleName, ruleDescription, enhancements });
  }

  return detachments;
}

// ── Unit parsing ──────────────────────────────────────────────────────────────

interface UnitData {
  bsdataId:         string;
  name:             string;
  points:           number;
  scaledCosts:      Array<{ minModels: number; points: number }>;
  role:             string;
  keywords:         string[];
  factionKeywords:  string[];
  movement:         string;
  toughness:        number | null;
  save:             string;
  wounds:           number | null;
  leadership:       string;
  objectiveControl: number | null;
  invulnSave:       string | null;
  isLeader:         boolean;
  leaderOf:         string[];
  minModels:        number;
  maxModels:        number;
  abilities:        AbilityData[];
  weapons:          WeaponData[];
  weaponOptions:    WeaponOption[];
}

function parseUnit(entry: XmlNode, sharedMap: Map<string, XmlNode>): UnitData | null {
  const type   = attr(entry, 'type');
  const hidden = attr(entry, 'hidden');
  const name   = attr(entry, 'name');

  if ((type !== 'unit' && type !== 'model') || hidden === 'true') return null;
  // Skip Crusade-only, Legends, or non-real units
  if (name.includes('[Legends]')) return null;

  const bsdataId = attr(entry, 'id');
  const keywords = getKeywords(entry);

  // Collect all profiles from this unit and its model sub-entries
  const allProfiles: any[] = [...(entry?.profiles?.[0]?.profile ?? [])];
  const unitGroups: any[] = entry?.selectionEntryGroups?.[0]?.selectionEntryGroup ?? [];
  for (const grp of unitGroups) {
    for (const model of grp?.selectionEntries?.[0]?.selectionEntry ?? []) {
      allProfiles.push(...(model?.profiles?.[0]?.profile ?? []));
    }
  }

  const stats             = extractUnitStats(allProfiles);
  const abilities         = extractAbilitiesFromProfiles(allProfiles, bsdataId);
  const { isLeader, leaderOf } = extractLeaderInfo(allProfiles);
  const { basePoints, scaledCosts } = extractVariableCosts(entry);
  const { minModels, maxModels }    = extractSquadConstraints(entry);

  // Collect all weapons recursively (resolving entryLinks via sharedMap)
  const weapons = collectWeaponsFromEntry(entry, sharedMap);
  // Deduplicate weapons by bsdataId
  const seenWeaponIds = new Set<string>();
  const uniqueWeapons = weapons.filter((w) => {
    if (seenWeaponIds.has(w.bsdataId)) return false;
    seenWeaponIds.add(w.bsdataId);
    return true;
  });

  const weaponOptions = extractWeaponOptions(entry);

  // Separate faction keywords
  const factionKeywords = keywords.filter(
    (k) => k.startsWith('Faction:') || k === 'Imperium' || k === 'Adeptus Astartes'
  );
  const unitKeywords = keywords.filter((k) => !factionKeywords.includes(k));

  return {
    bsdataId,
    name,
    points:           basePoints,
    scaledCosts,
    role:             getPrimaryRole(unitKeywords),
    keywords:         unitKeywords,
    factionKeywords,
    ...stats,
    isLeader,
    leaderOf,
    minModels,
    maxModels,
    abilities,
    weapons:          uniqueWeapons,
    weaponOptions,
  };
}

// ── Database seeding ──────────────────────────────────────────────────────────

async function seedDetachments(detachments: DetachmentData[], factionId: string) {
  console.log(`\n  📋 Seeding ${detachments.length} detachments...`);

  for (const d of detachments) {
    const detachment = await prisma.detachment.upsert({
      where:  { bsdataId: d.bsdataId },
      update: {
        name:            d.name,
        ruleName:        d.ruleName,
        ruleDescription: d.ruleDescription,
        factionId,
      },
      create: {
        bsdataId:        d.bsdataId,
        name:            d.name,
        ruleName:        d.ruleName,
        ruleDescription: d.ruleDescription,
        factionId,
      },
    });

    console.log(`     ✓ ${d.name} (${d.enhancements.length} enhancements)`);

    for (const enh of d.enhancements) {
      await prisma.enhancement.upsert({
        where:  { bsdataId: enh.bsdataId },
        update: {
          name:          enh.name,
          points:        enh.points,
          description:   enh.description,
          restriction:   enh.restriction,
          detachmentId:  detachment.id,
        },
        create: {
          bsdataId:      enh.bsdataId,
          name:          enh.name,
          points:        enh.points,
          description:   enh.description,
          restriction:   enh.restriction,
          detachmentId:  detachment.id,
        },
      });
    }
  }
}

async function seedUnits(units: UnitData[], factionId: string) {
  console.log(`\n  ⚔️  Seeding ${units.length} units...`);

  for (const u of units) {
    const unit = await prisma.unit.upsert({
      where:  { bsdataId: u.bsdataId },
      update: {
        name:             u.name,
        points:           u.points,
        scaledCosts:      JSON.stringify(u.scaledCosts),
        role:             u.role,
        keywords:         u.keywords,
        factionKeywords:  u.factionKeywords,
        movement:         u.movement,
        toughness:        u.toughness,
        save:             u.save,
        wounds:           u.wounds,
        leadership:       u.leadership,
        objectiveControl: u.objectiveControl,
        invulnSave:       u.invulnSave,
        isLeader:         u.isLeader,
        leaderOf:         u.leaderOf,
        minModels:        u.minModels,
        maxModels:        u.maxModels,
        factionId,
      },
      create: {
        bsdataId:         u.bsdataId,
        name:             u.name,
        points:           u.points,
        scaledCosts:      JSON.stringify(u.scaledCosts),
        role:             u.role,
        keywords:         u.keywords,
        factionKeywords:  u.factionKeywords,
        movement:         u.movement,
        toughness:        u.toughness,
        save:             u.save,
        wounds:           u.wounds,
        leadership:       u.leadership,
        objectiveControl: u.objectiveControl,
        invulnSave:       u.invulnSave,
        isLeader:         u.isLeader,
        leaderOf:         u.leaderOf,
        minModels:        u.minModels,
        maxModels:        u.maxModels,
        factionId,
      },
    });

    // Seed weapon profiles (delete and recreate — bsdataIds are shared across units)
    await prisma.weaponProfile.deleteMany({ where: { unitId: unit.id } });
    for (const wp of u.weapons) {
      await prisma.weaponProfile.create({ data: { ...wp, unitId: unit.id } });
    }

    // Seed abilities (delete and recreate — bsdataIds may be shared across units)
    await prisma.ability.deleteMany({ where: { unitId: unit.id } });
    for (const ab of u.abilities) {
      await prisma.ability.create({ data: { ...ab, unitId: unit.id } });
    }

    // Seed weapon options (delete and recreate — simpler than diffing)
    await prisma.weaponOption.deleteMany({ where: { unitId: unit.id } });
    for (const wo of u.weaponOptions) {
      await prisma.weaponOption.create({
        data: {
          bsdataId:             wo.bsdataId,
          slotName:             wo.slotName,
          modelType:            wo.modelType,
          modelName:            wo.modelName,
          choices:              wo.choices,
          minSelections:        wo.minSelections,
          maxSelections:        wo.maxSelections,
          conditionalThreshold: wo.conditionalThreshold,
          conditionalMax:       wo.conditionalMax,
          defaultChoice:        wo.defaultChoice,
          unitId:               unit.id,
        },
      });
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function parseCatFile(catFilePath: string) {
  console.log(`\n📂 Parsing: ${catFilePath}`);
  const xmlRaw = fs.readFileSync(catFilePath, 'utf-8');

  const parser = new xml2js.Parser({ explicitArray: true, mergeAttrs: false });
  const result = await parser.parseStringPromise(xmlRaw);

  const catalogue: XmlNode = result.catalogue;
  if (!catalogue) throw new Error('No <catalogue> root element — is this a valid .cat file?');

  const factionName = attr(catalogue, 'name');
  const factionId   = attr(catalogue, 'id');
  console.log(`✅ Faction: ${factionName} (id: ${factionId})`);

  // Upsert faction
  const faction = await prisma.faction.upsert({
    where:  { bsdataId: factionId },
    update: { name: factionName },
    create: { bsdataId: factionId, name: factionName },
  });

  // ── Parse detachments ──
  const detachments = parseDetachments(catalogue);
  await seedDetachments(detachments, faction.id);

  // Build a lookup map of all shared entries by id for entryLink resolution
  const sharedEntries: any[] =
    catalogue?.sharedSelectionEntries?.[0]?.selectionEntry ?? [];
  const sharedEntryGroups: any[] =
    catalogue?.sharedSelectionEntryGroups?.[0]?.selectionEntryGroup ?? [];
  const sharedMap = new Map<string, XmlNode>([
    ...sharedEntries.map((e: any): [string, XmlNode] => [attr(e, 'id'), e]),
    ...sharedEntryGroups.map((e: any): [string, XmlNode] => [attr(e, 'id'), e]),
  ]);

  // ── Parse units from sharedSelectionEntries ──
  const units: UnitData[] = [];
  for (const entry of sharedEntries) {
    const unit = parseUnit(entry, sharedMap);
    if (unit) units.push(unit);
  }

  // Also check top-level selectionEntries (some factions put units here)
  const topEntries: any[] =
    catalogue?.selectionEntries?.[0]?.selectionEntry ?? [];
  for (const entry of topEntries) {
    const unit = parseUnit(entry, sharedMap);
    if (unit && !units.find((u) => u.bsdataId === unit.bsdataId)) {
      units.push(unit);
    }
  }

  console.log(`\n  Found ${units.length} units`);
  await seedUnits(units, faction.id);

  console.log(`\n✅ Done seeding: ${factionName}`);
  console.log(`   ${detachments.length} detachments`);
  console.log(`   ${detachments.reduce((sum, d) => sum + d.enhancements.length, 0)} enhancements`);
  console.log(`   ${units.length} units`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      'Usage: npx ts-node scripts/parse-bsdata.ts <path-to.cat> [<path2.cat> ...]'
    );
    process.exit(1);
  }

  for (const filePath of args) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      console.error(`❌ File not found: ${resolved}`);
      continue;
    }
    await parseCatFile(resolved);
  }

  await prisma.$disconnect();
  console.log('\n🎉 All done!');
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
