import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Real Android compilation for the two consumer fixtures. Gradle (repo-local
// distribution) compiles each merged consumer source set with real javac
// against real Maven/SDK artifacts under .tmp/toolchain. This is compilation
// evidence only: it is not an AGP build, not a merged manifest, and not an
// on-device push-delivery test. No absolute toolchain path is ever committed;
// everything is resolved repo-relatively like scripts/native-jvm.mjs.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const toolchainDir = join(root, '.tmp', 'toolchain')
const scratchDir = join(root, '.tmp', 'android-compile')

const argv = process.argv.slice(2)
const useJavac = argv.includes('--javac')
const only = argv.find((a) => !a.startsWith('--'))

function toolchainDirPrefix(prefix) {
    if (!existsSync(toolchainDir)) return null
    for (const entry of readdirSync(toolchainDir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith(prefix)) {
            return join(toolchainDir, entry.name)
        }
    }
    return null
}

function toolchainBin(name) {
    const dirs = []
    if (process.env.JAVA_HOME) dirs.push(join(process.env.JAVA_HOME, 'bin'))
    const jdk = toolchainDirPrefix('jdk-')
    if (jdk) dirs.push(join(jdk, 'bin'))
    for (const dir of dirs) {
        const candidate = join(dir, name)
        if (existsSync(candidate) && statSync(candidate).size > 0) return candidate
    }
    return name
}

function gradleBin() {
    const dist = toolchainDirPrefix('gradle-dist')
    if (!dist) return null
    for (const entry of readdirSync(dist, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith('gradle-')) {
            const candidate = join(dist, entry.name, 'bin', 'gradle')
            if (existsSync(candidate)) return candidate
        }
    }
    return null
}

function javaSources(dir) {
    const found = []
    const walk = (current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const full = join(current, entry.name)
            if (entry.isDirectory()) walk(full)
            else if (entry.isFile() && entry.name.endsWith('.java')) found.push(full)
        }
    }
    walk(dir)
    return found.sort()
}

function run(command, args, options = {}) {
    return spawnSync(command, args, {
        encoding: 'utf8',
        cwd: options.cwd ?? root,
        env: options.env ?? process.env
    })
}

function versionLine(command, args = ['--version']) {
    // Same env as the real builds: the repo-local JDK and repo-local Gradle
    // home, so version reporting exercises the toolchain that actually runs.
    const result = run(command, args, { env })
    const text = (result.stdout ?? '') + (result.stderr ?? '')
    const wanted =
        args[0] === '--version' ? /Gradle\s+[\d.]+/ : /openjdk version "[^"]+"|javac [\d._]+/
    return wanted.exec(text)?.[0] ?? text.trim().split('\n')[0]
}

const fixtures = [
    'fixtures/android-cordova/fixture.json',
    'fixtures/android-capacitor/fixture.json'
]
    .map((file) => JSON.parse(readFileSync(join(root, file), 'utf8')))
    .filter((fixture) => !only || fixture.name === only)

const jdk = toolchainDirPrefix('jdk-')
const gradle = gradleBin()
const gradleHome = join(toolchainDir, 'gradle-home')
const env = {
    ...process.env,
    JAVA_HOME: jdk ?? process.env.JAVA_HOME ?? '',
    GRADLE_USER_HOME: gradleHome
}

console.log(`[android-compile] JDK: ${jdk ? relative(root, jdk) : 'PATH java (no repo-local JDK)'}`)
console.log(`[android-compile] java: ${versionLine(toolchainBin('java'), ['-version'])}`)
console.log(`[android-compile] javac: ${versionLine(toolchainBin('javac'))}`)
if (gradle) {
    console.log(`[android-compile] Gradle: ${versionLine(gradle, ['--version'])}`)
}

rmSync(scratchDir, { recursive: true, force: true })

function missingArtifacts(fixture) {
    return fixture.artifacts
        .filter((artifact) => artifact.kind !== 'pom')
        .filter((artifact) => !existsSync(join(root, artifact.file)))
        .map((artifact) => artifact.coordinate)
}

function classpathJars(fixture) {
    return fixture.artifacts
        .filter((a) => a.kind === 'jar' || a.kind === 'aar-classes')
        .map((a) => join(root, a.file))
        .filter(existsSync)
}

function mergedSourcesFromGradle(fixture) {
    const projectDir = join(root, fixture.gradleProject)
    const result = run(
        gradle,
        ['-q', '--console=plain', '--offline', '--no-daemon', 'mergedSources'],
        {
            cwd: projectDir,
            env
        }
    )
    if (result.status !== 0) {
        console.error(result.stdout ?? '')
        console.error(result.stderr ?? '')
        throw new Error(`gradle mergedSources failed for ${fixture.name}`)
    }
    return (result.stdout ?? '')
        .split('\n')
        .filter((line) => line.startsWith('MERGED '))
        .map((line) => line.slice('MERGED '.length).trim())
}

function compileWithGradle(fixture) {
    const projectDir = join(root, fixture.gradleProject)
    const tasks = ['mergedSources', 'compileJava']
    console.log(
        `[android-compile] ran: ${relative(root, gradle)} -q --console=plain --offline --no-daemon ${tasks.join(' ')}  (cwd ${relative(root, projectDir)}, release ${fixture.toolchain.javaRelease})`
    )
    const merged = mergedSourcesFromGradle(fixture)
    const result = run(gradle, ['-q', '--console=plain', '--offline', '--no-daemon', ...tasks], {
        cwd: projectDir,
        env
    })
    if (result.status !== 0) {
        console.error(result.stdout ?? '')
        console.error(result.stderr ?? '')
        throw new Error(`gradle compileJava failed for ${fixture.name}`)
    }
    return merged
}

function compileWithJavac(fixture) {
    // cordova-android's Java sources are a real dependency in both runtimes
    // (Capacitor's pom declares org.apache.cordova:framework), so they are
    // compiled with the same compiler and put on the fixture classpath.
    const frameworkOut = join(scratchDir, `${fixture.name}-cordova-classes`)
    const frameworkSources = javaSources(join(toolchainDir, 'package', 'framework', 'src'))
    if (frameworkSources.length > 0) {
        const framework = run(toolchainBin('javac'), [
            '--release',
            '11',
            '-nowarn',
            '-d',
            frameworkOut,
            '-cp',
            [join(toolchainDir, 'android.jar'), ...classpathJars(fixture)].join(':'),
            ...frameworkSources
        ])
        if (framework.status !== 0) {
            console.error(framework.stdout ?? '')
            console.error(framework.stderr ?? '')
            throw new Error(`cordova-android sources failed to compile for ${fixture.name}`)
        }
    }
    const excluded = fixture.exclude[0].replace('/**', '')
    const sources = javaSources(join(root, 'src', 'android', 'dev')).filter(
        (source) => !relative(root, source).includes(excluded)
    )
    const consumer = javaSources(join(root, fixture.gradleProject, 'app', 'src', 'main', 'java'))
    const classes = join(scratchDir, fixture.name, 'classes')
    const cp = [
        join(toolchainDir, 'android.jar'),
        ...(frameworkSources.length > 0 ? [frameworkOut] : []),
        ...classpathJars(fixture)
    ].join(':')
    const result = run(toolchainBin('javac'), [
        '--release',
        '11',
        '-nowarn',
        '-d',
        classes,
        '-cp',
        cp,
        ...sources,
        ...consumer
    ])
    console.log(
        `[android-compile] ran: ${relative(root, toolchainBin('javac'))} --release 11 -d ${relative(root, classes)} (${sources.length + consumer.length} sources, ${classpathJars(fixture).length} classpath jars)`
    )
    if (result.status !== 0) {
        console.error(result.stdout ?? '')
        console.error(result.stderr ?? '')
        throw new Error(`javac failed for ${fixture.name}`)
    }
    return [...sources, ...consumer].map((source) => relative(root, source))
}

function verifyClasses(fixture, merged) {
    const classesRoot = gradle
        ? join(root, fixture.gradleProject, 'build', 'classes', 'java', 'main')
        : join(scratchDir, fixture.name, 'classes')
    const missing = []
    for (const source of merged) {
        const text = readFileSync(join(root, source), 'utf8')
        const pkg = /package\s+([\w.]+);/.exec(text)?.[1] ?? ''
        const expected = join(
            classesRoot,
            pkg.replace(/\./g, '/'),
            basename(source).replace(/\.java$/, '.class')
        )
        if (!existsSync(expected)) missing.push(source)
    }
    if (missing.length > 0) {
        throw new Error(`${fixture.name}: no class file for ${missing.join(', ')}`)
    }
}

let failures = 0
for (const fixture of fixtures) {
    console.log(`\n[android-compile] === ${fixture.name} (${fixture.runtime}) ===`)
    const missing = missingArtifacts(fixture)
    if (missing.length > 0) {
        console.error(`[android-compile] MISSING artifacts for ${fixture.name}:`)
        for (const coordinate of missing) console.error(`  - ${coordinate}`)
        failures += 1
        continue
    }
    try {
        const merged = gradle && !useJavac ? compileWithGradle(fixture) : compileWithJavac(fixture)
        verifyClasses(fixture, merged)
        console.log(`[android-compile] merged source set (${merged.length} files):`)
        for (const source of merged) console.log(`  ${source}`)
        console.log(`[android-compile] artifact coordinates (${fixture.artifacts.length}):`)
        console.log('  ' + fixture.artifacts.map((artifact) => artifact.coordinate).join('\n  '))
        console.log(
            `[android-compile] ${fixture.name}: OK — compiled with ${gradle && !useJavac ? 'Gradle+javac' : 'javac'} (release 11)`
        )
    } catch (failure) {
        console.error(`[android-compile] ${fixture.name}: FAILED — ${failure.message}`)
        failures += 1
    }
}

if (failures > 0) {
    console.error(`[android-compile] FAILED — ${failures} fixture(s) did not compile`)
    process.exit(1)
}
console.log(
    '\n[android-compile] scope note: AGP/Gradle Android build, manifest merging, R resources and on-device push delivery remain pending.'
)
