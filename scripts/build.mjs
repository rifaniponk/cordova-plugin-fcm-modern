import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tscBin = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const srcDir = join(root, 'src')
const strict = process.argv.includes('--strict')

const runTsc = () => {
    if (!existsSync(tscBin)) {
        throw new Error(
            `TypeScript is not installed locally (expected ${tscBin}). Run "npm ci" first.`
        )
    }
    // Typecheck + ESM output + declaration files.
    execFileSync(process.execPath, [tscBin, '-p', join(root, 'tsconfig.json')], {
        stdio: 'inherit',
        cwd: root
    })
}

const main = async () => {
    for (const entry of ['esm', 'cjs', 'types', 'cordova']) {
        rmSync(join(root, 'dist', entry), { recursive: true, force: true })
    }

    runTsc()

    // CommonJS twin of the ESM output (bundle: false keeps the module graph, so
    // `require()` consumers get the same subpath layout as the ESM side).
    await build({
        entryPoints: [`${srcDir}/**/*.ts`],
        outbase: srcDir,
        outdir: join(root, 'dist', 'cjs'),
        outExtension: { '.js': '.js' },
        bundle: false,
        format: 'cjs',
        platform: 'neutral',
        target: ['es2020'],
        legalComments: 'none',
        sourcemap: false,
        logLevel: 'warning'
    })
    // The package root declares "type": "module", so CJS output needs a marker.
    writeFileSync(join(root, 'dist', 'cjs', 'package.json'), '{ "type": "commonjs" }\n')

    // Single-file CommonJS bundle for the Cordova js-module: Cordova wraps every
    // js-module in its own wrapper and cannot resolve relative requires between
    // plugin modules, so this entry must be dependency-free after bundling.
    const cordovaEntry = join(srcDir, 'cordova', 'index.ts')
    const bundlePath = join(root, 'dist', 'cordova', 'fcm-cordova.bundle.cjs')
    if (!existsSync(cordovaEntry)) {
        const message = `Missing Cordova entry ${cordovaEntry}`
        if (strict) throw new Error(message)
        console.warn(`[build] WARNING: ${message} — skipping the Cordova bundle`)
        return
    }
    await build({
        entryPoints: [cordovaEntry],
        outfile: bundlePath,
        bundle: true,
        format: 'cjs',
        platform: 'browser',
        target: ['es2020'],
        legalComments: 'none',
        sourcemap: false,
        logLevel: 'warning'
    })

    // Legacy Cordova contract: `<clobbers target="FCM" />` binds window.FCM to
    // module.exports, and in 7.x that value was the FCM instance itself.
    const bundle = readFileSync(bundlePath, 'utf8')
    if (!/module\.exports\s*=/.test(bundle)) {
        throw new Error('Cordova bundle does not look like a CommonJS module')
    }
    writeFileSync(
        bundlePath,
        `${bundle}\n// Legacy compat: window.FCM must be the FCM instance itself.\nmodule.exports = module.exports.default\n`
    )

    console.log(
        `[build] ok — dist=${statSync(join(root, 'dist')).isDirectory() ? 'present' : 'missing'}`
    )
}

await main()
