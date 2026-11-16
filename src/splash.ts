/** The least time the loading screen stays up, so its animation plays rather than flashes by. */
export const SPLASH_MIN_MS = 1000

/** How long the loading screen takes to fade, as its `transition` in index.html has it. */
const FADE_MS = 300

/**
 * Takes away the loading screen the page opens on (`#splash` in index.html,
 * there so it shows before the app's script has loaded), fading it out over
 * what the app has drawn underneath. It has been up since the page opened,
 * and stays until it has been up for `SPLASH_MIN_MS`, however soon the app is
 * ready. Does nothing once it is going or gone.
 */
export function dismissSplash() {
  const splash = document.getElementById('splash')
  if (!splash || splash.dataset.dismissed) return
  splash.dataset.dismissed = 'true'
  // `performance.now()` counts from when the page opened.
  setTimeout(() => {
    splash.classList.add('leaving')
    setTimeout(() => splash.remove(), FADE_MS)
  }, Math.max(0, SPLASH_MIN_MS - performance.now()))
}
