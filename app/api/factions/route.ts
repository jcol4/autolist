import { prisma } from '@/lib/prisma'

export async function GET() {
  const factions = await prisma.faction.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })
  return Response.json(factions)
}
