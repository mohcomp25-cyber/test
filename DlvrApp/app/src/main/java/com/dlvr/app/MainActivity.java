package com.dlvr.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.SurfaceTexture;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.util.Log;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;

/**
 * DLVR Main Activity — Enterprise-grade implementation.
 *
 * Architecture:
 *   FrameLayout
 *   ├─ AspectRatioTextureView  (back, hardware-accelerated camera preview)
 *   └─ WebView                 (front, transparent — UI overlay only)
 *
 * Lifecycle:
 *   onCreate  → setup + load HTML
 *   onResume  → reattach camera if was active
 *   onPause   → stop camera (release USB)
 *   onDestroy → cleanup all resources
 *
 * Performance:
 *   - WebView hardware layer
 *   - TextureView GPU rendering
 *   - WakeLock keeps screen on while camera active
 */
public class MainActivity extends AppCompatActivity implements UsbCameraManager.FrameCallback {
    private static final String TAG = "DLVR";
    private static final int CAMERA_PERMISSION_CODE = 100;

    private WebView webView;
    private AspectRatioTextureView cameraTexture;
    private UsbCameraManager usbCamera;
    private String shimScript = null;
    private Surface previewSurface;
    private boolean surfaceReady = false;
    private boolean cameraStartPending = false;
    private String pendingDeviceId = null;
    private boolean wakeLockEnabled = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Lock orientation to portrait for consistent UX
        // (remove this line if you want auto-rotation)
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_USER);

        setContentView(R.layout.activity_main);

        // Edge-to-edge fullscreen
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }

        // Camera permission
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                    new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_CODE);
        }

        usbCamera = new UsbCameraManager(this, this);

        // Setup TextureView for hardware-accelerated USB camera preview
        cameraTexture = findViewById(R.id.cameraTexture);
        cameraTexture.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
            @Override
            public void onSurfaceTextureAvailable(SurfaceTexture st, int width, int height) {
                Log.d(TAG, "TextureView surface available: " + width + "x" + height);
                previewSurface = new Surface(st);
                surfaceReady = true;
                usbCamera.setPreviewSurface(previewSurface);
                if (cameraStartPending) {
                    cameraStartPending = false;
                    usbCamera.startCamera(pendingDeviceId);
                }
            }
            @Override
            public void onSurfaceTextureSizeChanged(SurfaceTexture st, int width, int height) {}
            @Override
            public boolean onSurfaceTextureDestroyed(SurfaceTexture st) {
                surfaceReady = false;
                if (previewSurface != null) {
                    previewSurface.release();
                    previewSurface = null;
                }
                usbCamera.setPreviewSurface(null);
                return true;
            }
            @Override
            public void onSurfaceTextureUpdated(SurfaceTexture st) {}
        });

        // Hide TextureView until USB camera is active
        cameraTexture.setVisibility(View.GONE);

        // Load JS shim
        shimScript = loadAsset("www/camera-shim.js");

        // WebView with hardware-accelerated transparent rendering
        webView = findViewById(R.id.webView);
        webView.setBackgroundColor(Color.TRANSPARENT);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setDatabaseEnabled(true);
        settings.setOffscreenPreRaster(true);  // smoother scrolling
        settings.setRenderPriority(WebSettings.RenderPriority.HIGH);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        webView.addJavascriptInterface(new DlvrJsBridge(this), "Android");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (shimScript != null) {
                    view.evaluateJavascript(shimScript, null);
                    Log.d(TAG, "Camera shim injected");
                }
            }
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                Log.d(TAG, "Page loaded: " + url);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }
            @Override
            public boolean onConsoleMessage(android.webkit.ConsoleMessage cm) {
                Log.d("DLVR-WEB", cm.message() + " [" + cm.sourceId() + ":" + cm.lineNumber() + "]");
                return true;
            }
        });

        webView.loadUrl("file:///android_asset/www/index.html");
    }

    // ─── Lifecycle ───
    @Override
    protected void onResume() {
        super.onResume();
        Log.d(TAG, "onResume");
        // Re-apply fullscreen on resume
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    protected void onPause() {
        super.onPause();
        Log.d(TAG, "onPause");
        // Note: we keep camera running because the user may briefly switch apps.
        // Stop only on onDestroy. If you want strict pause, uncomment:
        // if (usbCamera != null) usbCamera.stopCamera();
    }

    // ─── Wake lock helper ───
    private void setKeepScreenOn(boolean keep) {
        runOnUiThread(() -> {
            if (keep && !wakeLockEnabled) {
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                wakeLockEnabled = true;
            } else if (!keep && wakeLockEnabled) {
                getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                wakeLockEnabled = false;
            }
        });
    }

    // ─── Called from JS Bridge ───
    public boolean isUsbCameraAvailable() {
        return usbCamera.isUsbCameraAvailable();
    }

    public void startUsbCamera(String deviceId) {
        runOnUiThread(() -> {
            cameraTexture.setVisibility(View.VISIBLE);
            if (!surfaceReady) {
                cameraStartPending = true;
                pendingDeviceId = deviceId;
                return;
            }
            usbCamera.startCamera(deviceId);
        });
    }

    public String getUsbCameraListJson() {
        return usbCamera.getCameraListJson();
    }

    public String getResolutionListJson() {
        return usbCamera.getResolutionListJson();
    }

    public String getCameraInfoJson() {
        return usbCamera.getCameraInfoJson();
    }

    public boolean setResolution(int width, int height, int fps) {
        return usbCamera.applyResolutionLive(width, height, fps);
    }

    public void setQualityPreset(String presetName) {
        try {
            UsbCameraManager.QualityPreset p =
                UsbCameraManager.QualityPreset.valueOf(presetName);
            usbCamera.setQualityPreset(p);
        } catch (Exception e) {
            Log.w(TAG, "Unknown preset: " + presetName);
        }
    }

    public void stopUsbCamera() {
        runOnUiThread(() -> {
            usbCamera.stopCamera();
            cameraTexture.setVisibility(View.GONE);
            setKeepScreenOn(false);
        });
    }

    /**
     * Capture the current frame as base64 JPEG.
     * Reads the bitmap directly from GPU at the camera's native resolution
     * for maximum quality.
     */
    public String captureFrame(int maxWidth, int quality) {
        try {
            if (cameraTexture == null || !surfaceReady) return "";

            // Get camera's native resolution (prefer over view dimensions for max quality)
            int sourceW = 1920, sourceH = 1080;
            int[] camSize = usbCamera.getActivePreviewSize();
            if (camSize != null && camSize[0] > 0 && camSize[1] > 0) {
                sourceW = camSize[0];
                sourceH = camSize[1];
            }

            // Pull bitmap from GPU at native resolution
            Bitmap bitmap = cameraTexture.getBitmap(sourceW, sourceH);
            if (bitmap == null) {
                bitmap = cameraTexture.getBitmap();
                if (bitmap == null) {
                    Log.w(TAG, "captureFrame: getBitmap returned null");
                    return "";
                }
            }

            // Resize if requested (using high-quality bilinear filtering)
            if (maxWidth > 0 && bitmap.getWidth() > maxWidth) {
                int newW = maxWidth;
                int newH = (int) ((long) bitmap.getHeight() * maxWidth / bitmap.getWidth());
                Bitmap scaled = Bitmap.createScaledBitmap(bitmap, newW, newH, true);
                bitmap.recycle();
                bitmap = scaled;
            }

            ByteArrayOutputStream out = new ByteArrayOutputStream(256 * 1024);
            bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out);
            int finalW = bitmap.getWidth();
            int finalH = bitmap.getHeight();
            bitmap.recycle();

            byte[] bytes = out.toByteArray();
            Log.d(TAG, "captureFrame: " + finalW + "x" + finalH + ", " + bytes.length + " bytes");
            return Base64.encodeToString(bytes, Base64.NO_WRAP);
        } catch (Exception e) {
            Log.e(TAG, "captureFrame error", e);
            return "";
        }
    }

    // ─── UsbCameraManager.FrameCallback ───
    @Override
    public void onCameraReady() {
        Log.d(TAG, "Camera ready");
        runOnUiThread(() -> {
            // Update TextureView aspect ratio to match the camera
            int[] camSize = usbCamera.getActivePreviewSize();
            if (camSize != null) {
                cameraTexture.setAspectRatio(camSize[0], camSize[1]);
            }
            cameraTexture.setVisibility(View.VISIBLE);
            setKeepScreenOn(true);
            if (webView != null) {
                webView.evaluateJavascript("if(window._nativeUsbReady)window._nativeUsbReady()", null);
            }
        });
    }

    @Override
    public void onCameraDisconnected() {
        Log.d(TAG, "Camera disconnected");
        runOnUiThread(() -> {
            setKeepScreenOn(false);
            if (webView != null) {
                webView.evaluateJavascript("if(window._nativeUsbDisconnected)window._nativeUsbDisconnected()", null);
            }
        });
    }

    @Override
    public void onActiveResolutionChanged(int width, int height, int fps) {
        Log.d(TAG, "Resolution changed: " + width + "x" + height + "@" + fps);
        runOnUiThread(() -> {
            cameraTexture.setAspectRatio(width, height);
            if (webView != null) {
                String js = "if(window._nativeResolutionChanged)window._nativeResolutionChanged("
                        + width + "," + height + "," + fps + ")";
                webView.evaluateJavascript(js, null);
            }
        });
    }

    @Override
    public void onResolutionsAvailable(java.util.List<int[]> sizes) {
        Log.d(TAG, "Resolutions available: " + sizes.size());
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript(
                    "if(window._nativeResolutionsAvailable)window._nativeResolutionsAvailable()", null);
            }
        });
    }

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
        if (usbCamera != null) usbCamera.destroy();
        if (webView != null) webView.destroy();
        if (previewSurface != null) {
            previewSurface.release();
            previewSurface = null;
        }
        super.onDestroy();
    }

    private String loadAsset(String path) {
        try (InputStream is = getAssets().open(path);
             BufferedReader reader = new BufferedReader(new InputStreamReader(is))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line).append('\n');
            }
            return sb.toString();
        } catch (IOException e) {
            Log.e(TAG, "Failed to load asset: " + path, e);
            return null;
        }
    }
}
