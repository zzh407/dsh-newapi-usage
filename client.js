window.__ModuleLoader__.load({
  id: 'dsh-newapi-usage',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React

    const NS = 'newapi-usage'
    const PANEL_ID = 'newapi-usage'
    const TREND_DAYS = 7
    const AUTO_REFRESH_MS = 120000
    const FALLBACK_QUOTA_PER_UNIT = 500000
    const apiUrl = () => new URL('api/newapi-usage', document.baseURI).href

    const DICTIONARIES = {
      zh: {
        panel: 'NewAPI 用量',
        title: 'NewAPI 用量',
        balance: '余额',
        today: '今日消费',
        todayShort: '今天',
        month: '本月消费',
        used: '已用总额',
        requests: '请求 {count} 次',
        requestsEmpty: '暂无请求记录',
        trend: '近 7 天消费',
        tokens: '令牌（API Key）',
        tokensEmpty: '没有可显示的令牌',
        detailsLoading: '正在读取用量明细…',
        rpm: 'RPM',
        tpm: 'TPM',
        refresh: '刷新',
        refreshing: '刷新中…',
        manage: '站点管理',
        addSite: '添加站点',
        editSite: '编辑',
        siteName: '名称',
        siteNameHint: '留空则使用域名',
        siteUrl: '站点地址',
        siteUrlHint: '例如 https://relay.example.com',
        siteToken: '访问令牌',
        siteTokenHint: 'NewAPI 控制台 → 个人设置 → 系统访问令牌（不是 sk- 开头的调用密钥）',
        tokenKeep: '留空表示不修改已保存的令牌',
        save: '保存',
        saving: '保存中…',
        cancel: '取消',
        close: '关闭',
        remove: '删除',
        removeConfirm: '确认删除该站点？',
        use: '切换',
        loaded: '更新于 {time}',
        never: '尚未更新',
        emptyTitle: '还没有配置站点',
        emptyHint: '填入 NewAPI 站点地址和访问令牌，就能看到余额和消费。',
        noSite: '请选择一个站点',
        errorTitle: '数据获取失败',
        retry: '重试',
        loading: '正在读取…',
        unlimited: '无限',
        usedColumn: '已用',
        remainColumn: '剩余',
        statusColumn: '状态',
        nameColumn: '令牌',
        statusEnabled: '正常',
        statusDisabled: '禁用',
        statusExpired: '过期',
        statusExhausted: '额度用尽',
        siteCount: '{count} 个站点',
      },
      en: {
        panel: 'NewAPI usage',
        title: 'NewAPI usage',
        balance: 'Balance',
        today: 'Spent today',
        todayShort: 'Today',
        month: 'Spent this month',
        used: 'Total spent',
        requests: '{count} requests',
        requestsEmpty: 'No requests yet',
        trend: 'Spending, last 7 days',
        tokens: 'API keys',
        tokensEmpty: 'No keys to show',
        detailsLoading: 'Loading usage details…',
        rpm: 'RPM',
        tpm: 'TPM',
        refresh: 'Refresh',
        refreshing: 'Refreshing…',
        manage: 'Sites',
        addSite: 'Add site',
        editSite: 'Edit',
        siteName: 'Name',
        siteNameHint: 'Defaults to the host name',
        siteUrl: 'Site URL',
        siteUrlHint: 'For example https://relay.example.com',
        siteToken: 'Access token',
        siteTokenHint: 'NewAPI console → personal settings → system access token (not an sk- relay key)',
        tokenKeep: 'Leave empty to keep the stored token',
        save: 'Save',
        saving: 'Saving…',
        cancel: 'Cancel',
        close: 'Close',
        remove: 'Remove',
        removeConfirm: 'Remove this site?',
        use: 'Switch',
        loaded: 'Updated {time}',
        never: 'Never updated',
        emptyTitle: 'No site configured yet',
        emptyHint: 'Enter a NewAPI site URL and access token to see its balance and spending.',
        noSite: 'Select a site',
        errorTitle: 'Could not load usage',
        retry: 'Retry',
        loading: 'Loading…',
        unlimited: 'Unlimited',
        usedColumn: 'Used',
        remainColumn: 'Remaining',
        statusColumn: 'Status',
        nameColumn: 'Key',
        statusEnabled: 'Active',
        statusDisabled: 'Disabled',
        statusExpired: 'Expired',
        statusExhausted: 'Exhausted',
        siteCount: '{count} sites',
      },
    }

    /* ---------------------------------- data --------------------------------- */

    async function callHost(body) {
      let response
      try {
        response = await fetch(apiUrl(), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : String(error))
      }
      const payload = await response.json().catch(() => null)
      if (payload === null) throw new Error(`HTTP ${response.status}`)
      if (payload.error !== undefined) throw new Error(String(payload.error))
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return payload
    }

    /** Local calendar windows, so a day boundary follows the browser's time zone. */
    function buildWindows() {
      const now = new Date()
      const days = []
      for (let offset = TREND_DAYS - 1; offset >= 0; offset -= 1) {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset + 1)
        days.push({ start: Math.floor(start.getTime() / 1000), end: Math.floor(end.getTime() / 1000) })
      }
      return { days, monthStart: Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000) }
    }

    function unitOf(snapshot) {
      const unit = snapshot?.server?.quotaPerUnit
      return typeof unit === 'number' && unit > 0 ? unit : FALLBACK_QUOTA_PER_UNIT
    }

    function symbolOf(snapshot) {
      const symbol = snapshot?.server?.currencySymbol
      return typeof symbol === 'string' && symbol !== '' ? symbol : '$'
    }

    function formatMoney(quota, snapshot) {
      if (typeof quota !== 'number' || !Number.isFinite(quota)) return '—'
      const value = quota / unitOf(snapshot)
      const fraction = Math.abs(value) >= 1000 ? 0 : 2
      return `${symbolOf(snapshot)}${value.toLocaleString(undefined, {
        minimumFractionDigits: fraction,
        maximumFractionDigits: fraction,
      })}`
    }

    function formatCount(count) {
      if (typeof count !== 'number' || !Number.isFinite(count)) return '—'
      return count.toLocaleString()
    }

    function weekdayLabel(seconds, locale) {
      return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(seconds * 1000))
    }

    function timeLabel(ms, locale) {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
      return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(ms))
    }

    const describe = (error) => (error instanceof Error ? error.message : String(error))

    function translate(dictionary, key, values) {
      const template = dictionary[key] ?? key
      if (values === undefined) return template
      return template.replace(/\{(\w+)\}/g, (_, name) => (values[name] === undefined ? '' : String(values[name])))
    }

    const TOKEN_STATUS = { 1: 'statusEnabled', 2: 'statusDisabled', 3: 'statusExpired', 4: 'statusExhausted' }
    const tokenStatusKey = (status) => TOKEN_STATUS[status] ?? 'statusDisabled'
    const tokenTone = (token) => (token.status === 1 ? 'ok' : token.status === 4 ? 'warn' : token.status === 3 ? 'bad' : 'warn')

    /* --------------------------------- styles -------------------------------- */

    const CSS = `
.napi-page{position:relative;display:flex;flex-direction:column;gap:16px;flex:1;min-height:0;overflow:auto;box-sizing:border-box;padding:20px 24px 28px;color:var(--dsw-alias-label-primary)}
.napi-header{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.napi-heading{display:flex;flex-direction:column;gap:2px;min-width:0}
.napi-title{margin:0;font-size:18px;font-weight:600;letter-spacing:.01em}
.napi-sub{font-size:12px;color:var(--dsw-alias-label-secondary)}
.napi-spacer{flex:1 1 auto}
.napi-chips{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.napi-chip{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1;padding:6px 10px;border-radius:999px;cursor:pointer;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.napi-chip:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.napi-chip[data-active="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-weight:500}
.napi-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer;white-space:nowrap;font-family:inherit}
.napi-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.napi-btn:disabled{opacity:.55;cursor:default}
.napi-btn-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}
.napi-btn-primary:hover{filter:brightness(1.07)}
.napi-btn-ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary)}
.napi-btn-ghost:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.napi-btn-danger{color:var(--dsw-alias-state-error-primary)}
.napi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(176px,1fr));gap:12px}
.napi-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:6px;min-width:0}
.napi-card-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.napi-card-value{font-size:22px;font-weight:600;line-height:1.25;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis}
.napi-card-hint{font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.napi-split{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:12px;align-items:start}
@media (max-width:900px){.napi-split{grid-template-columns:minmax(0,1fr)}}
.napi-section-title{font-size:13px;font-weight:600;margin:0}
.napi-chart{display:flex;align-items:flex-end;gap:6px;height:128px;padding-top:10px}
.napi-bar-cell{flex:1 1 0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:6px;height:100%;min-width:0}
.napi-bar{width:100%;max-width:40px;border-radius:6px 6px 3px 3px;background:var(--dsw-alias-brand-primary);opacity:.5;min-height:3px;transition:opacity .15s ease}
.napi-bar-cell:hover .napi-bar{opacity:.8}
.napi-bar[data-today="true"]{opacity:1}
.napi-bar-cell:hover .napi-bar[data-today="true"]{opacity:1}
.napi-bar-label{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.napi-table{width:100%;border-collapse:collapse;font-size:13px}
.napi-table th{text-align:left;font-weight:500;font-size:12px;color:var(--dsw-alias-label-secondary);padding:2px 8px 8px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.napi-table td{padding:8px;border-bottom:1px solid var(--dsw-alias-border-l1);font-variant-numeric:tabular-nums}
.napi-table tr:last-child td{border-bottom:none}
.napi-table .napi-num{text-align:right;white-space:nowrap}
.napi-cell-name{max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.napi-tag{display:inline-block;font-size:11px;line-height:1;padding:4px 7px;border-radius:5px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.napi-tag[data-tone="ok"]{color:var(--dsw-alias-state-success-primary)}
.napi-tag[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary)}
.napi-tag[data-tone="bad"]{color:var(--dsw-alias-state-error-primary)}
.napi-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}
.napi-banner{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);font-size:13px;color:var(--dsw-alias-label-primary)}
.napi-banner-text{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.napi-banner-warn{font-size:12px;color:var(--dsw-alias-label-secondary)}
.napi-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:56px 24px;border:1px dashed var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}
.napi-empty-title{font-size:15px;font-weight:600}
.napi-empty-hint{font-size:13px;color:var(--dsw-alias-label-secondary);max-width:420px;line-height:1.6}
.napi-overlay{position:absolute;inset:0;background:rgba(0,0,0,.42);display:flex;align-items:flex-start;justify-content:center;padding:32px 20px;z-index:30;overflow:auto}
.napi-dialog{width:min(580px,100%);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:14px;box-shadow:0 20px 56px rgba(0,0,0,.3)}
.napi-dialog-head{display:flex;align-items:center;gap:10px}
.napi-dialog-title{font-size:15px;font-weight:600;flex:1 1 auto}
.napi-field{display:flex;flex-direction:column;gap:6px}
.napi-field-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.napi-input{height:34px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;outline:none;width:100%;box-sizing:border-box;font-family:inherit}
.napi-input:focus{border-color:var(--dsw-alias-brand-primary)}
.napi-hint{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.6}
.napi-dialog-actions{display:flex;align-items:center;gap:8px;justify-content:flex-end}
.napi-site-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.napi-site-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}
.napi-site-name{font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:6px}
.napi-site-url{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.napi-error-text{color:var(--dsw-alias-state-error-primary);font-size:12px;overflow-wrap:anywhere}
`

    /* -------------------------------- components ------------------------------ */

    function useLocale(locale) {
      const subscribe = useCallback((listener) => locale.subscribe(listener), [locale])
      const getSnapshot = useCallback(() => locale.getSnapshot(), [locale])
      return useSyncExternalStore(subscribe, getSnapshot)
    }

    function StatCard({ label, value, hint }) {
      return h(
        'div',
        { className: 'napi-card' },
        h('div', { className: 'napi-card-label' }, label),
        h('div', { className: 'napi-card-value', title: value }, value),
        hint ? h('div', { className: 'napi-card-hint', title: hint }, hint) : null,
      )
    }

    function TrendChart({ snapshot, t, locale }) {
      const trend = Array.isArray(snapshot.trend) ? snapshot.trend : []
      const max = Math.max(1, ...trend.map((entry) => (typeof entry.quota === 'number' ? entry.quota : 0)))
      return h(
        'div',
        { className: 'napi-card' },
        h('div', { className: 'napi-section-title' }, t('trend')),
        trend.length === 0
          ? h('div', { className: 'napi-hint' }, snapshot.pending === true ? t('detailsLoading') : t('trendEmpty'))
          : h(
          'div',
          { className: 'napi-chart' },
          trend.map((entry, index) => {
            const quota = typeof entry.quota === 'number' ? entry.quota : null
            const height = quota === null ? 3 : Math.max(3, Math.round((quota / max) * 100))
            const isToday = index === trend.length - 1
            return h(
              'div',
              { key: entry.start, className: 'napi-bar-cell' },
              h('div', {
                className: 'napi-bar',
                'data-today': isToday ? 'true' : 'false',
                style: { height: `${height}%` },
                title: `${weekdayLabel(entry.start, locale)} · ${formatMoney(quota, snapshot)}`,
              }),
              h('div', { className: 'napi-bar-label' }, isToday ? t('todayShort') : weekdayLabel(entry.start, locale)),
            )
          }),
            ),
      )
    }

    function TokenTable({ snapshot, t }) {
      const tokens = Array.isArray(snapshot.tokens) ? snapshot.tokens : []
      return h(
        'div',
        { className: 'napi-card' },
        h('div', { className: 'napi-section-title' }, t('tokens')),
        tokens.length === 0
          ? h('div', { className: 'napi-hint' }, snapshot.pending === true ? t('detailsLoading') : t('tokensEmpty'))
          : h(
              'table',
              { className: 'napi-table' },
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  h('th', null, t('nameColumn')),
                  h('th', { className: 'napi-num' }, t('usedColumn')),
                  h('th', { className: 'napi-num' }, t('remainColumn')),
                  h('th', { className: 'napi-num' }, t('statusColumn')),
                ),
              ),
              h(
                'tbody',
                null,
                tokens.map((token) =>
                  h(
                    'tr',
                    { key: token.id ?? token.name },
                    h('td', { className: 'napi-cell-name', title: token.name }, token.name || '—'),
                    h('td', { className: 'napi-num' }, formatMoney(token.usedQuota, snapshot)),
                    h('td', { className: 'napi-num' }, token.unlimited ? t('unlimited') : formatMoney(token.remainQuota, snapshot)),
                    h(
                      'td',
                      { className: 'napi-num' },
                      h('span', { className: 'napi-tag', 'data-tone': tokenTone(token) }, t(tokenStatusKey(token.status))),
                    ),
                  ),
                ),
              ),
            ),
      )
    }

    function SiteList({ sites, activeId, confirmId, onEdit, onActivate, onAskRemove, onCancelRemove, onRemove, t }) {
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        sites.map((site) =>
          h(
            'div',
            { key: site.id, className: 'napi-site-item' },
            h(
              'div',
              { className: 'napi-site-main' },
              h(
                'div',
                { className: 'napi-site-name' },
                site.id === activeId ? h('span', { className: 'napi-dot', title: t('use') }) : null,
                site.name,
              ),
              h('div', { className: 'napi-site-url' }, `${site.baseUrl} · ${site.tokenHint}`),
            ),
            confirmId === site.id
              ? h(
                  React.Fragment,
                  null,
                  h('span', { className: 'napi-error-text' }, t('removeConfirm')),
                  h('button', { type: 'button', className: 'napi-btn napi-btn-danger', onClick: () => onRemove(site.id) }, t('remove')),
                  h('button', { type: 'button', className: 'napi-btn napi-btn-ghost', onClick: onCancelRemove }, t('cancel')),
                )
              : h(
                  React.Fragment,
                  null,
                  site.id === activeId
                    ? null
                    : h('button', { type: 'button', className: 'napi-btn napi-btn-ghost', onClick: () => onActivate(site.id) }, t('use')),
                  h('button', { type: 'button', className: 'napi-btn', onClick: () => onEdit(site) }, t('editSite')),
                  h('button', { type: 'button', className: 'napi-btn napi-btn-danger', onClick: () => onAskRemove(site.id) }, t('remove')),
                ),
          ),
        ),
      )
    }

    function SiteForm({ draft, saving, error, onChange, onSubmit, onCancel, t }) {
      const field = (label, hint, input) =>
        h(
          'label',
          { className: 'napi-field' },
          h('span', { className: 'napi-field-label' }, label),
          input,
          hint ? h('span', { className: 'napi-hint' }, hint) : null,
        )
      return h(
        'form',
        {
          className: 'napi-dialog',
          onSubmit: (event) => {
            event.preventDefault()
            onSubmit()
          },
        },
        h('div', { className: 'napi-dialog-head' }, h('div', { className: 'napi-dialog-title' }, draft.id === null ? t('addSite') : t('editSite'))),
        field(
          t('siteName'),
          t('siteNameHint'),
          h('input', {
            className: 'napi-input',
            value: draft.name,
            onChange: (event) => onChange({ name: event.target.value }),
          }),
        ),
        field(
          t('siteUrl'),
          t('siteUrlHint'),
          h('input', {
            className: 'napi-input',
            value: draft.baseUrl,
            placeholder: 'https://relay.example.com',
            autoComplete: 'off',
            spellCheck: false,
            onChange: (event) => onChange({ baseUrl: event.target.value }),
          }),
        ),
        field(
          t('siteToken'),
          draft.id === null ? t('siteTokenHint') : t('tokenKeep'),
          h('input', {
            className: 'napi-input',
            type: 'password',
            value: draft.token,
            placeholder: draft.id === null ? 'nap_…' : '••••••',
            autoComplete: 'off',
            spellCheck: false,
            onChange: (event) => onChange({ token: event.target.value }),
          }),
        ),
        error === null ? null : h('div', { className: 'napi-error-text' }, error),
        h(
          'div',
          { className: 'napi-dialog-actions' },
          h('button', { type: 'button', className: 'napi-btn napi-btn-ghost', onClick: onCancel }, t('cancel')),
          h('button', { type: 'submit', className: 'napi-btn napi-btn-primary', disabled: saving }, saving ? t('saving') : t('save')),
        ),
      )
    }

    function Panel(props) {
      const { t, locale } = props
      useLocale(locale)

      const [state, setState] = useState({ status: 'idle', sites: [], snapshots: [], activeId: null, error: null })
      const [busy, setBusy] = useState(false)
      const [dialog, setDialog] = useState(null)
      const [draft, setDraft] = useState(null)
      const [formError, setFormError] = useState(null)
      const [saving, setSaving] = useState(false)
      const [confirmId, setConfirmId] = useState(null)

      const load = useCallback(async (force, quiet) => {
        if (quiet !== true) setBusy(true)
        try {
          const payload = await callHost({ op: 'state', force: force === true, windows: buildWindows() })
          setState({
            status: 'ready',
            sites: Array.isArray(payload.sites) ? payload.sites : [],
            snapshots: Array.isArray(payload.snapshots) ? payload.snapshots : [],
            activeId: typeof payload.activeId === 'string' ? payload.activeId : null,
            error: null,
          })
        } catch (error) {
          setState((previous) => ({ ...previous, status: 'error', error: describe(error) }))
        } finally {
          if (quiet !== true) setBusy(false)
        }
      }, [])

      useEffect(() => {
        let disposed = false
        load(false).catch(() => {})
        const timer = setInterval(() => {
          if (!disposed) load(false).catch(() => {})
        }, AUTO_REFRESH_MS)
        return () => {
          disposed = true
          clearInterval(timer)
        }
      }, [load])

      // The Host paints the balance first and fills the history in the background,
      // so poll quietly while any site still reports a pending detail pass.
      const pendingDetails = useMemo(
        () => state.snapshots.some((entry) => entry.pending === true),
        [state.snapshots],
      )
      const detailPolls = useRef(0)
      useEffect(() => {
        if (!pendingDetails) {
          detailPolls.current = 0
          return
        }
        if (detailPolls.current >= 15) return
        const timer = setTimeout(() => {
          detailPolls.current += 1
          load(false, true).catch(() => {})
        }, 1200)
        return () => clearTimeout(timer)
      }, [pendingDetails, state.snapshots, load])

      const snapshot = useMemo(() => {
        if (state.activeId !== null) {
          const match = state.snapshots.find((entry) => entry.id === state.activeId)
          if (match !== undefined) return match
        }
        return state.snapshots[0] ?? null
      }, [state.snapshots, state.activeId])

      const runOp = useCallback(async (body) => {
        const payload = await callHost(body)
        setState((previous) => ({
          ...previous,
          sites: Array.isArray(payload.sites) ? payload.sites : previous.sites,
          activeId: typeof payload.activeId === 'string' ? payload.activeId : previous.activeId,
        }))
        return payload
      }, [])

      const openAdd = useCallback(() => {
        setDraft({ id: null, name: '', baseUrl: '', token: '' })
        setFormError(null)
        setDialog('form')
      }, [])

      const openEdit = useCallback((site) => {
        setDraft({ id: site.id, name: site.name, baseUrl: site.baseUrl, token: '' })
        setFormError(null)
        setDialog('form')
      }, [])

      const submitForm = useCallback(async () => {
        if (draft === null) return
        setSaving(true)
        setFormError(null)
        try {
          await callHost({ op: 'save', site: draft })
          setDialog(null)
          setDraft(null)
          await load(true)
        } catch (error) {
          setFormError(describe(error))
        } finally {
          setSaving(false)
        }
      }, [draft, load])

      const removeSite = useCallback(
        async (id) => {
          setConfirmId(null)
          try {
            await runOp({ op: 'remove', id })
            await load(true)
          } catch (error) {
            setState((previous) => ({ ...previous, error: describe(error) }))
          }
        },
        [load, runOp],
      )

      const activate = useCallback(
        async (id) => {
          try {
            await runOp({ op: 'activate', id })
          } catch (error) {
            setState((previous) => ({ ...previous, error: describe(error) }))
          }
        },
        [runOp],
      )

      const closeDialog = useCallback(() => {
        setDialog(null)
        setDraft(null)
        setConfirmId(null)
        setFormError(null)
      }, [])

      const error = state.error ?? (snapshot !== null && snapshot.error !== null ? snapshot.error : null)
      const warnings = snapshot !== null && Array.isArray(snapshot.warnings) ? snapshot.warnings : []

      const header = h(
        'div',
        { className: 'napi-header' },
        h(
          'div',
          { className: 'napi-heading' },
          h('h1', { className: 'napi-title' }, t('title')),
          h(
            'div',
            { className: 'napi-sub' },
            snapshot === null
              ? t('noSite')
              : [
                  state.sites.length > 1 ? `${t('siteCount', { count: state.sites.length })} · ` : '',
                  typeof snapshot.fetchedAt === 'number' ? t('loaded', { time: timeLabel(snapshot.fetchedAt, locale) }) : t('never'),
                ].join(''),
          ),
        ),
        h('div', { className: 'napi-spacer' }),
        h(
          'button',
          { type: 'button', className: 'napi-btn', onClick: () => load(true), disabled: busy, 'aria-busy': busy ? 'true' : 'false' },
          busy ? t('refreshing') : t('refresh'),
        ),
        h('button', { type: 'button', className: 'napi-btn', onClick: () => setDialog('manage') }, t('manage')),
      )

      const banner =
        error === null
          ? null
          : h(
              'div',
              { className: 'napi-banner' },
              h('div', { className: 'napi-banner-text' }, `${t('errorTitle')}：${error}`),
              h('button', { type: 'button', className: 'napi-btn', onClick: () => load(true) }, t('retry')),
            )

      const overlay =
        dialog === null
          ? null
          : h(
              'div',
              {
                className: 'napi-overlay',
                onMouseDown: (event) => {
                  if (event.target === event.currentTarget) closeDialog()
                },
              },
              dialog === 'form' && draft !== null
                ? h(SiteForm, {
                    draft,
                    saving,
                    error: formError,
                    onChange: (patch) => setDraft((previous) => ({ ...previous, ...patch })),
                    onSubmit: () => submitForm(),
                    onCancel: closeDialog,
                    t,
                  })
                : h(
                    'div',
                    { className: 'napi-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('manage') },
                    h(
                      'div',
                      { className: 'napi-dialog-head' },
                      h('div', { className: 'napi-dialog-title' }, t('manage')),
                      h('button', { type: 'button', className: 'napi-btn napi-btn-primary', onClick: openAdd }, t('addSite')),
                    ),
                    state.sites.length === 0
                      ? h('div', { className: 'napi-hint' }, t('emptyHint'))
                      : h(SiteList, {
                          sites: state.sites,
                          activeId: state.activeId,
                          confirmId,
                          onEdit: openEdit,
                          onActivate: activate,
                          onAskRemove: (id) => setConfirmId(id),
                          onCancelRemove: () => setConfirmId(null),
                          onRemove: removeSite,
                          t,
                        }),
                    h(
                      'div',
                      { className: 'napi-dialog-actions' },
                      h('button', { type: 'button', className: 'napi-btn napi-btn-ghost', onClick: closeDialog }, t('close')),
                    ),
                  ),
            )

      const page = (children) => h('div', { className: 'napi-page' }, h('style', null, CSS), header, children, overlay)

      if (state.status === 'idle') return page(h('div', { className: 'napi-hint' }, t('loading')))
      if (state.sites.length === 0) {
        return page(
          h(
            React.Fragment,
            null,
            banner,
            h(
              'div',
              { className: 'napi-empty' },
              h('div', { className: 'napi-empty-title' }, t('emptyTitle')),
              h('div', { className: 'napi-empty-hint' }, t('emptyHint')),
              h('button', { type: 'button', className: 'napi-btn napi-btn-primary', onClick: openAdd }, t('addSite')),
            ),
          ),
        )
      }

      return page(
        h(
          React.Fragment,
          null,
          state.sites.length > 1
            ? h(
                'div',
                { className: 'napi-chips' },
                state.sites.map((site) =>
                  h(
                    'button',
                    {
                      key: site.id,
                      type: 'button',
                      className: 'napi-chip',
                      'data-active': site.id === state.activeId ? 'true' : 'false',
                      onClick: () => activate(site.id),
                      title: site.baseUrl,
                    },
                    site.name,
                  ),
                ),
              )
            : null,
          banner,
          snapshot === null
            ? h('div', { className: 'napi-hint' }, t('noSite'))
            : h(
                React.Fragment,
                null,
                h(
                  'div',
                  { className: 'napi-grid' },
                  h(StatCard, {
                    label: t('balance'),
                    value: formatMoney(snapshot.user?.quota, snapshot),
                    hint: [snapshot.user?.name, snapshot.user?.group].filter(Boolean).join(' · '),
                  }),
                  h(StatCard, {
                    label: t('today'),
                    value: formatMoney(snapshot.today?.quota, snapshot),
                    hint:
                      snapshot.today && (snapshot.today.rpm !== null || snapshot.today.tpm !== null)
                        ? `${t('rpm')} ${formatCount(snapshot.today.rpm)} · ${t('tpm')} ${formatCount(snapshot.today.tpm)}`
                        : null,
                  }),
                  h(StatCard, { label: t('month'), value: formatMoney(snapshot.month?.quota, snapshot) }),
                  h(StatCard, {
                    label: t('used'),
                    value: formatMoney(snapshot.user?.usedQuota, snapshot),
                    hint:
                      typeof snapshot.user?.requestCount === 'number'
                        ? t('requests', { count: formatCount(snapshot.user.requestCount) })
                        : t('requestsEmpty'),
                  }),
                ),
                h('div', { className: 'napi-split' }, h(TrendChart, { snapshot, t, locale }), h(TokenTable, { snapshot, t })),
              ),
          warnings.length > 0
            ? h('div', { className: 'napi-banner napi-banner-warn' }, h('div', { className: 'napi-banner-text' }, warnings.join('；')))
            : null,
        ),
      )
    }

    function PanelIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 18
      const opacity = props.active === true ? 1 : 0.72
      const bar = (x, y, height) =>
        h('rect', { key: `${x}`, x, y, width: 3.4, height, rx: 1.2, fill: 'currentColor', opacity })
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        bar(3.2, 12.4, 7.4),
        bar(8.8, 8.6, 11.2),
        bar(14.4, 4.8, 15),
        h('circle', { cx: 19.6, cy: 5.8, r: 2.3, fill: 'currentColor', opacity }),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = (key, values) => {
          const active = ctx.locale.getSnapshot().active
          const dictionary = DICTIONARIES[active] ?? DICTIONARIES.en
          if (Object.prototype.hasOwnProperty.call(dictionary, key)) return translate(dictionary, key, values)
          return translate(DICTIONARIES.en, key, values)
        }

        for (const [id, dictionary] of Object.entries(DICTIONARIES)) {
          ctx.effect(() => ctx.locale.register(NS, id, dictionary), `newapi-usage: ${id} dictionary`)
        }

        // `t` and the locale face travel as injected props: the frame's own `t` seat
        // is bound to a declared namespace, and Panel needs the face itself for
        // weekday formatting and for re-rendering on a locale switch.
        ctx.effect(
          () =>
            ctx.slots.inject('main', () =>
              ctx.slots.register(
                { name: 'main', key: PANEL_ID, inject: () => ({ t, locale: ctx.locale }) },
                Panel,
              ),
            ),
          'newapi-usage: main panel',
        )

        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.panellist', () =>
              ctx.slots.register(
                { name: 'sidebar.panellist', id: PANEL_ID, order: 32, locale: NS, label: () => t('panel') },
                PanelIcon,
              ),
            ),
          'newapi-usage: sidebar entry',
        )
      },
    }
  },
})
