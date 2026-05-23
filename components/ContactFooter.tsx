'use client'

import { ADMIN_CONTACT_EMAILS } from '@/lib/contacts'

function openEmail(email: string) {
  const subject = 'BigGame login problem'
  const body = ''
  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  const mailtoUrl = `mailto:${email}?subject=${encodeURIComponent(subject)}`
  const opened = window.open(gmailUrl, '_blank', 'noopener,noreferrer')
  if (!opened) window.location.href = mailtoUrl
}

export default function ContactFooter({ className }: { className: string }) {
  return (
    <footer className={className}>
      <span>Login problem contact:</span>
      {ADMIN_CONTACT_EMAILS.map(email => (
        <button key={email} type="button" onClick={() => openEmail(email)} className="contact-email-button">
          {email}
        </button>
      ))}
    </footer>
  )
}
