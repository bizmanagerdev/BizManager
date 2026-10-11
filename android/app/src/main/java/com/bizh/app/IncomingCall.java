package com.bizh.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.Bundle;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.content.ContextCompat;
import java.util.Map;

/**
 * A call to the business number, ringing in the app like a real phone call: a
 * full-screen call screen over the lock screen (IncomingCallActivity), or a
 * ringing call notification with Answer / Decline when the phone is in use.
 *
 * Works with whichever phone company is connected one day (card "connect phone
 * system and dial from here"): the server sends the phone a data push
 *   { type: "incoming_call", callId, callerName, callerNumber, details, url }
 * and later { type: "call_ended", callId } (BizMessagingService). "Answer" opens
 * `url` in the app (for example the caller's customer page). The website can also
 * ring it directly through BizHNative.showIncomingCall.
 */
final class IncomingCall {

    static final String CHANNEL_ID = "bizh_calls";
    static final String ACTION_ANSWER = "com.bizh.app.CALL_ANSWER";
    static final String ACTION_DECLINE = "com.bizh.app.CALL_DECLINE";
    static final String ACTION_ENDED = "com.bizh.app.CALL_ENDED";

    static final String EXTRA_CALL_ID = "callId";
    static final String EXTRA_NAME = "callerName";
    static final String EXTRA_NUMBER = "callerNumber";
    static final String EXTRA_DETAILS = "details";
    static final String EXTRA_URL = "url";

    /** Ring this long at most, then the notification goes away by itself. */
    private static final long RING_MS = 45_000;

    private static String lastCallId;

    private IncomingCall() {}

    static void show(Context context, Map<String, String> data) {
        String callId = text(data.get(EXTRA_CALL_ID), String.valueOf(System.currentTimeMillis()));
        String number = data.get(EXTRA_NUMBER);
        String name = text(data.get(EXTRA_NAME), text(number, "שיחה נכנסת"));
        String details = data.get(EXTRA_DETAILS);
        String url = siteUrl(data.get(EXTRA_URL));
        lastCallId = callId;

        ensureChannel(context);
        int id = notificationId(callId);

        Bundle extras = new Bundle();
        extras.putString(EXTRA_CALL_ID, callId);
        extras.putString(EXTRA_NAME, name);
        extras.putString(EXTRA_NUMBER, number);
        extras.putString(EXTRA_DETAILS, details);
        extras.putString(EXTRA_URL, url);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent fullScreen = PendingIntent.getActivity(
            context,
            id * 3,
            new Intent(context, IncomingCallActivity.class).putExtras(extras).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION),
            flags
        );
        PendingIntent answer = PendingIntent.getActivity(
            context,
            id * 3 + 1,
            new Intent(context, IncomingCallActivity.class).setAction(ACTION_ANSWER).putExtras(extras).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            flags
        );
        PendingIntent decline = PendingIntent.getBroadcast(
            context,
            id * 3 + 2,
            new Intent(context, CallActionReceiver.class).setAction(ACTION_DECLINE).putExtra(EXTRA_CALL_ID, callId),
            flags
        );

        Person caller = new Person.Builder().setName(name).setImportant(true).build();
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_bizh)
            .setColor(ContextCompat.getColor(context, R.color.bizh_secondary))
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer))
            .setContentText(text(details, text(number, "שיחה למספר העסק")))
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setContentIntent(fullScreen)
            .setFullScreenIntent(fullScreen, true)
            .setTimeoutAfter(RING_MS);

        Notification notification = builder.build();
        // Keep ringing until it's answered, declined or the call ends.
        notification.flags |= Notification.FLAG_INSISTENT;

        try {
            NotificationManagerCompat.from(context).notify(id, notification);
        } catch (SecurityException e) {
            // Notifications not allowed on this phone: nothing can ring.
        }
    }

    /** Stop ringing and close the call screen. A null id means the last call. */
    static void cancel(Context context, String callId) {
        String id = callId != null ? callId : lastCallId;
        if (id == null) return;
        NotificationManagerCompat.from(context).cancel(notificationId(id));
        context.sendBroadcast(new Intent(ACTION_ENDED).setPackage(context.getPackageName()).putExtra(EXTRA_CALL_ID, id));
    }

    /** Open the call's page in the app. */
    static Intent answerIntent(Context context, String url) {
        return new Intent(context, MainActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .setData(android.net.Uri.parse(siteUrl(url)))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "שיחות נכנסות", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("שיחות למספר העסק מצלצלות באפליקציה");
        channel.setSound(
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
            new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        );
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] { 0, 1000, 1000 });
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(channel);
    }

    /** Only pages of the site itself; anything else opens the dashboard. */
    static String siteUrl(String url) {
        if (url == null || url.isEmpty()) return MainActivity.SITE_ORIGIN + "/dashboard";
        if (url.startsWith("/") && !url.startsWith("//")) return MainActivity.SITE_ORIGIN + url;
        if (url.startsWith(MainActivity.SITE_ORIGIN + "/")) return url;
        return MainActivity.SITE_ORIGIN + "/dashboard";
    }

    private static int notificationId(String callId) {
        return 0x5A00_0000 | (callId.hashCode() & 0x00FF_FFFF);
    }

    private static String text(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value;
    }
}
