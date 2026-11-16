# Android compile fixtures

Two consumer fixtures prove the SDK-bound Java sources compile with a real
compiler against real artifacts. They are compile evidence only: no Gradle
Android (AGP) build, no merged manifest, no on-device push delivery.

Run them with the repo-local toolchain (nothing is installed globally):

```bash
node scripts/android-compile.mjs          # Gradle + javac, release 11
node scripts/android-compile.mjs --javac  # plain javac fallback, same sources
```

The script resolves the JDK, Gradle distribution and jars repo-relatively
(`.tmp/toolchain/**`, gitignored), lists the artifact coordinates it used, and
prints each fixture's merged source set as Gradle's own source set reports it.

## Fixture A — Cordova consumer (`fixtures/android-cordova`)

Merged sources (Capacitor adapter excluded by Gradle's source set):

```
fixtures/android-cordova/app/src/main/java/com/example/cordovaapp/MainActivity.java
src/android/dev/rifan/fcmmodern/android/AndroidFirebaseGateway.java
src/android/dev/rifan/fcmmodern/cordova/FCMModernCordovaPlugin.java
src/android/dev/rifan/fcmmodern/core/FCMModernCore.java
src/android/dev/rifan/fcmmodern/core/FCMPayload.java
src/android/dev/rifan/fcmmodern/core/FcmEventBus.java
src/android/dev/rifan/fcmmodern/service/FCMModernHolder.java
src/android/dev/rifan/fcmmodern/service/FCMModernMessagingService.java
src/android/dev/rifan/fcmmodern/service/FCMModernTapActivity.java
```

`:CordovaLib` compiles cordova-android 15.1.0's own Java sources with the same
compiler, so the app compiles against real Cordova classes. Discovery is the
real route: `app/src/main/res/xml/config.xml` declares
`dev.rifan.fcmmodern.cordova.FCMModernCordovaPlugin`, and the adapter is never
referenced from Java.

## Fixture B — Capacitor consumer (`fixtures/android-capacitor`)

Merged sources (Cordova adapter excluded):

```
fixtures/android-capacitor/app/src/main/java/com/example/capacitorapp/PluginRegistrySetup.java
src/android/dev/rifan/fcmmodern/android/AndroidFirebaseGateway.java
src/android/dev/rifan/fcmmodern/capacitor/FCMModernCapacitorPlugin.java
src/android/dev/rifan/fcmmodern/core/FCMModernCore.java
src/android/dev/rifan/fcmmodern/core/FCMPayload.java
src/android/dev/rifan/fcmmodern/core/FcmEventBus.java
src/android/dev/rifan/fcmmodern/service/FCMModernHolder.java
src/android/dev/rifan/fcmmodern/service/FCMModernMessagingService.java
src/android/dev/rifan/fcmmodern/service/FCMModernTapActivity.java
```

`PluginRegistrySetup` registers and instantiates the plugin class, so the
adapter's real Capacitor API surface is exercised at compile time.

## Toolchain actually used

| Item | Value |
| --- | --- |
| JDK | Temurin `jdk-25.0.5+8` (repo-local), `java -version` → `openjdk version "25.0.5"`, `javac 25.0.5` |
| Build tool | Gradle `9.2.0` (repo-local `gradle-dist`), run with `--offline --no-daemon` |
| Java release | `--release 11` (the plugin's Gradle floor) |
| Android API | SDK 36 platform `android.jar` (from `.tmp/toolchain/platform.zip`) |
| cordova-android | 15.1.0 npm package Java sources (`package/framework/src`) |
| Capacitor | `com.capacitorjs:core:8.5.3` classes.jar (repo1.maven.org) |
| Firebase | `com.google.firebase:firebase-messaging:26.0.1`, `firebase-common:23.0.0` (BoM `35.1.0` pin), `play-services-tasks:18.4.0`, `play-services-base/basement:18.9.0`, BoM pom fetched |
| androidx | cordova closure (core 1.9.0, appcompat 1.6.1, activity 1.8.0, fragment 1.6.2, webkit 1.6.0, core-splashscreen 1.0.1, lifecycle/savedstate/emoji2/drawerlayout/cursoradapter/collection 1.0.0) and Capacitor closure (core 1.17.0, appcompat 1.7.1, activity 1.11.0, fragment 1.8.9, coordinatorlayout 1.3.0, webkit 1.14.0, lifecycle 2.6.x, kotlin-stdlib 2.0.21, coroutines 1.8.1, jspecify 1.0.0), all from `dl.google.com/android/maven2` |

## Recorded mismatches (not substituted silently)

- `androidx.annotation:annotation:1.8.1` and `androidx.collection:collection:1.4.2`
  ship Kotlin-metadata jars with **no JVM classes**; the classes-bearing versions
  pinned by `appcompat:1.7.1` (`annotation:1.3.0`, `collection:1.0.0`) are used.
- `androidx.core:core:1.9.0` (not the older `core-1.3.2` jar that was already in
  `.tmp/toolchain`) is required by cordova-android 15.1.0 sources.
- `com.capacitorjs:core:8.5.3` declares `org.apache.cordova:framework:14.0.1`;
  the fixture compiles cordova-android **15.1.0** npm sources instead, because
  the declared Maven artifact was not fetched.
- Firebase Android artifacts come from `dl.google.com/android/maven2`; they are
  not on `repo1.maven.org` (404 there), and BoM 35.1.0 pins messaging 26.0.1.

## Stays pending

- Real AGP build: `android-library` module, resource/R generation, manifest
  merge, `google-services` plugin, Firebase BoM resolution in a host Gradle
  build, and APK packaging.
- On-device behavior: token refresh, topic subscribe/unsubscribe, notification
  channel creation, permission-result routing through `Bridge`, cold-start tap
  extras, and actual push delivery. The Capacitor adapter's permission prompt
  uses `ActivityCompat.requestPermissions`; whether the host Bridge routes
  that result back to `handleRequestPermissionsResult` is unverified.
- iOS/macOS routes: not compiled here at all.
