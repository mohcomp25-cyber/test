package com.dlvr.app;

import android.webkit.JavascriptInterface;

public class DlvrJsBridge {
    private final MainActivity activity;

    public DlvrJsBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public boolean isUsbCameraAvailable() {
        return activity.isUsbCameraAvailable();
    }

    @JavascriptInterface
    public void startCamera(String deviceId) {
        activity.startUsbCamera(deviceId);
    }

    @JavascriptInterface
    public String getCameraList() {
        return activity.getUsbCameraListJson();
    }

    @JavascriptInterface
    public void stopCamera() {
        activity.stopUsbCamera();
    }
}
