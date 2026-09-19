/* ============== Core parsing & calculation logic ============== */

function readCell(ws, col, row) {
  const v = ws[col + row];
  if (v === undefined || v === null) return null;
  return (typeof v === 'object' && 'v' in v) ? v.v : v;
}

function parseNumericValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x660))
    .replace(/[٫،]/g, '.').replace(/,/g, '').trim();
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function readNumericCell(ws, col, row) {
  return parseNumericValue(readCell(ws, col, row));
}

function numToColLetter(n) {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function colLettersInRange(firstCol, lastCol) {
  const letters = [];
  for (let c = firstCol; c <= lastCol; c++) letters.push(numToColLetter(c));
  return letters;
}

function parseWorkbookData(ws, range) {
  const { firstRow, lastRow, firstCol, lastCol } = range;
  let studentName = null, studentCode = null;
  const semesterTitles = [];
  const headerRows = [];
  let summaryFinal = null;
  const courseRows = [];
  let summaryLabelRows = 0;
  let courseCodeRows = 0;
  let courseNameRows = 0;
  let numericHoursRows = 0;
  const allCols = colLettersInRange(firstCol, lastCol);

  for (let row = firstRow; row <= lastRow; row++) {
    const xVal = readCell(ws, 'X', row);
    const cVal = readCell(ws, 'C', row);
    const rVal = readCell(ws, 'R', row);

    if (typeof xVal === 'string') {
      if (xVal.includes('اسم الطالب')) studentName = String(readCell(ws, 'K', row) ?? '').trim();
      if (xVal.includes('رقم الطالب')) studentCode = String(readCell(ws, 'K', row) ?? '').trim();
    }
    if (typeof rVal === 'string' && rVal.includes('الفصل الدراسي')) {
      semesterTitles.push({ row, title: rVal });
    }
    if (cVal === 'التقدير') headerRows.push(row);

    {
      let qp = null, totalHours = null, transcriptCgpa = null, isSummaryRow = false;
      for (const col of allCols) {
        const cell = readCell(ws, col, row);
        if (typeof cell === 'string') {
          const t = cell.trim();
          if (t.startsWith('إجمالي نقاط الجودة')) { summaryLabelRows++; isSummaryRow = true; qp = parseNumericValue(t.split(':')[1]); }
          if (t.startsWith('الساعات المكتسبة')) totalHours = parseNumericValue(t.split(':')[1]);
          if (t.includes('المعدل التراكم')) transcriptCgpa = parseNumericValue(t.split(':')[1]);
        }
      }
      if (isSummaryRow) summaryFinal = { row, qualityPoints: qp, totalHours, transcriptCgpa };
    }

    const zVal = readCell(ws, 'Z', row);
    const nVal = readNumericCell(ws, 'N', row);
    if (typeof zVal === 'string' && zVal.trim() && zVal.trim() !== 'كود المقرر') courseCodeRows++;
    if (rVal != null) courseNameRows++;
    if (nVal !== null) numericHoursRows++;
    if (
      typeof zVal === 'string' && zVal.trim() && zVal.trim() !== 'كود المقرر' &&
      rVal != null && nVal !== null && cVal !== 'التقدير'
    ) {
      const lVal = readNumericCell(ws, 'L', row);
      const mVal = readNumericCell(ws, 'M', row);
      courseRows.push({
        row, code: zVal.trim(), grade: String(cVal ?? '').trim(),
        L: lVal ?? 0,
        M: mVal,
        N: nVal, name: rVal
      });
    }
  }
  return {
    studentName, studentCode, semesterTitles, headerRows, summaryFinal, courseRows,
    diagnosticCounts: { summaryLabelRows, courseCodeRows, courseNameRows, numericHoursRows }
  };
}

function getTranscriptDiagnostic(parsed) {
  const reasons = [];
  const counts = parsed.diagnosticCounts;
  if (!parsed.summaryFinal) {
    reasons.push('لم يتم العثور على صف الملخص الذي يحتوي على "إجمالي نقاط الجودة"');
  } else if (parsed.summaryFinal.totalHours === null) {
    reasons.push('تم العثور على صف الملخص، لكن قيمة "الساعات المكتسبة" غير رقمية أو غير موجودة');
  }
  if (!parsed.courseRows.length) {
    reasons.push(
      `لم يتم العثور على صفوف مقررات مكتملة: كود المقرر في Z=${counts.courseCodeRows}، ` +
      `اسم المقرر في R=${counts.courseNameRows}، الساعات الرقمية في N=${counts.numericHoursRows}`
    );
    reasons.push('المطلوب أن تحتوي صفوف المقررات على كود في Z واسم في R وساعات رقمية في N');
  }
  return reasons.length ? reasons.join('؛ ') : 'سبب غير محدد';
}

function computeResults(parsed) {
  const { courseRows, summaryFinal, semesterTitles } = parsed;
  const groups = {};
  courseRows.forEach(cr => { (groups[cr.code] = groups[cr.code] || []).push(cr); });

  const inclusion = {};
  Object.values(groups).forEach(list => {
    if (list.length === 1) {
      inclusion[list[0].row] = { ak: true, am: true };
    } else {
      let best = list[0];
      list.forEach(cr => { if (cr.L > best.L) best = cr; });
      list.forEach(cr => {
        if (cr === best) inclusion[cr.row] = { ak: true, am: true };
        else if (cr.L === 0) inclusion[cr.row] = { ak: true, am: false };
        else inclusion[cr.row] = { ak: false, am: false };
      });
    }
  });

  let excludedTRHours = 0, AK_total = 0, AM_total = 0;
  courseRows.forEach(cr => {
    if (cr.grade === 'TR') excludedTRHours += (cr.N || 0);
    const inc = inclusion[cr.row] || { ak: true, am: true };
    if (inc.ak) AK_total += (cr.L || 0) * (cr.N || 0);
    if (inc.am) AM_total += (typeof cr.M === 'number' ? cr.M : 0) * (cr.N || 0);
  });

  const totalHours = summaryFinal ? summaryFinal.totalHours : 0;
  const denominator = (totalHours || 0) - excludedTRHours;
  const cgpaCalc = denominator ? AK_total / denominator : 0;
  const percentCalc = denominator ? AM_total / denominator : 0;
  const cgpaCalcRounded = Math.round(cgpaCalc * 100) / 100;
  const percentCalcRounded = Math.round(percentCalc * 100) / 100;

  const termCount = semesterTitles.filter(s => !s.title.includes('معادلة') && !s.title.includes('صيف')).length;

  function letterFor(g) {
    if (g >= 4.0) return { letter: 'A', desc: 'امتياز' };
    if (g >= 3.7) return { letter: 'A-', desc: 'امتياز' };
    if (g >= 3.3) return { letter: 'B+', desc: 'جيد جدا' };
    if (g >= 3.0) return { letter: 'B', desc: 'جيد جدا' };
    if (g >= 2.7) return { letter: 'C+', desc: 'جيد' };
    if (g >= 2.3) return { letter: 'C', desc: 'جيد' };
    if (g >= 2.0) return { letter: 'D', desc: 'مقبول' };
    return { letter: 'F', desc: 'راسب' };
  }
  const { letter, desc } = letterFor(cgpaCalc);
  const transcriptCgpa = summaryFinal ? summaryFinal.transcriptCgpa : null;
  const mismatch = transcriptCgpa != null && Math.abs(cgpaCalcRounded - transcriptCgpa) > 0.005;

  return {
    AK_total, AM_total, denominator, excludedTRHours,
    cgpaCalc, cgpaCalcRounded, percentCalc, percentCalcRounded,
    termCount, letter, desc, mismatch, transcriptCgpa, totalHours, inclusion
  };
}

function decodeRefRange(ref) {
  const [a, b] = ref.split(':');
  const parseAddr = (addr) => {
    const m = addr.match(/^([A-Z]+)(\d+)$/);
    let col = 0;
    for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
    return { col, row: parseInt(m[2], 10) };
  };
  const s = parseAddr(a), e = b ? parseAddr(b) : s;
  return { firstRow: s.row, lastRow: e.row, firstCol: s.col, lastCol: e.col };
}

/* ============== App state & UI wiring ============== */

const records = []; // {id, origName, ext, arrayBuffer, wb, ws, range, parsed, results, error}
let seq = 0;

const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const fileListEl = document.getElementById('fileList');
const logEl = document.getElementById('log');

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag');
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', e => { handleFiles(e.target.files); e.target.value = ''; });

function log(msg) { logEl.textContent = msg; }

async function handleFiles(fileList) {
  const files = Array.from(fileList).filter(f => /\.(xlsx|xls)$/i.test(f.name));
  if (!files.length) return;
  for (const file of files) {
    const id = ++seq;
    const rec = { id, origName: file.name, ext: file.name.slice(file.name.lastIndexOf('.')), error: null };
    records.push(rec);
    try {
      const buf = await file.arrayBuffer();
      rec.arrayBuffer = buf;
      const wb = XLSX.read(buf, { type: 'array' });
      const sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const range = decodeRefRange(ws['!ref']);
      const parsed = parseWorkbookData(ws, range);
      if (!parsed.summaryFinal || !parsed.courseRows.length) {
        rec.error = 'تعذر التعرف على تركيبة الترانسكريبت: ' + getTranscriptDiagnostic(parsed);
      } else {
        rec.wb = wb; rec.ws = ws; rec.range = range;
        rec.parsed = parsed;
        rec.results = computeResults(parsed);
      }
    } catch (err) {
      rec.error = 'تعذرت قراءة الملف (' + err.message + ')';
    }
  }
  renderFileList();
  updateButtons();
}

function renderFileList() {
  fileListEl.innerHTML = '';
  records.forEach(rec => {
    const row = document.createElement('div');
    row.className = 'file-row';
    let badge, meta;
    if (rec.error) {
      badge = `<span class="badge err">تعذر التحليل</span>`;
      meta = `<span class="sname">${rec.origName}</span><span class="fname">${rec.error}</span>`;
    } else {
      const r = rec.results;
      const cls = r.mismatch ? 'warn' : 'ok';
      const label = r.mismatch ? `⚠ اختلاف: ${r.cgpaCalcRounded} بدل ${r.transcriptCgpa}` : `مطابق — cGPA ${r.cgpaCalcRounded}`;
      badge = `<span class="badge ${cls}">${label}</span>`;
      meta = `<span class="sname">${rec.parsed.studentName || '(بدون اسم)'} — كود ${rec.parsed.studentCode || '-'}</span><span class="fname">${rec.origName}</span>`;
    }
    row.innerHTML = `<div class="fmeta">${meta}</div><div style="display:flex;align-items:center;gap:10px;">${badge}<button class="remove-btn" title="إزالة" data-id="${rec.id}">✕</button></div>`;
    fileListEl.appendChild(row);
  });
  fileListEl.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id, 10);
      const idx = records.findIndex(r => r.id === id);
      if (idx > -1) records.splice(idx, 1);
      renderFileList();
      updateButtons();
      document.getElementById('statsCard').style.display = 'none';
    });
  });
  log(records.length ? `تم تحميل ${records.length} ملف/ملفات.` : '');
}

function validRecords() { return records.filter(r => !r.error); }

function updateButtons() {
  const has = validRecords().length > 0;
  document.getElementById('btnRename').disabled = !has;
  document.getElementById('btnStats').disabled = !has;
  document.getElementById('btnFinal').disabled = !has;
  document.getElementById('btnCalc').disabled = !has;
}

function sanitizeFilename(name) {
  return (name || 'طالب').replace(/[\\/:*?"<>|]/g, '_').trim() || 'طالب';
}

/* ---- Button 1: export original files renamed (byte-identical) ---- */
document.getElementById('btnRename').addEventListener('click', async () => {
  const list = validRecords();
  const usedNames = {};
  const makeName = (rec) => {
    let base = sanitizeFilename(rec.parsed.studentName);
    if (usedNames[base]) {
      base = base + '_' + sanitizeFilename(rec.parsed.studentCode || String(rec.id));
    }
    usedNames[base] = true;
    return base + rec.ext;
  };
  if (list.length === 1) {
    const rec = list[0];
    const blob = new Blob([rec.arrayBuffer]);
    saveAs(blob, makeName(rec));
    return;
  }
  const zip = new JSZip();
  list.forEach(rec => zip.file(makeName(rec), rec.arrayBuffer));
  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, 'ترانسكريبتات_بأسماء_الطلاب.zip');
});

/* ---- Button 2: show aggregated stats table ---- */
document.getElementById('btnStats').addEventListener('click', () => {
  const list = validRecords();
  const wrap = document.getElementById('statsTableWrap');
  let mismatchCount = 0;
  let html = '<table class="stats"><thead><tr>' +
    '<th>#</th><th>اسم الطالب</th><th>كود الطالب</th>' +
    '<th>cGPA المحسوب</th><th>cGPA في الترانسكريبت</th><th>الحالة</th>' +
    '</tr></thead><tbody>';
  list.forEach((rec, i) => {
    const r = rec.results, p = rec.parsed;
    const mism = r.mismatch;
    if (mism) mismatchCount++;
    html += `<tr class="${mism ? 'mismatch' : ''}">` +
      `<td>${i + 1}</td>` +
      `<td class="name-col">${p.studentName || '-'}</td>` +
      `<td>${p.studentCode || '-'}</td>` +
      `<td class="${mism ? 'flag' : ''}">${r.cgpaCalcRounded}</td>` +
      `<td class="${mism ? 'flag' : ''}">${r.transcriptCgpa != null ? r.transcriptCgpa : '-'}</td>` +
      `<td>${mism ? '⚠ اختلاف — محتاج مراجعة' : '<span class="status-ok">مطابق</span>'}</td>` +
      `</tr>`;
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
  document.getElementById('statsSummary').textContent =
    `إجمالي ${list.length} طالب — ${mismatchCount} حالة اختلاف عن الترانسكريبت الأصلي.`;
  document.getElementById('statsCard').style.display = 'block';
  document.getElementById('statsCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ---- Button 3: export FINAL_RESULT_FORMAT-style summary ---- */
document.getElementById('btnFinal').addEventListener('click', () => {
  const list = validRecords();
  const header = ['م', 'كود الطالب', 'اسم الطالب', 'الساعات المكتسبة الكليه', 'الساعات الإجبارى',
    'الساعات الإختيارى', 'المعدل التراكمي', 'التقدير العام', 'التقدير المكافئ',
    'الدرجة العظمي', 'المجموع التراكمى', 'عدد الترمات', 'النسبة '];
  const rows = [header];
  list.forEach((rec, i) => {
    const r = rec.results, p = rec.parsed;
    rows.push([
      i + 1,
      p.studentCode || '',
      p.studentName || '',
      r.totalHours || 190,
      186,
      4,
      r.cgpaCalcRounded,
      r.letter,
      r.desc,
      r.denominator * 100,
      Math.round(r.AM_total * 10) / 10,
      r.termCount,
      r.percentCalcRounded
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 4 }, { wch: 12 }, { wch: 16 }, { wch: 22 }, { wch: 16 },
    { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 20 }, { wch: 12 }, { wch: 16 }, { wch: 10 }, { wch: 8 }];
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, 'ملخص_نتائج_الطلاب.xlsx');
});

/* ---- Button 4: export calculated transcript per student (with formulas) ---- */
document.getElementById('btnCalc').addEventListener('click', async () => {
  const list = validRecords();

  function buildCalculatedWb(rec) {
    const newWs = JSON.parse(JSON.stringify(rec.ws));
    const { courseRows } = rec.parsed;
    const inclusion = rec.results.inclusion;
    courseRows.forEach(cr => {
      const inc = inclusion[cr.row] || { ak: true, am: true };
      if (inc.ak) newWs['AK' + cr.row] = { t: 'n', f: `L${cr.row}*N${cr.row}` };
      if (inc.am) newWs['AM' + cr.row] = { t: 'n', f: `M${cr.row}*N${cr.row}` };
    });
    const rowsNums = courseRows.map(c => c.row);
    const firstRow = Math.min(...rowsNums), lastRow = Math.max(...rowsNums);
    const totalRow = lastRow + 2, divRow = totalRow + 1;
    newWs['AJ' + totalRow] = { t: 's', v: 'الإجمالي' };
    newWs['AK' + totalRow] = { t: 'n', f: `SUM(AK${firstRow}:AK${lastRow})` };
    newWs['AM' + totalRow] = { t: 'n', f: `SUM(AM${firstRow}:AM${lastRow})` };
    newWs['AJ' + divRow] = { t: 's', v: 'cGPA / النسبة%' };
    newWs['AK' + divRow] = { t: 'n', f: `AK${totalRow}/${rec.results.denominator}` };
    newWs['AM' + divRow] = { t: 'n', f: `AM${totalRow}/${rec.results.denominator}` };

    const range = XLSX.utils.decode_range(newWs['!ref']);
    range.e.r = Math.max(range.e.r, divRow - 1);
    range.e.c = Math.max(range.e.c, 38);
    newWs['!ref'] = XLSX.utils.encode_range(range);

    const newWb = XLSX.utils.book_new();
    newWb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(newWb, newWs, 'Sheet1');
    return newWb;
  }

  if (list.length === 1) {
    const rec = list[0];
    const wb = buildCalculatedWb(rec);
    XLSX.writeFile(wb, sanitizeFilename(rec.parsed.studentName) + '_ترانسكريبت_محسوب.xlsx');
    return;
  }

  const zip = new JSZip();
  const usedNames = {};
  list.forEach(rec => {
    const wb = buildCalculatedWb(rec);
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    let base = sanitizeFilename(rec.parsed.studentName);
    if (usedNames[base]) base = base + '_' + sanitizeFilename(rec.parsed.studentCode || String(rec.id));
    usedNames[base] = true;
    zip.file(base + '_ترانسكريبت_محسوب.xlsx', out);
  });
  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, 'ترانسكريبتات_محسوبة.zip');
});
