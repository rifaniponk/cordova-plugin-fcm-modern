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
| `npm run verify`                                                                                                      | exit 0 (full gate green after the packaging/podspec reconciliation)                          | Node 24.22.3 at `.tmp/toolchain/node-v24.22.3-linux-x64/bin`, JDK `25.0.5` for `test:native`                                     |
| `npm run format:check`                                                                                                | exit 0                                                                                         | prettier `3.9.10`                                                                                                               |
| `npm run typecheck`                                                                                                   | exit 0                                                                                         | typescript `6.0.3` (via `scripts/typecheck.mjs`, both tsconfigs)                                                                |
| `npm run build`                                                                                                       | exit 0 (`[build] ok — dist=present`)                                                           | esbuild `0.28.2` + tsc `6.0.3`                                                                                                  |
| `npm run test`                                                                                                        | exit 0 (12 suites)                                                                             | Node 24.22.3                                                                                                                    |
| `npm run test:aot`                                                                                                    | exit 0 (`[ngc-fixture] ok — compiled fixture into .tmp/aot/out`)                               | `@angular/compiler-cli` `22.2.3` (ngc AOT fixture, real `ngc` compile, no `skipLibCheck`)                                       |
| `npm run test:native`                                                                                                 | exit 0 (`[native-jvm] ok — 79 checks passed`, `compiled 7 sources`)                            | JDK `25.0.5` (`javac 25.0.5`, Temurin `25.0.5+8`) at `.tmp/toolchain/jdk-25.0.5+8/bin`, with `--release 11`                     |
| `node scripts/android-compile.mjs`                                                                                    | exit 0 (both fixtures compile: cordova app + capacitor app, each excluding the other adapter) | Gradle `9.2.0` (`--offline --no-daemon`), JDK `25.0.5` (`--release 11`), android.jar API 36, Firebase BoM `35.1.0` (messaging 26.0.1), cordova-android `15.1.0`, `com.capacitorjs:core:8.5.3`, per-runtime androidx closures |
| `npm run audit`                                                                                                       | exit 0 (`found 0 vulnerabilities`)                                                             | npm 11.19.1                                                                                                                     |
| `npx prettier --check "src/**/*.ts" "scripts/**/*.mjs" "tests/**/*.ts"`                                               | exit 0                                                                                         | prettier 3.9.10                                                                                                                 |
| `npx prettier --write README.md` then `npx prettier --check README.md`                                                | exit 0 after formatting                                                                        | prettier 3.9.10                                                                                                                 |
| `osv-scanner --lockfile package-lock.json`                                                                            | exit 0, `No issues found` (95 packages)                                                        | google/osv-scanner `v2.7.1` binary, sha256 `fb7dab19…3b1b` matched the release `SHA256SUMS`, downloaded into gitignored `.tmp/` |
| `npm run test` under Node 22 (rejection guard)                                                                        | exit **1** with `[test] FAILED — requires Node >= 24 (package.json engines), running v22.22.1` | `~/.nvm/versions/node/v22.22.1`                                                                                                 |
| `python3 -c "yaml.safe_load('.github/workflows/verify.yml')"`                                                         | parsed; jobs `verify`, `node22_guard`, `dependency_scan`, `ios_macos`                          | local Python                                                                                                                    |
| `renovate.json5` comment-stripped → `JSON.parse`                                                                      | parsed; 5 packageRules, 1 customManager                                                        | Node 24.22.0                                                                                                                    |

### Transient gate failure, since reconciled and re-passed

One concurrent run of `npm run verify` failed inside `npm run test`:
`tests/pluginPackaging.test.ts` still asserted the deleted legacy iOS sources and
`spec.platform = :ios, '13.0'` while `fcm-modern.podspec` had moved to `15.0`
(Firebase Apple 13.1.1 requires iOS 15). `plugin.xml` now declares the shared iOS
core + Cordova adapter, the test asserts the new wiring, and the full gate was
re-run green on Node 24.22.3.

## Configured in CI — exists as a workflow step, never executed here

`.github/workflows/verify.yml` (permissions: `contents: read`, no secrets,
`GITHUB_TOKEN` never passed to a step):

| Check                                                                                                                 | Where                                                                                                                    | Status                                                                                            |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `npm ci` + `npm run verify` on Node 24                                                                                | `verify` job (`ubuntu-latest`)                                                                                           | configured — CI has never run this repo                                                           |
| Real JDK for `npm run test:native`                                                                                    | `verify` job via `actions/setup-java@v4` (temurin 17, exports `JAVA_HOME` which `scripts/native-jvm.mjs` resolves)       | configured                                                                                        |
| Node 22 rejection guard (expects exit 1, asserts the engines message)                                                 | `node22_guard` job                                                                                                       | configured; the expectation itself was reproduced locally on Node 22.22.1                         |
| `npm run audit` + `osv-scanner --lockfile package-lock.json` (fails on a finding, no ignore list)                     | `dependency_scan` job                                                                                                    | configured; the npm-lockfile scan was also run locally and passed                                 |
| Gradle dependency lockfile scan (`./gradlew --write-locks` + `osv-scanner --lockfile …/gradle-dependencies-lock.xml`) | `dependency_scan`, gated on `hashFiles('fixtures/**/gradlew')`                                                           | configured, **not passed** — fixtures compile via `scripts/android-compile.mjs` but write no lockfile yet |
| Gradle/AAPT merged-manifest build (Cordova + Capacitor Android fixtures)                                              | not present in this workflow yet                                        | the `fixtures/android-cordova` and `fixtures/android-capacitor` app modules are plain Java compile fixtures; a full AGP build is pending |
| CocoaPods `pod lib lint fcm-modern.podspec`, `swift build` on `Package.swift`                                         | `ios_macos` job (`macos-latest`), steps self-disable via `hashFiles`                                                     | configured, **not passed**                                                                        |
| iOS simulator build (`npx cap add ios && npx cap sync ios && xcodebuild -sdk iphonesimulator … build`)                | `ios_macos` job, gated on `fixtures/capacitor-ios-app/package.json`                                                      | configured, **not passed**                                                                        |
| Capacitor discovery/sync (`npx cap sync android                                                                       | ios`)                                                                                                                    | inside the fixture-gated steps                                                                    | configured, **not passed** |
| Renovate dependency updates (`renovate.json5`)                                                                        | repo config file                                                                                                         | configured — the Renovate app is not installed in this environment, so no PR has ever been opened |

The iOS/macOS jobs are deliberately labelled "configured — never passed locally"
in the workflow names as well as here: this workspace has no macOS, no Xcode, no
CocoaPods, no full Android SDK/AGP toolchain (only `android.jar` for compilation)
and no Firebase project.

## Pending — nothing has been executed

| Check                                                                                                                                | Why it is pending                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Gradle / AAPT merged-manifest verification (`exported="false"` for `FCMModernTapActivity` and the messaging service)                | source compilation passes via `scripts/android-compile.mjs`; the AGP build (manifest merge, `R` resources, google-services plugin, APK packaging) has not been run            |
| iOS simulator builds, SPM resolution, `pod lib lint`                                                                                 | no macOS/Xcode/CocoaPods host here                                                                                                                                                   |
| Real-device push round-trip, `POST_NOTIFICATIONS` dialog, tap→`getInitialPushPayload()` behaviour, APNs provisioning                 | needs a device/simulator plus a Firebase project and credentials                                                                                                                     |
| Capacitor discovery/sync against a real app                                                                                          | no Capacitor fixture in this tree                                                                                                                                                    |
| Firebase Android BoM `35.1.0` artifacts                                                                             | resolved and compiled offline in the fixtures (firebase-messaging 26.0.1 et al. from `dl.google.com/android/maven2`) |
| google-services plugin `4.5.0` application and `Firebase/Messaging ~> 13.1.1` CocoaPods resolution                  | plugin application needs a real AGP build; pod resolution needs macOS/CocoaPods                                                                                                       |
| `/tmp/cordova-fcm-supervisor.md`                                                                                                     | **missing in this environment** (`ls` → "No such file or directory"); treated as an empty supervisor note, so no external findings were received or addressed in this session        |

Reading the missing supervisor file as empty does not make any row above pass;
compilation and CI configuration still prove nothing about runtime behaviour.
