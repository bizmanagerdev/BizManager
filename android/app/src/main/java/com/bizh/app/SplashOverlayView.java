package com.bizh.app;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Shader;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.LinearInterpolator;
import androidx.core.content.ContextCompat;

/**
 * The opening screen's own layer (owner's pick, 2026-10-11): the phone
 * dashboard's light blue, its small chevrons going up, and one big blue chevron
 * in the middle with no circle around it.
 *
 * Android draws the first moment itself from the launch theme (the colour and the
 * big chevron only; it can't draw a pattern). This view is laid over the whole
 * window with the big chevron at exactly the same size and place, so when
 * Android's part is removed nothing moves; then the small chevrons fade in and
 * rise until the dashboard has drawn and the view fades away.
 */
final class SplashOverlayView extends View {

    /** The big chevron's width. Same as drawable/splash_mark.xml (120dp on its 288dp canvas). */
    private static final float BIG_MARK_DP = 120f;

    /**
     * The dashboard's texture tile (--board-texture in app/globals.css): 62px wide,
     * the mark inside a padded 156 x 141 viewBox starting at (-28, -25).
     */
    private static final float TILE_DP = 62f;
    private static final float TILE_VIEW_W = 156f;
    private static final float TILE_VIEW_H = 141f;
    private static final float TILE_PAD_X = 28f;
    private static final float TILE_PAD_Y = 25f;

    /** One tile's climb: slow enough to read as drifting, not scrolling. */
    private static final long RISE_MS = 2800;
    private static final long CHEVRONS_IN_MS = 420;
    private static final long FADE_OUT_MS = 220;

    private final Path mark = BrandMark.create();
    private final Paint bigPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint tilePaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final Matrix tileMatrix = new Matrix();
    private final float density;
    private final float tileHeightPx;

    private Bitmap tileBitmap;
    private float rise = 0f;
    private float chevronsAlpha = 0f;
    private ValueAnimator riseAnimator;
    private boolean leaving = false;

    SplashOverlayView(Context context) {
        super(context);
        density = getResources().getDisplayMetrics().density;
        // Whole pixels, so one climb of the animation ends exactly where the next tile
        // begins and the loop has no visible hop.
        tileHeightPx = Math.max(1, Math.round(TILE_DP * density * TILE_VIEW_H / TILE_VIEW_W));
        setBackgroundColor(ContextCompat.getColor(context, R.color.bizh_board));
        bigPaint.setColor(ContextCompat.getColor(context, R.color.bizh_secondary));
        bigPaint.setStyle(Paint.Style.FILL);
        setClickable(true); // swallow taps while it covers the page
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    }

    /** Called once Android's own part is gone: the small chevrons join and start rising. */
    void startChevrons() {
        ValueAnimator in = ValueAnimator.ofFloat(0f, 1f);
        in.setDuration(CHEVRONS_IN_MS);
        in.addUpdateListener(a -> {
            chevronsAlpha = (float) a.getAnimatedValue();
            invalidate();
        });
        in.start();

        riseAnimator = ValueAnimator.ofFloat(0f, tileHeightPx);
        riseAnimator.setDuration(RISE_MS);
        riseAnimator.setInterpolator(new LinearInterpolator());
        riseAnimator.setRepeatCount(ValueAnimator.INFINITE);
        riseAnimator.addUpdateListener(a -> {
            rise = (float) a.getAnimatedValue();
            invalidate();
        });
        riseAnimator.start();
    }

    /** Fade out and take the view away. Safe to call more than once. */
    void dismiss() {
        if (leaving) return;
        leaving = true;
        animate()
            .alpha(0f)
            .setDuration(FADE_OUT_MS)
            .setListener(
                new AnimatorListenerAdapter() {
                    @Override
                    public void onAnimationEnd(Animator animation) {
                        if (riseAnimator != null) riseAnimator.cancel();
                        ViewGroup parent = (ViewGroup) getParent();
                        if (parent != null) parent.removeView(SplashOverlayView.this);
                        if (tileBitmap != null) {
                            tileBitmap.recycle();
                            tileBitmap = null;
                        }
                    }
                }
            );
    }

    private Bitmap buildTile() {
        float tileW = TILE_DP * density;
        int w = Math.max(1, Math.round(tileW));
        int h = Math.max(1, Math.round(tileHeightPx));
        Bitmap bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bitmap);
        float unit = tileW / TILE_VIEW_W; // px per viewBox unit
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(ContextCompat.getColor(getContext(), R.color.bizh_board_texture));
        c.translate(TILE_PAD_X * unit, TILE_PAD_Y * unit);
        c.scale(unit, unit);
        c.drawPath(mark, p);
        return bitmap;
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int w = getWidth();
        int h = getHeight();

        if (chevronsAlpha > 0f) {
            if (tileBitmap == null) {
                tileBitmap = buildTile();
                tilePaint.setShader(new BitmapShader(tileBitmap, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT));
            }
            tileMatrix.setTranslate(0f, -rise);
            tilePaint.getShader().setLocalMatrix(tileMatrix);
            tilePaint.setAlpha(Math.round(255 * chevronsAlpha));
            canvas.drawRect(0, 0, w, h, tilePaint);
        }

        float scale = BIG_MARK_DP * density / BrandMark.WIDTH;
        canvas.save();
        canvas.translate(w / 2f - BrandMark.WIDTH * scale / 2f, h / 2f - BrandMark.HEIGHT * scale / 2f);
        canvas.scale(scale, scale);
        canvas.drawPath(mark, bigPaint);
        canvas.restore();
    }

    @Override
    protected void onDetachedFromWindow() {
        super.onDetachedFromWindow();
        if (riseAnimator != null) riseAnimator.cancel();
    }
}
