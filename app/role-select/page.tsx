"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Coffee, DollarSign, Settings } from "lucide-react"
import Link from "next/link"
import { useTranslation } from "@/hooks/use-translation"

export default function RoleSelectPage() {
  const { t } = useTranslation()
  const roles = [
    {
      title: "Admin",
      description: t.full_access_to_all_features,
      icon: Settings,
      color: "bg-purple-500 hover:bg-purple-600",
      role: "ADMIN",
    },
    {
      title: "Cashier",
      description: t.take_orders_and_process_payments,
      icon: DollarSign,
      color: "bg-blue-500 hover:bg-blue-600",
      role: "CASHIER",
    },
    // {
    //   title: "Barista",
    //   description: "View and prepare orders",
    //   icon: Coffee,
    //   color: "bg-amber-500 hover:bg-amber-600",
    //   role: "KITCHEN",
    // },
  ]

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 to-orange-100 p-4">
      <div className="w-full max-w-4xl">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-amber-900 mb-2">{t.select_your_role}</h1>
          <p className="text-muted-foreground">{t.choose_how_you_want_to_access_the_system}</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {roles.map((role) => {
            const Icon = role.icon
            return (
              <Link key={role.title} href={`/pin-login?role=${role.role}`}>
                <Card className="p-6 hover:shadow-xl transition-shadow cursor-pointer h-full">
                  <div className="flex flex-col items-center text-center space-y-4 h-full justify-between">
                    <div className="flex flex-col items-center space-y-4">
                      <div className={`${role.color} w-16 h-16 rounded-full flex items-center justify-center text-white`}>
                        <Icon className="w-8 h-8" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold mb-2">{role.title}</h3>
                        <p className="text-sm text-muted-foreground">{role.description}</p>
                      </div>
                    </div>
                    <Button className={`w-full ${role.color} text-white`}>{t.continue_as} {role.title}</Button>
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
