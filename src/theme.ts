import { useCallback, useLayoutEffect, useState } from 'react'
import type { DeviceStorage } from './services'

/** How the app looks: as the device does, or always light or dark. */
export type Theme = 'system' | 'light' | 'dark'

export const THEMES: readonly Theme[] = ['system', 'light', 'dark']

/** Where this device keeps the theme chosen on it. It outlasts signing out, being the device's and not the library's. */
export const THEME_KEY = 'theme'

/** The theme chosen on this device, or following the device if none is, or what is kept is not one. */
export function storedTheme(storage: DeviceStorage): Theme {
  const stored = storage.get(THEME_KEY)
  return THEMES.find((theme) => theme === stored) ?? 'system'
}

/** Gives the page the theme: the stylesheet reads `data-theme` on the root, and with none follows the device. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
}

/** The theme chosen on this device, and a way to choose another, which the page takes at once and the device keeps. */
export function useTheme(storage: DeviceStorage): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState(() => storedTheme(storage))
  useLayoutEffect(() => applyTheme(theme), [theme])
  const choose = useCallback(
    (next: Theme) => {
      try {
        if (next === 'system') storage.remove(THEME_KEY)
        else storage.set(THEME_KEY, next)
      } catch {
        // Storage is unavailable: the theme holds until the app closes.
      }
      setTheme(next)
    },
    [storage],
  )
  return [theme, choose]
}
