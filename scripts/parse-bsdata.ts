import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ── helpers ──────────────────────────────────────────────────────────────────

function attr(obj: any, key: string): string {
  return obj?.$?.[key] ?? '';
}

function getText(obj: any): string {
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj)) return obj.map(getText).join('');
  if (obj?._) return obj._;
  return '';
}

function getCharacteristic(profile: any, name: string): string {
  const chars = profile?.characteristics?.[0]?.characteristic ?? [];
  const lower = name.toLowerCase();
  const found = chars.find((c: any) => attr(c, 'name').toLowerCase() === lower);
  return found ? getText(found) : '';
}

// Returns the base points cost and all size-tier costs derived from type=set modifiers.
// Each modifier encodes the total cost when the squad reaches a certain size (from its condition).
function getPointsData(entry: any): { basePoints: number; priceTiers: { size: number; points: number }[] } {
  const costs = entry?.costs?.[0]?.cost ?? [];
  const ptsCost = costs.find((c: any) =>
    attr(c, 'name').toLowerCase().includes('pts') ||
    attr(c, 'name').toLowerCase().includes('points')
  );
  const basePoints = ptsCost ? Math.round(parseFloat(attr(ptsCost, 'value')) || 0) : 0;

  const ptsTypeId = ptsCost ? attr(ptsCost, 'typeId') : null;
  const priceTiers: { size: number; points: number }[] = [];

  if (ptsTypeId) {
    for (const mod of entry?.modifiers?.[0]?.modifier ?? []) {
      if (attr(mod, 'type') !== 'set' || attr(mod, 'field') !== ptsTypeId) continue;
      const pts = Math.round(parseFloat(attr(mod, 'value')) || 0);
      if (pts <= 0 || pts === basePoints) continue;
      // The condition tells us the minimum selection count that triggers this price
      const conds = mod?.conditions?.[0]?.condition ?? [];
      const sizeCond = conds.find((c: any) => attr(c, 'field') === 'selections');
      const size = sizeCond ? parseInt(attr(sizeCond, 'value')) : null;
      if (size !== null && !isNaN(size)) {
        priceTiers.push({ size, points: pts });
      }
    }
    priceTiers.sort((a, b) => a.size - b.size);
  }

  return { basePoints, priceTiers };
}

function getKeywords(entry: any): string[] {
  const links = entry?.categoryLinks?.[0]?.categoryLink ?? [];
  return links.map((l: any) => attr(l, 'name')).filter(Boolean);
}

function getPrimaryRole(keywords: string[]): string {
  const roles = ['Battleline', 'Character', 'Monster', 'Vehicle', 'Infantry',
                 'Mounted', 'Beast', 'Fly', 'Fortification', 'Titanic'];
  return roles.find(r => keywords.includes(r)) ?? 'Infantry';
}

// ── size + wargear parsers ────────────────────────────────────────────────────

type WargearGroup = {
  modelRole: string;
  groupName: string;
  min: number;
  max: number;
  options: string[];
};

// Extract min/max model count from a selectionEntryGroup's constraints
function getGroupSize(group: any): { min: number; max: number } | null {
  let minv: number | null = null, maxv: number | null = null;
  for (const c of group?.constraints?.[0]?.constraint ?? []) {
    const field = attr(c, 'field');
    const scope = attr(c, 'scope');
    if (field !== 'selections' || scope !== 'parent') continue;
    const val = parseInt(attr(c, 'value'));
    if (attr(c, 'type') === 'min') minv = val;
    if (attr(c, 'type') === 'max') maxv = val;
  }
  if (minv === null && maxv === null) return null;
  return { min: minv ?? 0, max: maxv ?? 0 };
}

// Get wargear option names from a group (entryLinks + inline selectionEntries)
function getGroupOptions(group: any, sharedMap: Map<string, any>): string[] {
  const opts: string[] = [];
  // entryLinks pointing to shared upgrade entries
  for (const link of group?.entryLinks?.[0]?.entryLink ?? []) {
    const target = sharedMap.get(attr(link, 'targetId'));
    if (!target) continue;
    const profs = target?.profiles?.[0]?.profile ?? [];
    const hasWeapon = profs.some((p: any) =>
      attr(p, 'typeName') === 'Ranged Weapons' || attr(p, 'typeName') === 'Melee Weapons'
    );
    if (hasWeapon) opts.push(attr(link, 'name'));
  }
  // Inline selectionEntries (combo options like "Bolt Rifle and Chainsword")
  for (const se of group?.selectionEntries?.[0]?.selectionEntry ?? []) {
    const name = attr(se, 'name');
    if (name) opts.push(name);
  }
  return opts;
}

// Extract wargear groups from a model entry (direct groups with weapon options)
function extractWargearGroups(entry: any, modelRole: string, sharedMap: Map<string, any>): WargearGroup[] {
  const groups: WargearGroup[] = [];
  for (const group of entry?.selectionEntryGroups?.[0]?.selectionEntryGroup ?? []) {
    const size = getGroupSize(group);
    if (!size || size.max === 0) continue;
    const options = getGroupOptions(group, sharedMap);
    if (options.length === 0) continue;
    groups.push({
      modelRole,
      groupName: attr(group, 'name'),
      min: size.min,
      max: size.max,
      options,
    });
  }
  return groups;
}

// ── profile parsers ───────────────────────────────────────────────────────────

function parseUnitProfile(profiles: any[]): Partial<{
  movement: string; toughness: number; save: number; wounds: number;
  leadership: number; objectiveControl: number;
}> {
  const unitProfile = profiles?.find(
    (p: any) => attr(p, 'typeName') === 'Unit'
  );
  if (!unitProfile) return {};
  const num = (s: string) => parseInt(s) || undefined;
  return {
    movement:         getCharacteristic(unitProfile, 'M') || undefined,
    toughness:        num(getCharacteristic(unitProfile, 'T')),
    save:             num(getCharacteristic(unitProfile, 'Sv')),
    wounds:           num(getCharacteristic(unitProfile, 'W')),
    leadership:       num(getCharacteristic(unitProfile, 'Ld')),
    objectiveControl: num(getCharacteristic(unitProfile, 'OC')),
  };
}

// Walk inline child models inside selectionEntryGroups to find a Unit profile,
// used as a fallback when the top-level entry has no stat block of its own.
function findChildUnitProfile(entry: any): any[] {
  for (const group of entry?.selectionEntryGroups?.[0]?.selectionEntryGroup ?? []) {
    for (const child of group?.selectionEntries?.[0]?.selectionEntry ?? []) {
      const profiles = child?.profiles?.[0]?.profile ?? [];
      const found = profiles.find((p: any) => attr(p, 'typeName') === 'Unit');
      if (found) return profiles;
    }
  }
  return [];
}

function profileToWeapon(p: any, unitId: string) {
  return {
    bsdataId: attr(p, 'id') || `${unitId}-${attr(p, 'name')}`,
    name:     attr(p, 'name'),
    unitId,
    range:    getCharacteristic(p, 'Range'),
    attacks:  getCharacteristic(p, 'A'),
    skill:    getCharacteristic(p, 'BS') || getCharacteristic(p, 'WS'),
    strength: getCharacteristic(p, 'S'),
    armorPen: getCharacteristic(p, 'AP'),
    damage:   getCharacteristic(p, 'D'),
    keywords: (getCharacteristic(p, 'Keywords') || '')
                .split(',').map((k: string) => k.trim()).filter(Boolean),
    isDefault: true,
  };
}

// Recursively collect weapon and ability profiles from an entry and its nested
// selectionEntries/selectionEntryGroups/entryLinks, resolving links via sharedMap.
function collectProfiles(
  entry: any,
  sharedMap: Map<string, any>,
  seen = new Set<string>(),
): { weapons: any[]; abilities: any[] } {
  const id = attr(entry, 'id');
  if (id && seen.has(id)) return { weapons: [], abilities: [] };
  if (id) seen.add(id);

  const weapons:   any[] = [];
  const abilities: any[] = [];

  // Skip ability collection from upgrade entries (enhancements, relics, etc.)
  const isUpgrade = attr(entry, 'type') === 'upgrade';

  // Direct profiles on this entry
  for (const p of entry?.profiles?.[0]?.profile ?? []) {
    const t = attr(p, 'typeName');
    if (t === 'Ranged Weapons' || t === 'Melee Weapons') weapons.push(p);
    else if (t === 'Abilities' && !isUpgrade) abilities.push(p);
  }

  // Recurse into inline selectionEntries
  for (const child of entry?.selectionEntries?.[0]?.selectionEntry ?? []) {
    const r = collectProfiles(child, sharedMap, seen);
    weapons.push(...r.weapons);
    abilities.push(...r.abilities);
  }

  // Recurse into selectionEntryGroups → their selectionEntries and entryLinks
  for (const group of entry?.selectionEntryGroups?.[0]?.selectionEntryGroup ?? []) {
    for (const child of group?.selectionEntries?.[0]?.selectionEntry ?? []) {
      const r = collectProfiles(child, sharedMap, seen);
      weapons.push(...r.weapons);
      abilities.push(...r.abilities);
    }
    for (const link of group?.entryLinks?.[0]?.entryLink ?? []) {
      const target = sharedMap.get(attr(link, 'targetId'));
      if (target) {
        const r = collectProfiles(target, sharedMap, seen);
        weapons.push(...r.weapons);
        abilities.push(...r.abilities);
      }
    }
  }

  // Resolve top-level entryLinks on this entry
  for (const link of entry?.entryLinks?.[0]?.entryLink ?? []) {
    const target = sharedMap.get(attr(link, 'targetId'));
    if (target) {
      const r = collectProfiles(target, sharedMap, seen);
      weapons.push(...r.weapons);
      abilities.push(...r.abilities);
    }
  }

  return { weapons, abilities };
}

// ── main entry parser ─────────────────────────────────────────────────────────

function parseSelectionEntries(
  entries: any[],
  factionId: string,
  sharedMap: Map<string, any>,
): any[] {
  const units: any[] = [];

  for (const entry of entries ?? []) {
    const type = attr(entry, 'type');
    if (type !== 'unit' && type !== 'model') continue;
    if (attr(entry, 'hidden') === 'true') continue;

    const name     = attr(entry, 'name');
    const bsdataId = attr(entry, 'id');
    const { basePoints, priceTiers } = getPointsData(entry);
    const keywords = getKeywords(entry);
    const directProfiles = entry?.profiles?.[0]?.profile ?? [];

    const statsProfiles = directProfiles.some((p: any) => attr(p, 'typeName') === 'Unit')
      ? directProfiles
      : findChildUnitProfile(entry);
    const statsBlock = parseUnitProfile(statsProfiles);
    const { weapons: rawWeapons, abilities: rawAbilities } =
      collectProfiles(entry, sharedMap);

    // Deduplicate by name — same weapon can appear once per model type in the file
    const seenWeaponNames = new Set<string>();
    const weapons = rawWeapons
      .filter(p => {
        const n = attr(p, 'name');
        if (seenWeaponNames.has(n)) return false;
        seenWeaponNames.add(n);
        return true;
      })
      .map(p => profileToWeapon(p, bsdataId));

    const seenAbilityNames = new Set<string>();
    const abilities = rawAbilities
      .filter((p: any) => {
        const n = attr(p, 'name');
        if (seenAbilityNames.has(n)) return false;
        seenAbilityNames.add(n);
        return true;
      })
      .map((p: any) => ({
        bsdataId:    attr(p, 'id') || `${bsdataId}-${attr(p, 'name')}`,
        name:        attr(p, 'name'),
        unitId:      bsdataId,
        description: getCharacteristic(p, 'Description'),
      }));

    const isLeader = abilities.some((a: any) =>
      a.name?.toLowerCase().includes('leader') ||
      a.description?.toLowerCase().includes('can be attached')
    );

    const role = getPrimaryRole(keywords);

    // Extract squad size from the first model group's constraints
    let sizeMin = 1, sizeMax = 1;
    const mainGroup = entry?.selectionEntryGroups?.[0]?.selectionEntryGroup?.[0];
    if (mainGroup) {
      const sz = getGroupSize(mainGroup);
      if (sz) { sizeMin = sz.min; sizeMax = sz.max; }
    }

    // Build sizeCosts from base cost + all modifier-derived tiers.
    // priceTiers condition values are selection counts; prepend base at sizeMin.
    const sizeCosts: { size: number; points: number }[] =
      sizeMin === sizeMax || priceTiers.length === 0
        ? [{ size: sizeMin, points: basePoints }]
        : [{ size: sizeMin, points: basePoints }, ...priceTiers];

    // Extract wargear groups — from child model entries (multi-model units) or directly (single-model)
    const wargearGroups: WargearGroup[] = [];
    if (type === 'unit' && mainGroup) {
      for (const model of mainGroup?.selectionEntries?.[0]?.selectionEntry ?? []) {
        wargearGroups.push(...extractWargearGroups(model, attr(model, 'name'), sharedMap));
      }
    } else {
      wargearGroups.push(...extractWargearGroups(entry, name, sharedMap));
    }
    const seenGroups = new Set<string>();
    const dedupedWargear = wargearGroups.filter(g => {
      const key = `${g.modelRole}::${g.groupName}`;
      if (seenGroups.has(key)) return false;
      seenGroups.add(key);
      return true;
    });

    units.push({
      bsdataId,
      name,
      factionId,
      points:        basePoints,
      role,
      keywords:      keywords.filter(k => !['Faction', 'Keywords'].includes(k)),
      factionKeywords: keywords.filter(k => k === k.toUpperCase() && k.length > 2 && /[A-Z]/.test(k)),
      isLeader,
      modelCount:    1,
      maxCount:      role === 'Battleline' ? 6 : 3,
      sizeCosts,
      wargearGroups: dedupedWargear,
      ...statsBlock,
      weapons,
      abilities,
    });
  }

  return units;
}

// ── seeder ────────────────────────────────────────────────────────────────────

async function seedFromCatFile(catFilePath: string) {
  console.log(`\n📂 Parsing: ${catFilePath}`);
  const xml = fs.readFileSync(catFilePath, 'utf-8');

  const parser = new xml2js.Parser({ explicitArray: true, mergeAttrs: false });
  const result = await parser.parseStringPromise(xml);

  const catalogue = result.catalogue ?? result.catalog;
  if (!catalogue) throw new Error('No <catalogue> root element found');

  const catalogueName: string = catalogue.$?.name ?? 'Unknown Faction';
  const catalogueId: string   = catalogue.$?.id   ?? catalogueName;

  console.log(`✅ Faction: ${catalogueName}`);

  // Upsert faction
  const faction = await prisma.faction.upsert({
    where:  { bsdataId: catalogueId },
    update: { name: catalogueName },
    create: { bsdataId: catalogueId, name: catalogueName },
  });

  // Build a lookup map of all shared entries/groups by id for link resolution
  const sharedEntries = catalogue?.sharedSelectionEntries?.[0]?.selectionEntry ?? [];
  const sharedEntryGroups = catalogue?.sharedSelectionEntryGroups?.[0]?.selectionEntryGroup ?? [];
  const sharedMap = new Map<string, any>([
    ...sharedEntries.map((e: any): [string, any] => [attr(e, 'id'), e]),
    ...sharedEntryGroups.map((e: any): [string, any] => [attr(e, 'id'), e]),
  ]);

  // Parse units from selectionEntries and sharedSelectionEntries
  const topEntries = catalogue?.selectionEntries?.[0]?.selectionEntry ?? [];
  const units      = parseSelectionEntries([...topEntries, ...sharedEntries], faction.id, sharedMap);

  console.log(`   Found ${units.length} units`);

  // Seed units
  for (const unitData of units) {
    const { weapons, abilities, ...unitFields } = unitData;

    const unit = await prisma.unit.upsert({
      where:  { bsdataId: unitFields.bsdataId },
      update: unitFields,
      create: unitFields,
    });

    // Replace weapon profiles and abilities wholesale so stale records don't persist
    await prisma.weaponProfile.deleteMany({ where: { unitId: unit.id } });
    for (const wp of weapons) {
      await prisma.weaponProfile.create({ data: { ...wp, unitId: unit.id } });
    }

    await prisma.ability.deleteMany({ where: { unitId: unit.id } });
    for (const ab of abilities) {
      await prisma.ability.create({ data: { ...ab, unitId: unit.id } });
    }
  }

  console.log(`✅ Seeded faction: ${catalogueName}`);
}

// ── run ───────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: npx ts-node scripts/parse-bsdata.ts <path-to.cat> [<path2.cat> ...]');
    process.exit(1);
  }

  for (const filePath of args) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      console.error(`File not found: ${resolved}`);
      continue;
    }
    await seedFromCatFile(resolved);
  }

  await prisma.$disconnect();
  console.log('\n🎉 Done!');
}

main().catch(e => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});