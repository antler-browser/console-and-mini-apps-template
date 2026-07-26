# Upstream

This folder is a vendored copy of the mini-app starter. It is **your** template —
edit it freely; `pnpm new-app <slug>` scaffolds new apps from whatever is here.

It is deliberately **excluded from the pnpm workspace** (see `pnpm-workspace.yaml`):
it still carries the generic `@starter/*` package names, and installing it would
reintroduce the name collision the monorepo exists to fix. The generator rescopes
those names to the workspace scope (root package.json name), `@<workspace>/<slug>-*`,
as it copies.

| | |
|---|---|
| Source | https://github.com/antler-browser/mini-app-starter |
| Vendored at commit | `9bc226d716aaf4bb289dfa2beeae30a5f238f710` |
| Vendored on | 2026-07-12 |

## Pulling upstream changes

Fork `antler-browser/mini-app-starter` if you want somewhere to push your own
template changes back to. To fold upstream improvements into this copy:

```bash
git clone --depth 1 https://github.com/antler-browser/mini-app-starter /tmp/starter
diff -ru templates/mini-app-starter /tmp/starter --exclude=.git --exclude=node_modules \
     --exclude=pnpm-lock.yaml --exclude=UPSTREAM.md
```

Apply what you want by hand, then bump the commit hash above.

## Local modifications (expected to differ from upstream)

This copy is adapted for life inside the workspace, so an upstream diff will always
show these; keep the local versions:

- **Placeholder tokens** — `__SLUG__` (vite `base` + proxy key, Hono `basePath`,
  alchemy routes), `__SLUG_TITLE__` (html title, manifest name), and `__APP_NAME__`
  (Cloudflare resource names) are resolved by `new-app.ts` at scaffold time, which
  fails loudly if any token survives. If you add a file that needs the slug, use a
  token rather than a hardcoded name.
- **Standalone-setup files removed** — `scripts/setup.ts`, the `setup-project`
  npm script, and `docs/project-setup.md` are gone: renaming happens at the
  workspace root, and the old per-app rename would break the `<workspace>-<slug>-…`
  naming convention.
- **Shared docs deduplicated** — `local-first-auth-spec.md`, `mini-app-examples.md`,
  and `port-troubleshooting.md` live once at the workspace root `docs/`; links here
  use `../../docs/…`, which resolves from `apps/<slug>/` after scaffolding.
- **Subpath serving pre-wired** — router `basename`, `BASE_URL`-relative fetches/WS,
  and derived alchemy `routes`, per `apps/console/docs/hosting-a-mini-app.md`.
- **Worker-first asset serving** — `run_worker_first: true` in `alchemy.run.ts` and
  `wrangler.toml`, an `ASSETS: Fetcher` binding in `server/src/types.ts`, and a default
  export in `server/src/index.ts` that proxies non-API paths to `ASSETS` with the
  `/__SLUG__` prefix stripped. Needed because assets are uploaded at dist-root keys but
  requested under the subpath. Only the `/<slug>/*` route is claimed — inbound links
  always use the trailing-slash form `/<slug>/`.
- **`blocked` column** in the users schema (migration 0002) — required by the host
  console's admin Block action.

Note: `pnpm setup-project --github-url … --allowed-production-origin …` writes your
fork's values into this copy at setup time (the footer link in
`client/src/components/Footer.tsx` and `ALLOWED_PRODUCTION_ORIGIN` in `alchemy.run.ts`),
so the diff against upstream will show those lines changed — that's expected; keep your
values. Setup is one-time, so later changes to either value are edited here by hand.

Note: existing apps under `apps/` are **not** retroactively updated — they diverge
from the template the moment they're generated, by design.
