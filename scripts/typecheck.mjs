import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tscBin = join(root, 'node_modules', 'typescript', 'bin', 'tsc')

// Sources are typechecked by tsconfig.json (with declarations); tests import the
// TypeScript sources directly through tsconfig.tests.json.
for (const project of ['tsconfig.json', 'tsconfig.tests.json']) {
    console.log(`[typecheck] ${project}`)
    execFileSync(process.execPath, [tscBin, '-p', join(root, project), '--noEmit'], {
        stdio: 'inherit',
        cwd: root
    })
}
