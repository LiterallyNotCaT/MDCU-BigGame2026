import { redirect } from 'next/navigation'
import { Lock } from 'lucide-react'
import HomeButton from '@/components/HomeButton'
import { auth, signIn } from '@/auth'

function GoogleLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="google-logo" style={{ width: 20, height: 20, flex: '0 0 auto' }}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  )
}

export default async function FormLoginPage() {
  const session = await auth()
  if (session?.user?.email) redirect('/form')

  return (
    <div className="auth-page min-h-screen app-shell flex items-center justify-center px-4 py-6">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute left-1/2 top-1/3 h-96 w-96 -translate-x-1/2 rounded-full bg-blue-500/10 blur-[100px]" />
      </div>

      <div
        className="auth-card relative z-10 w-full"
        style={{
          maxWidth: 'min(94vw, 28.5rem)',
          border: '1px solid rgba(148,163,184,0.28)',
          borderRadius: 20,
          background: 'rgba(255,255,255,0.96)',
          padding: 'clamp(24px, 4vw, 34px)',
          boxShadow: '0 22px 64px rgba(30,41,59,0.16)',
          color: '#172033',
        }}
      >
        <div
          className="auth-icon mx-auto flex items-center justify-center rounded-2xl border bg-white"
          style={{
            width: 56,
            height: 56,
            margin: '0 auto 18px',
            borderColor: 'rgba(37,99,235,0.25)',
            color: '#2563eb',
            boxShadow: '0 14px 34px rgba(37,99,235,0.16)',
          }}
        >
          <Lock size={22} />
        </div>

        <div className="auth-heading text-center">
          <h1 className="font-display font-black text-slate-950">Form</h1>
          <p className="font-semibold text-slate-500">Sign in with your docchula.com account</p>
        </div>

        <form
          action={async () => {
            'use server'
            await signIn('google', { redirectTo: '/form' })
          }}
          className="auth-form"
        >
          <button
            type="submit"
            className="btn google-auth-button w-full"
            style={{
              justifyContent: 'center',
              border: '1px solid #cbd8ea',
              background: '#fff',
              color: '#172033',
              boxShadow: '0 12px 26px rgba(15,23,42,0.08)',
            }}
          >
            <GoogleLogo />
            <span>Sign in with Docchula</span>
          </button>
        </form>

        <div className="auth-home">
          <HomeButton />
        </div>
      </div>
    </div>
  )
}
