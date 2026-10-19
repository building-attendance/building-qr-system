// What the narrator's two HTTP readers share (the published site in voice.mjs, the ElevenLabs narrator): reading an answer's body
// with a ceiling, so that a wrong address or a broken answer can never fill the memory before the size is checked.

/**
 * The body of `res`, or null when it is longer than `max` bytes (the reading stops there and the rest is cancelled). It may throw
 * what the stream throws (a timeout, a broken connection): the caller says what that means.
 * @param {Response} res
 * @param {number} max
 */
export async function readCapped(res, max) {
  if (Number(res.headers.get('content-length')) > max) {
    await res.body?.cancel().catch(() => {})
    return null
  }
  if (!res.body) return new Uint8Array(0)
  const reader = res.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > max) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.length
  }
  return bytes
}
