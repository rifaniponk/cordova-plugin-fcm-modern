import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * Consumer-facing proof for the *built* package, not the sources: `require()`
 * works from the CJS twin, `import` works from the ESM twin, the single-file
 * Cordova bundle is a CommonJS module whose export is the FCM instance, and all
 * of them agree on one shared instance. Nothing here is mocked.
 */
const require_ = createRequire(import.meta.url)
const cjsRoot = new URL('../dist/cjs/index.js', import.meta.url)
const cjsCordova = new URL('../dist/cjs/cordova/index.js', import.meta.url)
const cjsCore = new URL('../dist/cjs/core/index.js', import.meta.url)
const cjsCapacitor = new URL('../dist/cjs/capacitor/index.js', import.meta.url)
const esmRoot = new URL('../dist/esm/index.js', import.meta.url)
const esmCordova = new URL('../dist/esm/cordova/index.js', import.meta.url)
const esmCapacitor = new URL('../dist/esm/capacitor/index.js', import.meta.url)
const bundle = new URL('../dist/cordova/fcm-cordova.bundle.cjs', import.meta.url)
const types = new URL('../dist/types/index.d.ts', import.meta.url)

const built = [
    cjsRoot,
    cjsCordova,
    cjsCore,
    cjsCapacitor,
    esmRoot,
    esmCordova,
    esmCapacitor,
    bundle,
    types
].every((url) => existsSync(fileURLToPath(url)))

test(
    'built package layout is present (run npm run build first)',
    { skip: built ? false : 'dist/ not built' },
    () => {
        assert.ok(built)
        assert.equal(
            JSON.parse(
                readFileSync(
                    fileURLToPath(new URL('../dist/cjs/package.json', import.meta.url)),
                    'utf8'
                )
            ).type,
            'commonjs',
            'the package root is type=module, so the CJS twin needs its own marker'
        )
    }
)

test('require() and import() resolve to one shared instance', async () => {
    const cjs = require_(fileURLToPath(cjsRoot)) as {
        FCM: Record<string, unknown>
        default: unknown
    }
    assert.equal(typeof cjs.FCM, 'object')
    assert.equal(cjs.default, cjs.FCM, 'the CJS default export is the instance')

    const esm = (await import(esmRoot.href)) as { FCM: unknown }
    assert.equal(esm.FCM, cjs.FCM, 'Symbol.for identity must survive separate registries')

    const publicApi = cjs.FCM as Record<string, unknown>
    for (const method of [
        'getToken',
        'deleteToken',
        'deleteInstanceId',
        'getInitialPushPayload',
        'hasPermission',
        'requestPushPermission',
        'subscribeToTopic',
        'unsubscribeFromTopic',
        'clearAllNotifications',
        'createNotificationChannel',
        'setAutoInitEnabled',
        'isAutoInitEnabled',
        'onNotification',
        'onTokenRefresh',
        'initialize',
        'dispose'
    ]) {
        assert.equal(typeof publicApi[method], 'function', `public API lost ${method} in the build`)
    }
    assert.equal(
        typeof (publicApi['eventTarget'] as Record<string, unknown>)['addEventListener'],
        'function'
    )
})

test('the Cordova bundle is a CJS module that exports the instance itself', () => {
    const loaded = require_(fileURLToPath(bundle)) as { default?: unknown } & Record<
        string,
        unknown
    >
    const instance = loaded as Record<string, unknown>
    assert.equal(typeof instance['onNotification'], 'function')
    assert.equal(typeof instance['subscribeToTopic'], 'function')
    const cjsCordovaEntry = require_(fileURLToPath(cjsCordova)) as {
        default: unknown
        FCM: unknown
    }
    assert.equal(
        loaded,
        cjsCordovaEntry.default,
        'window.FCM (bundle) and the npm Cordova import must be one instance'
    )
    assert.equal(cjsCordovaEntry.FCM, cjsCordovaEntry.default)
})

test('every promised export subpath resolves in both module systems', () => {
    // package.json is the contract Cordova/Capacitor/Ionic consumers import from;
    // a subpath that points at a missing file installs fine and breaks at build.
    const pkg = JSON.parse(
        readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
    ) as { exports: Record<string, Record<string, string>> }
    const subpaths = Object.keys(pkg.exports).filter((key) => key !== './package.json')
    assert.ok(subpaths.includes('./ionic'))
    assert.ok(subpaths.includes('./ionic/ngx'))
    assert.ok(subpaths.includes('./ionic/v4'))
    for (const subpath of subpaths) {
        const target = pkg.exports[subpath] ?? {}
        for (const condition of ['types', 'import', 'require']) {
            const file = target[condition]
            assert.ok(file, `${subpath} declares no "${condition}" target`)
            assert.ok(
                existsSync(fileURLToPath(new URL(`../${file}`, import.meta.url))),
                `${subpath} → ${condition}: ${file} is missing from the build`
            )
        }
    }
})

test('the ionic subpaths load in bare Node and share the root instance', async () => {
    const cjsIonic = new URL('../dist/cjs/ionic/index.js', import.meta.url)
    const cjsNgx = new URL('../dist/cjs/ionic/ngx/index.js', import.meta.url)
    const cjsV4 = new URL('../dist/cjs/ionic/v4/index.js', import.meta.url)
    for (const url of [cjsIonic, cjsNgx, cjsV4]) {
        assert.ok(
            existsSync(fileURLToPath(url)),
            'run npm run build before asserting the ionic subpaths'
        )
    }

    const rootCjs = require_(fileURLToPath(cjsRoot)) as { FCM: unknown }
    const legacy = require_(fileURLToPath(cjsIonic)) as Record<string, unknown>
    const ngx = require_(fileURLToPath(cjsNgx)) as {
        FCM: new (o?: unknown) => unknown
        provideFCM: () => Record<string, unknown>
    }
    const v4 = require_(fileURLToPath(cjsV4)) as { FCM: new (o?: unknown) => unknown }

    // The legacy ionic entry exports an Observable-shaped *wrapper* instance, not
    // the raw core: root `FCM.onNotification()` returns a disposable handle while
    // 7.x Ionic code expects an Observable, so one object cannot serve both APIs.
    // Identity is asserted where it is real — through `.core`.
    assert.notEqual(legacy['FCM'], rootCjs.FCM, 'the legacy ionic export must not be the raw core')
    assert.equal(
        (legacy['FCM'] as { core: unknown }).core,
        rootCjs.FCM,
        'the legacy ionic wrapper drives the shared root instance'
    )
    assert.equal(legacy['FCMPluginOnIonic'] instanceof Function, true)
    assert.equal(typeof ngx.provideFCM, 'function')

    const esmIonic = (await import(
        new URL('../dist/esm/ionic/index.js', import.meta.url).href
    )) as {
        FCM: { core: unknown }
    }
    assert.equal(
        esmIonic.FCM.core,
        rootCjs.FCM,
        'ESM/CJS twins of the ionic entry must not split the app'
    )

    // The provider is keyed by the exported class: `inject(FCM)` resolves a class
    // token, so any other key (a string, say) installs but never resolves.
    const provider = ngx.provideFCM()
    assert.equal(provider['provide'], ngx.FCM, 'provideFCM must provide the FCM class token')
    const built = provider['useFactory'] as () => { core: unknown }
    assert.equal(typeof built, 'function', 'provideFCM must build the instance through a factory')
    assert.ok(built() instanceof ngx.FCM)
    assert.equal(built().core, rootCjs.FCM, 'the injected wrapper drives the shared root instance')
    assert.equal(v4.FCM.prototype.onNotification instanceof Function, true)
})

test('the ionic entries name rxjs statically and Angular only as a type', () => {
    // The peer contract is graph-based: /ionic imports rxjs for real — which is why
    // a /ionic consumer installs it — while root/core/cordova/capacitor stay clean
    // because they never import ionic. What fakes that contract is a *deferred*
    // require() inside a function body: unresolvable at build time and dead under
    // ESM. The CJS twin legitimately uses a top-level require(), because esbuild
    // rewrites the module syntax for format:'cjs' while tsc keeps the ESM twin.
    for (const url of [
        new URL('../dist/cjs/ionic/shared.js', import.meta.url),
        new URL('../dist/esm/ionic/shared.js', import.meta.url)
    ]) {
        const source = readFileSync(fileURLToPath(url), 'utf8')
        assert.match(
            source,
            /from\s*["']rxjs["']|require\(\s*["']rxjs["']\s*\)/,
            `${url.toString()} must name rxjs statically, not pull it in lazily`
        )
        const deferred = /(?:=>|function)[^{}]{0,80}\{[^}]*require\(\s*["']rxjs["']/.test(source)
        assert.ok(
            !deferred,
            `a deferred rxjs require() in ${url.toString()} fakes the peer contract`
        )
    }
    for (const url of [new URL('../dist/esm/ionic/shared.js', import.meta.url)]) {
        const source = readFileSync(fileURLToPath(url), 'utf8')
        // Code only — a comment in the emitted file may legitimately *describe* the
        // lazy require this entry no longer uses.
        const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
        assert.ok(!/require\(/.test(code), `a require() in ${url.toString()} cannot run under ESM`)
    }
    // The Angular entries mention @angular/core in type position only, so with
    // verbatimModuleSyntax the emitted JS must not import it at all: a plain JS
    // consumer of /ionic/ngx needs no Angular installed.
    for (const url of [
        new URL('../dist/cjs/ionic/ngx/index.js', import.meta.url),
        new URL('../dist/esm/ionic/ngx/index.js', import.meta.url),
        new URL('../dist/cjs/ionic/v4/index.js', import.meta.url),
        new URL('../dist/esm/ionic/v4/index.js', import.meta.url)
    ]) {
        const source = readFileSync(fileURLToPath(url), 'utf8')
        // Comments may name the peer (they explain why it is type-only); only an
        // actual import/call site in emitted code would pull Angular into a JS app.
        const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
        assert.ok(
            !code.includes('@angular/core'),
            `${url.toString()} must not pull Angular into bare JS consumers`
        )
    }
})

test('the bundle carries no unresolved requires', () => {
    const source = readFileSync(fileURLToPath(bundle), 'utf8')
    const requires = source.match(/require\(\s*['"]([^'"]+)['"]\s*\)/g) ?? []
    assert.deepEqual(
        requires,
        [],
        'Cordova wraps each js-module on its own and cannot resolve relative requires'
    )
})

test('declarations describe the public contract', () => {
    const coreTypes = readFileSync(
        fileURLToPath(new URL('../dist/types/core/index.d.ts', import.meta.url)),
        'utf8'
    )
    for (const name of [
        'INotificationPayload',
        'IPluginBridge',
        'NativeEvent',
        'FCMErrorCode',
        'FCMPlugin'
    ]) {
        assert.ok(coreTypes.includes(name), `${name} is not exported from the built types`)
    }
    const core = require_(fileURLToPath(cjsCore)) as Record<string, unknown>
    assert.ok(Array.isArray(core['FCM_ERROR_CODES']))
    assert.equal(typeof core['toFCMError'], 'function')
    assert.equal(typeof core['sharedFCM'], 'function')
    assert.equal(
        core['FCMPlugin'],
        core['FCMCore'],
        'the 7.x class name is an alias of the core, so old typings still compile'
    )
})

test('every built entrypoint shares one runtime instance', async () => {
    const cjs = require_(fileURLToPath(cjsRoot)) as { FCM: unknown }
    const cjsCapacitorEntry = require_(fileURLToPath(cjsCapacitor)) as {
        FCM: unknown
        FCMPlugin: unknown
        FCMCore: unknown
    }
    const esm = (await import(esmRoot.href)) as { FCM: unknown }
    const esmCapacitorEntry = (await import(esmCapacitor.href)) as { FCM: unknown }
    const esmCordovaEntry = (await import(esmCordova.href)) as { FCM: unknown }

    assert.equal(
        cjsCapacitorEntry.FCM,
        cjs.FCM,
        'the CJS Capacitor subpath shares the root instance'
    )
    assert.equal(esmCapacitorEntry.FCM, esm.FCM)
    assert.equal(esmCordovaEntry.FCM, esm.FCM)
    assert.equal(esm.FCM, cjs.FCM, 'CJS and ESM twins of the same subpath must not split the app')
    assert.equal(cjsCapacitorEntry.FCMPlugin, cjsCapacitorEntry.FCMCore)
})

test('a vanilla import never pulls the optional Angular, RxJS or Capacitor peers', async () => {
    // Behavioural proof, not a grep: load each vanilla entry in this bare Node
    // process and walk its *real* module graph. Node has no window, no Cordova and
    // no Capacitor host, so an entry that pulled rxjs or @angular/core into scope
    // would either fail to resolve or show up as a resolved dependency here. The
    // Ionic subpaths are separate entries, so their peers can never leak into this
    // graph — which is exactly the contract the static rxjs import relies on.
    const vanilla = [cjsRoot, cjsCordova, cjsCore]
    for (const url of vanilla) {
        require_(fileURLToPath(url))
    }
    // Scope the walk to what *this* check loaded: `require.cache` is process-wide,
    // and the ionic subpath tests above deliberately load rxjs-backed entries.
    // Walking the whole cache would blame those entries for their own peer.
    const vanillaPaths = new Set(vanilla.map((url) => fileURLToPath(url)))
    const graph = new Set<string>()
    const pending = [...vanillaPaths]
    while (pending.length > 0) {
        const path = pending.pop() as string
        if (graph.has(path)) {
            continue
        }
        graph.add(path)
        const mod = require_.cache?.[path]
        for (const dep of mod?.children ?? []) {
            if (dep.id && !dep.id.includes('node_modules/.bin')) {
                pending.push(dep.id)
            }
        }
    }
    for (const specifier of graph) {
        for (const peer of ['@angular/core', 'rxjs', '@capacitor/core']) {
            assert.ok(
                !specifier.includes(`node_modules/${peer}/`),
                `${peer} was pulled into the vanilla require() graph`
            )
        }
    }

    // The ESM twins and the Cordova bundle: static analysis of every specifier they
    // can name, since an ESM graph is not observable from a require() cache.
    const esmVanilla = [esmRoot, esmCordova, bundle]
    for (const url of esmVanilla) {
        const source = readFileSync(fileURLToPath(url), 'utf8')
        const specifiers = [
            ...source.matchAll(/(?:from|import)\s*["']([^"']+)["']/g),
            ...source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)
        ].map((match) => match[1] ?? '')
        for (const peer of ['@angular/core', 'rxjs', '@capacitor/core']) {
            assert.ok(
                !specifiers.some((s) => s === peer || s.startsWith(`${peer}/`)),
                `${peer} is a named dependency of ${url.toString()}`
            )
        }
    }

    // Capacitor's own subpath may touch its peer, but only behind a dynamic
    // import: a static one would break a Cordova-only install.
    const capacitorEntry = readFileSync(fileURLToPath(cjsCapacitor), 'utf8')
    assert.match(capacitorEntry, /import\(\s*["']@capacitor\/core["']\s*\)/)
    assert.ok(
        !/require\(\s*["']@capacitor\/core["']\s*\)/.test(capacitorEntry),
        'a require() would resolve the optional peer at import time'
    )
})

type BuiltCore = {
    initialize(): Promise<void>
    onNotification(callback: (payload: Record<string, unknown>) => void): { dispose(): void }
    dispose(): void
}

test('the built Cordova entry keeps prototype keys off payloads and separates receipt from tap dedup', async () => {
    const entry = require_(fileURLToPath(cjsCordova)) as {
        CordovaBridge: new (host: unknown, platformId?: string) => unknown
        FCMCore: new (bridge: unknown, options?: Record<string, unknown>) => BuiltCore
    }
    const actions: string[] = []
    let keepAlive: ((data: unknown) => void) | null = null
    const host = {
        platformId: 'android',
        exec: (
            success: (value?: unknown) => void,
            _fail: (error?: unknown) => void,
            _service: string,
            action: string
        ): void => {
            actions.push(action)
            if (action === 'startJsEventBridge') {
                keepAlive = success as (data: unknown) => void
                return
            }
            success(undefined)
        }
    }
    const core = new entry.FCMCore(new entry.CordovaBridge(host, 'android'), {
        autoInitialize: false
    })
    await core.initialize()
    assert.deepEqual(actions, ['startJsEventBridge', 'ready', 'replayBufferedEvents'])

    const wire = (payload: Record<string, unknown>): void => {
        if (keepAlive === null) {
            throw new Error('startJsEventBridge never installed a keep-alive callback')
        }
        keepAlive(JSON.stringify(['notification', payload]))
    }
    // A hostile remote payload tries to reach the prototype chain through `data`.
    wire({
        wasTapped: false,
        messageId: 'dup',
        title: 'A',
        data: JSON.parse('{"__proto__":{"polluted":true},"screen":"inbox"}')
    })
    // Same message id, but a tap: a different identity space, never collapsed
    // into the receipt that arrived first.
    wire({ wasTapped: true, messageId: 'dup' })

    const seen: Array<Record<string, unknown>> = []
    core.onNotification((payload) => seen.push(payload))
    await new Promise<void>((resolve) => queueMicrotask(resolve))

    assert.equal(seen.length, 2, 'receipt and tap of one message are separate deliveries')
    assert.deepEqual(
        seen.map((payload) => payload.wasTapped),
        [false, true]
    )
    assert.equal(seen[0]?.screen, 'inbox')
    assert.deepEqual(seen[0]?._fcm, { dropped: ['__proto__'] })
    assert.equal(
        ({} as Record<string, unknown>)['polluted'],
        undefined,
        'the built bundle must never let remote data touch Object.prototype'
    )
    assert.equal(Object.prototype.hasOwnProperty.call(seen[0] ?? {}, 'polluted'), false)
    core.dispose()
})
