/**
 * Cloudflare Workers environment bindings
 */
export interface Env {
  // D1 Database binding
  DB: D1Database

  // Durable Object namespace for real-time WebSocket broadcasting
  DURABLE_OBJECT: DurableObjectNamespace

  // Static assets binding — the worker proxies non-API requests to it with the
  // /__SLUG__ prefix stripped (asset keys are dist-root-relative)
  ASSETS: Fetcher

  // The single production origin this Worker accepts Local First Auth JWTs for;
  // unset in dev, which skips the audience check. local-first-auth v3 signs with
  // a per-origin key, so a JWT minted at another origin carries a different DID —
  // reject it (see shared/src/jwt.ts).
  ALLOWED_PRODUCTION_ORIGIN?: string

  // Example runtime secret (see docs/secrets.md for the full add-a-secret pattern).
  // Dev: plain string from `.env` via [secrets] required in wrangler.toml.
  // Prod: Worker secret bound via alchemy.secret.env in alchemy.run.ts.
  // MY_SECRET?: string
}
