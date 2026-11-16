# Security posture — what 8.0.0 actually does

This file describes code that is in this repository, not an aspiration. Anything
not implemented here is written as _not implemented_, and anything that has never
been executed in this workspace is listed in `docs/VALIDATION.md` rather than
asserted here.

## 1. No arbitrary-extra trampoline

Android notifications this plugin presents point at
`dev.rifan.fcmmodern.service.FCMModernTapActivity`, declared in `plugin.xml` as
`android:exported="false"` with **no** `intent-filter`. `FCMModernTapActivity` is
reached only by the `PendingIntent` this plugin builds, so a third-party app
cannot start it and cannot forge a tap by sending extras. The legacy 7.x
`FCMPluginActivity` (an exported activity that accepted arbitrary extras) is not
installed: `plugin.xml` ships only `dev.rifan.fcmmodern` sources and the packaging
test asserts `com.gae.scaffolder.plugin` is absent.

`FCMModernTapActivity.onCreate` reads the extras it is given, keeps only `String`
values as payload data, and takes the trusted message id from the internal key
`fcmmodern_message_id` only.

## 2. The tap `PendingIntent` is immutable and explicit

In `FCMModernMessagingService.showNotification`:

- the intent is a **component** intent (`new Intent(context, FCMModernTapActivity.class)`)
  — never an implicit intent another app's activity could claim;
- flags are `FLAG_UPDATE_CURRENT`, plus `FLAG_IMMUTABLE` on API 23+, so the
  notification cannot carry a mutable intent that another app rewrites;
- sender `data` is copied into the extras, but a `data` key equal to
  `fcmmodern_message_id` is skipped, so the remote payload cannot forge the trusted
  tap id;
- the notification id is derived from the message id (`messageId.hashCode()`, or a
  fixed fallback when the transport supplied no id), so one message does not
  silently replace an unrelated notification.

## 3. No URL or component is opened from a remote payload

Nothing in `src/android/dev`, `src/core` or `src/bridges` turns a payload value
into a `Uri`, an implicit intent, a browser launch or a deep link. The legacy 7.x
service imported `android.net.Uri` and acted on payload values; 8.x does not. If a
sender's `data` contains `"click_action": "https://…"` or a component name, it is
delivered to your listeners as inert data and nothing navigates to it. Route taps
from your own code, with your own allow-list.

Notification cancellation is app-scoped (`NotificationManager.cancelAll()` for
this app's own notifications); no other app's notifications are touched.

## 4. Remote payloads cannot spoof trusted fields

`src/core/payload.ts` defines the reserved keys (`wasTapped`, `title`, `subtitle`,
`body`, `badge`, `messageId`, `custom`, `_fcm`). Native metadata is written first
and a colliding `data` key is relocated to `custom.<key>` and recorded in
`_fcm.collisions`, so a sender cannot mark its own message `wasTapped: true`,
cannot forge `messageId` (the dedup key comes from the transport's id fields), and
cannot overwrite `title`/`body`.

**Prototype-key spoofing protection.** Every key is written with
`Object.defineProperty`, never with `payload[key] = value`, and
`UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype']` is rejected before the
copy. A sender sending `{"__proto__": {...}}` therefore cannot add properties to
`Object.prototype` and cannot make every payload in the app look
`{ wasTapped: true }`; the key is dropped and named in `_fcm.dropped`. The same
filter runs on `custom`, so a nested collision cannot smuggle a prototype key.
The Android core (`FCMPayload.java`) and iOS core (`src/ios/core/FCMPayload.m`)
apply the equivalent rules before the payload reaches JS.

`FCMError` normalisation is likewise identity-safe: an object that merely _looks_
like `FCMError` is rebuilt into a real `Error` (`toFCMError`), so a second bundled
copy of the plugin cannot hand your code a foreign throwable.

## 5. Nothing subscribes or initialises Firebase by itself

- No automatic `all` / `android` / `ios` topic subscription: `autoSubscribeTopics`
  defaults to `[]`. Subscriptions only happen through `subscribeToTopic()` or an
  explicitly supplied list.
- Firebase auto-initialisation is queried and set explicitly
  (`isAutoInitEnabled()` / `setAutoInitEnabled(boolean)`); the plugin never
  guesses the app's consent decision.
- A notification prompt appears only from `requestPushPermission()`.
- No Firebase Analytics dependency is declared (Android gradle references declare
  `firebase-messaging` through the app-owned BoM; iOS declares `Firebase/Messaging`
  only).
- Topic names are validated in JS before they reach Firebase, so a payload-derived
  string cannot push an arbitrary subscription name into the SDK.

## 6. Least privilege in the manifest

`plugin.xml` declares the messaging service with `android:exported="false"` and
the tap activity unexported; iOS sets `FirebaseAppDelegateProxyEnabled` to `false`
(implicit `AppDelegate` swizzling is not relied on), `UIBackgroundModes`
`remote-notification`, and `aps-environment` `development` for debug / `production`
for release — no development entitlement is injected into a release build.

The merged Android manifest and the entitlements actually produced by
`cordova-ios` are **not** verified in this workspace; they are CI-configured rows
in `docs/VALIDATION.md`, not claims made here.

## 7. No secrets, no credential material, no payload logging

- No `google-services.json` / `GoogleService-Info.plist` is committed; fixtures use
  clearly labelled build-only placeholders and the legacy committed
  `src/ios/Assets/GoogleService-Info.plist` is gone.
- Native logs carry diagnostics only: queue-overflow notices ("oldest event
  dropped") and listener-failure class names. Tokens, notification bodies and full
  payloads are never logged (`FcmEventBus.java`, `src/ios/core/FCMEventBus.m`).
- CI runs with `permissions: contents: read` and reads no secret, so a pushed
  branch cannot mint a token that publishes this package.

## 8. Delivery is best-effort — never "at-least-once", never "exactly-once"

This plugin makes **no** delivery guarantee at any layer. Concretely:

- **Duplicates are possible.** Firebase/APNs can re-deliver a message, a receipt
  and a tap for the same message are _deliberately_ two distinct events, and the
  dedup caches are bounded (native 100, JS 100 keys per identity space), so a long
  session can forget an id and re-deliver it.
- **Missed delivery is possible.** There is no background JavaScript: a data
  message reaches JS only while the app runs, plus whatever the OS actually hands
  the app on the next start. Both queues are bounded FIFOs (native 50, JS default 20) that **drop the oldest event** on overflow, and the token queue keeps only
  the newest token. A listener that never attaches never receives anything.
- **Nothing is acked.** There is no receipt acknowledgement back to Firebase, no
  retry, and no persistence across app kills.

Treat delivery as best-effort and make your own product tolerant of it: send a
`messageId`/stable business id, dedup and render idempotently on the receiving
side, and treat the token as refreshable state rather than a durable identifier.
Do not describe this plugin as "guaranteed delivery", "at-least-once" or
"exactly-once" in your own documentation either — none of those hold for FCM/APNs
transport, and this plugin adds no guarantee on top.

## 9. Supply chain

Dev dependencies are exact-pinned with one root lockfile and CI installs with
`npm ci`. No install lifecycle hook in this package downloads a tool, so an
`npm install` cannot fetch an undeclared binary. CI scans `package-lock.json` with
osv-scanner (pinned release, checksum verified against the release's own
`SHA256SUMS`) and fails on an unresolved finding; `npm audit` alone cannot assess
the Firebase SDKs, so the Gradle lockfile scan step exists and fails the job on a
native finding once the Android fixtures land (configured, not yet executed).
