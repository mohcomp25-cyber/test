(function() {
    'use strict';

    console.log('[DLVR-SHIM] Loading camera shim...');

    // === إخفاء زر Play الافتراضي في WebView ===
    var _shimStyle = document.createElement('style');
    _shimStyle.textContent = 'video::-webkit-media-controls-overlay-play-button{display:none!important}video::-webkit-media-controls-panel{display:none!important}video::-webkit-media-controls{display:none!important}video::-webkit-media-controls-start-playback-button{display:none!important}';
    (document.head || document.documentElement).appendChild(_shimStyle);

    // === جبر الفيديو يشتغل تلقائي ===
    setInterval(function() {
        var v = document.getElementById('vid');
        if (v && v.paused && v.srcObject) {
            v.play().catch(function(e){ console.log('[DLVR-SHIM] play error:', e); });
        }
    }, 300);

    // === Canvas مخفي يستقبل فريمات الكاميرا من الجانب الأصلي ===
    var _nativeCanvas = document.createElement('canvas');
    _nativeCanvas.width = 1280;
    _nativeCanvas.height = 720;
    var _nativeCtx = _nativeCanvas.getContext('2d');
    var _nativeStream = null;
    var _nativeImg = new Image();
    var _usbActive = false;
    var _streamResolve = null;
    var _frameCount = 0;

    // يُستدعى من Java عبر evaluateJavascript لكل فريم
    window._nativeFrame = function(b64) {
        _nativeImg.src = 'data:image/jpeg;base64,' + b64;
        _frameCount++;
        if (_frameCount === 1) console.log('[DLVR-SHIM] First frame received from native');
    };

    _nativeImg.onload = function() {
        if (_nativeCanvas.width !== _nativeImg.naturalWidth || _nativeCanvas.height !== _nativeImg.naturalHeight) {
            _nativeCanvas.width = _nativeImg.naturalWidth;
            _nativeCanvas.height = _nativeImg.naturalHeight;
            console.log('[DLVR-SHIM] Canvas resized to ' + _nativeCanvas.width + 'x' + _nativeCanvas.height);
        }
        _nativeCtx.drawImage(_nativeImg, 0, 0);
    };

    // يُستدعى من Java لما كاميرا USB جاهزة
    window._nativeUsbReady = function() {
        console.log('[DLVR-SHIM] USB camera ready!');
        _usbActive = true;
        if (_streamResolve) {
            // أنشئ stream جديد لكل طلب
            var freshStream = _nativeCanvas.captureStream(0);
            _streamResolve(freshStream);
            _streamResolve = null;
        }
    };

    // يُستدعى من Java لما كاميرا USB تنفصل
    window._nativeUsbDisconnected = function() {
        console.log('[DLVR-SHIM] USB camera disconnected');
        _usbActive = false;
        _nativeStream = null;
        window._notifyDeviceChange();
    };

    window._notifyDeviceChange = function() {
        try {
            if (navigator.mediaDevices) {
                navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
            }
        } catch(e) {
            console.log('[DLVR-SHIM] devicechange dispatch error:', e);
        }
    };

    // === حفظ الدوال الأصلية (مع حماية) ===
    if (!navigator.mediaDevices) {
        navigator.mediaDevices = {};
    }
    var _realGetUserMedia = navigator.mediaDevices.getUserMedia
        ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices) : null;
    var _realEnumerateDevices = navigator.mediaDevices.enumerateDevices
        ? navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices) : null;

    // === استبدال getUserMedia ===
    navigator.mediaDevices.getUserMedia = function(constraints) {
        console.log('[DLVR-SHIM] getUserMedia called', JSON.stringify(constraints));

        // لو الطلب مو فيديو، مرّره للأصلي
        if (!constraints || !constraints.video) {
            return _realGetUserMedia ? _realGetUserMedia(constraints) : Promise.reject(new Error('No camera'));
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
            return _realGetUserMedia ? _realGetUserMedia(constraints) : Promise.reject(new Error('No builtin camera'));
        }

        // شوف لو فيه كاميرا USB متاحة
        var hasUsb = false;
        try {
            if (typeof Android !== 'undefined' && Android.isUsbCameraAvailable()) {
                hasUsb = true;
                console.log('[DLVR-SHIM] USB camera detected');
            }
        } catch(e) { console.log('[DLVR-SHIM] isUsbCameraAvailable error:', e); }

        if (hasUsb) {
            if (_usbActive) {
                // دائماً أنشئ stream جديد من canvas — عشان لو الـ tracks القديمة انوقفت
                var freshStream = _nativeCanvas.captureStream(0);
                console.log('[DLVR-SHIM] returning fresh USB stream');
                return Promise.resolve(freshStream);
            }

            try {
                console.log('[DLVR-SHIM] Starting USB camera...');
                Android.startCamera(requestedId);
            } catch(e) {
                console.log('[DLVR-SHIM] startCamera error, fallback:', e);
                return _realGetUserMedia ? _realGetUserMedia(constraints) : Promise.reject(e);
            }

            return new Promise(function(resolve, reject) {
                _streamResolve = resolve;
                setTimeout(function() {
                    if (_streamResolve) {
                        _streamResolve = null;
                        console.log('[DLVR-SHIM] USB timeout 10s, fallback to builtin');
                        if (_realGetUserMedia) {
                            _realGetUserMedia(constraints).then(resolve).catch(reject);
                        } else {
                            reject(new Error('USB camera timeout and no builtin available'));
                        }
                    }
                }, 10000);
            });
        }

        // ما فيه USB — استخدم الأصلي
        console.log('[DLVR-SHIM] No USB, using builtin camera');
        return _realGetUserMedia ? _realGetUserMedia(constraints) : Promise.reject(new Error('No camera available'));
    };

    // === استبدال enumerateDevices ===
    navigator.mediaDevices.enumerateDevices = function() {
        var builtinPromise = _realEnumerateDevices
            ? _realEnumerateDevices() : Promise.resolve([]);
        return builtinPromise.then(function(builtinDevices) {
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
