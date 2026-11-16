# Migrating from 7.x to 8.0.0

Every difference below is what this repository actually implements today
(`package.json`, `plugin.xml`, `src/core/*`, `src/bridges/*`,
`src/android/dev/rifan/fcmmodern/*`). Behaviour that exists only in the design
plan is marked as _planned_, and anything that has never been executed here is
listed in `docs/VALIDATION.md` instead of being promised here.

## 1. Package and plugin identity

|                           | 7.x                                                    | 8.0.0                                                                                                |
| ------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| npm package               | `cordova-plugin-fcm-with-dependecy-updated`            | `cordova-plugin-fcm-modern`                                                                          |
| Cordova plugin id / name  | `cordova-plugin-fcm-with-dependecy-updated`            | `cordova-plugin-fcm-modern` (`plugin.xml` `id` + `name`)                                             |
| Android Java package      | `com.gae.scaffolder.plugin.*`                          | `dev.rifan.fcmmodern.core                                                                            | android | service | cordova | capacitor` |
| Android messaging service | `com.gae.scaffolder.plugin.MyFirebaseMessagingService` | `dev.rifan.fcmmodern.service.FCMModernMessagingService`                                              |
| Android tap handling      | exported `FCMPluginActivity` trampoline                | internal `dev.rifan.fcmmodern.service.FCMModernTapActivity` (`exported="false"`, no `intent-filter`) |
| Cordova JS module         | `FCMPlugin` clobbering `window.FCM`                    | unchanged: `dist/cordova/fcm-cordova.bundle.cjs` named `FCMPlugin`, `<clobbers target="FCM"/>`       |

`plugin.xml` installs only the `dev.rifan.fcmmodern` sources; the packaging test
asserts that `com.gae.scaffolder.plugin` is not installed. The old classes remain
in `src/android/com/` as historical attribution only — they are not compiled into
an app.

Also changed: `package.json` `engines.node` is `>=24` (dev/test toolchain only —
consumer apps are unaffected), `plugin.xml` engines are `cordova >= 11`,
`cordova-android >= 13`, `cordova-ios >= 7`, and the default native SDK versions
moved to Firebase BoM `35.1.0` / google-services `4.5.0` / Gradle tools `8.1.0` /
`Firebase/Messaging ~> 13.1.1`.

Import paths are new: `.` (runtime-selecting), `./cordova`, `./capacitor`,
`./core`, `./ionic`, `./ionic/ngx`, `./ionic/v4`. The 7.x root import stays
working, and the class name `FCMPlugin` is kept as an alias of `FCMCore`, so
`new FCMPlugin(...)` and `instanceof FCMPlugin` still compile.

## 2. `deleteInstanceId()` means "delete the token", nothing more

`FCMCore.deleteInstanceId()` delegates to `FCMCore.deleteToken()`, which invokes
the native `deleteToken` action; Android calls
`FirebaseMessaging.getInstance().deleteToken()`. So the call revokes the FCM
registration token for this app instance. It does **not** delete a Firebase
installation, does not remove `google-services.json` / `GoogleService-Info.plist`,
does not clear Analytics or Crashlytics state, and does not unregister other
Firebase features in the app.

Because subscriptions are bound to the token, a token you delete stops receiving
topic traffic; the next token has no subscriptions, so re-subscribe after
re-generating it.

Migration:

```ts
// 7.x
await FCM.deleteInstanceId()
// 8.x — same effect, honest name
await FCM.deleteToken()
```

## 3. Topics are explicit

7.x subscribed automatically on plugin start: Android subscribed `android` and
`all` (`src/android/com/gae/scaffolder/plugin/FCMPlugin.java`), iOS subscribed
`ios` and `all` (its `connectToFcm`). 8.x never subscribes anything by itself:
`autoSubscribeTopics` defaults to `[]` and `FCMCore` only subscribes topics you
pass. There is no `all`/`android`/`ios` subscription anywhere in the shipped JS
core or in the `dev.rifan.fcmmodern` sources.

If you depended on the implicit broadcast, opt in explicitly:

```ts
await FCM.subscribeToTopic('orders')
// or at construction, before the handshake runs:
FCM.setAutoSubscribeTopics(['orders'])
// or: createFCM({ autoSubscribeTopics: ['orders'] })
```

Topic names are validated in JS (`/^[a-zA-Z0-9\-_.~%]{1,900}$/`) and an invalid
name rejects with `FCMError` code `invalid_argument` instead of reaching Firebase.

## 4. Foreground messages are events; presentation is opt-in

A message that arrives while the app is in the foreground is delivered to JS
listeners (`onNotification` / `eventTarget` `"notification"`) and is not displayed
by the OS. `FCMModernMessagingService.onMessageReceived` always enqueues the
receipt event and shows a notification **only** when presentation has been
enabled (`FCMModernHolder.isPresentationEnabled()`).

```ts
await FCM.configureForegroundPresentation({ alert: true, sound: true, badge: true })
// or: createFCM({ foregroundPresentation: { alert: true } })
```

7.x had no presentation switch at all, so there is nothing to disable during a
migration — the default is the 7.x behaviour.

## 5. Permission prompts happen only where you ask

`requestPushPermission()` is the only API that can show a prompt:

- Android API 33+: requests `android.permission.POST_NOTIFICATIONS` (Cordova via
  `PermissionHelper.requestPermissions`, Capacitor via
  `ActivityCompat.requestPermissions`); below 33 it resolves `true` without a
  dialog.
- iOS: `UNUserNotificationCenter.requestAuthorizationWithOptions`, plus the new
  `provisional` option for non-modal delivery.
- `hasPermission()` on Android reports the `POST_NOTIFICATIONS` grant on API 33+
  and `true` below it; it does **not** consult
  `NotificationManager.areNotificationsEnabled()`, so a user-disabled channel is
  not reported as denied. On iOS it reads `UNNotificationSettings.authorizationStatus`
  (provisional counts as granted).

7.x `requestPushPermission()`/`hasPermission()` returned `true` on Android
unconditionally, so code written against that can now start seeing `false`.

## 6. `getInitialPushPayload()` returns the startup tap only

The native core records the tap that opened the app, later taps do not overwrite
it (`FCMModernCore` startup tap is set once and stable across reads), the JS side
caches the sanitized payload, and reading it does not consume the event — the
same payload is still replayed to the tap identity space for listeners that
attach later. It never returns a foreground receipt (`wasTapped: false`).

## 7. Payload shape: reserved keys win, `_fcm` records what happened

Trusted native metadata is `wasTapped`, `title`, `subtitle`, `body`, `badge`,
`messageId`, `custom`, `_fcm`. A sender's `data` key that collides with one of
them no longer overwrites it: it is preserved under `custom.<key>` and named in
`_fcm.collisions`. Prototype-sensitive keys (`__proto__`, `constructor`,
`prototype`) are never copied onto the payload; they are dropped and listed in
`_fcm.dropped`. Everything else from `data` is still flattened at top level, as
in 7.x.

```jsonc
// sender data: { "title": "liar", "note": "hi", "__proto__": "x" }
{
    "wasTapped": false,
    "messageId": "…",
    "title": "Real notification title", // native metadata wins
    "note": "hi", // user keys still flattened
    "custom": { "title": "liar" },
    "_fcm": { "collisions": ["title"], "dropped": ["__proto__"] }
}
```

Message identity: `messageId`, `gcm.message_id`, `_id`, `_fcm_message_id`, and the
nested `gcm.message_id` shape are recognised. 7.x `id_`/`_u`/`_c` collapse fields
are **not** treated as ids, so a message with no id gets no dedup key and
unrelated messages never collapse into one another.

## 8. Android `FCM_PLUGIN_ACTIVITY` payload is gone

7.x required:

```jsonc
{ "android": { "notification": { "click_action": "FCM_PLUGIN_ACTIVITY" } } }
```

and routed the tap through the exported `FCMPluginActivity`, which accepted
arbitrary extras; the legacy service also opened URLs from payload values.

8.x installs no exported trampoline. The notification's `PendingIntent` is built
with an explicit component intent naming this package's own
`FCMModernTapActivity`, with `FLAG_UPDATE_CURRENT` and `FLAG_IMMUTABLE` on
API 23+, and the trusted tap id travels under the internal key
`fcmmodern_message_id` (sender `data` cannot overwrite it). Tapping still yields a
`wasTapped: true` payload and populates `getInitialPushPayload()`.

Migration for senders:

```jsonc
// 8.x: drop android.notification.click_action entirely
{
    "notification": { "title": "Order shipped", "body": "Track it in the app" },
    "data": { "orderId": "4711" }
}
```

If your server sends `click_action: FCM_PLUGIN_ACTIVITY` today, delete it: an
unknown action name is ignored by Android and no longer resolves to a plugin
activity. Route deep links from your own app code using the payload you receive,
not from a remote payload value — the plugin never opens a URL it did not build.

## 9. `ios9Support` is accepted and ignored

`requestPushPermission({ ios9Support: { timeout, interval } })` still type-checks
and still resolves; `FCMCore` strips the option before the native call, and no
iOS 9 polling path exists in 8.x. Use `provisional` for non-modal iOS delivery and
the bounded native token/APNs readiness handling instead of the old timeout loop.

## 10. Unsupported calls reject with a real error

7.x resolved `undefined`/`null` or fired an error callback. 8.x rejects with an
`FCMError` carrying a code:

| Situation                                                               | `code`                                    |
| ----------------------------------------------------------------------- | ----------------------------------------- |
| browser / Capacitor Web / Cordova `browser` platform                    | `unsupported_platform`                    |
| no Cordova `exec`, or a Capacitor plugin method that is not implemented | `bridge_unavailable`                      |
| bad topic name, bad channel config, non-boolean `setAutoInitEnabled`    | `invalid_argument`                        |
| native side rejected                                                    | `native_error` (native message preserved) |
| native call never answered (default 15 s bound)                         | `timeout`                                 |
| call after `dispose()` / disposed instance                              | `not_initialized`                         |

`isFCMError()`/`toFCMError()` are exported so cross-realm rejections (a second
bundled copy) stay catchable as `Error` while keeping a recognised code.

## 11. Importing the package is safe outside a browser

`readHost()` reads `globalThis` instead of touching `window`, the Cordova bridge
resolves `window.cordova` lazily, `@capacitor/core` is loaded through a dynamic
`import()` in `src/core/loadBridge.ts` so a Cordova-only app never needs the
optional peer, and an `autoInitialize` handshake failure is swallowed at
construction and surfaces from the API that awaits it. So `import` in SSR/Node
does not crash; native calls reject with `unsupported_platform`.

## 12. Event buffering and dedup are new behaviour

7.x dropped any event fired before a listener existed (its README warns about
this). 8.x keeps a bounded native queue (50) plus a bounded JS queue (default 20)
and replays chronologically when a listener attaches; `once` consumes exactly one
queued event. Dedup is per identity space — receipt (`wasTapped: false`) and tap
(`wasTapped: true`) are independent, so a tap for an already-delivered receipt is
not suppressed — with a bounded LRU of 100 keys per space. Token refreshes keep
only the newest token (buffer size 1).

This is buffering, not delivery insurance: see `docs/SECURITY.md` for the
best-effort wording.

## 13. One instance, one messaging service

`FCM` (the shared instance) is stored under `Symbol.for('cordova-plugin-fcm-modern.fcm.instance')`
so the Cordova bundle, the ESM path and the CJS path resolve to the same
`FCMCore` — one event sink, one replay buffer. One `FCMModernMessagingService` and
one notification delegate exist per app; do not install a second FCM plugin
alongside this one, and do not register both runtime bridges.

## 14. Install-time behaviour changed

7.x ran install hooks that shelled out and installed nested `ionic` dependencies.
8.x declares everything through `plugin.xml` (`js-module`, `source-file`,
`config-file`, `framework` gradle reference, `podspec`) and ships committed
`dist/`, so a git-tag or Cordova plugin-fetch install needs no build step and no
lifecycle hook that downloads a tool. `google-services.json` and
`GoogleService-Info.plist` still have to live in your app project — the plugin
never copies a Firebase config it did not get from you.
