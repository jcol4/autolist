'use client'

import { useState, useEffect, useMemo } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

type WeaponProfile = {
  id: string
  name: string
  range: string | null
  attacks: string | null
  skill: string | null
  strength: string | null
  armorPen: string | null
  damage: string | null
  keywords: string[]
}

type Ability = {
  id: string
  name: string
  description: string | null
}

type WargearGroup = {
  modelRole: string
  groupName: string
  min: number
  max: number
  options: string[]
}

type SizeCost = { size: number; points: number }

type Unit = {
  id: string
  bsdataId: string
  name: string
  role: string
  points: number
  movement: string | null
  toughness: number | null
  save: number | null
  wounds: number | null
  leadership: number | null
  objectiveControl: number | null
  isLeader: boolean
  maxCount: number
  sizeCosts: SizeCost[]
  wargearGroups: WargearGroup[]
  keywords: string[]
  factionKeywords: string[]
  weaponProfiles: WeaponProfile[]
  abilities: Ability[]
}

type Faction = { id: string; name: string }

function entryPoints(entry: ListEntry): number {
  const { unit, size } = entry
  const match = unit.sizeCosts.find(sc => sc.size === size)
  return match?.points ?? unit.points
}

// wargear: { "ModelRole::GroupName": chosenOption }
type ListEntry = {
  unit: Unit
  qty: number
  size: number
  wargear: Record<string, string>
}

// ── Stat chip ─────────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex flex-col items-center min-w-[36px]">
      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</span>
      <span className="text-sm font-semibold text-zinc-100">{value ?? '—'}</span>
    </div>
  )
}

// ── Weapon table ──────────────────────────────────────────────────────────────

function WeaponTable({ weapons }: { weapons: WeaponProfile[] }) {
  if (weapons.length === 0) return null
  return (
    <div className="overflow-x-auto mt-2">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-zinc-400 border-b border-zinc-700">
            <th className="text-left py-1 pr-2 font-semibold">Weapon</th>
            <th className="text-center py-1 px-1 font-semibold">Rng</th>
            <th className="text-center py-1 px-1 font-semibold">A</th>
            <th className="text-center py-1 px-1 font-semibold">BS/WS</th>
            <th className="text-center py-1 px-1 font-semibold">S</th>
            <th className="text-center py-1 px-1 font-semibold">AP</th>
            <th className="text-center py-1 px-1 font-semibold">D</th>
            <th className="text-left py-1 pl-2 font-semibold">Keywords</th>
          </tr>
        </thead>
        <tbody>
          {weapons.map(w => {
            const kws = w.keywords.filter(k => k !== '-')
            return (
              <tr key={w.id} className="border-b border-zinc-800 last:border-0">
                <td className="py-1 pr-2 text-zinc-200">{w.name}</td>
                <td className="text-center py-1 px-1 text-zinc-300">{w.range || '—'}</td>
                <td className="text-center py-1 px-1 text-zinc-300">{w.attacks || '—'}</td>
                <td className="text-center py-1 px-1 text-zinc-300">{w.skill || '—'}</td>
                <td className="text-center py-1 px-1 text-zinc-300">{w.strength || '—'}</td>
                <td className="text-center py-1 px-1 text-zinc-300">{w.armorPen || '—'}</td>
                <td className="text-center py-1 px-1 text-zinc-300">{w.damage || '—'}</td>
                <td className="py-1 pl-2">
                  {kws.length > 0
                    ? <span className="text-sky-400">{kws.join(', ')}</span>
                    : <span className="text-zinc-600">—</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Unit card ─────────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  Character:    'bg-amber-900/60 text-amber-300 border-amber-700',
  Battleline:   'bg-blue-900/60 text-blue-300 border-blue-700',
  Infantry:     'bg-green-900/60 text-green-300 border-green-700',
  Vehicle:      'bg-orange-900/60 text-orange-300 border-orange-700',
  Monster:      'bg-red-900/60 text-red-300 border-red-700',
  Mounted:      'bg-purple-900/60 text-purple-300 border-purple-700',
  Fly:          'bg-sky-900/60 text-sky-300 border-sky-700',
  Fortification:'bg-stone-700/60 text-stone-300 border-stone-600',
  Titanic:      'bg-rose-900/60 text-rose-300 border-rose-700',
  Beast:        'bg-lime-900/60 text-lime-300 border-lime-700',
}

function roleColor(role: string) {
  return ROLE_COLORS[role] ?? 'bg-zinc-800/60 text-zinc-300 border-zinc-600'
}

function UnitCard({ unit, currentQty, onAdd, isLegends }: { unit: Unit; currentQty: number; onAdd: () => void; isLegends: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const atLimit = currentQty >= unit.maxCount

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 overflow-hidden">
      {/* Header row */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-zinc-800 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        {unit.isLeader && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-yellow-900/60 text-yellow-300 border-yellow-700">
            Leader
          </span>
        )}
        {isLegends && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-zinc-700/60 text-zinc-400 border-zinc-600">
            Legends
          </span>
        )}
        <span className="flex-1 text-sm font-semibold text-zinc-100 truncate">{unit.name}</span>
        <span className="text-sm font-bold text-yellow-400 shrink-0">
          {unit.sizeCosts.length > 1
            ? `${unit.sizeCosts[0].points}–${unit.sizeCosts[unit.sizeCosts.length - 1].points}`
            : unit.points} pts
        </span>
        <svg
          className={`w-4 h-4 text-zinc-400 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-zinc-800 space-y-3">
          {/* Stats */}
          <div className="flex gap-3 pt-2 flex-wrap">
            <Stat label="M"  value={unit.movement} />
            <Stat label="T"  value={unit.toughness} />
            <Stat label="Sv" value={unit.save ? `${unit.save}+` : null} />
            <Stat label="W"  value={unit.wounds} />
            <Stat label="Ld" value={unit.leadership ? `${unit.leadership}+` : null} />
            <Stat label="OC" value={unit.objectiveControl} />
          </div>

          {/* Weapons */}
          {unit.weaponProfiles.length > 0 && (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">Weapons</h4>
              <WeaponTable weapons={unit.weaponProfiles} />
            </div>
          )}

          {/* Abilities */}
          {unit.abilities.length > 0 && (
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">Abilities</h4>
              <ul className="space-y-1">
                {unit.abilities.map(a => (
                  <li key={a.id} className="text-xs">
                    <span className="font-semibold text-zinc-200">{a.name}</span>
                    {a.description && (
                      <span className="text-zinc-400"> — {a.description}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Keywords */}
          {unit.keywords.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {unit.keywords.map(k => (
                <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                  {k}
                </span>
              ))}
            </div>
          )}

          <button
            onClick={e => { e.stopPropagation(); onAdd() }}
            disabled={atLimit}
            className={`mt-1 w-full rounded-md text-xs font-semibold py-1.5 transition-colors ${
              atLimit
                ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                : 'bg-blue-700 hover:bg-blue-600 text-white'
            }`}
          >
            {atLimit ? `Limit reached (${unit.maxCount}/${unit.maxCount})` : `+ Add to List (${currentQty}/${unit.maxCount})`}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Army list entry (with inline edit) ───────────────────────────────────────

function ListEntryRow({
  entry,
  onUpdate,
  onRemove,
}: {
  entry: ListEntry
  onUpdate: (e: ListEntry) => void
  onRemove: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const { unit } = entry

  const hasOptions = unit.sizeCosts.length > 1 || unit.wargearGroups.length > 0
  const sizeOptions = unit.sizeCosts.length > 1 ? unit.sizeCosts : []
  const pts = entryPoints(entry)

  function setQty(delta: number) {
    const newQty = entry.qty + delta
    if (newQty > unit.maxCount || newQty <= 0) { if (newQty <= 0) onRemove(); return }
    onUpdate({ ...entry, qty: newQty })
  }

  function setSize(size: number) { onUpdate({ ...entry, size }) }

  function setWargear(key: string, choice: string) {
    onUpdate({ ...entry, wargear: { ...entry.wargear, [key]: choice } })
  }

  return (
    <div className="rounded-md bg-zinc-800 overflow-hidden">
      {/* Main row */}
      <div className="flex items-center gap-2 px-2 py-1.5">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-zinc-200 truncate">{unit.name}</div>
          {unit.sizeCosts.length > 1 && (
            <div className="text-[10px] text-zinc-500">{entry.size} models</div>
          )}
        </div>
        <span className="text-xs text-yellow-400 font-semibold shrink-0">
          {pts * entry.qty} pts
        </span>
        {hasOptions && (
          <button
            onClick={() => setExpanded(x => !x)}
            title="Edit options"
            className={`shrink-0 w-5 h-5 flex items-center justify-center rounded text-xs transition-colors ${expanded ? 'bg-blue-700 text-white' : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-400'}`}
          >
            ✎
          </button>
        )}
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setQty(-1)} className="w-5 h-5 flex items-center justify-center rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs font-bold">−</button>
          <span className="w-5 text-center text-xs text-zinc-300">{entry.qty}</span>
          <button
            onClick={() => setQty(+1)}
            disabled={entry.qty >= unit.maxCount}
            className="w-5 h-5 flex items-center justify-center rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed"
          >+</button>
        </div>
      </div>

      {/* Expanded options */}
      {expanded && (
        <div className="border-t border-zinc-700 px-3 py-2 space-y-2 bg-zinc-900">
          {/* Squad size */}
          {sizeOptions.length > 1 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">Squad Size</div>
              <div className="flex gap-1 flex-wrap">
                {sizeOptions.map(sc => (
                  <button
                    key={sc.size}
                    onClick={() => setSize(sc.size)}
                    className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                      entry.size === sc.size
                        ? 'bg-blue-700 border-blue-600 text-white'
                        : 'border-zinc-600 text-zinc-400 hover:border-zinc-400'
                    }`}
                  >{sc.size} models — {sc.points} pts</button>
                ))}
              </div>
            </div>
          )}

          {/* Wargear groups */}
          {unit.wargearGroups.map(g => {
            const key = `${g.modelRole}::${g.groupName}`
            const label = unit.wargearGroups.filter(x => x.groupName === g.groupName).length > 1
              ? `${g.modelRole} — ${g.groupName}`
              : g.groupName
            return (
              <div key={key}>
                <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">{label}</div>
                <select
                  value={entry.wargear[key] ?? g.options[0]}
                  onChange={ev => setWargear(key, ev.target.value)}
                  className="w-full rounded border border-zinc-600 bg-zinc-800 text-zinc-200 text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {g.options.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Army list panel ───────────────────────────────────────────────────────────

const POINTS_LIMIT = 2000

function ArmyListPanel({
  list,
  onChange,
}: {
  list: ListEntry[]
  onChange: (list: ListEntry[]) => void
}) {
  const total = list.reduce((s, e) => s + entryPoints(e) * e.qty, 0)
  const pct   = Math.min((total / POINTS_LIMIT) * 100, 100)

  function updateEntry(idx: number, entry: ListEntry) {
    const next = [...list]
    next[idx] = entry
    onChange(next)
  }

  function removeEntry(idx: number) {
    const next = [...list]
    next.splice(idx, 1)
    onChange(next)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-zinc-700">
        <h2 className="font-bold text-zinc-100 text-sm mb-2">Army List</h2>
        <div className="text-xs text-zinc-400 mb-1 flex justify-between">
          <span>{total} / {POINTS_LIMIT} pts</span>
          {total > POINTS_LIMIT && <span className="text-red-400 font-semibold">Over limit!</span>}
        </div>
        <div className="h-1.5 w-full rounded-full bg-zinc-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${total > POINTS_LIMIT ? 'bg-red-500' : 'bg-blue-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {list.length === 0 && (
          <p className="text-xs text-zinc-500 text-center py-8">No units selected.<br />Add units from the roster.</p>
        )}
        {list.map((entry, idx) => (
          <ListEntryRow
            key={`${entry.unit.id}-${idx}`}
            entry={entry}
            onUpdate={e => updateEntry(idx, e)}
            onRemove={() => removeEntry(idx)}
          />
        ))}
      </div>

      {list.length > 0 && (
        <div className="px-4 py-3 border-t border-zinc-700">
          <button
            onClick={() => onChange([])}
            className="w-full rounded-md border border-zinc-600 hover:border-red-500 hover:text-red-400 text-zinc-400 text-xs py-1.5 transition-colors"
          >
            Clear list
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const ROLES = ['Character', 'Battleline', 'Infantry', 'Vehicle', 'Monster', 'Mounted', 'Fly', 'Fortification', 'Titanic', 'Beast']

function isLegendsUnit(unit: Unit) {
  return unit.name.includes('[Legends]')
}

export default function ArmyBuilder({ initialFactions }: { initialFactions: Faction[] }) {
  const [factionId, setFactionId]       = useState<string>(initialFactions[0]?.id ?? '')
  const [units, setUnits]               = useState<Unit[]>([])
  const [loading, setLoading]           = useState(false)
  const [search, setSearch]             = useState('')
  const [showLegends, setShowLegends]   = useState(false)
  const [collapsedRoles, setCollapsedRoles] = useState<Set<string>>(new Set())
  const [list, setList]                 = useState<ListEntry[]>([])

  useEffect(() => {
    if (!factionId) return
    setLoading(true)
    fetch(`/api/factions/${factionId}/units`)
      .then(r => r.json())
      .then((data: Unit[]) => { setUnits(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [factionId])

  // Group visible units by role, preserving ROLES priority order
  const groupedUnits = useMemo(() => {
    const q = search.toLowerCase()
    const visible = units.filter(u => {
      if (isLegendsUnit(u) && !showLegends) return false
      return !q || u.name.toLowerCase().includes(q)
    })
    const buckets = new Map<string, Unit[]>()
    for (const r of ROLES) buckets.set(r, [])
    buckets.set('Other', [])
    for (const u of visible) {
      const bucket = buckets.has(u.role) ? u.role : 'Other'
      buckets.get(bucket)!.push(u)
    }
    return Array.from(buckets.entries()).filter(([, us]) => us.length > 0)
  }, [units, search, showLegends])

  const listQtyMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of list) m.set(e.unit.id, e.qty)
    return m
  }, [list])

  function toggleRole(role: string) {
    setCollapsedRoles(prev => {
      const next = new Set(prev)
      next.has(role) ? next.delete(role) : next.add(role)
      return next
    })
  }

  function defaultWargear(unit: Unit): Record<string, string> {
    const w: Record<string, string> = {}
    for (const g of unit.wargearGroups) {
      const key = `${g.modelRole}::${g.groupName}`
      w[key] = g.options[0] ?? ''
    }
    return w
  }

  function addUnit(unit: Unit) {
    setList(prev => {
      const idx = prev.findIndex(e => e.unit.id === unit.id)
      if (idx >= 0) {
        if (prev[idx].qty >= unit.maxCount) return prev
        const next = [...prev]
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 }
        return next
      }
      return [...prev, { unit, qty: 1, size: unit.sizeCosts[0]?.size ?? 1, wargear: defaultWargear(unit) }]
    })
  }

  const totalVisible = groupedUnits.reduce((s, [, us]) => s + us.length, 0)

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="flex items-center gap-4 px-4 py-3 border-b border-zinc-800 bg-zinc-900 shrink-0">
        <h1 className="font-bold text-lg tracking-tight text-zinc-100">AutoList</h1>
        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-400 font-semibold">Faction</label>
          <select
            value={factionId}
            onChange={e => setFactionId(e.target.value)}
            className="rounded-md border border-zinc-700 bg-zinc-800 text-zinc-100 text-sm px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {initialFactions.map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
        {units.length > 0 && (
          <span className="text-xs text-zinc-500 hidden sm:block">{units.length} units loaded</span>
        )}
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: roster */}
        <div className="flex flex-col flex-1 min-w-0 border-r border-zinc-800">
          {/* Search + filters */}
          <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-zinc-800 bg-zinc-900 shrink-0">
            <input
              type="search"
              placeholder="Search units…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="rounded-md border border-zinc-700 bg-zinc-800 text-sm text-zinc-100 px-3 py-1 w-48 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-zinc-500"
            />
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showLegends}
                onChange={e => setShowLegends(e.target.checked)}
                className="rounded border-zinc-600 bg-zinc-800 accent-blue-600"
              />
              <span className="text-xs text-zinc-400">Show Legends</span>
            </label>
          </div>

          {/* Grouped unit list */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
            {loading && (
              <div className="flex items-center justify-center h-32 text-zinc-500 text-sm">Loading…</div>
            )}
            {!loading && totalVisible === 0 && (
              <div className="flex items-center justify-center h-32 text-zinc-500 text-sm">No units found.</div>
            )}
            {!loading && groupedUnits.map(([role, roleUnits]) => {
              const collapsed = collapsedRoles.has(role)
              return (
                <div key={role} className="mb-1">
                  {/* Group header */}
                  <button
                    onClick={() => toggleRole(role)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 transition-colors text-left"
                  >
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${roleColor(role)}`}>
                      {role}
                    </span>
                    <span className="text-xs text-zinc-400 flex-1">{roleUnits.length} units</span>
                    <svg
                      className={`w-3.5 h-3.5 text-zinc-500 shrink-0 transition-transform ${collapsed ? '-rotate-90' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Group units */}
                  {!collapsed && (
                    <div className="mt-1 ml-2 space-y-1.5">
                      {roleUnits.map(unit => (
                        <UnitCard
                          key={unit.id}
                          unit={unit}
                          currentQty={listQtyMap.get(unit.id) ?? 0}
                          onAdd={() => addUnit(unit)}
                          isLegends={isLegendsUnit(unit)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Right: army list */}
        <div className="w-72 shrink-0 bg-zinc-900">
          <ArmyListPanel list={list} onChange={setList} />
        </div>
      </div>
    </div>
  )
}
