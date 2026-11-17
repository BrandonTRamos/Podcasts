import { Amplify } from 'aws-amplify'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { amplifyServices } from './amplifyServices'
import { App } from './App'
import { browserDevice } from './device'
import { browserMediaSession, claimPlaybackAudioSession } from './mediaSession'
import { recordPlayback } from './playbackLog'
import { dismissSplash } from './splash'
import './index.css'

// Written by `npx ampx sandbox` (or the hosting build). Loaded with a glob so the
// app still typechecks and builds when the file is absent.
const outputs = Object.values(
  import.meta.glob<{ default: Parameters<typeof Amplify.configure>[0] }>('../amplify_outputs.json', {
    eager: true,
  }),
)[0]?.default

const root = createRoot(document.getElementById('root')!)

// Keeps the app shell on the device, so TinCan opens with no network (see appShell.ts).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Without it the app still works online; it just can't open offline.
    })
  })
}

if (outputs) {
  Amplify.configure(outputs)
  claimPlaybackAudioSession()
  const audio = new Audio()
  const device = browserDevice()
  recordPlayback(device.playbackLog, audio)
  root.render(
    <StrictMode>
      <App
        services={{
          ...amplifyServices(),
          audio,
          mediaSession: browserMediaSession(device.playbackLog),
          device,
        }}
      />
    </StrictMode>,
  )
} else {
  dismissSplash()
  root.render(<p>amplify_outputs.json is missing. Start the sandbox with <code>npx ampx sandbox</code>.</p>)
}
