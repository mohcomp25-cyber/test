/* ════════════════════════════════════════════════════════════
 * DLVR — Main Application Module
 * Architecture: state → modules → UI binding → app boot
 * ════════════════════════════════════════════════════════════ */

(function() {
    'use strict';

    // ═══ CONFIG ═══
    const CONFIG = {
        WORKER_URL: 'https://dry-glade-3ab4.e-8mohm.workers.dev/',
        ADMIN_PIN: '1234',
        VERSION: 'v7',

        CHECK_MAX_W: 480,
        CHECK_QUALITY: 50,
        UPLOAD_MAX_W: 1280,
        UPLOAD_QUALITY: 90,
        THUMB_SIZE: 96,
        THUMB_QUALITY: 65,

        RETRY_ATTEMPTS: 3,
        RETRY_BASE_DELAY: 800,
        REQUEST_TIMEOUT: 30000,

        HISTORY_MAX: 6,
    };

    // ═══ BRANCHES ═══
    const BRANCHES = {
        '3847':'تست','5921':'النسيم','7364':'الحمدانية',
        '1589':'الاجاويد','4203':'الصفا','8716':'السامر',
        '2945':'الزهرة','6138':'ابحر','9472':'نمق فرع الصفا',
        '3061':'نمق فرع المروة','7854':'نمق فرع البترجي','1427':'نمق فرع ابحر',
        '5693':'فرع 5693','8310':'فرع 8310','2786':'فرع 2786',
        '4519':'فرع 4519','9063':'فرع 9063','6742':'فرع 6742',
        '1358':'فرع 1358','8927':'فرع 8927','3614':'فرع 3614',
        '7081':'فرع 7081','5439':'فرع 5439','2197':'فرع 2197',
        '9845':'فرع 9845','4672':'فرع 4672','1036':'فرع 1036',
        '8253':'فرع 8253','6480':'فرع 6480','3729':'فرع 3729',
        '7195':'فرع 7195','5068':'فرع 5068','2841':'فرع 2841',
        '9317':'فرع 9317','4953':'فرع 4953','1624':'فرع 1624',
        '8490':'فرع 8490','6207':'فرع 6207','3578':'فرع 3578',
        '7843':'فرع 7843','2465':'فرع 2465','5130':'فرع 5130',
        '9786':'فرع 9786','1902':'فرع 1902','6354':'فرع 6354',
        '4817':'فرع 4817','8629':'فرع 8629','3041':'فرع 3041',
        '7568':'فرع 7568','2394':'فرع 2394',
    };

    // ═══ STORAGE ═══
    const Storage = (() => {
        const KEY = {
            URL: 'dlvr_v7_url',
            BRANCH: 'dlvr_v7_branch',
            COUNT: 'dlvr_v7_count',
            DATE: 'dlvr_v7_date',
            HIST: 'dlvr_v7_hist',
            CAMPREF: 'dlvr_v7_campref',
            QUALITY: 'dlvr_v7_quality',
        };
        const get = (k, def = '') => { try { return localStorage.getItem(k) ?? def; } catch (e) { return def; } };
        const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
        const remove = (k) => { try { localStorage.removeItem(k); } catch (e) {} };
        return { KEY, get, set, remove };
    })();

    // ═══ STATE STORE (Observable) ═══
    const State = (() => {
        const listeners = new Map();
        const data = {
            sheetUrl:    Storage.get(Storage.KEY.URL, ''),
            branchCode:  Storage.get(Storage.KEY.BRANCH, ''),
            count:       parseInt(Storage.get(Storage.KEY.COUNT, '0'), 10) || 0,
            camPref:     Storage.get(Storage.KEY.CAMPREF, 'auto'),
            quality:     Storage.get(Storage.KEY.QUALITY, 'AUTO_BEST'),
            currentCam:  '', // 'usb' | 'builtin' | ''
            isStreaming: false,
            isCapturing: false,
            isOnline:    navigator.onLine,
            camWidth:    0,
            camHeight:   0,
            camFps:      0,
        };

        function get(key) { return data[key]; }

        function set(key, value) {
            if (data[key] === value) return;
            data[key] = value;
            const subs = listeners.get(key);
            if (subs) subs.forEach(fn => { try { fn(value); } catch (e) { console.error(e); } });
        }

        function on(key, fn) {
            if (!listeners.has(key)) listeners.set(key, new Set());
            listeners.get(key).add(fn);
            return () => listeners.get(key)?.delete(fn);
        }

        return { get, set, on };
    })();

    // ═══ EVENT BUS ═══
    const Bus = (() => {
        const listeners = new Map();
        function on(evt, fn) {
            if (!listeners.has(evt)) listeners.set(evt, new Set());
            listeners.get(evt).add(fn);
            return () => listeners.get(evt)?.delete(fn);
        }
        function emit(evt, data) {
            const subs = listeners.get(evt);
            if (subs) subs.forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });
        }
        return { on, emit };
    })();

    // ═══ HAPTIC ═══
    const Haptic = {
        tap:    () => { try { navigator.vibrate?.(20); } catch (e) {} },
        click:  () => { try { navigator.vibrate?.(35); } catch (e) {} },
        impact: () => { try { navigator.vibrate?.(60); } catch (e) {} },
        error:  () => { try { navigator.vibrate?.([50, 60, 100]); } catch (e) {} },
        success:() => { try { navigator.vibrate?.([20, 30, 40]); } catch (e) {} },
    };

    // ═══ AUDIO ═══
    const Audio = (() => {
        let ctx = null;
        function init() {
            if (!ctx) {
                try {
                    ctx = new (window.AudioContext || window.webkitAudioContext)();
                } catch (e) {}
            }
            if (ctx?.state === 'suspended') ctx.resume();
        }
        function tone(freq, duration, type = 'sine', volume = 0.25) {
            if (!ctx) return;
            try {
                const o = ctx.createOscillator(), g = ctx.createGain();
                o.connect(g); g.connect(ctx.destination);
                o.type = type;
                const now = ctx.currentTime;
                o.frequency.setValueAtTime(freq, now);
                g.gain.setValueAtTime(volume, now);
                g.gain.exponentialRampToValueAtTime(0.001, now + duration);
                o.start(now); o.stop(now + duration);
            } catch (e) {}
        }
        function shutter() {
            init();
            if (!ctx) return;
            const t = ctx.currentTime;
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            o.type = 'sine';
            o.frequency.setValueAtTime(900, t);
            o.frequency.exponentialRampToValueAtTime(1300, t + 0.1);
            g.gain.setValueAtTime(0.3, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
            o.start(t); o.stop(t + 0.18);
        }
        function success() {
            init();
            if (!ctx) return;
            const t = ctx.currentTime;
            [660, 880, 1100].forEach((freq, i) => {
                const start = t + i * 0.1;
                const o = ctx.createOscillator(), g = ctx.createGain();
                o.connect(g); g.connect(ctx.destination);
                o.type = 'sine';
                o.frequency.setValueAtTime(freq, start);
                g.gain.setValueAtTime(0.35, start);
                g.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
                o.start(start); o.stop(start + 0.22);
            });
        }
        function error() {
            init();
            if (!ctx) return;
            const t = ctx.currentTime;
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            o.type = 'sine';
            o.frequency.setValueAtTime(420, t);
            o.frequency.exponentialRampToValueAtTime(180, t + 0.3);
            g.gain.setValueAtTime(0.3, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
            o.start(t); o.stop(t + 0.35);
        }
        return { init, shutter, success, error };
    })();

    // ═══ LOGGER ═══
    const Log = {
        info:  (...args) => console.log('[DLVR]', ...args),
        warn:  (...args) => console.warn('[DLVR]', ...args),
        error: (...args) => console.error('[DLVR]', ...args),
    };

    // ═══ NETWORK — robust fetch with retry + timeout ═══
    const Net = (() => {
        async function fetchWithTimeout(url, options, timeout) {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeout);
            try {
                const res = await fetch(url, { ...options, signal: controller.signal });
                clearTimeout(id);
                return res;
            } catch (e) {
                clearTimeout(id);
                throw e;
            }
        }

        async function withRetry(fn, attempts = CONFIG.RETRY_ATTEMPTS) {
            let lastErr;
            for (let i = 0; i < attempts; i++) {
                try {
                    return await fn();
                } catch (e) {
                    lastErr = e;
                    if (i < attempts - 1) {
                        const delay = CONFIG.RETRY_BASE_DELAY * Math.pow(2, i);
                        Log.warn(`Retry ${i + 1}/${attempts} after ${delay}ms`);
                        await new Promise(r => setTimeout(r, delay));
                    }
                }
            }
            throw lastErr;
        }

        return { fetchWithTimeout, withRetry };
    })();

    // ═══ TOAST UI ═══
    const Toast = (() => {
        let timer = null;
        function show(msg, type = 'info', duration = 2400) {
            const el = $('#toast');
            if (!el) return;
            clearTimeout(timer);
            el.textContent = msg;
            el.className = `toast ${type} show`;
            timer = setTimeout(() => el.classList.remove('show'), duration);
        }
        return { show };
    })();

    // ═══ DOM helpers ═══
    function $(sel)   { return document.querySelector(sel); }
    function $$(sel)  { return Array.from(document.querySelectorAll(sel)); }
    function show(el) { el?.classList.remove('hidden'); el && (el.style.display = ''); }
    function hide(el) { el?.classList.add('hidden'); }

    // ═══ DATE & COUNTER ═══
    const Date_ = (() => {
        function todayStr() { return new Date().toISOString().slice(0, 10); }

        function checkDailyReset() {
            const today = todayStr();
            if (Storage.get(Storage.KEY.DATE) !== today) {
                State.set('count', 0);
                Storage.set(Storage.KEY.COUNT, '0');
                Storage.set(Storage.KEY.DATE, today);
                Storage.remove(Storage.KEY.HIST);
                History.clear();
            }
        }

        function setupDateChip() {
            const d = new Date();
            const opts = { weekday: 'short', day: 'numeric', month: 'short' };
            $('#dateChip').textContent = d.toLocaleDateString('ar-SA', opts);
        }

        function scheduleNextReset() {
            const now = new Date();
            const midnight = new Date(now);
            midnight.setHours(24, 0, 0, 0);
            setTimeout(() => { checkDailyReset(); scheduleNextReset(); }, midnight - now + 1000);
        }

        return { checkDailyReset, setupDateChip, scheduleNextReset };
    })();

    // ═══ HISTORY ═══
    const History = (() => {
        let items = [];

        function load() {
            try {
                const saved = JSON.parse(Storage.get(Storage.KEY.HIST, '[]'));
                items = saved.slice(-CONFIG.HISTORY_MAX);
            } catch (e) { items = []; }
        }

        function add(thumbDataUrl) {
            items.push(thumbDataUrl);
            if (items.length > CONFIG.HISTORY_MAX) items.shift();
            try { Storage.set(Storage.KEY.HIST, JSON.stringify(items)); } catch (e) {}
            render();
        }

        function clear() {
            items = [];
            Storage.remove(Storage.KEY.HIST);
            render();
        }

        function render() {
            const strip = $('#historyStrip');
            if (!strip) return;
            strip.querySelectorAll('.hist-thumb').forEach(el => el.remove());

            if (items.length === 0) {
                strip.classList.add('hidden');
                return;
            }
            strip.classList.remove('hidden');

            items.forEach((src, i) => {
                const img = document.createElement('img');
                img.className = 'hist-thumb';
                img.src = src;
                img.alt = `صورة ${i + 1}`;
                img.loading = 'lazy';
                img.onclick = () => Lightbox.open(src);
                strip.appendChild(img);
            });
        }

        return { load, add, clear, render };
    })();

    // ═══ LIGHTBOX ═══
    const Lightbox = (() => {
        function open(src) {
            $('#lbImg').src = src;
            $('#lightbox').classList.add('on');
        }
        function close() {
            $('#lightbox').classList.remove('on');
        }
        return { open, close };
    })();

    // ═══ STATUS OVERLAYS ═══
    const StatusOverlay = {
        success: (msg = 'تم الإرسال بنجاح', sub = 'التحليل جاري على السيرفر') => {
            const el = $('#successOverlay');
            $('#successTxt').textContent = msg;
            $('#successSub').textContent = sub;
            el.classList.add('on');
            Audio.success();
            setTimeout(() => el.classList.remove('on'), 2400);
        },
        reject: (msg = 'لا توجد فاتورة في الصورة') => {
            const el = $('#rejectOverlay');
            $('#rejectTxt').textContent = msg;
            el.classList.add('on');
            Audio.error();
            Haptic.error();
            setTimeout(() => el.classList.remove('on'), 2400);
        },
    };

    // ═══ ANALYZING UI ═══
    const Analyzing = {
        show()   { $('#analyzing').classList.add('on'); },
        hide()   { $('#analyzing').classList.remove('on'); },
        step(n)  {
            $('#step1').className = n === 1 ? 'an-step active' : 'an-step done';
            $('#step2').className = n === 2 ? 'an-step active' : 'an-step';
        },
    };

    // ═══ CAMERA ═══
    const Camera = (() => {
        let stream = null;
        let torchOn = false;

        function bridgeAvailable() {
            return typeof Android !== 'undefined';
        }

        function isUsbAvailable() {
            try { return bridgeAvailable() && Android.isUsbCameraAvailable(); }
            catch (e) { return false; }
        }

        function getUsbDeviceId() {
            try {
                if (!bridgeAvailable()) return '';
                const json = Android.getCameraList();
                const list = JSON.parse(json);
                return list[0]?.deviceId || '';
            } catch (e) { return ''; }
        }

        async function start() {
            const loading = $('#camLoading');
            const noCam = $('#noCam');
            loading?.classList.remove('hidden');
            noCam?.classList.add('hidden');

            // Apply quality preset BEFORE starting USB camera
            try {
                if (bridgeAvailable() && typeof Android.setQualityPreset === 'function') {
                    Android.setQualityPreset(State.get('quality') || 'AUTO_BEST');
                }
            } catch (e) {}

            const usbAvail = isUsbAvailable();
            const pref = State.get('camPref');
            let useUsb = false;
            if (pref === 'usb') useUsb = true;
            else if (pref === 'builtin') useUsb = false;
            else useUsb = usbAvail;

            const constraints = (useUsb && usbAvail) ? {
                video: { deviceId: { exact: getUsbDeviceId() } },
                audio: false,
            } : {
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
                audio: false,
            };

            try {
                stream = await navigator.mediaDevices.getUserMedia(constraints);
                State.set('currentCam', (useUsb && usbAvail) ? 'usb' : 'builtin');
            } catch (e) {
                Log.warn('Primary camera failed:', e?.message);
                try {
                    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                    State.set('currentCam', 'builtin');
                } catch (e2) {
                    Log.error('Fallback failed:', e2?.message);
                    loading?.classList.add('hidden');
                    noCam?.classList.remove('hidden');
                    $('#startCamBtn').style.display = 'block';
                    $('#noCamText').textContent = 'تعذّر تشغيل الكاميرا';
                    Toast.show('تعذّر الوصول للكاميرا', 'bad');
                    State.set('isStreaming', false);
                    return;
                }
            }

            const v = $('#vid');
            v.srcObject = stream;
            try { await v.play(); } catch (e) {}
            v.style.display = 'block';

            loading?.classList.add('hidden');
            noCam?.classList.add('hidden');
            $('#shutter').disabled = false;
            $('#camZone').classList.add('scanning');
            $('#camControls').classList.remove('hidden');

            // Update badge
            const badge = $('#camBadge');
            const badgeText = $('#camBadgeText');
            badge.classList.remove('hidden');
            badgeText.textContent = State.get('currentCam') === 'usb' ? 'USB' : 'داخلية';

            State.set('isStreaming', true);
            Bus.emit('camera:started');

            // Reset torch state on stream change
            torchOn = false;
            $('#btnTorch')?.classList.remove('active');
        }

        async function stop() {
            if (stream) {
                stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
                stream = null;
            }
            try { if (bridgeAvailable() && State.get('currentCam') === 'usb') Android.stopCamera(); } catch (e) {}
            State.set('isStreaming', false);
            $('#shutter').disabled = true;
            $('#vid').style.display = 'none';
            $('#camZone').classList.remove('scanning');
            $('#camControls').classList.add('hidden');
            $('#camBadge').classList.add('hidden');
            Bus.emit('camera:stopped');
        }

        async function toggle() {
            if (State.get('isCapturing')) return;
            await stop();
            // Toggle preference
            const cur = State.get('currentCam');
            State.set('camPref', cur === 'usb' ? 'builtin' : 'usb');
            Storage.set(Storage.KEY.CAMPREF, State.get('camPref'));
            await new Promise(r => setTimeout(r, 300));
            try {
                await start();
                Toast.show(`تم التبديل: ${State.get('currentCam') === 'usb' ? 'USB' : 'داخلية'}`, 'info');
            } catch (e) { Toast.show('فشل التبديل', 'bad'); }
        }

        async function toggleTorch() {
            if (!stream || State.get('currentCam') === 'usb') {
                Toast.show('الفلاش غير مدعوم', 'info');
                return;
            }
            const track = stream.getVideoTracks()[0];
            if (!track) return;
            try {
                const caps = track.getCapabilities?.();
                if (!caps?.torch) {
                    Toast.show('الفلاش غير متوفر', 'info');
                    return;
                }
                torchOn = !torchOn;
                await track.applyConstraints({ advanced: [{ torch: torchOn }] });
                $('#btnTorch')?.classList.toggle('active', torchOn);
                Haptic.tap();
            } catch (e) { Toast.show('تعذّر تشغيل الفلاش', 'info'); }
        }

        async function captureFrame(maxWidth, quality) {
            // Use native shim if available (USB or built-in)
            if (typeof window.captureNativeFrame === 'function') {
                return await window.captureNativeFrame(maxWidth, quality);
            }
            // Pure JS fallback
            const v = $('#vid');
            if (!v?.videoWidth) return '';
            const srcW = v.videoWidth, srcH = v.videoHeight;
            const ratio = (maxWidth && maxWidth < srcW) ? (maxWidth / srcW) : 1;
            const w = Math.round(srcW * ratio), h = Math.round(srcH * ratio);
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(v, 0, 0, w, h);
            return c.toDataURL('image/jpeg', (quality || 90) / 100).split(',')[1];
        }

        return { start, stop, toggle, toggleTorch, captureFrame, isUsbAvailable };
    })();

    // ═══ API CALLS ═══
    const API = (() => {
        async function checkInvoice(b64) {
            return Net.withRetry(async () => {
                const res = await Net.fetchWithTimeout(CONFIG.WORKER_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: 'claude-haiku-4-5-20251001',
                        max_tokens: 10,
                        messages: [{
                            role: 'user',
                            content: [
                                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
                                { type: 'text', text: 'هل هذه الصورة تحتوي على فاتورة أو إيصال طلب مطعم؟ أجب بكلمة واحدة فقط: yes أو no' },
                            ],
                        }],
                    }),
                }, CONFIG.REQUEST_TIMEOUT);

                const data = await res.json();
                if (data.error) throw new Error(data.error.message || 'API error');
                if (!data.content?.[0]) throw new Error('Unexpected response');
                return data.content[0].text.trim().toLowerCase().includes('yes');
            });
        }

        async function uploadInvoice(b64) {
            const url = State.get('sheetUrl');
            if (!url) throw new Error('Apps Script URL not configured');

            return Net.withRetry(async () => {
                await Net.fetchWithTimeout(url, {
                    method: 'POST',
                    mode: 'no-cors',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'processInvoice',
                        branchCode: State.get('branchCode'),
                        branchLabel: BRANCHES[State.get('branchCode')] || State.get('branchCode'),
                        imageBase64: b64,
                    }),
                }, CONFIG.REQUEST_TIMEOUT);
                // no-cors means we can't read the response but the request was sent
            });
        }

        return { checkInvoice, uploadInvoice };
    })();

    // ═══ CAPTURE FLOW ═══
    const Capture = (() => {
        async function start() {
            if (State.get('isCapturing')) return;

            const branch = State.get('branchCode');
            if (!branch || !BRANCHES[branch]) {
                Toast.show('اختر الفرع أولاً', 'bad');
                setTimeout(() => Admin.open(), 600);
                return;
            }
            if (!State.get('sheetUrl')) {
                Toast.show('أدخل رابط الشيت أولاً', 'bad');
                setTimeout(() => Admin.open(), 600);
                return;
            }
            if (!State.get('isOnline')) {
                Toast.show('لا يوجد اتصال بالإنترنت', 'bad');
                Audio.error();
                return;
            }
            if (!State.get('isStreaming')) {
                Toast.show('الكاميرا غير مفعّلة', 'bad');
                return;
            }

            State.set('isCapturing', true);
            $('#shutter').disabled = true;

            // Visual feedback
            const flash = $('#flash');
            flash.classList.add('go');
            setTimeout(() => flash.classList.remove('go'), 100);
            Audio.shutter();
            Haptic.click();
            ripple();

            // Show analyzing
            Analyzing.step(1);
            Analyzing.show();

            try {
                // Capture frames in parallel for max speed
                const [b64Check, b64Upload, b64Thumb] = await Promise.all([
                    Camera.captureFrame(CONFIG.CHECK_MAX_W, CONFIG.CHECK_QUALITY),
                    Camera.captureFrame(CONFIG.UPLOAD_MAX_W, CONFIG.UPLOAD_QUALITY),
                    Camera.captureFrame(CONFIG.THUMB_SIZE, CONFIG.THUMB_QUALITY),
                ]);

                if (!b64Check || !b64Upload) throw new Error('فشل التقاط الصورة');

                // Step 1: Quick invoice check
                const isInvoice = await API.checkInvoice(b64Check);

                if (!isInvoice) {
                    Analyzing.hide();
                    StatusOverlay.reject();
                    return;
                }

                // Step 2: Upload to Apps Script
                Analyzing.step(2);
                await API.uploadInvoice(b64Upload);

                Analyzing.hide();
                StatusOverlay.success();
                Haptic.success();

                // Update counter
                const newCount = State.get('count') + 1;
                State.set('count', newCount);
                Storage.set(Storage.KEY.COUNT, String(newCount));

                // Visual: scan box flash
                const sb = $('#scanBox');
                sb.classList.add('captured');
                setTimeout(() => sb.classList.remove('captured'), 800);

                // Add to history
                if (b64Thumb) History.add('data:image/jpeg;base64,' + b64Thumb);

            } catch (err) {
                Log.error('Capture flow error:', err);
                Analyzing.hide();
                Toast.show(err.message || 'حدث خطأ', 'bad');
                Haptic.error();
            } finally {
                State.set('isCapturing', false);
                $('#shutter').disabled = !State.get('isStreaming');
            }
        }

        function ripple() {
            const btn = $('#shutter');
            const r = document.createElement('span');
            r.className = 'ripple';
            btn.appendChild(r);
            setTimeout(() => r.remove(), 600);
        }

        return { start };
    })();

    // ═══ ADMIN PANEL ═══
    const Admin = (() => {
        function open() {
            $('#pinIn').value = '';
            $('#pinErr').style.display = 'none';
            $('#pinWrap').style.display = 'block';
            $('#settingsDiv').style.display = 'none';
            $('#adminOverlay').classList.add('on');
            setTimeout(() => $('#pinIn')?.focus(), 350);
        }

        function close() {
            $('#adminOverlay').classList.remove('on');
        }

        function checkPin() {
            const v = $('#pinIn').value;
            if (v.length < 4) return;
            if (v === CONFIG.ADMIN_PIN) {
                $('#pinWrap').style.display = 'none';
                $('#settingsDiv').style.display = 'block';
                $('#urlIn').value = State.get('sheetUrl');
                $('#branchSelect').value = State.get('branchCode');
                $('#camPrefSelect').value = State.get('camPref');
                $('#qualityPresetSelect').value = State.get('quality') || 'AUTO_BEST';

                refreshResolutionPicker();

                const cb = $('#currentBranch');
                const branch = State.get('branchCode');
                if (branch && BRANCHES[branch]) {
                    $('#cbValue').textContent = `${BRANCHES[branch]} (${branch})`;
                    cb.classList.remove('hidden');
                } else {
                    cb.classList.add('hidden');
                }
            } else {
                $('#pinErr').style.display = 'block';
                $('#pinIn').value = '';
                Haptic.error();
                setTimeout(() => $('#pinErr').style.display = 'none', 2000);
            }
        }

        function save() {
            const url = $('#urlIn').value.trim();
            const branch = $('#branchSelect').value;
            const newPref = $('#camPrefSelect').value;
            const newQuality = $('#qualityPresetSelect').value;

            if (!branch) {
                Toast.show('اختر الفرع', 'bad');
                return;
            }
            if (url && !url.startsWith('https://script.google.com')) {
                Toast.show('رابط الشيت غير صحيح', 'bad');
                return;
            }

            if (url) {
                State.set('sheetUrl', url);
                Storage.set(Storage.KEY.URL, url);
            }
            State.set('branchCode', branch);
            Storage.set(Storage.KEY.BRANCH, branch);

            const prefChanged = State.get('camPref') !== newPref;
            State.set('camPref', newPref);
            Storage.set(Storage.KEY.CAMPREF, newPref);

            const qualityChanged = State.get('quality') !== newQuality;
            State.set('quality', newQuality);
            Storage.set(Storage.KEY.QUALITY, newQuality);

            close();
            Toast.show('تم الحفظ', 'ok');
            Haptic.success();

            if ((prefChanged || qualityChanged) && State.get('isStreaming')) {
                setTimeout(() => Camera.toggle(), 200);
            }
        }

        function refreshResolutionPicker() {
            const group = $('#resolutionPickerGroup');
            const sel = $('#resolutionSelect');
            const hint = $('#currentResolutionHint');
            if (!group || !sel) return;

            // Only show when USB camera is streaming
            if (State.get('currentCam') !== 'usb' || !State.get('isStreaming')) {
                group.style.display = 'none';
                return;
            }

            let list = [];
            try {
                if (typeof window.getCameraResolutions === 'function') {
                    list = window.getCameraResolutions() || [];
                }
            } catch (e) { list = []; }

            if (list.length === 0) {
                group.style.display = 'none';
                return;
            }

            sel.innerHTML = '';
            list.forEach(r => {
                const opt = document.createElement('option');
                opt.value = `${r.width}x${r.height}x${r.fps}`;
                opt.textContent = r.label || `${r.width}×${r.height} @ ${r.fps}fps`;
                sel.appendChild(opt);
            });

            const cw = State.get('camWidth'), ch = State.get('camHeight'), cf = State.get('camFps');
            const cur = `${cw}x${ch}x${cf}`;
            sel.value = cur;
            if (hint) hint.textContent = `الحالية: ${cw}×${ch} @ ${cf}fps`;

            group.style.display = '';
            sel.onchange = () => {
                const [w, h, fps] = sel.value.split('x').map(n => parseInt(n, 10));
                if (typeof window.setCameraResolution === 'function') {
                    const ok = window.setCameraResolution(w, h, fps);
                    if (ok) {
                        Toast.show(`تم التبديل إلى ${w}×${h}@${fps}`, 'ok');
                    } else {
                        Toast.show('تعذّر التبديل', 'bad');
                    }
                }
            };
        }

        function populateBranchSelect() {
            const sel = $('#branchSelect');
            sel.innerHTML = '<option value="">— اختر الفرع —</option>';
            const sorted = Object.entries(BRANCHES)
                .sort((a, b) => a[1].localeCompare(b[1], 'ar'));
            sorted.forEach(([code, name]) => {
                const opt = document.createElement('option');
                opt.value = code;
                opt.textContent = `${name} (${code})`;
                if (code === State.get('branchCode')) opt.selected = true;
                sel.appendChild(opt);
            });
        }

        return { open, close, checkPin, save, populateBranchSelect, refreshResolutionPicker };
    })();

    // ═══ SECRET TAP (5x logo) ═══
    const SecretTap = (() => {
        let n = 0;
        let timer = null;
        function trigger() {
            n++;
            for (let i = 0; i < 5; i++) {
                const dot = $(`#t${i}`);
                dot?.classList.toggle('on', i < n);
            }
            clearTimeout(timer);
            timer = setTimeout(reset, 2500);
            if (n >= 5) {
                reset();
                Admin.open();
                Haptic.success();
            }
        }
        function reset() {
            n = 0;
            clearTimeout(timer);
            for (let i = 0; i < 5; i++) {
                $(`#t${i}`)?.classList.remove('on');
            }
        }
        return { trigger };
    })();

    // ═══ UI BINDINGS ═══
    function bindUI() {
        // State subscriptions
        State.on('count', (v) => {
            const el = $('#cnt');
            if (!el) return;
            el.textContent = v;
            el.classList.add('bump');
            setTimeout(() => el.classList.remove('bump'), 300);
        });

        State.on('branchCode', () => updateBranchBar());
        State.on('sheetUrl', (v) => setConn(!!v));
        State.on('currentCam', (v) => updateCamBadge());
        State.on('camWidth',   () => updateCamBadge());
        State.on('camHeight',  () => updateCamBadge());
        State.on('camFps',     () => updateCamBadge());

        function updateCamBadge() {
            const badge = $('#camBadge');
            const txt = $('#camBadgeText');
            if (!badge || !txt) return;
            const cam = State.get('currentCam');
            if (!cam) { badge.classList.add('hidden'); return; }
            badge.classList.remove('hidden');
            const w = State.get('camWidth'), h = State.get('camHeight'), f = State.get('camFps');
            const camLabel = cam === 'usb' ? 'USB' : 'داخلية';
            if (w > 0 && h > 0 && f > 0) {
                txt.textContent = `${camLabel} · ${w}×${h} @ ${f}fps`;
            } else {
                txt.textContent = camLabel;
            }
        }

        // Connectivity
        State.on('isOnline', (v) => setConn(v && State.get('sheetUrl')));
        window.addEventListener('online', () => State.set('isOnline', true));
        window.addEventListener('offline', () => State.set('isOnline', false));

        // Click handlers
        $('#brand')?.addEventListener('click', () => SecretTap.trigger());
        $('#shutter')?.addEventListener('click', () => Capture.start());
        $('#startCamBtn')?.addEventListener('click', () => Camera.start());
        $('#btnTorch')?.addEventListener('click', () => Camera.toggleTorch());
        $('#btnSwitch')?.addEventListener('click', () => Camera.toggle());
        $('#adminOverlay')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) Admin.close();
        });
        $('#adminClose')?.addEventListener('click', () => Admin.close());
        $('#pinIn')?.addEventListener('input', () => Admin.checkPin());
        $('#saveBtn')?.addEventListener('click', () => Admin.save());
        $('#camPrefSelect')?.addEventListener('change', (e) => {
            State.set('camPref', e.target.value);
            Storage.set(Storage.KEY.CAMPREF, e.target.value);
        });
        $('#lightbox')?.addEventListener('click', () => Lightbox.close());

        // Keyboard
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && !$('#shutter').disabled) {
                e.preventDefault();
                Capture.start();
            }
            if (e.code === 'Escape') {
                Admin.close();
                Lightbox.close();
            }
        });

        // First touch unlocks audio
        document.addEventListener('touchstart', () => Audio.init(), { once: true, passive: true });
        document.addEventListener('click', () => Audio.init(), { once: true });

        // USB camera events from shim
        window.addEventListener('usb-camera-ready', () => {
            Toast.show('تم اكتشاف كاميرا USB', 'ok');
            const pref = State.get('camPref');
            if (!State.get('isStreaming') && (pref === 'auto' || pref === 'usb')) {
                setTimeout(() => Camera.start(), 300);
            }
        });

        // Resolution change events (from native UVC)
        window.addEventListener('camera-resolution-changed', (e) => {
            const d = e.detail || {};
            State.set('camWidth',  d.width  || 0);
            State.set('camHeight', d.height || 0);
            State.set('camFps',    d.fps    || 0);
        });

        window.addEventListener('camera-resolutions-available', () => {
            // If admin panel is open, refresh the picker
            if ($('#adminOverlay')?.classList.contains('on')) {
                Admin.refreshResolutionPicker();
            }
        });

        window.addEventListener('usb-camera-disconnected', () => {
            if (State.get('currentCam') === 'usb') {
                Toast.show('USB انفصلت — جاري التبديل', 'warn');
                setTimeout(async () => {
                    await Camera.stop();
                    State.set('camPref', 'builtin');
                    await Camera.start();
                }, 600);
            }
        });

        // Visibility — auto-restart camera on resume
        document.addEventListener('visibilitychange', async () => {
            if (document.hidden) {
                Log.info('App hidden');
                return;
            }
            Log.info('App visible — checking camera health');
            // Small delay to let Android settle
            await new Promise(r => setTimeout(r, 350));
            const v = $('#vid');
            const stream = v?.srcObject;
            const track = stream?.getVideoTracks?.()[0];
            const trackEnded = !track || track.readyState === 'ended';
            const wasStreaming = State.get('isStreaming');
            if (wasStreaming && trackEnded) {
                Log.info('Track ended — auto-restarting camera');
                State.set('isStreaming', false);
                try { await Camera.start(); }
                catch (e) { Log.error('Auto-restart failed:', e); }
            } else if (!wasStreaming) {
                Log.info('Auto-starting camera after resume');
                try { await Camera.start(); }
                catch (e) { /* ignore */ }
            }
        });

        // Periodic camera health check (every 5s)
        setInterval(() => {
            if (document.hidden) return;
            if (!State.get('isStreaming')) return;
            const stream = $('#vid')?.srcObject;
            const track = stream?.getVideoTracks?.()[0];
            if (track && track.readyState === 'ended') {
                Log.warn('Camera track ended unexpectedly — restarting');
                State.set('isStreaming', false);
                Camera.start().catch(() => {});
            }
        }, 5000);
    }

    function setConn(ok) {
        const el = $('#conn');
        if (!el) return;
        el.className = 'conn' + (ok ? ' ok' : '');
        $('#connTxt').textContent = ok ? 'متصل' : 'غير متصل';
    }

    function updateBranchBar() {
        const el = $('#branchInfo');
        if (!el) return;
        const code = State.get('branchCode');
        if (code && BRANCHES[code]) {
            el.innerHTML = `${BRANCHES[code]} · <span>${code}</span>`;
            el.className = 'branch-info';
        } else {
            el.textContent = 'يجب تحديد الفرع';
            el.className = 'branch-info warn';
        }
    }

    // ═══ APP BOOT ═══
    async function boot() {
        Log.info(`DLVR ${CONFIG.VERSION} booting...`);

        // Initial UI state
        $('#cnt').textContent = State.get('count');
        if (State.get('sheetUrl')) setConn(true);
        updateBranchBar();
        Admin.populateBranchSelect();
        Date_.setupDateChip();
        Date_.checkDailyReset();
        Date_.scheduleNextReset();
        History.load();
        History.render();

        bindUI();

        // Auto-start camera with smooth UX
        await new Promise(r => setTimeout(r, 250));
        try {
            await Camera.start();
        } catch (e) {
            Log.error('Auto-start failed:', e);
            $('#camLoading').classList.add('hidden');
            $('#noCam').classList.remove('hidden');
            $('#startCamBtn').style.display = 'block';
            $('#noCamText').textContent = 'الكاميرا غير مفعّلة';
        }

        Log.info('DLVR ready.');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
