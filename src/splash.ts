/** How long the loading screen takes to fade, as its `transition` in index.html has it. */
const FADE_MS = 300

/**
 * Takes away the loading screen the page opens on (`#splash` in index.html,
 * there so it shows before the app's script has loaded), fading it out over
 * what the app has drawn underneath. Does nothing once it is gone.
 */
export function dismissSplash() {
  const splash = document.getElementById('splash')
  if (!splash || splash.classList.contains('leaving')) return
  splash.classList.add('leaving')
  setTimeout(() => splash.remove(), FADE_MS)
}
