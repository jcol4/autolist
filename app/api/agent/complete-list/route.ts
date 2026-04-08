import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'
import { getMetaSnapshot, type MetaData } from '@/lib/meta-scraper'

const client = new Anthropic()

interface PartialListUnit {
  unitName: string
  modelCount?: number
}

interface RequestBody {
  faction: string
  detachmentName: string
  pointsLimit: number
  partialList: PartialListUnit[]
}

interface ScaledCostTier {
  minModels: number
  points: number
}

export async function POST(request: NextRequest) {
  const body: RequestBody = await request.json()
  const { detachmentName, pointsLimit, partialList } = body

  // Step 1: Get meta snapshot (non-blocking — proceed without if unavailable)
  let meta: MetaData | null = null
  try {
    meta = await getMetaSnapshot('Space Marines')
  } catch (err) {
    console.error('[agent] Meta scrape failed, continuing without:', err)
  }

  // Step 2: Query DB for available units + detachment
  const [dbUnits, detachment] = await Promise.all([
    prisma.unit.findMany({
      where: { faction: { name: { contains: 'Space Marines' } } },
      include: { weaponProfiles: true, abilities: { take: 3 } },
      orderBy: { points: 'asc' },
    }),
    prisma.detachment.findFirst({
      where: { name: detachmentName },
      include: { enhancements: true },
    }),
  ])

  // Step 3: Calculate points already spent
  const spentPoints = partialList.reduce((sum, listUnit) => {
    const dbUnit = dbUnits.find(
      (u) => u.name.toLowerCase() === listUnit.unitName.toLowerCase()
    )
    if (!dbUnit) return sum
    const scaledCosts = JSON.parse(dbUnit.scaledCosts as string) as ScaledCostTier[]
    const modelCount = listUnit.modelCount ?? dbUnit.minModels
    const applicableTier = scaledCosts
      .filter((t) => modelCount >= t.minModels)
      .sort((a, b) => b.minModels - a.minModels)[0]
    return sum + (applicableTier?.points ?? dbUnit.points)
  }, 0)

  const remainingPoints = pointsLimit - spentPoints

  // Step 4: Build context
  const unitCatalog = dbUnits
    .map((u) => {
      const scaled = JSON.parse(u.scaledCosts as string) as ScaledCostTier[]
      const costStr =
        scaled.length > 0
          ? `${u.points}pts (${u.minModels} models) / ${scaled.map((s) => `${s.points}pts (${s.minModels}+ models)`).join(', ')}`
          : `${u.points}pts`
      return `- ${u.name} [${u.role}] ${costStr}${u.isLeader ? ' [LEADER]' : ''}${u.leaderOf.length > 0 ? ` leads: ${u.leaderOf.slice(0, 2).join(', ')}` : ''}`
    })
    .join('\n')

  const metaContext = meta
    ? `CURRENT META (from recent tournament data):
- Winning detachment: ${meta.detachment}
- Top meta units:
${meta.topUnits.map((u) => `  * ${u.name} (${Math.round(u.frequency * 100)}%) — ${u.notes}`).join('\n')}
- Summary: ${meta.generalNotes}`
    : 'META DATA: Unavailable, use general 40k knowledge.'

  const partialListText =
    partialList.length > 0
      ? partialList
          .map((u) => `  - ${u.unitName}${u.modelCount ? ` (${u.modelCount} models)` : ''}`)
          .join('\n')
      : '  (empty — build from scratch)'

  const detachmentContext = detachment
    ? `SELECTED DETACHMENT: ${detachment.name}
Rule: ${detachment.ruleName} — ${detachment.ruleDescription?.slice(0, 300)}
Available enhancements: ${detachment.enhancements.map((e) => `${e.name} (${e.points}pts)`).join(', ')}`
    : `SELECTED DETACHMENT: ${detachmentName}`

  // Step 5: Call Claude to complete the list
  const systemPrompt = `You are an expert Warhammer 40,000 10th Edition list builder specializing in Space Marines.
You have deep knowledge of competitive play, detachment synergies, leader attachment rules, and points optimization.
You will complete partial army lists to make them as meta and competitive as possible.

RULES YOU MUST FOLLOW:
- Total army points must not exceed ${pointsLimit}pts
- Maximum 3 of the same unit (unless battleline — max 6 for some detachments)
- Leaders must be attached to a valid unit (check the "leads:" field in the catalog)
- Suggest 1 enhancement for a Character if points allow
- Explain WHY each unit was added in terms of meta reasoning and synergy

OUTPUT FORMAT: Return valid JSON only, no other text:
{
  "completedList": [
    {
      "unitName": "exact name from catalog",
      "modelCount": 5,
      "pointsCost": 90,
      "enhancement": null,
      "reasoning": "why this unit was chosen"
    }
  ],
  "totalPoints": 1850,
  "remainingPoints": 150,
  "detachmentNote": "how the detachment rule synergises with this list",
  "metaNote": "overall list strategy and meta positioning"
}`

  const userPrompt = `Complete this Space Marines army list to ${pointsLimit}pts.

${detachmentContext}

PARTIAL LIST (already selected, ${spentPoints}pts spent, ${remainingPoints}pts remaining):
${partialListText}

${metaContext}

AVAILABLE UNITS CATALOG:
${unitCatalog}

Fill the remaining ${remainingPoints}pts with the most meta-appropriate units.
Include the partial list units in your completedList output unchanged.
Prioritize units from the meta data. Ensure leaders are attached to valid units.`

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 3000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''

  try {
    const result = JSON.parse(text)
    return Response.json({
      success: true,
      ...result,
      metaFreshness: meta ? 'live' : 'unavailable',
    })
  } catch {
    return Response.json(
      { success: false, error: 'Agent returned malformed response', raw: text },
      { status: 500 }
    )
  }
}
