# Console And Mini Apps Template — Mini App Host

## Overview

This repo is the **host** for a collection of Console And Mini Apps Template mini apps. It's a single catch-all
Cloudflare Worker that:

- serves a **landing grid** of mini apps at `/` (driven by `client/src/apps.ts`),
- provides an **SPA fallback** for any path not claimed by a child app, and
- exposes an authed **admin console** (Settings → Admin) for managing users across every
  mini app.

Each mini app is an **independent Worker** — scaffolded into `apps/<slug>` in this
workspace with `pnpm new-app <slug>` (or, less commonly, living in an external repo).
This makes it easy to code, deploy and manage each app separately. Each app is bound to
`<domain>/<slug>/*`.

## How it works

**Landing grid.** The cards shown at `/` come from `client/src/apps.ts` (the `apps` array).
Each entry links to `/<slug>/` as a real cross-document navigation, so the request lands on
that child app's Worker. Host-served routes (like Settings) are marked `internal` and use
client-side routing instead.

**Child apps.** Mini apps deploy as their own Workers, each with
its own D1 database and (if needed) Durable Object. They bind two route patterns —
`<domain>/<slug>` and `<domain>/<slug>/*` — which win over the host's `<domain>/*` catch-all.
Path-based routes only work on a **Cloudflare zone** (a custom domain), not `*.workers.dev`.
See [`docs/domain-setup.md`](./docs/domain-setup.md) and
[`docs/hosting-a-mini-app.md`](./docs/hosting-a-mini-app.md).

**Admin console.** The host has its **own** D1 database whose `users.is_admin` column is the
operator allowlist that gates the console. To manage users in a mini app, the host Worker
**binds that app's D1 directly** and flips `users.is_admin` itself — so child apps don't need
to build their own admin endpoints. This requires every app to live in the same pinned
Cloudflare account. The managed-app registry is `shared/src/apps.ts` (`MANAGED_APPS`),
resolved to bound databases by `server/src/admin-apps.ts`. See
[`docs/admin-setup.md`](./docs/admin-setup.md).

## Project Structure

This is a pnpm workspace monorepo with three packages:

| Package | Description |
|---------|-------------|
| `client/` | React landing grid + Settings/admin UI |
| `server/` | Hono host Worker (SPA fallback + `/api/admin/*`) and the host's own D1 |
| `shared/` | JWT verification utilities + the `MANAGED_APPS` registry |

## Getting Started (local dev)

This project uses pnpm. If you don't have it: `brew install pnpm`.

```bash
pnpm install            # Install all workspace dependencies
pnpm db:run-migrations  # Initialize / migrate the local host D1 database
pnpm dev                # Start the host (worker + client)
pnpm dev:simulator      # ...or start with a Local First Auth test user
```

## Adding a mini app to the grid

Follow the canonical checklist — **"Register with the host console"** in
[`docs/hosting-a-mini-app.md`](./docs/hosting-a-mini-app.md). In short: deploy the
child app once, then add its card to `client/src/apps.ts`, add it to `MANAGED_APPS`
**and** `ChildBindingKey` in `shared/src/apps.ts` (required together — one without the
other is a compile error), add the `DB_<SLUG>` dev binding in `wrangler.toml`, and
redeploy the host.

## Deployment

The host deploys to Cloudflare with [Alchemy](https://alchemy.run) (config in
`alchemy.run.ts`). Configure a Cloudflare API token (see the
[Alchemy CLI docs](https://alchemy.run/docs/cli/configuration)):

```bash
# pnpm setup-project already created .env with ALCHEMY_STATE_TOKEN — just fill in
# CLOUDFLARE_ACCOUNT_ID (no .env yet? cp .env.example .env, see its comments)
pnpm alchemy configure       # from this directory (alchemy is a devDep here)
pnpm run deploy:cloudflare   # build + alchemy deploy
```

`ALCHEMY_STATE_TOKEN` is a self-chosen secret guarding Alchemy's state Worker; one
token per Cloudflare account — reuse an existing one if another Alchemy project
already deployed there (`pnpm setup-project` handles this).

A custom domain / Cloudflare zone is a prerequisite for path-based routing — set that up
first per [`docs/domain-setup.md`](./docs/domain-setup.md). Once `ALLOWED_PRODUCTION_ORIGIN`
in `alchemy.run.ts` is your real domain, deploying attaches the host's `<domain>/*`
catch-all route automatically.

## Documentation

- [CLAUDE.md](./CLAUDE.md) — development guide for Claude Code
- [docs/domain-setup.md](./docs/domain-setup.md) — Cloudflare zone + proxied DNS + routes (prerequisite)
- [docs/hosting-a-mini-app.md](./docs/hosting-a-mini-app.md) — child-app subpath contract + admin console binding
- [docs/admin-setup.md](./docs/admin-setup.md) — host operators vs per-app admins
- [../../docs/local-first-auth-spec.md](../../docs/local-first-auth-spec.md) — Local First Auth specification
- [../../docs/mini-app-examples.md](../../docs/mini-app-examples.md) — reference mini app implementations
- [../../docs/port-troubleshooting.md](../../docs/port-troubleshooting.md) — freeing port 8787
