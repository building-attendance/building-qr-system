// The cache of the browser's system packages in CI (scripts/ci-browser-packages.mjs, run by .github/workflows/e2e.yml): a
// cached file reaches apt-get only under the name apt-get would give it and with the SHA256 of the Ubuntu index, the cache
// keeps only the files of installed packages, and the key changes with the release, the browser, Playwright and the week.
// The commands themselves run apt-get and sudo, so CI shows them; these are the parts that decide.
import { describe, it, expect } from 'vitest'
import {
  archiveName,
  cacheKey,
  indexHashes,
  installedNames,
  matchingFiles,
  parseArchiveName,
  parseOsRelease,
  quote,
} from '../scripts/ci-browser-packages.mjs'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

/** A record as `apt-cache show` prints it, with the fields that matter and a few that do not. */
const record = ({ name, version, arch, sha256 }) =>
  [
    `Package: ${name}`,
    `Architecture: ${arch}`,
    `Version: ${version}`,
    'Priority: optional',
    `Filename: pool/universe/${name[0]}/${name}/${name}_${version.replace(/^\d+:/, '')}_${arch}.deb`,
    'Size: 107284',
    `SHA256: ${sha256}`,
    'Description: a package',
  ].join('\n')

describe('archiveName and parseArchiveName', () => {
  it('names a file as apt-get does, with the epoch colon quoted', () => {
    expect(archiveName({ name: 'fonts-tlwg-loma-otf', version: '1:0.7.3-1', arch: 'all' })).toBe('fonts-tlwg-loma-otf_1%3a0.7.3-1_all.deb')
    expect(archiveName({ name: 'libglib2.0-0t64', version: '2.80.0-6ubuntu3.10', arch: 'amd64' })).toBe('libglib2.0-0t64_2.80.0-6ubuntu3.10_amd64.deb')
  })

  it('quotes a %, a space and a byte outside ASCII like QuoteString, in lower case', () => {
    expect(quote('a%b c:d_e', '_:')).toBe('a%25b%20c%3ad%5fe')
    expect(quote('é', '')).toBe('%c3%a9')
  })

  it('reads a name back into its package version', () => {
    expect(parseArchiveName('fonts-tlwg-loma-otf_1%3a0.7.3-1_all.deb')).toEqual({ name: 'fonts-tlwg-loma-otf', version: '1:0.7.3-1', arch: 'all' })
  })

  it('refuses a name that apt-get would not have written', () => {
    for (const file of [
      'fonts-tlwg-loma-otf_1:0.7.3-1_all.deb', // the colon unquoted
      'fonts_1%3A0.7_all.deb', // upper-case hex
      'a_b_c_d.deb',
      'a_b.deb',
      'a_b_c.udeb',
      '../a_b_c.deb',
      'a_%zz_c.deb',
    ])
      expect(parseArchiveName(file), file).toBeNull()
  })
})

describe('indexHashes', () => {
  it('gives each version of the records its SHA256, under its archive file name', () => {
    const text = [
      record({ name: 'fonts-tlwg-loma-otf', version: '1:0.7.3-1', arch: 'all', sha256: HASH_A }),
      record({ name: 'libglib2.0-0t64', version: '2.80.0-6ubuntu3.10', arch: 'amd64', sha256: HASH_B }),
    ].join('\n\n')
    expect(Object.fromEntries(indexHashes(text))).toEqual({
      'fonts-tlwg-loma-otf_1%3a0.7.3-1_all.deb': HASH_A,
      'libglib2.0-0t64_2.80.0-6ubuntu3.10_amd64.deb': HASH_B,
    })
  })

  it('keeps one hash for the same version listed twice, and none for a version with two different hashes', () => {
    const same = { name: 'libva2', version: '2.20.0-2ubuntu0.2', arch: 'amd64', sha256: HASH_A }
    const twice = indexHashes([record(same), record(same)].join('\n\n'))
    expect(twice.get('libva2_2.20.0-2ubuntu0.2_amd64.deb')).toBe(HASH_A)
    const conflict = indexHashes([record(same), record({ ...same, sha256: HASH_B })].join('\n\n'))
    expect(conflict.has('libva2_2.20.0-2ubuntu0.2_amd64.deb')).toBe(false)
  })

  it('skips a record without a well-formed SHA256 or without a field it needs', () => {
    const text = [
      record({ name: 'a', version: '1', arch: 'amd64', sha256: 'abc' }),
      `Package: b\nVersion: 1\nSHA256: ${HASH_A}`,
      'N: Unable to locate package c',
    ].join('\n\n')
    expect(indexHashes(text).size).toBe(0)
  })
})

describe('matchingFiles', () => {
  const hashes = new Map([
    ['a_1_all.deb', HASH_A],
    ['b_1_all.deb', HASH_B],
  ])

  it('hands over only a file whose SHA256 is the one of the index for its name', () => {
    const files = [
      { file: 'a_1_all.deb', sha256: HASH_A },
      { file: 'b_1_all.deb', sha256: HASH_A }, // changed: not the index's hash
      { file: 'c_1_all.deb', sha256: HASH_A }, // not in the index any more
    ]
    expect(matchingFiles(files, hashes).map((f) => f.file)).toEqual(['a_1_all.deb'])
  })

  it('hands over nothing for a hash that is not a SHA256', () => {
    expect(matchingFiles([{ file: 'a_1_all.deb', sha256: undefined }], new Map([['a_1_all.deb', undefined]]))).toEqual([])
  })
})

describe('installedNames', () => {
  it('names the files of the installed packages only', () => {
    const text = ['ii \tfonts-tlwg-loma-otf\t1:0.7.3-1\tall', 'rc \told-package\t1.0\tamd64', 'ii \tlibva2\t2.20.0-2ubuntu0.2\tamd64', ''].join('\n')
    expect([...installedNames(text)].sort()).toEqual(['fonts-tlwg-loma-otf_1%3a0.7.3-1_all.deb', 'libva2_2.20.0-2ubuntu0.2_amd64.deb'])
  })
})

describe('cacheKey', () => {
  const base = { id: 'ubuntu', versionId: '24.04', arch: 'x64', browser: 'webkit', playwright: '1.63.0' }
  const week = 7 * 24 * 60 * 60 * 1000

  it('is the release, the architecture, the browser, the Playwright version and the week', () => {
    const now = 2911 * week + 1000
    expect(cacheKey({ ...base, now })).toEqual({
      prefix: 'playwright-packages-ubuntu-24.04-x64-webkit-',
      key: 'playwright-packages-ubuntu-24.04-x64-webkit-1.63.0-w2911',
    })
  })

  it('changes at the turn of the week, and each key starts with the prefix of its browser', () => {
    const before = cacheKey({ ...base, now: 2912 * week - 1 })
    const after = cacheKey({ ...base, now: 2912 * week })
    expect(before.key).not.toBe(after.key)
    expect(after.key.startsWith(before.prefix)).toBe(true)
    expect(cacheKey({ ...base, browser: 'chromium', now: 0 }).key.startsWith(before.prefix)).toBe(false)
  })

  it('refuses a value that could break the key or the output of the step', () => {
    expect(() => cacheKey({ ...base, browser: 'webkit\nkey=x', now: 0 })).toThrow(/browser/)
    expect(() => cacheKey({ ...base, playwright: 'latest', now: 0 })).toThrow(/Playwright/)
    expect(() => cacheKey({ ...base, id: undefined, now: 0 })).toThrow(/release/)
  })
})

describe('parseOsRelease', () => {
  it('reads ID and VERSION_ID, quoted or not', () => {
    const text = 'PRETTY_NAME="Ubuntu 24.04.3 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nID=ubuntu\nID_LIKE=debian\n'
    expect(parseOsRelease(text)).toEqual({ id: 'ubuntu', versionId: '24.04' })
  })
})
