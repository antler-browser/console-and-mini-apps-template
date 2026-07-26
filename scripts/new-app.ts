#!/usr/bin/env tsx
/**
 * Scaffold a new mini app into the monorepo.
 *
 *   pnpm new-app <slug>
 *
 * Copies `templates/mini-app-starter` to `apps/<slug>` and does the mechanical
 * monorepo wiring the template can't do for itself:
 *
 *   - rescopes the four package names to `@<workspace>/<slug>[-client|-server|-shared]`
 *     (a plain copy would collide with every other app, since they all descend
 *     from the same starter and share its generic `@starter/*` names; the
 *     workspace scope comes from the root package.json name)
 *   - rewrites `@starter/shared` imports/deps to the app-scoped shared package
 *   - resolves the template's placeholder tokens: `__SLUG__` (vite base + proxy,
 *     Hono basePath, alchemy routes), `__SLUG_TITLE__` (html title, manifest),
 *     `__APP_NAME__` (Cloudflare resource names, `<workspace>-<slug>-mini-app`)
 *     — then fails loudly if any token survived the pass
 *   - claims a free worker + vite port pair so apps can run side by side
 *   - wires the app into the root tsconfig references
 *   - installs and runs the app's local D1 migrations
 *
 * The scaffolded app is fully wired for `/<slug>/` subpath serving. The one thing
 * that stays manual is registering the app with the host console after its first
 * deploy (needs the real prod D1 UUID) — the closing checklist points at
 * apps/console/docs/hosting-a-mini-app.md for that.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { getEnvValue, setEnvValue } from './lib/env'
import { getWorkspaceName, KEBAB_RE, REPO_ROOT, toTitleCase } from './lib/workspace'
const TEMPLATE_DIR = path.join(REPO_ROOT, 'templates', 'mini-app-starter')
const APPS_DIR = path.join(REPO_ROOT, 'apps')

/** Never copied out of the template — the monorepo root owns these. */
const SKIP = new Set([
  '.git',
  'node_modules',
  'dist',
  '.wrangler',
  '.alchemy',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'UPSTREAM.md',
  'LICENSE',
  'tsconfig.tsbuildinfo',
])

/** Files we rewrite text inside of. */
const TEXT_EXT = new Set(['.ts', '.tsx', '.json', '.toml', '.md', '.html', '.css'])

function die(msg: string): never {
  console.error(`\n✖ ${msg}\n`)
  process.exit(1)
}

// ── args ────────────────────────────────────────────────────────────────────
const slug = process.argv[2]?.trim()

if (!slug) {
  die('Usage: pnpm new-app <slug>\n  e.g. pnpm new-app check-in')
}
if (!KEBAB_RE.test(slug)) {
  die(`Invalid slug "${slug}". Use lowercase kebab-case, e.g. "check-in".`)
}
const destDir = path.join(APPS_DIR, slug)
if (fs.existsSync(destDir)) {
  die(`apps/${slug} already exists.`)
}
if (!fs.existsSync(TEMPLATE_DIR)) {
  die(`Template not found at templates/mini-app-starter.`)
}

// ── derived names (workspace scope comes from the root package.json name) ──
const workspace = getWorkspaceName()
const pkgScope = `@${workspace}/${slug}` //        e.g. @my-space/check-in
const sharedPkg = `${pkgScope}-shared`
const clientPkg = `${pkgScope}-client`
const serverPkg = `${pkgScope}-server`
const cfName = `${workspace}-${slug}-mini-app`

// ── claim a free port pair ──────────────────────────────────────────────────
function usedPorts(): { worker: number[]; vite: number[] } {
  const worker: number[] = []
  const vite: number[] = []
  if (!fs.existsSync(APPS_DIR)) return { worker, vite }

  for (const app of fs.readdirSync(APPS_DIR)) {
    const wrangler = path.join(APPS_DIR, app, 'wrangler.toml')
    if (fs.existsSync(wrangler)) {
      const m = fs.readFileSync(wrangler, 'utf8').match(/^port\s*=\s*(\d+)/m)
      if (m) worker.push(Number(m[1]))
    }
    const viteCfg = path.join(APPS_DIR, app, 'client', 'vite.config.ts')
    if (fs.existsSync(viteCfg)) {
      const m = fs.readFileSync(viteCfg, 'utf8').match(/port:\s*(\d+)/)
      if (m) vite.push(Number(m[1]))
    }
  }
  return { worker, vite }
}

const used = usedPorts()
const workerPort = Math.max(8786, ...used.worker) + 1
const vitePort = Math.max(5172, ...used.vite) + 1

// ── copy template ───────────────────────────────────────────────────────────
function copyTree(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) copyTree(from, to)
    else fs.copyFileSync(from, to)
  }
}

console.log(`\n📦 Scaffolding apps/${slug} from templates/mini-app-starter\n`)
copyTree(TEMPLATE_DIR, destDir)

// ── rewrite file contents ───────────────────────────────────────────────────
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return SKIP.has(e.name) ? [] : walk(p)
    return TEXT_EXT.has(path.extname(e.name)) ? [p] : []
  })
}

/** Ordered so the generic `@starter/shared` swap can't clobber a name field. */
const REWRITES: Array<[RegExp, string]> = [
  // workspace package identity
  [/@starter\/shared/g, sharedPkg],
  [/"name":\s*"mini-app-starter"/g, `"name": "${pkgScope}"`],
  [/"name":\s*"starter-client"/g, `"name": "${clientPkg}"`],
  [/"name":\s*"starter-server"/g, `"name": "${serverPkg}"`],
  // path filters are CWD-relative and fragile in a monorepo — use real names
  [/--filter=\.\/client/g, `--filter=${clientPkg}`],
  [/--filter=\.\/server/g, `--filter=${serverPkg}`],
  // template placeholder tokens (longest first, so __SLUG__ can't half-eat
  // __SLUG_TITLE__)
  [/__SLUG_TITLE__/g, toTitleCase(slug)],
  [/__APP_NAME__/g, cfName],
  [/__SLUG__/g, slug],
]

for (const file of walk(destDir)) {
  const before = fs.readFileSync(file, 'utf8')
  let after = before
  for (const [pattern, replacement] of REWRITES) after = after.replace(pattern, replacement)
  if (after !== before) fs.writeFileSync(file, after)
}

// Fail loudly if the template grew a token in a spot the pass missed (e.g. a new
// file extension outside TEXT_EXT) — a silent leftover would ship a broken app.
const leftovers = walk(destDir).filter((f) =>
  /__SLUG__|__SLUG_TITLE__|__APP_NAME__/.test(fs.readFileSync(f, 'utf8')),
)
if (leftovers.length > 0) {
  die(
    `Unreplaced template tokens in:\n  ${leftovers
      .map((f) => path.relative(REPO_ROOT, f))
      .join('\n  ')}`,
  )
}

// ── deploy creds (shared across the whole Cloudflare account) ───────────────
/**
 * Seed apps/<slug>/.env from the console's deploy creds. ALCHEMY_STATE_TOKEN
 * must be identical for every Alchemy deployment on one Cloudflare account, so
 * copying it (plus the account id and stage) keeps all apps in sync. Returns
 * true when a non-empty token was carried over.
 */
const CRED_KEYS = ['CLOUDFLARE_ACCOUNT_ID', 'ALCHEMY_STATE_TOKEN', 'ALCHEMY_STAGE']
function copyDeployCreds(): boolean {
  const consoleEnvPath = path.join(APPS_DIR, 'console', '.env')
  if (!fs.existsSync(consoleEnvPath)) return false

  const consoleEnv = fs.readFileSync(consoleEnvPath, 'utf8')
  const examplePath = path.join(destDir, '.env.example')
  let content = fs.existsSync(examplePath) ? fs.readFileSync(examplePath, 'utf8') : ''
  const copied: string[] = []
  for (const key of CRED_KEYS) {
    const value = getEnvValue(consoleEnv, key)
    if (!value) continue
    content = setEnvValue(content, key, value)
    copied.push(key)
  }
  if (copied.length === 0) return false
  fs.writeFileSync(path.join(destDir, '.env'), content)
  console.log(`   created apps/${slug}/.env (${copied.join(', ')} copied from apps/console/.env)`)
  return copied.includes('ALCHEMY_STATE_TOKEN')
}
const credsCopied = copyDeployCreds()

// ── ports ───────────────────────────────────────────────────────────────────
const wranglerPath = path.join(destDir, 'wrangler.toml')
fs.writeFileSync(
  wranglerPath,
  fs.readFileSync(wranglerPath, 'utf8').replace(/^port\s*=\s*\d+/m, `port = ${workerPort}`),
)

const vitePath = path.join(destDir, 'client', 'vite.config.ts')
fs.writeFileSync(
  vitePath,
  fs
    .readFileSync(vitePath, 'utf8')
    .replace(/port:\s*\d+/, `port: ${vitePort}`)
    .replace(/target:\s*'http:\/\/localhost:\d+'/g, `target: 'http://localhost:${workerPort}'`),
)

// ── root wiring (tsconfig reference) ───────────────────────────────────────
const rootTsconfigPath = path.join(REPO_ROOT, 'tsconfig.json')
const rootTsconfig = JSON.parse(fs.readFileSync(rootTsconfigPath, 'utf8')) as {
  references?: Array<{ path: string }>
}
const refPath = `./apps/${slug}`
if (!rootTsconfig.references?.some((r) => r.path === refPath)) {
  rootTsconfig.references = [...(rootTsconfig.references ?? []), { path: refPath }]
  fs.writeFileSync(rootTsconfigPath, JSON.stringify(rootTsconfig, null, 2) + '\n')
}

// ── install + local migrations ──────────────────────────────────────────────
console.log('   Installing workspace dependencies…\n')
let installed = true
try {
  execFileSync('pnpm', ['install'], { cwd: REPO_ROOT, stdio: 'inherit' })
} catch {
  installed = false
  console.warn('\n⚠ `pnpm install` failed — run it yourself once you\'ve looked at the app.\n')
}

// The app's D1 is local-only in dev (database_id = "local"), so migrations need
// no Cloudflare auth — run them now so `pnpm dev` works immediately.
let migrated = false
if (installed) {
  console.log('   Running local D1 migrations…\n')
  try {
    execFileSync('pnpm', ['run', 'db:run-migrations'], { cwd: destDir, stdio: 'inherit' })
    migrated = true
  } catch {
    console.warn('\n⚠ Local migrations failed — see the checklist below.\n')
  }
}

// ── report ──────────────────────────────────────────────────────────────────
console.log(`
✅ apps/${slug} created
   packages  ${pkgScope}{,-client,-server,-shared}
   ports     worker :${workerPort} · vite :${vitePort}  →  http://localhost:${vitePort}/${slug}/
   serving   /${slug}/ base + /${slug}/api/* (already wired)
   db        ${migrated ? 'local D1 migrated ✔' : `⚠ run: cd apps/${slug} && pnpm run db:run-migrations`}

Next steps:
  1. Run it: cd apps/${slug} && pnpm dev   (simulator sign-in: pnpm dev:simulator)
  2. Build your features — see apps/${slug}/CLAUDE.md.
  3. Deploy: ${
    credsCopied
      ? `from apps/${slug}: pnpm run deploy:cloudflare
     (deploy creds already copied from apps/console/.env into apps/${slug}/.env)`
      : `cp apps/${slug}/.env.example apps/${slug}/.env, fill in CLOUDFLARE_ACCOUNT_ID
     and ALCHEMY_STATE_TOKEN — use the SAME token as apps/console (Alchemy allows one
     token per Cloudflare account).
     Then from apps/${slug}: pnpm run deploy:cloudflare`
  }
     (routes attach automatically once ALLOWED_PRODUCTION_ORIGIN is your real domain —
      edit the literal in each app's alchemy.run.ts and the template's)
  4. After the first deploy, register the app with the host console — follow
     "Register with the host console" in apps/console/docs/hosting-a-mini-app.md
     (grid card, MANAGED_APPS + ChildBindingKey, DB_${slug.replace(/-/g, '_').toUpperCase()} dev binding, redeploy host).
`)