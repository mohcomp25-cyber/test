package com.dlvr.app;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.appcompat.app.AppCompatActivity;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;

public class MainActivity extends AppCompatActivity implements UsbCameraManager.FrameCallback {
    private static final String TAG = "DLVR";

    private WebView webView;
    private UsbCameraManager usbCamera;
    private String shimScript = null;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // Full screen
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);

        // USB Camera Manager
        usbCamera = new UsbCameraManager(this, this);

        // Load shim script from assets
        shimScript = loadAsset("www/camera-shim.js");

        // WebView setup
        webView = findViewById(R.id.webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // JS Bridge
        webView.addJavascriptInterface(new DlvrJsBridge(this), "Android");

        // WebView Client — inject shim before page JS runs
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (shimScript != null) {
                    view.evaluateJavascript(shimScript, null);
                    Log.d(TAG, "Camera shim injected");
                }
            }
        });

        // Chrome Client — handle camera permission requests from WebView
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }
        });

        // Load the web app
        webView.loadUrl("file:///android_asset/www/index.html");

        // Handle USB intent if app was launched by USB attach
        handleUsbIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleUsbIntent(intent);
    }

    private void handleUsbIntent(Intent intent) {
        if (intent != null && "android.hardware.usb.action.USB_DEVICE_ATTACHED".equals(intent.getAction())) {
            Log.d(TAG, "USB device attached via intent");
            // Notify WebView about new device
            runOnUiThread(() -> {
                if (webView != null) {
                    webView.evaluateJavascript("if(window._notifyDeviceChange)window._notifyDeviceChange()", null);
                }
            });
        }
    }

    // === Called from DlvrJsBridge ===

    public boolean isUsbCameraAvailable() {
        return usbCamera.isUsbCameraAvailable();
    }

    public void startUsbCamera(String deviceId) {
        runOnUiThread(() -> usbCamera.startCamera(deviceId));
    }

    public String getUsbCameraListJson() {
        return usbCamera.getCameraListJson();
    }

    public void stopUsbCamera() {
        runOnUiThread(() -> usbCamera.stopCamera());
    }

    // === UsbCameraManager.FrameCallback ===

    @Override
    public void onFrame(String base64Jpeg) {
        // Push frame to WebView — already on main thread
        if (webView != null) {
            webView.evaluateJavascript(
                    "if(window._nativeFrame)window._nativeFrame('" + base64Jpeg + "')", null);
        }
    }

    @Override
    public void onCameraReady() {
        Log.d(TAG, "USB camera ready, notifying WebView");
        if (webView != null) {
            webView.evaluateJavascript(
                    "if(window._nativeUsbReady)window._nativeUsbReady()", null);
        }
    }

    @Override
    public void onCameraDisconnected() {
        Log.d(TAG, "USB camera disconnected, notifying WebView");
        if (webView != null) {
            webView.evaluateJavascript(
                    "if(window._nativeUsbDisconnected)window._nativeUsbDisconnected()", null);
        }
    }

    // === Lifecycle ===

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (usbCamera != null) {
            usbCamera.destroy();
        }
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }

    // === Helpers ===

    private String loadAsset(String path) {
        try {
            InputStream is = getAssets().open(path);
            BufferedReader reader = new BufferedReader(new InputStreamReader(is));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line).append("\n");
            }
            reader.close();
            return sb.toString();
        } catch (IOException e) {
            Log.e(TAG, "Failed to load asset: " + path, e);
            return null;
        }
    }
}
