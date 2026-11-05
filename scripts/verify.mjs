import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const route = { register(definition) { this.definition = definition; return () => {} } }
const record = {
  kind: 'grant',
  payload: {
    activeId: 'site-1',
    sites: [{ id: 'site-1', name: 'Test', baseUrl: 'https://newapi.example', token: ['nap', 'test_secret_123456'].join('_'), createdAt: 1 }],
  },
}
let mockNow = 1_700_000_000_000
let collectData = true
let failSave = false
let delayFetch = false
let lastRedirectMode = null
let requestNumber = 0
const originalFetch = globalThis.fetch
const originalDateNow = globalThis.Date.now
globalThis.Date.now = () => mockNow
globalThis.fetch = async (input, init = {}) => {
  lastRedirectMode = init.redirect
  if (delayFetch) await new Promise((resolve) => setTimeout(resolve, 10))
  const url = new URL(String(input))
  const json = (value) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
  if (url.pathname === '/api/status') {
    return json({ success: true, data: { quota_per_unit: 500000, custom_currency_symbol: '$' } })
  }
  if (url.pathname === '/api/user/self') {
    requestNumber += 1
    return json({ success: true, data: { id: 42, username: 'test', quota: 1000000 + requestNumber, used_quota: 200000, request_count: requestNumber } })
  }
  if (!collectData) throw new Error('unexpected detail refresh')
  if (url.pathname === '/api/log/self/stat') {
    return json({ success: true, data: { quota: requestNumber * 100, rpm: requestNumber, tpm: requestNumber * 10 } })
  }
  if (url.pathname === '/api/token/') {
    return json({ success: true, data: { items: [{ id: 7, name: 'test-key', used_quota: requestNumber * 100, remain_quota: 900, status: 1 }] } })
  }
  throw new Error(`unexpected upstream path: ${url.pathname}`)
}
const ctx = {
  credentials: {
    async readRecord(key) { assert.equal(key, 'newapi-usage/sites'); return record },
    async modifyRecord(key, mutate) {
      assert.equal(key, 'newapi-usage/sites')
      if (failSave) throw new Error('simulated credential store write failure')
      const next = await mutate(record)
      record.payload = next.payload
      return next
    },
  },
  connection: { fetch: route },
  effect(callback) { return callback() },
}

const hostSource = await readFile(new URL('../index.js', import.meta.url), 'utf8')
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')

const packageName = packageJson.name
assert.equal(typeof packageName, 'string')
assert.ok(packageName.length > 0)
assert.match(patch, new RegExp(`name: '?${packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'?`))
assert.match(client, new RegExp(`id: '${packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`))
assert.match(readme, /MIT/i)
assert.match(readme, /public repository/i)
assert.match(readme, /简体中文/)
assert.match(readme, /README\.en\.md/)
const englishReadme = await readFile(new URL('../README.en.md', import.meta.url), 'utf8')
assert.match(englishReadme, /\[简体中文\]\(README\.md\)/)
assert.ok(packageJson.files.includes('README.en.md'), 'English documentation must be included in the package')

const { apply, inject } = await import('../index.js')
assert.deepEqual(inject, ['credentials', 'connection'])
apply(ctx)
assert.equal(route.definition.path, '/api/newapi-usage')
assert.deepEqual(route.definition.methods, ['POST'])

const response = await route.definition.fetch(new Request('http://localhost/api/newapi-usage', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ op: 'state', windows: { days: [{ start: 100, end: 200 }], monthStart: 100 } }),
}))
const payload = await response.json()
assert.equal(response.status, 200)
assert.equal(payload.sites[0].tokenHint, 'nap_te…3456')
assert.equal(JSON.stringify(payload).includes(record.payload.sites[0].token), false)
assert.equal(payload.snapshots[0].user.requestCount, 1)
assert.equal(payload.snapshots[0].pending, true)
assert.equal(lastRedirectMode, 'error', 'authorization must not be forwarded across redirects')

// First data load kicks off the background detail pass.
const windows = { days: [{ start: 100, end: 200 }], monthStart: 100 }
const post = async (body) => {
  const response = await route.definition.fetch(new Request('http://localhost/api/newapi-usage', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
  return response.json()
}
let state = payload
assert.equal(state.snapshots[0].pending, true)
await new Promise((resolve) => setImmediate(resolve))
state = await post({ op: 'state', windows })
assert.equal(state.snapshots[0].pending, false)
assert.equal(state.snapshots[0].user.requestCount, 1)
assert.equal(state.snapshots[0].trend[0].quota, 100)

// Distinct windows with the same first day and day count must not alias one cache key.
collectData = true
const differentWindows = { days: [{ start: 100, end: 200 }, { start: 300, end: 400 }], monthStart: 100 }
const distinct = await post({ op: 'state', windows: differentWindows })
assert.equal(distinct.snapshots[0].pending, true)
await new Promise((resolve) => setTimeout(resolve, 10))
const distinctDone = await post({ op: 'state', windows: differentWindows })
assert.equal(distinctDone.snapshots[0].pending, false)

// An unexpired snapshot must be served without a new upstream call.
collectData = false
const cachedRequestNumber = requestNumber
state = await post({ op: 'state', windows })
assert.equal(state.snapshots[0].user.requestCount, 1, 'the original window should retain its cached account')
assert.equal(state.snapshots[0].trend[0].quota, 100)

// After cache expiry, both head and details must be refreshed. The old code
// refreshed the head but incorrectly carried the previous details into the
// new snapshot, then marked those stale details fresh.
mockNow += 60001
collectData = true
const beforeExpiry = requestNumber
state = await post({ op: 'state', windows })
assert.equal(state.snapshots[0].pending, true)
assert.equal(state.snapshots[0].trend, null, 'expired detail data must not be returned as fresh')
await new Promise((resolve) => setImmediate(resolve))
state = await post({ op: 'state', windows })
assert.equal(state.snapshots[0].pending, false)
assert.equal(state.snapshots[0].user.requestCount, beforeExpiry + 1)
assert.equal(state.snapshots[0].trend[0].quota, (beforeExpiry + 1) * 100)
assert.equal(state.snapshots[0].tokens[0].usedQuota, (beforeExpiry + 1) * 100)

// Two overlapping forced polls should share the head/detail requests rather than
// issuing duplicate upstream work for the same site/window.
mockNow += 60001
const beforeConcurrent = requestNumber
 delayFetch = true
const concurrent = await Promise.all([
  post({ op: 'state', force: true, windows }),
  post({ op: 'state', force: true, windows }),
])
assert.equal(requestNumber, beforeConcurrent + 1, 'overlapping head requests must be deduplicated')
assert.ok(concurrent.every((item) => item.snapshots[0].pending))
delayFetch = false
await new Promise((resolve) => setTimeout(resolve, 50))
state = await post({ op: 'state', windows })
assert.equal(state.snapshots[0].pending, false)
assert.equal(state.snapshots[0].user.requestCount, beforeConcurrent + 1)

// Failed credential writes must not leak into the live in-memory state.
failSave = true
let failedSave = await post({ op: 'save', site: { id: 'site-1', name: 'Changed', baseUrl: 'https://newapi.example', token: '' } })
assert.match(failedSave.error, /simulated credential store write failure/)
assert.equal(failedSave.sites, undefined)
failSave = false
state = await post({ op: 'state', windows })
assert.equal(state.sites[0].name, 'Test', 'failed edit must not mutate in-memory site data')
assert.equal(state.snapshots[0].user.requestCount, beforeConcurrent + 1)

failSave = true
failedSave = await post({ op: 'save', site: { name: 'New site', baseUrl: 'https://other.example', token: ['nap', 'another_test_secret'].join('_') } })
assert.match(failedSave.error, /simulated credential store write failure/)
failSave = false
state = await post({ op: 'state', windows })
assert.equal(state.sites.length, 1, 'failed create must not add an in-memory site')

// Restore globals for any caller that imports this verification script.
globalThis.fetch = originalFetch
globalThis.Date.now = originalDateNow

// Invalid credentials in a URL must be rejected before any upstream request.
const invalidUrl = await post({ op: 'save', site: { name: 'bad', baseUrl: ['https:', '', 'user:pass@example.test'].join('/'), token: ['nap', 'bad_test_secret'].join('_') } })
assert.match(invalidUrl.error, /站点地址无效/)

// Oversized client-provided windows fall back to safe local windows.
const safeWindowState = await post({ op: 'state', windows: { days: [{ start: 0, end: 86401 }], monthStart: 100 } })
assert.equal(safeWindowState.sites.length, 1)

const files = [
  '.gitignore', '.gitattributes', 'LICENSE', 'README.md', 'package.json',
  'cordis.patch.yml', 'index.js', 'client.js', 'icon.svg',
  'locale/en.json', 'locale/zh.json',
]
for (const file of files) await readFile(new URL(`../${file}`, import.meta.url))
console.log('verify passed: manifest, host route, secret masking, and distribution files')
