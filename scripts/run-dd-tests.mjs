/**
 * Right Path unit-test runner (node:test + jiti).
 *
 * Runs the TypeScript unit suites under src/lib loaded through jiti (already
 * present transitively) so the REAL modules and the GoRules ZEN rule are
 * exercised with the '@/' path alias resolved. No new test-framework dependency
 * is added. Invoked by `npm run test:dd`.
 *
 * node:test auto-runs tests registered via top-level test() calls, so importing
 * each compiled test module is enough; the process exit code reflects failures.
 */

import { createJiti } from 'jiti'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readdirSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..')

const jiti = createJiti(projectRoot, {
  alias: { '@': resolve(projectRoot, 'src') },
})

/** Recursively collect *.test.ts files under a directory. */
function findTests(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) out.push(...findTests(full))
    else if (entry.name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

const testFiles = findTests(resolve(projectRoot, 'src/lib')).sort()
for (const file of testFiles) {
  await jiti.import(file)
}
