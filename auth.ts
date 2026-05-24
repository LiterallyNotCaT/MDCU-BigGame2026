import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'

const ALLOWED_EMAIL_DOMAIN = '@docchula.com'

function isAllowedDocChulaEmail(email?: string | null) {
  return String(email || '').trim().toLowerCase().endsWith(ALLOWED_EMAIL_DOMAIN)
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      authorization: {
        params: {
          hd: 'docchula.com',
          prompt: 'select_account',
        },
      },
    }),
  ],
  pages: {
    signIn: '/form/login',
    error: '/form/login-failed',
  },
  callbacks: {
    async signIn({ profile }) {
      const email = typeof profile?.email === 'string' ? profile.email : ''
      const emailVerified = profile?.email_verified !== false
      return emailVerified && isAllowedDocChulaEmail(email)
    },
  },
})

export { isAllowedDocChulaEmail }
