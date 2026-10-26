// The cache of the browser's system packages in CI (scripts/ci-browser-packages.mjs, run by .github/workflows/e2e.yml): a
// cached file reaches apt-get only under the name apt-get would give it and with the SHA256 of the Ubuntu index, the cache
// keeps only the files of installed packages (those of a variant build such as amd64v3 too), and the key changes with the
// format of the cache, the release, the browser, Playwright and the week.
// The commands themselves run apt-get and sudo, so CI shows them; these are the parts that decide.
import { describe, it, expect } from 'vitest'
import {
  archiveName,
  cacheKey,
  indexHashes,
  installedFiles,
  matchingFiles,
  parseArchiveName,
  parseOsRelease,
  quote,
} from '../scripts/ci-browser-packages.mjs'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

/**
 * A record as `apt-cache show` prints it, with the fields that matter and a few that do not. A variant build has its
 * Architecture-Variant near the end, where resolute's amd64v3 index has it.
 */
const record = ({ name, version, arch, sha256, variant = '' }) =>
  [
    `Package: ${name}`,
    `Architecture: ${arch}`,
    `Version: ${version}`,
    'Priority: optional',
    `Filename: pool/universe/${name[0]}/${name}/${name}_${version.replace(/^\d+:/, '')}_${variant || arch}.deb`,
    'Size: 107284',
    `SHA256: ${sha256}`,
    'Description: a package',
    ...(variant ? [`Architecture-Variant: ${variant}`] : []),
    'Multi-Arch: same',
  ].join('\n')

describe('archiveName and parseArchiveName', () => {
  it('names a file as apt-get does, with the epoch colon quoted', () => {
    expect(archiveName({ name: 'fonts-tlwg-loma-otf', version: '1:0.7.3-1', arch: 'all' })).toBe('fonts-tlwg-loma-otf_1%3a0.7.3-1_all.deb')
    expect(archiveName({ name: 'libglib2.0-0t64', version: '2.80.0-6ubuntu3.10', arch: 'amd64' })).toBe('libglib2.0-0t64_2.80.0-6ubuntu3.10_amd64.deb')
  })

  it('names the file of a variant build after the variant, as apt-get does on Ubuntu 26.04', () => {
    const version = { name: 'libproxy1v5', version: '0.5.12-1', arch: 'amd64', variant: 'amd64v3' }
    expect(archiveName(version)).toBe('libproxy1v5_0.5.12-1_amd64v3.deb')
    expect(archiveName({ ...version, variant: '' })).toBe('libproxy1v5_0.5.12-1_amd64.deb')
    expect(parseArchiveName('libproxy1v5_0.5.12-1_amd64v3.deb')).toEqual({ name: 'libproxy1v5', version: '0.5.12-1', arch: 'amd64v3' })
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

  it('refuses a name, version or architecture that Debian does not allow, so that none can become an option of apt-cache', () => {
    for (const file of [
      '-o_APT%3a%3aCompressor%3a%3alz4%3a%3aBinary=sh_all.deb', // round-trips, but the name is an option
      '--option_1.0_amd64.deb',
      'fonts_-o_all.deb',
      'fonts_1.0_-all.deb',
      'Fonts_1.0_all.deb', // upper case
      'f_1.0_all.deb', // one character
      'fonts_1.0%3dx_all.deb', // = in the version
      'fonts_1.0_amd64%2c.deb',
    ])
      expect(parseArchiveName(file), file).toBeNull()
    expect(parseArchiveName('libc6_2.39-0ubuntu8.6_amd64.deb')).toEqual({ name: 'libc6', version: '2.39-0ubuntu8.6', arch: 'amd64' })
    expect(parseArchiveName('libstdc++6_14.2.0-4ubuntu2~24.04_amd64.deb')).toEqual({ name: 'libstdc++6', version: '14.2.0-4ubuntu2~24.04', arch: 'amd64' })
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

  it('gives a variant build its SHA256 under the name with its variant, apart from a plain build of the same version', () => {
    const version = { name: 'libproxy1v5', version: '0.5.12-1', arch: 'amd64' }
    const text = [record({ ...version, variant: 'amd64v3', sha256: HASH_A }), record({ ...version, sha256: HASH_B })].join('\n\n')
    expect(Object.fromEntries(indexHashes(text))).toEqual({
      'libproxy1v5_0.5.12-1_amd64v3.deb': HASH_A,
      'libproxy1v5_0.5.12-1_amd64.deb': HASH_B,
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

describe('installedFiles', () => {
  const text = [
    'ii \tfonts-tlwg-loma-otf\t1:0.7.3-1\tall',
    'rc \told-package\t1.0\tamd64',
    'ii \tlibva2\t2.20.0-2ubuntu0.2\tamd64',
    'ii \tlibproxy1v5\t0.5.12-1\tamd64',
    'ii \tlib32-only\t1.0\ti386',
    '',
  ].join('\n')

  it('keeps the files of the installed packages only', () => {
    const files = [
      'fonts-tlwg-loma-otf_1%3a0.7.3-1_all.deb',
      'libva2_2.20.0-2ubuntu0.2_amd64.deb',
      'old-package_1.0_amd64.deb', // removed, its configuration left
      'libva2_2.20.0-2ubuntu0.1_amd64.deb', // another version than the installed one
      'not-installed_1.0_all.deb',
    ]
    expect(installedFiles(files, text)).toEqual(['fonts-tlwg-loma-otf_1%3a0.7.3-1_all.deb', 'libva2_2.20.0-2ubuntu0.2_amd64.deb'])
  })

  it('keeps the file of a variant build, which dpkg reports under its architecture', () => {
    expect(installedFiles(['libproxy1v5_0.5.12-1_amd64v3.deb'], text)).toEqual(['libproxy1v5_0.5.12-1_amd64v3.deb'])
  })

  it('leaves out a file of another architecture than the installed one, and a name that apt-get would not have written', () => {
    expect(installedFiles(['lib32-only_1.0_amd64.deb', 'libva2_2.20.0-2ubuntu0.2_i386.deb', 'libva2_2.20.0-2ubuntu0.2.deb'], text)).toEqual([])
  })
})

describe('cacheKey', () => {
  const base = { id: 'ubuntu', versionId: '24.04', arch: 'x64', browser: 'webkit', playwright: '1.63.0' }
  const week = 7 * 24 * 60 * 60 * 1000

  it('is the format, the release, the architecture, the browser, the Playwright version and the week', () => {
    const now = 2911 * week + 1000
    expect(cacheKey({ ...base, now })).toEqual({
      prefix: 'playwright-packages-v2-ubuntu-24.04-x64-webkit-',
      key: 'playwright-packages-v2-ubuntu-24.04-x64-webkit-1.63.0-w2911',
    })
  })

  it('finds no entry of the earlier format, whose files of a variant build are missing', () => {
    const { prefix } = cacheKey({ ...base, versionId: '26.04', now: 2964 * week })
    expect('playwright-packages-ubuntu-26.04-x64-webkit-1.63.0-w2964'.startsWith(prefix)).toBe(false)
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
