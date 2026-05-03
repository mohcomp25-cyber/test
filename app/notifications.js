import { store } from './store.js';

const CHANNEL_LABELS = {
  'in-app': 'تنبيه داخلي',
  email: 'بريد إلكتروني',
  sms: 'رسالة SMS',
  whatsapp: 'واتساب',
};

export function logChannelLabel(type) {
  return CHANNEL_LABELS[type] || type;
}

export function sendMockNotification({ channel, to, subject, body }) {
  store.appendActivity({
    type: channel,
    to: to || '',
    subject: subject || '',
    body: body || '',
    status: 'mock-sent',
  });
}

export function sendBatchAlert(items, channels = ['in-app']) {
  if (!items || !items.length) return 0;
  let count = 0;
  channels.forEach((channel) => {
    items.forEach((it) => {
      sendMockNotification({
        channel,
        to: channel === 'in-app' ? 'لوحة التحكم' : 'مسؤول HR',
        subject: `تنبيه: ${it.title} — ${labelKind(it.kind)}`,
        body: `الانتهاء بتاريخ ${it.expiry}، متبقي ${it.daysLeft} يوم`,
      });
      count++;
    });
  });
  return count;
}

function labelKind(kind) {
  return ({
    registration: 'سجل تجاري',
    license: 'ترخيص',
    iqama: 'إقامة',
    contract: 'عقد عمل',
  })[kind] || kind;
}
