import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * Packaging contract for Cordova/CocoaPods consumers: plugin.xml must be
 * installable from the shipped tarball/git tag with no install-time hooks and
 * every declared file must actually exist, and the CocoaPods route must name
 * the same package the npm manifest ships. These are structural facts about
 * the *distributed* package, not source greps.
 */
const pluginXml = readFileSync(fileURLToPath(new URL('../plugin.xml', import.meta.url)), 'utf8')
const podspec = readFileSync(
    fileURLToPath(new URL('../fcm-modern.podspec', import.meta.url)),
    'utf8'
)
const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
) as { name: string; version: string; files: string[] }

const root = new URL('..', import.meta.url)
const exists = (rel: string) => existsSync(fileURLToPath(new URL(rel, root)))

const attr = (tag: string, name: string): string | undefined => {
    const match = new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]+)"`).exec(pluginXml)
    return match?.[1]
}

const declaredFiles = [
    ...pluginXml.matchAll(
        /<(?:source-file|header-file|resource-file|framework|js-module)\b[^>]*\bsrc="([^"]+)"/g
    )
].map((m) => m[1] as string)

test('plugin.xml identifies the package exactly as the npm manifest', () => {
    assert.match(pluginXml, new RegExp(`id="${manifest.name}"`))
    assert.match(pluginXml, new RegExp(`version="${manifest.version}"`))
})

test('the Cordova js-module is the committed single-file bundle', () => {
    const src = attr('js-module', 'src')
    assert.equal(src, 'dist/cordova/fcm-cordova.bundle.cjs')
    assert.ok(exists(src!), 'the shipped bundle referenced by plugin.xml must exist')
    assert.match(pluginXml, /<clobbers target="FCM" \/>/)
})

test('installation runs no lifecycle hooks', () => {
    assert.ok(!/<hook\b/.test(pluginXml), 'plugin.xml must never shell out at install time')
})

test('every file declared by plugin.xml exists in the package', () => {
    for (const ref of declaredFiles) {
        if (ref.includes('*') || ref.includes('/Entitlements')) continue
        assert.ok(exists(ref), `plugin.xml declares missing file ${ref}`)
    }
})

test('no legacy package identity or missing assets are declared', () => {
    assert.ok(!pluginXml.includes('cordova-plugin-fcm-with-dependecy-updated'))
    assert.ok(!pluginXml.includes('www/'), 'the legacy www module is gone')
    assert.ok(!pluginXml.includes('GoogleService-Info.plist'), 'credentials are never shipped')
})

test('Android wiring points at the shared modern sources', () => {
    assert.match(
        pluginXml,
        /<param name="android-package" value="dev\.rifan\.fcmmodern\.cordova\.FCMModernCordovaPlugin"\/>/
    )
    assert.match(
        pluginXml,
        /android:name="dev\.rifan\.fcmmodern\.service\.FCMModernMessagingService"/
    )
    assert.ok(!pluginXml.includes('FCM_PLUGIN_ACTIVITY'), 'the legacy exported trampoline is gone')
    assert.ok(
        !pluginXml.includes('com.gae.scaffolder.plugin'),
        'legacy Android classes are not installed'
    )
    assert.match(
        pluginXml,
        /FCMModernTapActivity" android:exported="false"/,
        'tap activity stays internal'
    )
})

test('the Capacitor gradle include ships without the Cordova adapter', () => {
    assert.ok(exists('src/android/fcm-modern-capacitor.gradle'))
    const capacitorGradle = readFileSync(
        fileURLToPath(new URL('../src/android/fcm-modern-capacitor.gradle', import.meta.url)),
        'utf8'
    )
    assert.ok(capacitorGradle.includes('core'), 'core directory is whitelisted')
    assert.ok(capacitorGradle.includes('capacitor'), 'capacitor adapter is whitelisted')
    assert.ok(
        !capacitorGradle.includes('"$fcmModernDev/cordova"'),
        'Cordova adapter stays out of Capacitor builds'
    )
})

test('the CocoaPods route matches the rewritten package', () => {
    assert.ok(exists('fcm-modern.podspec'))
    assert.ok(!exists('cordova-plugin-fcm-with-dependecy-updated.podspec'))
    assert.match(podspec, /spec\.name = 'FCMModern'/)
    assert.match(podspec, new RegExp(`spec\\.version = '${manifest.version}'`))
    assert.match(podspec, /:type => 'MIT'/)
    assert.match(podspec, /spec\.platform = :ios, '15\.0'/, 'Firebase 13.1.1 requires iOS 15')
    assert.match(podspec, /Firebase\/Messaging', '~> 13\.1\.1'/)
    assert.ok(!podspec.includes('FCMPluginIOS9Support'), 'iOS 9 shims are not compiled')
})

test('npm files[] ships the plugin metadata that Cordova installs need', () => {
    for (const entry of ['plugin.xml', 'fcm-modern.podspec', 'dist', 'src/android', 'src/ios']) {
        assert.ok(manifest.files.includes(entry), `package.json files[] must ship ${entry}`)
    }
    assert.ok(manifest.files.includes('dist/cordova') || manifest.files.includes('dist'))
})
