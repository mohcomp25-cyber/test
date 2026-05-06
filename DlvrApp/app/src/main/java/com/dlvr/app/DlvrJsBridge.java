package com.dlvr.app;

import android.webkit.JavascriptInterface;

/**
 * JavaScript ⇄ Java bridge.
 *
 * Exposed to the WebView as the global `Android` object. All methods are
 * thread-safe (forwarded to Activity handlers / volatile state in the
 * UsbCameraManager).
 */
public class DlvrJsBridge {
    private final MainActivity activity;

    public DlvrJsBridge(MainActivity activity) {
        this.activity = activity;
    }

    // ─── Discovery ───

    @JavascriptInterface
    public boolean isUsbCameraAvailable() {
        return activity.isUsbCameraAvailable();
    }

    /** JSON list: [{deviceId, label, vendorId, productId, kind}]. */
    @JavascriptInterface
    public String getCameraList() {
        return activity.getUsbCameraListJson();
    }

    // ─── Lifecycle ───

    @JavascriptInterface
    public void startCamera(String deviceId) {
        activity.startUsbCamera(deviceId);
    }

    @JavascriptInterface
    public void stopCamera() {
        activity.stopUsbCamera();
    }

    // ─── Capture (single-frame) ───

    /**
     * Snapshot the current preview frame as base64 JPEG.
     * @param maxWidth target maximum width (0 = native)
     * @param quality JPEG quality 0-100
     */
    @JavascriptInterface
    public String captureFrame(int maxWidth, int quality) {
        return activity.captureFrame(maxWidth, quality);
    }

    // ─── Resolution control ───

    /** JSON list of supported resolutions: [{width, height, fps, label}]. */
    @JavascriptInterface
    public String getResolutionList() {
        return activity.getResolutionListJson();
    }

    /** Active camera info: {width, height, fps, streaming, label}. */
    @JavascriptInterface
    public String getCameraInfo() {
        return activity.getCameraInfoJson();
    }

    /**
     * Apply a resolution while the camera is streaming (hot-swap).
     * @return true on success
     */
    @JavascriptInterface
    public boolean setResolution(int width, int height, int fps) {
        return activity.setResolution(width, height, fps);
    }

    /**
     * Set quality preset to use on next start. Valid values:
     *   AUTO_BEST | UHD_4K_30 | QHD_1440_30 | FHD_1080_60 |
     *   FHD_1080_30 | HD_720_60 | HD_720_30 | SD_480_30
     */
    @JavascriptInterface
    public void setQualityPreset(String preset) {
        activity.setQualityPreset(preset);
    }
}
