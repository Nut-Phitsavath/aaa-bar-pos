"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Plus, Search, Star, Eye } from "lucide-react"
import { formatTHB } from "@/lib/currency"
import { useTranslation } from "@/hooks/use-translation"
import { useDiscardGuard } from "@/components/confirm-provider"

type Customer = {
    id: string
    name: string
    phone: string | null
    email: string | null
    loyaltyPoints: number
    totalOrders: number
    totalSpent: number
    lastVisit: string
    dateOfBirth?: string | null
    createdAt: string
}

export function CustomersTab() {
    const { t } = useTranslation()
    const [searchQuery, setSearchQuery] = useState("")
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    // Overlay, Escape, × and Cancel all ask before throwing away typing.
    const { requestClose, markDirty } = useDiscardGuard(isDialogOpen, setIsDialogOpen)
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
    const [customers, setCustomers] = useState<Customer[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [user, setUser] = useState<any>(null)

    const [formData, setFormData] = useState({
        name: "",
        phone: "",
        email: "",
        dateOfBirth: ""
    })

    useEffect(() => {
        fetchCustomers()
        fetch('/api/auth/me')
            .then(res => res.json())
            .then(data => setUser(data.user))
            .catch(() => { })
    }, [])

    const fetchCustomers = async () => {
        try {
            const res = await fetch('/api/customers')
            if (res.ok) {
                const data = await res.json()
                setCustomers(data.map((c: any) => ({
                    ...c,
                    totalOrders: c.totalOrders || c.visitCount || 0,
                    totalSpent: c.totalSpent || 0,
                    lastVisit: c.lastVisit ? new Date(c.lastVisit).toLocaleDateString() : 'N/A'
                })))
            }
        } catch (e) { console.error(e) }
    }

    const handleSave = async () => {
        setIsLoading(true)
        try {
            const url = selectedCustomer ? `/api/customers/${selectedCustomer.id}` : '/api/customers'
            const method = selectedCustomer ? 'PUT' : 'POST'

            const res = await fetch(url, {
                method,
                body: JSON.stringify(formData),
                headers: { 'Content-Type': 'application/json' }
            })
            if (res.ok) {
                setIsDialogOpen(false)
                setSelectedCustomer(null)
                setFormData({ name: "", phone: "", email: "", dateOfBirth: "" })
                fetchCustomers()
            }
        } catch (e) { console.error(e) }
        finally { setIsLoading(false) }
    }

    const filteredCustomers = customers.filter(
        (customer) =>
            customer.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            customer.phone?.includes(searchQuery) ||
            customer.email?.toLowerCase().includes(searchQuery.toLowerCase()),
    )

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <Card className="p-6">
                    <p className="text-sm text-muted-foreground mb-1">{t.total_customers}</p>
                    <p className="text-3xl font-bold">{customers.length}</p>
                </Card>
                <Card className="p-6">
                    <p className="text-sm text-muted-foreground mb-1">{t.active_today}</p>
                    <p className="text-3xl font-bold text-green-600">
                        {customers.filter((c) => c.lastVisit === new Date().toLocaleDateString()).length}
                    </p>
                </Card>
                <Card className="p-6">
                    <p className="text-sm text-muted-foreground mb-1">{t.avg_loyalty_points}</p>
                    <p className="text-3xl font-bold text-amber-600">
                        {customers.length > 0 ? Math.round(customers.reduce((sum, c) => sum + c.loyaltyPoints, 0) / customers.length) : 0}
                    </p>
                </Card>
                <Card className="p-6">
                    <p className="text-sm text-muted-foreground mb-1">{t.total} {t.revenue}</p>
                    <p className="text-3xl font-bold text-purple-600">
                        {formatTHB(customers.reduce((sum, c) => sum + c.totalSpent, 0))}
                    </p>
                </Card>
            </div>

            <div className="flex gap-4">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                        placeholder={t.search_customers_placeholder}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10"
                    />
                </div>
                <Dialog open={isDialogOpen} onOpenChange={requestClose}>
                    <DialogTrigger asChild>
                        <Button className="bg-amber-600 hover:bg-amber-700 font-bold" onClick={() => {
                            setSelectedCustomer(null)
                            setFormData({ name: "", phone: "", email: "", dateOfBirth: "" })
                        }}>
                            <Plus className="w-4 h-4 mr-2" />
                            {t.add_customer}
                        </Button>
                    </DialogTrigger>
                    <DialogContent onInput={markDirty}>
                        <DialogHeader>
                            <DialogTitle>{selectedCustomer ? (user?.role === 'STAFF' ? t.customer_details : t.edit_customer_details) : t.add_new_customer}</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="customerName">{t.full_name}</Label>
                                <Input
                                    id="customerName"
                                    placeholder={t.name_placeholder}
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    disabled={user?.role === 'STAFF'}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="customerPhone">{t.phone_number}</Label>
                                <Input
                                    id="customerPhone"
                                    placeholder="+1 555-0100"
                                    value={formData.phone}
                                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                    disabled={user?.role === 'STAFF'}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="customerEmail">{t.email} ({t.optional})</Label>
                                <Input
                                    id="customerEmail"
                                    type="email"
                                    placeholder="john@example.com"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    disabled={user?.role === 'STAFF'}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="customerDob">{t.date_of_birth} ({t.optional})</Label>
                                <Input
                                    id="customerDob"
                                    type="date"
                                    value={formData.dateOfBirth}
                                    onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                                    disabled={user?.role === 'STAFF'}
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => requestClose(false)}>
                                {t.cancel}
                            </Button>
                            {(!selectedCustomer || user?.role !== 'STAFF') && (
                                <Button className="bg-amber-600 hover:bg-amber-700 font-bold" onClick={handleSave} disabled={isLoading}>
                                    {isLoading ? t.processing : t.save}
                                </Button>
                            )}
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <Card className="p-6">
                <h2 className="text-lg font-bold mb-4">{t.all_customers}</h2>
                <div className="space-y-3">
                    {filteredCustomers.length === 0 ? <p className="text-muted-foreground">{t.no_customers_found}</p> :
                        filteredCustomers.map((customer) => (
                            <div
                                key={customer.id}
                                className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                            >
                                <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-1">
                                        <h3 className="font-semibold">{customer.name}</h3>
                                        <Badge variant="secondary" className="bg-amber-100 text-amber-700">
                                            <Star className="w-3 h-3 mr-1" />
                                            {customer.loyaltyPoints} {t.pts}
                                        </Badge>
                                    </div>
                                    <div className="flex gap-4 text-sm text-muted-foreground">
                                        <span>{customer.phone || t.no_phone || "No Phone"}</span>
                                        <span>{customer.email || t.no_email || "No Email"}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-6">
                                    <div className="text-right">
                                        <p className="text-sm text-muted-foreground">{t.orders}</p>
                                        <p className="font-semibold">{customer.totalOrders}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm text-muted-foreground">{t.total} {t.checkout}</p>
                                        <p className="font-semibold text-green-600">{formatTHB(customer.totalSpent)}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm text-muted-foreground">{t.last_visit}</p>
                                        <p className="font-semibold">{customer.lastVisit}</p>
                                    </div>
                                    <Button variant="outline" size="icon" onClick={() => {
                                        setSelectedCustomer(customer);
                                        setFormData({
                                            name: customer.name,
                                            phone: customer.phone || "",
                                            email: customer.email || "",
                                            dateOfBirth: customer.dateOfBirth ? new Date(customer.dateOfBirth).toISOString().split('T')[0] : ""
                                        });
                                        setIsDialogOpen(true);
                                    }}>
                                        <Eye className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                </div>
            </Card>
        </div>
    )
}
