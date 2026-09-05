"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Header } from "@/components/header"
import { Users as UsersIcon, BadgeCheck } from "lucide-react"
import { CustomersTab } from "./customers-tab"
import { StaffTab } from "./staff-tab"
import { useState, useEffect } from "react"
import { useTranslation } from "@/hooks/use-translation"
import { canManageStaff } from "@/lib/roles"

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

  // The staff tab used to hide only from STAFF, which let a manager open a
  // list the API would not serve them: empty screen, failing saves. It is now
  // the same question on both sides.
  const canManage = canManageStaff(user?.role)
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
            {canManage && (
              <TabsTrigger value="staff" className="font-bold">
                <BadgeCheck className="w-4 h-4 mr-2" />
                {t.staff || "Staff"}
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="customers">
            <CustomersTab />
          </TabsContent>
          {canManage && (
            <TabsContent value="staff">
              <StaffTab actorRole={user?.role} />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  )
}
