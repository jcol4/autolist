/**
 * meta-scraper.ts
 * Scrapes tournament meta from Grimhammer Tactics and Goonhammer,
 * uses Claude to extract structured unit frequency data,
 * and caches results in MetaSnapshot table.
 */

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from './prisma'

const client = new Anthropic()

const GRIMHAMMER_INDEX_URL = 'https://grimhammertactics.com/blog/'
const GOONHAMMER_URL =
  'https://www.goonhammer.com/competitive-innovations-list-archetypes/'

const SOURCES = [
  { name: 'grimhammer', label: 'Grimhammer Tactics Top Lists' },
  { name: 'goonhammer', label: 'Goonhammer Competitive Archetypes' },
]

const CACHE_TTL_HOURS = 24

export interface MetaUnit {
  name: string       // unit name as it appears in your DB
  frequency: number  // 0–1, how often it appears across top lists
  notes: string      // why it's good, e.g. "scores primary, pairs with Gladius"
}

export interface MetaData {
  detachment: string
  topUnits: MetaUnit[]
  generalNotes: string
  sourceUrls: string[]
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'AutoList/1.0 (list building research tool)' },
  })
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  return res.text()
}

/** Scrape Grimhammer blog index to find the most recent top-lists article URL */
async function resolveGrimhammerUrl(): Promise<string> {
  const html = await fetchPage(GRIMHAMMER_INDEX_URL)
  // Look for links containing "top-" and "lists" in href
  const match = html.match(/href="(https:\/\/grimhammertactics\.com\/[^"]*top-[^"]*list[^"]*)"/i)
  if (match?.[1]) return match[1]
  return GRIMHAMMER_INDEX_URL
}

async function extractMetaWithClaude(
  htmlPages: Array<{ source: string; html: string }>,
  faction: string
): Promise<Omit<MetaData, 'sourceUrls'>> {
  const textContent = htmlPages
    .map(({ source, html }) => {
      const stripped = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .slice(0, 15000)
      return `=== SOURCE: ${source} ===\n${stripped}`
    })
    .join('\n\n')

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `You are analyzing Warhammer 40k tournament data to extract meta information for the ${faction} faction.

From the following scraped tournament content, extract:
1. The most commonly winning detachment for ${faction}
2. The top units appearing across winning ${faction} lists, with approximate frequency (0-1) and why they're effective
3. A brief general meta summary for ${faction}

Return ONLY valid JSON matching this exact structure, no other text:
{
  "detachment": "string - most common winning detachment name",
  "topUnits": [
    { "name": "exact unit name", "frequency": 0.8, "notes": "why this unit is meta" }
  ],
  "generalNotes": "2-3 sentence meta summary"
}

Use exact unit names as they appear in official 40k datasheets. Only include units for the ${faction} faction.

SCRAPED CONTENT:
${textContent}`,
      },
    ],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Claude returned invalid JSON: ${text.slice(0, 200)}`)
  }
}

export async function getMetaSnapshot(faction: string): Promise<MetaData> {
  const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000)
  const cached = await prisma.metaSnapshot.findFirst({
    where: { faction, scrapedAt: { gte: cutoff } },
    orderBy: { scrapedAt: 'desc' },
  })

  if (cached) {
    console.log(`[meta] Using cached snapshot for ${faction} (${cached.scrapedAt.toISOString()})`)
    return JSON.parse(cached.data) as MetaData
  }

  console.log(`[meta] Scraping fresh meta for ${faction}...`)

  const grimhammerUrl = await resolveGrimhammerUrl().catch(() => GRIMHAMMER_INDEX_URL)
  const sourceUrls: string[] = [grimhammerUrl, GOONHAMMER_URL]

  const pages = await Promise.allSettled(
    sourceUrls.map(async (url, i) => ({
      source: SOURCES[i]?.label ?? url,
      html: await fetchPage(url),
    }))
  )

  const successfulPages = pages
    .filter((r): r is PromiseFulfilledResult<{ source: string; html: string }> =>
      r.status === 'fulfilled'
    )
    .map((r) => r.value)

  if (successfulPages.length === 0) {
    throw new Error('All meta sources failed to fetch')
  }

  const extracted = await extractMetaWithClaude(successfulPages, faction)
  const meta: MetaData = { ...extracted, sourceUrls }

  await prisma.metaSnapshot.create({
    data: {
      faction,
      source: SOURCES.map((s) => s.name).join('+'),
      data: JSON.stringify(meta),
    },
  })

  return meta
}
