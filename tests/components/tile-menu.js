// Helpers for the tests of the tiles of the committee app: a tile shows one "more" button, and every action, edit first, is in the menu of
// that button (AGENTS.md, "Rules for every change"; Menu in src/admin/ui.jsx). The button is named after the thing it acts on, so a test
// finds it in the tile (`within(tile)`), by the beginning of its name.
import { within, fireEvent } from '@testing-library/react'

/** The "more" button of a tile: "עוד פעולות ל<name>". */
export const moreButton = (tile) => within(tile).getByRole('button', { name: /^עוד פעולות/ })

/** Opens the menu of a tile and returns it. */
export function openMenu(tile) {
  fireEvent.click(moreButton(tile))
  return within(tile).getByRole('menu')
}

/** The names of the actions in the menu of a tile, in the order they stand (it is left open). */
export const menuLabels = (tile) => within(openMenu(tile)).getAllByRole('menuitem').map((item) => item.textContent)

/** Chooses one action of the menu of a tile, by its name. */
export function choose(tile, name) {
  fireEvent.click(within(openMenu(tile)).getByRole('menuitem', { name }))
}

/** The names of the buttons that a tile shows with its menu closed, in the order they stand. */
export const shownButtons = (tile) => within(tile).getAllByRole('button').map((button) => button.getAttribute('aria-label'))
