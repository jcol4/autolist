import { prisma } from '@/lib/prisma'
import type { NextRequest } from 'next/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const units = await prisma.unit.findMany({
    where: { factionId: id },
    include: {
      weaponProfiles: { orderBy: { name: 'asc' } },
      abilities: { orderBy: { name: 'asc' } },
      weaponOptions: true,
    },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  })

  const transformed = units.map(({ scaledCosts, minModels, maxModels, weaponOptions, ...u }) => {
    const tiers: Array<{ minModels: number; points: number }> = JSON.parse(scaledCosts)
    const sizeCosts = [
      { size: minModels, points: u.points },
      ...tiers.map(sc => ({ size: sc.minModels, points: sc.points })),
    ]
    const wargearGroups = weaponOptions
      .filter(wo => wo.choices.length > 1)
      .map(wo => ({
        modelRole: wo.modelName,
        groupName: wo.slotName,
        min: wo.minSelections,
        max: wo.maxSelections,
        options: wo.choices,
      }))
    return { ...u, sizeCosts, wargearGroups, maxCount: maxModels }
  })

  return Response.json(transformed)
}
