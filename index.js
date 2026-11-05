/**
 * Host half of the `dsh-newapi-usage` bundle.
 *
 * It owns everything the browser cannot do itself: it calls the NewAPI console
 * API of every configured relay site (the browser would be blocked by CORS and
 * would have to hold the access token), and it persists the site list inside a
 * credential record instead of configuration so the tokens never reach a YAML
 * patch or a settings form.
 *
 * The Client half only renders; it talks to this file through one buffered
 * Connection fetch route mounted next to the other `/api` routes, so requests
 * arrive already authenticated and trusted.
 *
 * @module dsh-newapi-usage
 */

/** Credential record key: `<owner scope>/<id this plugin chose>`. */
const RECORD_KEY = 'newapi-usage/sites'
/** Connection fetch route the browser half calls; one op envelope per request. */
const ROUTE_PATH = '/api/newapi-usage'
/** NewAPI stores quota as integer units; this is the decimal fallback rate. */
const DEFAULT_QUOTA_PER_UNIT = 500000
/** A panel opened twice within this window reuses the last snapshot. */
const CACHE_TTL_MS = 60000
/** Per-upstream-request budget; a unreachable relay must not hang the panel. */
const REQUEST_TIMEOUT_MS = 9000
/** Budget for the two requests that block a panel's first paint. */
const HEAD_TIMEOUT_MS = 5000
/** Pause before the single retry of a failed usage query. */
const RETRY_DELAY_MS = 400
/** Concurrent day windows per site — relays throttle bursts. */
const WINDOW_CONCURRENCY = 4
/** Trend length used when the browser sends no windows. */
const DEFAULT_TREND_DAYS = 7

export const inject = ['credentials', 'connection']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  /** @type {Map<string, {id: string, name: string, baseUrl: string, token: string, createdAt: number}>} */
  const sites = new Map()
  /** @type {{activeId: string | null, loaded: boolean}} */
  const meta = { activeId: null, loaded: false }
  /** @type {Map<string, {at: number, snapshot: object}>} */
  const cache = new Map()
  /** @type {Promise<void> | undefined} */
  let loading

  /* ------------------------------- persistence ------------------------------ */

  const persist = () =>
    ctx.credentials.modifyRecord(RECORD_KEY, async () => ({
      kind: 'grant',
      payload: {
        activeId: meta.activeId,
        sites: [...sites.values()].map(({ id, name, baseUrl, token, createdAt }) => ({
          id,
          name,
          baseUrl,
          token,
          createdAt,
        })),
      },
    }))

  const load = () => {
    loading ??= (async () => {
      try {
        const record = await ctx.credentials.readRecord(RECORD_KEY)
        const payload = record?.kind === 'grant' ? record.payload : undefined
        const stored = payload && Array.isArray(payload.sites) ? payload.sites : []
        for (const candidate of stored) {
          const site = normalizeSite(candidate)
          if (site !== null) sites.set(site.id, site)
        }
        const active = payload && typeof payload.activeId === 'string' ? payload.activeId : null
        if (active !== null && sites.has(active)) meta.activeId = active
      } catch (error) {
        console.warn(`newapi-usage: cannot read the stored site list: ${describe(error)}`)
      }
      if (meta.activeId === null && sites.size > 0) meta.activeId = sites.keys().next().value ?? null
      meta.loaded = true
    })()
    return loading
  }

  const ensureLoaded = async () => {
    if (meta.loaded) return
    await load()
  }

  /* --------------------------------- upstream ------------------------------- */

  /**
   * GET one NewAPI console endpoint.
   * @param {{baseUrl: string, token: string}} site
   * @param {string} path
   * @param {{auth?: boolean, query?: Record<string, string | number | undefined>}} [options]
   */
  async function apiGet(site, path, options = {}) {
    const { auth = true, query, timeoutMs = REQUEST_TIMEOUT_MS } = options
    const url = new URL(site.baseUrl + path)
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    }
    /** @type {Record<string, string>} */
    const headers = { Accept: 'application/json' }
    // A `nap_…` system access token travels as a bearer credential; NewAPI strips the
    // scheme, so sending it is also correct for sites that expect the bare token.
    if (auth) headers.Authorization = `Bearer ${site.token}`

    let response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw new Error(`无法连接 ${url.host}：${describe(error)}`)
    }

    const text = await response.text().catch(() => '')
    let body = null
    try {
      body = text === '' ? null : JSON.parse(text)
    } catch {
      body = null
    }

    if (!response.ok) {
      const detail = body && typeof body === 'object' && typeof body.message === 'string' ? `：${body.message}` : ''
      throw new Error(`HTTP ${response.status}${detail}${body === null ? '（返回内容不是 JSON，请检查站点地址）' : ''}`)
    }
    if (body && typeof body === 'object' && body.success === false) {
      throw new Error(typeof body.message === 'string' && body.message !== '' ? body.message : '站点返回失败')
    }
    if (body === null) throw new Error('返回内容不是 JSON，请检查站点地址是否正确')
    return body
  }

  /**
   * Fast head of one site's snapshot: the public server facts and the account.
   * Two small requests, so a panel paints a balance without waiting for history.
   * @param {{id: string, name: string, baseUrl: string, token: string}} site
   */
  async function collectHead(site) {
    /** @type {string[]} */
    const warnings = []
    /** @type {{server: object | null, user: object | null, error: string | null, warnings: string[]}} */
    const head = { server: null, user: null, error: null, warnings }

    const [statusBody, self] = await Promise.all([
      apiGet(site, '/api/status', { auth: false, timeoutMs: HEAD_TIMEOUT_MS }).catch((error) => {
        warnings.push(`站点信息读取失败：${describe(error)}`)
        return null
      }),
      apiGet(site, '/api/user/self', { timeoutMs: HEAD_TIMEOUT_MS }).then(
        (value) => ({ value }),
        (error) => ({ error }),
      ),
    ])

    head.server = normalizeServer(statusBody?.data)
    if ('error' in self) {
      head.error = describe(self.error)
      return head
    }
    const account = self.value?.data
    if (!account || typeof account !== 'object') {
      head.error = '站点没有返回用户信息'
      return head
    }
    head.user = {
      id: numberOrNull(account.id),
      username: stringOrEmpty(account.username),
      name: stringOrEmpty(account.display_name) || stringOrEmpty(account.username),
      group: stringOrEmpty(account.group),
      quota: numberOrNull(account.quota),
      usedQuota: numberOrNull(account.used_quota),
      requestCount: numberOrNull(account.request_count),
    }
    return head
  }

  /**
   * Slow half of one site's snapshot: day windows, month total and token list.
   * Runs in the background so a slow relay never delays the balance.
   * @param {{id: string, name: string, baseUrl: string, token: string}} site
   * @param {{days: {start: number, end: number}[], monthStart: number}} windows
   */
  async function collectDetails(site, windows) {
    /** @type {string[]} */
    const warnings = []
    const warn = (message) => {
      if (!warnings.includes(message)) warnings.push(message)
    }
    const now = Math.floor(Date.now() / 1000)

    // One retry: these relays answer a burst with a timeout instead of a 429, and
    // the second attempt almost always lands once the burst has cleared.
    const statOf = async (start, end) => {
      const read = async () => {
        const body = await apiGet(site, '/api/log/self/stat', {
          query: { type: 2, start_timestamp: start, end_timestamp: end },
        })
        return body?.data ?? null
      }
      try {
        return await read()
      } catch (error) {
        await sleep(RETRY_DELAY_MS)
        return await read()
      }
    }

    const trendTask = mapLimit(windows.days, WINDOW_CONCURRENCY, async (window) => {
      try {
        const stat = await statOf(window.start, window.end)
        return {
          start: window.start,
          quota: numberOrNull(stat?.quota),
          rpm: numberOrNull(stat?.rpm),
          tpm: numberOrNull(stat?.tpm),
        }
      } catch (error) {
        warn(`按日用量读取失败：${describe(error)}`)
        return { start: window.start, quota: null, rpm: null, tpm: null }
      }
    })

    const monthTask = statOf(windows.monthStart, now)
      .then((stat) => ({ quota: numberOrNull(stat?.quota) }))
      .catch((error) => {
        warn(`本月用量读取失败：${describe(error)}`)
        return null
      })

    const tokensTask = apiGet(site, '/api/token/', { query: { p: 1, size: 100 } })
      .then((body) => {
        const items = Array.isArray(body?.data?.items) ? body.data.items : []
        return items.map((item) => ({
          id: numberOrNull(item.id),
          name: stringOrEmpty(item.name),
          usedQuota: numberOrNull(item.used_quota),
          remainQuota: numberOrNull(item.remain_quota),
          unlimited: item.unlimited_quota === true,
          status: numberOrNull(item.status),
          expiredTime: numberOrNull(item.expired_time),
        }))
      })
      .catch((error) => {
        warn(`令牌列表读取失败：${describe(error)}`)
        return null
      })

    const [trend, month, tokens] = await Promise.all([trendTask, monthTask, tokensTask])
    const latest = trend[trend.length - 1]
    return {
      trend,
      month,
      tokens,
      today: latest ? { quota: latest.quota, rpm: latest.rpm, tpm: latest.tpm } : null,
      warnings,
    }
  }

  /**
   * Project one cache entry onto the wire shape.
   * @param {{id: string, name: string, baseUrl: string}} site
   * @param {{head: {server: object | null, user: object | null, error: string | null, warnings: string[]}, details: object | null, at: number, running: boolean}} entry
   */
  function buildSnapshot(site, entry) {
    const details = entry.details
    return {
      id: site.id,
      name: site.name,
      baseUrl: site.baseUrl,
      ok: entry.head.error === null && entry.head.user !== null,
      fetchedAt: entry.at,
      error: entry.head.error,
      warnings: [...entry.head.warnings, ...(details === null ? [] : details.warnings)],
      server: entry.head.server,
      user: entry.head.user,
      trend: details === null ? null : details.trend,
      today: details === null ? null : details.today,
      month: details === null ? null : details.month,
      tokens: details === null ? null : details.tokens,
      pending: entry.running,
    }
  }

  /**
   * Snapshot for one site: the head is awaited, the details are a background
   * fill the Client picks up on its next poll.
   * @param {{id: string, name: string, baseUrl: string, token: string}} site
   * @param {{days: {start: number, end: number}[], monthStart: number}} windows
   * @param {boolean} force
   */
  async function snapshotOf(site, windows, force) {
    const key = `${site.id}|${windows.days[0]?.start ?? 0}|${windows.days.length}|${windows.monthStart}`
    const cached = cache.get(key)
    if (!force && cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) return buildSnapshot(site, cached)

    let entry = cached
    if (entry === undefined || force) {
      entry = {
        head: await collectHead(site),
        details: entry === undefined ? null : entry.details,
        at: Date.now(),
        running: false,
      }
      for (const existing of [...cache.keys()]) {
        if (existing.startsWith(`${site.id}|`)) cache.delete(existing)
      }
      cache.set(key, entry)
    }

    const stale = force || entry.details === null
    if (entry.head.error === null && !entry.running && stale) {
      const target = entry
      target.running = true
      void collectDetails(site, windows)
        .then((details) => {
          target.details = details
          target.at = Date.now()
        })
        .catch((error) => {
          target.details = target.details ?? { trend: [], month: null, tokens: null, today: null, warnings: [describe(error)] }
        })
        .finally(() => {
          target.running = false
        })
    }
    return buildSnapshot(site, entry)
  }

  /* ---------------------------------- state --------------------------------- */

  const publicSite = (site) => ({
    id: site.id,
    name: site.name,
    baseUrl: site.baseUrl,
    hasToken: site.token !== '',
    tokenHint: maskToken(site.token),
  })

  const listState = () => ({
    activeId: meta.activeId,
    sites: [...sites.values()].map(publicSite),
  })

  /**
   * @param {boolean} force
   * @param {unknown} windowsInput
   */
  async function stateOp(force, windowsInput) {
    const windows = readWindows(windowsInput)
    const entries = [...sites.values()]
    const snapshots = await Promise.all(
      entries.map(async (site) => {
        try {
          return await snapshotOf(site, windows, force)
        } catch (error) {
          return {
            id: site.id,
            name: site.name,
            baseUrl: site.baseUrl,
            ok: false,
            fetchedAt: Date.now(),
            error: describe(error),
            warnings: [],
            server: null,
            user: null,
            trend: null,
            today: null,
            month: null,
            tokens: null,
            pending: false,
          }
        }
      }),
    )
    return { ...listState(), snapshots }
  }

  /**
   * @param {{id?: unknown, name?: unknown, baseUrl?: unknown, token?: unknown}} input
   */
  async function saveOp(input) {
    const baseUrl = normalizeBaseUrl(typeof input.baseUrl === 'string' ? input.baseUrl : '')
    if (baseUrl === null) throw new Error('站点地址无效，需要形如 https://relay.example.com')
    const token = typeof input.token === 'string' ? input.token.trim() : ''
    const id = typeof input.id === 'string' && input.id !== '' ? input.id : null
    const existing = id === null ? undefined : sites.get(id)

    let name = typeof input.name === 'string' ? input.name.trim() : ''
    if (name === '') name = new URL(baseUrl).host

    if (existing !== undefined) {
      existing.name = name
      existing.baseUrl = baseUrl
      if (token !== '') existing.token = token
      if (existing.token === '') throw new Error('访问令牌不能为空')
      cache.clear()
      await persist()
      return { id: existing.id }
    }

    if (token === '') throw new Error('访问令牌不能为空')
    const created = {
      id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name,
      baseUrl,
      token,
      createdAt: Date.now(),
    }
    sites.set(created.id, created)
    meta.activeId = created.id
    await persist()
    return { id: created.id }
  }

  /** @param {unknown} id */
  async function removeOp(id) {
    if (typeof id !== 'string' || !sites.delete(id)) throw new Error('找不到要删除的站点')
    for (const key of [...cache.keys()]) {
      if (key.startsWith(`${id}|`)) cache.delete(key)
    }
    if (meta.activeId === id) meta.activeId = sites.keys().next().value ?? null
    await persist()
    return {}
  }

  /** @param {unknown} id */
  async function activateOp(id) {
    if (typeof id !== 'string' || !sites.has(id)) throw new Error('找不到该站点')
    meta.activeId = id
    await persist()
    return {}
  }

  /* ---------------------------------- route --------------------------------- */

  /**
   * @param {Request} request
   */
  async function handle(request) {
    try {
      await ensureLoaded()
      /** @type {Record<string, unknown>} */
      let body = {}
      try {
        const parsed = await request.json()
        if (parsed && typeof parsed === 'object') body = parsed
      } catch {
        body = {}
      }
      switch (body.op) {
        case 'state':
          return json(await stateOp(body.force === true, body.windows))
        case 'save':
          await saveOp(body.site && typeof body.site === 'object' ? body.site : {})
          return json(listState())
        case 'remove':
          await removeOp(body.id)
          return json(listState())
        case 'activate':
          await activateOp(body.id)
          return json(listState())
        default:
          return json({ error: 'unknown op' }, 400)
      }
    } catch (error) {
      return json({ error: describe(error) }, 400)
    }
  }

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: ROUTE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => handle(request),
      }),
    'newapi-usage: console API route',
  )
}

/* --------------------------------- helpers -------------------------------- */

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * @param {readonly unknown[]} items
 * @param {number} limit
 * @param {(item: any) => Promise<any>} run
 */
async function mapLimit(items, limit, run) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await run(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function describe(error) {
  if (error instanceof Error) {
    const cause = /** @type {{code?: unknown}} */ (error.cause)
    const code = cause && typeof cause === 'object' && typeof cause.code === 'string' ? cause.code : ''
    if (code !== '') return `${error.message}（${code}）`
    return error.message
  }
  return String(error)
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringOrEmpty(value) {
  return typeof value === 'string' ? value : ''
}

function maskToken(token) {
  if (token === '') return ''
  if (token.length <= 10) return `${token.slice(0, 2)}…`
  return `${token.slice(0, 6)}…${token.slice(-4)}`
}

/** @param {unknown} raw */
function normalizeSite(raw) {
  if (!raw || typeof raw !== 'object') return null
  const candidate = /** @type {Record<string, unknown>} */ (raw)
  if (typeof candidate.id !== 'string' || candidate.id === '') return null
  const baseUrl = normalizeBaseUrl(typeof candidate.baseUrl === 'string' ? candidate.baseUrl : '')
  if (baseUrl === null) return null
  if (typeof candidate.token !== 'string' || candidate.token === '') return null
  const name = typeof candidate.name === 'string' && candidate.name !== '' ? candidate.name : new URL(baseUrl).host
  return {
    id: candidate.id,
    name,
    baseUrl,
    token: candidate.token,
    createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now(),
  }
}

/** @param {string} input */
function normalizeBaseUrl(input) {
  const trimmed = input.trim().replace(/\/+$/, '')
  if (trimmed === '') return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.hostname === '') return null
  url.search = ''
  url.hash = ''
  return url.origin + (url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, ''))
}

/** @param {unknown} data */
function normalizeServer(data) {
  if (!data || typeof data !== 'object') return null
  const server = /** @type {Record<string, unknown>} */ (data)
  const symbol = stringOrEmpty(server.custom_currency_symbol)
  return {
    version: stringOrEmpty(server.version),
    systemName: stringOrEmpty(server.system_name),
    quotaPerUnit: numberOrNull(server.quota_per_unit) ?? DEFAULT_QUOTA_PER_UNIT,
    displayInCurrency: server.display_in_currency !== false,
    currencySymbol: symbol === '' || symbol === '¤' ? '$' : symbol,
  }
}

/**
 * Normalize the browser-provided day windows, falling back to the Host clock.
 * @param {unknown} input
 */
function readWindows(input) {
  const fallback = defaultWindows()
  if (!input || typeof input !== 'object') return fallback
  const source = /** @type {Record<string, unknown>} */ (input)
  const monthStart = numberOrNull(source.monthStart)
  const daysInput = Array.isArray(source.days) ? source.days : null
  if (daysInput === null || daysInput.length === 0 || daysInput.length > 31) {
    return { days: fallback.days, monthStart: monthStart !== null ? Math.floor(monthStart) : fallback.monthStart }
  }
  const days = []
  for (const item of daysInput) {
    if (!item || typeof item !== 'object') continue
    const window = /** @type {Record<string, unknown>} */ (item)
    const start = numberOrNull(window.start)
    const end = numberOrNull(window.end)
    if (start === null || end === null || end <= start) continue
    days.push({ start: Math.floor(start), end: Math.floor(end) })
  }
  if (days.length === 0) return fallback
  return {
    days,
    monthStart: monthStart !== null ? Math.floor(monthStart) : fallback.monthStart,
  }
}

function defaultWindows() {
  const now = new Date()
  const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 1000
  const today = startOfDay(now)
  const days = []
  for (let offset = DEFAULT_TREND_DAYS - 1; offset >= 0; offset -= 1) {
    const start = today - offset * 86400
    days.push({ start, end: start + 86400 })
  }
  return { days, monthStart: new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000 }
}
