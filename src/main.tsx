import { Amplify } from 'aws-amplify'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { amplifyServices } from './amplifyServices'
import { App } from './App'
import './index.css'

// Written by `npx ampx sandbox` (or the hosting build). Loaded with a glob so the
// app still typechecks and builds when the file is absent.
const outputs = Object.values(
  import.meta.glob<{ default: Parameters<typeof Amplify.configure>[0] }>('../amplify_outputs.json', {
    eager: true,
  }),
)[0]?.default

const root = createRoot(document.getElementById('root')!)

if (outputs) {
  Amplify.configure(outputs)
  root.render(
    <StrictMode>
      <App services={{ ...amplifyServices(), audio: new Audio() }} />
    </StrictMode>,
  )
} else {
  root.render(<p>amplify_outputs.json is missing. Start the sandbox with <code>npx ampx sandbox</code>.</p>)
}
