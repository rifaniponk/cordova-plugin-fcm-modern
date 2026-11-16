#import <Cordova/CDVPlugin.h>

/**
 * Cordova transport adapter for the shared iOS core (src/ios/core/*).
 * Transport only — every semantic lives in FCMModernCore/FCMEventBus/FCMPayload.
 *
 * JS event wire format (keep-alive callback):
 *   ["notification", payload]   /   ["tokenRefresh", token]
 *
 * Bridge rules:
 *  - startJsEventBridge attaches the event-bus sink (replaying buffered events
 *    first) and keeps the callback alive for streamed events.
 *  - A serialization/transport failure produces an ERROR result on the keep-alive
 *    callback (which terminates it) — never a silently dropped event, and never a
 *    callback that hangs forever.
 *  - stopJsEventBridge / dealloc detach the sink; events queued afterwards stay
 *    buffered in the core for the next bridge.
 */
@interface FCMPlugin : CDVPlugin

// Actions: ready · getToken · deleteToken (+deleteInstanceId alias) ·
// getInitialPushPayload · getAPNSToken · hasPermission · requestPushPermission ·
// subscribeToTopic · unsubscribeFromTopic · clearAllNotifications ·
// setAutoInitEnabled · isAutoInitEnabled · setForegroundPresentation ·
// startJsEventBridge · stopJsEventBridge · replayBufferedEvents ·
// createNotificationChannel (no-op on iOS).

- (void)ready:(CDVInvokedUrlCommand *)command;
- (void)getToken:(CDVInvokedUrlCommand *)command;
- (void)deleteToken:(CDVInvokedUrlCommand *)command;
- (void)deleteInstanceId:(CDVInvokedUrlCommand *)command;
- (void)getInitialPushPayload:(CDVInvokedUrlCommand *)command;
- (void)getAPNSToken:(CDVInvokedUrlCommand *)command;
- (void)hasPermission:(CDVInvokedUrlCommand *)command;
- (void)requestPushPermission:(CDVInvokedUrlCommand *)command;
- (void)subscribeToTopic:(CDVInvokedUrlCommand *)command;
- (void)unsubscribeFromTopic:(CDVInvokedUrlCommand *)command;
- (void)clearAllNotifications:(CDVInvokedUrlCommand *)command;
- (void)setAutoInitEnabled:(CDVInvokedUrlCommand *)command;
- (void)isAutoInitEnabled:(CDVInvokedUrlCommand *)command;
- (void)setForegroundPresentation:(CDVInvokedUrlCommand *)command;
- (void)startJsEventBridge:(CDVInvokedUrlCommand *)command;
- (void)stopJsEventBridge:(CDVInvokedUrlCommand *)command;
- (void)replayBufferedEvents:(CDVInvokedUrlCommand *)command;
- (void)createNotificationChannel:(CDVInvokedUrlCommand *)command;

@end
