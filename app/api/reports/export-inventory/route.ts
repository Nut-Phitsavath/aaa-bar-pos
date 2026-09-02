import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import * as XLSX from 'xlsx'

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url)
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')

        if (!startDate || !endDate) {
            return NextResponse.json({ error: 'Missing date range' }, { status: 400 })
        }

        const start = new Date(startDate)
        const end = new Date(endDate)

        // Fetch Inventory Transactions
        const transactions = await prisma.stockTransaction.findMany({
            where: {
                createdAt: {
                    gte: start,
                    lte: end
                }
            },
            include: {
                ingredient: {
                    select: {
                        name: true,
                        unit: true
                    }
                },
                user: {
                    select: {
                        name: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        })

        // Flat for Excel
        const flatTransactions = transactions.map(tx => ({
            id: tx.id,
            date: tx.createdAt.toISOString().split('T')[0],
            time: tx.createdAt.toISOString().split('T')[1].split('.')[0],
            type: tx.type,
            item: tx.ingredient.name,
            quantity: tx.quantity,
            unit: tx.ingredient.unit,
            fromStore: tx.fromStore || '-',
            toStore: tx.toStore || '-',
            staff: tx.user?.name || '-',
            reason: tx.reason || '-',
            cost: tx.cost || 0,
            notes: tx.notes || '-'
        }))

        // Create workbook
        const wb = XLSX.utils.book_new()
        const ws = XLSX.utils.json_to_sheet(flatTransactions)

        // Auto-width columns (simple version)
        const max_width = flatTransactions.reduce((w, r) => Math.max(w, r.item.length), 10)
        ws['!cols'] = [
            { wch: 10 }, // date
            { wch: 10 }, // time
            { wch: 15 }, // type
            { wch: max_width + 5 }, // item
            { wch: 10 }, // quantity
            { wch: 8 },  // unit
            { wch: 12 }, // fromStore
            { wch: 12 }, // toStore
            { wch: 15 }, // staff
            { wch: 20 }, // reason
            { wch: 10 }, // cost
            { wch: 30 }  // notes
        ]

        XLSX.utils.book_append_sheet(wb, ws, "Inventory Transactions")

        // Generate buffer
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

        return new NextResponse(buf, {
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="inventory_transactions_${startDate.split('T')[0]}_to_${endDate.split('T')[0]}.xlsx"`
            }
        })

    } catch (e) {
        console.error('Export error:', e)
        return NextResponse.json({ error: 'Export failed' }, { status: 500 })
    }
}
