#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Notification delegate FORWARDING pattern (no AppDelegate takeover, no
 * +load swizzling, no delegate-stealing timer loop).
 *
 * Ownership model
 * ---------------
 * FCMModernCore.bootstrap() installs exactly ONE UNUserNotificationCenter
 * delegate for the whole app — this object. If the host app (or another SDK)
 * already installed a delegate, it is retained as `previousDelegate` and every
 * callback is forwarded to it on the main queue with a completion handler that
 * forwards to ours. The OS completion handler is invoked exactly once by this
 * class, after the chained delegate (if any) has had its chance to add
 * presentation options; a 3s internal fallback guarantees the completion fires
 * even if a chained delegate never calls through.
 *
 * Remote-notification (APNs) callbacks cannot be chained from inside this
 * delegate — UIApplication hands them to the app's own delegate. The required
 * host-side forwarding is documented in FCMModernCore.h; with
 * FirebaseAppDelegateProxyEnabled=false (this plugin's Info.plist setting) the
 * host AppDelegate MUST forward:
 *
 *   Swift (Capacitor AppDelegate / Cordova CordovaAppDelegate):
 *     func application(_ application: UIApplication,
 *                       didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
 *         FCMModernCore.shared().noteAPNsDeviceToken(deviceToken)
 *     }
 *     func application(_ application: UIApplication,
 *                       didFailToRegisterForRemoteNotificationsWithError error: Error) {
 *         FCMModernCore.shared().noteAPNsRegistrationFailed(error)
 *     }
 *     func application(_ application: UIApplication,
 *                       didReceiveRemoteNotification userInfo: [AnyHashable: Any],
 *                       fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
 *         FCMModernCore.shared().forward(remoteNotification: userInfo)
 *         completionHandler(.noData)
 *     }
 *
 *   Objective-C equivalent: call noteAPNsDeviceToken:, noteAPNsRegistrationFailed:
 *   and forwardRemoteNotification: from the matching AppDelegate methods.
 *
 * Coexistence limitation (documented, not magic): if another SDK also wants to
 * own UNUserNotificationCenterDelegate, whichever delegate installs last wins;
 * ours forwards to the earlier one, but behavior overlap between the two SDKs
 * (duplicate display, competing completion timing) is a documented limitation.
 */
@interface FCMNotificationDelegate : NSObject <UNUserNotificationCenterDelegate>

/** Previously installed delegate retained for forwarding; nil when none. */
@property (nonatomic, strong, nullable) id<UNUserNotificationCenterDelegate> previousDelegate;

@end

NS_ASSUME_NONNULL_END
