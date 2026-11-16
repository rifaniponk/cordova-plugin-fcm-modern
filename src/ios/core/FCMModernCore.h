#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>

@class FCMEventBus;

NS_ASSUME_NONNULL_BEGIN

extern NSString *const FCMModernErrorDomain;

typedef NS_ENUM(NSInteger, FCMModernError) {
    FCMModernErrorTimeout = -1,       // bounded readiness wait expired
    FCMModernErrorAPNS = -2,          // APNs registration failed / never arrived
    FCMModernErrorToken = -3,         // token/registration operation failed
    FCMModernErrorConfig = -4,        // Firebase not configured (no GoogleService-Info.plist)
};

/**
 * Runtime-free shared iOS core. One singleton for the whole app; Cordova and
 * Capacitor adapters attach to the same event bus and never duplicate logic.
 *
 * Firebase Messaging (Apple SDK 13.1.1) is used through its current APIs:
 * registerWithCompletion:/unregisterWithCompletion: and the
 * didReceiveRegistration: delegate when the SDK runs the installation-id
 * registration model (FIRMessaging.isInstallationIdEnabled), and the legacy
 * tokenWithCompletion:/didReceiveRegistrationToken: path otherwise.
 * Topics resolve only via subscribeToTopic:completion:/unsubscribeFromTopic:completion:,
 * so promises settle only after the SDK operation finishes.
 *
 * No AppDelegate takeover: bootstrap() installs the chain-safe
 * FCMNotificationDelegate (see its header) and becomes FIRMessagingDelegate.
 * With FirebaseAppDelegateProxyEnabled=false the host AppDelegate must forward
 * remote-notification callbacks (pattern documented in FCMNotificationDelegate.h):
 *
 *     FCMModernCore.shared().bootstrap()                       // didFinishLaunching
 *     FCMModernCore.shared().noteAPNsDeviceToken(deviceToken)  // didRegisterForRemoteNotificationsWithDeviceToken
 *     FCMModernCore.shared().noteAPNsRegistrationFailed(error) // didFailToRegisterForRemoteNotifications
 *     FCMModernCore.shared().forward(remoteNotification: userInfo) // didReceiveRemoteNotification(fetchCompletionHandler:)
 *
 * APNs readiness is a bounded wait (default 10s) with an error path; every
 * completion handler runs exactly once. No NSTimer retry loops, no NSInvocation
 * selector tricks, no Firebase Analytics.
 */
@interface FCMModernCore : NSObject

+ (instancetype)sharedCore NS_SWIFT_NAME(shared());

/** Idempotent: configures Firebase, installs delegates, enables event capture. */
- (void)bootstrap;
@property (nonatomic, assign, readonly, getter=isBootstrapped) BOOL bootstrapped;

/** Shared event bus used by both runtime adapters. */
@property (nonatomic, readonly) FCMEventBus *eventBus;

/** Registration token (or Firebase Installation ID in the SDK's registration
 *  model). Bounded timeout; completion runs exactly once, on the main queue. */
- (void)getTokenWithTimeout:(NSTimeInterval)timeout
                 completion:(void (^)(NSString *_Nullable token, NSError *_Nullable error))completion
    NS_SWIFT_NAME(getToken(timeout:completion:));

/** Deletes the current messaging token/registration only — never the Firebase
 *  installation (Installations.delete is intentionally never called). */
- (void)deleteTokenWithCompletion:(void (^)(NSError *_Nullable error))completion
    NS_SWIFT_NAME(deleteToken(completion:));

/** APNs device token (hex string) after a bounded readiness wait; errors on
 *  timeout or failed registration. */
- (void)waitForAPNSTokenWithTimeout:(NSTimeInterval)timeout
                         completion:(void (^)(NSString *_Nullable apnsToken, NSError *_Nullable error))completion
    NS_SWIFT_NAME(waitForAPNsToken(timeout:completion:));

- (void)hasPermissionWithCompletion:(void (^)(NSNumber *granted))completion
    NS_SWIFT_NAME(hasPermission(completion:));

/** The only place a permission prompt appears. */
- (void)requestPushPermissionWithCompletion:(void (^)(BOOL granted, NSError *_Nullable error))completion
    NS_SWIFT_NAME(requestPushPermission(completion:));

- (void)subscribeToTopic:(NSString *)topic
              completion:(void (^)(NSError *_Nullable error))completion
    NS_SWIFT_NAME(subscribe(toTopic:completion:));

- (void)unsubscribeFromTopic:(NSString *)topic
                  completion:(void (^)(NSError *_Nullable error))completion
    NS_SWIFT_NAME(unsubscribe(fromTopic:completion:));

/** App-scoped cancellation: delivered notifications + badge only. */
- (void)clearAllNotifications NS_SWIFT_NAME(clearAllNotifications());

/** FIRMessaging.autoInitEnabled; defaults to the SDK default, never forced. */
- (void)setAutoInitEnabled:(BOOL)enabled NS_SWIFT_NAME(setAutoInit(enabled:));
@property (nonatomic, assign, readonly, getter=isAutoInitEnabled) BOOL autoInitEnabled;

/** Foreground presentation is opt-in; default is event-only (OptionNone). */
- (void)setForegroundPresentationOptions:(UNNotificationPresentationOptions)options
    NS_SWIFT_NAME(setForegroundPresentation(options:));
@property (nonatomic, assign, readonly) UNNotificationPresentationOptions foregroundPresentationOptions;

/** The tap payload that opened the app; stable across reads, never consumed. */
- (nullable NSDictionary *)initialPushPayload NS_SWIFT_NAME(initialPushPayload());

/** Records the startup tap payload (first tap wins; later taps keep it stable). */
- (void)noteTapPayload:(NSDictionary *)payload NS_SWIFT_NAME(noteTap(payload:));

/// AppDelegate forwarding hooks (see FCMNotificationDelegate.h for the pattern).
- (void)noteAPNsDeviceToken:(NSData *)deviceTokenData NS_SWIFT_NAME(noteAPNsDeviceToken(_:));
- (void)noteAPNsRegistrationFailed:(NSError *)error NS_SWIFT_NAME(noteAPNsRegistrationFailed(_:));
/// Silent/background APNs delivery; enqueues a receipt (tap-inactive opens count as tap).
- (void)forwardRemoteNotification:(NSDictionary *)userInfo NS_SWIFT_NAME(forward(remoteNotification:));

@end

NS_ASSUME_NONNULL_END
