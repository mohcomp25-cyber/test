# نشر منصة نملية على VPS

دليل من صفحة واحدة لتشغيل المنصة على سيرفر خاص برابط HTTPS دائم.

## المتطلبات
- VPS بنظام Ubuntu 22.04+ (أي مزود: Hetzner / DigitalOcean / STC Cloud / …) — 1 vCPU و1GB RAM يكفي.
- دومين (أو ساب‑دومين) تُوجّه سجل `A` منه نحو IP السيرفر.

## التركيب السريع (سكربت آلي)

```bash
# على السيرفر، كـ root أو بـ sudo:
sudo mkdir -p /opt/namliah-ops
sudo git clone https://github.com/mohcomp25-cyber/test.git /tmp/namliah
sudo cp -r /tmp/namliah/namliah-ops/. /opt/namliah-ops/
cd /opt/namliah-ops
sudo bash deploy/setup.sh
```

السكربت يثبّت Node وCaddy وsqlite، ينشئ مستخدم خدمة، يبني الاعتماديات، يولّد `.env` بأسرار عشوائية، يبذر بيانات أولية، يركّب خدمة systemd تعمل عند الإقلاع، ويجدول النسخ الاحتياطي.

بعده، خطوتان يدويتان فقط:

```bash
# 1) الدومين + HTTPS (Caddy يجلب الشهادة تلقائياً)
sudo cp /opt/namliah-ops/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile        # ضع دومينك مكان ops.namliah.example.com
sudo systemctl reload caddy

# 2) افتح https://<دومينك> وسجّل دخول ops / admin ثم غيّر كلمات المرور
```

## الإعدادات المهمة في `.env`
راجع `/opt/namliah-ops/.env` بعد السكربت وأضف:
- `WEBHOOK_SECRET_JEDDAH` — مفتاح فودكس/الوورك فلو (وُلّد تلقائياً، انسخه لـ n8n).
- `APIFY_TOKEN` و `GOOGLE_MAPS_URL_JEDDAH` — لمزامنة مراجعات قوقل.
- `COOKIE_SECURE=1` — مفعّل تلقائياً (إلزامي خلف HTTPS).

بعد أي تعديل على `.env`: `sudo systemctl restart namliah-ops`

## التشغيل اليومي

```bash
sudo systemctl status namliah-ops     # الحالة
sudo journalctl -u namliah-ops -f     # السجلات الحية
sudo systemctl restart namliah-ops    # إعادة تشغيل
```

## التحديث لإصدار جديد

```bash
cd /opt/namliah-ops
sudo git -C /tmp/namliah pull || sudo git clone https://github.com/mohcomp25-cyber/test.git /tmp/namliah
sudo cp -r /tmp/namliah/namliah-ops/. /opt/namliah-ops/
sudo -u namliah npm ci --omit=dev
sudo systemctl restart namliah-ops
```
قاعدة البيانات في `data/namliah.db` لا تُمس، والهجرات تُطبّق تلقائياً عند الإقلاع.

## الربط الفعلي بفودكس
عند جاهزية الوورك فلو، امسح بيانات العرض مرة واحدة:
```bash
cd /opt/namliah-ops && sudo -u namliah npm run wipe-demo
```
ثم وجّه n8n إلى `https://<دومينك>/api/webhook/sales` بمفتاح `WEBHOOK_SECRET_JEDDAH` (راجع `docs/foodics-n8n.md`).

## بديل: Docker
إن كنت تفضّل الحاويات، الصورة جاهزة (`Dockerfile`) بحجم دائم `/data`:
```bash
docker build -t namliah-ops .
docker run -d --name namliah-ops -p 3000:3000 \
  --env-file .env -v namliah-data:/data --restart unless-stopped namliah-ops
```
ثم ضع Caddy أمامه كما أعلاه.

## النسخ الاحتياطي
مجدول تلقائياً 4 فجراً إلى `/opt/namliah-backups` (يحفظ 30 يوماً). لاستعادة نسخة:
```bash
sudo systemctl stop namliah-ops
gunzip -c /opt/namliah-backups/namliah-YYYY-MM-DD_HHMM.db.gz > /opt/namliah-ops/data/namliah.db
sudo systemctl start namliah-ops
```
