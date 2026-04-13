(function() {
    'use strict';

    // === Canvas مخفي يستقبل فريمات الكاميرا من الجانب الأصلي ===
    var _nativeCanvas = document.createElement('canvas');
    _nativeCanvas.width = 1280;
    _nativeCanvas.height = 720;
    var _nativeCtx = _nativeCanvas.getContext('2d');
    var _nativeStream = null;
    var _nativeImg = new Image();
    var _usbActive = false;
    var _streamResolve = null;

    // يُستدعى من Java عبر evaluateJavascript لكل فريم
    window._nativeFrame = function(b64) {
        _nativeImg.src = 'data:image/jpeg;base64,' + b64;
    };

    _nativeImg.onload = function() {
        // حدّث حجم canvas ليطابق حجم الصورة الفعلي
        if (_nativeCanvas.width !== _nativeImg.naturalWidth || _nativeCanvas.height !== _nativeImg.naturalHeight) {
            _nativeCanvas.width = _nativeImg.naturalWidth;
            _nativeCanvas.height = _nativeImg.naturalHeight;
            // لو فيه stream قديم، أعد إنشاءه بالحجم الجديد
            if (_nativeStream) {
                _nativeStream = _nativeCanvas.captureStream(30);
            }
        }
        _nativeCtx.drawImage(_nativeImg, 0, 0);
    };

    // يُستدعى من Java لما كاميرا USB جاهزة
    window._nativeUsbReady = function() {
        _usbActive = true;
        _nativeStream = _nativeCanvas.captureStream(30);
        if (_streamResolve) {
            _streamResolve(_nativeStream);
            _streamResolve = null;
        }
    };

    // يُستدعى من Java لما كاميرا USB تنفصل
    window._nativeUsbDisconnected = function() {
        _usbActive = false;
        _nativeStream = null;
        // أطلق حدث devicechange عشان الموقع يعيد البحث
        window._notifyDeviceChange();
    };

    // يُستدعى من Java لإطلاق حدث devicechange
    window._notifyDeviceChange = function() {
        try {
            navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
        } catch(e) {
            console.log('[DLVR-SHIM] devicechange dispatch error:', e);
        }
    };

    // === حفظ الدوال الأصلية ===
    var _realGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    var _realEnumerateDevices = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);

    // === استبدال getUserMedia ===
    navigator.mediaDevices.getUserMedia = function(constraints) {
        // لو الطلب مو فيديو، مرّره للأصلي
        if (!constraints || !constraints.video) {
            return _realGetUserMedia(constraints);
        }

        // لو طلب كاميرا محددة "builtin"، استخدم الأصلي
        var requestedId = '';
        if (constraints.video && typeof constraints.video === 'object') {
            var did = constraints.video.deviceId;
            if (did) {
                requestedId = did.exact || did.ideal || did || '';
            }
        }
        if (requestedId === 'builtin') {
            return _realGetUserMedia(constraints);
        }

        // شوف لو فيه كاميرا USB متاحة
        var hasUsb = false;
        try {
            if (typeof Android !== 'undefined' && Android.isUsbCameraAvailable()) {
                hasUsb = true;
            }
        } catch(e) {}

        if (hasUsb) {
            // لو الـ stream جاهز، رجّعه مباشرة
            if (_usbActive && _nativeStream) {
                console.log('[DLVR-SHIM] returning existing USB stream');
                return Promise.resolve(_nativeStream);
            }

            // ابدأ الكاميرا من الجانب الأصلي
            try {
                Android.startCamera(requestedId);
            } catch(e) {
                console.log('[DLVR-SHIM] startCamera error, fallback:', e);
                return _realGetUserMedia(constraints);
            }

            // انتظر لما الكاميرا تجهز
            return new Promise(function(resolve, reject) {
                _streamResolve = resolve;
                // timeout 5 ثواني — لو ما جهزت، ارجع للأصلي
                setTimeout(function() {
                    if (_streamResolve) {
                        _streamResolve = null;
                        console.log('[DLVR-SHIM] USB timeout, fallback to builtin');
                        _realGetUserMedia(constraints).then(resolve).catch(reject);
                    }
                }, 5000);
            });
        }

        // ما فيه USB — استخدم الأصلي
        return _realGetUserMedia(constraints);
    };

    // === استبدال enumerateDevices ===
    navigator.mediaDevices.enumerateDevices = function() {
        return _realEnumerateDevices().then(function(builtinDevices) {
            var usbDevices = [];
            try {
                if (typeof Android !== 'undefined') {
                    var json = Android.getCameraList();
                    if (json) {
                        var parsed = JSON.parse(json);
                        usbDevices = parsed.map(function(d) {
                            return {
                                deviceId: d.deviceId || '',
                                groupId: 'usb',
                                kind: 'videoinput',
                                label: d.label || 'USB Camera',
                                toJSON: function() {
                                    return { deviceId: this.deviceId, groupId: this.groupId, kind: this.kind, label: this.label };
                                }
                            };
                        });
                    }
                }
            } catch(e) {
                console.log('[DLVR-SHIM] getCameraList error:', e);
            }

            // USB cameras أول، ثم المدمجة
            return usbDevices.concat(builtinDevices);
        });
    };

    console.log('[DLVR-SHIM] Camera shim loaded');
})();
