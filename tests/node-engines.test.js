// engines.node in package.json is the Node that the project says it runs on: npm checks it, Vercel takes its major from
// it (docs/install.md) and an installer reads it. npm also checks the engines of every installed package that is not
// optional, on every install (`#checkEngineAndPlatform` in @npmcli/arborist), and warns, or fails under engine-strict,
// when the running Node is outside a range. So engines.node must not promise a Node version that an installed package
// refuses: on 13/10/2026 it said 24.x while jsdom and three of its dependencies asked for ^24.15.0 (#204). When this
// fails, raise engines.node to a range that every listed package accepts (and the docs that name it, CONTRIBUTING.md
// and docs/install.md), or keep the package at a version that accepts the current range. `semver` is a devDependency
// for this test only: it is the library that npm itself compares with.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import semver from 'semver'

const root = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
const pkg = JSON.parse(fs.readFileSync(`${root}/package.json`, 'utf8'))
const lock = JSON.parse(fs.readFileSync(`${root}/package-lock.json`, 'utf8'))

// How npm compares (checkEngine in npm-install-checks): a Node prerelease counts.
const NPM = { includePrerelease: true }

/**
 * The packages of a lockfile that refuse a Node version that `range` accepts, as "name@version wants node <range>".
 * The root entry is the project itself, and npm never checks an optional package (a native binary for one platform).
 * A range that semver cannot read refuses every version, as it does in npm.
 */
function refusers(range, packages) {
  const found = []
  for (const [path, entry] of Object.entries(packages)) {
    const wanted = entry.engines?.node
    if (path === '' || entry.optional || typeof wanted !== 'string') continue
    if (semver.validRange(wanted, NPM) && semver.subset(range, wanted, NPM)) continue
    found.push(`${path.replace(/^.*node_modules\//, '')}@${entry.version} wants node ${wanted}`)
  }
  return found
}

describe('engines.node', () => {
  it('is a range that npm reads, and the lockfile says the same', () => {
    expect(semver.validRange(pkg.engines?.node, NPM)).toBeTruthy()
    expect(lock.packages[''].engines).toEqual(pkg.engines)
  })

  it('promises no Node version that an installed package refuses', () => {
    expect(refusers(pkg.engines.node, lock.packages), 'raise engines.node, or hold these packages back').toEqual([])
  })
})

describe('the check itself', () => {
  const JSDOM = '^22.22.2 || ^24.15.0 || >=26.0.0' // jsdom 30's range, the case of 13/10/2026
  const packages = {
    '': { name: 'building-qr-system', engines: { node: '24.x' } },
    'node_modules/jsdom': { version: '30.1.2', engines: { node: JSDOM } },
    'node_modules/old': { version: '1.0.0', engines: { node: '>=18' } },
    'node_modules/@napi-rs/binary': { version: '1.0.0', optional: true, engines: { node: '^24.12' } },
    'node_modules/plain': { version: '1.0.0' },
  }

  it('finds the package that refuses part of the range, and skips an optional one', () => {
    expect(refusers('24.x', packages)).toEqual([`jsdom@30.1.2 wants node ${JSDOM}`])
    expect(refusers('^24.15.0', packages)).toEqual([])
  })

  it('names a nested or scoped package, and refuses a range that semver cannot read', () => {
    const nested = { 'node_modules/a/node_modules/@s/b': { version: '2.0.0', engines: { node: '^24.15.0' } } }
    expect(refusers('24.x', nested)).toEqual(['@s/b@2.0.0 wants node ^24.15.0'])
    const unreadable = { 'node_modules/odd': { version: '1.0.0', engines: { node: 'node >= 8' } } }
    expect(refusers('24.x', unreadable)).toEqual(['odd@1.0.0 wants node node >= 8'])
  })
})
