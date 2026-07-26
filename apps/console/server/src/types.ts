/**
 * Cloudflare Workers environment bindings for the host (catch-all) Worker.
 *
 * The host serves the landing-grid SPA, and now also acts as an admin console: it has
 * its OWN D1 (operator allowlist, used to gate the console) plus direct bindings to each
 * managed child app's D1 (where it flips `users.is_admin`). The child databases are
 * referenced by UUID in alchemy.run.ts / wrangler.toml (the child apps own them) and live
 * in the same Cloudflare account. The ASSETS binding is handled by Alchemy's Worker `assets` config.
 */
import type { ChildBindingKey } from '@console-and-mini-apps-template/console-shared'

/**
 * Managed child app D1s are referenced by UUID and keyed by `ChildBindingKey` from
 * `@console-and-mini-apps-template/console-shared` (the single source of truth for the registry), so the binding keys
 * here can't drift from server/src/admin-apps.ts or alchemy.run.ts.
 */
export type Env = {
  /** Host's own D1 — stores the operator allowlist (`users.is_admin`) that gates the console. */
  DB: D1Database

  /**
   * The single production origin this Worker accepts Local First Auth JWTs for;
   * unset in dev, which skips the audience check. local-first-auth v3 signs with
   * a per-origin key, so a JWT minted at another origin carries a different DID —
   * reject it (see shared/src/jwt.ts).
   */
  ALLOWED_PRODUCTION_ORIGIN?: string
} & Record<ChildBindingKey, D1Database>
