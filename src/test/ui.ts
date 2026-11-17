import { screen, within } from '@testing-library/react'
import type userEvent from '@testing-library/user-event'

type User = ReturnType<typeof userEvent.setup>

/** Opens the "More actions" of the one episode in `row` (an episode's list item, or a list of one). */
export async function openActions(user: User, row: HTMLElement) {
  await user.click(within(row).getByRole('button', { name: 'More actions' }))
}

/** Chooses one of an episode's actions (Mark played, Play next, Add to queue, Download) from its "More actions". */
export async function chooseAction(user: User, row: HTMLElement, name: string) {
  await openActions(user, row)
  await user.click(within(row).getByRole('button', { name }))
}

/** Opens the show notes of the one episode in `row`, by the "i" beside it. */
export async function openShowNotes(user: User, row: HTMLElement) {
  await user.click(within(row).getByRole('button', { name: /^Show notes for / }))
}

/** Chooses one of the library's own actions (Import OPML file, Sign out) from its "More actions". */
export async function chooseLibraryAction(user: User, name: string) {
  await user.click(await screen.findByRole('button', { name: 'More actions' }))
  await user.click(screen.getByRole('button', { name }))
}
