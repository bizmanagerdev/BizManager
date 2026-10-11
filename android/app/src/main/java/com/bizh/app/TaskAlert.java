package com.bizh.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.util.Map;

/**
 * A task alert with buttons (APK 1.2; owner, 2026-10-11: "buttons on alerts … we
 * need it for tasks"). The server sends phones on 1.2 and up a data push
 * {type:"task_alert", title, body, url, tag, taskId} for every alert about a task
 * (a reminder, a task that's back from "לטיפול בהמשך", a new task), and it's
 * shown here instead of by Android, with three buttons:
 *
 *   בוצע            marks the task done
 *   לטיפול מחר      "לטיפול בהמשך" until tomorrow 08:00 (Israel)
 *   פתיחה           opens the task in the app
 *
 * The first two work from the notification itself, without opening the app
 * (TaskActionReceiver). Older APKs get the plain alert, as before.
 */
final class TaskAlert {

    /** The website creates this channel too (lib/native-push.ts); same id, same settings. */
    static final String CHANNEL_ID = "bizh_alerts";

    static final String ACTION_DONE = "com.bizh.app.TASK_DONE";
    static final String ACTION_TOMORROW = "com.bizh.app.TASK_TOMORROW";

    static final String EXTRA_TASK_ID = "taskId";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_URL = "url";
    static final String EXTRA_TAG = "tag";

    private TaskAlert() {}

    static void show(Context context, Map<String, String> data) {
        String taskId = data.get(EXTRA_TASK_ID);
        String title = text(data.get("title"), "BizH");
        String body = text(data.get("body"), "");
        String url = IncomingCall.siteUrl(data.get(EXTRA_URL));
        String tag = text(data.get(EXTRA_TAG), "task-" + text(taskId, String.valueOf(System.currentTimeMillis())));

        ensureChannel(context);
        int base = requestBase(tag);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent open = PendingIntent.getActivity(context, base, openIntent(context, url), flags);

        NotificationCompat.Builder builder = baseBuilder(context, title, body, open)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setDefaults(NotificationCompat.DEFAULT_ALL);

        if (isTaskId(taskId)) {
            builder.addAction(0, "בוצע", actionIntent(context, ACTION_DONE, base + 1, taskId, title, url, tag));
            builder.addAction(0, "לטיפול מחר", actionIntent(context, ACTION_TOMORROW, base + 2, taskId, title, url, tag));
        }
        builder.addAction(0, "פתיחה", open);

        notify(context, tag, builder);
    }

    /** While a button's change goes to the server: the same alert, buttons gone. */
    static void showSaving(Context context, String tag, String title, String url) {
        PendingIntent open = PendingIntent.getActivity(
            context,
            requestBase(tag),
            openIntent(context, url),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        notify(context, tag, baseBuilder(context, title, "שומר…", open).setOngoing(true).setSilent(true));
    }

    /**
     * The outcome of a button. Saved: a short confirmation that goes away by
     * itself. Not saved (no signal, signed out): it stays, and a tap opens the task
     * so it can be done in the app (which also keeps saves made offline).
     */
    static void showResult(Context context, String tag, String title, String url, boolean saved, String text) {
        PendingIntent open = PendingIntent.getActivity(
            context,
            requestBase(tag),
            openIntent(context, url),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        NotificationCompat.Builder builder = baseBuilder(context, title, text, open).setSilent(true);
        if (saved) builder.setTimeoutAfter(4000);
        notify(context, tag, builder);
    }

    private static NotificationCompat.Builder baseBuilder(Context context, String title, String body, PendingIntent open) {
        return new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_bizh)
            .setColor(ContextCompat.getColor(context, R.color.bizh_secondary))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open);
    }

    private static PendingIntent actionIntent(
        Context context,
        String action,
        int requestCode,
        String taskId,
        String title,
        String url,
        String tag
    ) {
        Intent intent = new Intent(context, TaskActionReceiver.class)
            .setAction(action)
            .putExtra(EXTRA_TASK_ID, taskId)
            .putExtra(EXTRA_TITLE, title)
            .putExtra(EXTRA_URL, url)
            .putExtra(EXTRA_TAG, tag);
        return PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static Intent openIntent(Context context, String url) {
        return new Intent(context, MainActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .setData(Uri.parse(IncomingCall.siteUrl(url)))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }

    private static void notify(Context context, String tag, NotificationCompat.Builder builder) {
        try {
            // Tag + id 0, as Android does for a pushed alert with a tag: the next
            // alert of the same kind replaces this one.
            NotificationManagerCompat.from(context).notify(tag, 0, builder.build());
        } catch (SecurityException e) {
            // Notifications not allowed on this phone.
        }
    }

    /**
     * The website makes this channel on the app's first open; a push can come
     * before that (installed, never opened), and Android drops an alert on a
     * channel that doesn't exist.
     */
    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "התראות BizH", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("התראות עסקיות מ-BizManager");
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
    }

    /** Request codes for one alert's pending intents: base, base+1, base+2. */
    private static int requestBase(String tag) {
        return 0x3A00_0000 | ((tag.hashCode() & 0x003F_FFFF) << 2);
    }

    static boolean isTaskId(String id) {
        return id != null && id.matches("[0-9a-fA-F-]{36}");
    }

    private static String text(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value;
    }
}
