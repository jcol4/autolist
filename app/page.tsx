import { prisma } from '@/lib/prisma'
import ArmyBuilder from './components/ArmyBuilder'

export default async function Home() {
  const factions = await prisma.faction.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })

  return <ArmyBuilder initialFactions={factions} />
}
