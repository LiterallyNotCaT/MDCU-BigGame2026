import { redirect } from 'next/navigation'
import { Lock } from 'lucide-react'
import HomeButton from '@/components/HomeButton'
import { auth, signIn } from '@/auth'

function GoogleLogo() {
  return (
    <img
      src="https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/google/default.svg"
      alt="Google"
      className="google-logo"
      style={{ width: 20, height: 20, flex: '0 0 auto' }}
    />
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
