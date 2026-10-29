// The recorder of the long promo (npm run promo:frames, playwright.promo.config.js). No browser and no database: the guard that keeps the
// run on this machine and in its own scratch schema is checked for what it refuses, the run is checked for being kept out of the E2E run,
// and the pure parts (the story's day and clock, the week of the invented building, the boxes of frames.json) for what they give.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  PROMO_APP_PORT, PROMO_API_PORT, PROMO_OUT_DIR, PROMO_SCHEMA, addDays, assertLocalPromo, assertPromoSchema, buildingInstant, checkPromoDay, isWorkday,
  missingDay, pictureBox, promoDay, weekdayOf, zoomRect, FRAME_ASPECT,
} from '../scripts/promo/settings.mjs'
import { LIVE, MISTAKE, NEW_PROVIDER, POINTS, PROVIDERS, weekVisits } from '../scripts/promo/sample.mjs'
import { SAMPLE_POINT } from '../scripts/sample-data.mjs'
import { PASSWORD_ALPHABET } from '../src/admin/password.js'
import { formatTime, isoDay } from '../shared/datetime.js'
import heDict from '../src/i18n/he.js'
import { BOXES, PROMO_PICTURES } from '../video/promo/script/long.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const config = 'playwright.promo.config.js'

// ---- the guard ----------------------------------------------------------------------------------------------------------------------

describe('the guard of the run', () => {
  it.each(['http://localhost:3800', 'http://127.0.0.1:3800'])('lets %s through, with the run\'s own schema', (baseURL) => {
    expect(assertLocalPromo({ baseURL, schema: PROMO_SCHEMA })).toMatchObject({ schema: PROMO_SCHEMA })
  })

  it.each(['https://localhost:3800', 'http://example.com:3800', 'http://192.168.1.20:3800', 'http://localhost@example.com', '', undefined])(
    'refuses the address %j, and says why',
    (baseURL) => {
      expect(() => assertLocalPromo({ baseURL, schema: PROMO_SCHEMA })).toThrow(/^Refusing to record the promo/)
    },
  )

  it.each(['public', 'neon_auth', 'dev_ui', 'e2e', 'screenshots', 'ui_review', 'video', 'perf', 'perf_api', 'perf_screens', '', undefined, 'Promo', 'promo;', '../x'])(
    'refuses the schema %j on a local address',
    (schema) => {
      expect(() => assertLocalPromo({ baseURL: 'http://localhost:3800', schema })).toThrow()
      expect(() => assertPromoSchema(schema)).toThrow()
    },
  )

  it('stops the seed before it connects to a database, for a schema that is refused', () => {
    for (const schema of ['public', 'e2e', 'screenshots', 'video']) {
      const result = spawnSync(process.execPath, ['scripts/promo/seed.mjs', schema], {
        cwd: root,
        env: { ...process.env, DATABASE_URL: '', DATABASE_URL_UNPOOLED: '' },
        encoding: 'utf8',
        timeout: 60_000,
      })
      expect(result.status, schema).not.toBe(0)
      expect(result.stderr, schema).toMatch(/is refused|Refusing to record the promo/)
      expect(result.stdout).not.toMatch(/Seeded/)
    }
  })
})

// ---- the run is not an E2E run ------------------------------------------------------------------------------------------------------

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli')
const list = (...args) =>
  spawnSync(process.execPath, [cli, 'test', '--list', ...args], {
    cwd: root,
    env: { ...process.env, E2E_APP_PORT: '', E2E_API_PORT: '', E2E_SCHEMA: '', CI: '' },
    encoding: 'utf8',
    timeout: 60_000,
  })

describe('the recorder is not part of the E2E run, so that CI never runs it', () => {
  it('is run by npm run promo:frames with its own config, which npm test does not use', () => {
    const { scripts } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    expect(scripts['promo:frames']).toBe(`playwright test --config ${config}`)
    expect(scripts.test).not.toContain('promo')
    expect(scripts['test:e2e']).toBe('playwright test')
  })

  it('is not listed by the E2E config', () => {
    const result = list()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toMatch(/Total: \d+ tests in \d+ files/)
    expect(result.stdout).not.toContain('capture.spec')
  })

  it('is listed by its own config: one spec, and none of the E2E specs', () => {
    const result = list('--config', config)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('capture.spec.mjs')
    expect(result.stdout).toMatch(/Total: \d+ tests in 1 file/)
    expect(result.stdout).not.toMatch(/(?:^|[\\/\s])e2e[\\/]/m)
  })

  it('writes its pictures into a folder that git ignores', () => {
    const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/)
    expect(ignore).toContain('video/out/')
    expect(PROMO_OUT_DIR.startsWith('video/out/')).toBe(true)
  })
})

describe('the config of the recorder', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('serves its own ports, seeds its own schema with the invented building, and starts the API with the run\'s clock', async () => {
    vi.resetModules()
    vi.stubEnv('E2E_APP_PORT', '3100') // what an E2E run may have left: the recorder must not take it over
    vi.stubEnv('E2E_API_PORT', '3101')
    vi.stubEnv('E2E_SCHEMA', 'e2e')
    vi.stubEnv('PROMO_DAY', '2026-10-27')
    const { default: loaded } = await import('../playwright.promo.config.js')
    const [api, preview] = loaded.webServer
    expect(loaded.use.baseURL).toBe(`http://localhost:${PROMO_APP_PORT}`)
    expect(api.command).toBe(
      `node scripts/dev-seed.mjs ${PROMO_SCHEMA} --drop && node scripts/promo/seed.mjs ${PROMO_SCHEMA} && ` +
        `node --import ./scripts/promo/clock.mjs server/dev.mjs --schema=${PROMO_SCHEMA} --runtime-role`,
    )
    expect(api.url).toBe(`http://localhost:${PROMO_API_PORT}/api/public/providers`)
    expect(api.env).toMatchObject({ E2E_SCHEMA: PROMO_SCHEMA, PROMO_DAY: '2026-10-27', GOOGLE_CLIENT_ID: '' })
    expect(preview.command).toContain(`--port ${PROMO_APP_PORT}`)
    expect(loaded.testDir).toBe('./scripts/promo')
    expect(loaded.workers).toBe(1)
    expect(loaded.globalTeardown).toBe('./e2e/global-teardown.js') // drops the schema of this run
  })

  it('does not share a port with the other runs', () => {
    for (const taken of [3000, 3001, 3100, 3101, 3200, 3201, 3300, 3301, 3400, 3401, 3600, 3601]) {
      expect([PROMO_APP_PORT, PROMO_API_PORT]).not.toContain(taken)
    }
  })
})

// ---- the clock ----------------------------------------------------------------------------------------------------------------------

describe('the story\'s day and clock', () => {
  it('is today once the building has passed 09:00, and yesterday before', () => {
    expect(promoDay(buildingInstant('2026-10-27', '09:00').getTime())).toBe('2026-10-27')
    expect(promoDay(buildingInstant('2026-10-27', '23:59').getTime())).toBe('2026-10-27')
    expect(promoDay(buildingInstant('2026-10-27', '08:59').getTime())).toBe('2026-10-26')
    expect(promoDay(buildingInstant('2026-10-27', '00:30').getTime())).toBe('2026-10-26')
  })

  it('takes a story\'s day from the shell only when it is a real day that is not in the future', () => {
    const today = promoDay()
    expect(checkPromoDay(today)).toBe(today)
    expect(checkPromoDay('2026-01-31')).toBe('2026-01-31')
    for (const bad of [addDays(today, 1), '2026-02-30', '27/10/2026', '2026-10-27; drop', '', undefined]) {
      expect(() => checkPromoDay(bad), String(bad)).toThrow(/PROMO_DAY/)
    }
  })

  it.each([['2026-10-27', '08:06'], ['2026-07-01', '07:41'], ['2026-12-31', '23:59'], ['2026-03-27', '08:24']])(
    'finds the moment at which the building\'s clock shows %s %s, in summer and in winter',
    (day, hhmm) => {
      const at = buildingInstant(day, hhmm)
      expect(isoDay(at)).toBe(day)
      expect(formatTime(at)).toBe(hhmm)
    },
  )

  it('knows the building\'s offset from UTC in winter and in summer', () => {
    expect(buildingInstant('2026-01-15', '08:00').toISOString()).toBe('2026-01-15T06:00:00.000Z')
    expect(buildingInstant('2026-07-15', '08:00').toISOString()).toBe('2026-07-15T05:00:00.000Z')
  })

  it('puts every moment of the story before 09:00, so the story is in the past whatever the hour of the run', () => {
    for (const hhmm of Object.values(LIVE)) expect(hhmm < '09:00', hhmm).toBe(true)
  })

  it('moves the API\'s clock to the moment that the file says, and lets it run from there', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-clock-'))
    const file = path.join(dir, 'clock.json')
    const at = Date.parse('2026-10-27T05:06:00Z')
    fs.writeFileSync(file, JSON.stringify({ at, setAt: Date.now() }))
    const script = 'console.log(JSON.stringify([Date.now(), new Date().getTime(), new Date(0).getTime(), new Date() instanceof Date, typeof Date()]))'
    const result = spawnSync(process.execPath, ['--import', './scripts/promo/clock.mjs', '-e', script], {
      cwd: root,
      env: { ...process.env, PROMO_CLOCK_FILE: file },
      encoding: 'utf8',
      timeout: 30_000,
    })
    fs.rmSync(dir, { recursive: true, force: true })
    expect(result.status, result.stderr).toBe(0)
    const [now, constructed, epoch, isDate, called] = JSON.parse(result.stdout)
    for (const t of [now, constructed]) {
      expect(t).toBeGreaterThanOrEqual(at)
      expect(t).toBeLessThan(at + 30_000)
    }
    expect(epoch).toBe(0) // a Date with an argument is the one it always was
    expect(isDate).toBe(true)
    expect(called).toBe('string')
  })
})

// ---- the invented building ----------------------------------------------------------------------------------------------------------

describe('the week of the invented building', () => {
  const days = ['2026-10-25', '2026-10-27', '2026-10-30', '2026-10-31', '2026-11-01'] // a Sunday, a Tuesday, a Friday, a Saturday, a Sunday

  it.each(days)('has the cleaner on four of the five workdays before %s, and one missing workday inside the week', (today) => {
    const missing = missingDay(today)
    expect(isWorkday(missing)).toBe(true)
    expect(missing < today && missing >= addDays(today, -6)).toBe(true)
    const visits = weekVisits(today)
    const cleanerDays = new Set(visits.filter((v) => v.who === 'cleaner').map((v) => v.day))
    expect(cleanerDays.has(missing)).toBe(false)
    expect(cleanerDays.has(today)).toBe(false) // today's two visits are the run's own
    for (const day of cleanerDays) expect(isWorkday(day)).toBe(true)
    const workdaysBefore = Array.from({ length: 6 }, (_, i) => addDays(today, -(i + 1))).filter(isWorkday)
    expect(cleanerDays.size).toBe(workdaysBefore.length - 1)
  })

  it.each(days)('never gives a visit of %s the times of today\'s live visits, and keeps the morning of today', (today) => {
    const visits = weekVisits(today)
    expect(visits.some((v) => v.time === LIVE.lobby || v.time === LIVE.parking)).toBe(false)
    expect(visits.filter((v) => v.day === today)).toEqual([{ day: today, time: '07:41', who: 'gardener', where: 'garden', metres: 9 }])
    expect(visits.filter((v) => v.who === MISTAKE.who && v.where === MISTAKE.where && v.time === MISTAKE.time)).toHaveLength(1)
    for (const v of visits) expect(v.metres >= 5 && v.metres <= 10, `${v.day} ${v.time}`).toBe(true)
  })

  it('knows the days of the week', () => {
    expect(weekdayOf('2026-10-25')).toBe(0)
    expect(weekdayOf('2026-10-31')).toBe(6)
    expect(isWorkday('2026-10-29')).toBe(true)
    expect(isWorkday('2026-10-30')).toBe(false)
  })

  it('uses invented names, sample passwords and points at the sample point only', () => {
    const names = [...Object.values(PROVIDERS), NEW_PROVIDER].map((p) => p.contact)
    for (const placeholder of ['פלוני', 'אלמוני', 'Dev', 'דמה', 'דמו']) for (const name of names) expect(name).not.toContain(placeholder)
    // the shape of the passwords that the committee app suggests (src/admin/password.js), so the picture shows one that it could have made
    const shape = new RegExp(`^[${PASSWORD_ALPHABET}]{4}-[${PASSWORD_ALPHABET}]{4}$`)
    for (const p of [...Object.values(PROVIDERS), NEW_PROVIDER]) expect(p.password).toMatch(shape)
    for (const p of Object.values(POINTS)) expect(p.token).toMatch(/^BQR-promo\d+$/)
    expect(SAMPLE_POINT).toEqual({ lat: 34.1234, lng: 31.5678 }) // the seed puts every point here: at sea
  })
})

// ---- the boxes of frames.json -------------------------------------------------------------------------------------------------------

describe('the boxes of frames.json', () => {
  const phone = { width: 780, height: 1688 }

  it('turns a box of CSS pixels into the picture\'s pixels, inside the picture', () => {
    expect(pictureBox({ x: 10, y: 20, width: 30, height: 40 }, 2, phone)).toEqual({ x: 20, y: 40, width: 60, height: 80 })
    expect(pictureBox({ x: -5, y: 800, width: 400, height: 100 }, 2, phone)).toEqual({ x: 0, y: 1600, width: 780, height: 88 })
  })

  it('zooms at least two times on a small element, in the shape of the frame, inside the picture', () => {
    const zoom = zoomRect({ x: 600, y: 1600, width: 40, height: 40 }, phone)
    expect(zoom.width).toBe(390)
    expect(Math.abs(zoom.width / zoom.height - FRAME_ASPECT)).toBeLessThan(0.01)
    expect(zoom.x + zoom.width).toBeLessThanOrEqual(phone.width)
    expect(zoom.y + zoom.height).toBeLessThanOrEqual(phone.height)
    expect(zoom.x).toBeLessThanOrEqual(600)
    expect(zoom.y).toBeLessThanOrEqual(1600)
  })

  it('holds the whole of a wide element, and never more than the picture', () => {
    const zoom = zoomRect({ x: 20, y: 300, width: 740, height: 120 }, phone)
    expect(zoom.x).toBe(0)
    expect(zoom.width).toBe(780)
    const tall = zoomRect({ x: 0, y: 0, width: 780, height: 1688 }, phone)
    expect(tall.width).toBeLessThanOrEqual(780)
    expect(tall.height).toBeLessThanOrEqual(1688)
  })
})

// ---- what the pictures leave out ----------------------------------------------------------------------------------------------------

describe('the pictures leave the build label out', () => {
  const spec = fs.readFileSync(path.join(root, 'scripts/promo/capture.spec.mjs'), 'utf8')

  const bodyOf = (signature) => {
    const start = spec.indexOf(signature)
    expect(start, signature).toBeGreaterThan(-1)
    return spec.slice(start, spec.indexOf('\n}\n', start))
  }

  it('finds the label by the class of the real component, and hides it without taking it out of the layout', () => {
    const label = fs.readFileSync(path.join(root, 'src/ui/BuildLabel.jsx'), 'utf8')
    expect(label).toMatch(/className=\{`w-build\b/)
    expect(label).not.toMatch(/style=/) // so that taking the hiding away gives the label its own look back
    expect(spec).toMatch(/^const BUILD_LABEL = '\.w-build'$/m)
    const set = bodyOf('async function setBuildLabels(')
    expect(set).toContain('page.locator(BUILD_LABEL).evaluateAll(')
    // visibility, not display: nothing on the screen moves, so every box stays where it was measured; through each label's own style,
    // since the preview's Content-Security-Policy refuses the <style> element that the `style` option of page.screenshot would add
    expect(set).toContain("label.style.setProperty('visibility', value, 'important')")
    expect(set).toContain("label.style.removeProperty('visibility')")
    expect(set).not.toMatch(/\bdisplay\b/)
  })

  it('takes every picture in shot, with the labels hidden right before it and shown again right after it', () => {
    expect(spec.match(/\.screenshot\(/g)).toHaveLength(1) // no other picture is taken anywhere in the spec
    const lines = bodyOf('async function shot(').split('\n').map((line) => line.trim())
    const at = lines.findIndex((line) => line.startsWith('await page.screenshot('))
    expect(at, 'shot takes the picture').toBeGreaterThan(0)
    expect(lines[at - 1]).toMatch(/^await setBuildLabels\(page, 'hidden'\)/)
    expect(lines[at + 1]).toBe("await setBuildLabels(page, '')")
  })
})

// ---- the privacy notice of the sign-in list -----------------------------------------------------------------------------------------

describe('the privacy notice is recorded where the sign-in list has it now (#371)', () => {
  const spec = fs.readFileSync(path.join(root, 'scripts/promo/capture.spec.mjs'), 'utf8')
  const components = fs.readFileSync(path.join(root, 'src/worker/components.jsx'), 'utf8')
  /** The trimmed lines of the spec from the first one that starts with `first` to the next one after it that starts with `last`. */
  const linesBetween = (first, last) => {
    const lines = spec.split('\n').map((line) => line.trim())
    const from = lines.findIndex((line) => line.startsWith(first))
    expect(from, first).toBeGreaterThan(-1)
    const to = lines.findIndex((line, n) => n > from && line.startsWith(last))
    expect(to, last).toBeGreaterThan(from)
    return lines.slice(from, to + 1)
  }

  it('finds the button above the list by its role and its name, as the real component draws it, and no longer the note under the list', () => {
    // The component's button is named by the same line of the dictionary (its role and name are what the spec finds it by)
    expect(components).toMatch(/<button\b[^\n]*>\{t\('privacy\.title'\)\}<\/button>/) // (its onClick holds an arrow, so not [^>]*)
    expect(heDict['privacy.title']).toBeTruthy()
    expect(spec).toContain("const privacy = page.getByRole('button', { name: he['privacy.title'] })")
    expect(linesBetween("await shot(page, 'provider-list.png', {", '})')).toContain('privacy,')
    expect(spec).not.toContain("startOf(he['login.privacy'])") // the old box: the start of the note's text, under the list
    expect(BOXES['provider-list.png']).toEqual(['list-top', 'name-row', 'privacy'])
  })

  it('takes the sheet open over the list, with the boxes of the sheet and of its link to the whole notice, and closes it before the sign-in', () => {
    // The sheet is a dialog named by its title (src/worker/Sheet.jsx), and its link is named by `privacy.open`
    expect(components).toMatch(/<Sheet\b[^>]*\btitle=\{t\('privacy\.title'\)\}/)
    expect(components).toMatch(/<a\b[^>]*\bhref="\/privacy"[^>]*>\{t\('privacy\.open'\)\}<\/a>/)
    expect(PROMO_PICTURES).toContain('provider-privacy-sheet.png')
    expect(BOXES['provider-privacy-sheet.png']).toEqual(['sheet', 'full-notice'])
    const steps = linesBetween("await shot(page, 'provider-list.png', {", 'await me.click()')
    const order = [
      'await privacy.click()',
      "const sheet = page.getByRole('dialog', { name: he['privacy.title'] })",
      "await expect(sheet.getByText(he['login.privacy'])).toBeVisible()",
      "await shot(page, 'provider-privacy-sheet.png', { sheet, 'full-notice': sheet.getByRole('link', { name: he['privacy.open'] }) })",
      "await page.keyboard.press('Escape')",
      'await expect(sheet).toHaveCount(0)',
    ].map((line) => steps.indexOf(line))
    for (const index of order) expect(index).toBeGreaterThan(-1)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    // The sheet is gone when the cleaner taps her name (nothing but a comment in between), so the pictures after it are taken as before.
    expect(steps.slice(order.at(-1) + 1, -1).every((line) => line === '' || line.startsWith('//')), steps.join('\n')).toBe(true)
  })
})
