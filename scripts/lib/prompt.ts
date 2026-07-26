import readline from 'node:readline/promises'

/**
 * Terminal prompt helpers for setup-project.ts's setup wizard.
 *
 * One readline interface is opened for the whole wizard and closed once, so
 * Ctrl-C handling and cleanup live in a single place. Every prompt carries a
 * default (usually the value already on disk), which is what makes re-running
 * the wizard cheap: pressing Enter through it changes nothing.
 */

/** True only when both ends are a real terminal — CI and Claude runs are not. */
export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

/** `ok` keeps the (possibly normalised) value; `error` is shown and the question re-asked. */
export type Validation = { ok: string } | { error: string }

export interface AskOptions {
  /** Shown in the prompt and returned when the user just presses Enter. */
  defaultValue?: string
  /** How the default is displayed — for secrets, pass a masked form. */
  defaultLabel?: string
  /** What to show instead of a default when there is none (e.g. 'skip'). */
  emptyLabel?: string
  /** Re-asks while it returns `{ error }`. Not run on an empty answer with no default. */
  validate?: (raw: string) => Validation
}

export interface Prompter {
  /** Returns the validated answer, the default on Enter, or '' when neither exists. */
  ask(question: string, options?: AskOptions): Promise<string>
}

/**
 * Run `fn` with a live prompter. Ctrl-C exits with 130 (the shell convention for
 * SIGINT) rather than unwinding half-way through a wizard, and the interface is
 * always closed — otherwise the process hangs on an open stdin listener.
 */
export async function withPrompter<T>(fn: (prompter: Prompter) => Promise<T>): Promise<T> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.on('SIGINT', () => {
    rl.close()
    console.log('')
    process.exit(130)
  })

  const prompter: Prompter = {
    async ask(question, options = {}) {
      const { defaultValue, defaultLabel, emptyLabel, validate } = options
      const hint = defaultValue ? (defaultLabel ?? defaultValue) : emptyLabel
      const suffix = hint ? ` [${hint}]` : ''
      // Loop rather than die() — a typo in a wizard should cost one line, not the run.
      for (;;) {
        let raw: string
        try {
          raw = (await rl.question(`   ${question}${suffix}: `)).trim()
        } catch (e) {
          // Ctrl-D rejects the question. Treat it like Ctrl-C: leave, don't stack-trace.
          if ((e as { code?: string }).code !== 'ABORT_ERR') throw e
          rl.close()
          console.log('\n   aborted — nothing was changed.')
          process.exit(130)
        }
        if (!raw) return defaultValue ?? ''
        if (!validate) return raw
        const result = validate(raw)
        if ('ok' in result) return result.ok
        console.log(`   ✖ ${result.error}`)
      }
    },
  }

  try {
    return await fn(prompter)
  } finally {
    rl.close()
  }
}

/** `7f3a…9c21` — enough to recognise a token without printing it back in full. */
export function maskSecret(value: string): string {
  if (value.length <= 12) return '•'.repeat(value.length)
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}
