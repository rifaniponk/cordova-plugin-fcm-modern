import Foundation
import Capacitor
import FCMModernCore
import UserNotifications

/// Capacitor iOS adapter for the SAME shared native core used by the Cordova
/// adapter (FCMModernCore / FCMEventBus / FCMPayload — no duplicated logic).
///
/// Discovery (documented setup, no manual registration required beyond a
/// normal Capacitor app):
///   JS side — `registerPlugin<FCM>({ name: 'FCMModern' })` (or the typed
///   `/capacitor` entry); Capacitor iOS resolves the @objc class
///   `FCMModernPlugin` through normal plugin discovery (plugin name + "Plugin").
///   Swift AppDelegate — call `FCMModernPlugin.bootstrap()` (or
///   `FCMModernCore.shared().bootstrap()`) in `didFinishLaunchingWithOptions`,
///   and forward the remote-notification callbacks per the pattern documented
///   in FCMNotificationDelegate.h / FCMModernCore.h:
///     didRegisterForRemoteNotificationsWithDeviceToken → noteAPNsDeviceToken
///     didFailToRegisterForRemoteNotificationsWithError → noteAPNsRegistrationFailed
///     didReceiveRemoteNotification(fetchCompletionHandler:) → forward(remoteNotification:)
///   `load()` bootstraps the core too, so event capture never depends on the
///   first JS call.
///
/// Listener attach-before-replay: `load()` attaches the event-bus sink first;
/// the bus then replays buffered cold-start/tap/token events and delivers live
/// events. The JS core layer keeps its own bounded queue until a listener is
/// registered, so early replays are not lost.
///
/// Safe async disposal: when the plugin instance goes away, the sink is
/// detached asynchronously on the main queue (never from an arbitrary thread),
/// and buffered events stay intact for the next plugin instance.
@objc public class FCMModernPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FCMModernPlugin"
    public let pluginName = "FCMModern"
    public let pluginMethodList: [CAPPluginMethod] = [
        .init(name: "ready", callbackName: "ready"),
        .init(name: "getToken", callbackName: "getToken"),
        .init(name: "deleteToken", callbackName: "deleteToken"),
        .init(name: "deleteInstanceId", callbackName: "deleteInstanceId"),
        .init(name: "getInitialPushPayload", callbackName: "getInitialPushPayload"),
        .init(name: "getAPNSToken", callbackName: "getAPNSToken"),
        .init(name: "hasPermission", callbackName: "hasPermission"),
        .init(name: "requestPushPermission", callbackName: "requestPushPermission"),
        .init(name: "subscribeToTopic", callbackName: "subscribeToTopic"),
        .init(name: "unsubscribeFromTopic", callbackName: "unsubscribeFromTopic"),
        .init(name: "clearAllNotifications", callbackName: "clearAllNotifications"),
        .init(name: "setAutoInitEnabled", callbackName: "setAutoInitEnabled"),
        .init(name: "isAutoInitEnabled", callbackName: "isAutoInitEnabled"),
        .init(name: "setForegroundPresentation", callbackName: "setForegroundPresentation"),
        .init(name: "createNotificationChannel", callbackName: "createNotificationChannel"),
        .init(name: "replayBufferedEvents", callbackName: "replayBufferedEvents"),
    ]

    private let core = FCMModernCore.shared()
    private var eventSink: FCMEventSink?

    /// Optional explicit bootstrap hook for host AppDelegates.
    @objc public static func bootstrap() {
        FCMModernCore.shared().bootstrap()
    }

    public override func load() {
        core.bootstrap()

        let sink: FCMEventSink = { [weak self] kind, payload in
            guard let plugin = self else { return }
            switch kind {
            case "notification":
                if let payload = payload as? [AnyHashable: Any] {
                    plugin.notifyListeners("notification", data: payload)
                }
            case "tokenRefresh":
                if let token = payload as? String {
                    plugin.notifyListeners("tokenRefresh", data: ["token": token])
                }
            default:
                break
            }
        }
        eventSink = sink
        core.attach(sink: sink)  // attaches before replaying buffered events
    }

    deinit {
        let sink = eventSink
        DispatchQueue.main.async {
            FCMModernCore.shared().eventBus.detach(sink: sink)
        }
    }

    @objc func ready(_ call: CAPPluginCall) {
        Self.bootstrap()
        call.resolve()
    }

    @objc func getToken(_ call: CAPPluginCall) {
        core.getToken(timeout: 10) { token, error in
            if let token {
                call.resolve(["token": token])
            } else {
                call.reject(error?.localizedDescription ?? "FCM token unavailable")
            }
        }
    }

    /// Token/registration deletion only — never deletes the Firebase installation.
    @objc func deleteToken(_ call: CAPPluginCall) {
        core.deleteToken { error in
            if let error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve()
            }
        }
    }

    /// Compatibility alias kept for 7.x consumers.
    @objc func deleteInstanceId(_ call: CAPPluginCall) {
        deleteToken(call)
    }

    @objc func getInitialPushPayload(_ call: CAPPluginCall) {
        if let payload = core.initialPushPayload() as? [AnyHashable: Any] {
            call.resolve(payload)
        } else {
            call.resolve(["payload": NSNull()])
        }
    }

    @objc func getAPNSToken(_ call: CAPPluginCall) {
        core.waitForAPNsToken(timeout: 10) { apnsToken, error in
            if let apnsToken {
                call.resolve(["token": apnsToken])
            } else {
                call.reject(error?.localizedDescription ?? "APNs token unavailable")
            }
        }
    }

    @objc func hasPermission(_ call: CAPPluginCall) {
        core.hasPermission { granted in
            call.resolve(["granted": granted.boolValue])
        }
    }

    /// The only place a permission prompt appears; deprecated ios9Support
    /// options are accepted and ignored.
    @objc func requestPushPermission(_ call: CAPPluginCall) {
        core.requestPushPermission { granted, error in
            if let error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve(["granted": granted])
            }
        }
    }

    @objc func subscribeToTopic(_ call: CAPPluginCall) {
        guard let topic = call.getString("topic"), !topic.isEmpty else {
            call.reject("subscribeToTopic requires a non-empty 'topic'")
            return
        }
        core.subscribe(toTopic: topic) { error in
            if let error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve(["topic": topic])
            }
        }
    }

    @objc func unsubscribeFromTopic(_ call: CAPPluginCall) {
        guard let topic = call.getString("topic"), !topic.isEmpty else {
            call.reject("unsubscribeFromTopic requires a non-empty 'topic'")
            return
        }
        core.unsubscribe(fromTopic: topic) { error in
            if let error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve(["topic": topic])
            }
        }
    }

    @objc func clearAllNotifications(_ call: CAPPluginCall) {
        core.clearAllNotifications()
        call.resolve()
    }

    /// Notification channels are Android-only: accepted as a no-op on iOS.
    @objc func createNotificationChannel(_ call: CAPPluginCall) {
        call.resolve()
    }

    @objc func setAutoInitEnabled(_ call: CAPPluginCall) {
        guard let enabled = call.getBoolean("enabled") else {
            call.reject("setAutoInitEnabled requires a boolean 'enabled'")
            return
        }
        core.setAutoInit(enabled: enabled)
        call.resolve(["enabled": enabled])
    }

    @objc func isAutoInitEnabled(_ call: CAPPluginCall) {
        call.resolve(["enabled": core.isAutoInitEnabled])
    }

    @objc func setForegroundPresentation(_ call: CAPPluginCall) {
        let alert = call.getBoolean("alert") ?? true
        let sound = call.getBoolean("sound") ?? true
        let badge = call.getBoolean("badge") ?? true
        var options: UNNotificationPresentationOptions = .none
        if alert { options.insert(.alert) }
        if sound { options.insert(.sound) }
        if badge { options.insert(.badge) }
        core.setForegroundPresentation(options: options)
        call.resolve()
    }

    @objc func replayBufferedEvents(_ call: CAPPluginCall) {
        guard let sink = eventSink else {
            call.reject("event bridge is not attached (plugin not loaded)")
            return
        }
        core.eventBus.replay(sink: sink)
        call.resolve()
    }
}

import UserNotifications
