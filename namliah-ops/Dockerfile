# منصة عمليات نملية — صورة إنتاج (بديل لتشغيل systemd المباشر)
FROM node:22-bookworm-slim

# أدوات بناء better-sqlite3 (تُزال بعد التثبيت لتصغير الصورة)
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# قاعدة البيانات في حجم دائم
ENV DB_PATH=/data/namliah.db
ENV PORT=3000
VOLUME ["/data"]
EXPOSE 3000

# أنشئ مجلد البيانات وابذر إن كانت القاعدة غير موجودة، ثم شغّل
CMD ["sh", "-c", "mkdir -p /data && [ -f /data/namliah.db ] || node scripts/seed.js; node server.js"]
