# Validation ledger

Three columns, never inferred from each other. A row in "passed locally" only
means the command ran here and exited as stated; a row in "configured in CI"
means a workflow step exists and has **never** been executed in this workspace;
a row in "pending" means nothing has been executed at all.

Session: 2026-11-16, Linux workspace `/home/rifan/project/cordova-plugin-fcm-modern`,
branch working tree (no commit, no push — this task forbids both).

## Passed locally — commands actually run in this session

| Command                                                                                                               | Result                                                                                         | Environment actually used                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `node -v` / `npm -v`                                                                                                  | `v24.22.0` / `npm 11.19.1`                                                                     | `~/.nvm/versions/node/v24.22.0/bin` prepended to `PATH` (the system `node` is `v22.22.1`, below `engines.node`)                 |
| `npm ci` (in a scratch copy of `package.json` + `package-lock.json`, so the shared `node_modules/` was not disturbed) | exit 0                                                                                         | Node 24.22.0                                                                                                                    |
| `npm run verify`                                                                                                      | **exit 0 once, exit 1 now** — see the note below                                               | Node 24.22.0, `JAVA_HOME=/usr/lib/jvm/java-25-openjdk-amd64`                                                                    |
| `npm run format:check`                                                                                                | exit 0                                                                                         | prettier `3.9.10`                                                                                                               |
| `npm run typecheck`                                                                                                   | exit 0                                                                                         | typescript `6.0.3` (via `scripts/typecheck.mjs`, both tsconfigs)                                                                |
| `npm run build`                                                                                                       | exit 0 (`[build] ok — dist=present`)                                                           | esbuild `0.28.2` + tsc `6.0.3`                                                                                                  |
| `npm run test`                                                                                                        | exit 0 earlier, **exit 1 now** (1/12 suites)                                                   | Node 24.22.0                                                                                                                    |
| `npm run test:aot`                                                                                                    | exit 0 (`[ngc-fixture] ok — compiled fixture into .tmp/aot/out`)                               | `@angular/compiler-cli` `22.2.3` (ngc AOT fixture, real `ngc` compile, no `skipLibCheck`)                                       |
| `npm run test:native`                                                                                                 | exit 0 (`[native-jvm] ok — 79 checks passed`, `compiled 7 sources`)                            | JDK `25.0.5` (`javac 25.0.5`, Temurin `25.0.5+8`) at `.tmp/toolchain/jdk-25.0.5+8/bin`, with `--release 11`                     |
| `npm run audit`                                                                                                       | exit 0 (`found 0 vulnerabilities`)                                                             | npm 11.19.1                                                                                                                     |
| `npx prettier --check "src/**/*.ts" "scripts/**/*.mjs" "tests/**/*.ts"`                                               | exit 0                                                                                         | prettier 3.9.10                                                                                                                 |
| `npx prettier --write README.md` then `npx prettier --check README.md`                                                | exit 0 after formatting                                                                        | prettier 3.9.10                                                                                                                 |
| `osv-scanner --lockfile package-lock.json`                                                                            | exit 0, `No issues found` (95 packages)                                                        | google/osv-scanner `v2.7.1` binary, sha256 `fb7dab19…3b1b` matched the release `SHA256SUMS`, downloaded into gitignored `.tmp/` |
| `npm run test` under Node 22 (rejection guard)                                                                        | exit **1** with `[test] FAILED — requires Node >= 24 (package.json engines), running v22.22.1` | `~/.nvm/versions/node/v22.22.1`                                                                                                 |
| `python3 -c "yaml.safe_load('.github/workflows/verify.yml')"`                                                         | parsed; jobs `verify`, `node22_guard`, `dependency_scan`, `ios_macos`                          | local Python                                                                                                                    |
| `renovate.json5` comment-stripped → `JSON.parse`                                                                      | parsed; 5 packageRules, 1 customManager                                                        | Node 24.22.0                                                                                                                    |

### `npm run verify` currently exits 1, and the cause is not in this task's scope

The full gate passed at 17:44 local time (`npm run verify` exit 0, all seven steps).
Re-running it at 17:56 local time fails inside `npm run test`:
`tests/pluginPackaging.test.ts` asserts (a) that `plugin.xml` declares
`src/ios/FCMPlugin.h` / `src/ios/FCMPlugin.m` / `src/ios/AppDelegate+FCMPlugin.*` /
`src/ios/FCMPluginIOS9Support.*` / `src/ios/FCMNotificationCenterDelegate.*` — those
files were deleted while the iOS rewrite landed (`src/ios/core/FCMPayload.*`,
`src/ios/core/FCMEventBus.m`, `src/ios/core|cordova|capacitor` now exist), and (b)
`spec.platform = :ios, '13.0'` while `fcm-modern.podspec` now declares
`spec.platform = :ios, '15.0'`.

Both fixes belong to files this task does not own (`plugin.xml`,
`fcm-modern.podspec`, `tests/`), so they are recorded as **pending** below rather
than patched here. Everything else in the gate still exits 0 in this tree:
`format:check`, `typecheck`, `build`, `test:aot`, `test:native`, `audit`.

## Configured in CI — exists as a workflow step, never executed here

`.github/workflows/verify.yml` (permissions: `contents: read`, no secrets,
`GITHUB_TOKEN` never passed to a step):

| Check                                                                                                                 | Where                                                                                                                    | Status                                                                                            |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `npm ci` + `npm run verify` on Node 24                                                                                | `verify` job (`ubuntu-latest`)                                                                                           | configured — CI has never run this repo                                                           |
| Real JDK for `npm run test:native`                                                                                    | `verify` job via `actions/setup-java@v4` (temurin 17, exports `JAVA_HOME` which `scripts/native-jvm.mjs` resolves)       | configured                                                                                        |
| Node 22 rejection guard (expects exit 1, asserts the engines message)                                                 | `node22_guard` job                                                                                                       | configured; the expectation itself was reproduced locally on Node 22.22.1                         |
| `npm run audit` + `osv-scanner --lockfile package-lock.json` (fails on a finding, no ignore list)                     | `dependency_scan` job                                                                                                    | configured; the npm-lockfile scan was also run locally and passed                                 |
| Gradle dependency lockfile scan (`./gradlew --write-locks` + `osv-scanner --lockfile …/gradle-dependencies-lock.xml`) | `dependency_scan`, gated on `hashFiles('fixtures/**/gradlew')`                                                           | configured, **not passed** — fixtures do not exist in this tree yet                               |
| Gradle/AAPT merged-manifest build (Cordova + Capacitor Android fixtures)                                              | not present in this workflow yet — `fixtures/cordova-android-app` and `fixtures/capacitor-android-app` do not exist here | configured nowhere yet; see pending                                                               |
| CocoaPods `pod lib lint fcm-modern.podspec`, `swift build` on `Package.swift`                                         | `ios_macos` job (`macos-latest`), steps self-disable via `hashFiles`                                                     | configured, **not passed**                                                                        |
| iOS simulator build (`npx cap add ios && npx cap sync ios && xcodebuild -sdk iphonesimulator … build`)                | `ios_macos` job, gated on `fixtures/capacitor-ios-app/package.json`                                                      | configured, **not passed**                                                                        |
| Capacitor discovery/sync (`npx cap sync android                                                                       | ios`)                                                                                                                    | inside the fixture-gated steps                                                                    | configured, **not passed** |
| Renovate dependency updates (`renovate.json5`)                                                                        | repo config file                                                                                                         | configured — the Renovate app is not installed in this environment, so no PR has ever been opened |

The iOS/macOS jobs are deliberately labelled "configured — never passed locally"
in the workflow names as well as here: this workspace has no macOS, no Xcode, no
CocoaPods, no Android SDK and no Firebase project.

## Pending — nothing has been executed

| Check                                                                                                                                | Why it is pending                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run verify` as a whole in the current tree                                                                                      | fails in `tests/pluginPackaging.test.ts`: `plugin.xml` still declares iOS sources that were deleted, and the podspec deployment target moved to `15.0` while the test asserts `13.0` |
| `plugin.xml` / podspec packaging consistency                                                                                         | needs `plugin.xml` + `fcm-modern.podspec` + `tests/pluginPackaging.test.ts` to agree on the iOS file list and the iOS deployment target                                              |
| Gradle / AAPT merged-manifest verification (`exported="false"` for `FCMModernTapActivity` and the messaging service, BoM resolution) | no Gradle or Android SDK in this workspace, no `fixtures/**/gradlew`                                                                                                                 |
| iOS simulator builds, SPM resolution, `pod lib lint`                                                                                 | no macOS/Xcode/CocoaPods host here                                                                                                                                                   |
| Real-device push round-trip, `POST_NOTIFICATIONS` dialog, tap→`getInitialPushPayload()` behaviour, APNs provisioning                 | needs a device/simulator plus a Firebase project and credentials                                                                                                                     |
| Capacitor discovery/sync against a real app                                                                                          | no Capacitor fixture in this tree                                                                                                                                                    |
| Firebase Android BoM `35.1.0` / google-services `4.5.0` / `Firebase/Messaging ~> 13.1.1` artifact resolution                         | versions are declared in `plugin.xml`/`FCMPlugin.gradle`; nothing has resolved them here                                                                                             |
| `/tmp/cordova-fcm-supervisor.md`                                                                                                     | **missing in this environment** (`ls` → "No such file or directory"); treated as an empty supervisor note, so no external findings were received or addressed in this session        |

Reading the missing supervisor file as empty does not make any row above pass;
compilation and CI configuration still prove nothing about runtime behaviour.
