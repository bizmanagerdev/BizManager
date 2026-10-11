package com.bizh.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** "Decline" on a ringing call notification: stop ringing. */
public class CallActionReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (IncomingCall.ACTION_DECLINE.equals(intent.getAction())) {
            IncomingCall.cancel(context, intent.getStringExtra(IncomingCall.EXTRA_CALL_ID));
        }
    }
}
