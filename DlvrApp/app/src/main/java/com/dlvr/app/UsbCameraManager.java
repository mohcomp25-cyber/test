package com.dlvr.app;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.ImageFormat;
import android.graphics.Rect;
import android.graphics.YuvImage;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;

import androidx.fragment.app.FragmentActivity;

import com.herohan.uvcapp.CameraHelper;
import com.herohan.uvcapp.ICameraHelper;
import com.serenegiant.usb.UVCCamera;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;

public class UsbCameraManager {
    private static final String TAG = "DLVR-USB";
    private static final String ACTION_USB_PERMISSION = "com.dlvr.app.USB_PERMISSION";
    private static final long FRAME_INTERVAL_MS = 66;

    private final Context context;
    private final FragmentActivity activity;
    private final Handler mainHandler;
    private final FrameCallback callback;

    private ICameraHelper cameraHelper;
    private UsbDevice currentDevice;
    private boolean isStreaming = false;
    private long lastFrameTime = 0;

    public interface FrameCallback {
        void onFrame(String base64Jpeg);
        void onCameraReady();
        void onCameraDisconnected();
    }

    private final BroadcastReceiver usbReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (ACTION_USB_PERMISSION.equals(action)) {
                UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false) && device != null) {
                    openCamera(device);
                }
            } else if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(action)) {
                UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                if (device != null && currentDevice != null && device.getDeviceId() == currentDevice.getDeviceId()) {
                    stopCamera();
                    callback.onCameraDisconnected();
                }
            }
        }
    };

    public UsbCameraManager(FragmentActivity activity, FrameCallback callback) {
        this.context = activity;
        this.activity = activity;
        this.callback = callback;
        this.mainHandler = new Handler(Looper.getMainLooper());

        IntentFilter filter = new IntentFilter();
        filter.addAction(ACTION_USB_PERMISSION);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(usbReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            context.registerReceiver(usbReceiver, filter);
        }
    }

    public boolean isUsbCameraAvailable() {
        return !getUvcDevices().isEmpty();
    }

    public List<UsbDevice> getUvcDevices() {
        List<UsbDevice> result = new ArrayList<>();
        UsbManager usbManager = (UsbManager) context.getSystemService(Context.USB_SERVICE);
        if (usbManager == null) return result;
        for (UsbDevice device : usbManager.getDeviceList().values()) {
            if (isUvcDevice(device)) result.add(device);
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
            sb.append("\"kind\":\"videoinput\"}");
        }
        sb.append("]");
        return sb.toString();
    }

    public void startCamera(String deviceId) {
        List<UsbDevice> devices = getUvcDevices();
        if (devices.isEmpty()) return;

        UsbDevice target = null;
        if (deviceId != null && !deviceId.isEmpty()) {
            for (UsbDevice d : devices) {
                if (("usb_" + d.getDeviceId()).equals(deviceId)) { target = d; break; }
            }
        }
        if (target == null) target = devices.get(0);

        UsbManager usbManager = (UsbManager) context.getSystemService(Context.USB_SERVICE);
        if (usbManager == null) return;

        if (usbManager.hasPermission(target)) {
            openCamera(target);
        } else {
            PendingIntent pi = PendingIntent.getBroadcast(context, 0,
                    new Intent(ACTION_USB_PERMISSION), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
            usbManager.requestPermission(target, pi);
        }
    }

    private void openCamera(UsbDevice device) {
        currentDevice = device;
        Log.d(TAG, "Opening camera: " + getDeviceLabel(device));
        try {
            if (cameraHelper != null) {
                try { cameraHelper.closeCamera(); } catch (Exception ignored) {}
                cameraHelper = null;
            }

            cameraHelper = new CameraHelper();
            cameraHelper.setStateCallback(new ICameraHelper.StateCallback() {
                @Override public void onAttach(UsbDevice device) {
                    Log.d(TAG, "onAttach: " + device.getDeviceName());
                    try { cameraHelper.selectDevice(device); } catch (Exception e) { Log.e(TAG, "selectDevice error", e); }
                }
                @Override public void onDeviceOpen(UsbDevice device, boolean isFirstOpen) {
                    Log.d(TAG, "onDeviceOpen");
                    try {
                        List<com.serenegiant.usb.Size> sizes = cameraHelper.getSupportedSizeList();
                        com.serenegiant.usb.Size best = null;
                        if (sizes != null && !sizes.isEmpty()) {
                            int target = 1280 * 720;
                            int bestDiff = Integer.MAX_VALUE;
                            for (com.serenegiant.usb.Size s : sizes) {
                                int diff = Math.abs(s.width * s.height - target);
                                if (diff < bestDiff) { bestDiff = diff; best = s; }
                            }
                            Log.d(TAG, "Best size: " + best.width + "x" + best.height);
                        }
                        if (best != null) cameraHelper.setPreviewSize(best);
                    } catch (Exception e) { Log.e(TAG, "setPreviewSize error", e); }
                    try { cameraHelper.openCamera(); } catch (Exception e) { Log.e(TAG, "openCamera error", e); }
                }
                @Override public void onCameraOpen(UsbDevice device) {
                    Log.d(TAG, "onCameraOpen — starting preview");
                    try {
                        cameraHelper.startPreview();
                        isStreaming = true;
                        mainHandler.post(() -> callback.onCameraReady());
                    } catch (Exception e) { Log.e(TAG, "startPreview error", e); }
                }
                @Override public void onCameraClose(UsbDevice device) { isStreaming = false; Log.d(TAG, "onCameraClose"); }
                @Override public void onDeviceClose(UsbDevice device) { Log.d(TAG, "onDeviceClose"); }
                @Override public void onDetach(UsbDevice device) { isStreaming = false; Log.d(TAG, "onDetach"); }
                @Override public void onCancel(UsbDevice device) { Log.d(TAG, "onCancel"); }
            });

            cameraHelper.setFrameCallback(frame -> {
                if (!isStreaming || cameraHelper == null) return;
                long now = System.currentTimeMillis();
                if (now - lastFrameTime < FRAME_INTERVAL_MS) return;
                lastFrameTime = now;
                try {
                    com.serenegiant.usb.Size sz = cameraHelper.getPreviewSize();
                    if (sz == null) return;
                    byte[] jpeg = nv21ToJpeg(frame, sz.width, sz.height);
                    if (jpeg != null) {
                        String b64 = Base64.encodeToString(jpeg, Base64.NO_WRAP);
                        mainHandler.post(() -> callback.onFrame(b64));
                    }
                } catch (Exception e) { Log.e(TAG, "Frame error", e); }
            }, UVCCamera.PIXEL_FORMAT_NV21);

            cameraHelper.selectDevice(device);
        } catch (Exception e) { Log.e(TAG, "Failed to open camera", e); }
    }

    public void stopCamera() {
        isStreaming = false;
        if (cameraHelper != null) {
            try { cameraHelper.stopPreview(); cameraHelper.closeCamera(); } catch (Exception ignored) {}
        }
        currentDevice = null;
    }

    public void destroy() {
        stopCamera();
        try { context.unregisterReceiver(usbReceiver); } catch (Exception ignored) {}
    }

    private byte[] nv21ToJpeg(ByteBuffer buf, int w, int h) {
        try {
            byte[] nv21 = new byte[buf.remaining()];
            buf.get(nv21);
            YuvImage yuv = new YuvImage(nv21, ImageFormat.NV21, w, h, null);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            yuv.compressToJpeg(new Rect(0, 0, w, h), 80, out);
            return out.toByteArray();
        } catch (Exception e) { return null; }
    }

    private boolean isUvcDevice(UsbDevice device) {
        if (device.getDeviceClass() == 14) return true;
        if (device.getDeviceClass() == 239 && device.getDeviceSubclass() == 2 && device.getDeviceProtocol() == 1) return true;
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            if (device.getInterface(i).getInterfaceClass() == 14) return true;
        }
        return false;
    }

    private String getDeviceLabel(UsbDevice device) {
        String name = device.getProductName();
        return (name != null && !name.isEmpty()) ? name : "USB Camera";
    }

    private String escapeJson(String s) { return s.replace("\\", "\\\\").replace("\"", "\\\""); }
}
