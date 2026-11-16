package dev.rifan.fcmmodern.capacitor;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginResult;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.firebase.messaging.FirebaseMessaging;

import dev.rifan.fcmmodern.android.AndroidFirebaseGateway;
import dev.rifan.fcmmodern.core.FCMModernCore;
import dev.rifan.fcmmodern.service.FCMModernHolder;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/**
 * Capacitor adapter for the same shared native core the Cordova plugin uses.
 * Listener callbacks attach to the bus before replay starts; disposal on
 * listener removal or plugin destroy never drops queued native events.
 */
@CapacitorPlugin(name = "FCMModern")
public class FCMModernCapacitorPlugin extends Plugin {
    private static final int PERMISSION_REQUEST_CODE = 0xFC40;

    private AndroidFirebaseGateway gateway;
    private final List<PluginCall> notificationListeners = new ArrayList<>();
    private final List<PluginCall> tokenListeners = new ArrayList<>();
    private final List<Consumer<JSONObject>> notificationSinks = new ArrayList<>();
    private final List<Consumer<String>> tokenSinks = new ArrayList<>();
    private PluginCall pendingPermissionCall;
    private FCMModernCore.PermissionCallback pendingPermissionCallback;

    @Override
    public void load() {
        gateway = new AndroidFirebaseGateway(getContext(), callback -> {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                callback.onGranted();
                return;
            }
            pendingPermissionCallback = callback;
            ActivityCompat.requestPermissions(getActivity(),
                new String[]{Manifest.permission.POST_NOTIFICATIONS}, PERMISSION_REQUEST_CODE);
        });
        FCMModernHolder.install(gateway);
    }

    @PluginMethod
    public void ready(PluginCall call) {
        call.resolve();
    }

    @PluginMethod
    public void getToken(PluginCall call) {
        FCMModernHolder.core().getToken(new FCMModernCore.TokenCallback() {
            @Override
            public void onResult(String token) {
                JSObject result = new JSObject();
                result.put("value", token == null ? "" : token);
                call.resolve(result);
            }

            @Override
            public void onError(String message) {
                call.reject(message);
            }
        });
    }

    @PluginMethod
    public void deleteToken(PluginCall call) {
        FCMModernHolder.core().deleteToken(new FCMModernCore.TokenCallback() {
            @Override
            public void onResult(String token) {
                call.resolve();
            }

            @Override
            public void onError(String message) {
                call.reject(message);
            }
        });
    }

    @PluginMethod
    public void subscribeToTopic(PluginCall call) {
        String topic = call.getString("topic");
        if (topic == null) {
            call.reject("topic is required");
            return;
        }
        FCMModernHolder.core().subscribeTopic(topic, operation(call));
    }

    @PluginMethod
    public void unsubscribeFromTopic(PluginCall call) {
        String topic = call.getString("topic");
        if (topic == null) {
            call.reject("topic is required");
            return;
        }
        FCMModernHolder.core().unsubscribeTopic(topic, operation(call));
    }

    private FCMModernCore.OperationCallback operation(PluginCall call) {
        return new FCMModernCore.OperationCallback() {
            @Override
            public void onSuccess() {
                call.resolve();
            }

            @Override
            public void onError(String message) {
                call.reject(message);
            }
        };
    }

    @PluginMethod
    public void getInitialPushPayload(PluginCall call) {
        JSONObject tap = FCMModernHolder.core().getStartupTap();
        call.resolve(tap == null ? new JSObject() : copy(tap));
    }

    /** The bus carries plain JSONObject payloads; Capacitor resolves JSObject. */
    private static JSObject copy(JSONObject source) {
        JSObject target = new JSObject();
        // Android's org.json.JSONObject exposes names() (a JSONArray), not keySet().
        org.json.JSONArray names = source.names();
        for (int index = 0; index < names.length(); index++) {
            String key = names.optString(index);
            target.put(key, source.opt(key));
        }
        return target;
    }

    @PluginMethod
    public void hasPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("value", gateway.hasNotificationPermission());
        call.resolve(result);
    }

    @PluginMethod
    public void requestPushPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            JSObject result = new JSObject();
            result.put("value", true);
            call.resolve(result);
            return;
        }
        pendingPermissionCall = call;
        FCMModernHolder.core().requestPermission(new FCMModernCore.PermissionCallback() {
            @Override
            public void onGranted() {
                JSObject result = new JSObject();
                result.put("value", true);
                call.resolve(result);
            }

            @Override
            public void onDenied(String message) {
                JSObject result = new JSObject();
                result.put("value", false);
                call.resolve(result);
            }
        });
    }

    @PluginMethod
    public void createNotificationChannel(PluginCall call) {
        String channelId = call.getString("id");
        String channelName = call.getString("name");
        if (channelId == null || channelName == null) {
            call.reject("channel id and name are required");
            return;
        }
        gateway.createChannel(channelId, channelName);
        call.resolve();
    }

    @PluginMethod
    public void clearAllNotifications(PluginCall call) {
        gateway.cancelNotifications();
        call.resolve();
    }

    @PluginMethod
    public void setAutoInitEnabled(PluginCall call) {
        FirebaseMessaging.getInstance().setAutoInitEnabled(call.getBoolean("enabled", false));
        call.resolve();
    }

    @PluginMethod
    public void isAutoInitEnabled(PluginCall call) {
        JSObject result = new JSObject();
        result.put("value", FirebaseMessaging.getInstance().isAutoInitEnabled());
        call.resolve(result);
    }

    @PluginMethod
    public void setForegroundPresentation(PluginCall call) {
        FCMModernHolder.setPresentationEnabled(call.getBoolean("alert", false));
        call.resolve();
    }

    @PluginMethod
    public void replayBufferedEvents(PluginCall call) {
        // Queued events already replayed when each listener attached.
        call.resolve();
    }

    @PluginMethod
    public void getAPNSToken(PluginCall call) {
        call.reject("getAPNSToken is only available on iOS");
    }

    @PluginMethod
    public void addListener(PluginCall call) {
        // Registers the JS callback with Capacitor's listener registry, which
        // notifyListeners() then dispatches events to.
        super.addListener(call);
        String type = call.getString("type");
        if ("notification".equals(type)) {
            Consumer<JSONObject> sink = payload -> notifyListeners("notification", copy(payload));
            notificationListeners.add(call);
            notificationSinks.add(sink);
            FCMModernHolder.bus().attachNotificationSink(sink);
        } else if ("tokenRefresh".equals(type)) {
            Consumer<String> sink = token -> notifyListeners("tokenRefresh", tokenValue(token));
            tokenListeners.add(call);
            tokenSinks.add(sink);
            FCMModernHolder.bus().attachTokenSink(sink);
        } else {
            call.reject("unknown listener type: " + type);
        }
    }

    /** src/bridges/capacitorBridge.ts reads event.token for tokenRefresh. */
    private static JSObject tokenValue(String token) {
        JSObject result = new JSObject();
        result.put("token", token == null ? "" : token);
        return result;
    }

    @PluginMethod
    public void removeListener(PluginCall call) {
        String callbackId = call.getCallbackId();
        PluginListenerEntry entry = find(callbackId);
        if (entry != null) {
            entry.detach();
        }
        call.resolve();
    }

    private PluginListenerEntry find(String callbackId) {
        for (int i = 0; i < notificationListeners.size(); i++) {
            if (notificationListeners.get(i).getCallbackId().equals(callbackId)) {
                PluginCall listener = notificationListeners.remove(i);
                Consumer<JSONObject> sink = notificationSinks.remove(i);
                return new NotificationEntry(listener, sink);
            }
        }
        for (int i = 0; i < tokenListeners.size(); i++) {
            if (tokenListeners.get(i).getCallbackId().equals(callbackId)) {
                PluginCall listener = tokenListeners.remove(i);
                Consumer<String> sink = tokenSinks.remove(i);
                return new TokenEntry(listener, sink);
            }
        }
        return null;
    }

    private interface PluginListenerEntry {
        void detach();
    }

    private final class NotificationEntry implements PluginListenerEntry {
        private final PluginCall listener;
        private final Consumer<JSONObject> sink;

        NotificationEntry(PluginCall listener, Consumer<JSONObject> sink) {
            this.listener = listener;
            this.sink = sink;
        }

        @Override
        public void detach() {
            FCMModernHolder.bus().detachNotificationSink(sink);
            listener.release(getBridge());
        }
    }

    private final class TokenEntry implements PluginListenerEntry {
        private final PluginCall listener;
        private final Consumer<String> sink;

        TokenEntry(PluginCall listener, Consumer<String> sink) {
            this.listener = listener;
            this.sink = sink;
        }

        @Override
        public void detach() {
            FCMModernHolder.bus().detachTokenSink(sink);
            listener.release(getBridge());
        }
    }

    @Override
    protected void handleOnDestroy() {
        for (Consumer<JSONObject> sink : notificationSinks) {
            FCMModernHolder.bus().detachNotificationSink(sink);
        }
        for (Consumer<String> sink : tokenSinks) {
            FCMModernHolder.bus().detachTokenSink(sink);
        }
        notificationSinks.clear();
        tokenSinks.clear();
        notificationListeners.clear();
        tokenListeners.clear();
        pendingPermissionCall = null;
        pendingPermissionCallback = null;
    }

    @Override
    protected void handleRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        FCMModernCore.PermissionCallback callback = pendingPermissionCallback;
        pendingPermissionCallback = null;
        pendingPermissionCall = null;
        if (requestCode != PERMISSION_REQUEST_CODE || callback == null) {
            return;
        }
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (granted) {
            callback.onGranted();
        } else {
            callback.onDenied("permission request returned DENIED");
        }
    }
}
