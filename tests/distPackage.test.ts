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

test('a vanilla import never pulls the optional Angular, RxJS or Capacitor peers', () => {
    // The files a plain Cordova/Capacitor app actually loads. The Ionic wrappers
    // are separate subpaths, so their peers must never leak into this graph.
    const vanilla = [cjsRoot, cjsCordova, cjsCore, esmRoot, esmCordova, bundle]
    for (const url of vanilla) {
        const source = readFileSync(fileURLToPath(url), 'utf8')
        for (const peer of ['@angular/core', 'rxjs', '@capacitor/core']) {
            assert.ok(
                !source.includes(`"${peer}"`) && !source.includes(`'${peer}'`),
                `${peer.toString()} leaked into ${url.toString()}`
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
