package dev.rifan.fcmmodern.service;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import dev.rifan.fcmmodern.core.FCMModernCore;

import java.util.HashMap;
import java.util.Map;

/**
 * Single Firebase Messaging service shared by both runtimes. Receipts are
 * event-only by default; presentation is opt-in. The tap PendingIntent names
 * this package's own internal activity explicitly and is immutable — never an
 * exported arbitrary-extra trampoline, and remote payloads never open URLs.
 */
public class FCMModernMessagingService extends FirebaseMessagingService {

    @Override
    public void onNewToken(String token) {
        FCMModernHolder.bus().publishToken(token);
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, String> data = new HashMap<>(message.getData());
        String messageId = message.getMessageId();
        RemoteMessage.Notification notification = message.getNotification();
        String title = notification != null ? notification.getTitle() : null;
        String body = notification != null ? notification.getBody() : null;
        Integer badge = notification != null ? notification.getNotificationCount() : null;

        FCMModernCore.enqueue(FCMModernHolder.bus(), data, messageId, false, title, null, body, badge);

        if (FCMModernHolder.isPresentationEnabled() && notification != null) {
            showNotification(data, messageId, title, body);
        }
    }

    private void showNotification(Map<String, String> data, String messageId, String title, String body) {
        Context context = getApplicationContext();
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(new NotificationChannel(
                FCMModernCore.CHANNEL_ID, FCMModernCore.CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT));
        }

        Intent tap = new Intent(context, FCMModernTapActivity.class);
        for (Map.Entry<String, String> entry : data.entrySet()) {
            if (FCMModernTapActivity.EXTRA_MESSAGE_ID.equals(entry.getKey())) {
                // Sender data can never forge the trusted tap id.
                continue;
            }
            tap.putExtra(entry.getKey(), entry.getValue());
        }
        if (messageId != null) {
            tap.putExtra(FCMModernTapActivity.EXTRA_MESSAGE_ID, messageId);
        }
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pending = PendingIntent.getActivity(context,
            messageId == null ? 0 : messageId.hashCode(), tap, flags);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(context, FCMModernCore.CHANNEL_ID)
            : new Notification.Builder(context);
        builder.setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(context.getApplicationInfo().icon)
            .setContentIntent(pending)
            .setAutoCancel(true);
        manager.notify(messageId == null ? 12345 : messageId.hashCode(), builder.build());
    }
}
