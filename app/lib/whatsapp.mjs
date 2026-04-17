/*
  WhatsApp notification stub.

  في وضع التجريب: يطبع الرسالة في الكونسول فقط.
  عند جاهزية رقم الواتساب التجاري + اعتماد قالب على Meta Cloud API:
    - ضع WHATSAPP_TOKEN و WHATSAPP_PHONE_ID في المتغيرات البيئية
    - ضع WHATSAPP_TEMPLATE_NAME لاسم القالب المعتمد
    - الدالة تبعث الرسالة تلقائياً عبر Cloud API
*/

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const TEMPLATE = process.env.WHATSAPP_TEMPLATE_NAME;

function normalizeNumber(raw) {
  // إزالة كل شيء عدا الأرقام
  let n = String(raw).replace(/\D/g, '');
  // السعودية: 05xxxxxxxx => 9665xxxxxxxx
  if (n.startsWith('0')) n = '966' + n.slice(1);
  return n;
}

export async function sendWhatsApp({ to, fullName, campaignTitle, slotDatetime, location, status }) {
  const number = normalizeNumber(to);
  const when = slotDatetime ? new Date(slotDatetime).toLocaleString('ar-SA') : '';
  const statusAr = status === 'approved' ? 'تم اعتماد' : 'تم رفض';

  const body =
    `مرحباً ${fullName}،\n` +
    `${statusAr} طلب حضورك في حملة: ${campaignTitle}.\n` +
    (status === 'approved'
      ? `الموعد: ${when}\nالموقع: ${location || 'سيُرسل لاحقاً'}\n\nنراك قريباً!`
      : `نعتذر، لا تتوفر مواعيد متاحة حالياً. بالتوفيق.`);

  if (!TOKEN || !PHONE_ID || !TEMPLATE) {
    console.log('\n=== [WhatsApp Stub] ===');
    console.log(`إلى: +${number}`);
    console.log(body);
    console.log('=======================\n');
    return { ok: true, stub: true };
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: number,
        type: 'template',
        template: {
          name: TEMPLATE,
          language: { code: 'ar' },
          components: [{
            type: 'body',
            parameters: [
              { type: 'text', text: fullName },
              { type: 'text', text: campaignTitle },
              { type: 'text', text: when },
              { type: 'text', text: location || '' },
            ],
          }],
        },
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('[WhatsApp] send failed', data);
      return { ok: false, error: data };
    }
    return { ok: true, data };
  } catch (err) {
    console.error('[WhatsApp] error', err);
    return { ok: false, error: String(err) };
  }
}
