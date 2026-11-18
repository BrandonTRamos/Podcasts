import { useState } from 'react'
import { SettingsIcon } from './Icons'
import type { PlaybackLog } from './services'
import { type Theme, THEMES } from './theme'

const themeLabels: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' }

/** Floats at the top of every screen but now playing, as the tabs do at the foot, and leads to settings in one tap. */
export function SettingsPill({ current, onOpen }: { current: boolean; onOpen: () => void }) {
  return (
    <div className="top-bars">
      <button type="button" className="settings-pill" aria-current={current ? 'page' : undefined} onClick={onOpen}>
        <SettingsIcon size={18} />
        Settings
      </button>
    </div>
  )
}

/** How the app behaves on this device. Each setting is a section of its own. */
export function SettingsScreen({
  theme,
  onChooseTheme,
  playbackLog,
}: {
  theme: Theme
  onChooseTheme: (theme: Theme) => void
  playbackLog: PlaybackLog
}) {
  return (
    <main className="settings">
      <div className="tray">
        <h1>Settings</h1>
      </div>
      <section className="tray" aria-labelledby="settings-appearance">
        <h2 id="settings-appearance">Appearance</h2>
        <fieldset className="segmented">
          <legend className="visually-hidden">Theme</legend>
          {THEMES.map((each) => (
            <label key={each}>
              <input
                type="radio"
                name="theme"
                value={each}
                checked={each === theme}
                onChange={() => onChooseTheme(each)}
              />
              {themeLabels[each]}
            </label>
          ))}
        </fieldset>
        <p className="settings-hint">System follows this device’s light or dark appearance.</p>
      </section>
      <CopyPlaybackLog log={playbackLog} />
    </main>
  )
}

/** Hands over the playback log: copied, or shown to be copied by hand where the browser won't copy. */
function CopyPlaybackLog({ log }: { log: PlaybackLog }) {
  const [outcome, setOutcome] = useState<{ copied: number } | { uncopied: string } | null>(null)

  async function copy() {
    const lines = log.lines()
    const text = lines.join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setOutcome({ copied: lines.length })
    } catch {
      setOutcome({ uncopied: text })
    }
  }

  return (
    <section className="tray" aria-labelledby="settings-playback-log">
      <h2 id="settings-playback-log">Playback log</h2>
      <button type="button" className="outline" onClick={() => void copy()}>
        Copy playback log
      </button>
      <p className="settings-hint" role="status">
        {outcome && 'copied' in outcome
          ? `Copied ${outcome.copied} ${outcome.copied === 1 ? 'line' : 'lines'}.`
          : 'What playback did lately on this device, for working out why it went wrong. Copy it soon after it does.'}
      </p>
      {outcome && 'uncopied' in outcome && (
        <textarea className="playback-log" aria-label="Playback log" readOnly rows={8} value={outcome.uncopied} />
      )}
    </section>
  )
}
