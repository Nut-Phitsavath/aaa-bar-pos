"use client"

import { useState } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Plus, Users, Clock } from "lucide-react"
import Link from "next/link"

type Table = {
  id: string
  number: string
  seats: number
  status: "free" | "occupied" | "reserved"
  currentOrder?: string
  duration?: string
}

export default function TablesPage() {
  const { t } = useTranslation()
  const [tables, setTables] = useState<Table[]>([
    { id: "1", number: "T1", seats: 2, status: "occupied", currentOrder: "ORD-125", duration: "35 min" },
    { id: "2", number: "T2", seats: 2, status: "free" },
    { id: "3", number: "T3", seats: 4, status: "occupied", currentOrder: "ORD-126", duration: "12 min" },
    { id: "4", number: "T4", seats: 4, status: "reserved", duration: "Reserved for 3:00 PM" },
    { id: "5", number: "T5", seats: 6, status: "occupied", currentOrder: "ORD-127", duration: "8 min" },
    { id: "6", number: "T6", seats: 2, status: "free" },
    { id: "7", number: "T7", seats: 4, status: "free" },
    { id: "8", number: "T8", seats: 6, status: "free" },
    { id: "9", number: "T9", seats: 2, status: "occupied", currentOrder: "ORD-128", duration: "45 min" },
    { id: "10", number: "T10", seats: 4, status: "reserved", duration: "Reserved for 4:30 PM" },
    { id: "11", number: "T11", seats: 2, status: "free" },
    { id: "12", number: "T12", seats: 6, status: "free" },
  ])

  const freeCount = tables.filter((t) => t.status === "free").length
  const occupiedCount = tables.filter((t) => t.status === "occupied").length
  const reservedCount = tables.filter((t) => t.status === "reserved").length

  const getStatusColor = (status: string) => {
    switch (status) {
      case "free":
        return "bg-green-100 border-green-300"
      case "occupied":
        return "bg-red-100 border-red-300"
      case "reserved":
        return "bg-blue-100 border-blue-300"
      default:
        return "bg-gray-100 border-gray-300"
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "free":
        return <Badge className="bg-green-600 hover:bg-green-700">{t.free}</Badge>
      case "occupied":
        return <Badge className="bg-red-600 hover:bg-red-700">{t.occupied}</Badge>
      case "reserved":
        return <Badge className="bg-blue-600 hover:bg-blue-700">{t.reserved}</Badge>
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-white sticky top-0 z-10">
        <div className="flex items-center justify-between p-4">
          <h1 className="text-2xl font-bold text-amber-900">{t.table_management}</h1>
          <div className="flex items-center gap-4">
            <Link href="/dashboard">
              <Button variant="outline" size="sm">
                {t.dashboard}
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card className="p-6">
            <p className="text-sm text-muted-foreground mb-1">{t.total_tables}</p>
            <p className="text-3xl font-bold">{tables.length}</p>
          </Card>
          <Card className="p-6">
            <p className="text-sm text-muted-foreground mb-1">{t.free}</p>
            <p className="text-3xl font-bold text-green-600">{freeCount}</p>
          </Card>
          <Card className="p-6">
            <p className="text-sm text-muted-foreground mb-1">{t.occupied}</p>
            <p className="text-3xl font-bold text-red-600">{occupiedCount}</p>
          </Card>
          <Card className="p-6">
            <p className="text-sm text-muted-foreground mb-1">{t.reserved}</p>
            <p className="text-3xl font-bold text-blue-600">{reservedCount}</p>
          </Card>
        </div>

        {/* Legend */}
        <Card className="p-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-green-600" />
              <span className="text-sm">{t.free}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-red-600" />
              <span className="text-sm">{t.occupied}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-blue-600" />
              <span className="text-sm">{t.reserved}</span>
            </div>
          </div>
        </Card>

        {/* Table Layout */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold">{t.table_layout}</h2>
            <Button variant="outline" size="sm">
              <Plus className="w-4 h-4 mr-2" />
              {t.add_table}
            </Button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {tables.map((table) => (
              <Card
                key={table.id}
                className={`p-6 cursor-pointer hover:shadow-lg transition-all border-2 ${getStatusColor(table.status)}`}
              >
                <div className="text-center space-y-3">
                  <div className="flex items-center justify-center gap-2">
                    <h3 className="text-2xl font-bold">{table.number}</h3>
                    {getStatusBadge(table.status)}
                  </div>

                  <div className="flex items-center justify-center gap-1 text-muted-foreground">
                    <Users className="w-4 h-4" />
                    <span className="text-sm">{table.seats} {t.seats}</span>
                  </div>

                  {table.status === "occupied" && table.currentOrder && (
                    <div className="space-y-1">
                      <p className="text-sm font-semibold">{table.currentOrder}</p>
                      <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        <span>{table.duration}</span>
                      </div>
                    </div>
                  )}

                  {table.status === "reserved" && <p className="text-xs text-muted-foreground">{table.duration}</p>}

                  {table.status === "occupied" && (
                    <Button size="sm" className="w-full bg-transparent" variant="outline">
                      {t.view_order}
                    </Button>
                  )}

                  {table.status === "free" && (
                    <Button size="sm" className="w-full bg-amber-600 hover:bg-amber-700">
                      {t.start_order}
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
