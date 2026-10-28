# cordova-plugin-fcm-modern 8.0.0 — architecture & implementation checklist

Status: implementation plan of record for the 8.0.0 rewrite. Verified against the legacy
7.8.0 reference tree in this repository and the official docs listed in §9.

## 1. Product shape

One npm package, one native core per OS, two first-class runtime adapters:

```
                     ┌──────────────────────────────────────────┐
  Angular/Ionic ───► │  /ionic  /ionic/ngx  /ionic/v4 (RxJS)     │
  Capacitor   ───►   │  /capacitor (registerPlugin adapter)      │
  Cordova     ───►   │  "." (window.FCM compat + ESM/CJS export) │
                     └───────────────┬──────────────────────────┘
                                     │  shared typed core (src/core)
                     ┌───────────────▼──────────────────────────┐
                     │  IPluginBridge  (cordova | capacitor | web)│
                     └───────┬───────────────────────┬──────────┘
                     Cordova bridge              Capacitor bridge
                     (CDVPlugin / CordovaPlugin)  (CAPPlugin / @CapacitorPlugin)
                     └───────────────┬───────────────┬──────────┘
                     ┌───────────────▼───────────────▼──────────┐
                     │  SHARED NATIVE CORE (per OS, runtime-free) │
                     │  token · topics · permission · channels    │
                     │  presentation · startup buffer · dedup     │
                     └───────────────┬──────────────────────────┘
                                     │ Firebase Messaging SDK (BoM 35.1.0 / Apple 13.1.1)
```

Rules that fall out of this shape:

- The core owns *semantics* (payload shape, reserved keys, buffering, dedup, promise
  plumbing). Adapters own *transport only*.
- A runtime never registers both bridges' native components. Only one FirebaseMessagingService
  / one UNUserNotificationCenter delegate exists per app; the two adapters attach to the
  same native core sink.
- Web (`browser` platform, Capacitor Web) is *supported for import* and fails per-call with a
  clear `FCM_UNSUPPORTED_PLATFORM` error. No import-time crash, no web-push implementation.

## 2. Repository layout

```
package.json                 name: cordova-plugin-fcm-modern, version 8.0.0, exports map
plugin.xml                   Cordova integration (no hooks that run shell/npm)
fcm-modern.podspec           CocoaPods route (cordova-ios + Capacitor CocoaPods opt-out)
Package.swift                SPM route (Capacitor 8 default iOS package manager)
src/
  core/                      TS, zero deps: types, FCMCore, payload sanitizer, event queue
  bridges/                   cordovaBridge.ts, capacitorBridge.ts, webBridge.ts
  cordova/                   entry that also assigns window.FCM (legacy global compat)
  capacitor/                 entry: registerPlugin + typed FCM instance
  ionic/                     RxJS wrappers (Angular-free service class)
  ionic-ngx/                 provider factory (provideFCM) + re-export; no raw decorators
dist/                        build output (esm + cjs + d.ts) — committed, see §8
android/                     Capacitor Android plugin (shared core + adapter)
src/android/                 Cordova Android sources (shared core + adapter)
src/ios/                     Cordova iOS sources (ObjC shared core + adapter)
ios/Sources/                 Capacitor iOS plugin (SPM/CocoaPods: core + Swift adapter)
tests/                       node:test suites (behaviour, not text greps)
fixtures/                    cordova-android-app, capacitor-android-app, capacitor-ios-app,
                             angular-consumer (CI smoke builds; placeholder config only)
docs/                        ARCHITECTURE.md, MIGRATION.md, payload reference
```

## 3. Public JS API (compat contract)

`window.FCM` and these names/signatures stay compatible:

| API | Notes |
| --- | --- |
| `clearAllNotifications(): Promise<void>` | app-scoped cancellation only |
| `createNotificationChannel(cfg): Promise<void>` | Android no-op elsewhere |
| `deleteInstanceId(): Promise<void>` | **compat alias** → deletes the current FCM registration token (never an "installation"). New name: `deleteToken()` |
| `getAPNSToken(): Promise<string>` | iOS only, rejects with bounded timeout off-iOS→`''` documented |
| `getInitialPushPayload(): Promise<payload|null>` | tap-that-opened-the-app payload |
| `getToken(): Promise<string>` | `FirebaseMessaging.getToken()` / `FIRMessaging token`, awaited, errors propagate |
| `hasPermission(): Promise<boolean>` | Android: POST_NOTIFICATIONS + areNotificationsEnabled; iOS: UNAuthorizationStatus incl. provisional |
| `requestPushPermission(options?): Promise<boolean>` | **only place a prompt can appear** |
| `subscribeToTopic(t)` / `unsubscribeFromTopic(t)` | awaited, native error propagated |
| `onNotification(cb, {once?}): IDisposable` | `dispose()` |
| `onTokenRefresh(cb, {once?}): IDisposable` | `dispose()` |
| `eventTarget: EventTarget` | `notification` / `tokenRefresh` CustomEvents |
| `IRequestPushPermissionOptions.ios9Support` | accepted, typed deprecated, ignored (no iOS 9 code) |

Additive (new in 8): `getToken()` alias `deleteToken()`,
`configureForegroundPresentation({alert,sound,badge})`,
`initialize(options)/ready()`, `setAutoSubscribeTopics([])`, `version`.

## 4. Event, buffering and dedup semantics (normative)

1. **Native-first buffering.** The native core queues `notification` and `tokenRefresh`
   events *before any JS/bridge exists* (cold start from a tap, or `startJsEventBridge`
   not yet called). Bounded FIFO (default 50), oldest dropped with a native log line
   (no payload logging). JS adds a second bounded queue only for events that arrive after
   the bridge attached but before a listener is registered.
2. **Two independent identity spaces for dedup:** *receipt* (`wasTapped:false`) and *tap*
   (`wasTapped:true`). A tap for a message whose receipt was already delivered is **not**
   suppressed. Key = native message id (`messageId`/`gcm.message_id`/`_id`) when present,
   else a native-side monotonic id; dedup is per space, bounded LRU (default 100).
3. **`getInitialPushPayload()`** returns the tap payload that opened the app (or `null`),
   is *not* consumed by reading, and is the same object the tap space would replay.
4. **Replay order** is chronological per space; a listener registered late receives buffered
   events then live events. `once` listeners consume exactly one queued event.
5. **Reserved metadata is never overwritten by user `data`:** `wasTapped`, `title`,
   `subtitle`, `body`, `badge`, `messageId`, `_fcm*`. A colliding user key is preserved
   under `custom.<key>` and a `_fcm.collisions` list records it. User data is otherwise
   flattened at top level (legacy behaviour).
6. No background JS execution is promised and no exactly-once delivery is promised.

## 5. Native core design

### Android (`dev.rifan.fcmmodern`)
- `core/` — runtime-free Java (Android SDK + Firebase only): `FcmCore` (token/topics/permission/
  channels/clear), `FcmEventBus` (bounded replay + dedup), `FcmPayload` (sanitizer, JSON),
  `FcmMessagingService extends FirebaseMessagingService` (single service, `exported=false`),
  `FcmPresentation` (foreground display opt-in), `FcmLaunchActivity` (direct-activity
  trampoline-free tap handling; no exported trampoline accepting arbitrary extras).
- `cordova/` — `CordovaFcmPlugin` (actions incl. legacy names + `startJsEventBridge`).
- `capacitor/` — `@CapacitorPlugin FcmCapacitorPlugin` + `MainActivity`-agnostic launch extras.
- Firebase BoM controlled by the app (`firebase-bom:35.1.0` documented, plugin declares
  `firebase-messaging` via BoM `platform(...)` in the gradle reference; no AGP/Gradle pinned).

### iOS (`FCMModern*`, Objective-C core + Swift adapter)
- `FCMModernCore` (ObjC singleton): token via `FIRMessaging token`, APNs registration,
  `UNUserNotificationCenter` authorization incl. provisional, bounded APNs-readiness wait
  (no `NSTimer` retry loops / no `NSInvocation` selector tricks), event bus, sanitizer.
- **No `+load` swizzling of `AppDelegate`, no delegate-stealing loop.** Cordova installs the
  core through a `CDVPlugin` + an explicit, chain-safe hook; Capacitor route documents
  `AppDelegate.application(_:didFinishLaunchingWithOptions:)` calling the plugin's `bootstrap`,
  and `FIRMessagingDelegate`/`UNUserNotificationCenterDelegate` coexistence rules with
  original-completion forwarding (documented limitation when another SDK needs the same delegate).
- Swift `FcmCapacitorPlugin: CAPPlugin` (SPM product + podspec), Cordova `FCMModernPlugin`
  (podspec). Entitlements: Cordova sets `aps-environment` for debug/release; no development
  entitlement injected into release App Store builds beyond `aps-environment=production`.

## 6. Security posture (implemented, not aspirational)

- No auto-init surprises: `firebaseAutoInit` documented; **no** automatic `all`/`android`/`ios`
  topic subscriptions (legacy behaviour removed; migration notes in MIGRATION.md).
- No Firebase Analytics dependency added.
- Permission prompt only from `requestPushPermission()`.
- Android: `PendingIntent` with `FLAG_IMMUTABLE|FLAG_UPDATE_CURRENT`, explicit component
  intents, service `exported=false`, no arbitrary extras accepted from outside, no
  arbitrary URL opening, notification cancellation scoped to the app's own notifications,
  no token/body/payload logging in release.
- No `google-services.json` / `GoogleService-Info.plist` committed — fixtures use clearly
  labelled build-only placeholders; `src/ios/Assets/GoogleService-Info.plist` is deleted.
- Install hooks: none that shell out or npm-install (legacy `.bat` hook and nested
  `src/ionic/package.json` installs deleted; resources declared via `resource-file`/`config-file`).

## 7. Toolchain & versions (verified 2026-10-28)

| Component | Version | Source |
| --- | --- | --- |
| npm package | 8.0.0 (this rewrite) | — |
| TypeScript | see `package.json` (Angular peer range decides it) | registry |
| @capacitor/core / android / ios | 8.5.3 | registry |
| @angular/* (optional peer) | 22.2.3 | registry |
| rxjs (optional peer) | 7.8.2 | registry |
| cordova / cordova-android / cordova-ios | 13.0.0 / 15.1.0 / 8.1.1 | registry |
| Firebase Android BoM | 35.1.0 (2026-10-21) | firebase release notes |
| Firebase Apple SDK | 13.1.1 (2026-10-22) | firebase release notes |
| google-services plugin | 4.5.0 (2026-06-16) | firebase release notes |

Dev deps exact-pinned, one lockfile, `npm ci` in CI. No tslint, no @ionic-native tooling,
no `npx` of unlocked tools, no dependency overrides.

## 8. Distribution decisions

- `exports` map: `.` (Cordova/compat, ESM+CJS+types), `./capacitor`, `./ionic`, `./ionic/ngx`,
  `./ionic/v4`, `./core`. Subpaths — no nested `package.json` installs.
- `dist/` is **committed** (policy: git-tag installs and Cordova plugin-fetch installs must
  work without a build step); CI verifies `dist/` matches `npm run build` so drift fails loudly.
- Angular integration = provider factory `provideFCM()` (no uncompilable raw decorators in
  shipped JS). Verified by a real Angular AOT consumer fixture, not `skipLibCheck`.
- iOS: SPM first-class (Capacitor 8 default) **and** CocoaPods podspec (cordova-ios).

## 9. Implementation checklist (commit-sized)

- [x] A. Architecture doc (this file)
- [ ] B. Foundations: `package.json` (rename, exports, exact devDeps, single lockfile),
      `tsconfig`, build script (tsc + small bundler for Cordova single-file CJS), remove
      tslint/nested package.json/legacy scripts
- [ ] C. `src/core` types + `FCMCore` (API, queue, dedup, sanitizer, bridge interface) + tests
- [ ] D. Bridges (cordova/capacitor/web) + entries (`window.FCM` compat) + tests
- [ ] E. `plugin.xml` (Cordova packaging, no shell hooks) + podspec + Package.swift + packaging tests
- [ ] F. Android shared core (token/topics/permission/channels/presentation/event bus/service/launch)
- [ ] G. Android Cordova adapter + Android Capacitor adapter (compiles with Gradle fixture)
- [ ] H. iOS shared core (ObjC) + Cordova adapter
- [ ] I. iOS Capacitor adapter (Swift, SPM + podspec) — macOS compile pending on Linux, documented
- [ ] J. Ionic/Angular wrappers (RxJS observables, teardown) + `provideFCM()` + Angular consumer fixture
- [ ] K. Tests: routing, import safety, bridge failure, dispose/once, replay/dedup, initial
      payload, reserved fields, native rejection propagation; package tarball + plugin.xml smoke
- [ ] L. CI workflows (npm ci/build/typecheck/tests/audit/tarball, Android gradle+cordova+capacitor
      build, macOS iOS compile job, osv/native dependency scanning, dependabot)
- [ ] M. Docs: README rewrite (per-runtime install/config, matrix, payloads, coexistence,
      limitations), MIGRATION.md, SECURITY.md, CONTRIBUTING/verification

## 10. Known limitations to state honestly in docs

- No background JavaScript: FCM data messages only reach JS while the app runs (or via the
  buffered replay at next start for tap/cold-start cases the OS actually hands us).
- No exactly-once delivery guarantee (FCM is at-least-once/best-effort).
- iOS notification-handler ownership: if another SDK must own
  `UNUserNotificationCenterDelegate`, this plugin coexists by chaining but behaviour overlap is
  documented, not magic.
- Native/device behaviour (real push round-trip, POST_NOTIFICATIONS dialog, SPM resolution)
  is verified by compilation + fixtures here; on-device delivery checks stay with the app owner.

## 11. References (primary)

Firebase releases / Cloud Messaging Android+iOS get-started & receive-messages / manage-tokens;
Cordova platform guides (android, ios); Capacitor creating-plugins & SPM docs — URLs listed in
README §References. Version facts above were taken from the Firebase release page and the npm
registry on 2026-10-28.
