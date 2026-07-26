/**
 * Alchemy Configuration for Local First Auth Starter
 *
 * Deploys the starter mini-app to Cloudflare:
 * - D1 Database for user storage
 * - Durable Object for real-time WebSocket broadcasting
 * - Worker for API and static asset serving
 */

import alchemy from 'alchemy'
import { Assets, D1Database, DurableObjectNamespace, Worker } from 'alchemy/cloudflare'
import { CloudflareStateStore } from 'alchemy/state'
import type { Broadcaster } from './server/src/durable-object'

// The single origin this app accepts Local First Auth JWTs for. Committed literal
// on purpose — never read this from .env (alchemy deploy loads .env, so a local
// deploy would push a localhost origin to prod). Set at setup time by
// `pnpm setup-project --allowed-production-origin`; to change it later, edit this
// literal (in each app and the template). While it is still the placeholder, no
// routes are attached — the Worker only gets its workers.dev URL.
const ALLOWED_PRODUCTION_ORIGIN = 'https://x.example'
const hasRealOrigin = !ALLOWED_PRODUCTION_ORIGIN.includes('your-domain.example')

// Initialize Alchemy app with remote state store
const app = await alchemy('__APP_NAME__', {
  // Encryption key for secret values persisted to Alchemy state. Only required once
  // you add an alchemy.secret binding below — set it in .env before you do, and keep
  // it stable across deploys (changing it orphans previously-encrypted state).
  password: process.env.ALCHEMY_PASSWORD,
  stateStore: (scope) => new CloudflareStateStore(scope),
})

/**
 * D1 Database
 * Stores user information
 */
const database = await D1Database(`${app.name}-${app.stage}-db`, {
  name: `${app.name}-${app.stage}-db`,
  migrationsDir: './server/src/db/migrations',
  adopt: true,
})

/**
 * Static Assets
 * Client build directory containing the React app
 */
const staticAssets = await Assets({
  path: './client/dist',
})

/**
 * Durable Object Namespace
 * Manages real-time WebSocket connections for broadcasting user updates
 */
const durableObject = DurableObjectNamespace<Broadcaster>(`${app.name}-${app.stage}-durable-object`, {
  className: 'Broadcaster',
  sqlite: true,
})

/**
 * Cloudflare Worker
 * Handles API routes, WebSocket upgrades, and serves static client assets
 */
export const worker = await Worker('worker', {
  name: `${app.name}-${app.stage}`,
  entrypoint: './server/src/index.ts',
  bindings: {
    DB: database,
    DURABLE_OBJECT: durableObject,
    ASSETS: staticAssets,
    ALLOWED_PRODUCTION_ORIGIN,
    // Example runtime secret — the full pattern (see docs/secrets.md):
    //   1. add MY_SECRET= to .env and .env.example
    //   2. add it to [secrets] required in wrangler.toml (local dev)
    //   3. bind it here — alchemy.secret.env throws at deploy time if unset in .env
    //   4. add `MY_SECRET?: string` to server/src/types.ts
    // MY_SECRET: alchemy.secret.env.MY_SECRET,
  },
  assets: {
    html_handling: 'auto-trailing-slash',
    not_found_handling: 'single-page-application',
    // Assets are keyed at dist root but requested under /<slug>/ — the worker must
    // run first to strip the prefix before the ASSETS lookup (see server/src/index.ts).
    run_worker_first: true,
  },
  // Claim /<slug>/* (assets + in-app routes) on the shared domain. Most-specific
  // route wins, so this overrides the host console's catch-all. The bare /<slug>
  // path is deliberately not claimed — every inbound link uses the trailing-slash
  // form /<slug>/. Activates automatically once ALLOWED_PRODUCTION_ORIGIN is your
  // real domain.
  ...(hasRealOrigin
    ? {
        routes: [
          `${new URL(ALLOWED_PRODUCTION_ORIGIN).host}/__SLUG__/*`,
        ],
      }
    : {}),
  url: true,
})

// Finalize deployment
await app.finalize()

console.log('✅ Alchemy deployment complete')
console.log(`📦 App: ${app.name}`)
console.log(`🌍 Stage: ${app.stage}`)
console.log(`🗄️  D1 Database: ${database.name}`)
console.log(`🔄 Durable Object: ${durableObject.className}`)
console.log(`⚡ Worker: ${worker.name}`)
console.log(`🌐 URL: ${worker.url}`)
