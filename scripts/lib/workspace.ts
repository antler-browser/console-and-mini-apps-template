/**
 * Shared helpers for the root scaffolding scripts (new-app.ts, setup-project.ts).
 *
 * The workspace name in the root package.json is the single source of truth for
 * naming: package scopes are `@<name>/…`, Cloudflare resources are `<name>-…`, and
 * display strings are its Title Case. Scripts derive from it instead of hardcoding,
 * so new-app keeps working whatever the project was named at setup time.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Kebab-case rule for workspace names and app slugs (same as the upstream starter). */
export const KEBAB_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

export function getWorkspaceName(): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
    name: string
  }
  return pkg.name
}

/** "my-cool-space" → "My Cool Space" — the display-name convention for the workspace. */
export function toTitleCase(kebab: string): string {
  const words = kebab.split('-').filter(Boolean)
  if (words.length === 0) return kebab
  return words.map((word) => word[0].toUpperCase() + word.slice(1)).join(' ')
}
