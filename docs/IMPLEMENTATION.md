# Rewrite execution guide

This is the supervisor's working guide for Qwen Code. It supplements
ARCHITECTURE.md with implementation order and observable acceptance checks.
The user approved the rewrite and delegated routine choices. Do not wait for
answers or ask the user to install tools. Do not publish or push.

## Working agreement

- Implement one bounded phase at a time. Make actual file changes before another
  architecture discussion. Use a maximum of two investigation commands before
  writing the next implementation increment; broaden investigation only for a
  concrete build/test failure.
- Read `/tmp/cordova-fcm-supervisor.md` after every commit. The supervisor may
  add findings while you work. Address correctness findings before new features.
- Batch independent reads using the shell. Avoid repeated registry queries and
  speculative toolchain investigation. Use registered tool names.
- Commit each coherent increment after its relevant checks. Every new commit
  must have author **Rifan MF <rifaniponk@users.noreply.github.com>**. There is
  no space in the email. Stage only the intended paths. Never amend earlier
  commits, force-reset, push, publish, or commit credentials.
- Record what actually ran. Compilation is not an on-device push-delivery test.
  Missing macOS/device checks stay pending; never replace them with source grep
  assertions and call them successful integration tests.

## Fixed product decisions

The package is `cordova-plugin-fcm-modern`, version 8.0.0. Android and iOS are
supported through Cordova and Capacitor. There is no browser push implementation.
The npm root and all subpaths must be safe to import in Node/SSR without a DOM.
Unsupported native calls reject with a useful error.

Use the existing public method names and payload shape as the compatibility
contract. Package-prefix changes and unavoidable native-configuration changes
belong in migration documentation. Keep `/ionic`, `/ionic/ngx`, and `/ionic/v4`
entrypoints; Angular and RxJS must remain optional for plain Cordova consumers.

Use one native core per OS. Keep its source in the package's Android module and
SPM-compatible iOS source tree. Cordova references the same shared source files;
exclude its bridge from Capacitor builds. Do not duplicate core implementations.
Use the runtime's normal discovery rather than asking consumers to register two
competing messaging services.

Foreground delivery is event-only by default. Presentation is opt-in. Permission
prompts are explicit. Topic subscription is explicit; do not subscribe to
`all`, `android`, or `ios` automatically. Do not add Firebase Analytics.

`deleteInstanceId()` is a compatibility alias for deleting the current messaging
token. It does not delete the entire Firebase installation. APNs readiness has
a bounded timeout/error path. Topics resolve only after the SDK operation finishes.

### Available verified tools

The supervisor installed tools under `/tmp/cordova-fcm-toolchain`. The Qwen
process environment exposes Java, Gradle and Android SDK paths. Use them for
actual Android compilation rather than continuing to report Java as unavailable.
Never commit absolute `/tmp` paths. macOS/Xcode and real-device credentials are
not available in this Linux workspace.

Registry observations on 2026-10-28: Capacitor 8.5.3, Cordova 13.0.0,
cordova-android 15.1.0, cordova-ios 8.1.1, Angular 22.2.3, RxJS 7.8.2,
esbuild 0.28.2. Angular compiler 22.2.3 requires TypeScript >=6.0 <6.1.
Pin a compatible stable TypeScript 6.0 patch rather than TypeScript 7.
The official Firebase release overview lists Android BoM 35.1.0, Apple SDK
13.1.1 and Google Services 4.5.0. Check actual artifact resolution during builds;
record and resolve any availability mismatch instead of inventing verification.

## Phase 1: package/build and core API

1. Replace the root manifest and build configuration. Use exact development
   dependencies, one root lockfile, explicit package exports, Node scripts and
   deterministic distributables. Bundle the Cordova module into a single CJS
   file: Cordova's module loader cannot resolve arbitrary npm-relative files.
2. Remove obsolete tslint and nested build/install toolchains as their
   replacements become functional. Keep the license and historical attribution.
3. Implement a pure typed bridge contract, structured errors, shared FCM facade,
   callback disposal and a bounded event buffer. Inject fake bridges in tests.
4. Export all original method and interface names. Preserve the deprecated
   `ios9Support` option as accepted/ignored input without obsolete iOS code.

Checks: clean build, typecheck and behavioral tests. Include native rejection,
callback `once`, disposal, bounded replay, metadata protection, and import safety.
Commit tooling and core as separate useful increments when feasible.

## Phase 2: runtime bridges and packaging

1. Cordova uses `cordova.exec`; install the event bridge at device readiness.
   Do not swallow permanent bridge failures or leave promises pending forever.
2. Capacitor uses a real registered native plugin. Attach listener callbacks
   before starting native replay; handle asynchronous listener disposal safely.
3. Root/Angular runtime selection must route a Capacitor app to the Capacitor
   bridge, and a Cordova app to Cordova, without requiring both runtimes.
4. Configure `plugin.xml`, native package metadata, podspec and Package.swift.
   Cordova SDK config uses supported resource declarations or documented setup,
   never nested npm installs or unrestricted shell install hooks.

Checks: bridge mocks, Cordova loader smoke test, packed-tarball entrypoint/type
resolution, and actual Capacitor discovery/sync. A package with both metadata
formats must not install two adapters or two messaging services.

## Phase 3: Android implementation

1. Implement current token/topic SDK methods, notification channel creation,
   app-scoped cancellation, auto-init configuration and Android 13+ permission
   requests. Respect the host's Gradle/AGP versions; use the Firebase BoM.
2. The shared native event bus exists before JS. Queue cold-start/tap/token
   events with bounded memory and attach one runtime sink. Keep receipt and tap
   deduplication independent. Clear destroyed bridge sinks without losing later
   native startup events.
3. Handle FCM SDK background notification launch extras and explicit immutable
   PendingIntents for foreground presentation. Do not reintroduce an exported
   arbitrary-extra trampoline. Do not open URLs from remote payloads.
4. Implement both Cordova and Capacitor adapters, including permission-result
   handling and new-intent handling. Exclude the other adapter's source from
   each runtime's compilation.

Checks: real Gradle compilation using both consumer fixtures. Exercise permission
and event-bus logic with meaningful tests where possible. Document the old
`FCM_PLUGIN_ACTIVITY` payload migration and verify actual merged manifests.

## Phase 4: iOS implementation

1. Shared core uses current Firebase Messaging APIs, correct APNs association,
   notification authorization including provisional status, and bounded token
   readiness handling. Retain/chains delegates correctly and call completion
   handlers once. Do not replace AppDelegate implementations or run a delegate
   takeover loop.
2. Buffer native events before bridges exist. Normalize SDK payloads using the
   same reserved-field rules as Android. Bridge failures must produce errors.
3. Implement Cordova and Capacitor adapters. Supply a valid mixed-language SPM
   layout with separate ObjC/Swift targets if needed, and a CocoaPods route.
4. Document explicit AppDelegate forwarding/capabilities where the framework
   requires them. Do not claim runtime coexistence that was not implemented.

Checks: package metadata checks locally; actual simulator compilation jobs on
macOS CI for supported routes. Mark these jobs as configured, not locally passed.

## Phase 5: Ionic/Angular and generic examples

RxJS observables must dispose the underlying subscription on unsubscribe. Supply
an Angular AOT-safe provider factory or a properly partially compiled library;
raw tsc-decorated Injectable output is insufficient. Verify an actual Angular
consumer with the current compatible compiler. Keep examples generic and use
only explicitly labeled non-production, build-only Firebase fixtures.

## Phase 6: security, CI, documentation and final review

- Run `npm ci`, build, typecheck, tests, package smoke and `npm audit`. Scan both
  runtime and development dependencies; do not hide findings using ignore lists
  or overrides without fixing the underlying selection.
- Resolve native dependencies in fixtures and scan their lockfiles/dependency
  reports with a real vulnerability scanner. An npm audit alone cannot assess
  Firebase SDKs. CI must fail on unresolved known vulnerabilities.
- Add dependency update automation and least-privilege CI workflows. Keep
  installation and packaging free of lifecycle code that downloads undeclared
  tools. Use committed deterministic dist files for Git-based plugin installs.
- README, migration, compatibility and security docs describe actual behavior,
  setup per runtime, Admin SDK/Console payloads, OS limitations, topic/token
  changes and overlapping-notification-plugin limitations.
- FCM delivery is best-effort. Duplicates and missed delivery are possible.
  Do not claim at-least-once or exactly-once delivery guarantees.
- Finish with a clean tree, all new commit author emails verified, and an honest
  validation ledger separating passed, configured-in-CI and pending-device checks.

## Event correctness checklist

- A receipt and later tap for the same message ID are distinct events.
- Missing IDs do not cause unrelated notifications to collapse.
- `getInitialPushPayload()` is stable across reads and returns only the startup
  tap, not every foreground/background receipt.
- Custom data cannot spoof `wasTapped`, canonical message IDs or `_fcm` metadata.
  Protect prototype-sensitive keys (`__proto__`, `constructor`, `prototype`) too.
- A once-listener added to a buffer receives one event; disposing before replay
  prevents callback invocation. Native and JS buffers remain bounded.
- Listener errors do not break delivery to other subscribers. A late token
  listener receives a string; notification listeners receive payload objects.
- No sensitive tokens, notification bodies or full payloads appear in logs.
