import type { Metadata } from 'next'
import { Geist, Geist_Mono, Noto_Sans_Lao } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'
import { ShiftProvider } from '@/components/shift-provider'
import { ClientLayout } from '@/components/client-layout'
import { SidebarProvider } from '@/components/sidebar-provider'
import { LanguageProvider } from '@/components/language-provider'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

const notoLaos = Noto_Sans_Lao({
  subsets: ["lao"],
  weight: ["400", "700"],
  variable: '--font-laos',
  display: 'swap',

});

export const metadata: Metadata = {
  title: 'Memories Lane Cafe',
  description: 'Memories Lane Cafe POS System',
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
      <body className={notoLaos.className}>
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
