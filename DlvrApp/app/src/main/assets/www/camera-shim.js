(function() {
    'use strict';

    console.log('[DLVR-SHIM] Loading camera shim v4 (direct surface rendering)...');

    // ═══ State ═══
    var _usbActive = false;
    var _streamResolve = null;
    var _streamReject = null;
    var _cachedCaptureImg = null;  // pre-loaded image for synchronous drawImage

    // ═══ Hide WebView media controls ═══
    var _style = document.createElement('style');
    _style.textContent = [
        'video::-webkit-media-controls{display:none!important}',
        'video::-webkit-media-controls-overlay-play-button{display:none!important}',
        'video::-webkit-media-controls-start-playback-button{display:none!important}'
    ].join('');
    (document.head || document.documentElement).appendChild(_style);

    // ═══ Bridge helpers ═══
    function _hasAndroid() {
        try { return typeof Android !== 'undefined'; } catch(e) { return false; }
    }
    function _usbAvailable() {
        try { return _hasAndroid() && Android.isUsbCameraAvailable(); } catch(e) { return false; }
    }

    // ═══ Hide the <video> element when USB is active ═══
    // The TextureView (behind the transparent WebView) shows the camera directly.
    function _hideVideoElement() {
        var vid = document.getElementById('vid');
        if (vid) {
            vid.style.opacity = '0';
            vid.style.visibility = 'hidden';
        }
        // Also make the camera zone transparent
        var zone = document.getElementById('camZone');
        if (zone) zone.style.backgroundColor = 'transparent';
        // The whole body/app must be transparent so TextureView shows
        document.documentElement.style.background = 'transparent';
        document.body.style.background = 'transparent';
        var app = document.querySelector('.app');
        if (app) app.style.background = 'transparent';
    }
    function _showVideoElement() {
        var vid = document.getElementById('vid');
        if (vid) {
            vid.style.opacity = '';
            vid.style.visibility = '';
        }
    }

    // ═══ USB camera ready signal from native ═══
    window._nativeUsbReady = function() {
        console.log('[DLVR-SHIM] USB camera ready (rendering directly to TextureView)');
        _usbActive = true;
        _hideVideoElement();

        try { window.dispatchEvent(new CustomEvent('usb-camera-ready')); } catch(e) {}

        if (_streamResolve) {
            _streamResolve(_makeDummyStream());
            _streamResolve = null;
            _streamReject = null;
        }
    };

    // ═══ USB disconnected signal ═══
    window._nativeUsbDisconnected = function() {
        console.log('[DLVR-SHIM] USB disconnected');
        _usbActive = false;
        _showVideoElement();

        try {
            window.dispatchEvent(new CustomEvent('usb-camera-disconnected'));
            if (navigator.mediaDevices) {
                navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
            }
        } catch(e) {}
    };

    // ═══ Dummy stream for the JS app to set on srcObject ═══
    function _makeDummyStream() {
        var c = document.createElement('canvas');
        c.width = 1920; c.height = 1080;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, 1920, 1080);
        return c.captureStream(0);
    }

    // ═══ Save originals ═══
    if (!navigator.mediaDevices) navigator.mediaDevices = {};
    var _realGetUserMedia = navigator.mediaDevices.getUserMedia
        ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices) : null;
    var _realEnumerateDevices = navigator.mediaDevices.enumerateDevices
        ? navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices) : null;

    // ═══ getUserMedia override ═══
    navigator.mediaDevices.getUserMedia = function(constraints) {
        console.log('[DLVR-SHIM] getUserMedia called');

        if (!constraints || !constraints.video) {
            return _realGetUserMedia
                ? _realGetUserMedia(constraints)
                : Promise.reject(new Error('No camera requested'));
        }

        var requestedId = '';
        if (typeof constraints.video === 'object') {
            var did = constraints.video.deviceId;
            if (did) {
                requestedId = (typeof did === 'object')
                    ? (did.exact || did.ideal || '')
                    : did;
            }
        }

        var wantsUsb = requestedId && requestedId.indexOf('usb_') === 0;
        var usbAvail = _usbAvailable();

        if (wantsUsb || (usbAvail && !requestedId)) {
            if (!usbAvail) {
                return _realGetUserMedia
                    ? _realGetUserMedia(constraints)
                    : Promise.reject(new Error('USB camera not available'));
            }

            if (_usbActive) {
                console.log('[DLVR-SHIM] USB already active');
                return Promise.resolve(_makeDummyStream());
            }

            try {
                console.log('[DLVR-SHIM] Starting USB: ' + (requestedId || 'default'));
                Android.startCamera(requestedId || '');
            } catch(e) {
                return _realGetUserMedia
                    ? _realGetUserMedia(constraints)
                    : Promise.reject(e);
            }

            return new Promise(function(resolve, reject) {
                _streamResolve = resolve;
                _streamReject = reject;
                setTimeout(function() {
                    if (_streamResolve) {
                        _streamResolve = null; _streamReject = null;
                        if (_realGetUserMedia) {
                            _realGetUserMedia(constraints).then(resolve).catch(reject);
                        } else {
                            reject(new Error('USB camera timeout'));
                        }
                    }
                }, 8000);
            });
        }

        // No USB → real camera
        return _realGetUserMedia
            ? _realGetUserMedia(constraints)
            : Promise.reject(new Error('No camera available'));
    };

    // ═══ enumerateDevices override ═══
    navigator.mediaDevices.enumerateDevices = function() {
        var p = _realEnumerateDevices ? _realEnumerateDevices() : Promise.resolve([]);
        return p.then(function(builtinDevices) {
            var usbDevices = [];
            try {
                if (_hasAndroid()) {
                    var json = Android.getCameraList();
                    if (json) {
                        var list = JSON.parse(json);
                        usbDevices = list.map(function(d) {
                            return {
                                deviceId: d.deviceId || '',
                                groupId: 'usb',
                                kind: 'videoinput',
                                label: d.label || 'USB Camera',
                                toJSON: function() { return this; }
                            };
                        });
                    }
                }
            } catch(e) {}
            return usbDevices.concat(builtinDevices);
        });
    };

    // ═══ Capture API exposed to JS ═══
    /**
     * Capture the current camera frame as a base64 JPEG.
     * For USB camera: reads directly from the TextureView via Android bridge.
     * For built-in camera: falls back to drawImage from the video element.
     *
     * @param {number} maxWidth - Target max width (0 = full resolution)
     * @param {number} quality - JPEG quality 0-100
     * @returns {Promise<string>} base64 string (no data URL prefix)
     */
    window.captureNativeFrame = async function(maxWidth, quality) {
        if (_usbActive && _hasAndroid()) {
            try {
                var b64 = Android.captureFrame(maxWidth || 0, quality || 90);
                if (b64 && b64.length > 100) return b64;
            } catch(e) {
                console.error('[DLVR-SHIM] captureFrame failed:', e);
            }
        }
        // Fallback: capture from <video> via canvas
        var vid = document.getElementById('vid');
        if (!vid || !vid.videoWidth) return '';
        var srcW = vid.videoWidth, srcH = vid.videoHeight;
        var ratio = (maxWidth && maxWidth < srcW) ? (maxWidth / srcW) : 1;
        var w = Math.round(srcW * ratio), h = Math.round(srcH * ratio);
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(vid, 0, 0, w, h);
        return c.toDataURL('image/jpeg', (quality || 90) / 100).split(',')[1];
    };

    /**
     * Helper: capture a frame and load it into a cached <img> for synchronous
     * drawImage usage. After awaiting, drawImage(video) will draw the captured frame.
     */
    window.cacheNativeFrame = async function(maxWidth, quality) {
        var b64 = await window.captureNativeFrame(maxWidth, quality);
        if (!b64) return null;
        return new Promise(function(resolve, reject) {
            var img = new Image();
            img.onload = function() {
                _cachedCaptureImg = img;
                resolve(img);
            };
            img.onerror = reject;
            img.src = 'data:image/jpeg;base64,' + b64;
        });
    };

    /** Clear the cached capture image. */
    window.clearCachedFrame = function() { _cachedCaptureImg = null; };

    // ═══ Resolution API ═══

    /** Returns supported resolutions: [{width, height, fps, label}] */
    window.getCameraResolutions = function() {
        if (!_hasAndroid()) return [];
        try {
            var json = Android.getResolutionList();
            return JSON.parse(json || '[]');
        } catch (e) {
            console.error('[DLVR-SHIM] getCameraResolutions:', e);
            return [];
        }
    };

    /** Returns current camera info: {width, height, fps, streaming, label} */
    window.getCameraInfo = function() {
        if (!_hasAndroid()) return null;
        try {
            var json = Android.getCameraInfo();
            return JSON.parse(json || '{}');
        } catch (e) {
            console.error('[DLVR-SHIM] getCameraInfo:', e);
            return null;
        }
    };

    /** Hot-swap resolution while streaming. Returns true on success. */
    window.setCameraResolution = function(width, height, fps) {
        if (!_hasAndroid()) return false;
        try {
            return !!Android.setResolution(
                parseInt(width, 10),
                parseInt(height, 10),
                parseInt(fps || 30, 10)
            );
        } catch (e) {
            console.error('[DLVR-SHIM] setCameraResolution:', e);
            return false;
        }
    };

    /**
     * Set quality preset (applied on next start).
     * Valid: AUTO_BEST | UHD_4K_30 | QHD_1440_30 | FHD_1080_60 |
     *        FHD_1080_30 | HD_720_60 | HD_720_30 | SD_480_30
     */
    window.setCameraQualityPreset = function(preset) {
        if (!_hasAndroid()) return;
        try { Android.setQualityPreset(String(preset)); }
        catch (e) { console.error('[DLVR-SHIM] setCameraQualityPreset:', e); }
    };

    // ═══ Resolution change events from native ═══

    /** Native fires this when resolution changes (auto-pick or manual). */
    window._nativeResolutionChanged = function(width, height, fps) {
        console.log('[DLVR-SHIM] Resolution changed: ' + width + 'x' + height + '@' + fps);
        try {
            window.dispatchEvent(new CustomEvent('camera-resolution-changed', {
                detail: { width: width, height: height, fps: fps }
            }));
        } catch (e) {}
    };

    /** Native fires this once supported sizes are enumerated. */
    window._nativeResolutionsAvailable = function() {
        try {
            window.dispatchEvent(new CustomEvent('camera-resolutions-available'));
        } catch (e) {}
    };

    // ═══ Patch drawImage: when a cached frame exists and the source is the video,
    //     draw the cached image instead. Lets the existing capture flow keep working. ═══
    var _origDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function() {
        if (_usbActive && _cachedCaptureImg) {
            var src = arguments[0];
            if (src && src.tagName === 'VIDEO') {
                arguments[0] = _cachedCaptureImg;
            }
        }
        return _origDrawImage.apply(this, arguments);
    };

    // ═══ Patch video.videoWidth/videoHeight when USB is active and we have a cached frame ═══
    try {
        var vidProto = HTMLVideoElement.prototype;
        var origW = Object.getOwnPropertyDescriptor(vidProto, 'videoWidth');
        var origH = Object.getOwnPropertyDescriptor(vidProto, 'videoHeight');

        if (origW && origW.configurable) {
            Object.defineProperty(vidProto, 'videoWidth', {
                configurable: true,
                get: function() {
                    if (_usbActive && _cachedCaptureImg) return _cachedCaptureImg.naturalWidth;
                    if (_usbActive) return 1920; // sensible default
                    return origW.get.call(this);
                }
            });
        }
        if (origH && origH.configurable) {
            Object.defineProperty(vidProto, 'videoHeight', {
                configurable: true,
                get: function() {
                    if (_usbActive && _cachedCaptureImg) return _cachedCaptureImg.naturalHeight;
                    if (_usbActive) return 1080;
                    return origH.get.call(this);
                }
            });
        }
    } catch(e) {}

    console.log('[DLVR-SHIM] Camera shim v4 loaded');
})();
