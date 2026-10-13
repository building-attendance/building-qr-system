// TEMPORARY, for PR #215 only: proves that the required check of a project turns red when one of its parts fails. It fails
// on WebKit and passes on Chromium. It is deleted by the next commit of the pull request, before any merge.
import { test, expect } from './fixtures.js'

test('fails on WebKit only, on purpose', async ({ browserName }) => {
  expect(browserName === 'webkit' ? 'failed on purpose' : 'ok').toBe('ok')
})
