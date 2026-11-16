package dev.rifan.fcmmodern.android;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;

import com.google.android.gms.tasks.Task;
import com.google.firebase.messaging.FirebaseMessaging;

import dev.rifan.fcmmodern.core.FCMModernCore;

/**
 * Firebase-backed NativeGateway shared by the Cordova and Capacitor adapters
 * so one core serves both runtimes. SDK failures become useful error strings;
 * nothing here blocks a JS callback forever.
 */
public final class AndroidFirebaseGateway implements FCMModernCore.NativeGateway {
    /** Runtime-owned permission prompt (Cordova/Capacitor activity APIs). */
    public interface PermissionRequester {
        void requestNotificationPermission(FCMModernCore.PermissionCallback callback);
    }

    private final Context context;
    private final PermissionRequester permissions;

    public AndroidFirebaseGateway(Context context, PermissionRequester permissions) {
        this.context = context.getApplicationContext();
        this.permissions = permissions;
    }

    private static String causeOf(Task<?> task) {
        Exception exception = task.getException();
        return exception == null ? "unknown SDK failure" : String.valueOf(exception.getMessage());
    }

    @Override
    public void requestToken(FCMModernCore.TokenCallback callback) {
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (task.isSuccessful()) {
                callback.onResult(task.getResult());
            } else {
                callback.onError(causeOf(task));
            }
        });
    }

    @Override
    public void deleteToken(FCMModernCore.TokenCallback callback) {
        FirebaseMessaging.getInstance().deleteToken().addOnCompleteListener(task -> {
            if (task.isSuccessful()) {
                callback.onResult(null);
            } else {
                callback.onError(causeOf(task));
            }
        });
    }

    @Override
    public void subscribeTopic(String topic, FCMModernCore.OperationCallback callback) {
        FirebaseMessaging.getInstance().subscribeToTopic(topic).addOnCompleteListener(task -> {
            if (task.isSuccessful()) {
                callback.onSuccess();
            } else {
                callback.onError(causeOf(task));
            }
        });
    }

    @Override
    public void unsubscribeTopic(String topic, FCMModernCore.OperationCallback callback) {
        FirebaseMessaging.getInstance().unsubscribeFromTopic(topic).addOnCompleteListener(task -> {
            if (task.isSuccessful()) {
                callback.onSuccess();
            } else {
                callback.onError(causeOf(task));
            }
        });
    }

    @Override
    public void createChannel(String channelId, String channelName) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            manager.createNotificationChannel(new NotificationChannel(
                channelId, channelName, NotificationManager.IMPORTANCE_DEFAULT));
        }
    }

    @Override
    public void cancelNotifications() {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        manager.cancelAll();
    }

    @Override
    public void requestPermission(FCMModernCore.PermissionCallback callback) {
        permissions.requestNotificationPermission(callback);
    }

    public boolean hasNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return true;
        }
        return android.content.pm.PackageManager.PERMISSION_GRANTED == androidx.core.content.ContextCompat.checkSelfPermission(
            context, android.Manifest.permission.POST_NOTIFICATIONS);
    }
}
