// Removes the scratch schema that `npm run perf:screens` made (playwright.screens-perf.config.js, globalTeardown). The schema is
// E2E_SCHEMA, which that config sets in this process; scripts/perf/year-data.mjs --drop refuses a name that is not a scratch schema
// (or that belongs to another tool: the default "e2e" included, if the variable is ever missing), refuses a database that is marked
// production, and drops only a schema that it made itself.
import { execFileSync } from 'node:child_process'
import { e2eSettings } from '../e2e-config.mjs'

export default function globalTeardown() {
  const { schema } = e2eSettings()
  execFileSync(process.execPath, ['scripts/perf/year-data.mjs', schema, '--drop'], { stdio: 'inherit' })
}
