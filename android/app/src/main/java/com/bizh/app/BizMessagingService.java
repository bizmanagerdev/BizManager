package com.bizh.app;

import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * The app's push receiver: the push plugin's own, plus calls and task alerts. A
 * data push of type "incoming_call" rings the phone (IncomingCall), even when the
 * app is closed; "call_ended" stops it; "task_alert" is an alert about a task,
 * shown with its buttons (TaskAlert, APK 1.2). Everything else goes to the push
 * plugin as before.
 * Replaces the plugin's service in AndroidManifest.xml (Android delivers each push
 * to one receiver only).
 */
public class BizMessagingService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String type = data.get("type");
        if ("incoming_call".equals(type)) {
            IncomingCall.show(this, data);
            return;
        }
        if ("call_ended".equals(type)) {
            IncomingCall.cancel(this, data.get(IncomingCall.EXTRA_CALL_ID));
            return;
        }
        if ("task_alert".equals(type)) {
            TaskAlert.show(this, data);
            return;
        }
        super.onMessageReceived(remoteMessage);
    }
}
