/**
 * Alchemy configuration for the multi-app HOST.
 *
 * This app is the catch-all Worker: it serves the landing-grid SPA and an SPA
 * fallback for any path not claimed by a more-specific child app Worker. Child
 * mini apps live at `apps/<slug>` in this workspace, are deployed independently, and
 * bind their own route pattern (`<domain>/<slug>/*`). Cloudflare
 * resolves the most-specific route first, so child apps automatically override this
 * catch-all.
 *
 * Path-based routes only work on a Cloudflare zone (a custom domain), NOT on
 * *.workers.dev. This script always deploys to a workers.dev URL via `url: true`, and
 * additionally attaches the `<domain>/*` catch-all route automatically once
 * ALLOWED_PRODUCTION_ORIGIN below is your real domain — the zone + a proxied DNS
 * record must already exist (see docs/domain-setup.md §1-2).
 */

import alchemy from 'alchemy'
import { Assets, D1Database, Worker } from 'alchemy/cloudflare'
import { CloudflareStateStore } from 'alchemy/state'
import { MANAGED_APPS } from '@console-and-mini-apps-template/console-shared'

// The single origin we accept Local First Auth JWTs for. All apps are path-routed
// on one origin, so the per-origin DID is identical across every mini app. Committed
// literal on purpose — never read this from .env (alchemy deploy loads .env, so a
// local deploy would push a localhost origin to prod). Set at setup time by
// `pnpm setup-project --allowed-production-origin`; to change it later, edit this
// literal (in each app and the template). While it is still the placeholder, no
// routes are attached — the Worker only gets its workers.dev URL. See docs/secrets.md.
const ALLOWED_PRODUCTION_ORIGIN = 'https://x.example'
const hasRealOrigin = !ALLOWED_PRODUCTION_ORIGIN.includes('your-domain.example')

// Initialize Alchemy app with remote state store
const app = await alchemy('console-and-mini-apps-template', {
  stateStore: (scope) => new CloudflareStateStore(scope),
})

/**
 * Static Assets — the built landing-grid client.
 */
const staticAssets = await Assets({
  path: './client/dist',
})

/**
 * Host's own D1 — stores the operator allowlist (`users.is_admin`) that gates the admin
 * console. The host owns this schema, so it applies its own migrations.
 */
const database = await D1Database(`${app.name}-${app.stage}-db`, {
  name: `${app.name}-${app.stage}-db`,
  migrationsDir: './server/src/db/migrations',
  adopt: true,
})

/**
 * Managed child app D1s, REFERENCED by UUID (NOT created, adopted, or migrated here — each
 * child app owns and migrates its own schema). The host only needs the database id to bind it
 * and write `users.is_admin` directly. Because this is a plain reference object (not a managed
 * `D1Database()` resource), the host can never create/replace/delete the child's database — it
 * just points at the existing one. This requires every app to live in the same pinned
 * Cloudflare account (see docs/domain-setup.md §3).
 *
 * One Worker binding per `MANAGED_APPS` entry — the registry in `@console-and-mini-apps-template/console-shared` is the single
 * source of truth (including each DB's `databaseId`), shared with server/src/admin-apps.ts.
 * Keep wrangler.toml's dev bindings in sync with it.
 */
const managedDbBindings = Object.fromEntries(
  MANAGED_APPS.map((managedApp) => [
    managedApp.bindingKey,
    {
      type: 'd1',
      id: managedApp.databaseId,
      name: managedApp.dbName,
      dev: { id: managedApp.databaseId, remote: false },
    } satisfies D1Database,
  ]),
)

/**
 * Catch-all host Worker. Always deploys to a workers.dev URL (a first smoke test);
 * the custom-domain route attaches automatically below once ALLOWED_PRODUCTION_ORIGIN
 * is your real domain. See docs/domain-setup.md.
 */
export const worker = await Worker('worker', {
  name: `${app.name}-${app.stage}`,
  entrypoint: './server/src/index.ts',
  bindings: {
    ASSETS: staticAssets,
    DB: database,
    ...managedDbBindings,
    // Left unset in dev (wrangler.toml), which skips the audience check.
    ALLOWED_PRODUCTION_ORIGIN,
  },
  assets: {
    html_handling: 'auto-trailing-slash',
    not_found_handling: 'single-page-application',
  },
  // Claim `<domain>/*` — the catch-all. Child mini apps bind more-specific
  // `/<slug>/*` routes that win over this. Activates automatically once
  // ALLOWED_PRODUCTION_ORIGIN is your real domain (the zone + a proxied DNS record
  // must already exist — see docs/domain-setup.md §1-2).
  ...(hasRealOrigin
    ? { routes: [`${new URL(ALLOWED_PRODUCTION_ORIGIN).host}/*`] }
    : {}),
  url: true,
})

// Finalize deployment
await app.finalize()

console.log('✅ Alchemy deployment complete')
console.log(`📦 App: ${app.name}`)
console.log(`🌍 Stage: ${app.stage}`)
console.log(`🗄️  Host D1: ${database.name}`)
console.log(`⚡ Worker: ${worker.name}`)
console.log(`🌐 URL: ${worker.url}`)
