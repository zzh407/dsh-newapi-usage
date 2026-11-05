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
const ctx = {
  credentials: {
    async readRecord(key) { assert.equal(key, 'newapi-usage/sites'); return record },
    async modifyRecord(key, mutate) { assert.equal(key, 'newapi-usage/sites'); return mutate(record) },
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
assert.equal(payload.snapshots[0].user, null)

const files = [
  '.gitignore', '.gitattributes', 'LICENSE', 'README.md', 'package.json',
  'cordis.patch.yml', 'index.js', 'client.js', 'icon.svg',
  'locale/en.json', 'locale/zh.json',
]
for (const file of files) await readFile(new URL(`../${file}`, import.meta.url))
console.log('verify passed: manifest, host route, secret masking, and distribution files')
