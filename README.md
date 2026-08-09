# Console And Mini Apps Template

A starter template for hosting a family of [Local First Auth](docs/local-first-auth-spec.md)
mini apps on one domain — a **host console** (landing grid + admin) plus as many
**mini apps** as you scaffold, each an independent Cloudflare Worker, all in one pnpm
workspace.

Built with React 19, Vite 7, Tailwind 4 (client) · Hono, Drizzle, Cloudflare D1 +
Durable Objects (server) · [Alchemy](https://alchemy.run) (deploys) ·
[local-first-auth](docs/local-first-auth-spec.md) (QR-code sign-in via
[Antler Browser](https://antlerbrowser.com), no passwords or signup forms).

```
apps/
  console/            Host worker — landing grid at /, Settings → Admin console.
templates/
  mini-app-starter/   The starter new apps are generated from. Yours to edit.
scripts/
  new-app.ts          pnpm new-app <slug>      — scaffold a mini app
  setup-project.ts    pnpm setup-project name  — one-time setup: name, creds, origin, repo link
docs/                 Shared reference docs (auth spec, examples, troubleshooting)
```

Each app is a self-contained trio of packages (`client` / `server` / `shared`) with its
own `wrangler.toml` and `alchemy.run.ts`, so **apps deploy independently** — the
monorepo changes how they're developed, not how they ship.

## Use this template

1. Click **Use this template** on GitHub (or fork), then clone your copy.
2. Install and run the setup wizard:

   ```bash
   pnpm install
   pnpm setup-project
   ```

   Run from a terminal, it walks you through all five settings — project name,
   `ALCHEMY_STATE_TOKEN` (press Enter to generate one), `CLOUDFLARE_ACCOUNT_ID`,
   production origin, and your fork's GitHub URL — and everything but the name is
   skippable. It rewrites the package scope (`@my-space/*`), Cloudflare resource
   names (`my-space-dev`, `my-space-dev-db`), and display strings ("Welcome to
   My Space") in one shot, writes the deploy creds to `apps/console/.env`, migrates
   the console's local D1 (fully local — no Cloudflare account needed), and prints
   a checklist of anything left.

   Every question can also be answered up front — the positional name plus
   `--alchemy-state-token`, `--cloudflare-account-id`,
   `--allowed-production-origin`, and `--github-url` — and any flag you pass skips
   its question. Non-interactive runs (CI, Claude Code) never prompt: they use the
   flags as given, and anything unset lands on the closing checklist instead.

   ```bash
   pnpm setup-project my-space \
     --allowed-production-origin https://my.domain \
     --github-url https://github.com/you/your-fork
   ```

   Setup is one-time — the name defaults to the repo directory, and re-running on
   an already-set-up project errors out; later changes are plain file edits (the
   error message says which files).

   Run `setup-project` **before** scaffolding any apps — `new-app` bakes the
   workspace name into everything it generates.
3. Run the host console:

   ```bash
   cd apps/console
   pnpm dev             # worker :8787, vite :5173
   pnpm dev:simulator   # …with a fake signed-in user
   ```

Requires Node >= 22 (`.nvmrc`) and pnpm 10.

## Everyday commands

| Command | What it does |
|---|---|
| `cd apps/<app> && pnpm dev` | Run an app (console is worker :8787, vite :5173) |
| `cd apps/<app> && pnpm dev:simulator` | Run an app with a fake signed-in user — the only way to sign in without a phone |
| `pnpm build` | Build every app (from the root) |
| `pnpm typecheck` | Typecheck every app (from the root) |
| `pnpm new-app <slug>` | Scaffold a new mini app |
| `pnpm setup-project [name] [--alchemy-state-token <value>] [--cloudflare-account-id <id>] [--allowed-production-origin <url>] [--github-url <url>]` | One-time project setup: name, deploy creds, prod origin, footer repo link (a wizard when run interactively) |

Each app claims its own worker + vite port pair (console is 8787/5173, the next app
gets 8788/5174, and so on). Anything app-specific runs from the app's directory,
e.g. `cd apps/check-in && pnpm run db:generate-migrations`.

## Adding a mini app

```bash
pnpm new-app check-in
```

This copies `templates/mini-app-starter` into `apps/check-in`, rescopes its packages to
`@<workspace>/check-in-*`, names its Cloudflare resources
`<workspace>-check-in-mini-app`, claims a free port pair, wires the full `/check-in/`
subpath serving (Vite base + proxy, router basename, Hono basePath, Alchemy routes),
adds the root tsconfig reference, installs, and runs the app's local D1 migrations.
`cd apps/check-in && pnpm dev` works immediately.

It ends with a short checklist; the one genuinely manual step is **registering the app
with the host console** after its first deploy (needs the real prod D1 UUID) — follow
"Register with the host console" in
[`apps/console/docs/hosting-a-mini-app.md`](apps/console/docs/hosting-a-mini-app.md).

## Deployment

Apps deploy independently to Cloudflare's free tier:

```bash
cd apps/console
# pnpm setup-project already wrote ALCHEMY_STATE_TOKEN (and CLOUDFLARE_ACCOUNT_ID,
# if you gave one) to .env, and new-app copies both into each app it scaffolds —
# missing something? cp .env.example .env and see its comments
pnpm exec alchemy configure   # once: Cloudflare API token

pnpm run deploy:cloudflare    # per app: build + deploy
```

`ALCHEMY_STATE_TOKEN` is a secret you invent yourself (not fetched from anywhere) —
it guards the small state Worker Alchemy deploys to your Cloudflare account. One
token per account: if you already deployed another Alchemy project there, reuse that
token (the `setup-project` wizard asks for it and generates one only if you press
Enter; a non-interactive run without the flag leaves it as a checklist item).

Path-based routing (`<domain>/<slug>/*`) needs a real Cloudflare zone — a custom
domain, not `*.workers.dev`. Set up the zone and a proxied DNS record per
[`apps/console/docs/domain-setup.md`](apps/console/docs/domain-setup.md), then
replace the `https://your-domain.example` placeholder in each app's
`alchemy.run.ts` (and in `templates/mini-app-starter/alchemy.run.ts`, so future
apps inherit it). Once the origin is your real domain, the next deploy attaches
the routes automatically — the console claims the `<domain>/*` catch-all and each
mini app claims its more-specific `/<slug>/*`.

## Secrets & env vars

Every app follows one convention, sorted by one question — does the value differ
between local dev and prod? Same-everywhere values (secrets and non-secrets) live in
`.env`, read by the wrangler `[secrets]` gate in dev and `alchemy.(secret.)env`
bindings at deploy; environment-differing values are committed literals in
`alchemy.run.ts` for prod (e.g. `ALLOWED_PRODUCTION_ORIGIN`, which stays unset in dev
so the JWT audience check is skipped); infra creds stay in `.env` and are
never bound to the Worker. The canonical doc is
[`templates/mini-app-starter/docs/secrets.md`](templates/mini-app-starter/docs/secrets.md);
each app's `docs/secrets.md` applies it to that app.

## Why packages are scoped (and why there's duplication)

Every app descends from the same starter, so a plain copy would ship the *same*
internal package names (`@starter/shared`, `starter-client`, …). A pnpm workspace
requires globally unique names, so each app's packages are scoped to its slug:
`@<workspace>/<slug>`, `@<workspace>/<slug>-client`, and so on.

`templates/mini-app-starter` is deliberately **excluded from the workspace** — it still
carries the generic `@starter/*` names, and installing it would reintroduce the
collision. `new-app` rescopes on copy.

Apps intentionally do **not** share runtime code (each has its own `shared/` package,
hooks, and components). Two copies of a small file is the fixed cost of keeping every
app — and the template itself — standalone and independently deployable.

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — agent guide for working in this workspace
- [`docs/local-first-auth-spec.md`](docs/local-first-auth-spec.md) — the auth spec
- [`docs/mini-app-examples.md`](docs/mini-app-examples.md) — reference mini apps to learn from
- [`docs/port-troubleshooting.md`](docs/port-troubleshooting.md) — freeing stuck dev ports
- [`apps/console/README.md`](apps/console/README.md) — how the host console works
- [`templates/mini-app-starter/UPSTREAM.md`](templates/mini-app-starter/UPSTREAM.md) — where the template came from and how to diff against upstream

## Credits

The mini-app template is vendored from
[antler-browser/mini-app-starter](https://github.com/antler-browser/mini-app-starter)
(see `UPSTREAM.md`). This repo generalizes it into a multi-app workspace with a host
console.
