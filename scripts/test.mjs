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
        process.exit(result.status ?? 1)
    }
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
// so there is no separate test build that could drift from the sources.
run(`unit (${suites.length} suites)`, [
    '--disable-warning=ExperimentalWarning',
    '--test',
    ...suites
])

console.log('[test] ok')
