# Hosting a mini app at a subpath

Each mini app is an **independent Cloudflare Worker** (its own D1 + Durable Object) that
claims a path on the shared hostname. Apps normally live at `apps/<slug>` in this
workspace, scaffolded by `pnpm new-app <slug>`; an app in an external repo can join the
domain too as long as it follows the same contract. The host serves the landing grid at
`/` and a catch-all for everything else; a child app on `/<slug>/*` overrides the
catch-all because Cloudflare resolves the **most-specific route first**.

The doc has two parts:

- **Part A — the subpath contract.** Apps scaffolded by `pnpm new-app` already comply
  with all of it; read it as reference, or as a conversion checklist for an external
  app that wasn't built from the template.
- **Part B — registering with the host console.** Always manual, after the app's first
  deploy. This is the canonical checklist — other docs link here.

Throughout, replace `guestbook` with your app's slug.

## Part A — The subpath contract

### 1. Vite base path

`client/vite.config.ts`:

```ts
export default defineConfig({
  base: '/guestbook/', // rewrites every built asset URL under the subpath
  plugins: [react(), tailwindcss()],
})
```

In dev, the proxy key must carry the prefix too — the client requests
`/guestbook/api/...`:

```ts
proxy: {
  '/guestbook/api': { target: 'http://localhost:8788', changeOrigin: true, ws: true },
}
```

### 2. React Router basename

`client/src/routes/index.tsx`:

```ts
export const router = createBrowserRouter(
  [/* ...routes... */],
  { basename: import.meta.env.BASE_URL }, // = '/guestbook/' in this build
)
```

Use relative `<Link>`s as usual — the basename is applied automatically.

### 3. Client API + WebSocket calls must be base-relative

The child Worker is reached at `/guestbook/...`, so API calls must include the base.
`import.meta.env.BASE_URL` is `'/guestbook/'` (note the trailing slash):

```ts
// REST
await fetch(`${import.meta.env.BASE_URL}api/users`)        // -> /guestbook/api/users

// WebSocket
const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
const ws = new WebSocket(`${proto}//${location.host}${import.meta.env.BASE_URL}api/ws`)
// -> wss://<domain>/guestbook/api/ws
```

### 4. Server (Hono) must account for the path prefix

The Worker is bound to `/guestbook*`, so it receives the full path including the prefix.
Mount the whole app under the base path so your existing `/api/...` handlers match:

```ts
// receives /guestbook/api/users -> matches app.get('/api/users', ...)
const app = new Hono<{ Bindings: Env }>().basePath('/guestbook')
```

(Consequence in dev: the worker 404s at a bare `/api/...` — always go through the
prefixed path, or the Vite proxy.)

### 5. Alchemy route + worker-first asset serving + own infrastructure

In the child app's `alchemy.run.ts`, bind the subtree route, keep the SPA fallback, and
set `run_worker_first` so the worker sees every request. Give the app its **own** D1 and
Durable Object (full isolation):

```ts
export const worker = await Worker('worker', {
  name: `${app.name}-${app.stage}`,
  entrypoint: './server/src/index.ts',
  bindings: { DB: database, DURABLE_OBJECT: durableObject, ASSETS: staticAssets },
  assets: {
    html_handling: 'auto-trailing-slash',
    not_found_handling: 'single-page-application',
    run_worker_first: true,
  },
  routes: [
    'example.com/guestbook/*',
  ],
})
```

Only `/guestbook/*` is claimed — the bare `/guestbook` path is deliberately left to the
host's catch-all, so **every inbound link must use the trailing-slash form
`/guestbook/`**. Template-scaffolded apps derive the route from
`ALLOWED_PRODUCTION_ORIGIN` automatically once it is set to the real domain
(edit the literal in the app's `alchemy.run.ts`).

`run_worker_first` matters because assets are uploaded at dist-root keys
(`/assets/x.js`) while the page requests them under the subpath
(`/guestbook/assets/x.js`) — without it, asset requests 404 in the worker. The worker's
default export must therefore proxy every non-API path to the `ASSETS` binding with the
prefix stripped; see the template's `server/src/index.ts` default export for the
reference implementation:

```ts
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/guestbook/api' || url.pathname.startsWith('/guestbook/api/')) {
      return app.fetch(request, env, ctx)
    }
    // Assets are keyed at dist root; unknown paths fall through to index.html (SPA).
    url.pathname = url.pathname.slice('/guestbook'.length) || '/'
    return env.ASSETS.fetch(new Request(url.toString(), request))
  },
}
```

### 6. Manifest

Give the app a unique `name` in `client/public/local-first-auth-manifest.json`
(scaffolded apps get their Title Case slug).

## Part B — Register with the host console

Do this after the app's **first deploy** (you need its real prod D1 UUID). Four edits,
all in `apps/console`, then redeploy the host:

### 1. Get the app's prod D1 UUID

```bash
cd apps/guestbook && pnpm exec wrangler d1 list
# note the uuid of <workspace>-guestbook-mini-app-prod-db
```

### 2. Landing-grid card — `client/src/apps.ts`

```ts
{ slug: 'guestbook', name: 'Guestbook', description: '…', path: '/guestbook/', icon: '📖', accent: 'from-rose-400 to-orange-300' }
```

`path` MUST be `/<slug>/` **with the trailing slash** — it's a real cross-document link,
and the child Worker only claims `/<slug>/*`; the bare `/<slug>` URL falls to the host's
catch-all and won't render the app.

### 3. Managed-app registry — `shared/src/apps.ts` (required, not optional)

Add the entry to `MANAGED_APPS` **and** extend `ChildBindingKey` — leaving the type as
`never` while adding an entry is a compile error:

```ts
export type ChildBindingKey = 'DB_GUESTBOOK'

export const MANAGED_APPS: ManagedApp[] = [
  {
    slug: 'guestbook',
    bindingKey: 'DB_GUESTBOOK',
    dbName: '<workspace>-guestbook-mini-app-prod-db',
    databaseId: '<uuid from step 1>',
  },
]
```

`alchemy.run.ts` and `server/src/admin-apps.ts` both derive from this registry — the
UUID is the only sync point; nothing else is edited by hand.

### 4. Dev D1 binding — `wrangler.toml`

```toml
[[d1_databases]]
binding = "DB_GUESTBOOK"
database_name = "<workspace>-guestbook-mini-app-dev-db"
database_id = "guestbook-local"
```

Under `wrangler dev --local` the `database_id` is just a local storage key — any unique
string works; the console gets its own empty local copy of the child DB, not the
child's live dev data.

### 5. Redeploy the host

```bash
cd apps/console && pnpm run deploy:cloudflare
```

## Admin console requirements for the child app

The host's Settings → Admin section lets an operator manage users across **every**
managed mini app (grant/revoke admin, block, remove). Rather than each app exposing an
HTTP admin surface, the **host Worker binds each app's D1 database directly** (by UUID,
via `MANAGED_APPS`) and writes `users.is_admin` itself. This is simpler to operate at
the cost of one hard requirement:

> **All apps must live in the same pinned Cloudflare account** (`CLOUDFLARE_ACCOUNT_ID`,
> see [`docs/domain-setup.md`](./domain-setup.md) §3). D1 bindings are account-scoped, so a
> Worker can only bind databases in its own account.

What this means for a child app:

- **Keep the standard `users` table** with a `did` primary key and an `is_admin` column
  (the template schema has this). Grant/revoke/remove/list need no change.
- **Block needs a `blocked` column.** Template-scaffolded apps ship it. An external app
  that lacks it will see the console's "Block" action return an error (the other
  actions still work).

Authorization lives entirely on the host: it verifies the operator's JWT with
`decodeAndVerifyJWT` and checks the issuer DID against its own `is_admin` allowlist.
