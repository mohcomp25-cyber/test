// أدوات عرض HTML بسيطة مع حماية XSS

export function escape(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// محوّل سلسلة قالب يهرب القيم تلقائياً. استخدم ${raw(...)} لإدراج HTML جاهز.
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) {
      const v = values[i];
      if (v && typeof v === 'object' && v.__raw) {
        out += v.value;
      } else if (Array.isArray(v)) {
        out += v.map(x => (x && x.__raw ? x.value : escape(x))).join('');
      } else {
        out += escape(v);
      }
    }
  });
  return { __raw: true, value: out };
}

export function raw(value) {
  return { __raw: true, value: String(value) };
}

export function layout({ title, body, admin = false, flash = null }) {
  const nav = admin
    ? html`
        <nav class="nav">
          <a href="/admin" class="brand">لوحة التحكم</a>
          <div class="nav-links">
            <a href="/admin/campaigns">الحملات</a>
            <a href="/admin/registrations">السجلات</a>
            <a href="/" target="_blank">الموقع العام</a>
            <form method="POST" action="/api/admin/logout" style="display:inline">
              <button class="link-btn" type="submit">خروج</button>
            </form>
          </div>
        </nav>`
    : html`
        <nav class="nav">
          <a href="/" class="brand">حملات البلوقرز</a>
          <div class="nav-links">
            <a href="/admin">دخول الأدمن</a>
          </div>
        </nav>`;

  const flashHtml = flash
    ? html`<div class="flash flash-${flash.type}">${flash.message}</div>`
    : raw('');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(title)} — منصة الحملات</title>
  <link rel="stylesheet" href="/public/styles.css">
</head>
<body>
  ${nav.value}
  <main class="container">
    ${flashHtml.value}
    ${body.value}
  </main>
  <footer class="footer">© منصة تنسيق حملات البلوقرز</footer>
</body>
</html>`;
}

export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('ar-SA', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

export function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('ar-SA', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
}
