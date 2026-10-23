// The system packages of the Playwright browser in CI (.github/workflows/e2e.yml): the package files that
// `npx playwright install --with-deps` downloads with apt-get are kept in a GitHub Actions cache, and the next run hands
// them back to apt-get, which then installs them without downloading them again.
//
// Why: the runner's Ubuntu mirror (azure.archive.ubuntu.com) has served those files at 25 to 50 kB/s on a bad day, and
// WebKit needs 117 MB of them (181 new packages), Chromium 26 MB. On 22/10/2026 the WebKit install failed about 8 times,
// each time after three attempts of 5 minutes and before any test ran (run 39784358420, #317), and on 23/10/2026 a
// Chromium part of a green master run spent 9 of its 12 minutes there (run 39889492578). The browser itself comes from
// Playwright's CDN in seconds (7 seconds for Chromium in that run), and
// Playwright's CI page advises against caching it (restoring takes about as long as downloading), so only apt-get's files
// are kept. They are still installed by apt-get on every run, as before.
//
// Usage, on the Linux runner, after `npm ci`:
//   node scripts/ci-browser-packages.mjs key <browser>   writes dir=, key= and prefix= to $GITHUB_OUTPUT (and prints them)
//   node scripts/ci-browser-packages.mjs restore         copies the cached files that match the index into apt's archive
//   node scripts/ci-browser-packages.mjs keep            copies the files of the installed packages into the cache folder
//
// The key is the Ubuntu release, the architecture, the browser, the Playwright version and the week, so a run finds the
// files of this week's package versions; the prefix (any Playwright version, any week) is the fallback, after which only
// what changed is downloaded. A run that did not find its key saves a new one.
//
// What makes a cached file safe to install: apt-get takes a file in its archive folder when its name and size match the
// package version it chose, without checking its hash (the constructor of pkgAcqArchive in apt's
// apt-pkg/acquire-item.cc, read 23/10/2026). So `restore` hands it only a file whose SHA256 is the one that the Ubuntu
// index lists for that package, version and architecture, read with apt-cache after an apt-get update (which checks the
// index's signature), under the name that apt-get itself would give the file. Any other file is left out, and apt-get
// downloads that package as it would without a cache: the cache saves time and never changes what is installed.
//
// `restore` and `keep` never fail the job: when one goes wrong it prints a warning, and apt-get downloads what is
// missing. Node built-ins only.
import { execFileSync, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { isMain } from './ci-git.mjs'

export const ARCHIVES = '/var/cache/apt/archives'
export const CACHE_DIR = path.join(os.homedir(), '.cache', 'browser-packages')
export const KEY_PREFIX = 'playwright-packages'
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const BROWSER = /^[a-z][a-z0-9-]{0,30}$/
const RELEASE_VALUE = /^[A-Za-z0-9.]{1,20}$/
const VERSION = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$/
const SHA256 = /^[0-9a-f]{64}$/

/** apt's QuoteString(value, bad): each byte that is in `bad`, a %, a space or a control or non-ASCII byte becomes %xx. */
export function quote(value, bad) {
  let out = ''
  for (const byte of Buffer.from(String(value), 'utf8')) {
    const char = String.fromCharCode(byte)
    out += bad.includes(char) || byte === 0x25 || byte <= 0x20 || byte >= 0x7f ? `%${byte.toString(16).padStart(2, '0')}` : char
  }
  return out
}

/** The name that apt-get gives the file of a package version in its archive folder (StoreFilename in pkgAcqArchive). */
export function archiveName({ name, version, arch }) {
  return `${quote(name, '_:')}_${quote(version, '_:')}_${quote(arch, '_:.')}.deb`
}

/** The package version that an archive file name stands for, or null for a name that apt-get would not have written. */
export function parseArchiveName(file) {
  const match = /^([^_/]+)_([^_/]+)_([^_/]+)\.deb$/.exec(String(file))
  if (!match) return null
  try {
    const [name, version, arch] = match.slice(1).map((part) => decodeURIComponent(part))
    const parsed = { name, version, arch }
    return archiveName(parsed) === file ? parsed : null
  } catch {
    return null
  }
}

/**
 * The SHA256 of each package version in the records that `apt-cache show` prints, by the archive file name of the version.
 * A name that two records give different hashes is left out, so that no file can match it.
 */
export function indexHashes(text) {
  const hashes = new Map()
  const conflicts = new Set()
  for (const record of String(text).split(/\n[ \t]*\n/)) {
    const field = (key) => new RegExp(`^${key}: *(\\S+) *$`, 'm').exec(record)?.[1]
    const [name, version, arch, sha256] = ['Package', 'Version', 'Architecture', 'SHA256'].map(field)
    if (!name || !version || !arch || !SHA256.test(sha256 ?? '')) continue
    const file = archiveName({ name, version, arch })
    if (hashes.has(file) && hashes.get(file) !== sha256) conflicts.add(file)
    hashes.set(file, sha256)
  }
  for (const file of conflicts) hashes.delete(file)
  return hashes
}

/** The cached files to hand to apt-get: those whose SHA256 is the one that the index gives their name. */
export function matchingFiles(files, hashes) {
  return files.filter(({ file, sha256 }) => SHA256.test(sha256) && hashes.get(file) === sha256)
}

/** The archive file names of the installed packages, from `dpkg-query -W` with the format of keepCommand. */
export function installedNames(text) {
  const names = new Set()
  for (const line of String(text).split('\n')) {
    const [status, name, version, arch] = line.split('\t')
    if (status?.startsWith('ii') && name && version && arch) names.add(archiveName({ name, version, arch }))
  }
  return names
}

/** ID and VERSION_ID of /etc/os-release. */
export function parseOsRelease(text) {
  const values = {}
  for (const line of String(text).split('\n')) {
    const match = /^([A-Z_]+)=(?:"([^"]*)"|(\S*))$/.exec(line.trim())
    if (match) values[match[1]] = match[2] ?? match[3]
  }
  return { id: values.ID, versionId: values.VERSION_ID }
}

/** The cache key of this week and the prefix that any earlier key of the same system and browser starts with. */
export function cacheKey({ id, versionId, arch, browser, playwright, now }) {
  if (!RELEASE_VALUE.test(id ?? '') || !RELEASE_VALUE.test(versionId ?? '')) throw new Error('unknown Linux release')
  if (!RELEASE_VALUE.test(arch ?? '')) throw new Error('unknown architecture')
  if (!BROWSER.test(browser ?? '')) throw new Error('the browser must be a Playwright browser name, such as webkit')
  if (!VERSION.test(playwright ?? '')) throw new Error('unknown Playwright version')
  const prefix = `${KEY_PREFIX}-${id}-${versionId}-${arch}-${browser}-`
  return { prefix, key: `${prefix}${playwright}-w${Math.floor(now / WEEK_MS)}` }
}

/** The .deb files directly in a folder (none when it does not exist), by name. */
function debFiles(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.deb'))
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
}

const megabytes = (dir, files) => (files.reduce((sum, file) => sum + fs.statSync(path.join(dir, file)).size, 0) / 1e6).toFixed(1)

function keyCommand(browser) {
  const { id, versionId } = parseOsRelease(fs.readFileSync('/etc/os-release', 'utf8'))
  const playwright = createRequire(import.meta.url)('playwright-core/package.json').version
  const { prefix, key } = cacheKey({ id, versionId, arch: process.arch, browser, playwright, now: Date.now() })
  const lines = [`dir=${CACHE_DIR}`, `key=${key}`, `prefix=${prefix}`]
  console.log(lines.join('\n'))
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`)
}

function restoreCommand() {
  const cached = debFiles(CACHE_DIR)
  const versions = cached.map(parseArchiveName).filter(Boolean)
  if (versions.length === 0) {
    console.log('No package files in the cache: apt-get downloads every package.')
    return
  }
  // The index that the hashes come from, fresh and with its signature checked.
  execFileSync('sudo', ['apt-get', 'update', '-qq'], { stdio: 'inherit', timeout: 120_000 })
  // One call for every version. A version that the index no longer has prints a notice and is simply not in the output, so
  // the records are read whatever the exit status.
  const shown = spawnSync('apt-cache', ['show', ...versions.map((v) => `${v.name}=${v.version}`)], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: 120_000,
  })
  if (shown.error) throw shown.error
  const hashes = indexHashes(shown.stdout)
  const files = cached.map((file) => ({ file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(CACHE_DIR, file))).digest('hex') }))
  const matching = matchingFiles(files, hashes).map(({ file }) => file)
  if (matching.length > 0) execFileSync('sudo', ['cp', '-t', ARCHIVES, '--', ...matching.map((file) => path.join(CACHE_DIR, file))], { stdio: 'inherit' })
  console.log(
    `${matching.length} of ${cached.length} cached package files (${megabytes(CACHE_DIR, matching)} MB) match the Ubuntu index and ` +
      `go to apt-get; the other ${cached.length - matching.length} (a version that the index no longer has, or a changed file) are ` +
      'left out, and apt-get downloads what it needs instead.',
  )
}

function keepCommand() {
  const installed = installedNames(
    execFileSync('dpkg-query', ['-W', '-f', '${db:Status-Abbrev}\\t${Package}\\t${Version}\\t${Architecture}\\n'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }),
  )
  const kept = debFiles(ARCHIVES).filter((file) => installed.has(file))
  fs.rmSync(CACHE_DIR, { recursive: true, force: true })
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  for (const file of kept) fs.copyFileSync(path.join(ARCHIVES, file), path.join(CACHE_DIR, file))
  if (kept.length === 0) console.log(`::warning::No package file of an installed package is in ${ARCHIVES}: the cache stays empty.`)
  else console.log(`Kept ${kept.length} package files of installed packages (${megabytes(CACHE_DIR, kept)} MB) for the next runs.`)
}

if (isMain(import.meta.url)) {
  const [command, browser] = process.argv.slice(2)
  if (command === 'key') keyCommand(browser)
  else if (command === 'restore' || command === 'keep') {
    try {
      if (command === 'restore') restoreCommand()
      else keepCommand()
    } catch (error) {
      const reason = error instanceof Error ? error.message.split('\n')[0] : String(error)
      const effect = command === 'restore' ? 'apt-get downloads every package' : 'the next run downloads the packages again'
      console.log(`::warning::The cache of the browser's system packages was not used (${command}: ${reason}): ${effect}.`)
    }
  } else {
    console.error('Usage: node scripts/ci-browser-packages.mjs key <browser> | restore | keep')
    process.exit(2)
  }
}
