package dev.rifan.fcmmodern.cordova;

import android.Manifest;
import android.os.Build;

import com.google.firebase.messaging.FirebaseMessaging;

import dev.rifan.fcmmodern.android.AndroidFirebaseGateway;
import dev.rifan.fcmmodern.core.FCMModernCore;
import dev.rifan.fcmmodern.service.FCMModernHolder;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaInterface;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CordovaWebView;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONObject;

import java.util.function.Consumer;

/**
 * Cordova adapter for the shared native core. Event delivery uses one
 * keep-alive callback; bridge destruction detaches this sink without losing
 * queued events, and late attachers receive the bounded replay.
 */
public class FCMModernCordovaPlugin extends CordovaPlugin {
    private AndroidFirebaseGateway gateway;
    private Consumer<JSONObject> notificationSink;
    private Consumer<String> tokenSink;
    private CallbackContext bridgeContext;
    private FCMModernCore.PermissionCallback pendingPermission;

    @Override
    public void initialize(CordovaInterface cordova, CordovaWebView webView) {
        super.initialize(cordova, webView);
        gateway = new AndroidFirebaseGateway(cordova.getContext(), callback -> {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                callback.onGranted();
                return;
            }
            pendingPermission = callback;
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS});
        });
    }

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws Exception {
        switch (action) {
            case "ready":
                FCMModernHolder.install(FCMModernHolder.bus(),
                    new FCMModernCore(FCMModernHolder.bus(), gateway));
                callbackContext.success();
                return true;
            case "getToken":
                FCMModernHolder.core().getToken(new FCMModernCore.TokenCallback() {
                    @Override
                    public void onResult(String token) {
                        callbackContext.success(token == null ? "" : token);
                    }

                    @Override
                    public void onError(String message) {
                        callbackContext.error(message);
                    }
                });
                return true;
            case "deleteToken":
                FCMModernHolder.core().deleteToken(new FCMModernCore.TokenCallback() {
                    @Override
                    public void onResult(String token) {
                        callbackContext.success();
                    }

                    @Override
                    public void onError(String message) {
                        callbackContext.error(message);
                    }
                });
                return true;
            case "subscribeToTopic":
                FCMModernHolder.core().subscribeTopic(args.getString(0), operation(callbackContext));
                return true;
            case "unsubscribeFromTopic":
                FCMModernHolder.core().unsubscribeTopic(args.getString(0), operation(callbackContext));
                return true;
            case "getInitialPushPayload": {
                JSONObject tap = FCMModernHolder.core().getStartupTap();
                callbackContext.success(tap == null ? JSONObject.NULL : tap);
                return true;
            }
            case "hasPermission":
                callbackContext.success(gateway.hasNotificationPermission() ? 1 : 0);
                return true;
            case "requestPushPermission":
                FCMModernHolder.core().requestPermission(new FCMModernCore.PermissionCallback() {
                    @Override
                    public void onGranted() {
                        callbackContext.success(1);
                    }

                    @Override
                    public void onDenied(String message) {
                        callbackContext.success(0);
                    }
                });
                return true;
            case "createNotificationChannel": {
                JSONObject config = args.getJSONObject(0);
                gateway.createChannel(config.optString("id"), config.optString("name"));
                callbackContext.success();
                return true;
            }
            case "clearAllNotifications":
                gateway.cancelNotifications();
                callbackContext.success();
                return true;
            case "setAutoInitEnabled":
                FirebaseMessaging.getInstance().setAutoInitEnabled(args.getBoolean(0));
                callbackContext.success();
                return true;
            case "isAutoInitEnabled":
                callbackContext.success(FirebaseMessaging.getInstance().isAutoInitEnabled() ? 1 : 0);
                return true;
            case "setForegroundPresentation":
                FCMModernHolder.setPresentationEnabled(args.getJSONObject(0).optBoolean("alert"));
                callbackContext.success();
                return true;
            case "startJsEventBridge":
                attachBridge(callbackContext);
                return true;
            case "stopJsEventBridge":
                detachBridge();
                callbackContext.success();
                return true;
            case "replayBufferedEvents":
                // Queued events already replayed when the sink attached.
                callbackContext.success();
                return true;
            case "getAPNSToken":
                callbackContext.error("getAPNSToken is only available on iOS");
                return true;
            default:
                return false;
        }
    }

    private FCMModernCore.OperationCallback operation(CallbackContext callbackContext) {
        return new FCMModernCore.OperationCallback() {
            @Override
            public void onSuccess() {
                callbackContext.success();
            }

            @Override
            public void onError(String message) {
                callbackContext.error(message);
            }
        };
    }

    private void attachBridge(CallbackContext callbackContext) {
        detachBridge();
        bridgeContext = callbackContext;
        callbackContext.setKeepCallback(true);
        notificationSink = payload -> send("notification", payload);
        tokenSink = token -> send("tokenRefresh", token == null ? "" : token);
        FCMModernHolder.bus().attachNotificationSink(notificationSink);
        FCMModernHolder.bus().attachTokenSink(tokenSink);
    }

    private void detachBridge() {
        if (notificationSink != null) {
            FCMModernHolder.bus().detachNotificationSink(notificationSink);
            notificationSink = null;
        }
        if (tokenSink != null) {
            FCMModernHolder.bus().detachTokenSink(tokenSink);
            tokenSink = null;
        }
        bridgeContext = null;
    }

    private void send(String event, Object value) {
        CallbackContext context = bridgeContext;
        if (context == null) {
            return;
        }
        JSONArray envelope = new JSONArray();
        envelope.put(event);
        envelope.put(value);
        context.sendPluginResult(new PluginResult(PluginResult.Status.OK, envelope), true);
    }

    @Override
    public void onDestroy() {
        detachBridge();
        pendingPermission = null;
    }

    @Override
    public void onRequestPermissionResult(int requestCode, String[] permissions, int[] grantResults) {
        FCMModernCore.PermissionCallback callback = pendingPermission;
        pendingPermission = null;
        if (callback == null) {
            return;
        }
        boolean granted = grantResults.length > 0 && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED;
        if (granted) {
            callback.onGranted();
        } else {
            callback.onDenied("permission request returned DENIED");
        }
    }
}
