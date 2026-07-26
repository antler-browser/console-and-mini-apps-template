# CLAUDE.md — Host Console

Guidance for Claude Code when working on `apps/console`, the multi-app **host**.

## Project Overview

This app is the catch-all Cloudflare Worker for the whole domain. It serves a **landing
grid** of mini apps (`client/src/apps.ts`) at `/`, an SPA fallback for unclaimed paths,
and an authed **admin console** (Settings → Admin). Each mini app is an independent
Worker bound to `<domain>/<slug>/*` — the most-specific route wins, so child apps
automatically override this catch-all for their own paths. The bare `/<slug>` path is
not claimed; inbound links always use the trailing-slash form `/<slug>/`.

Unlike the mini apps, the host has **no Durable Object and no WebSockets**. It does have
its own D1 (the operator allowlist: `users.is_admin` gates the admin console) and binds
each managed child app's D1 directly so operators can manage users across apps.

See [`docs/domain-setup.md`](./docs/domain-setup.md) (zone + proxied DNS + routes
prerequisite) and [`docs/hosting-a-mini-app.md`](./docs/hosting-a-mini-app.md)
(child-app subpath + admin contract).

## Key Files

### Client (`client/`)

- `src/apps.ts` — **the landing-grid registry.** One entry per card; `internal: true`
  entries (Settings) use client-side routing, the rest are real cross-document links to
  `/<slug>/`
- `src/routes/home.tsx` — landing grid + "no mini apps yet" getting-started state
- `src/routes/settings.tsx` — profile + the admin section
- `src/components/admin/` — `AdminSection.tsx` (self-gating via `GET /api/admin/status`),
  `AdminAppCard.tsx` (per-app user management)
- `src/lib/adminApi.ts` — typed client for the admin API
- `src/hooks/useLocalFirstAuth.tsx` — auth state; exports `AuthProvider` and
  `useLocalFirstAuth()`
- `public/local-first-auth-manifest.json` — mini-app manifest (name, icon, permissions)

### Server (`server/`)

- `src/index.ts` — Hono router: profile endpoints + admin API (tables below)
- `src/admin-apps.ts` — resolves a managed app slug to its bound D1 (`dbForSlug`)
- `src/types.ts` — `Env`: host `DB`, `ALLOWED_PRODUCTION_ORIGIN`, plus one binding per
  `ChildBindingKey`
- `src/db/` — Drizzle schema, models, migrations for the host's own D1

### Shared (`shared/`)

- `src/apps.ts` — **`MANAGED_APPS` registry + `ChildBindingKey`**, the single source of
  truth shared by `alchemy.run.ts` (binds each child D1 by UUID) and
  `server/src/admin-apps.ts`. Currently empty (`ChildBindingKey = never`) — extend both
  when registering an app
- `src/jwt.ts` — `decodeAndVerifyJWT` (EdDSA signature, expiry, allowed origin)

## Development Commands

```bash
pnpm dev              # from apps/console: worker :8787 + vite :5173
pnpm dev:simulator    # …with a fake Local First Auth user (no phone needed)
pnpm build            # build shared, then client
pnpm db:run-migrations       # migrate the local host D1
pnpm db:generate-migrations  # regenerate migrations from schema changes
```

## API Reference

### Profile (host's own D1)

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api` | Health check | Public |
| `POST` | `/api/add-user` | Upsert caller's profile (name + socials) | JWT |
| `POST` | `/api/add-avatar` | Upsert caller's avatar | JWT |

### Admin (`/api/admin/*` — caller must be flagged `is_admin` in the host D1)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/status` | Is the caller an operator? (never errors; `isAdmin: false`) |
| `GET` | `/api/admin/apps/:slug/users` | List a managed app's users |
| `POST` | `/api/admin/apps/:slug/users/:did/grant-admin` | Make a user an admin of that app |
| `POST` | `/api/admin/apps/:slug/users/:did/revoke-admin` | Revoke a user's admin |
| `DELETE` | `/api/admin/apps/:slug/users/:did` | Remove a user from that app |
| `POST` | `/api/admin/apps/:slug/users/:did/block` | Block a user (needs a `blocked` column in the child app) |

Every admin endpoint independently re-verifies the caller server-side; the client-side
gate is visibility only. Granting the first operator is a manual DB edit — see
[`docs/admin-setup.md`](./docs/admin-setup.md).

## Registering a mini app with the host

The canonical checklist is **"Register with the host console"** in
[`docs/hosting-a-mini-app.md`](./docs/hosting-a-mini-app.md). In short, after the
child app's first deploy (you need its real prod D1 UUID from `wrangler d1 list`):

1. `client/src/apps.ts` — add the landing-grid card (`path: '/<slug>/'`, with trailing slash)
2. `shared/src/apps.ts` — add the entry to `MANAGED_APPS` **and** extend
   `ChildBindingKey` (replace `never` with the union of binding keys, e.g.
   `'DB_CHECK_IN'` — a `MANAGED_APPS` entry without it is a compile error)
3. `wrangler.toml` — add the matching `DB_<SLUG>` dev binding (commented example block
   is in the file)
4. Redeploy the host (`pnpm deploy:cloudflare`)

## Database

The host owns only its own D1 (`<workspace>-dev-db` locally, `<workspace>-<stage>-db`
in prod). Child databases are referenced by UUID, never created or migrated here.

```bash
pnpm wrangler d1 execute console-and-mini-apps-template-dev-db --local --command "SELECT * FROM users;"
pnpm wrangler d1 execute console-and-mini-apps-template-prod-db --remote --command "SELECT * FROM users;"
```

Migration workflow: edit `server/src/db/schema.ts` → `pnpm db:generate-migrations` →
`pnpm db:run-migrations` locally; production migrations apply automatically on deploy
via Alchemy's `migrationsDir`.

## Authentication

Auth uses the Local First Auth spec (full spec:
[`../../docs/local-first-auth-spec.md`](../../docs/local-first-auth-spec.md)): the
browser injects `window.localFirstAuth`, identity is a `did:key`, and API calls carry
short-lived EdDSA JWTs verified by `shared/src/jwt.ts` against `ALLOWED_PRODUCTION_ORIGIN`
(prod only — it's unset in dev, which skips the audience check).

Auth states in the client (`useLocalFirstAuth()`):

| State | Condition | Show |
|---|---|---|
| Loading | `loading === true` | Spinner |
| Logged out | `user === null` | Onboarding trigger (`setIsOnboardingModalOpen(true)`) |
| Logged in | `user !== null` | User content |

## Deployment

`alchemy.run.ts` deploys the Worker + host D1 + managed-app bindings
(`pnpm deploy:cloudflare`). `wrangler.toml` is **dev-only**. The `<domain>/*` catch-all
route attaches automatically at deploy once `ALLOWED_PRODUCTION_ORIGIN` is your real
domain (path routing needs a real zone + proxied DNS record — see
[`docs/domain-setup.md`](./docs/domain-setup.md)); with the placeholder still in place
you only get the workers.dev URL. The `ALLOWED_PRODUCTION_ORIGIN` value is a committed
literal in `alchemy.run.ts` on purpose (see [`docs/secrets.md`](./docs/secrets.md)) —
replace `https://your-domain.example` with your domain.

## Troubleshooting

- **JWT verification failures** — expired token, invalid signature, malformed DID
  (must start with `did:key:z`), or (prod only) the JWT's `aud` doesn't match
  `ALLOWED_PRODUCTION_ORIGIN`
- **Admin section not showing** — the caller's DID isn't flagged `is_admin` in the
  *host's* D1 ([`docs/admin-setup.md`](./docs/admin-setup.md))
- **"Unknown app" from admin endpoints** — slug not in `MANAGED_APPS`, or the dev
  binding is missing from `wrangler.toml`
- **Port 8787 in use** — see
  [`../../docs/port-troubleshooting.md`](../../docs/port-troubleshooting.md)
