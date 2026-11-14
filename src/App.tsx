import { useEffect, useState } from 'react'
import type { Services, User } from './services'
import { SignedInApp } from './SignedInApp'
import { SignInScreen } from './SignInScreen'

type Session = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; user: User }

export function App({ services }: { services: Services }) {
  const [session, setSession] = useState<Session>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    services.auth
      .currentUser()
      .catch(() => null)
      .then((user) => {
        if (!cancelled) setSession(user ? { status: 'signedIn', user } : { status: 'signedOut' })
      })
    return () => {
      cancelled = true
    }
  }, [services.auth])

  if (session.status === 'loading') return <p>Loading…</p>

  if (session.status === 'signedOut') {
    return (
      <SignInScreen
        signIn={services.auth.signIn}
        onSignedIn={(user) => setSession({ status: 'signedIn', user })}
      />
    )
  }

  return (
    <SignedInApp
      data={services.data}
      audio={services.audio}
      mediaSession={services.mediaSession}
      onSignOut={async () => {
        try {
          await services.auth.signOut()
        } finally {
          setSession({ status: 'signedOut' })
        }
      }}
    />
  )
}
