# 11: Show notes

**What to build:** The listener opens an episode and reads its show notes, with working links, before or while listening. (Spec story 18.)

**Blocked by:** 03

**Status:** done

- [x] An episode screen shows title, date, duration and show notes
- [x] The episode can be played from that screen
- [x] Show notes are sanitised before display: scripts, inline event handlers, frames and other active content are removed
- [x] Links in show notes open outside the app and cannot reach back into it
- [x] Plain-text show notes display readably, with line breaks kept
- [x] An episode with no show notes shows a sensible empty state
- [x] Client-seam tests include a fixture with hostile markup and assert that none of it survives

## Comments

**2026-11-14 (agent):** Implemented on branch `ticket/11-show-notes`.

- **Episode screen:** each episode row in a podcast's list and in Latest episodes has a **Show notes** button. It opens a screen with the title, podcast, date, duration, a Play button (which resumes where the listener left off) and the show notes. Back returns to the list it came from.
- **Fetching:** a new `DataApi.getShowNotes(episodeId)` reads `Episode.showNotes` on its own, so episode lists don't carry every episode's notes. The backend already stored them, so nothing changed there. The screen shows a loading state, an error if the fetch fails, and "This episode has no show notes." when there are none, or when nothing is left after sanitising.
- **Sanitising (`src/ShowNotes.tsx`):** the HTML is parsed into an inert `DOMParser` document, which runs no scripts and loads nothing, and rebuilt as React elements from an allowlist. Nothing is set as `innerHTML`, so nothing is parsed twice.
  - Text formatting, lists, quotes and headings (moved down a level) are kept, with no attributes.
  - Scripts, styles, frames, objects, forms, media, images, SVG and MathML are removed along with their contents.
  - Any other element loses its tag and keeps its text.
- **Links:** only absolute http, https and mailto links are kept. They get `target="_blank" rel="noopener noreferrer"`. Any other link, including `javascript:`, `data:` and relative ones, becomes plain text.
- **Plain text:** paragraphs and line breaks are kept, and web addresses become links. HTML that has no paragraphs or breaks of its own keeps its newlines through `white-space: pre-line`.
- **Tests:** `src/ShowNotes.test.tsx` runs through `<App>`. `src/test/fixtures/hostile-show-notes.html` contains scripts, event handlers, frames, an SVG/MathML mXSS attempt, forms, `<base>`/`<meta>`/`<link>`, and encoded `javascript:`, `data:` and relative links. The test asserts that none of these survive. Mutation-checked: removing any single protection fails it.
- **Not verified live:** the episode screen was not tried in a browser against the sandbox. Owner check: run `npm run dev`, open an episode's Show notes, and check that its links open in a new tab.
- **Known gaps:**
  - Images in show notes are dropped, so they make no tracking requests.
  - Notes can't be opened from Now Playing or the queue.
  - Going back to a podcast resets its "Unplayed only" filter.
  - The episode screen keeps the episode's details as they were when it was opened.
