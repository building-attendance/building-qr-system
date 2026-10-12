// Which tab of the committee app is open. The address says it (`/admin#history`), so that a reload, the back button and a
// link to a tab all land on the same tab.
//
// The address is an external store, and React reads it with `useSyncExternalStore`. After it has subscribed, React reads the
// store once more and draws again if the value moved. That closes the window between the first render and the moment the
// listener is attached: a plain `useState` that read the address in its initial state, and attached a `hashchange` listener
// in an effect, lost a change that came in between (a link opened right after sign-in) and stayed on the first tab.
//
// The app changes the tab by setting `location.hash`, and the browser fires `hashchange` for that, so the subscription
// below is all the store needs. A change made with `history.replaceState` or `pushState` fires nothing: whoever adds one has
// to tell the store (call the `onChange` that `subscribe` was given) or use `location.hash` instead. The one change of that kind
// that the app makes today leaves the tab as it was, so the store has nothing to learn from it: a link can carry a query after the
// tab's name (`#history?provider=...`, see `hashQuery`), and the screen that read it puts the plain `#history` back with
// `replaceState`. The tab is decided by the part before the `?` alone, so the snapshot is the same before and after.
import { useSyncExternalStore } from 'react'

/**
 * The screens that changed their address, old key to new key. The address of a screen is kept in bookmarks, in links that were sent and in
 * tabs that are still open, so an old address lands on the screen that took its place. `#committee` was one screen with the members, the
 * building's details, the help and the audit log; it is now `#settings` (the members and the building's details), and the help and the
 * audit log are `#help` and `#audit`.
 */
export const RENAMED_TABS = new Map([['committee', 'settings']])

/**
 * What an address names: the text between the `#` and the first `?` (all of it after the `#` when there is no `?`), as it was written.
 * `#history?provider=1` names `history`.
 * @param {string} [hash]  default: the address of the page now
 * @returns {string}
 */
export const hashName = (hash = window.location.hash) => {
  const at = hash.indexOf('?')
  return (at < 0 ? hash : hash.slice(0, at)).slice(1)
}

/**
 * The query that an address carries after the tab's name, as `URLSearchParams` (empty when it has none): the part after the first `?`
 * of `#history?provider=1&from=2026-10-01`. A screen that a link can open with settings reads them from here.
 * @param {string} [hash]  default: the address of the page now
 * @returns {URLSearchParams}
 */
export const hashQuery = (hash = window.location.hash) => {
  const at = hash.indexOf('?')
  return new URLSearchParams(at < 0 ? '' : hash.slice(at + 1))
}

/**
 * The tab that the address names: the key after the `#` and before any `?` (or the key that an old one was renamed to), or the first key
 * when the address names none of `keys` (no hash, or one that is not a tab). The first of `keys` is therefore the tab that opens by
 * default. What follows a `?` is the link's settings (`hashQuery`) and does not decide the tab.
 * @param {string[]} keys
 * @param {string} [hash]  default: the address of the page now
 * @returns {string}
 */
export const tabFromHash = (keys, hash = window.location.hash) => {
  const named = hashName(hash)
  const wanted = RENAMED_TABS.get(named) ?? named
  return keys.find((key) => key === wanted) ?? keys[0]
}

/** One function for the life of the module, so that React does not subscribe again on every render. */
function subscribe(onChange) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

/** Opens a tab: sets the address, and the browser's `hashchange` tells the subscribers. */
export function goToTab(key) {
  window.location.hash = key
}

/**
 * The open tab and the function that opens another one.
 * @param {string[]} keys  the keys of the tabs, the first one is the default (keep the array the same on every render)
 * @returns {[string, (key: string) => void]}
 */
export function useTab(keys) {
  // The snapshot is a string, so React compares it by value: the same tab twice is no change.
  const tab = useSyncExternalStore(subscribe, () => tabFromHash(keys))
  return [tab, goToTab]
}
