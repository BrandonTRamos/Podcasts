import { SettingsIcon } from './Icons'
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
export function SettingsScreen({ theme, onChooseTheme }: { theme: Theme; onChooseTheme: (theme: Theme) => void }) {
  return (
    <main className="settings">
      <h1>Settings</h1>
      <section aria-labelledby="settings-appearance">
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
    </main>
  )
}
