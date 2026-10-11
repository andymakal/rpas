/**
 * Daily Direction test runner.
 *
 * Runs the Daily Direction node:test suite written in TypeScript, loaded through
 * jiti (already present transitively) so the REAL engine and GoRules ZEN rule
 * are exercised with the '@/' path alias resolved. No new test-framework
 * dependency is added. Invoked by `npm run test:dd`.
 *
 * node:test auto-runs tests registered via top-level test() calls, so importing
 * the compiled test module is enough; the process exit code reflects failures.
 */

import { createJiti } from 'jiti'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..')

const jiti = createJiti(projectRoot, {
  alias: { '@': resolve(projectRoot, 'src') },
})

const testFile = resolve(projectRoot, 'src/lib/daily-direction/daily-direction.test.ts')
await jiti.import(testFile)
