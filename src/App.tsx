import { useEffect, useMemo, useState } from 'react'
import { isDownloadRecord } from './downloads'
import { forgetLibrary, withLocalCopy } from './localCopy'
import type { Services, StoredSession } from './services'
import { SignedInApp } from './SignedInApp'
import { SignInScreen } from './SignInScreen'
import { dismissSplash } from './splash'
import { THEME_KEY, useTheme } from './theme'

type Session =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn' }
  /**
   * Expired, with no network to renew it. The app opens on what this device
   * holds, as local playback never needs a session, and checks again once online.
   */
  | { status: 'unconfirmed' }
  /** Found expired for good once back online. The app stays open, asking the listener to sign in again. */
  | { status: 'expired' }

export function App({ services }: { services: Services }) {
  const { auth, device } = services
  const [session, setSession] = useState<Session>({ status: 'loading' })
  const [theme, chooseTheme] = useTheme(device.storage)
  const data = useMemo(() => withLocalCopy(services.data, device), [services.data, device])

  useEffect(() => {
    let cancelled = false
    auth
      .storedSession()
      .catch((): StoredSession => ({ status: 'signedOut' }))
      .then((stored) => {
        if (!cancelled) setSession({ status: stored.status })
      })
    return () => {
      cancelled = true
    }
  }, [auth])

  // Once the network is back, renew the session, or find it can't be. Also
  // on returning to the foreground, as the browser can think it online when
  // nothing is reachable (a captive network), and so never say it came back.
  useEffect(() => {
    if (session.status !== 'unconfirmed') return
    let cancelled = false
    const check = () => {
      if (!device.isOnline() || document.visibilityState === 'hidden') return
      auth
        .storedSession()
        .catch((): StoredSession => ({ status: 'unconfirmed' }))
        .then((stored) => {
          if (cancelled) return
          if (stored.status === 'signedIn') setSession({ status: 'signedIn' })
          else if (stored.status === 'signedOut') setSession({ status: 'expired' })
        })
    }
    const stop = device.watchConnectivity(check)
    document.addEventListener('visibilitychange', check)
    return () => {
      cancelled = true
      stop()
      document.removeEventListener('visibilitychange', check)
    }
  }, [session.status, auth, device])

  // The page's loading screen stays up until it is known which screen to open on.
  const loading = session.status === 'loading'
  useEffect(() => {
    if (!loading) dismissSplash()
  }, [loading])

  if (loading) return null

  if (session.status === 'signedOut') {
    return <SignInScreen signIn={auth.signIn} onSignedIn={() => setSession({ status: 'signedIn' })} />
  }

  return (
    <SignedInApp
      data={data}
      audio={services.audio}
      mediaSession={services.mediaSession}
      device={device}
      sessionExpired={session.status === 'expired'}
      onSignIn={() => setSession({ status: 'signedOut' })}
      theme={theme}
      onChooseTheme={chooseTheme}
      onSignOut={async () => {
        try {
          await auth.signOut()
        } finally {
          // Signing out removes access from this device: what it keeps of the
          // library goes too, with changes not yet synced. Downloads stay, as
          // their files do, and so do the records that name them, and the
          // theme, which is the device's own.
          forgetLibrary(device.storage, (key) => isDownloadRecord(key) || key === THEME_KEY)
          setSession({ status: 'signedOut' })
        }
      }}
    />
  )
}
