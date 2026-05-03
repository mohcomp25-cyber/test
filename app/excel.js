import * as XLSX from 'xlsx';
import { store, uid } from './store.js';

export const EMPLOYEE_COLUMNS = [
  { key: 'fullName',     label: 'الاسم الكامل', required: true },
  { key: 'nationality',  label: 'الجنسية' },
  { key: 'iqamaNumber',  label: 'رقم الإقامة' },
  { key: 'iqamaExpiry',  label: 'تاريخ انتهاء الإقامة', isDate: true },
  { key: 'jobTitle',     label: 'الوظيفة' },
  { key: 'salary',       label: 'الراتب' },
  { key: 'phone',        label: 'الجوال' },
  { key: 'contractStart',label: 'تاريخ بداية العقد', isDate: true },
  { key: 'contractEnd',  label: 'تاريخ نهاية العقد', isDate: true },
  { key: 'contractType', label: 'نوع العقد' },
  { key: 'branchName',   label: 'الفرع' },
];

export function downloadEmployeesTemplate() {
  const headers = EMPLOYEE_COLUMNS.map((c) => c.label);
  const sample = [
    ['أحمد محمد', 'سعودي', '', '', 'مدير', '12000', '0501234567', '2024-01-01', '2025-01-01', 'محدد', 'الرياض'],
    ['سامي علي', 'مصري', '2123456789', '2025-08-15', 'محاسب', '5000', '0509876543', '2023-06-01', '2025-06-01', 'محدد', 'جدة'],
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...sample]);
  ws['!cols'] = headers.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Employees');
  XLSX.writeFile(wb, 'employees-template.xlsx');
}

export async function parseEmployeesFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf);
  const wsName = wb.SheetNames[0];
  const ws = wb.Sheets[wsName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
  if (!rows.length) return { rows: [], errors: ['الملف فارغ أو لا يحتوي على بيانات'] };

  const labelToKey = Object.fromEntries(EMPLOYEE_COLUMNS.map((c) => [c.label, c.key]));
  const result = [];
  const errors = [];

  rows.forEach((rawRow, i) => {
    const lineNo = i + 2;
    const r = {};
    let hasAny = false;
    Object.entries(rawRow).forEach(([k, v]) => {
      const key = labelToKey[k.trim()] || k;
      if (v !== '' && v != null) hasAny = true;
      const col = EMPLOYEE_COLUMNS.find((c) => c.key === key);
      if (col?.isDate && v) {
        const norm = normalizeDate(v);
        if (!norm) errors.push(`السطر ${lineNo}: تاريخ غير صالح في "${col.label}" (${v})`);
        r[key] = norm || '';
      } else {
        r[key] = String(v || '').trim();
      }
    });
    if (!hasAny) return;
    if (!r.fullName) errors.push(`السطر ${lineNo}: حقل "الاسم الكامل" مطلوب`);
    result.push({ _line: lineNo, ...r });
  });

  return { rows: result, errors };
}

export function commitEmployeesImport(parsedRows) {
  const estId = store.currentEstId();
  if (!estId) throw new Error('لا توجد جلسة');
  const branchByName = {};
  store.list('branches').forEach((b) => { branchByName[b.name] = b.id; });

  let added = 0;
  parsedRows.forEach((r) => {
    const branchId = r.branchName ? (branchByName[r.branchName] || null) : null;
    store.upsert('employees', {
      id: uid('emp'),
      estId,
      branchId,
      fullName: r.fullName,
      nationality: r.nationality || '',
      iqamaNumber: r.iqamaNumber || '',
      iqamaExpiry: r.iqamaExpiry || '',
      jobTitle: r.jobTitle || '',
      salary: r.salary || '',
      phone: r.phone || '',
      contractStart: r.contractStart || '',
      contractEnd: r.contractEnd || '',
      contractType: r.contractType || '',
      attachments: [],
      createdAt: new Date().toISOString(),
    });
    added++;
  });
  return added;
}

function normalizeDate(v) {
  if (!v) return '';
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();

  // try Excel serial number
  const num = Number(s);
  if (!isNaN(num) && num > 20000 && num < 60000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + num * 86400000);
    return d.toISOString().slice(0, 10);
  }

  // ISO format yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // dd/mm/yyyy or d-m-yyyy
  const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = '20' + y;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Date.parse fallback
  const t = Date.parse(s);
  if (!isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return '';
}

export function exportEmployeesExcel() {
  const employees = store.list('employees');
  const branchNameById = {};
  store.list('branches').forEach((b) => { branchNameById[b.id] = b.name; });
  const headers = EMPLOYEE_COLUMNS.map((c) => c.label);
  const data = employees.map((e) => EMPLOYEE_COLUMNS.map((c) => {
    if (c.key === 'branchName') return branchNameById[e.branchId] || '';
    return e[c.key] ?? '';
  }));
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws['!cols'] = headers.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Employees');
  XLSX.writeFile(wb, `employees-${new Date().toISOString().slice(0,10)}.xlsx`);
}
