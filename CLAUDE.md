# CLAUDE.md — Console And Mini Apps Template workspace

Guidance for Claude Code when working in this repository.

## What this repo is

A pnpm workspace hosting a family of Local First Auth mini apps on one domain:

| Path | Role |
|---|---|
| `apps/console/` | The **host**: catch-all Cloudflare Worker serving the landing grid at `/`, SPA fallback, and the Settings → Admin console. Has its own D1 (operator allowlist). No Durable Object. |
| `apps/<slug>/` | Mini apps scaffolded by `pnpm new-app <slug>` — each an independent Worker with its own D1 (+ Durable Object for WebSockets), served under `/<slug>/`. |
| `templates/mini-app-starter/` | The vendored starter that `new-app` copies. **Excluded from the workspace** (generic `@starter/*` names, plus `__SLUG__`/`__SLUG_TITLE__`/`__APP_NAME__` placeholder tokens resolved at scaffold time). Edit it to change what future apps start from; see its `UPSTREAM.md`. |
| `scripts/` | Root scaffolding: `new-app.ts`, `setup-project.ts`, `lib/workspace.ts`. |
| `docs/` | Shared reference docs: auth spec, mini-app examples, port troubleshooting. |

Every app is a package trio (`client` = React 19 + Vite + Tailwind 4, `server` = Hono +
Drizzle + D1, `shared` = JWT verification), deployed independently via Alchemy
(`alchemy.run.ts`; `wrangler.toml` is dev-only).

The workspace name in the root `package.json` is the single source of truth for naming:
package scopes are `@<name>/*`, Cloudflare resources `<name>-…`, display strings its
Title Case. Scripts derive from it — never hardcode the project name.

## Commands

```bash
pnpm install
pnpm build                  # build every app
pnpm typecheck              # tsc -b every app
pnpm new-app <slug>         # scaffold a mini app from the template
pnpm setup-project [name] [--allowed-production-origin <url>] [--github-url <url>]
                   [--alchemy-state-token <value>]
                            # one-time project setup: name + optional prod settings
```

Per-app commands run from inside the app's directory (`cd apps/<slug>`):

```bash
pnpm dev                    # worker + vite (console: worker :8787, vite :5173)
pnpm dev:simulator          # same, with a fake signed-in user (no phone needed)
pnpm run db:generate-migrations / db:run-migrations / deploy:cloudflare
```

(`pnpm --filter @<workspace>/<slug> run <script>` also works from the root.)

## Project Setup (Claude: Follow These Instructions)

**When to run these steps:** when the user asks to "set up" or "initialize" this
project — it is **one-time**: it refuses to run on a workspace that was already set
up (renamed, or with mini apps under `apps/`), and its error message lists the files
to edit by hand instead.

Run: `pnpm setup-project {kebab-case-name}` (defaults to the repo directory name). It
rewrites the package scope, Cloudflare resource names, and display strings from the
template name to the new one, reinstalls, and migrates the console's local D1
(fully local — dev D1 ids are just local storage keys, no Cloudflare auth needed).
It also ensures `ALCHEMY_STATE_TOKEN` is set in `apps/console/.env` (a self-chosen
secret; one token per Cloudflare account). Interactive runs are prompted; runs from
Claude/CI are non-TTY, so the prompt is skipped — ask the user whether their
Cloudflare account already has a token from another Alchemy project (it must be
reused), then pass it via `--alchemy-state-token <value>`; only generate a fresh one
(`openssl rand -hex 32`) if they don't have one.
Optional flags: `--allowed-production-origin <url>` sets `ALLOWED_PRODUCTION_ORIGIN`
and `--github-url <url>` sets the footer link (`client/src/components/Footer.tsx`) —
both in `apps/console` and in `templates/mini-app-starter`, so apps scaffolded later
by `new-app` inherit the values. To change either after setup, edit those files
directly (in each existing app and the template). It ends with a checklist of only
what remains manual (e.g. the GitHub template flag). Ordering rule: run it **before**
`pnpm new-app` — scaffolded apps bake in the workspace name (the guard enforces
this).

## Adding a mini app (Claude: Follow These Instructions)

1. `pnpm new-app <slug>` — scaffolds `apps/<slug>` fully wired for `/<slug>/` subpath
   serving (Vite base + proxy, router basename, Hono basePath, Alchemy routes), claims
   ports, wires the root tsconfig, installs, and runs the app's local migrations.
   `cd apps/<slug> && pnpm dev` works immediately.
2. Build the app's features inside `apps/<slug>` (see its own `CLAUDE.md`, copied from
   the template).
3. After its first deploy, register it with the host console (needs the real prod D1
   UUID): follow "Register with the host console" in
   `apps/console/docs/hosting-a-mini-app.md` — landing-grid card, `MANAGED_APPS` +
   `ChildBindingKey`, `DB_<SLUG>` dev binding, redeploy the host.

## Auth in one paragraph

Users sign in by scanning a QR code with Antler Browser, which injects
`window.localFirstAuth`; identity is a `did:key` and requests carry short-lived EdDSA
JWTs verified server-side by each app's `shared/src/jwt.ts` (`decodeAndVerifyJWT`,
checks signature + expiry + allowed origin). Local dev without a phone:
`cd apps/<app> && pnpm dev:simulator`. Full spec:
`docs/local-first-auth-spec.md`.

## More docs

- `apps/console/CLAUDE.md` — the host console's architecture, admin API, registry
- `templates/mini-app-starter/CLAUDE.md` — what scaffolded apps look like inside
- `docs/mini-app-examples.md` — reference mini apps to learn patterns from
- `apps/console/docs/` — host-specific: domain setup, hosting contract, admin setup, secrets
