import fs from 'node:fs'
import path from 'node:path'

/**
 * Line-based .env helpers shared by setup-project.ts and new-app.ts.
 * Keys are our own constants ([A-Z_]+), so no regex escaping is needed.
 * The `^[ \t]*KEY` anchor (no `#` allowed) means commented lines like
 * `# ALCHEMY_PASSWORD=` are never matched or clobbered.
 */

function keyLineRe(key: string): RegExp {
  return new RegExp(`^[ \\t]*${key}[ \\t]*=(.*)$`, 'm')
}

/** First uncommented `KEY=` line's value, trimmed; undefined if the line is absent. */
export function getEnvValue(content: string, key: string): string | undefined {
  const m = content.match(keyLineRe(key))
  return m ? m[1].trim() : undefined
}

/**
 * Replace the first uncommented `KEY=` line in place (preserving all other lines
 * and comments), or append `KEY=value` if no such line exists. Uses a replacer
 * function so values containing `$` are written verbatim.
 */
export function setEnvValue(content: string, key: string, value: string): string {
  const re = keyLineRe(key)
  if (re.test(content)) return content.replace(re, () => `${key}=${value}`)
  const base = content.length === 0 || content.endsWith('\n') ? content : `${content}\n`
  return `${base}${key}=${value}\n`
}

/**
 * `<dir>/.env` content, sourced from `.env.example` when `.env` is missing.
 * Returns undefined if neither file exists. Never writes — callers write once.
 */
export function loadOrCreateEnv(
  dir: string,
): { path: string; content: string; created: boolean } | undefined {
  const envPath = path.join(dir, '.env')
  if (fs.existsSync(envPath)) {
    return { path: envPath, content: fs.readFileSync(envPath, 'utf8'), created: false }
  }
  const examplePath = path.join(dir, '.env.example')
  if (fs.existsSync(examplePath)) {
    return { path: envPath, content: fs.readFileSync(examplePath, 'utf8'), created: true }
  }
  return undefined
}
