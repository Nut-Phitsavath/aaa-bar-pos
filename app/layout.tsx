import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'
import { ShiftProvider } from '@/components/shift-provider'
import { ClientLayout } from '@/components/client-layout'
import { SidebarProvider } from '@/components/sidebar-provider'
import { LanguageProvider } from '@/components/language-provider'

// Kept in the repo (app/fonts, SIL Open Font License) rather than fetched from
// Google at build time: Turbopack failed the whole build whenever Google
// answered with its newer /l/font?kit=... URLs (vercel/next.js#99114), and a
// bar's internet is not something a build should depend on. One variable file
// covers every weight the app uses. The two Geist fonts loaded here before
// were never applied to anything and went with it.
const notoLaos = localFont({
  src: './fonts/NotoSansLao-Variable.ttf',
  weight: '100 900',
  variable: '--font-laos',
  display: 'swap',
});

// The bar's name in the sidebar and on the PIN screen - a classical capital
// serif, close to the lettering in AAA's logo. Kept in the repo like Noto
// (app/fonts, OFL), so the till needs no internet for it.
const cinzel = localFont({
  src: './fonts/Cinzel-Variable.ttf',
  weight: '400 900',
  variable: '--font-cinzel',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AAA',
  description: 'AAA bar POS',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/CAFE LOGO 32x32.png',
      },
    ],
    apple: '/apple-icon.png',
  },
}

import { headers } from 'next/headers'

// ... existing code ...

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const headerList = await headers()
  const host = headerList.get('host') || ''

  // Robust check: can be the specific domain or a local debug flag
  const isMonitor = host.toLowerCase().includes('monitor.sattavath.store') || host.toLowerCase().includes('monitor.localhost')

  return (
    <html lang="lo">
      <body className={`${notoLaos.className} ${cinzel.variable}`}>
        <LanguageProvider>
          <ShiftProvider>
            <SidebarProvider>
              <ClientLayout isMonitor={isMonitor}>
                {children}
              </ClientLayout>
            </SidebarProvider>
          </ShiftProvider>
        </LanguageProvider>
        <Analytics />
      </body>
    </html>
  )
}
