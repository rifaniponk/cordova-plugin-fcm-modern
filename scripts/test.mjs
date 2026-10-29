import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const testsDir = join(root, 'tests')

const run = (label, args) => {
    console.log(`[test] ${label}`)
    const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' })
    if (result.status !== 0) {
        console.error(`[test] FAILED: ${label}`)
        return false
    }
    return true
}

const suites = readdirSync(testsDir)
    .filter((name) => name.endsWith('.test.ts'))
    .sort()
    .map((name) => join(testsDir, name))

if (suites.length === 0) {
    console.error('[test] no test suites found in tests/')
    process.exit(1)
}

// Unit tests run TypeScript sources directly: Node >= 22.18 strips types natively,
// so there is no separate test build that could drift from the sources. The hook
// teaches that loader the `.js` → `.ts` remap the emit step performs.
//
// One process per suite: `--test` with several files reports only the file-level
// failure, which hides the failing subtest name and assertion. Running a suite on
// its own makes node:test print every subtest and the full diff of each failure.
const failed = []
for (const suite of suites) {
    const ok = run(`unit ${suite.replace(`${root}/`, '')}`, [
        '--disable-warning=ExperimentalWarning',
        '--import',
        './scripts/ts-js-hook.mjs',
        suite
    ])
    if (!ok) {
        failed.push(suite)
    }
}

if (failed.length > 0) {
    console.error(`[test] ${failed.length}/${suites.length} suites failed:`)
    for (const suite of failed) {
        console.error(`  - ${suite.replace(`${root}/`, '')}`)
    }
    process.exit(1)
}

console.log(`[test] ok — ${suites.length} suites`)
