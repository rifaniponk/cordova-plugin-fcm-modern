# cordova-plugin-fcm-modern

Firebase Cloud Messaging push notifications for **Cordova and Capacitor** on
**Android and iOS**, with optional Ionic/Angular wrappers. Version 8.0.0 is a
full rewrite of `cordova-plugin-fcm-with-dependecy-updated` 7.x: the public
method names and payload shape stay compatible, the internals do not.

[![npm version](https://img.shields.io/npm/v/cordova-plugin-fcm-modern.svg)](https://www.npmjs.com/package/cordova-plugin-fcm-modern)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

**Delivery is best-effort.** FCM can deliver duplicates or miss messages; this
plugin makes no at-least-once or exactly-once promise. See
[`docs/SECURITY.md`](docs/SECURITY.md) and
[`docs/VALIDATION.md`](docs/VALIDATION.md) for what is verified vs pending.

Contents: [How it works](#how-it-works) | [Installation](#installation) |
[Payload configuration](#payload-configuration) | [API](#api) |
[Ionic & Angular](#ionic--angular) | [Validation status](#validation-status) |
[Migration from 7.x](#migration-from-7x) | [Authorship](#authorship)

## How it works

One native core per OS (Java on Android, Objective-C on iOS) is shared by the
Cordova bridge and the Capacitor plugin; events queue in the native bus from
cold start before any JS bridge exists, and replay in order when a listener
attaches.

- **Foreground**: messages arrive as JS events only — no notification bar by
  default. Opt into OS presentation with `FCM.configureForegroundPresentation()`.
- **Background/closed**: the OS shows the notification when the payload contains
  a `notification` object. Tapping it fires a _tap_ event (distinct from the
  receipt event for the same message id) and sets `getInitialPushPayload()`.
- **Cold start**: receipts, taps and token updates sent before the app's JS
  initialized are buffered (bounded) and replayed on attach;
  `getInitialPushPayload()` returns only the tap that opened the app and stays
  stable across reads.
- **Topics and permissions are explicit**: nothing auto-subscribes and no prompt
  is ever shown unless you call `requestPushPermission()`.

### iOS requirements

Apple needs the usual push plumbing, which this plugin configures for you
(`aps-environment`, `UIBackgroundModes=[remote-notification]`,
`FirebaseAppDelegateProxyEnabled=false`) but cannot supply:

- a Firebase project with `GoogleService-Info.plist` in the app,
- an APNs push certificate/profile from a paid Apple account,
- user consent — via `requestPushPermission()` (optionally `provisional` for
  quiet notification-centre delivery),
- AppDelegate forwarding for remote notifications and the UNUserNotificationCenter
  delegate, documented in the shipped headers; the plugin deliberately does not
  swizzle or take over your `AppDelegate`.

Android needs no special permission below API 33; on 33+ the notification
permission is requested explicitly via `requestPushPermission()`.

## Installation

Your app owns the Firebase configuration: put `google-services.json` (Android)
and/or `GoogleService-Info.plist` (iOS) in the project root. The plugin never
ships or fetches credentials, and installing it runs no lifecycle hook.

### Preferences

| Preference                          | Default               | Notes                                                                     |
| ----------------------------------- | --------------------- | ------------------------------------------------------------------------- |
| `ANDROID_DEFAULT_NOTIFICATION_ICON` | `@mipmap/ic_launcher` | Default notification icon.                                                |
| `ANDROID_FIREBASE_BOM_VERSION`      | `35.1.0`              | Firebase BoM the gradle reference resolves; the host app owns Gradle/AGP. |
| `ANDROID_GOOGLE_SERVICES_VERSION`   | `4.5.0`               | google-services plugin, applied at most once per module.                  |
| `ANDROID_GRADLE_TOOLS_VERSION`      | `8.1.0`               | Passed to the build as an env preference; no AGP is pinned here.          |
| `IOS_FIREBASE_MESSAGING_VERSION`    | `~> 13.1.1`           | CocoaPods spec for `Firebase/Messaging` (requires iOS 15+).               |

### Cordova

```sh
npm install -g cordova@latest          # plugin.xml requires cordova >= 11
npm uninstall @ionic-native/fcm        # this package ships the Ionic wrappers itself
cordova plugin add cordova-plugin-fcm-modern \
  --variable ANDROID_FIREBASE_BOM_VERSION="35.1.0" \
  --variable IOS_FIREBASE_MESSAGING_VERSION="~> 13.1.1"
```

`window.FCM` exists (the `FCMPlugin` js-module clobbers `FCM`). Android builds
get the shared sources plus `FCMPlugin.gradle`; AndroidX is enabled by the
plugin. `dist/` is committed, so git-tag installs need no build step. The
`engines.node >= 24` entry applies to this package's own dev toolchain, not to
consumer apps.

### Capacitor

```sh
npm i cordova-plugin-fcm-modern @capacitor/core
npx cap add android && npx cap add ios && npx cap sync
```

- **Android**: add to the app module's gradle
  `apply from: "../../../node_modules/cordova-plugin-fcm-modern/src/android/fcm-modern-capacitor.gradle"`
  — it whitelists the shared sources and deliberately excludes the Cordova
  adapter, so one plugin and one messaging service serve the app.
- **iOS**: integrate the shared core via CocoaPods (`FCMModern` pod) or
  `Package.swift` (SPM); the Capacitor Swift adapter comes through SPM.
- Import `cordova-plugin-fcm-modern/capacitor` or the runtime-selecting root.
  `@capacitor/core`, `rxjs` and `@angular/core` are optional peers loaded
  through dynamic `import()`; Cordova-only apps never need them.

### Ionic (v3–v5) and Angular

```sh
ionic cordova plugin add cordova-plugin-fcm-modern
```

```ts
import { FCM } from 'cordova-plugin-fcm-modern/ionic' // RxJS wrappers
import { provideFCM } from 'cordova-plugin-fcm-modern/ionic/ngx' // provider factory
import { FCM } from 'cordova-plugin-fcm-modern/ionic/v4' // Ionic v3/v4
```

`onNotification()`/`onTokenRefresh()` return RxJS `Observable`s that dispose the
native listener on unsubscribe; Angular apps use the AOT-safe `provideFCM()`
factory (verified against a real `ngc` compile, not raw decorated output).

### Web / SSR

Every entrypoint imports safely outside a browser and never touches `window`;
native calls reject with `FCMError` code `unsupported_platform`. There is no
browser push implementation — serve web push from your own service worker.

## Payload configuration

Send a `notification` plus `data`. **Do not set `click_action` anymore** — the
legacy `FCM_PLUGIN_ACTIVITY` trampoline is gone; taps are delivered through an
internal, non-exported activity with an immutable, explicit `PendingIntent`,
and remote payloads never open URLs.

```json
{
    "notification": {
        "title": "Notification title",
        "body": "Notification body",
        "sound": "default"
    },
    "data": {
        "param1": "value1",
        "param2": "value2"
    }
}
```

Sender `data` can never spoof trusted fields: `wasTapped`, `title`, `subtitle`,
`body`, `badge`, `messageId`, `custom`, `_fcm` win, colliding keys are preserved
under `custom.<key>` and listed in `_fcm.collisions`, and
`__proto__`/`constructor`/`prototype` are dropped and listed in `_fcm.dropped`.
See [`docs/MIGRATION.md`](docs/MIGRATION.md) for the full server-side diff.

## API

Promise-based; listeners return disposable handles.

```ts
import { FCM } from 'cordova-plugin-fcm-modern' // ambient runtime selection
```

| Method                                                                    | Notes                                                                                    |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `FCM.ready()` / `FCM.initialize()` / `FCM.dispose()`                      | handshake / explicit init (`autoInitialize:false`) / tear down the bridge                |
| `FCM.onNotification(cb, { once }?)`                                       | payload objects; replays buffered events; `dispose()` removes the listener               |
| `FCM.onTokenRefresh(cb, { once }?)`                                       | newest token delivered once to late listeners                                            |
| `FCM.getToken()`                                                          | current registration token                                                               |
| `FCM.deleteToken()` / `FCM.deleteInstanceId()`                            | token delete only — never removes the Firebase installation                              |
| `FCM.getAPNSToken()`                                                      | iOS only; bounded readiness with a real error path; `''` on Android                      |
| `FCM.getInitialPushPayload()`                                             | only the tap that opened the app; cached, stable across reads                            |
| `FCM.hasPermission()`                                                     | real `POST_NOTIFICATIONS` state on Android 33+, UN settings on iOS                       |
| `FCM.requestPushPermission({ provisional }?)`                             | the only API that can prompt; `ios9Support` is accepted and ignored                      |
| `FCM.subscribeToTopic(topic)` / `FCM.unsubscribeFromTopic(topic)`         | resolve only after the SDK operation finishes                                            |
| `FCM.clearAllNotifications()`                                             | app-scoped cancellation                                                                  |
| `FCM.createNotificationChannel({ id, name, ... })`                        | Android only; iOS resolves no-op                                                         |
| `FCM.configureForegroundPresentation({ alert, sound, badge, channelId })` | opt-in OS presentation                                                                   |
| `FCM.setAutoInitEnabled(bool)` / `FCM.isAutoInitEnabled()`                | Firebase auto-init is your consent decision                                              |
| `FCM.setAutoSubscribeTopics([...])`                                       | explicit auto-subscribe list; never defaults to `all`/`android`/`ios`                    |
| `FCM.eventTarget`                                                         | `EventTarget`; events carry payloads on `event.detail`; direct listeners also get replay |

Errors are `FCMError` with codes `unsupported_platform`, `bridge_unavailable`,
`invalid_argument`, `native_error`, `timeout`, `not_initialized`, `malformed` —
never a hanging promise or an `undefined` resolution.

Example:

```ts
const subscription = FCM.onNotification((payload) => {
    if (payload.wasTapped) {
        // tap event; distinct from the receipt event of the same message id
    }
})
await FCM.ready()
await FCM.requestPushPermission()
await FCM.subscribeToTopic('news')
// later
subscription.dispose()
```

## Validation status

Honest ledger: [`docs/VALIDATION.md`](docs/VALIDATION.md). Locally **passed**:
the JS gate (typecheck, 12 suites, Angular AOT fixture via real `ngc`, JVM core
harness, `npm audit`), Android **source compilation** in two real Gradle
fixtures per runtime, and `osv-scanner` on the npm lockfile. **CI-configured,
never run here**: Actions verification jobs, macOS/iOS builds, Gradle lockfile
scan. **Pending**: full AGP builds (manifest merge, google-services, APK),
CocoaPods/SPM resolution, simulator and real-device push round-trips.

Dependency scanning: `npm audit` cannot assess the Firebase SDKs resolved by
Gradle/CocoaPods inside your app; CI scans the npm graph with `osv-scanner` and
fails on findings, and the Gradle lockfile scan is configured but not yet
passed.

For richer Android presentation than the built-in foreground display,
`cordova-plugin-local-notification` remains a good companion; this plugin does
not open URLs from payloads and adds no Firebase Analytics.

## Migration from 7.x

The short version (full diff in [`docs/MIGRATION.md`](docs/MIGRATION.md)):
renamed package and Android classes (`dev.rifan.fcmmodern.*`);
`deleteInstanceId()` is a token-only alias; no automatic topic subscriptions;
foreground delivery event-only by default; explicit permission prompts;
`getInitialPushPayload()` = startup tap only; spoof-proof payload metadata;
`FCM_PLUGIN_ACTIVITY` removed; `ios9Support` ignored; install-time hooks gone.

## Authorship

This package is the 8.0.0 rewrite of
`cordova-plugin-fcm-with-dependecy-updated`, which itself grew out of
`fechanique/cordova-plugin-fcm`. The MIT license and historical attribution
are kept in `LICENSE` and `CHANGELOG.md`. Maintainer of the rewrite:
Rifan MF.
