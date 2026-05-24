import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'BIGGAME 2026', template: '%s · BIGGAME' },
  description: 'BigGame Activity Platform — Investment & Strategy Game',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#07090f',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className="dark">
      <body className="noise-overlay bg-grid antialiased min-h-screen bg-[#07090f] text-slate-200 font-body">
        <div className="relative z-10 min-h-screen">
          {children}
        </div>
      </body>
    </html>
  )
}
