import { redirect } from 'next/navigation'
import { auth, isAllowedDocChulaEmail } from '@/auth'
import FormClient from './FormClient'

export default async function FormPage() {
  const session = await auth()
  const email = session?.user?.email ?? ''

  if (!session?.user) redirect('/form/login')
  if (!isAllowedDocChulaEmail(email)) redirect('/form/login-failed')

  return <FormClient oauthEmail={email} />
}
