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

        // Fetch Orders
        const orders = await prisma.order.findMany({
            where: {
                createdAt: {
                    gte: start,
                    lte: end
                },
                status: 'COMPLETED'
            },
            orderBy: { createdAt: 'desc' }
        })

        // Fetch Order Items
        const orderItems = await prisma.orderItem.findMany({
            where: {
                order: {
                    createdAt: {
                        gte: start,
                        lte: end
                    },
                    status: 'COMPLETED'
                }
            },
            include: {
                order: {
                    select: {
                        orderNumber: true,
                        createdAt: true
                    }
                }
            },
            orderBy: { order: { createdAt: 'desc' } }
        })

        // Flat for Excel
        const flatItems = orderItems.map(item => ({
            id: item.id,
            orderId: item.orderId,
            menuId: item.menuId,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            total: item.total,
            orderNumber: item.order.orderNumber,
            orderDate: item.order.createdAt
        }))

        // Create workbook
        const wb = XLSX.utils.book_new()

        // Orders Sheet
        const wsOrders = XLSX.utils.json_to_sheet(orders)
        XLSX.utils.book_append_sheet(wb, wsOrders, "Orders")

        // Items Sheet
        const wsItems = XLSX.utils.json_to_sheet(flatItems)
        XLSX.utils.book_append_sheet(wb, wsItems, "Order Items")

        // Generate buffer
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

        return new NextResponse(buf, {
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="export_${startDate.split('T')[0]}_to_${endDate.split('T')[0]}.xlsx"`
            }
        })

    } catch (e) {
        console.error('Export error:', e)
        return NextResponse.json({ error: 'Export failed' }, { status: 500 })
    }
}
