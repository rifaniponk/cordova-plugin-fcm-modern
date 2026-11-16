import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// JVM behavior harness for the shared Android native core. It compiles the
// dev-core sources against tests/android/stubs and runs the behavior test on
// the host JVM. This is not a Gradle build and not an on-device test.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, '.tmp', 'native-jvm', 'classes')

// Resolve javac/java from PATH, JAVA_HOME, or the repo-local .tmp/toolchain
// JDK. No absolute toolchain paths are ever committed.
function toolchainBin(name) {
    const dirs = []
    if (process.env.JAVA_HOME) dirs.push(join(process.env.JAVA_HOME, 'bin'))
    for (const entry of readdirSync(join(root, '.tmp', 'toolchain'), { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith('jdk-')) {
            dirs.push(join(root, '.tmp', 'toolchain', entry.name, 'bin'))
        }
    }
    try {
        for (const entry of readdirSync(join(root, '.tmp', 'toolchain'), { withFileTypes: true })) {
            if (entry.isDirectory() && entry.name.startsWith('jdk-')) {
                dirs.push(join(root, '.tmp', 'toolchain', entry.name, 'bin'))
            }
        }
    } catch {
        /* no local toolchain installed */
    }
    for (const dir of dirs) {
        try {
            if (readFileSync(join(dir, name)).length > 0) return join(dir, name)
        } catch {
            /* candidate missing */
        }
    }
    return name
}

function javaSources(dir) {
    const found = []
    const walk = (current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const full = join(current, entry.name)
            if (entry.isDirectory()) {
                walk(full)
            } else if (entry.isFile() && entry.name.endsWith('.java')) {
                found.push(full)
            }
        }
    }
    walk(dir)
    return found.sort()
}

const sources = [
    ...javaSources(join(root, 'tests', 'android', 'stubs')),
    ...javaSources(join(root, 'src', 'android', 'dev')),
    ...javaSources(join(root, 'tests', 'android', 'dev'))
]

rmSync(join(root, '.tmp', 'native-jvm'), { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

// release 11 matches the SDK floor the plugin's Gradle config targets.
const compile = spawnSync(toolchainBin('javac'), ['--release', '11', '-d', outDir, ...sources], {
    encoding: 'utf8'
})
if (compile.status !== 0) {
    console.error(compile.stdout ?? '')
    console.error(compile.stderr ?? '')
    console.error('[native-jvm] FAILED — javac errors')
    process.exit(1)
}

const testClasses = javaSources(join(root, 'tests', 'android', 'dev')).map((source) => {
    const pkg = /package\s+([\w.]+);/.exec(readFileSync(source, 'utf8'))?.[1] ?? ''
    const name = basename(source).replace(/\.java$/, '')
    return pkg ? `${pkg}.${name}` : name
})

for (const testClass of testClasses.sort()) {
    const run = spawnSync(toolchainBin('java'), ['-cp', outDir, testClass], { encoding: 'utf8' })
    if (run.status !== 0) {
        console.error(run.stdout ?? '')
        console.error(run.stderr ?? '')
        console.error(`[native-jvm] FAILED — ${testClass} exited non-zero`)
        process.exit(1)
    }
    console.error(run.stdout ?? '')
}

// Keep the harness honest: every shipped dev-core source must be compiled.
for (const source of javaSources(join(root, 'src', 'android', 'dev'))) {
    const pkg = /package\s+([\w.]+);/.exec(readFileSync(source, 'utf8'))?.[1] ?? ''
    const classFile = join(
        outDir,
        pkg.replace(/\./g, '/'),
        basename(source).replace(/\.java$/, '.class')
    )
    try {
        if (readFileSync(classFile).length === 0) {
            throw new Error('empty class file')
        }
    } catch {
        console.error(`[native-jvm] FAILED — no class emitted for ${relative(root, source)}`)
        process.exit(1)
    }
}
console.log(
    `[native-jvm] ok — compiled ${sources.length} sources (${relative(root, join(root, 'src', 'android', 'dev'))} included)`
)
