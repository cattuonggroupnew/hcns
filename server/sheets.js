// Bố cục bảng lương (TL02), bảng trích nộp bảo hiểm (BH-01), bảng nộp KPCĐ + ĐPCĐ (CĐ-01) — giữ đúng cột, nhóm cột, phần đối chiếu
// và chữ ký như file Excel của phòng HCNS. Một nguồn cho màn hình, bản in (PDF/Word) và Excel.
const { one } = require('./db');
const B = require('./biz');
const C = require('./core');

// cột: { k, l, t } — t: 't' chữ · 'n' số công · 'm' tiền · 'p' phần trăm; edit: sửa được trên bảng nháp; hl: tô nổi
// nhóm: { g: nhãn, cols: [...] } — hiện thành 2 dòng tiêu đề như file mẫu
const c = (k, l, t = 'm', x = {}) => ({ k, l, t, ...x });
const pct = v => String(v).replace('.', ',') + '%';
const mmY = m => `${m.slice(5)}/${m.slice(0, 4)}`;

function payrollHead(ins, cd = {}) {
  return [c('name', 'Tên nhân viên', 't'), c('dept', 'Bộ phận', 't'), c('worked', 'Công thực tế', 'n'),
    { g: 'Ngày công tính lương', cols: [c('d100', '100%', 'n'), c('d85', '85%', 'n')] },
    c('p1', 'Lương vị trí (P1)'), c('p2', 'Lương theo hiệu quả công việc (P2 cơ sở)'), c('kpi', 'Tỉ lệ hoàn thành KPI', 'p', { edit: 1 }), c('coef', 'Hệ số chuyên cần', 'n'),
    c('p1_net', 'Lương thực nhận P1'), c('p2_net', 'Lương thực nhận P2'), c('meal', 'Hỗ trợ ăn ca'), c('ot_pay', 'Lương làm thêm giờ'), c('ot_free', 'Thêm giờ miễn thuế TNCN'), c('trip_pay', 'Công tác phí', 'm', { edit: 1 }), c('allow', 'Phụ cấp (kế toán…)'),
    { g: 'Thưởng – khoản khác', cols: [c('bday', 'Thưởng sinh nhật', 'm', { edit: 1 }), c('leave_pay', 'Quyết toán phép', 'm', { edit: 1 }), c('bonus', 'Thưởng khác', 'm', { edit: 1 })] },
    c('gross_base', 'Lương thực nhận (P1+P2)'), c('taxable', 'Thu nhập chịu thuế TNCN'), c('tax_base', 'Thu nhập tính thuế TNCN'), c('total', 'Tổng lương phải trả thực tế', 'm', { hl: 'y' }), c('deduct', 'Giảm trừ gia cảnh'),
    { g: 'Các khoản khấu trừ thuế TNCN', cols: [c('e_bhxh', `BHXH (${pct(ins.nld_bhxh)})`), c('e_bhyt', `BHYT (${pct(ins.nld_bhyt)})`), c('e_bhtn', `BHTN (${pct(ins.nld_bhtn)})`)] },
    c('e_ins', 'Tổng số khấu trừ BHXH, BHYT, BHTN'),
    { g: 'Các khoản giảm trừ tiền lương', cols: [c('tax', 'Thuế TNCN'), c('tax_adj', 'Hoàn (−) / truy thu (+) thuế TNCN', 'm', { edit: 1, neg: 1 }), c('advance', 'Tạm ứng lương', 'm', { edit: 1 }), c('other_ded', 'Giảm trừ khác', 'm', { edit: 1 })] },
    c('all_ded', 'Tổng các khoản phải trừ lương'), c('net', 'Thực lĩnh', 'm', { hl: 'r' }),
    { g: 'Bảo hiểm, KPCĐ công ty đóng', cols: [c('c_bhxh', `BHXH (${pct(ins.dn_bhxh)})`), c('c_bhyt', `BHYT (${pct(ins.dn_bhyt)})`), c('c_bhtn', `BHTN (${pct(ins.dn_bhtn)})`), c('c_kpcd', `KPCĐ (${pct(cd.kpcd ?? 2)})`)] },
    c('ins_all', 'Tổng đóng BH'), c('ins_cd_all', 'Tổng đóng BHXH, KPCĐ'), c('gl', 'TK hạch toán', 't', { edit: 1 })];
}
function insHead(rt) {
  const T = k => pct(Math.round(((+rt['dn_' + k] || 0) + (+rt['nld_' + k] || 0)) * 100) / 100), all = ['bhxh', 'bhyt', 'bhtn'].reduce((s, k) => s + (+rt['dn_' + k] || 0) + (+rt['nld_' + k] || 0), 0);
  return [c('name', 'Họ và tên', 't'), c('ins_no', 'Số sổ BHXH', 't'), c('title', 'Chức vụ', 't'), c('salary', 'Tiền lương'),
    { g: 'Doanh nghiệp nộp', cols: [c('dn_bhxh', `BHXH (${pct(rt.dn_bhxh)})`), c('dn_bhyt', `BHYT (${pct(rt.dn_bhyt)})`), c('dn_bhtn', `BHTN (${pct(rt.dn_bhtn)})`), c('dn', 'Cộng')] },
    { g: 'Người lao động nộp', cols: [c('nld_bhxh', `BHXH (${pct(rt.nld_bhxh)})`), c('nld_bhyt', `BHYT (${pct(rt.nld_bhyt)})`), c('nld_bhtn', `BHTN (${pct(rt.nld_bhtn)})`), c('nld', 'Cộng')] },
    { g: 'Tổng số phải nộp', cols: [c('t_bhxh', `BHXH (${T('bhxh')})`), c('t_bhyt', `BHYT (${T('bhyt')})`), c('t_bhtn', `BHTN (${T('bhtn')})`), c('total', `Tổng (${pct(Math.round(all * 100) / 100)})`, 'm', { hl: 'y' })] },
    { g: 'Số được giữ lại tại Công ty', cols: [c('giu_bhxh', 'BHXH'), c('giu_bhyt', 'BHYT'), c('giu_bhtn', 'BHTN')] }, c('note', 'Ghi chú', 't')];
}
function cdHead(rt) {
  return [c('name', 'Tên nhân viên', 't'), c('salary', 'Tiền lương'), c('kp', `KPCĐ Công ty trích nộp ${pct(rt.kpcd)}`), c('dp', `ĐPCĐ NLĐ trích nộp ${pct(rt.dpcd)}`),
    { g: 'KPCĐ', cols: [c('kp_giu', `Nhận ${pct(rt.kpcd_giu)}`), c('kp_nop', `Nộp ${pct(rt.kpcd_nop)}`)] }, { g: 'ĐPCĐ', cols: [c('dp_giu', `Giữ ${pct(rt.dpcd_giu)}`), c('dp_nop', `Nộp ${pct(rt.dpcd_nop)}`)] },
    c('nop', 'Tổng nộp KPCĐ + ĐPCĐ', 'm', { hl: 'y' }), c('giu', 'Tổng giữ KPCĐ + ĐPCĐ'), c('note', 'Ghi chú', 't'), c('year', '1 năm đóng (ĐPCĐ)')];
}
const flat = head => head.flatMap(h => h.g ? h.cols : [h]);

async function people(run, legal) {
  const tp = (await one("SELECT full_name FROM hr_user WHERE role = 'tp_hcns' AND active ORDER BY id LIMIT 1"))?.full_name || '';
  let maker = run.created_by && (await one("SELECT full_name FROM hr_user WHERE id = $1 AND role <> 'admin'", [run.created_by]))?.full_name;
  maker ||= (await one("SELECT full_name FROM hr_user WHERE role = 'cv_hcns' AND active AND $1 = ANY(legal_ids) ORDER BY id LIMIT 1", [legal.id]))?.full_name || tp;
  return { tp, maker };
}

// bảng đã tính: { ent, title, sub, company, head, cols, rows, sum, after, notes, sign }
async function table(ent, run) {
  const legal = await one('SELECT * FROM hr_legal WHERE id = $1', [run.legal_id]), { tp, maker } = await people(run, legal);
  const base = { ent, id: run.id, month: run.month, status: run.status, company: (legal?.name || '').toUpperCase(), legal: legal?.short, unit: 'Đơn vị tính: đồng' };
  if (ent === 'payroll') {
    const ins = await C.setting('ins'), head = payrollHead(ins, await C.setting('cd')), cols = flat(head), rows = (run.lines || []);
    return { ...base, title: `BẢNG TÍNH TIỀN LƯƠNG THÁNG ${mmY(run.month)}`, sub: `Công chuẩn: ${run.std_days} ngày`, head, cols, rows, sum: sums(cols, rows, ['kpi', 'coef']),
      sign: [['TUQ. GIÁM ĐỐC', '(Ký, đóng dấu)', tp], ['KẾ TOÁN', '(Ký, ghi rõ họ tên)', ''], ['NGƯỜI LẬP', '(Ký, ghi rõ họ tên)', maker]] };
  }
  if (ent === 'ins_sheet') {
    const rt = run.rates || await C.setting('ins'), head = insHead(rt), cols = flat(head);
    const rows = (run.lines || []).map(l => ({ ...l, ...B.insRow(l, rt) }));
    const dn = ['dn_bhxh', 'dn_bhyt', 'dn_bhtn'].reduce((s, k) => s + (+rt[k] || 0), 0), nld = ['nld_bhxh', 'nld_bhyt', 'nld_bhtn'].reduce((s, k) => s + (+rt[k] || 0), 0);
    return { ...base, title: 'BẢNG TRÍCH NỘP BẢO HIỂM', sub: `Tháng ${+run.month.slice(5)} - Năm ${run.month.slice(0, 4)}`, head, cols, rows, sum: sums(cols, rows.filter(r => r.change !== 'Báo giảm')),
      notes: [`*Bảo hiểm công ty đóng: ${pct(dn)}`, `*Bảo hiểm người lao động đóng: ${pct(nld)}`, `*Tổng: ${pct(dn + nld)}`],
      after: [['Số phát sinh kỳ này', run.due], ['Lãi chậm nộp kỳ trước', run.late_prev], ['Lãi chậm nộp kỳ này', run.late_cur], ['Truy thu BHYT / BHXH', run.arrears], ['2% BHXH giữ lại', run.keep2], ['Số thiếu kỳ trước', run.short_prev], ['Tổng số phải nộp', run.total_due ?? B.insDueTotal(run), 'b'], ['Số đã nộp trong kỳ', run.paid], ['Còn phải nộp', (run.total_due ?? B.insDueTotal(run)) - (+run.paid || 0), 'b']],
      adj_note: run.adj_note || '',
      sign: [['TUQ. TỔNG GIÁM ĐỐC', '(Ký, đóng dấu)', tp ? `Trưởng phòng HCNS\n${tp}` : ''], ['KẾ TOÁN TRƯỞNG', '(Ký, ghi rõ họ tên)', ''], ['NGƯỜI LẬP BIỂU', '(Ký, ghi rõ họ tên)', maker]] };
  }
  const rt = run.rates || await C.setting('cd'), head = cdHead(rt), cols = flat(head);
  const rows = (run.lines || []).map(l => ({ ...l, ...B.cdRow(l, rt) }));
  return { ...base, title: 'BẢNG NỘP TIỀN KINH PHÍ CÔNG ĐOÀN, ĐOÀN PHÍ CÔNG ĐOÀN', sub: `THÁNG ${mmY(run.month)}`, head, cols, rows, sum: sums(cols, rows.filter(r => r.change !== 'Báo giảm')),
    after: [['Tổng nộp cấp trên', run.due], ['Được để lại', run.kept], ['Đã nộp', run.paid], ['Đã sử dụng', run.used]],
    sign: [['TUQ. TỔNG GIÁM ĐỐC', '(Ký, đóng dấu)', tp ? `Trưởng phòng HCNS\n${tp}` : ''], ['KẾ TOÁN', '(Ký, ghi rõ họ tên)', ''], ['NGƯỜI LẬP', '(Ký, ghi rõ họ tên)', maker]] };
}
function sums(cols, rows, skip = []) {
  return Object.fromEntries(cols.filter(x => ['m', 'n'].includes(x.t) && !skip.includes(x.k)).map(x => [x.k, rows.reduce((s, r) => s + (+r[x.k] || 0), 0)]));
}
const TABLE = { payroll: 'hr_payroll', ins_sheet: 'hr_ins_sheet', cd_sheet: 'hr_cd_sheet' };
async function load(ent, id) { const t = TABLE[ent] || C.bad('Không phải bảng tính'); return C.notFound(await one(`SELECT * FROM ${t} WHERE id = $1`, [+id]), 'bảng'); }

// ---------- Excel: tiêu đề gộp ô, 2 dòng tiêu đề cột, dòng tổng, phần đối chiếu, chữ ký ----------
function xlsxOf(tables) {
  const rows = [], merges = [], styles = {}, heights = {}, st = (r, ci, s) => { styles[`${r},${ci}`] = s; };
  const colL = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; };
  const mg = (r1, c1, r2, c2) => { if (r1 !== r2 || c1 !== c2) merges.push(`${colL(c1)}${r1 + 1}:${colL(c2)}${r2 + 1}`); };
  let width = 0;
  for (const t of tables) {
    const n = t.cols.length + 1; width = Math.max(width, n);
    const r0 = rows.length;
    rows.push([t.company]); st(r0, 0, 1); mg(r0, 0, r0, Math.min(6, n - 1));
    rows.push([]); rows.push([t.title]); st(r0 + 2, 0, 5); mg(r0 + 2, 0, r0 + 2, n - 1); heights[r0 + 2] = 24;
    rows.push([t.sub]); st(r0 + 3, 0, 10); mg(r0 + 3, 0, r0 + 3, n - 1);
    const u = Array(n).fill(''); u[n - 1] = t.unit; rows.push(u);
    const h1 = ['STT'], h2 = [''], hr = rows.length; let ci = 1; const two = t.head.some(h => h.g);
    for (const h of t.head) {
      if (h.g) { h1[ci] = h.g; h.cols.forEach((x, j) => { h2[ci + j] = x.l; if (j) h1[ci + j] = ''; }); mg(hr, ci, hr, ci + h.cols.length - 1); ci += h.cols.length; }
      else { h1[ci] = h.l; h2[ci] = ''; if (two) mg(hr, ci, hr + 1, ci); ci++; }
    }
    if (two) mg(hr, 0, hr + 1, 0);
    rows.push(h1); if (two) rows.push(h2);
    for (let r = hr; r < rows.length; r++) { for (let j = 0; j < n; j++) st(r, j, 4); heights[r] = 42; }
    t.rows.forEach((x, i) => { const rr = rows.length; rows.push([i + 1, ...t.cols.map(k => k.t === 't' ? (x[k.k] ?? '') : x[k.k] === '' || x[k.k] == null ? null : k.t === 'm' ? Math.round(+x[k.k]) : +x[k.k])]); for (let j = 0; j < n; j++) st(rr, j, j && ['m', 'n', 'p'].includes(t.cols[j - 1].t) ? 7 : 6); });
    const fr = rows.length; rows.push(['', 'TỔNG CỘNG', ...t.cols.slice(1).map(k => k.k in t.sum ? Math.round(t.sum[k.k]) : '')]); for (let j = 0; j < n; j++) st(fr, j, j > 1 && t.cols[j - 1] && k_num(t.cols[j - 1]) ? 8 : 9);
    rows.push([]);
    for (const x of t.notes || []) rows.push(['', x]);
    for (const [l, v, b] of t.after || []) { const rr = rows.length; rows.push(['', l, '', '', v == null || v === '' ? '' : Math.round(+v)]); st(rr, 1, b ? 1 : 2); st(rr, 4, b ? 8 : 7); }
    if (t.adj_note) rows.push(['', 'Diễn giải: ' + t.adj_note]);
    rows.push([]);
    const dr = rows.length, d = Array(n).fill(''); d[Math.max(n - 6, 1)] = 'Bắc Ninh, ngày ..... tháng ..... năm ' + t.month.slice(0, 4); rows.push(d); st(dr, Math.max(n - 6, 1), 10);
    const pos = [1, Math.floor(n / 2) - 1, Math.max(n - 5, 2)], s1 = Array(n).fill(''), s2 = Array(n).fill(''), s3 = Array(n).fill('');
    t.sign.forEach(([a, b2, nm], i) => { s1[pos[i]] = a; s2[pos[i]] = b2; s3[pos[i]] = nm.replace('\n', ' — '); });
    const sr = rows.length; rows.push(s1, s2, [], [], [], s3); for (const p of pos) { st(sr, p, 1); st(sr + 5, p, 1); }
    rows.push([], []);
  }
  const widths = [6, 24, ...Array(Math.max(width - 2, 0)).fill(14)];
  return { rows, merges, heights, widths, styleOf: (r, ci) => styles[`${r},${ci}`] };
}
const k_num = k => ['m', 'n'].includes(k.t);

// ---------- Mẫu 01/PLI: mỗi pháp nhân một khối, 27 cột như mẫu Sở Nội vụ ----------
function pliXlsx(groups) {
  const rows = [], merges = [], styles = {}, L = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; };
  const mg = (r1, c1, r2, c2) => merges.push(`${L(c1)}${r1 + 1}:${L(c2)}${r2 + 1}`), d = v => v ? C.dmy(v) : '';
  const H = [['STT', 0, 0, 3], ['Họ tên', 1, 1, 3], ['Mã số BHXH', 2, 2, 3], ['Ngày tháng năm sinh', 3, 3, 3], ['Giới tính', 4, 4, 3], ['Số CCCD/ CMND/ Hộ chiếu', 5, 5, 3], ['Cấp bậc, chức vụ, chức danh nghề, nơi làm việc', 6, 6, 3], ['Vị trí việc làm (2)', 7, 10, 1], ['Tiền lương', 11, 16, 1], ['Ngành/nghề nặng nhọc, độc hại', 17, 18, 2], ['Loại và hiệu lực hợp đồng lao động', 19, 23, 1], ['Thời điểm đơn vị bắt đầu đóng BHXH', 24, 24, 3], ['Thời điểm đơn vị kết thúc đóng BHXH', 25, 25, 3], ['Ghi chú', 26, 26, 3]];
  const H2 = [['Nhà quản lý', 7, 7, 2], ['Chuyên môn kỹ thuật bậc cao', 8, 8, 2], ['Chuyên môn kỹ thuật bậc trung', 9, 9, 2], ['Khác', 10, 10, 2], ['Hệ số/ Mức lương', 11, 11, 2], ['Phụ cấp', 12, 16, 1], ['Ngày bắt đầu HĐLĐ không xác định thời hạn', 19, 19, 2], ['Hiệu lực HĐLĐ xác định thời hạn', 20, 21, 1], ['Hiệu lực HĐLĐ khác (dưới 1 tháng, thử việc)', 22, 23, 1]];
  const H3 = [['Chức vụ', 12], ['Thâm niên VK (%)', 13], ['Thâm niên nghề (%)', 14], ['Phụ cấp lương', 15], ['Các khoản bổ sung', 16], ['Ngày bắt đầu', 17], ['Ngày kết thúc', 18], ['Ngày bắt đầu', 20], ['Ngày kết thúc', 21], ['Ngày bắt đầu', 22], ['Ngày kết thúc', 23]];
  for (const g of groups) {
    const r0 = rows.length, y = new Date().getFullYear(), blank = () => Array(27).fill('');
    const a = blank(); a[0] = (g.legal.name || '').toUpperCase(); a[14] = 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM'; rows.push(a); styles[`${r0},0`] = 1; styles[`${r0},14`] = 1;
    const b = blank(); b[0] = `Số: ......../${y}/BC-${g.legal.code}`; b[14] = 'Độc lập - Tự do - Hạnh phúc'; rows.push(b); styles[`${r0 + 1},14`] = 1;
    rows.push([], [ '', '', '', '', '', 'BÁO CÁO TÌNH HÌNH SỬ DỤNG LAO ĐỘNG']); styles[`${r0 + 3},5`] = 5;
    rows.push(['', '', '', '', '', 'Kính gửi: Sở Nội Vụ tỉnh Bắc Ninh; Cơ quan BHXH liên huyện Thành phố Bắc Ninh – Quế Võ']);
    rows.push(['1. Thông tin chung về doanh nghiệp, cơ quan, tổ chức:'], [`- Tên doanh nghiệp, cơ quan, tổ chức: ${g.legal.name || ''}`], [`- Địa chỉ: ${g.legal.address || ''}`], [`- Điện thoại: ${g.legal.phone || ''}                Fax:`], [`- Mã số giấy chứng nhận đăng ký doanh nghiệp: ${g.legal.tax_code || ''}`], [`- Lĩnh vực hoạt động, ngành nghề kinh doanh chính: ${g.legal.business || ''}`], ['2. Thông tin tình hình sử dụng lao động của đơn vị:']);
    styles[`${r0 + 5},0`] = 1; styles[`${r0 + 11},0`] = 1;
    const hr = rows.length, h = [blank(), blank(), blank(), Array.from({ length: 27 }, (_, i) => i + 1)];
    for (const [l, c1, c2, span] of H) { h[0][c1] = l; mg(hr, c1, hr + span - 1, c2); }
    for (const [l, c1, c2, span] of H2) { h[1][c1] = l; mg(hr + 1, c1, hr + span, c2); }
    for (const [l, c1] of H3) h[2][c1] = l;
    rows.push(...h); for (let r = hr; r < hr + 4; r++) for (let j = 0; j < 27; j++) styles[`${r},${j}`] = 4;
    g.rows.forEach((x, i) => { const rr = rows.length; rows.push([i + 1, x.name, x.ins, d(x.dob), x.gender, x.cccd, x.title, x.pos === 'ql' ? 'x' : '', x.pos === 'cao' ? 'x' : '', x.pos === 'trung' ? 'x' : '', x.pos === 'khac' ? 'x' : '', x.sal === '' || x.sal == null ? '' : +x.sal, '', '', '', '', '', x.hard ? d(x.join) : '', '', d(x.c3), d(x.c2a), d(x.c2b), d(x.c1a), d(x.c1b), x.ins_from, x.ins_to, x.note]); for (let j = 0; j < 27; j++) styles[`${rr},${j}`] = j === 11 ? 7 : j === 1 || j === 6 ? 6 : 3; });
    const tr = rows.length, t = blank(); t[1] = `Tổng: ${g.rows.length} người (nữ ${g.rows.filter(x => x.gender === 'Nữ').length})`; rows.push(t); for (let j = 0; j < 27; j++) styles[`${tr},${j}`] = 9;
    const s = blank(); s[15] = 'ĐẠI DIỆN DOANH NGHIỆP, CƠ QUAN, TỔ CHỨC'; const s2 = blank(); s2[15] = '(Chữ ký, dấu)'; const sr = rows.length; rows.push([], s, s2, [], [], []); styles[`${sr + 1},15`] = 1; styles[`${sr + 2},15`] = 10;
  }
  return { rows, merges, widths: [5, 22, 13, 11, 7, 14, 24, 8, 8, 8, 6, 12, 7, 7, 7, 8, 8, 10, 10, 11, 11, 11, 11, 11, 10, 10, 14], heights: {}, styleOf: (r, c2) => styles[`${r},${c2}`] };
}

// bản in / Excel theo mẫu: bỏ cột chỉ dùng nội bộ (bảng lương: «TK hạch toán»)
const NOPRINT = { payroll: ['gl'] };
const printable = t => { const x = [...(NOPRINT[t.ent] || []), ...(t.ent === 'payroll' && !(t.rows || []).some(l => +l.allow) ? ['allow'] : [])]; if (!x.length) return t; const keep = c => !x.includes(c.k);   // cột phụ cấp chỉ in khi có người hưởng
  return { ...t, head: t.head.filter(h => h.g || keep(h)).map(h => h.g ? { ...h, cols: h.cols.filter(keep) } : h), cols: t.cols.filter(keep) }; };
module.exports = { table, load, xlsxOf, pliXlsx, flat, TABLE, printable };
