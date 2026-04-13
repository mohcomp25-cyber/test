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
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;

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
    private static final long FRAME_INTERVAL_MS = 66; // ~15fps

    private final Context context;
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
                synchronized (this) {
                    UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                    if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) {
                        if (device != null) {
                            Log.d(TAG, "USB permission granted: " + device.getDeviceName());
                            openCamera(device);
                        }
                    } else {
                        Log.d(TAG, "USB permission denied");
                    }
                }
            } else if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(action)) {
                UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                if (device != null && currentDevice != null
                        && device.getDeviceId() == currentDevice.getDeviceId()) {
                    Log.d(TAG, "USB camera detached");
                    stopCamera();
                    callback.onCameraDisconnected();
                }
            }
        }
    };

    public UsbCameraManager(Context context, FrameCallback callback) {
        this.context = context;
        this.callback = callback;
        this.mainHandler = new Handler(Looper.getMainLooper());

        IntentFilter filter = new IntentFilter();
        filter.addAction(ACTION_USB_PERMISSION);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        context.registerReceiver(usbReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
    }

    public boolean isUsbCameraAvailable() {
        List<UsbDevice> cameras = getUvcDevices();
        return !cameras.isEmpty();
    }

    public List<UsbDevice> getUvcDevices() {
        List<UsbDevice> result = new ArrayList<>();
        UsbManager usbManager = (UsbManager) context.getSystemService(Context.USB_SERVICE);
        if (usbManager == null) return result;

        HashMap<String, UsbDevice> deviceList = usbManager.getDeviceList();
        for (UsbDevice device : deviceList.values()) {
            if (isUvcDevice(device)) {
                result.add(device);
            }
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
        if (devices.isEmpty()) {
            Log.w(TAG, "No UVC devices found");
            return;
        }

        UsbDevice target = null;

        // لو محدد deviceId، دوّر عليه
        if (deviceId != null && !deviceId.isEmpty()) {
            for (UsbDevice d : devices) {
                if (("usb_" + d.getDeviceId()).equals(deviceId)) {
                    target = d;
                    break;
                }
            }
        }

        // لو ما لقيناه، خذ أول واحد
        if (target == null) {
            target = devices.get(0);
        }

        // اطلب إذن USB
        UsbManager usbManager = (UsbManager) context.getSystemService(Context.USB_SERVICE);
        if (usbManager == null) return;

        if (usbManager.hasPermission(target)) {
            openCamera(target);
        } else {
            PendingIntent pi = PendingIntent.getBroadcast(
                    context, 0, new Intent(ACTION_USB_PERMISSION),
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
            usbManager.requestPermission(target, pi);
        }
    }

    private void openCamera(UsbDevice device) {
        currentDevice = device;

        try {
            if (cameraHelper != null) {
                cameraHelper.closeCamera();
            }

            cameraHelper = new CameraHelper();
            cameraHelper.setStateCallback(new ICameraHelper.StateCallback() {
                @Override
                public void onAttach(UsbDevice device) {
                    Log.d(TAG, "Camera attached: " + device.getDeviceName());
                    cameraHelper.selectDevice(device);
                }

                @Override
                public void onDeviceOpen(UsbDevice device, boolean isFirstOpen) {
                    Log.d(TAG, "Camera opened");
                    // حاول أعلى دقة ممكنة
                    try {
                        cameraHelper.setPreviewSize(new com.serenegiant.usb.Size(1920, 1080));
                    } catch (Exception e) {
                        try {
                            cameraHelper.setPreviewSize(new com.serenegiant.usb.Size(1280, 720));
                        } catch (Exception e2) {
                            try {
                                cameraHelper.setPreviewSize(new com.serenegiant.usb.Size(640, 480));
                            } catch (Exception e3) {
                                Log.e(TAG, "Failed to set preview size", e3);
                            }
                        }
                    }
                    cameraHelper.startPreview();
                    isStreaming = true;
                    mainHandler.post(() -> callback.onCameraReady());
                }

                @Override
                public void onCameraOpen(UsbDevice device) {
                    Log.d(TAG, "UVC camera stream started");
                }

                @Override
                public void onCameraClose(UsbDevice device) {
                    Log.d(TAG, "Camera closed");
                    isStreaming = false;
                }

                @Override
                public void onDeviceClose(UsbDevice device) {
                    Log.d(TAG, "Device closed");
                }

                @Override
                public void onDetach(UsbDevice device) {
                    Log.d(TAG, "Device detached");
                    isStreaming = false;
                }

                @Override
                public void onCancel(UsbDevice device) {
                    Log.d(TAG, "Cancelled");
                }
            });

            cameraHelper.setFrameCallback(frame -> {
                if (!isStreaming) return;

                long now = System.currentTimeMillis();
                if (now - lastFrameTime < FRAME_INTERVAL_MS) return;
                lastFrameTime = now;

                try {
                    byte[] jpegBytes = nv21ToJpeg(frame, cameraHelper.getPreviewSize().width,
                            cameraHelper.getPreviewSize().height);
                    if (jpegBytes != null) {
                        String b64 = Base64.encodeToString(jpegBytes, Base64.NO_WRAP);
                        mainHandler.post(() -> callback.onFrame(b64));
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Frame convert error", e);
                }
            }, UVCCamera.PIXEL_FORMAT_NV21);

            cameraHelper.addDevice(device);

        } catch (Exception e) {
            Log.e(TAG, "Failed to open camera", e);
        }
    }

    public void stopCamera() {
        isStreaming = false;
        if (cameraHelper != null) {
            try {
                cameraHelper.stopPreview();
                cameraHelper.closeCamera();
            } catch (Exception e) {
                Log.e(TAG, "Error stopping camera", e);
            }
        }
        currentDevice = null;
    }

    public void destroy() {
        stopCamera();
        try {
            context.unregisterReceiver(usbReceiver);
        } catch (Exception ignored) {}
    }

    private byte[] nv21ToJpeg(ByteBuffer nv21Buffer, int width, int height) {
        try {
            byte[] nv21 = new byte[nv21Buffer.remaining()];
            nv21Buffer.get(nv21);
            YuvImage yuvImage = new YuvImage(nv21, ImageFormat.NV21, width, height, null);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            yuvImage.compressToJpeg(new Rect(0, 0, width, height), 80, out);
            return out.toByteArray();
        } catch (Exception e) {
            Log.e(TAG, "NV21 to JPEG error", e);
            return null;
        }
    }

    private boolean isUvcDevice(UsbDevice device) {
        int cls = device.getDeviceClass();
        int sub = device.getDeviceSubclass();
        int proto = device.getDeviceProtocol();

        // UVC Video class
        if (cls == 14) return true;
        // Miscellaneous with IAD (common for composite UVC devices)
        if (cls == 239 && sub == 2 && proto == 1) return true;
        // Check interfaces
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            if (device.getInterface(i).getInterfaceClass() == 14) return true;
        }
        return false;
    }

    private String getDeviceLabel(UsbDevice device) {
        String name = device.getProductName();
        if (name != null && !name.isEmpty()) return name;
        return "USB Camera (" + device.getVendorId() + ":" + device.getProductId() + ")";
    }

    private String escapeJson(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
