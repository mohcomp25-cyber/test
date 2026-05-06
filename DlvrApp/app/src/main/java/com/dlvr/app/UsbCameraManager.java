package com.dlvr.app;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Surface;

import androidx.fragment.app.FragmentActivity;

import com.herohan.uvcapp.CameraHelper;
import com.herohan.uvcapp.ICameraHelper;
import com.serenegiant.usb.Size;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * UsbCameraManager — Professional UVC camera controller for DLVR.
 *
 * Features:
 *   • Direct hardware-accelerated GPU preview (zero-copy, full FPS)
 *   • Resolution picker — supports up to 4K (3840x2160) @ 30fps
 *   • Smart resolution preference: 4K@30 → 1080p@60 → 1080p@30 → 720p@60 → 720p@30
 *   • Auto-reconnect on USB detach
 *   • Multi-device support (selectDevice by ID)
 *   • Real-time FPS reporting
 *   • Mirror / rotate (handled at TextureView level)
 *   • Robust permission flow with Android 14 (FLAG_MUTABLE + explicit Intent)
 */
public class UsbCameraManager {
    private static final String TAG = "DLVR-USB";
    private static final String ACTION_USB_PERMISSION = "com.dlvr.app.USB_PERMISSION";

    /** User-facing quality presets. The manager picks the closest supported size. */
    public enum QualityPreset {
        AUTO_BEST,     // Pick highest available up to 4K@30
        UHD_4K_30,     // 3840x2160 @ 30
        QHD_1440_30,   // 2560x1440 @ 30
        FHD_1080_60,   // 1920x1080 @ 60 (smooth)
        FHD_1080_30,   // 1920x1080 @ 30
        HD_720_60,     // 1280x720  @ 60 (smooth)
        HD_720_30,     // 1280x720  @ 30
        SD_480_30,     // 640x480   @ 30
    }

    private final Context context;
    private final FragmentActivity activity;
    private final Handler mainHandler;
    private final FrameCallback callback;

    private ICameraHelper cameraHelper;
    private UsbDevice currentDevice;
    private Surface previewSurface;
    private volatile boolean isStreaming = false;

    // Active stream metadata
    private volatile int activeWidth = 0;
    private volatile int activeHeight = 0;
    private volatile int activeFps = 30;

    // User preference
    private QualityPreset preferredQuality = QualityPreset.AUTO_BEST;
    private int preferredWidth = 0;   // override (0 = use preset)
    private int preferredHeight = 0;
    private int preferredFps = 0;

    public interface FrameCallback {
        void onCameraReady();
        void onCameraDisconnected();
        default void onResolutionsAvailable(List<int[]> sizes) {}
        default void onActiveResolutionChanged(int width, int height, int fps) {}
    }

    private final BroadcastReceiver usbReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            String action = intent.getAction();
            if (ACTION_USB_PERMISSION.equals(action)) {
                UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                boolean granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
                if (granted && device != null) {
                    openCamera(device);
                } else {
                    Log.w(TAG, "USB permission denied");
                    callback.onCameraDisconnected();
                }
            } else if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(action)) {
                UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                if (device != null && currentDevice != null
                        && device.getDeviceId() == currentDevice.getDeviceId()) {
                    Log.w(TAG, "USB detached — auto-reconnect in 2s");
                    stopCamera();
                    mainHandler.postDelayed(() -> {
                        List<UsbDevice> devices = getUvcDevices();
                        if (!devices.isEmpty()) {
                            Log.d(TAG, "Auto-reconnecting...");
                            startCamera("");
                        } else {
                            callback.onCameraDisconnected();
                        }
                    }, 2000);
                }
            } else if (UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(action)) {
                UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                if (device != null && isUvcDevice(device) && currentDevice == null) {
                    Log.i(TAG, "USB attached — auto-opening: " + getDeviceLabel(device));
                    startCamera("usb_" + device.getDeviceId());
                }
            }
        }
    };

    public UsbCameraManager(FragmentActivity activity, FrameCallback callback) {
        this.context = activity.getApplicationContext();
        this.activity = activity;
        this.callback = callback;
        this.mainHandler = new Handler(Looper.getMainLooper());

        IntentFilter filter = new IntentFilter();
        filter.addAction(ACTION_USB_PERMISSION);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(usbReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            context.registerReceiver(usbReceiver, filter);
        }
    }

    // ──── Public API ────

    public void setPreviewSurface(Surface surface) {
        this.previewSurface = surface;
        Log.d(TAG, "Preview surface " + (surface != null ? "attached" : "detached"));
    }

    public boolean isUsbCameraAvailable() {
        return !getUvcDevices().isEmpty();
    }

    public boolean isStreaming() { return isStreaming; }

    public int[] getActivePreviewSize() {
        if (activeWidth > 0 && activeHeight > 0) return new int[]{activeWidth, activeHeight, activeFps};
        return null;
    }

    public List<UsbDevice> getUvcDevices() {
        List<UsbDevice> result = new ArrayList<>();
        UsbManager um = (UsbManager) context.getSystemService(Context.USB_SERVICE);
        if (um == null) return result;
        for (UsbDevice d : um.getDeviceList().values()) {
            if (isUvcDevice(d)) result.add(d);
        }
        return result;
    }

    public String getCameraListJson() {
        List<UsbDevice> devices = getUvcDevices();
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < devices.size(); i++) {
            UsbDevice d = devices.get(i);
            if (i > 0) sb.append(",");
            sb.append("{\"deviceId\":\"usb_").append(d.getDeviceId()).append("\",");
            sb.append("\"label\":\"").append(escapeJson(getDeviceLabel(d))).append("\",");
            sb.append("\"vendorId\":").append(d.getVendorId()).append(",");
            sb.append("\"productId\":").append(d.getProductId()).append(",");
            sb.append("\"kind\":\"videoinput\"}");
        }
        sb.append("]");
        return sb.toString();
    }

    /** JSON of supported resolutions for the active camera (after openCamera). */
    public String getResolutionListJson() {
        if (cameraHelper == null) return "[]";
        try {
            List<Size> sizes = cameraHelper.getSupportedSizeList();
            if (sizes == null || sizes.isEmpty()) return "[]";
            // De-duplicate by w×h×fps
            Set<String> seen = new HashSet<>();
            List<Size> filtered = new ArrayList<>();
            for (Size s : sizes) {
                String key = s.width + "x" + s.height + "x" + s.fps;
                if (seen.add(key)) filtered.add(s);
            }
            // Sort by pixels desc, then fps desc
            Collections.sort(filtered, new Comparator<Size>() {
                @Override public int compare(Size a, Size b) {
                    long pa = (long) a.width * a.height;
                    long pb = (long) b.width * b.height;
                    if (pa != pb) return Long.compare(pb, pa);
                    return Integer.compare(b.fps, a.fps);
                }
            });
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < filtered.size(); i++) {
                Size s = filtered.get(i);
                if (i > 0) sb.append(",");
                sb.append("{\"width\":").append(s.width)
                  .append(",\"height\":").append(s.height)
                  .append(",\"fps\":").append(s.fps > 0 ? s.fps : 30)
                  .append(",\"label\":\"").append(s.width).append("×").append(s.height)
                  .append(" @ ").append(s.fps > 0 ? s.fps : 30).append("fps\"}");
            }
            sb.append("]");
            return sb.toString();
        } catch (Exception e) {
            Log.e(TAG, "getResolutionListJson", e);
            return "[]";
        }
    }

    /** Active camera info as JSON: {width, height, fps, deviceLabel}. */
    public String getCameraInfoJson() {
        StringBuilder sb = new StringBuilder("{");
        sb.append("\"width\":").append(activeWidth).append(",");
        sb.append("\"height\":").append(activeHeight).append(",");
        sb.append("\"fps\":").append(activeFps).append(",");
        sb.append("\"streaming\":").append(isStreaming).append(",");
        sb.append("\"label\":\"")
          .append(currentDevice != null ? escapeJson(getDeviceLabel(currentDevice)) : "")
          .append("\"");
        sb.append("}");
        return sb.toString();
    }

    public void setQualityPreset(QualityPreset preset) {
        this.preferredQuality = preset != null ? preset : QualityPreset.AUTO_BEST;
        this.preferredWidth = 0;
        this.preferredHeight = 0;
        this.preferredFps = 0;
        Log.d(TAG, "Quality preset set: " + this.preferredQuality);
    }

    public void setPreferredResolution(int width, int height, int fps) {
        this.preferredWidth = width;
        this.preferredHeight = height;
        this.preferredFps = fps;
        Log.d(TAG, "Preferred resolution: " + width + "x" + height + "@" + fps);
    }

    public boolean applyResolutionLive(int width, int height, int fps) {
        if (cameraHelper == null || !isStreaming) return false;
        try {
            Size match = findClosestSize(width, height, fps);
            if (match == null) return false;
            Log.i(TAG, "Switching live to " + match.width + "x" + match.height + "@" + match.fps);
            cameraHelper.stopPreview();
            cameraHelper.setPreviewSize(match);
            attachSurfaces();
            cameraHelper.startPreview();
            updateActiveSize(match);
            return true;
        } catch (Exception e) {
            Log.e(TAG, "applyResolutionLive failed", e);
            return false;
        }
    }

    public void startCamera(String deviceId) {
        List<UsbDevice> devices = getUvcDevices();
        if (devices.isEmpty()) { Log.w(TAG, "No UVC devices"); return; }

        UsbDevice target = null;
        if (deviceId != null && !deviceId.isEmpty()) {
            for (UsbDevice d : devices) {
                if (("usb_" + d.getDeviceId()).equals(deviceId)) { target = d; break; }
            }
        }
        if (target == null) target = devices.get(0);
        Log.d(TAG, "startCamera: " + getDeviceLabel(target));

        UsbManager um = (UsbManager) context.getSystemService(Context.USB_SERVICE);
        if (um == null) return;

        if (um.hasPermission(target)) {
            openCamera(target);
        } else {
            Intent permIntent = new Intent(ACTION_USB_PERMISSION);
            permIntent.setPackage(context.getPackageName());
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE;
            PendingIntent pi = PendingIntent.getBroadcast(context, 0, permIntent, flags);
            um.requestPermission(target, pi);
        }
    }

    public void stopCamera() {
        isStreaming = false;
        if (cameraHelper != null) {
            try { cameraHelper.stopPreview(); } catch (Exception ignored) {}
            try {
                if (previewSurface != null) cameraHelper.removeSurface(previewSurface);
            } catch (Exception ignored) {}
            try { cameraHelper.closeCamera(); } catch (Exception ignored) {}
        }
        currentDevice = null;
        activeWidth = 0;
        activeHeight = 0;
    }

    public void destroy() {
        stopCamera();
        try { context.unregisterReceiver(usbReceiver); } catch (Exception ignored) {}
    }

    // ──── Internal ────

    private void openCamera(UsbDevice device) {
        currentDevice = device;
        Log.d(TAG, "=== Opening camera: " + getDeviceLabel(device) + " ===");
        try {
            if (cameraHelper != null) {
                try { cameraHelper.closeCamera(); } catch (Exception ignored) {}
                cameraHelper = null;
            }

            cameraHelper = new CameraHelper();
            cameraHelper.setStateCallback(new ICameraHelper.StateCallback() {
                @Override public void onAttach(UsbDevice d) {
                    Log.d(TAG, "onAttach: " + d.getDeviceName());
                    try { cameraHelper.selectDevice(d); }
                    catch (Exception e) { Log.e(TAG, "selectDevice", e); }
                }

                @Override public void onDeviceOpen(UsbDevice d, boolean isFirstOpen) {
                    Log.d(TAG, "onDeviceOpen");
                    Size pick = pickPreviewSize();
                    if (pick != null) {
                        try { cameraHelper.setPreviewSize(pick); }
                        catch (Exception e) { Log.e(TAG, "setPreviewSize", e); }
                    }
                    publishResolutionList();
                    try { cameraHelper.openCamera(); }
                    catch (Exception e) { Log.e(TAG, "openCamera", e); }
                }

                @Override public void onCameraOpen(UsbDevice d) {
                    Log.d(TAG, "onCameraOpen");
                    attachSurfaces();
                    try {
                        cameraHelper.startPreview();
                        isStreaming = true;
                        Size sz = cameraHelper.getPreviewSize();
                        if (sz != null) updateActiveSize(sz);
                        Log.d(TAG, "Preview streaming: "
                                + activeWidth + "x" + activeHeight + "@" + activeFps);
                        mainHandler.post(() -> callback.onCameraReady());
                    } catch (Exception e) {
                        Log.e(TAG, "startPreview", e);
                    }
                }

                @Override public void onCameraClose(UsbDevice d) {
                    isStreaming = false;
                    Log.d(TAG, "onCameraClose");
                }
                @Override public void onDeviceClose(UsbDevice d) { Log.d(TAG, "onDeviceClose"); }
                @Override public void onDetach(UsbDevice d) {
                    isStreaming = false;
                    Log.d(TAG, "onDetach");
                }
                @Override public void onCancel(UsbDevice d) { Log.d(TAG, "onCancel"); }
            });

            cameraHelper.selectDevice(device);
        } catch (Exception e) {
            Log.e(TAG, "Failed to open camera", e);
        }
    }

    private void attachSurfaces() {
        if (cameraHelper == null || previewSurface == null) return;
        if (!previewSurface.isValid()) return;
        try {
            cameraHelper.addSurface(previewSurface, false);
            Log.d(TAG, "Preview surface attached for direct GPU rendering");
        } catch (Exception e) {
            Log.e(TAG, "addSurface failed", e);
        }
    }

    private Size pickPreviewSize() {
        try {
            List<Size> sizes = cameraHelper.getSupportedSizeList();
            if (sizes == null || sizes.isEmpty()) {
                Log.w(TAG, "getSupportedSizeList returned null/empty");
                return null;
            }
            Log.d(TAG, "Supported sizes: " + sizes.size());
            for (Size s : sizes) {
                Log.d(TAG, "  " + s.width + "x" + s.height + "@" + s.fps);
            }

            // 1) Explicit override
            if (preferredWidth > 0 && preferredHeight > 0) {
                Size match = findClosestSize(preferredWidth, preferredHeight, preferredFps);
                if (match != null) {
                    Log.i(TAG, "Override → " + match.width + "x" + match.height + "@" + match.fps);
                    return match;
                }
            }

            // 2) Preset
            return resolveByPreset(sizes, preferredQuality);
        } catch (Exception e) {
            Log.e(TAG, "pickPreviewSize", e);
            return null;
        }
    }

    private Size resolveByPreset(List<Size> sizes, QualityPreset preset) {
        switch (preset) {
            case UHD_4K_30:    return findExactOr(sizes, 3840, 2160, 30);
            case QHD_1440_30:  return findExactOr(sizes, 2560, 1440, 30);
            case FHD_1080_60:  return findExactOr(sizes, 1920, 1080, 60);
            case FHD_1080_30:  return findExactOr(sizes, 1920, 1080, 30);
            case HD_720_60:    return findExactOr(sizes, 1280, 720,  60);
            case HD_720_30:    return findExactOr(sizes, 1280, 720,  30);
            case SD_480_30:    return findExactOr(sizes,  640, 480,  30);
            case AUTO_BEST:
            default:
                // Priority: 4K@30 → 1440@30 → 1080@60 → 1080@30 → 720@60 → 720@30 → max
                int[][] tries = {
                    {3840, 2160, 30},
                    {2560, 1440, 30},
                    {1920, 1080, 60},
                    {1920, 1080, 30},
                    {1280,  720, 60},
                    {1280,  720, 30},
                };
                for (int[] t : tries) {
                    Size m = findExact(sizes, t[0], t[1], t[2]);
                    if (m != null) {
                        Log.i(TAG, "AUTO_BEST → " + m.width + "x" + m.height + "@" + m.fps);
                        return m;
                    }
                }
                // Fallback: highest pixels
                Size max = null;
                for (Size s : sizes) {
                    if (max == null || (long) s.width * s.height > (long) max.width * max.height) {
                        max = s;
                    }
                }
                if (max != null) {
                    Log.i(TAG, "AUTO_BEST fallback → " + max.width + "x" + max.height + "@" + max.fps);
                }
                return max;
        }
    }

    private Size findExactOr(List<Size> sizes, int w, int h, int fps) {
        Size exact = findExact(sizes, w, h, fps);
        if (exact != null) return exact;
        Size closest = findClosestSize(w, h, fps);
        Log.i(TAG, "Preset fallback → "
                + (closest != null ? closest.width + "x" + closest.height + "@" + closest.fps : "null"));
        return closest;
    }

    private Size findExact(List<Size> sizes, int w, int h, int fps) {
        for (Size s : sizes) {
            if (s.width == w && s.height == h && (fps <= 0 || s.fps == fps)) return s;
        }
        return null;
    }

    private Size findClosestSize(int w, int h, int fps) {
        try {
            List<Size> sizes = cameraHelper.getSupportedSizeList();
            if (sizes == null || sizes.isEmpty()) return null;
            // Pick by pixel count distance, then fps distance
            long target = (long) w * h;
            Size best = null;
            long bestPixelDiff = Long.MAX_VALUE;
            int bestFpsDiff = Integer.MAX_VALUE;
            for (Size s : sizes) {
                long sp = (long) s.width * s.height;
                long pd = Math.abs(sp - target);
                int fd = (fps > 0) ? Math.abs(s.fps - fps) : 0;
                if (pd < bestPixelDiff || (pd == bestPixelDiff && fd < bestFpsDiff)) {
                    bestPixelDiff = pd;
                    bestFpsDiff = fd;
                    best = s;
                }
            }
            return best;
        } catch (Exception e) {
            return null;
        }
    }

    private void publishResolutionList() {
        try {
            List<Size> sizes = cameraHelper.getSupportedSizeList();
            if (sizes == null) return;
            List<int[]> arr = new ArrayList<>();
            Set<String> seen = new HashSet<>();
            for (Size s : sizes) {
                String key = s.width + "x" + s.height + "x" + s.fps;
                if (seen.add(key)) arr.add(new int[]{s.width, s.height, s.fps > 0 ? s.fps : 30});
            }
            mainHandler.post(() -> callback.onResolutionsAvailable(arr));
        } catch (Exception e) {
            Log.w(TAG, "publishResolutionList: " + e.getMessage());
        }
    }

    private void updateActiveSize(Size sz) {
        activeWidth = sz.width;
        activeHeight = sz.height;
        activeFps = (sz.fps > 0) ? sz.fps : 30;
        final int w = activeWidth, h = activeHeight, f = activeFps;
        mainHandler.post(() -> callback.onActiveResolutionChanged(w, h, f));
    }

    private boolean isUvcDevice(UsbDevice device) {
        if (device.getDeviceClass() == 14) return true;
        if (device.getDeviceClass() == 239
                && device.getDeviceSubclass() == 2
                && device.getDeviceProtocol() == 1) return true;
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            if (device.getInterface(i).getInterfaceClass() == 14) return true;
        }
        return false;
    }

    private String getDeviceLabel(UsbDevice device) {
        String name = device.getProductName();
        if (name != null && !name.isEmpty()) return name;
        return String.format(Locale.US, "USB Camera %04x:%04x", device.getVendorId(), device.getProductId());
    }

    private String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
