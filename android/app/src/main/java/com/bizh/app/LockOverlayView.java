package com.bizh.app;

import android.content.Context;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.core.content.ContextCompat;

/**
 * The app lock's cover (APK 1.2): the opening screen's light blue and big
 * chevron, "BizH נעולה", and a "פתיחה" button that asks for the fingerprint (or
 * the phone's own PIN) again after a cancel. It hides the page behind it and
 * swallows every touch until MainActivity removes it.
 */
final class LockOverlayView extends FrameLayout {

    LockOverlayView(Context context, Runnable onUnlockTap) {
        super(context);
        setBackgroundColor(ContextCompat.getColor(context, R.color.bizh_board));
        setClickable(true);
        setFocusable(true);

        LinearLayout column = new LinearLayout(context);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setGravity(Gravity.CENTER_HORIZONTAL);

        ImageView mark = new ImageView(context);
        mark.setImageResource(R.drawable.splash_mark);
        mark.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
        column.addView(mark, new LinearLayout.LayoutParams(dp(192), dp(192)));

        TextView title = new TextView(context);
        title.setText("BizH נעולה");
        title.setTextColor(ContextCompat.getColor(context, R.color.bizh_primary));
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);
        column.addView(title, wrap(0));

        TextView hint = new TextView(context);
        hint.setText("פתיחה בטביעת אצבע או בקוד הטלפון");
        hint.setTextColor(ContextCompat.getColor(context, R.color.bizh_primary));
        hint.setAlpha(0.7f);
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        hint.setGravity(Gravity.CENTER);
        column.addView(hint, wrap(dp(6)));

        TextView button = new TextView(context);
        button.setText("פתיחה");
        button.setTextColor(ContextCompat.getColor(context, R.color.bizh_white));
        button.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setGravity(Gravity.CENTER);
        button.setPadding(dp(40), dp(12), dp(40), dp(12));
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(ContextCompat.getColor(context, R.color.bizh_secondary));
        shape.setCornerRadius(dp(12));
        button.setBackground(shape);
        button.setClickable(true);
        button.setFocusable(true);
        button.setOnClickListener(v -> onUnlockTap.run());
        column.addView(button, wrap(dp(28)));

        addView(column, new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER));
    }

    private LinearLayout.LayoutParams wrap(int topMargin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        params.topMargin = topMargin;
        return params;
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
