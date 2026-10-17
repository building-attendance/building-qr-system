/**
 * An address cut into the pieces that may stand on a line of their own: every piece ends with an "@" or a dot, and the last one is what
 * follows the final one. "a.b@c.com" is "a.", "b@", "c.", "com". Not a regex lookbehind: the oldest phones in use (build.target in
 * vite.config.js) would fail to parse the whole bundle on one.
 * @param {string | null | undefined} address
 * @returns {string[]}
 */
export const emailParts = (address) => String(address ?? '').match(/[^@.]*[@.]|[^@.]+$/g) ?? []

/**
 * A committee member's e-mail address (owner decision of 16/10/2026): an address is left to right inside the right-to-left page, and it
 * breaks only after the "@" or after a dot, never in the middle of a word, so a long one reads as a few whole pieces on a few lines.
 *
 * Each piece is an inline block (`.a-email__piece`, admin.css). A line may break between two of them (a browser always allows a break
 * before and after an atomic inline) and nowhere inside one: a plain `<wbr>` after each "@" and dot gave the browser those breaks too, but
 * it also kept the breaks that it finds by itself after a hyphen, so "north-region." could split as "north-" and "region.". A piece that
 * alone is wider than the line is the last resort: its box is no wider than the line and its text wraps inside it, after a hyphen first
 * and then anywhere (`overflow-wrap: anywhere`, which the box around the address keeps). The text of the address is unchanged, so a copy of
 * it is the address.
 *
 * It is a `<bdi dir="ltr">`, so the address keeps its own order and its neighbours' punctuation and digits are not reordered. Any other
 * attribute (a class, a title) goes to that element. Every place of the committee app that shows an address uses it: the member's card in
 * Settings, the account button and its menu, and the e-mail of the audit log (its detail line, and the subject of an entry that is one).
 *
 * `oneLine` is for the account button of the side rail, whose address is one line that ends in an ellipsis where the room ends (CSS:
 * `white-space: nowrap`). It is plain text: a nowrap line has nothing to break at, and an inline block would be one more box in it.
 * @param {{ address: string | null | undefined, oneLine?: boolean } & import('react').HTMLAttributes<HTMLElement>} props
 */
export default function Email({ address, oneLine = false, ...rest }) {
  return (
    <bdi dir="ltr" {...rest}>
      {oneLine ? String(address ?? '') : emailParts(address).map((part, i) => <span key={i} className="a-email__piece">{part}</span>)}
    </bdi>
  )
}

/** Whether a whole text is an e-mail address (what the audit log's subject is for a member that has no name). The form's own check, shape only. */
export const isEmailAddress = (text) => typeof text === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
