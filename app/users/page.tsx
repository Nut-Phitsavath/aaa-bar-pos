"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Header } from "@/components/header"
import { Users as UsersIcon, BadgeCheck } from "lucide-react"
import { CustomersTab } from "./customers-tab"
import { StaffTab } from "./staff-tab"
import { useState, useEffect } from "react"
import { useTranslation } from "@/hooks/use-translation"

export default function UsersPage() {
  const [user, setUser] = useState<any>(null)
  const { t } = useTranslation()

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        if (data.user) setUser(data.user)
      })
      .catch(() => { })
  }, [])

  const isStaff = user?.role === 'STAFF'
  return (
    <div className="min-h-screen bg-background">
      <Header title={t.users_management} />

      <div className="p-6">
        <Tabs defaultValue="customers" className="w-full">
          <TabsList className="grid w-full grid-cols-2 lg:w-[400px] mb-6">
            <TabsTrigger value="customers" className="font-bold">
              <UsersIcon className="w-4 h-4 mr-2" />
              {t.customers}
            </TabsTrigger>
            {!isStaff && (
              <TabsTrigger value="staff" className="font-bold">
                <BadgeCheck className="w-4 h-4 mr-2" />
                {t.staff || "Staff"}
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="customers">
            <CustomersTab />
          </TabsContent>
          {!isStaff && (
            <TabsContent value="staff">
              <StaffTab />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  )
}
