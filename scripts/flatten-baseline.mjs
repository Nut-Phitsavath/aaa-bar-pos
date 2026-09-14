import { PrismaClient } from '@prisma/client'
import { writeFileSync } from 'node:fs'

const p = new PrismaClient()
const counts = {
  menu: await p.menu.count(),
  menuPricedAboveZero: await p.menu.count({ where: { price: { gt: 0 } } }).catch(() => null),
  orderItem: await p.orderItem.count(),
  orderItemLinked: await p.orderItem.count({ where: { variationSizeId: { not: null } } }),
  recipe: await p.recipe.count(),
  packageSwapLine: await p.packageSwapLine.count(),
}
const bill = await p.tableSession.findFirst({
  where: { status: 'CLOSED' }, orderBy: { closedAt: 'desc' }, select: { id: true },
})
const rendered = await (await fetch(`http://localhost:3000/api/table-sessions/${bill.id}`)).json()
writeFileSync('.superpowers/sdd/2026-09-14-flatten-menu-price/flatten-baseline.json', JSON.stringify({ counts, billId: bill.id, rendered }, null, 2))
console.log(counts)
await p.$disconnect()
