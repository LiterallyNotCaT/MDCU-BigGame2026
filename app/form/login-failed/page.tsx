import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import HomeButton from '@/components/HomeButton'

export default function FormLoginFailedPage() {
  return (
    <div className="auth-page min-h-screen app-shell flex items-center justify-center px-4 py-6">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute left-1/2 top-1/3 h-96 w-96 -translate-x-1/2 rounded-full bg-red-500/10 blur-[100px]" />
      </div>

      <div
        className="auth-card relative z-10 w-full"
        style={{
          maxWidth: 'min(94vw, 28.5rem)',
          border: '1px solid rgba(239,68,68,0.42)',
          borderRadius: 20,
          background: 'rgba(255,255,255,0.96)',
          padding: 'clamp(24px, 4vw, 34px)',
          boxShadow: '0 22px 64px rgba(30,41,59,0.16)',
          color: '#172033',
        }}
      >
        <div
          className="auth-icon mx-auto flex items-center justify-center rounded-2xl border bg-white form-login-failed-icon"
          style={{
            width: 56,
            height: 56,
            margin: '0 auto 18px',
            borderColor: 'rgba(239,68,68,0.28)',
            color: '#dc2626',
            boxShadow: '0 14px 34px rgba(239,68,68,0.18)',
          }}
        >
          <AlertTriangle size={22} />
        </div>

        <div className="auth-heading text-center">
          <h1 className="font-display font-black text-slate-950">Login Failed</h1>
          <p className="font-semibold text-slate-500">
            Please use a verified Google account ending with @docchula.com.
          </p>
        </div>

        <div className="auth-form">
          <Link href="/form/login" className="btn btn-primary auth-submit w-full">
            Back to login
          </Link>
        </div>

        <div className="auth-home">
          <HomeButton />
        </div>
      </div>
    </div>
  )
}
