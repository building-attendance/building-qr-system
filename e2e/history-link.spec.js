// A link can open the History tab with its filters set: `/admin#history?provider=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD&outcome=<type>`
// (src/admin/views/HistoryView.jsx, `readLink`). The list is asked for with the link's filters from the first request on, and the address
// becomes a plain `#history` afterwards. The component tests (tests/components/history-link.test.jsx) cover every parameter and every
// transition; this spec opens the real app, in the two layouts, from a link that is followed on the page and from a page that is loaded
// with it.
//
// Like the filters spec, it answers the History tab's list itself (`stubScans`), narrowed by `provider_id` the way the server does, and keeps
// every request: a real visit would be a provider signing in, and the run has a limited number of those (e2e/visual.spec.js says why).
import { test, expect, adminSignIn, allowConsoleErrors } from './fixtures.js'
import { SAMPLE_PROVIDER_NAMES } from '../scripts/sample-data.mjs'

const COMPUTER = { width: 1280, height: 800 }
const DELETED_PROVIDER = '00000000-0000-4000-8000-0000000000de' // well formed, and not in the list of providers: the id of a provider that the committee deleted

// The service worker would answer the requests of a page that is loaded again, and a stub (`page.route`) does not see those in WebKit: this spec
// loads the page again on purpose (a link as the first address of a page, and a reload).
test.use({ serviceWorkers: 'block' })

test.beforeEach(({ page }) => {
  // The sign-in screen asks /api/admin/me before anyone is signed in: the browser notes that 401 as a console error.
  allowConsoleErrors(page, /status of 401/)
})

/** One visit as the list of the History tab holds it (the shape of `scanJson` in server/scans.js), by `provider`. */
const visit = (n, provider, who) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  checked_in_at: '2026-03-02T10:40:00.000Z',
  checked_in_local: '2026-03-02T10:40:00.000Z',
  local_date: '2026-03-02',
  point_id: '00000000-0000-4000-8000-000000000a01',
  point_name: 'לובי',
  provider_id: provider.id,
  provider_name: who,
  service_type: 'cleaning',
  source: 'online',
  outcome: 'accepted',
  distance_m: null,
  gps_accuracy_m: null,
  flags: [],
  voided: false,
  void_reason: null,
})

/**
 * Answers the History tab's list with one visit of each of the two sample providers, narrowed by `provider_id`, and keeps the query of
 * every request (`asked`, as URLSearchParams). Call it after signing in and before the link is opened.
 */
async function stubScans(page) {
  const providers = (await (await page.request.get('/api/admin/providers')).json()).providers
  const ploni = providers.find((p) => p.contact_name === SAMPLE_PROVIDER_NAMES.cleaner)
  const almoni = providers.find((p) => p.contact_name === SAMPLE_PROVIDER_NAMES.gardener)
  const visits = [visit(1, ploni, 'פלוני (ניקיון)'), visit(2, almoni, 'אלמוני (גינון)')]
  const asked = []
  await page.route(/\/api\/admin\/scans\?/, (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const query = new URL(route.request().url()).searchParams
    asked.push(query)
    const scans = visits.filter((v) => !query.get('provider_id') || v.provider_id === query.get('provider_id'))
    return route.fulfill({ json: { scans, next_cursor: null } })
  })
  return { asked, ploni, almoni }
}

const rows = (page) => page.getByRole('listitem')
const historyHeading = (page) => page.getByRole('heading', { level: 1, name: 'היסטוריית נוכחות' })

test('a link followed on the page opens History with its filters, in the layout of the phone, and the address becomes #history', async ({ page }) => {
  await adminSignIn(page, 'points')
  const { asked, ploni } = await stubScans(page)

  await page.goto(`/admin#history?provider=${ploni.id}&from=2026-03-01&to=2026-03-31`)
  await expect(historyHeading(page)).toBeVisible()
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toContainText('פלוני (ניקיון)')
  await expect(page.getByText('אלמוני (גינון)')).toHaveCount(0)

  // the first request already carries the link's filters: no request of the defaults came before it, and none comes after it
  await expect(page).toHaveURL(/#history$/)
  await page.waitForTimeout(600) // longer than the pause before a query on a computer
  expect(asked, 'one request').toHaveLength(1)
  expect(Object.fromEntries(asked[0])).toMatchObject({ provider_id: ploni.id, from: '2026-03-01', to: '2026-03-31' })

  // the filters of the link are on the screen: the bar's dates and a chip (a phone), and the count
  await expect(page.getByText(/01\/03\/2026 עד 31\/03\/2026/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'הסרת סינון: נותן שירות: ' + SAMPLE_PROVIDER_NAMES.cleaner })).toBeVisible()
  await expect(page.getByRole('button', { name: /^סינון/ })).toHaveAccessibleName(/^סינון\s*2\s*פעילים$/) // the dates count once

  // the back button goes to the tab that the link was followed from
  await page.goBack()
  await expect(page.getByRole('heading', { level: 1, name: 'נקודות סריקה' })).toBeVisible()
  await expect(page).toHaveURL(/#points$/)
})

test('a link to a provider that the list of providers does not hold (a deleted one) keeps the provider filter, and says so', async ({ page }) => {
  await adminSignIn(page, 'points')
  const { asked } = await stubScans(page) // the stub answers an id that it does not know with no visits, as the server does

  await page.goto(`/admin#history?provider=${DELETED_PROVIDER}&from=2026-03-01&to=2026-03-31`)
  await expect(historyHeading(page)).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'אין נוכחויות בטווח הזה' })).toBeVisible()
  await expect(rows(page)).toHaveCount(0) // never the visits of everyone
  await expect(page).toHaveURL(/#history$/)
  await page.waitForTimeout(600)
  expect(asked, 'one request').toHaveLength(1)
  expect(Object.fromEntries(asked[0])).toMatchObject({ provider_id: DELETED_PROVIDER, from: '2026-03-01', to: '2026-03-31' })
  await expect(page.getByRole('button', { name: 'הסרת סינון: נותן שירות שנמחק' })).toBeVisible()

  // the chip removes the filter, and then every provider's visits are asked for and shown
  await page.getByRole('button', { name: 'הסרת סינון: נותן שירות שנמחק' }).click()
  await expect(rows(page)).toHaveCount(2)
  expect(asked.at(-1).get('provider_id')).toBeNull()
})

test.describe('on a computer', () => {
  test.use({ viewport: COMPUTER })

  test('a provider that the list does not hold has an option of its own in the select, which goes with another choice', async ({ page }) => {
    await adminSignIn(page, 'points')
    const { asked } = await stubScans(page)

    await page.goto(`/admin#history?provider=${DELETED_PROVIDER}`)
    await expect(historyHeading(page)).toBeVisible()
    const select = page.getByLabel('נותן שירות')
    await expect(select).toHaveValue(DELETED_PROVIDER)
    await expect(select.locator('option:checked')).toHaveText('נותן שירות שנמחק')
    await expect(rows(page)).toHaveCount(0)
    expect(asked.at(-1).get('provider_id')).toBe(DELETED_PROVIDER)

    await select.selectOption({ label: 'כולם' })
    await expect(rows(page)).toHaveCount(2)
    await expect(select.locator('option', { hasText: 'נותן שירות שנמחק' })).toHaveCount(0)
    expect(asked.at(-1).get('provider_id')).toBeNull()
  })

  test('a page that is loaded with a link shows its filters in the fields, and a reload opens the defaults', async ({ page }) => {
    await adminSignIn(page, 'points')
    const { asked, almoni } = await stubScans(page)

    await page.goto('about:blank') // a new page load, signed in, with the link as the first address
    await page.goto(`/admin#history?provider=${almoni.id}&from=2026-03-01&to=2026-03-31&outcome=all`)
    await expect(historyHeading(page)).toBeVisible()
    await expect(rows(page)).toHaveCount(1)
    await expect(rows(page).first()).toContainText('אלמוני (גינון)')
    await expect(page.getByText('פלוני (ניקיון)')).toHaveCount(0)
    await expect(page).toHaveURL(/#history$/)

    // the inline fields say what the link says, and there is no bar
    await expect(page.getByLabel('נותן שירות')).toHaveValue(almoni.id)
    await expect(page.getByLabel('מתאריך')).toHaveValue('01/03/2026')
    await expect(page.getByLabel('עד תאריך')).toHaveValue('31/03/2026')
    await expect(page.getByLabel('סוג')).toHaveValue('all')
    await expect(page.getByRole('button', { name: /^סינון/ })).toHaveCount(0)

    await page.waitForTimeout(600)
    expect(asked, 'one request, with the filters of the link').toHaveLength(1)
    expect(Object.fromEntries(asked[0])).toMatchObject({ provider_id: almoni.id, from: '2026-03-01', to: '2026-03-31', outcome: 'all' })

    // the address is the plain #history, so a reload opens the defaults (the link was an instruction, not a place to return to)
    await page.reload()
    await expect(historyHeading(page)).toBeVisible()
    await expect(rows(page)).toHaveCount(2)
    await expect(page.getByLabel('נותן שירות')).toHaveValue('')
    expect(asked.at(-1).get('provider_id')).toBeNull()
    expect(asked.at(-1).get('outcome')).toBe('accepted')
    await expect(page).toHaveURL(/#history$/)
  })
})
