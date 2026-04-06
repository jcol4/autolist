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
    },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  })
  return Response.json(units)
}
