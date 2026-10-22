"use client"

import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Store, Receipt, DollarSign, Languages, AlertTriangle, Trash2, Bold, Banknote, QrCode } from "lucide-react"
import { BILL_QR_MODES, billQrMode } from "@/lib/bank-qr"
import { Switch } from "@/components/ui/switch"
import { useTranslation } from "@/hooks/use-translation"
import { APP_NAME } from "@/lib/shop"
import { notify } from "@/components/ui/sonner"
import { useConfirm } from "@/components/confirm-provider"
import { useLanguage } from "@/components/language-provider"
import { Header } from "@/components/header"
import { SETTINGS_SAVED } from "@/components/brand"

export default function SettingsPage() {
  const [user, setUser] = useState<any>(null)
  const [settings, setSettings] = useState<any>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  // Whether the server holds a OnePay account; OnePay for bills is offered only then.
  const [onepayReady, setOnepayReady] = useState(false)
  const { t } = useTranslation()
  const confirm = useConfirm()
  const { setLang } = useLanguage()

  useEffect(() => {
    document.title = `${t.shop_settings || "Settings"} | ${APP_NAME}`
    fetchData()
  }, [t.shop_settings])

  const fetchData = async () => {
    try {
      const [uRes, sRes, oRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch('/api/settings'),
        fetch('/api/payments/onepay/configured'),
      ])
      if (uRes.ok) setUser((await uRes.json()).user)
      if (oRes.ok) setOnepayReady(Boolean((await oRes.json()).configured))
      if (sRes.ok) {
        const data = await sRes.json()
        setSettings({
          ...data,
          taxRate: data.taxRate || data.tax_rate || "",
          loyaltyRate: data.loyaltyRate || data.loyalty_rate || "",
          shopName: data.shopName || data.shop_name || "",
          rate_lak: data.rate_lak || "",
        })
      }
    } catch (e) {
      console.error(e)
    } finally {
      setIsLoading(false)
    }
  }

  const applyLanguage = async (language: "en" | "lo") => {
    setSettings((prev: any) => ({ ...prev, language }))
    setLang(language)
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language })
      })
    } catch (e) {
      console.error(e)
    }
  }

  const handleSaveSettings = async () => {
    setIsSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      })
      if (res.ok) {
        if (settings.language === 'lo' || settings.language === 'en') {
          setLang(settings.language)
        }
        notify.success(t.settings_saved)
        // The sidebar shows the shop's name and logo; tell it they may have changed.
        window.dispatchEvent(new Event(SETTINGS_SAVED))
      } else {
        notify.error(t.settings_save_failed)
      }
    } catch (e) {
      notify.error(t.settings_save_failed)
    } finally {
      setIsSaving(false)
    }
  }

  const handleWipeData = async () => {
    if (!(await confirm({ title: t.wipe_all_transaction_data, description: t.wipe_confirm, confirmLabel: t.wipe_now, destructive: true }))) return

    setIsSaving(true)
    try {
      const res = await fetch('/api/admin/wipe', { method: 'POST' })
      if (res.ok) {
        notify.success(t.wipe_success)
        window.location.reload()
      } else {
        notify.error(t.wipe_failed)
      }
    } catch (e) {
      notify.error(t.wipe_error)
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) return <div className="p-10 text-center">{t.loading_setting}</div>


  return (
    <div className="min-h-screen bg-background text-slate-900">
      {/* Header */}
      <Header title={t.shop_settings} />
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        {/* Language Selection */}
        <Card className="p-6 border-amber-100 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-blue-100 p-3 rounded-lg">
              <Languages className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold">{t.language} / ພາສາ</h2>
              <p className="text-sm text-muted-foreground">{t.select_preferred_language}</p>
            </div>
          </div>
          <div className="flex gap-4">
            <Button
              variant={settings.language === 'en' ? 'default' : 'outline'}
              onClick={() => applyLanguage('en')}
              className={settings.language === 'en' ? 'bg-amber-600' : ''}
            >
              English
            </Button>
            <Button
              variant={settings.language === 'lo' ? 'default' : 'outline'}
              onClick={() => applyLanguage('lo')}
              className={settings.language === 'lo' ? 'bg-amber-600' : ''}
            >
              ພາສາລາວ
            </Button>
          </div>
        </Card>

        {/* Shop Information */}
        <Card className="p-6 border-amber-100 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-amber-100 p-3 rounded-lg">
              <Store className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold">{t.shop_info}</h2>
              <p className="text-sm text-muted-foreground">{t.basic_cafe_details}</p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t.shop_name}</Label>
                <Input
                  value={settings.shopName || ""}
                  onChange={(e) => setSettings({ ...settings, shopName: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t.logo_upload}</Label>
                <div className="flex gap-3 items-center">
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) {
                        const reader = new FileReader()
                        reader.onloadend = () => {
                          setSettings({ ...settings, shopLogo: reader.result as string })
                        }
                        reader.readAsDataURL(file)
                      }
                    }}
                  />
                  {settings.shopLogo && (
                    <img src={settings.shopLogo} alt="Logo" className="h-10 w-10 object-contain border rounded" />
                  )}
                </div>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t.phone_number}</Label>
                <Input
                  value={settings.shopPhone || ""}
                  onChange={(e) => setSettings({ ...settings, shopPhone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t.address}</Label>
                <Input
                  value={settings.address || ""}
                  onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2 pt-2 border-t mt-2">
              <Label>{t.store_transfer_qr}</Label>
              <div className="flex gap-3 items-center">
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) {
                      const reader = new FileReader()
                      reader.onloadend = () => {
                        setSettings({ ...settings, transfer_qr_url: reader.result as string })
                      }
                      reader.readAsDataURL(file)
                    }
                  }}
                />
                {settings.transfer_qr_url && (
                  <img src={settings.transfer_qr_url} alt="Transfer QR" className="h-10 w-10 object-contain border rounded" />
                )}
              </div>
              <p className="text-xs text-muted-foreground">{t.transfer_qr_hint}</p>
            </div>
          </div>
        </Card>

        {/* Receipt Customization */}
        <Card className="p-6 border-amber-100 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-orange-100 p-3 rounded-lg">
              <Receipt className="w-6 h-6 text-orange-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold">{t.receipt_customization}</h2>
              <p className="text-sm text-muted-foreground">{t.receipt_customization_desc}</p>
            </div>
          </div>

          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="receipt-footer">{t.receipt_footer_message}</Label>
              {/* Several lines: a bar here thanks people in Lao and English. */}
              <Textarea
                id="receipt-footer"
                rows={3}
                placeholder={t.thank_you}
                value={settings.receiptFooter || ""}
                onChange={(e) => setSettings({ ...settings, receiptFooter: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">{t.receipt_footer_hint}</p>
            </div>

            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
              <div className="flex items-center gap-3">
                <div className="bg-slate-200 p-2 rounded-lg">
                  <Bold className="w-5 h-5 text-slate-700" />
                </div>
                <div>
                  <p className="font-bold">{t.bold_thermal_text}</p>
                  <p className="text-xs text-muted-foreground">{t.bold_thermal_text_desc}</p>
                </div>
              </div>
              <Switch
                checked={settings.boldReceipt === 'true'}
                onCheckedChange={(checked) => setSettings({ ...settings, boldReceipt: checked ? 'true' : 'false' })}
              />
            </div>

            {/* Which QR a bill carries - see lib/bank-qr. A shop setting, saved
                with Save: both counters pay into the same account. */}
            {(() => {
              const mode = billQrMode(settings.bill_qr_mode, Boolean(settings.transfer_qr_url))
              const label = { OFF: t.bill_qr_off, BANK: t.bill_qr_bank, ONEPAY: t.bill_qr_onepay }
              return (
                <div className="space-y-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className="bg-slate-200 p-2 rounded-lg">
                      <QrCode className="w-5 h-5 text-slate-700" />
                    </div>
                    <div>
                      <p className="font-bold">{t.bill_qr}</p>
                      <p className="text-xs text-muted-foreground">{t.bill_qr_desc}</p>
                    </div>
                  </div>
                  <div role="radiogroup" aria-label={t.bill_qr} className="flex flex-wrap gap-2">
                    {BILL_QR_MODES.map((option) => (
                      <Button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={mode === option}
                        variant={mode === option ? "default" : "outline"}
                        className="h-11 min-w-24"
                        disabled={option === "ONEPAY" && !onepayReady && mode !== "ONEPAY"}
                        onClick={() => setSettings({ ...settings, bill_qr_mode: option })}
                      >
                        {label[option]}
                      </Button>
                    ))}
                  </div>
                  {mode === "BANK" && !settings.transfer_qr_url && (
                    <p className="text-xs text-amber-700">{t.bill_qr_needs_upload}</p>
                  )}
                  {!onepayReady && <p className="text-xs text-muted-foreground">{t.bill_qr_onepay_not_set_up}</p>}
                  {mode === "ONEPAY" && (
                    <div className="flex items-center justify-between gap-3 pt-1">
                      <Label htmlFor="bill-qr-fallback" className="text-sm font-normal">{t.bill_qr_fallback}</Label>
                      <Switch
                        id="bill-qr-fallback"
                        checked={settings.bill_qr_fallback !== "false"}
                        onCheckedChange={(checked) => setSettings({ ...settings, bill_qr_fallback: checked ? "true" : "false" })}
                      />
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Where a sent round's dockets go. Blank = that station has no
                printer yet, and nothing is attempted. */}
            <div className="space-y-3 pt-2">
              <Label>{t.docket_printers}</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground">{t.station_bar}</p>
                  <Input
                    inputMode="url"
                    placeholder={t.printer_bar_hint}
                    value={settings.printer_bar || ""}
                    onChange={(e) => setSettings({ ...settings, printer_bar: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground">{t.station_kitchen}</p>
                  <Input
                    inputMode="url"
                    placeholder={t.printer_kitchen_hint}
                    value={settings.printer_kitchen || ""}
                    onChange={(e) => setSettings({ ...settings, printer_kitchen: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Tax & Pricing */}
        <Card className="p-6 border-amber-100 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-green-100 p-3 rounded-lg">
              <DollarSign className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold">{t.tax_and_pricing}</h2>
              <p className="text-sm text-muted-foreground">{t.tax_pricing_desc}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t.tax_rate}</Label>
              <Input
                type="number"
                value={settings.taxRate || ""}
                onChange={(e) => setSettings({ ...settings, taxRate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t.loyalty_rate_label}</Label>
              <Input
                type="number"
                value={settings.loyaltyRate || ""}
                onChange={(e) => setSettings({ ...settings, loyaltyRate: e.target.value })}
              />
            </div>
          </div>

          {/* Exchange rates. Prices are held in baht; these only drive the
              converted figures shown on a bill. Changing them never touches a
              bill that has already been settled - each one stores the rate it
              was closed at. */}
          <div className="mt-6 pt-5 border-t">
            <h3 className="font-semibold text-slate-900">{t.exchange_rates}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">{t.exchange_rates_desc}</p>

            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="space-y-2">
                <Label>{t.rate_lak_label}</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder="680"
                  value={settings.rate_lak || ""}
                  onChange={(e) => setSettings({ ...settings, rate_lak: e.target.value })}
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Save Global Settings */}
        <div className="flex justify-end">
          <Button
            className="bg-amber-600 hover:bg-amber-700 h-12 px-8 text-lg"
            onClick={handleSaveSettings}
            disabled={isSaving}
          >
            {isSaving ? t.saving : t.save_global_settings}
          </Button>
        </div>

        {/* Danger Zone */}
        {user?.role === 'ADMIN' && (
          <Card className="p-6 border-red-500/30 bg-red-50/20 shadow-sm mt-12">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-red-500 p-2 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-red-700">{t.danger_zone}</h2>
                <p className="text-sm text-red-600/60">{t.danger_zone_desc}</p>
              </div>
            </div>

            <div className="flex flex-col md:flex-row items-center justify-between p-4 border border-red-200 rounded-xl bg-white gap-4">
              <div>
                <p className="font-bold text-slate-900">{t.wipe_all_transaction_data}</p>
                <p className="text-sm text-slate-500">{t.wipe_all_transaction_data_desc}</p>
              </div>
              <Button
                variant="destructive"
                className="flex items-center gap-2 px-6"
                onClick={handleWipeData}
                disabled={isSaving}
              >
                <Trash2 className="w-4 h-4" />
                {t.wipe_now}
              </Button>
            </div>
          </Card>
        )}
      </div >
    </div >
  )
}
