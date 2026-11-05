# NewAPI Usage for DSH

A DeepSeek Harness Web plugin for monitoring one or more [NewAPI](https://github.com/QuantumNous/new-api) sites. Add a site URL and a NewAPI **System Access Token** in the panel to see account balance and usage without putting the token in the plugin configuration or browser bundle.

## Features

- Sidebar panel with balance, total spent, request count, today's spending, current-month spending, and RPM/TPM.
- Seven-day daily spending chart and per-token (API key) usage details.
- Multiple sites with independent credentials and a site switcher.
- Automatically reads the site's quota conversion rate and currency symbol from `/api/status`; falls back to 500,000 quota units per currency unit when unavailable.
- Keeps tokens in DSH's local credential store and only displays a masked token hint.
- Fetches NewAPI APIs from the DSH Host, avoiding browser CORS restrictions and keeping site tokens out of Client code.

## Compatibility

- DeepSeek Harness Web profile with the Web UI, connection, credential, layout, and sidebar services enabled.
- NewAPI-compatible management endpoints:
  - `GET /api/status`
  - `GET /api/user/self`
  - `GET /api/log/self/stat`
  - `GET /api/token/`
- Provide a NewAPI System Access Token (often prefixed `nap_`) or a compatible legacy access token. An OpenAI-compatible relay key such as `sk-...` cannot access the management API.

## Install

Install from this GitHub repository with the DSH plugin CLI:

```sh
npx -p @deepseek-ai/dsh dsh plugin --profile web add github:zzh407/dsh-newapi-usage
```

Restart the DSH Web process if the CLI asks for it. The plugin adds a **NewAPI Usage** entry to the sidebar.

## Configure

1. Open **NewAPI Usage** from the sidebar.
2. Choose **Sites** and **Add site**.
3. Enter a display name (optional), the site URL (for example `https://newapi.example.com`), and a System Access Token.
4. Save. The panel validates access when it loads usage; a site-specific error is shown if the token or URL is rejected.
5. Add further sites through **Sites**. Select a site chip to switch the dashboard.

The token field is write-only from the UI: the saved value is not sent back to the browser. Existing sites can be edited without entering a new token; leave the token field blank to retain it. To rotate a token, enter the replacement while editing the site.

## Data and privacy

- Site names, URLs, and tokens are stored in a DSH credential record named `newapi-usage/sites` in the local DSH home. The credential file is managed by DSH and is not part of this repository.
- The Client sends dashboard requests to the local authenticated DSH connection route. Only the Host contacts configured NewAPI sites.
- The plugin does not include analytics, telemetry, or a third-party proxy.
- Requests sent to a NewAPI site include its configured access token in the `Authorization` header. Only add sites you trust and use tokens with the minimum permissions needed to read your own account and usage.
- NewAPI servers may vary by version or operator configuration. Optional usage, status, or token endpoints can be unavailable; partial failures are reported in the panel.

## Usage definitions

- Spending is queried from `/api/log/self/stat` with explicit local-calendar day windows. The browser's local time zone defines the start of each day and month.
- The seven-day chart uses seven daily stat requests. It does not use `/api/data/self`, whose aggregation may differ by NewAPI version or server configuration.
- Currency values are calculated as `quota / quota_per_unit`; the server-provided quota rate is authoritative. When the status endpoint is unavailable, the default is 500,000 units per currency unit.
- A dashboard snapshot is cached for up to 60 seconds. The panel refreshes automatically every two minutes while open; use **Refresh** for an immediate update.
- Balance and account totals load first. Daily/monthly statistics and token details are loaded in the background and appear as they complete.

## Development

The bundle has a Host module (`index.js`) and a browser module (`client.js`), plus locale resources and an icon.

```sh
node --check index.js
node --check client.js
```

No third-party runtime dependency is required by the plugin. DSH provides the Client React runtime and the credential/connection services.

## Security and disclaimer

Installing a plugin grants its code the permissions of the DSH Host and Client services it uses. Review the source before installing and only use trusted NewAPI sites. This software is provided **as is**, without warranties or guarantees. You are responsible for your credentials, configured endpoints, and any consequences of using or installing the plugin. Publishing code to a public repository makes it visible and copyable; remove private data before publishing. No credential or user data should be committed to this repository.

## License

MIT. See [LICENSE](LICENSE).
