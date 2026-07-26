#!/usr/bin/env tsx
/**
 * One-time project setup — run this once after forking the template, BEFORE
 * scaffolding any apps (`pnpm new-app` bakes the workspace name into everything
 * it generates).
 *
 *   pnpm setup-project [name] [--allowed-production-origin <url>] [--github-url <url>]
 *                             [--alchemy-state-token <value>] [--cloudflare-account-id <id>]
 *
 * It refuses to run on a workspace that is already set up (renamed, or with
 * mini apps scaffolded under `apps/`) — later changes are plain file edits, and
 * the refusal message says which files.
 *
 * Run from a terminal with no flags, it is a wizard asking for all five settings
 * below. Any flag you pass is used verbatim and its question is skipped. Non-TTY
 * runs (CI, Claude Code) never prompt — anything not passed as a flag falls
 * through to the closing checklist instead.
 *
 * 1. name — defaults to the repo directory name. Every occurrence of the
 *    template name (package scope `@<name>/`, Cloudflare resource names
 *    `<name>-…`, and the Title Case display strings) is rewritten across the
 *    root files and `apps/console`.
 *
 * 2. ALCHEMY_STATE_TOKEN and 3. CLOUDFLARE_ACCOUNT_ID — deploy creds, written to
 *    `apps/console/.env` (created from `.env.example`). Both are account-wide;
 *    new-app.ts copies them from the console into each app it scaffolds.
 *
 * 4. --allowed-production-origin sets the ALLOWED_PRODUCTION_ORIGIN literal and
 *    5. --github-url points the footer's open-source link at your fork — both in
 *    `apps/console` AND `templates/mini-app-starter`, so apps scaffolded later by
 *    new-app.ts inherit the fork's values instead of stale placeholders. (The
 *    deploy creds deliberately are not — the vendored starter never carries a
 *    secret.)
 *
 * The *rename* deliberately never touches `templates/`: the vendored starter
 * keeps its generic `@starter/*` names, and new-app.ts rescopes them at copy
 * time using whatever the workspace is called then.
 *
 * It also runs the host console's local D1 migrations (fully local via
 * getPlatformProxy — no Cloudflare auth; the dev database_id is just a local
 * storage key). It does NOT touch `wrangler.toml` vars (ALLOWED_PRODUCTION_ORIGIN is unset in
 * dev on purpose, so the audience check is skipped). It ends with a short
 * checklist of only the steps it could not do for you.
 */

import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { loadOrCreateEnv, setEnvValue } from './lib/env'
import { isInteractive, withPrompter, type Validation } from './lib/prompt'
import { getWorkspaceName, KEBAB_RE, REPO_ROOT, toTitleCase } from './lib/workspace'

/** Must match the `name` shipped in the template's root package.json. */
const TEMPLATE_NAME = 'console-and-mini-apps-template'

/** Same skip set as new-app.ts — never rewrite inside generated/vendored trees. */
const SKIP = new Set([
  '.git',
  'node_modules',
  'dist',
  '.wrangler',
  '.alchemy',
  'pnpm-lock.yaml',
])

/** Files we rewrite text inside of. */
const TEXT_EXT = new Set(['.ts', '.tsx', '.json', '.toml', '.md', '.html', '.css', '.yaml'])

const CONSOLE_DIR = path.join(REPO_ROOT, 'apps', 'console')
const TEMPLATE_DIR = path.join(REPO_ROOT, 'templates', 'mini-app-starter')

const USAGE =
  'Usage: pnpm setup-project [name] [--allowed-production-origin <url>] [--github-url <url>]\n' +
  '                          [--alchemy-state-token <value>] [--cloudflare-account-id <id>]'

function die(msg: string): never {
  console.error(`\n✖ ${msg}\n`)
  process.exit(1)
}

// ── args ────────────────────────────────────────────────────────────────────
let positionals: string[]
let flags: {
  'allowed-production-origin'?: string
  'github-url'?: string
  'alchemy-state-token'?: string
  'cloudflare-account-id'?: string
}
try {
  ;({ positionals, values: flags } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'allowed-production-origin': { type: 'string' },
      'github-url': { type: 'string' },
      'alchemy-state-token': { type: 'string' },
      'cloudflare-account-id': { type: 'string' },
    },
    allowPositionals: true,
  }))
} catch (e) {
  die(`${(e as Error).message}\n  ${USAGE}`)
}

/** A flag spelled but left empty is a typo, not a request to clear the value. */
function readFlag(name: keyof typeof flags, validate?: (raw: string) => Validation): string | undefined {
  const raw = flags[name]
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  if (!trimmed) die(`--${name} is empty.\n  ${USAGE}`)
  if (!validate) return trimmed
  const result = validate(trimmed)
  if ('error' in result) die(`${result.error}\n  ${USAGE}`)
  return result.ok
}

// ── validators ──────────────────────────────────────────────────────────────
// Each returns `{ ok }` or `{ error }` so both entry points can share the rules:
// a bad flag dies, a bad prompt answer prints the message and re-asks.

/** The origin is `scheme://host[:port]` — reject paths, trailing slashes, garbage. */
function validateOrigin(raw: string): Validation {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { error: `"${raw}" is not a valid URL. The origin looks like https://your.domain` }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { error: `"${raw}" must be http(s). The origin looks like https://your.domain` }
  }
  if (raw !== url.origin) {
    return {
      error: `"${raw}" is not a bare origin — drop the path/trailing slash (did you mean "${url.origin}"?)`,
    }
  }
  return { ok: raw }
}

function validateGithubUrl(raw: string): Validation {
  const normalised = raw.replace(/\.git$/, '').replace(/\/+$/, '')
  if (!/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+$/.test(normalised)) {
    return { error: `--github-url must look like https://github.com/owner/repo (got "${raw}")` }
  }
  return { ok: normalised }
}

function validateName(raw: string): Validation {
  const name = raw.toLowerCase()
  if (!KEBAB_RE.test(name)) {
    return {
      error: `Invalid name "${name}". Use lowercase kebab-case starting with a letter, e.g. "my-space".`,
    }
  }
  return { ok: name }
}

/** Applied to both flag and prompt values, after collection — warnings, never fatal. */
function warnAboutValues(answers: Answers): void {
  if (answers.stateToken && /\s/.test(answers.stateToken)) {
    console.warn(`⚠ ALCHEMY_STATE_TOKEN contains whitespace — double-check the value.`)
  }
  // Cloudflare account ids are 32 hex chars, but that is not a contract — warn only.
  if (answers.accountId && !/^[0-9a-f]{32}$/i.test(answers.accountId)) {
    console.warn(
      `⚠ "${answers.accountId}" doesn't look like a Cloudflare account id (32 hex chars) — using it anyway.`,
    )
  }
  if (answers.origin?.startsWith('http://')) {
    console.warn(`⚠ "${answers.origin}" is http — this is the *production* origin; https expected.`)
  }
  if (answers.name.length < 4 && answers.name !== TEMPLATE_NAME) {
    console.warn(
      `⚠ "${answers.name}" is very short — global find-and-replace may hit unrelated text. Double-check the diff.`,
    )
  }
}

const originFlag = readFlag('allowed-production-origin', validateOrigin)
const githubFlag = readFlag('github-url', validateGithubUrl)
const stateTokenFlag = readFlag('alchemy-state-token')
const accountIdFlag = readFlag('cloudflare-account-id')

// ── guard: setup is one-time ────────────────────────────────────────────────
const current = getWorkspaceName()
const appsDir = path.join(REPO_ROOT, 'apps')
const extraApps = fs.existsSync(appsDir)
  ? fs
      .readdirSync(appsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !SKIP.has(e.name) && e.name !== 'console')
      .map((e) => `apps/${e.name}`)
  : []

if (current !== TEMPLATE_NAME || extraApps.length > 0) {
  const why = [
    current !== TEMPLATE_NAME
      ? `the workspace is named "${current}" (the pristine template is "${TEMPLATE_NAME}")`
      : '',
    extraApps.length > 0 ? `mini apps already exist: ${extraApps.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('; ')
  die(
    `setup-project is one-time and this workspace is already set up — ${why}.\n\n` +
      `  To change things later, edit the files directly:\n` +
      `    rename:      find-and-replace "${current}" and "${toTitleCase(current)}" across the repo, then pnpm install\n` +
      `    prod origin: the ALLOWED_PRODUCTION_ORIGIN literal in each apps/*/alchemy.run.ts\n` +
      `                 and templates/mini-app-starter/alchemy.run.ts\n` +
      `    footer link: client/src/components/Footer.tsx in each app and the template\n` +
      `    deploy creds: ALCHEMY_STATE_TOKEN / CLOUDFLARE_ACCOUNT_ID in each app's .env`,
  )
}

// Matches both forms: the console's inline binding (`ALLOWED_PRODUCTION_ORIGIN: '…',`) and
// the template's hoisted const (`const ALLOWED_PRODUCTION_ORIGIN = '…'`). Groups 1-2
// rebuild the line on write.
const ORIGIN_LINE_RE = /^(\s*(?:const\s+)?ALLOWED_PRODUCTION_ORIGIN\s*[:=]\s*)(['"])([^'"\n]*)\2/m
const GITHUB_HREF_RE = /href="(https:\/\/github\.com\/[^"]*)"/

const ORIGIN_REL = 'alchemy.run.ts'
const FOOTER_REL = path.join('client', 'src', 'components', 'Footer.tsx')

// ── the wizard ──────────────────────────────────────────────────────────────
interface Answers {
  name: string
  stateToken?: string
  accountId?: string
  origin?: string
  githubUrl?: string
}

/** A fork's directory is usually what the project should be called. */
const dirName = path.basename(REPO_ROOT).toLowerCase()

/** Non-interactive: flags only, exactly as before the wizard existed. */
function nonInteractiveAnswers(): Answers {
  return {
    name: (positionals[0]?.trim() || dirName).toLowerCase(),
    stateToken: stateTokenFlag,
    accountId: accountIdFlag,
    origin: originFlag,
    githubUrl: githubFlag,
  }
}

async function runWizard(): Promise<Answers> {
  console.log(`\n🧭 Project setup — Enter accepts the value in [brackets].\n`)

  return withPrompter(async (prompter) => {
    // An explicit positional is the answer to question 1 — don't ask it again.
    const name =
      positionals.length > 0
        ? positionals[0].trim().toLowerCase()
        : await prompter.ask('Project name', {
            defaultValue: KEBAB_RE.test(dirName) ? dirName : undefined,
            validate: validateName,
          })

    let stateToken = stateTokenFlag
    if (!stateToken) {
      console.log(
        '\n🔑 ALCHEMY_STATE_TOKEN\n\n' +
          '   Alchemy stores deploy state in a small Worker on your Cloudflare account,\n' +
          '   guarded by a bearer token you invent yourself. One token per Cloudflare\n' +
          '   account: if any other Alchemy project already deployed there, you MUST\n' +
          '   reuse its token or deploys fail with "token is invalid".\n',
      )
      stateToken = await prompter.ask('State token', {
        emptyLabel: 'Enter to generate one',
      })
      if (!stateToken) {
        stateToken = crypto.randomBytes(32).toString('hex')
        console.log('   generated a new token')
      }
    }

    let accountId = accountIdFlag
    if (!accountId) {
      console.log('\n🏢 CLOUDFLARE_ACCOUNT_ID — the account to deploy to. Only needed to deploy.\n')
      accountId = await prompter.ask('Account id', {
        emptyLabel: 'Enter to skip',
      })
    }

    let origin = originFlag
    if (!origin) {
      console.log(
        '\n🌐 ALLOWED_PRODUCTION_ORIGIN — the domain your apps are served from, checked\n' +
          '   against the JWT audience in prod. Skip it until you have a real domain.\n',
      )
      origin = await prompter.ask('Production origin', {
        emptyLabel: 'Enter to skip',
        validate: validateOrigin,
      })
    }

    let githubUrl = githubFlag
    if (!githubUrl) {
      console.log('\n🔗 Footer link — where the apps’ "open source" link should point.\n')
      githubUrl = await prompter.ask('Your fork on GitHub', {
        emptyLabel: 'Enter to skip',
        validate: validateGithubUrl,
      })
    }

    return {
      name,
      stateToken,
      accountId: accountId || undefined,
      origin: origin || undefined,
      githubUrl: githubUrl || undefined,
    }
  })
}

const answers = isInteractive() ? await runWizard() : nonInteractiveAnswers()
warnAboutValues(answers)

const next = answers.name
if (!KEBAB_RE.test(next)) {
  die(
    `Invalid name "${next}". Use lowercase kebab-case starting with a letter, e.g. "my-space".\n` +
      `  ${USAGE}`,
  )
}
const renameNeeded = next !== TEMPLATE_NAME

/** Steps this run could not do for us — shown in the closing checklist. */
const pendingSteps: string[] = []

// ── deploy creds (written to the console; new-app copies them into each app) ─
function writeConsoleEnv(key: string, value: string): boolean {
  const env = loadOrCreateEnv(CONSOLE_DIR)
  if (!env) {
    console.warn(`   ⚠ apps/console has no .env or .env.example — ${key} not set`)
    return false
  }
  fs.writeFileSync(env.path, setEnvValue(env.content, key, value))
  console.log(`   ${env.created ? 'created' : 'updated'}     ${path.relative(REPO_ROOT, env.path)}  (${key})`)
  return true
}

let credsWritten = 0
if (answers.stateToken || answers.accountId) {
  console.log('\n🔑 Deploy creds\n')
  if (answers.stateToken && writeConsoleEnv('ALCHEMY_STATE_TOKEN', answers.stateToken)) credsWritten++
  if (answers.accountId && writeConsoleEnv('CLOUDFLARE_ACCOUNT_ID', answers.accountId)) credsWritten++
}
if (!answers.stateToken) {
  pendingSteps.push(
    'Set ALCHEMY_STATE_TOKEN in apps/console/.env (skipped: non-interactive run\n' +
      '   without --alchemy-state-token).\n' +
      '   If this Cloudflare account already deployed with Alchemy, reuse that token;\n' +
      '   otherwise generate one: openssl rand -hex 32',
  )
}

// ── rename ──────────────────────────────────────────────────────────────────
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP.has(e.name)) return []
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return walk(p)
    return TEXT_EXT.has(path.extname(e.name)) ? [p] : []
  })
}

if (renameNeeded) {
  const rootFiles = ['package.json', 'README.md', 'CLAUDE.md', 'pnpm-workspace.yaml', 'tsconfig.json']
    .map((f) => path.join(REPO_ROOT, f))
    .filter((f) => fs.existsSync(f))

  const files = [...rootFiles, ...walk(CONSOLE_DIR)]

  /**
   * Ordered so the most specific form wins; plain split/join, no regex escaping needed.
   * The bare kebab pass also covers `@<name>/…` scopes, `<name>-dev`, `<name>-dev-db`,
   * `alchemy('<name>')`, and pnpm --filter refs.
   */
  const REWRITES: Array<[string, string]> = [
    [TEMPLATE_NAME, next],
    [toTitleCase(TEMPLATE_NAME), toTitleCase(next)],
  ]

  console.log(`\n📛 Renaming "${TEMPLATE_NAME}" → "${next}"\n`)

  let updated = 0
  for (const file of files) {
    const before = fs.readFileSync(file, 'utf8')
    let after = before
    for (const [from, to] of REWRITES) after = after.split(from).join(to)
    const rel = path.relative(REPO_ROOT, file)
    if (after !== before) {
      fs.writeFileSync(file, after)
      console.log(`   updated     ${rel}`)
      updated++
    }
  }
  console.log(`\n   ${updated} file(s) updated, ${files.length - updated} unchanged.`)
}

// ── flag-set values ─────────────────────────────────────────────────────────
/**
 * `<relPath>` in the console — plus the vendored template, so apps scaffolded
 * later inherit the values instead of stale placeholders.
 */
function targetFiles(relPath: string): string[] {
  return [CONSOLE_DIR, TEMPLATE_DIR]
    .map((dir) => path.join(dir, relPath))
    .filter((f) => fs.existsSync(f))
}

/** Replace one anchored pattern per file. Returns how many files changed. */
function setInAppFiles(
  relPath: string,
  pattern: RegExp,
  desired: string,
  replacement: (match: RegExpMatchArray) => string,
  label: string,
): number {
  let changed = 0
  const targets = targetFiles(relPath)
  if (targets.length === 0) {
    console.warn(`   ⚠ no ${relPath} found in apps/console or templates/ — ${label} not applied`)
    return 0
  }
  for (const file of targets) {
    const rel = path.relative(REPO_ROOT, file)
    const before = fs.readFileSync(file, 'utf8')
    const m = before.match(pattern)
    if (!m) {
      console.warn(`   ⚠ no ${label} in ${rel} — skipped`)
      continue
    }
    fs.writeFileSync(file, before.replace(pattern, () => replacement(m)))
    console.log(`   updated     ${rel}  (${label} → ${desired})`)
    changed++
  }
  return changed
}

let originChanged = 0
if (answers.origin) {
  const origin = answers.origin
  console.log(`\n🌐 Setting ALLOWED_PRODUCTION_ORIGIN\n`)
  originChanged = setInAppFiles(
    ORIGIN_REL,
    ORIGIN_LINE_RE,
    origin,
    (m) => `${m[1]}${m[2]}${origin}${m[2]}`,
    'ALLOWED_PRODUCTION_ORIGIN',
  )
}

let footerChanged = 0
if (answers.githubUrl) {
  const githubUrl = answers.githubUrl
  console.log(`\n🔗 Setting footer GitHub link\n`)
  footerChanged = setInAppFiles(
    FOOTER_REL,
    GITHUB_HREF_RE,
    githubUrl,
    () => `href="${githubUrl}"`,
    'GitHub link',
  )
}

// ── install (only a rename changes package names / the lockfile) ────────────
if (renameNeeded) {
  console.log('\n   Running pnpm install to update the lockfile…\n')
  try {
    execFileSync('pnpm', ['install'], { cwd: REPO_ROOT, stdio: 'inherit' })
  } catch {
    console.warn("\n⚠ `pnpm install` failed — run it yourself before continuing.\n")
  }
}

// ── console D1 migrations (fully local — no Cloudflare auth needed) ─────────
function migrateConsoleDb(): boolean {
  console.log('\n🗄  Migrating the host console’s local D1…\n')
  try {
    execFileSync('pnpm', ['run', 'db:run-migrations'], { cwd: CONSOLE_DIR, stdio: 'inherit' })
    return true
  } catch {
    console.warn('\n⚠ Console migrations failed — see the checklist below.\n')
    return false
  }
}

const migrated = migrateConsoleDb()

// ── report ──────────────────────────────────────────────────────────────────
/** Done-lines first, then a checklist of only the steps this run couldn't do. */
function report(done: string[]): void {
  const steps = [...pendingSteps]

  if (!migrated) {
    steps.push(`Migrate the console's local D1:\n   cd apps/console && pnpm run db:run-migrations`)
  }
  if (!answers.accountId) {
    steps.push('Before deploying: set CLOUDFLARE_ACCOUNT_ID in apps/console/.env')
  }
  if (!answers.origin) {
    steps.push(
      'Once you have a domain, set the production origin: edit the\n' +
        '   ALLOWED_PRODUCTION_ORIGIN literal in each app’s alchemy.run.ts and in\n' +
        '   templates/mini-app-starter/alchemy.run.ts (so future apps inherit it).\n' +
        '   The next pnpm deploy:cloudflare then attaches Cloudflare routes\n' +
        '   automatically — the console’s <domain>/* and each app’s /<slug>/*',
    )
  }
  if (!answers.githubUrl) {
    steps.push(
      'Point the footer links at your fork: edit client/src/components/Footer.tsx\n' +
        '   in each app and in templates/mini-app-starter.',
    )
  }
  steps.push('On GitHub: Settings → uncheck "Template repository" on your copy.')
  steps.push(
    `Try it: cd apps/console && pnpm dev\n` +
      `   (sign in without a phone: pnpm dev:simulator)`,
  )
  steps.push(
    'Scaffold your first mini app: pnpm new-app <slug>\n' +
      '   (always run setup-project BEFORE new-app — apps bake in the workspace name)',
  )

  console.log(`\n${[...done, '✅ Project setup complete'].join('\n')}\n`)
  console.log(`Next steps:\n${steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}\n`)
  console.log('Deploying? See "Deployment" in README.md.\n')
}

const done: string[] = []
if (renameNeeded) done.push(`✅ Project renamed to "${next}"`)
if (credsWritten > 0) done.push(`✅ Deploy creds written to apps/console/.env`)
if (answers.origin && originChanged > 0) {
  done.push(`✅ ALLOWED_PRODUCTION_ORIGIN set to "${answers.origin}" in ${originChanged} file(s)`)
}
if (answers.githubUrl && footerChanged > 0) {
  done.push(`✅ Footer GitHub link set to ${answers.githubUrl} in ${footerChanged} file(s)`)
}
if (migrated) done.push('✅ Host console local D1 migrated')

report(done)
