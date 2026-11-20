import { useEffect, useState } from 'react'
import { decodeEntities, looksLikeHtml, TIMESTAMP, timestampSeconds } from './notesText'
import type { DataApi } from './services'

/** A stretch of an episode, from where it starts to where the next one does. */
export interface Chapter {
  /** Seconds from the start. */
  start: number
  title: string
}

/** Within this many seconds of a chapter's start, going back goes to the chapter before; after it, to this one's start. */
export const RESTART_CHAPTER_SECONDS = 3

/** Ends a block of HTML, or breaks a line: where a line of the notes' text ends. */
const LINE_END = /<br\s*\/?>|<\/?(?:p|div|li|ul|ol|tr|h[1-6]|dt|dd|blockquote|pre|section|article|table)(?:\s[^<>]*)?>/gi
/** A table cell: "00:00 Intro", not "00:00Intro". */
const CELL_END = /<\/t[dh]\s*>/gi

/** Bullets, dashes or a number ("3." or "3)") a list line can start with. */
const BULLET = String.raw`(?:[-–—•*·▪►>]\s*|\d+[.)]\s+)?`
/** What can sit between a timestamp and the title. */
const SEPARATOR = String.raw`(?:[-–—:|.,]\s*)?`
/** "00:00 Intro", "(00:00) - Intro", "[1:02:03] Intro". */
const LEADING = new RegExp(String.raw`^${BULLET}[\[(]?(${TIMESTAMP})(?![\w:]|\.\d)[\])]?\s*${SEPARATOR}(.*)$`)
/** "Intro - 00:00", "Intro (00:00)". */
const TRAILING = new RegExp(String.raw`^${BULLET}(.+?)\s*${SEPARATOR}[\[(]?(?<![\w:.])(${TIMESTAMP})[\])]?$`)

/**
 * The chapters an episode's show notes list, as lines that start with a
 * timestamp ("05:12 Why RSS still wins"), or failing that, lines that end with
 * one ("Why RSS still wins (05:12)"). A list needs two chapters or more, in
 * the order they play, to count; anything else gives none.
 */
export function parseChapters(notes: string | null): Chapter[] {
  if (!notes) return []
  const lines = notesLines(notes)
  for (const [pattern, timeAt, titleAt] of [[LEADING, 1, 2], [TRAILING, 2, 1]] as const) {
    const chapters: Chapter[] = []
    for (const line of lines) {
      const match = pattern.exec(line)
      const start = match ? timestampSeconds(match[timeAt]) : null
      if (!match || start === null) continue
      chapters.push({ start, title: match[titleAt].replace(/[\s\-–—:|]+$/, '').trim() })
    }
    if (chapters.length >= 2 && chapters.every((chapter, i) => i === 0 || chapter.start > chapters[i - 1].start)) {
      return chapters.map((chapter, i) => (chapter.title ? chapter : { ...chapter, title: `Chapter ${i + 1}` }))
    }
  }
  return []
}

/** The notes as lines of plain text, each trimmed, without markup. */
function notesLines(notes: string): string[] {
  const text = looksLikeHtml(notes)
    ? // DOMParser runs no scripts and loads nothing; only the text is read.
      new DOMParser().parseFromString(notes.replace(CELL_END, ' $&').replace(LINE_END, '\n$&'), 'text/html').body
        .textContent ?? ''
    : decodeEntities(notes)
  return text
    .split(/\r\n?|\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/** The index of the chapter playing at this position, or -1 before the first. */
export function chapterIndexAt(chapters: Chapter[], position: number): number {
  let index = -1
  while (index + 1 < chapters.length && chapters[index + 1].start <= position) index++
  return index
}

/**
 * Where going back a chapter leads: this chapter's start, or the one before's
 * when only just into it. Null when there is nowhere to go.
 */
export function previousChapterStart(chapters: Chapter[], position: number): number | null {
  const index = chapterIndexAt(chapters, position)
  if (index < 0) return null
  if (position - chapters[index].start > RESTART_CHAPTER_SECONDS) return chapters[index].start
  return index > 0 ? chapters[index - 1].start : null
}

/** Where the next chapter starts, or null in the last. */
export function nextChapterStart(chapters: Chapter[], position: number): number | null {
  return chapters[chapterIndexAt(chapters, position) + 1]?.start ?? null
}

/**
 * The chapters of this episode, from its show notes, once they load. None
 * while loading, or if they can't be loaded (offline, say).
 */
export function useChapters(data: Pick<DataApi, 'getShowNotes'>, episodeId: string): Chapter[] {
  const [loaded, setLoaded] = useState<{ episodeId: string; chapters: Chapter[] } | null>(null)
  useEffect(() => {
    let cancelled = false
    data.getShowNotes(episodeId).then(
      (notes) => cancelled || setLoaded({ episodeId, chapters: parseChapters(notes) }),
      () => cancelled || setLoaded({ episodeId, chapters: [] }),
    )
    return () => {
      cancelled = true
    }
  }, [data, episodeId])
  return loaded?.episodeId === episodeId ? loaded.chapters : NONE
}

const NONE: Chapter[] = []
