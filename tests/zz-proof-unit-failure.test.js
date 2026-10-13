// TEMPORARY, for PR #216 only: proves that the required check `unit` turns red when one of its parts fails. It is
// deleted by the next commit of the pull request, before any merge.
import { it, expect } from 'vitest'

it('fails on purpose', () => {
  expect('failed on purpose').toBe('ok')
})
