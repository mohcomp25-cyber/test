package com.dlvr.app;

import android.content.Context;
import android.util.AttributeSet;
import android.view.TextureView;

/**
 * A TextureView that maintains a specific aspect ratio.
 * Used to display the camera preview without stretching, matching the camera's
 * native resolution (e.g. 16:9 for 1920x1080) regardless of the parent's size.
 *
 * Behavior: scales to fill the parent's smaller dimension, leaving letterbox
 * margins on the larger dimension. This is the same approach commercial USB
 * camera apps use for crisp, undistorted preview.
 */
public class AspectRatioTextureView extends TextureView {
    private float aspectRatio = 16f / 9f; // default 16:9

    public AspectRatioTextureView(Context context) { super(context); }
    public AspectRatioTextureView(Context context, AttributeSet attrs) { super(context, attrs); }
    public AspectRatioTextureView(Context context, AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);
    }

    /**
     * Set the camera's aspect ratio (width / height).
     * Triggers a re-layout to apply the new ratio.
     */
    public void setAspectRatio(int width, int height) {
        if (width <= 0 || height <= 0) return;
        float newRatio = (float) width / (float) height;
        if (Math.abs(aspectRatio - newRatio) < 0.001f) return;
        aspectRatio = newRatio;
        requestLayout();
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        super.onMeasure(widthMeasureSpec, heightMeasureSpec);
        int parentW = MeasureSpec.getSize(widthMeasureSpec);
        int parentH = MeasureSpec.getSize(heightMeasureSpec);

        if (parentW == 0 || parentH == 0) {
            setMeasuredDimension(parentW, parentH);
            return;
        }

        float parentRatio = (float) parentW / (float) parentH;
        int finalW, finalH;

        // Fit-fill mode: cover the parent area without distortion (may crop)
        // For preview, we want to FILL the available space, scaling proportionally.
        // If camera is wider than parent → fit by height (crop sides)
        // If camera is taller than parent → fit by width (crop top/bottom)
        if (aspectRatio > parentRatio) {
            // Camera wider — fit height
            finalH = parentH;
            finalW = (int) (parentH * aspectRatio);
        } else {
            // Camera taller — fit width
            finalW = parentW;
            finalH = (int) (parentW / aspectRatio);
        }

        setMeasuredDimension(finalW, finalH);
    }
}
