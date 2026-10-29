import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ngcBin = join(
    root,
    'node_modules',
    '@angular',
    'compiler-cli',
    'bundles',
    'src',
    'bin',
    'ngc.js'
)
const project = join(root, 'tests', 'aot', 'fixture', 'tsconfig.ngc.json')
const outDir = join(root, '.tmp', 'aot', 'out')

/**
 * Runs the real Angular AOT compiler (ngc) over tests/aot/fixture — a standalone
 * component that injects `FCM` and wires it with `provideFCM()`. tsc alone cannot
 * prove this: only ngc links the component, typechecks the template under
 * strictTemplates and resolves the provider's injection token. The subpath is
 * mapped to `dist/types`, so what it typechecks is the declaration surface a
 * published consumer actually gets (build first).
 */
const main = () => {
    if (!existsSync(ngcBin)) {
        throw new Error(
            `@angular/compiler-cli is not installed locally (expected ${ngcBin}). Run "npm ci" first.`
        )
    }
    const fixtureTypes = join(root, 'dist', 'types', 'ionic', 'ngx', 'index.d.ts')
    if (!existsSync(fixtureTypes)) {
        throw new Error(
            `[ngc-fixture] ${fixtureTypes.replace(`${root}/`, '')} is missing — run "npm run build" before the AOT fixture.`
        )
    }
    rmSync(outDir, { recursive: true, force: true })
    execFileSync(process.execPath, [ngcBin, '-p', project], { cwd: root, stdio: 'inherit' })

    // ngc exits 0 with diagnostics printed in some failure modes, so the emit is
    // checked as well: the fixture's linked component must actually exist.
    const emitted = join(outDir, 'consumer.component.js')
    if (!existsSync(emitted) || statSync(emitted).size === 0) {
        throw new Error(`[ngc-fixture] ngc produced no emit at ${emitted}`)
    }
    // A component that compiles but never links is not an AOT build. The linker's
    // ɵɵdefineComponent call plus the factory it generates are what a real Angular
    // app relies on at runtime, so their absence means compilation silently no-op'd.
    const code = readFileSync(emitted, 'utf8')
    for (const marker of ['ɵɵdefineComponent', 'ɵfac']) {
        if (!code.includes(marker)) {
            throw new Error(
                `[ngc-fixture] compiled output has no ${marker} — AOT linking did not run`
            )
        }
    }
    console.log(`[ngc-fixture] ok — compiled fixture into ${outDir.replace(`${root}/`, '')}`)
}

main()
