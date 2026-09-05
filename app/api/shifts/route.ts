export const runtime = 'nodejs'

import path from "path"
import { existsSync } from "fs"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { canCloseShift } from '@/lib/shift-guard'
import { verifyManager } from '@/lib/manager-auth'
import { sessionTotal } from '@/lib/sessions'
import { billTotalOf, balanceOf } from '@/lib/payments'

// GET /api/shifts?status=OPEN - Get current open shift or all shifts
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')

    try {
        const where = status ? { status: status } : {}
        const shifts = await prisma.shift.findMany({
            where,
            orderBy: { startTime: 'desc' }
        })
        return NextResponse.json(shifts)
    } catch (error) {
        console.error('Shift API GET error:', error)
        return NextResponse.json({ error: "Error fetching shifts" }, { status: 500 })
    }
}

// POST /api/shifts - Start a new shift
export async function POST(request: Request) {
    try {
        const body = await request.json()

        // Check if there is already an open shift
        const openShift = await prisma.shift.findFirst({
            where: { status: 'OPEN' }
        })

        if (openShift) {
            return NextResponse.json({ error: "There is already an open shift" }, { status: 400 })
        }

        // Starting the night sets the float every later count is measured
        // against, so it is a manager's decision - the same gate comps and tabs
        // already use. SambaPOS puts work periods behind a permission for the
        // same reason.
        const approval = await verifyManager(body.managerUsername, body.managerPin)
        if (!approval.ok) {
            return NextResponse.json(
                { error: approval.reason, retryInMs: approval.retryInMs },
                { status: approval.reason === 'TOO_MANY_ATTEMPTS' ? 429 : 403 }
            )
        }

        const shift = await prisma.shift.create({
            data: {
                userId: body.userId ? (await prisma.user.findUnique({ where: { id: body.userId } }) ? body.userId : null) : null,
                startCash: parseFloat(body.startCash?.toString()) || 0,
                responsiblePerson: body.responsiblePerson || null,
                status: 'OPEN'
            }
        })
        return NextResponse.json(shift)
    } catch (error) {
        console.error('Shift API POST error:', error)
        return NextResponse.json({ error: "Error creating shift" }, { status: 500 })
    }
}

// Closing a shift is the natural end-of-day boundary: the drawer has been
// counted and the day's trading is complete, so it is the most valuable
// moment to snapshot the database. Detached and unawaited - a slow or failing
// backup must never delay or break closing the till.
function backupAfterShiftClose() {
    try {
        const { spawn } = require("child_process")
        // powershell.exe, not powershell: Node on Windows does not do PATHEXT
        // resolution for a bare name unless shell:true, and it fails silently.
        const script = path.join(process.cwd(), "scripts", "backup.ps1")
        if (!existsSync(script)) return
        // No detached:true - on Windows it makes the child exit immediately without
        // running. unref() alone is enough: the POS server outlives the backup, and
        // stdio:"ignore" plus unref means the cashier never waits on it.
        spawn("powershell.exe", ["-ExecutionPolicy", "Bypass", "-File", script, "-DbOnly"], {
            stdio: "ignore",
        }).unref()
    } catch (e) {
        console.error("[shifts] backup after close failed to start:", e)
    }
}

// PUT /api/shifts - End shift
export async function PUT(request: Request) {
    try {
        const body = await request.json()
        const { id, actualCash, responsiblePerson, managerUsername, managerPin } = body

        if (!id) return NextResponse.json({ error: "Shift ID required" }, { status: 400 })

        // Closing is where the drawer is reconciled and a variance is declared.
        // Checked before the open-tables guard so a staff member cannot use the
        // refusal to enumerate the floor without approval.
        const approval = await verifyManager(managerUsername, managerPin)
        if (!approval.ok) {
            return NextResponse.json(
                { error: approval.reason, retryInMs: approval.retryInMs },
                { status: approval.reason === 'TOO_MANY_ATTEMPTS' ? 429 : 403 }
            )
        }

        const shift = await prisma.shift.findUnique({ where: { id } })
        if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 })

        // A live table cannot be closed out from under. SambaPOS refuses a work
        // period the same way: settle the ticket, or move it to a customer's
        // account to be paid another day - both of which this till already does.
        //
        // The names and balances come back with the refusal on purpose. Being
        // told "no" without being told what is holding it is what leaves staff
        // hunting at 3am for a table nobody can see.
        const live = await prisma.tableSession.findMany({
            where: { status: { not: 'CLOSED' } },
            include: {
                table: { select: { name: true } },
                orders: { select: { status: true, total: true } },
                payments: true,
            },
        })
        const closeCheck = canCloseShift(
            live.map((s) => ({
                id: s.id,
                table: s.table.name,
                balance: balanceOf(
                    billTotalOf(sessionTotal(s.orders), s.discountType, s.discountValue),
                    s.payments
                ),
            }))
        )
        if (!closeCheck.ok) {
            return NextResponse.json(
                { error: closeCheck.reason, tables: closeCheck.tables, outstanding: closeCheck.outstanding },
                { status: 409 }
            )
        }

        const expectedCash = shift.startCash + shift.cashPayments
        const difference = (parseFloat(actualCash.toString()) || 0) - expectedCash

        const updated = await prisma.shift.update({
            where: { id },
            data: {
                endTime: new Date(),
                endCash: expectedCash,
                actualCash: parseFloat(actualCash.toString()) || 0,
                difference,
                responsiblePerson: responsiblePerson || shift.responsiblePerson,
                status: 'CLOSED'
            }
        })

        backupAfterShiftClose()

        return NextResponse.json(updated)
    } catch (error) {
        console.error('Shift API PUT error:', error)
        return NextResponse.json({ error: "Error closing shift" }, { status: 500 })
    }
}
