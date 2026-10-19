// The shape of a narrator (a voice provider) of scripts/video/voice.mjs. Types only: nothing here runs.
//
// A provider is one of three kinds:
//  - `silent` (none.mjs): no audio, the seconds of the script;
//  - `recordings` (files.mjs): a person recorded each line, and the file of a line is named by its cache key; `read` gives the
//    bytes of one, or null when it is missing;
//  - `synthesize` (elevenlabs.mjs): an outside service speaks the line; `synthesize` gives the mp3 and costs characters, so the
//    narrator calls it only for a line that is in no cache, and only within the budget of the run.
// `voice` and `model` go into the cache key of every line, with its text: a line is spoken again only when one of the three changed.
// `label` is what the run prints about the provider; it never holds a secret.

/**
 * @typedef {{ id: string, text: string, lang: string }} Line  one line to speak: its beat id, the text, and the language of the text
 * @typedef {{
 *   name: 'elevenlabs' | 'files' | 'none',
 *   kind: 'silent' | 'recordings' | 'synthesize',
 *   voice: string | null,
 *   model: string | null,
 *   label: string,
 *   read?: (hash: string) => Uint8Array | null,
 *   synthesize?: (line: Line) => Promise<Uint8Array>,
 * }} Provider
 */

export {}
