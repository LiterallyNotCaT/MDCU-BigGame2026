import Link from 'next/link'
import { ArrowRight, BarChart3, ClipboardList, Gavel, ShieldCheck, Trophy } from 'lucide-react'
import ContactFooter from '@/components/ContactFooter'

const pages = [
  {
    id: 'bidding',
    href: '/bidding',
    title: 'Bidding',
    icon: Gavel,
    accent: '#38bdf8',
  },
  {
    id: 'morning',
    href: '/scoreboard-morning',
    title: 'Morning Scoreboard',
    icon: Trophy,
    accent: '#f59e0b',
  },
  {
    id: 'ambassador',
    href: '/scoreboard-ambassador',
    title: 'Ambassador View',
    icon: BarChart3,
    accent: '#10b981',
  },
  {
    id: 'afternoon',
    href: '/scoreboard-afternoon',
    title: 'Afternoon Scoreboard',
    icon: Trophy,
    accent: '#06b6d4',
  },
  {
    id: 'form',
    href: '/form',
    title: 'Form',
    icon: ClipboardList,
    accent: '#8b5cf6',
  },
  {
    id: 'admin',
    href: '/admin',
    title: 'Admin Panel',
    icon: ShieldCheck,
    accent: '#60a5fa',
  },
]

export default function HomePage() {
  return (
    <main className="wire-page min-h-screen">
      <header className="wire-topbar">
        <div className="wire-title">BigGame 2026</div>
        <div className="wire-time">Main Page</div>
      </header>

      <section className="wire-content main-nav-content">
        <div className="mx-auto max-w-5xl">
          <div className="main-nav-grid grid grid-cols-1 justify-items-center gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {pages.map(page => {
              const Icon = page.icon
              return (
                <Link
                  key={page.id}
                  href={page.href}
                  className="content-card group flex min-h-32 w-full max-w-[410px] flex-col justify-between transition-all duration-200 hover:-translate-y-1 hover:border-blue-300"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div
                      className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-slate-50"
                      style={{ color: page.accent }}
                    >
                      <Icon size={20} />
                    </div>
                    <ArrowRight size={18} className="text-slate-400 transition-colors group-hover:text-blue-600" />
                  </div>
                  <div className="mt-6">
                    <h2 className="font-display text-xl font-bold text-slate-900">{page.title}</h2>
                  </div>
                </Link>
              )
            })}
          </div>
          <ContactFooter className="page-contact-footer" />
        </div>
      </section>
    </main>
  )
}
