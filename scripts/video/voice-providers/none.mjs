// The silent narrator: no audio at all, and the video runs on the seconds of the script. It is the default when no ElevenLabs key
// is set, so that every other task and every local run works without a secret.

/** @returns {import('./types.mjs').Provider} */
export function noneProvider() {
  return Object.freeze({ name: 'none', kind: 'silent', voice: null, model: null, label: 'none' })
}
