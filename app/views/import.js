import { el, setView, pageHeader, toast, field, input } from '../ui.js';
import { downloadEmployeesTemplate, parseEmployeesFile, commitEmployeesImport, exportEmployeesExcel, EMPLOYEE_COLUMNS } from '../excel.js';
import { store } from '../store.js';
import { navigate } from '../router.js';

export function renderImport() {
  const fileInput = input({ type: 'file', accept: '.xlsx,.xls,.csv' });
  const previewHost = el('div', {});

  let parsed = null;

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      parsed = await parseEmployeesFile(file);
      previewHost.replaceChildren(buildPreview(parsed));
    } catch (err) {
      previewHost.replaceChildren(el('div', { class: 'import-error' }, 'فشل قراءة الملف: ' + err.message));
    }
  });

  setView([
    pageHeader('استيراد بيانات العمالة من Excel'),
    el('div', { class: 'card' }, [
      el('p', {}, 'اتبع الخطوات التالية لاستيراد بيانات العمالة:'),
      el('ol', {}, [
        el('li', {}, [
          'حمّل قالب Excel جاهز ',
          el('button', { class: 'btn-ghost btn-sm', onClick: () => downloadEmployeesTemplate() }, 'تحميل القالب'),
        ]),
        el('li', {}, 'املأ الصفوف بالبيانات (يدعم القالب التواريخ بصيغة yyyy-mm-dd أو dd/mm/yyyy).'),
        el('li', {}, 'ارفع الملف هنا، تحقق من المعاينة، ثم أكمل الاستيراد.'),
      ]),
      el('div', { class: 'form-grid' }, [
        field('ملف Excel', fileInput),
      ]),
      el('p', { class: 'hint' }, [
        'أعمدة القالب: ',
        EMPLOYEE_COLUMNS.map((c) => c.label).join('، '),
      ]),
      previewHost,
    ]),
    el('div', { class: 'card', style: { marginTop: '14px' } }, [
      el('h3', { style: { marginTop: 0 } }, 'تصدير'),
      el('p', {}, 'تصدير قائمة العمالة الحالية إلى ملف Excel.'),
      el('button', { class: 'btn-secondary', onClick: () => exportEmployeesExcel() }, 'تصدير العمالة إلى Excel'),
    ]),
  ]);

  function buildPreview({ rows, errors }) {
    if (!rows.length) {
      return el('div', { class: 'import-warning' }, 'لا توجد صفوف للاستيراد.');
    }
    const errorBox = errors.length
      ? el('div', { class: 'import-warning' }, [
        el('strong', {}, `${errors.length} ملاحظة:`),
        el('ul', {}, errors.slice(0, 10).map((er) => el('li', {}, er))),
        errors.length > 10 ? el('div', {}, `…و ${errors.length - 10} أخرى`) : null,
      ])
      : null;

    const head = EMPLOYEE_COLUMNS.map((c) => c.label);
    const previewRows = rows.slice(0, 20);

    return el('div', {}, [
      errorBox,
      el('p', {}, `سيتم استيراد ${rows.length} صف. (المعاينة: أول ${previewRows.length})`),
      el('div', { class: 'import-preview' }, el('table', { class: 'data' }, [
        el('thead', {}, el('tr', {}, head.map((h) => el('th', {}, h)))),
        el('tbody', {}, previewRows.map((r) => el('tr', {},
          EMPLOYEE_COLUMNS.map((c) => el('td', {}, r[c.key] || '—'))
        ))),
      ])),
      el('div', { class: 'form-actions' }, [
        el('button', { class: 'btn', onClick: () => {
          const added = commitEmployeesImport(rows);
          toast(`تم استيراد ${added} عامل`, 'success');
          navigate('#/employees');
        } }, `استيراد ${rows.length} صف`),
      ]),
    ]);
  }
}
