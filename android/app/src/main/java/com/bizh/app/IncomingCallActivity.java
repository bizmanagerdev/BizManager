package com.bizh.app;

import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

/**
 * The full-screen ringing call (IncomingCall): the caller's name, number and
 * details, with Answer and Decline. Shows over the lock screen and turns the
 * screen on. Answer opens the call's page in the app; the screen closes by itself
 * when the call ends elsewhere ("call_ended" push, BizHNative.endIncomingCall).
 */
public class IncomingCallActivity extends AppCompatActivity {

    private String callId;
    private String url;
    private boolean receiverRegistered = false;

    private final BroadcastReceiver endedReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String ended = intent.getStringExtra(IncomingCall.EXTRA_CALL_ID);
            if (ended == null || ended.equals(callId)) finish();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        showOverLockScreen();
        readCall(getIntent());

        if (IncomingCall.ACTION_ANSWER.equals(getIntent().getAction())) {
            answer();
            return;
        }

        setContentView(R.layout.activity_incoming_call);
        bindViews(getIntent());
        findViewById(R.id.call_answer).setOnClickListener(v -> answer());
        findViewById(R.id.call_decline).setOnClickListener(v -> decline());

        ContextCompat.registerReceiver(this, endedReceiver, new IntentFilter(IncomingCall.ACTION_ENDED), ContextCompat.RECEIVER_NOT_EXPORTED);
        receiverRegistered = true;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        readCall(intent);
        if (IncomingCall.ACTION_ANSWER.equals(intent.getAction())) {
            answer();
        } else if (findViewById(R.id.call_name) != null) {
            bindViews(intent);
        }
    }

    private void readCall(Intent intent) {
        callId = intent.getStringExtra(IncomingCall.EXTRA_CALL_ID);
        url = intent.getStringExtra(IncomingCall.EXTRA_URL);
    }

    private void bindViews(Intent intent) {
        ((TextView) findViewById(R.id.call_name)).setText(intent.getStringExtra(IncomingCall.EXTRA_NAME));
        setOptional(R.id.call_number, intent.getStringExtra(IncomingCall.EXTRA_NUMBER));
        setOptional(R.id.call_details, intent.getStringExtra(IncomingCall.EXTRA_DETAILS));
    }

    private void setOptional(int id, String value) {
        TextView view = findViewById(id);
        if (TextUtils.isEmpty(value)) {
            view.setVisibility(View.GONE);
        } else {
            view.setText(value);
            view.setVisibility(View.VISIBLE);
        }
    }

    private void answer() {
        IncomingCall.cancel(this, callId);
        Intent open = IncomingCall.answerIntent(this, url);
        KeyguardManager keyguard = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && keyguard != null && keyguard.isKeyguardLocked()) {
            // Ask the user to unlock first, then open the call's page.
            keyguard.requestDismissKeyguard(
                this,
                new KeyguardManager.KeyguardDismissCallback() {
                    @Override
                    public void onDismissSucceeded() {
                        startActivity(open);
                        finish();
                    }

                    @Override
                    public void onDismissCancelled() {
                        finish();
                    }
                }
            );
        } else {
            startActivity(open);
            finish();
        }
    }

    private void decline() {
        IncomingCall.cancel(this, callId);
        finish();
    }

    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    @Override
    protected void onDestroy() {
        if (receiverRegistered) {
            unregisterReceiver(endedReceiver);
            receiverRegistered = false;
        }
        super.onDestroy();
    }
}
