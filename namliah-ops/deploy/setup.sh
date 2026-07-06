#!/usr/bin/env bash
# إعداد أول مرة لمنصة نملية على VPS (Ubuntu/Debian).
# شغّله بصلاحية sudo:  sudo bash deploy/setup.sh
set -euo pipefail

APP_DIR="/opt/namliah-ops"
APP_USER="namliah"
NODE_MAJOR="22"

echo "==> تثبيت المتطلبات (Node ${NODE_MAJOR}, أدوات البناء، Caddy، sqlite3)"
apt-get update
apt-get install -y ca-certificates curl gnupg build-essential python3 sqlite3

# Node.js من NodeSource
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

# Caddy
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

echo "==> إنشاء مستخدم الخدمة $APP_USER"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"

echo "==> تجهيز مجلد التطبيق $APP_DIR"
# انسخ الكود إلى $APP_DIR (git clone أو rsync) قبل تشغيل هذا السكربت، أو مرّر المصدر:
if [ ! -d "$APP_DIR/namliah-ops" ] && [ ! -f "$APP_DIR/server.js" ]; then
  echo "⚠  ضع كود namliah-ops في $APP_DIR أولاً (git clone ... $APP_DIR)"
fi

cd "$APP_DIR"
sudo -u "$APP_USER" npm ci --omit=dev
mkdir -p "$APP_DIR/data" && chown -R "$APP_USER:$APP_USER" "$APP_DIR"

if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  # ولّد أسراراً عشوائية
  sed -i "s#^SESSION_SECRET=.*#SESSION_SECRET=$(openssl rand -hex 32)#" "$APP_DIR/.env"
  sed -i "s#^WEBHOOK_SECRET_JEDDAH=.*#WEBHOOK_SECRET_JEDDAH=$(openssl rand -hex 24)#" "$APP_DIR/.env"
  sed -i "s#^COOKIE_SECURE=.*#COOKIE_SECURE=1#" "$APP_DIR/.env"
  echo "✔ أُنشئ .env بأسرار عشوائية — راجعه وأضف APIFY_TOKEN و GOOGLE_MAPS_URL_JEDDAH"
fi

echo "==> بذر أولي (مستخدمون + بيانات عرض — احذفها بـ npm run wipe-demo عند الربط الفعلي)"
sudo -u "$APP_USER" node scripts/seed.js || true

echo "==> تركيب خدمة systemd"
cp "$APP_DIR/deploy/namliah-ops.service" /etc/systemd/system/namliah-ops.service
systemctl daemon-reload
systemctl enable --now namliah-ops
systemctl status namliah-ops --no-pager -l | head -8

echo "==> جدولة النسخ الاحتياطي (4 فجراً يومياً)"
chmod +x "$APP_DIR/deploy/backup.sh"
( crontab -l 2>/dev/null | grep -v backup.sh; echo "0 4 * * * $APP_DIR/deploy/backup.sh >> /var/log/namliah-backup.log 2>&1" ) | crontab -

cat <<'DONE'

============================================================
 تم! الخطوات الأخيرة يدوياً:
 1) عدّل /etc/caddy/Caddyfile بدومينك (انسخه من deploy/Caddyfile) ثم:
      sudo systemctl reload caddy
 2) وجّه سجل A للدومين نحو IP هذا السيرفر.
 3) افتح https://<دومينك> وغيّر كلمات مرور ops و admin.
 4) عند الربط بفودكس: sudo -u namliah npm run wipe-demo
============================================================
DONE
