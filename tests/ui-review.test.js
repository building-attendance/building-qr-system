// The pictures of the UI review (npm run ui-review:pictures, docs/testing.md, step 3 of the ui-review skill). No browser and no database:
// the worst-case data is checked against the limits of the server (a value above a limit would not be one that a person could save, and
// a "longest value" that is shorter than the limit would stop being the worst case), the run is checked for being kept out of the E2E run
// and out of the README screenshots, and the guards that keep it on this machine, in a scratch schema of its own and out of the files
// that git tracks are checked for what they refuse.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  ADDRESS_MAX_LENGTH, BUILDING_NAME_MAX_LENGTH, DESCRIPTION_MAX_LENGTH, EMAIL_MAX_LENGTH, KEY_NAME_MAX_LENGTH, NAME_MAX_LENGTH,
  SERVICE_TYPE_MAX_LENGTH,
} from '../shared/contract.js'
import { SCAN_COOLDOWN_MINUTES } from '../server/config.js'
import {
  ADMINS, AGENT_KEY, BUILDING, PLAIN_ADMIN, POINTS, PROVIDERS, REFUSALS, SAMPLE, SIGN_IN, VISITS,
} from '../scripts/ui-review/worst-case.mjs'
import {
  DEFAULT_OUT_DIR, IGNORED_OUT_DIRS, UI_REVIEW_API_PORT, UI_REVIEW_APP_PORT, UI_REVIEW_SCHEMA, assertLocalUiReview, outDir,
  parseUiReviewSchema, uiReviewSettings,
} from '../scripts/ui-review/settings.mjs'
import { SCREENSHOTS_API_PORT, SCREENSHOTS_APP_PORT } from '../scripts/screenshots/settings.mjs'
import { DEFAULT_API_PORT, DEFAULT_APP_PORT } from '../scripts/e2e-config.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

// ---- the worst-case data -------------------------------------------------------------------------------------------------------

describe('the worst-case data', () => {
  it('stays within the limits of the server, and the longest values are at the limit', () => {
    expect(BUILDING.name.length).toBe(BUILDING_NAME_MAX_LENGTH)
    expect(BUILDING.address.length).toBe(ADDRESS_MAX_LENGTH)
    expect(PROVIDERS.hebrew.company.length).toBe(NAME_MAX_LENGTH)
    expect(PROVIDERS.russian.company.length).toBe(NAME_MAX_LENGTH)
    expect(POINTS.lobby.description.length).toBe(DESCRIPTION_MAX_LENGTH)
    for (const name of [PROVIDERS.hebrew.contact_name, PROVIDERS.russian.contact_name, POINTS.lobby.name, POINTS.gym.name, ADMINS.signedIn.name]) {
      expect(name.length).toBeLessThanOrEqual(NAME_MAX_LENGTH)
    }
    for (const p of Object.values(PROVIDERS)) {
      expect(p.company.length).toBeLessThanOrEqual(NAME_MAX_LENGTH)
      expect((p.contact_name ?? '').length).toBeLessThanOrEqual(NAME_MAX_LENGTH)
    }
    expect(POINTS.lobby.service_type.length).toBeLessThanOrEqual(SERVICE_TYPE_MAX_LENGTH)
    expect(PROVIDERS.hebrew.service_type.length).toBeLessThanOrEqual(SERVICE_TYPE_MAX_LENGTH)
    expect(AGENT_KEY.name.length).toBeLessThanOrEqual(KEY_NAME_MAX_LENGTH)
    // The long names are long: a name that is not much longer than an ordinary one would test nothing.
    expect(Math.min(POINTS.lobby.name.length, PROVIDERS.hebrew.contact_name.length, PROVIDERS.russian.contact_name.length)).toBeGreaterThan(90)
  })

  it('has e-mail addresses that the committee form accepts, on example.test, one of them long', () => {
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/ // the one of server/routes/admin.js and of the committee form
    for (const { email } of [...Object.values(ADMINS), PLAIN_ADMIN]) {
      expect(email).toMatch(EMAIL_RE)
      expect(email.length).toBeLessThanOrEqual(EMAIL_MAX_LENGTH)
      expect(email.split('@')[0].length, 'the local part of an address is at most 64 characters').toBeLessThanOrEqual(64)
      expect(email).toBe(email.toLowerCase()) // the server stores them in lower case, and the dev sign-in looks them up as typed
      expect(email).toMatch(/\.test$/)
    }
    expect(ADMINS.signedIn.email.length).toBeGreaterThan(100)
    expect(SIGN_IN.admin).toBe(ADMINS.signedIn.email)
  })

  it('covers the cases the review asks for', () => {
    expect(PROVIDERS.oneWord.company).not.toMatch(/\s/) // one long unbroken word
    expect(PROVIDERS.oneWord.company.length).toBeGreaterThan(40)
    expect(PROVIDERS.oneWord.contact_name).toBe('') // so that the word is the whole name
    expect(PROVIDERS.russian.company).toMatch(/^[А-Яа-я«]/) // Russian, the longest of the four languages
    expect(PROVIDERS.hebrew.company).toMatch(/[א-ת]/)
    expect(PROVIDERS.short.contact_name.length).toBeLessThanOrEqual(2) // a name of one or two letters
    expect(ADMINS.oneLetter.name.length).toBe(1)
    expect(ADMINS.noName.name).toBe('') // a member with no name: the screen falls back to something
    // A first word that is long: the greeting of the Home screen takes the first word of the member's name.
    expect(ADMINS.signedIn.name.split(' ')[0].length).toBeGreaterThan(8)
    // A day with exactly one visit, a busy day, and a provider whose only visit of the week is one.
    const perDay = new Map()
    const perPerson = new Map()
    for (const [days, , who] of VISITS) {
      perDay.set(days, (perDay.get(days) ?? 0) + 1)
      perPerson.set(who, (perPerson.get(who) ?? 0) + 1)
    }
    expect([...perDay.values()]).toContain(1)
    expect(Math.max(...perDay.values())).toBeGreaterThanOrEqual(10)
    expect(perPerson.get('short')).toBe(1)
    expect(REFUSALS.length).toBeGreaterThan(0)
  })

  it('makes visits that the server will take: who may scan where, and the cooldown between two visits of one person at one point', () => {
    const mayScan = { lobby: ['hebrew', 'russian', 'oneWord'], gym: ['cleaner'] } // the points that have a list (seed.mjs assigns them); basement is open
    const last = new Map()
    for (const [days, hhmm, who, where] of [...VISITS].sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]))) {
      expect([...Object.keys(PROVIDERS), 'cleaner']).toContain(who)
      expect(['lobby', 'gym', 'basement']).toContain(where)
      if (mayScan[where]) expect(mayScan[where], `${who} at ${where}`).toContain(who)
      expect(hhmm).toMatch(/^\d{2}:\d{2}$/)
      const [h, m] = hhmm.split(':').map(Number)
      const minutes = (5 - days) * 24 * 60 + h * 60 + m
      const key = `${who}|${where}`
      if (last.has(key)) expect(minutes - last.get(key), `${key} twice within the cooldown`).toBeGreaterThan(SCAN_COOLDOWN_MINUTES)
      last.set(key, minutes)
    }
    for (const [, , who] of REFUSALS) expect(Object.keys(PROVIDERS)).toContain(who)
  })

  it('renames rows that the dev seed makes, with the password the dev seed gave them', () => {
    const seed = read('scripts/dev-seed.mjs')
    for (const value of Object.values(SAMPLE)) expect(seed, `the dev seed has "${value}"`).toContain(`'${value}'`)
    const passwordOf = (company) => new RegExp(`provider\\('${company}',[^\\n]*'(dev-pass-\\d+)'`).exec(seed)?.[1]
    expect(PROVIDERS.hebrew.password).toBe(passwordOf(SAMPLE.gardener))
    expect(PROVIDERS.russian.password).toBe(passwordOf(SAMPLE.russian))
    expect(PROVIDERS.oneWord.password).toBe(passwordOf(SAMPLE.english))
    expect(PROVIDERS.short.password).toMatch(/^dev-pass-\d+$/)
    expect(seed).not.toContain(PROVIDERS.short.password) // a password of its own
    expect(SIGN_IN.provider.password).toBe(PROVIDERS.russian.password)
    expect(PLAIN_ADMIN.email).toBe(SAMPLE.admin)
  })
})

// ---- the run is not an E2E run, and not the README screenshots ---------------------------------------------------------------------

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli')
/** `playwright test --list` with these arguments, in the project folder: lists the tests without starting a server. */
const list = (...args) =>
  spawnSync(process.execPath, [cli, 'test', '--list', ...args], {
    cwd: root,
    // No variable of another run is passed on: the pictures set their own, and the E2E config reads its defaults.
    env: { ...process.env, E2E_APP_PORT: '', E2E_API_PORT: '', E2E_SCHEMA: '', UI_REVIEW_APP_PORT: '', UI_REVIEW_API_PORT: '', UI_REVIEW_SCHEMA: '', UI_REVIEW_OUT: '', CI: '' },
    encoding: 'utf8',
    timeout: 60_000,
  })

describe('the pictures are not part of the E2E run, so that CI never takes them', () => {
  const config = 'playwright.ui-review.config.js'

  it('have a config of their own, at the project root and not under e2e/ or tests/', () => {
    const source = read(config)
    const testDir = /testDir:\s*'([^']+)'/.exec(source)?.[1]
    expect(testDir, 'the config names its testDir').toBeTruthy()
    const where = path.posix.normalize(testDir)
    for (const forbidden of ['e2e', 'tests', 'scripts/screenshots']) {
      expect(where === forbidden || where.startsWith(`${forbidden}/`) || where.startsWith(`./${forbidden}`), `testDir ${testDir}`).toBe(false)
    }
    expect(fs.existsSync(path.join(root, where)), 'its testDir exists').toBe(true)
  })

  it('are run by npm run ui-review:pictures with that config, and neither npm run test:e2e nor npm test uses it', () => {
    const { scripts } = JSON.parse(read('package.json'))
    expect(scripts['ui-review:pictures']).toBe(`playwright test --config ${config}`)
    expect(scripts['test:e2e']).toBe('playwright test')
    expect(scripts.test).not.toContain('ui-review')
    expect(scripts.screenshots).not.toContain('ui-review')
  })

  it('are not listed by the E2E config or by the config of the README screenshots', () => {
    for (const args of [[], ['--config', 'playwright.screenshots.config.js']]) {
      const result = list(...args)
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toMatch(/Total: \d+ tests in \d+ files?/)
      expect(result.stdout).not.toContain('ui-review.spec')
    }
  })

  it('are listed by their own config: one spec, in a folder that the E2E config does not read', () => {
    const result = list('--config', config)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('ui-review.spec.mjs')
    expect(result.stdout).toMatch(/Total: \d+ tests in 1 file/)
    expect(result.stdout).not.toMatch(/(?:^|[\\/\s])e2e[\\/]/m) // none of the E2E specs
    expect(result.stdout).not.toContain('screenshots.spec')
  })
})

describe('the config of the pictures', () => {
  // The way tests/screenshots.test.js loads its config: again, as Playwright does, with the variables of an E2E run set to something else
  // on purpose (the pictures must not take them over).
  async function loadConfig(env = {}) {
    vi.resetModules()
    vi.stubEnv('E2E_APP_PORT', '3100')
    vi.stubEnv('E2E_API_PORT', '3101')
    vi.stubEnv('E2E_SCHEMA', 'e2e')
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
    return (await import('../playwright.ui-review.config.js')).default
  }
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('serves its own ports and works in its own schema, whatever an E2E run left in the environment', async () => {
    const config = await loadConfig({ UI_REVIEW_APP_PORT: '', UI_REVIEW_API_PORT: '', UI_REVIEW_SCHEMA: '' })
    const [api, preview] = config.webServer
    const build = `node_modules/.cache/bqr-e2e/${UI_REVIEW_SCHEMA}/dist`
    expect(config.use.baseURL).toBe(`http://localhost:${UI_REVIEW_APP_PORT}`)
    // The dev seed drops the schema, the seed of the review makes it again (it runs the dev seed, then adds the worst case), then the API.
    expect(api.command).toBe(
      `node scripts/dev-seed.mjs ${UI_REVIEW_SCHEMA} --drop && node scripts/ui-review/seed.mjs ${UI_REVIEW_SCHEMA} && node server/dev.mjs --schema=${UI_REVIEW_SCHEMA}`,
    )
    expect(api.url).toBe(`http://localhost:${UI_REVIEW_API_PORT}/api/public/providers`)
    expect(preview.command).toBe(`npm run build -- --outDir ${build} && npx vite preview --port ${UI_REVIEW_APP_PORT} --strictPort --outDir ${build}`)
    for (const server of [api, preview]) expect(server.reuseExistingServer).toBe(false)
    expect(config.testDir).toBe('./scripts/ui-review')
    expect(config.globalTeardown).toBe('./e2e/global-teardown.js') // drops the schema of this run (the schema comes from the environment)
    expect(config.projects).toHaveLength(1) // one browser: each picture is taken once
    expect(config.retries).toBe(0)
  })

  it('takes the ports and the schema of UI_REVIEW_APP_PORT, UI_REVIEW_API_PORT and UI_REVIEW_SCHEMA, for a second run on the same machine', async () => {
    const config = await loadConfig({ UI_REVIEW_APP_PORT: '3510', UI_REVIEW_API_PORT: '3511', UI_REVIEW_SCHEMA: 'ui_review_b' })
    const [api, preview] = config.webServer
    expect(config.use.baseURL).toBe('http://localhost:3510')
    expect(api.command).toContain('scripts/ui-review/seed.mjs ui_review_b ')
    expect(api.url).toBe('http://localhost:3511/api/public/providers')
    expect(preview.command).toContain('node_modules/.cache/bqr-e2e/ui_review_b/dist')
    expect(api.env.E2E_SCHEMA).toBe('ui_review_b')
  })

  it('shares no port, schema or build with the default E2E run, the README screenshots or the timings', () => {
    const taken = [DEFAULT_APP_PORT, DEFAULT_API_PORT, SCREENSHOTS_APP_PORT, SCREENSHOTS_API_PORT, 3200, 3201, 3700, 3701, 3711, 3720, 3721]
    expect(taken).not.toContain(UI_REVIEW_APP_PORT)
    expect(taken).not.toContain(UI_REVIEW_API_PORT)
    expect(UI_REVIEW_SCHEMA).not.toBe('e2e')
    expect(UI_REVIEW_SCHEMA).not.toBe('screenshots')
  })
})

// ---- the guards --------------------------------------------------------------------------------------------------------------

describe('the guards of the run', () => {
  it('takes the defaults, and values from the environment', () => {
    expect(uiReviewSettings({})).toEqual({ appPort: UI_REVIEW_APP_PORT, apiPort: UI_REVIEW_API_PORT, schema: UI_REVIEW_SCHEMA })
    expect(uiReviewSettings({ UI_REVIEW_APP_PORT: '3600', UI_REVIEW_API_PORT: '3601', UI_REVIEW_SCHEMA: 'my_review' })).toEqual({ appPort: 3600, apiPort: 3601, schema: 'my_review' })
  })

  it('refuses the same port twice, a port that is not one, and a bad schema, before anything starts', () => {
    expect(() => uiReviewSettings({ UI_REVIEW_APP_PORT: '3600', UI_REVIEW_API_PORT: '3600' })).toThrow(/must differ/)
    expect(() => uiReviewSettings({ UI_REVIEW_APP_PORT: '80' })).toThrow(/UI_REVIEW_APP_PORT/)
    expect(() => uiReviewSettings({ UI_REVIEW_API_PORT: 'abc' })).toThrow(/UI_REVIEW_API_PORT/)
    expect(() => uiReviewSettings({ UI_REVIEW_SCHEMA: 'Review;' })).toThrow()
  })

  it.each(['public', 'neon_auth', 'dev_ui', 'e2e', 'screenshots', 'perf', 'perf_api', 'perf_screens', 'Ui_Review', 'a-b', '../x', 'x'.repeat(40)])(
    'refuses the schema %j',
    (schema) => {
      expect(() => parseUiReviewSchema(schema)).toThrow()
      expect(() => assertLocalUiReview({ baseURL: 'http://localhost:3400', schema })).toThrow()
    },
  )

  it('lets a scratch schema of its own through, on a local address only', () => {
    expect(parseUiReviewSchema(undefined)).toBe(UI_REVIEW_SCHEMA)
    expect(parseUiReviewSchema('')).toBe(UI_REVIEW_SCHEMA)
    for (const baseURL of ['http://localhost:3400', 'http://127.0.0.1:3400']) {
      expect(assertLocalUiReview({ baseURL, schema: 'ui_review_b' })).toEqual({ schema: 'ui_review_b' })
    }
    for (const baseURL of ['https://example.com', 'http://example.com:3400', 'https://localhost:3400', 'http://192.168.1.20:3400', 'localhost:3400', '', undefined]) {
      expect(() => assertLocalUiReview({ baseURL, schema: 'ui_review' }), String(baseURL)).toThrow(/Refusing to take screenshots/)
    }
  })

  it('stops the seed before it connects to a database, for a schema that is refused', () => {
    for (const args of [['public'], ['e2e'], ['dev_ui'], ['neon_auth'], ['screenshots', '--empty'], ['public', '--empty']]) {
      const result = spawnSync(process.execPath, ['scripts/ui-review/seed.mjs', ...args], {
        cwd: root,
        env: { ...process.env, DATABASE_URL: '', DATABASE_URL_UNPOOLED: '' },
        encoding: 'utf8',
        timeout: 60_000,
      })
      expect(result.status, args.join(' ')).not.toBe(0)
      expect(result.stderr, args.join(' ')).toMatch(/Refusing to seed/)
      expect(result.stdout, args.join(' ')).not.toMatch(/seeded|empty building/)
    }
  })

  it('wants a schema, and nothing else, on the command line', () => {
    for (const args of [[], ['ui_review', 'other'], ['ui_review', '--unknown']]) {
      const result = spawnSync(process.execPath, ['scripts/ui-review/seed.mjs', ...args], {
        cwd: root,
        env: { ...process.env, DATABASE_URL: '', DATABASE_URL_UNPOOLED: '' },
        encoding: 'utf8',
        timeout: 60_000,
      })
      expect(result.status, args.join(' ')).toBe(2)
      expect(result.stderr).toMatch(/Usage:/)
    }
  })
})

describe('where the pictures go', () => {
  const project = path.join(path.parse(root).root, 'work', 'project')

  it('is the folder that git ignores, unless UI_REVIEW_OUT says another', () => {
    expect(outDir({}, project)).toBe(path.join(project, DEFAULT_OUT_DIR))
    expect(outDir({ UI_REVIEW_OUT: '' }, project)).toBe(path.join(project, DEFAULT_OUT_DIR))
    expect(outDir({ UI_REVIEW_OUT: 'ui-review-pictures/mine' }, project)).toBe(path.join(project, 'ui-review-pictures', 'mine'))
    expect(outDir({ UI_REVIEW_OUT: 'node_modules/.cache/pictures' }, project)).toBe(path.join(project, 'node_modules', '.cache', 'pictures'))
    expect(outDir({ UI_REVIEW_OUT: path.join(path.parse(root).root, 'somewhere', 'else') }, project)).toBe(path.join(path.parse(root).root, 'somewhere', 'else'))
  })

  it.each(['docs/screenshots', 'e2e/__screenshots__/visual.spec.js', 'src', '.', 'node_modules', 'pictures', 'ui-review-pictures/../docs'])(
    'refuses %j: it is inside the project and git does not ignore it',
    (UI_REVIEW_OUT) => {
      expect(() => outDir({ UI_REVIEW_OUT }, project)).toThrow(/git does not ignore it/)
    },
  )

  it('is a folder that .gitignore covers', () => {
    const lines = read('.gitignore').split(/\r?\n/).map((line) => line.trim())
    expect(lines).toContain(`${DEFAULT_OUT_DIR}/`)
    expect(lines).toContain('node_modules/')
    expect(IGNORED_OUT_DIRS).toEqual([DEFAULT_OUT_DIR, 'node_modules'])
  })
})

// ---- the documents say how to run it -----------------------------------------------------------------------------------------

describe('the documents', () => {
  it('list the command, and the ui-review skill runs it in its step 3 and says the pictures are never committed', () => {
    expect(read('CONTRIBUTING.md')).toContain('npm run ui-review:pictures')
    expect(read('docs/testing.md')).toContain('npm run ui-review:pictures')
    const skill = read('.claude/skills/ui-review/SKILL.md')
    expect(skill).toContain('npm run ui-review:pictures')
    expect(skill).toContain('--grep')
    expect(skill).toContain('UI_REVIEW_OUT')
    expect(skill).toMatch(/never committed/)
  })
})
