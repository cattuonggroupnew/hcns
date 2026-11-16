// Bản in: biểu mẫu chung theo meta, phiếu lương TL03, chuyển khoản TL04, báo cáo. fmt=doc → mở bằng Word.
const C = require('./core');
const { E } = require('./meta');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fm = v => v == null || v === '' ? '' : Math.round(+v).toLocaleString('vi-VN');
const CSS = `<style>@page{size:A4;margin:20mm 15mm 20mm 25mm}body{font:13pt 'Times New Roman',serif;color:#000;line-height:1.4}h1{font-size:15pt;text-align:center;margin:12px 0 4px}table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid #000;padding:4px 6px;font-size:11.5pt;vertical-align:top}th{background:#eee}table.nb td{border:0;padding:2px 4px}.r{text-align:right}.c{text-align:center}.sign{display:flex;justify-content:space-around;margin-top:24px;text-align:center}.sign div{min-height:90px}.top{display:flex;justify-content:space-between;font-size:11pt}@media print{.np{display:none}}.np{position:fixed;top:8px;right:8px;font:14px sans-serif;padding:6px 12px}</style>`;
// bản in sửa được trước khi in: bấm vào chữ để sửa (chỉ sửa bản in, không đổi dữ liệu trên app); «Về bản gốc» tải lại
const EDIT_CSS = `<style>.bar{position:fixed;top:0;left:0;right:0;z-index:9;display:flex;gap:10px;align-items:center;padding:8px 14px;background:#16345c;color:#fff;font:14px 'Segoe UI',Arial,sans-serif}.bar button{font:inherit;padding:6px 14px;border-radius:8px;border:1px solid #fff;background:#fff;color:#16345c;cursor:pointer;font-weight:600}.bar button.o{background:transparent;color:#fff}.bar span{opacity:.85;margin-right:auto}
/* thanh công cụ bị bỏ khi xuất Word → không để khoảng trống đầu trang */.bar+#doc{padding-top:44px}#doc{outline:none}.mau{display:inline-block;border:1.5px solid #c00;color:#c00;font:700 10pt Arial,sans-serif;padding:0 5px;border-radius:3px;vertical-align:middle;letter-spacing:1px}#doc.on *:hover{background:#fff8c5}#doc.on:focus-within{caret-color:#c00}@media print{.bar{display:none}.bar+#doc{padding-top:0}#doc *:hover{background:none}}</style>`;
const BAR = `<div class="bar"><span>✎ Bấm vào chữ bất kỳ để sửa trước khi in — chỉ sửa bản in, dữ liệu trên app giữ nguyên.</span><button class="o" onclick="var d=document.getElementById('doc'),on=d.isContentEditable;d.contentEditable=!on;d.classList.toggle('on',!on);this.textContent=on?'Bật sửa':'Tắt sửa'">Tắt sửa</button><button class="o" onclick="location.reload()">Về bản gốc</button><button onclick="print()">In / Lưu PDF</button></div>`;
const page = (title, body) => `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(title)}</title>${CSS}${EDIT_CSS}</head><body>${BAR}<div id="doc" class="on" contenteditable="true" spellcheck="false">${body}</div></body></html>`;
const val = async (f, r) => {
  const v = r[f.k]; if (v == null || v === '') return '';
  if (f.t === 'ref') return r[f.k + '__l'] ?? '';
  if (f.t === 'date') return C.dmy(v);
  if (f.t === 'dt') { const d = new Date(new Date(v).getTime() + 7 * 3600e3).toISOString(); return `${C.dmy(d)} ${d.slice(11, 16)}`; }
  if (f.t === 'money') return fm(v);
  if (f.t === 'bool') return v ? 'Có' : 'Không';
  if (f.t === 'sel') return (f.o || []).find(o => o[0] === v)?.[1] ?? v;
  if (f.t === 'days') return v.join(', ');
  if (f.t === 'multi') return v.map(x => (f.o || []).find(o => o[0] === x)?.[1] || x).join(', ');
  return String(v);
};
const SIGN = { default: ['NGƯỜI LẬP', 'NGƯỜI KIỂM TRA', 'NGƯỜI PHÊ DUYỆT'], explain: ['NGƯỜI GIẢI TRÌNH', 'QUẢN LÝ TRỰC TIẾP', 'HCNS DUYỆT CÔNG'], vehicle: ['NGƯỜI LẬP', 'PHỤ TRÁCH HCNS'] };
async function form(entKey, id, user, tpl) {
  const full = await require('./forms').render(entKey, id, user, tpl);   // mẫu đầy đủ theo Bộ 53 biểu mẫu
  if (full) return page(full.title, full.body);
  const e = C.E[entKey], g = await C.get(entKey, id, user, { reveal: true }), r = g.row;
  const legal = r.legal_id__l ? (await require('./db').one('SELECT name FROM hr_legal WHERE id=$1', [r.legal_id]))?.name : '';
  const simple = [], grids = [];
  for (const f of e.fields) { if (f.hide || f.k === 'status') continue; if (f.grid) { if ((r[f.k] || []).length) grids.push(f); continue; } if (f.show && !Object.entries(f.show).every(([k, v]) => v.includes(r[k]))) continue; simple.push([f.l, await val(f, r)]); }
  const body = `<div class="top"><b>${esc((legal || 'CÁT TƯỜNG GROUP').toUpperCase())}</b><span>Mã biểu mẫu: <b>${esc(e.code || '')}</b></span></div><h1>${esc(e.title.toUpperCase())} <span class="mau" title="Bên A chưa có mẫu — app tự dựng">MẪU</span></h1>
  <table class="nb">${simple.filter(x => x[1]).map(x => `<tr><td style="width:38%">${esc(x[0])}:</td><td><b>${esc(x[1])}</b></td></tr>`).join('')}</table>
  ${grids.map(f => `<b>${esc(f.l)}</b><table><tr><th>STT</th>${f.grid.map(c => `<th>${esc(c.l)}</th>`).join('')}</tr>${r[f.k].map((l, i) => `<tr><td class="c">${i + 1}</td>${f.grid.map(c => `<td${c.n ? ' class="r"' : ''}>${esc(l[c.k])}</td>`).join('')}</tr>`).join('')}</table>`).join('')}
  <p style="text-align:right;font-style:italic">Bắc Ninh, ngày ...... tháng ...... năm ........</p><div class="sign">${(SIGN[entKey] || SIGN.default).map(s => `<div><b>${s}</b><br><i>(Ký, ghi rõ họ tên)</i></div>`).join('')}</div>`;
  return page(`${e.code} ${r.code || r.no || id}`, body);
}
function moneyWords(n) {
  const d = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
  const three = (x, full) => { const t = Math.floor(x / 100), c = Math.floor(x / 10) % 10, u = x % 10; let s = ''; if (t || full) s += d[t] + ' trăm '; if (c === 0 && u && (t || full)) s += 'linh '; else if (c === 1) s += 'mười '; else if (c) s += d[c] + ' mươi '; if (u) s += (u === 1 && c > 1 ? 'mốt' : u === 5 && c ? 'lăm' : d[u]) + ' '; return s; };
  const g = []; let x = Math.round(n); while (x > 0) { g.unshift(x % 1000); x = Math.floor(x / 1000); } const un = ['', 'nghìn ', 'triệu ', 'tỷ ', 'nghìn tỷ ']; let s = '';
  g.forEach((v, i) => { if (v) s += three(v, i > 0) + un[g.length - 1 - i]; });
  s = s.trim() || 'không'; return s[0].toUpperCase() + s.slice(1) + ' đồng./.';
}
// ---------- TL03 phiếu lương cá nhân — theo mẫu «Phiếu lương dự kiến» trong file lương tháng ----------
const SLIP_CSS = `<style>.slip{break-inside:avoid;margin:0 auto 14mm;max-width:150mm}.slip h1{margin:0;border:1px solid #000;border-bottom:0;padding:6px}.slip .m{border:1px solid #000;border-bottom:0;text-align:center;font-weight:bold;padding:3px;margin:0}.slip table{margin:0}.slip td{font-size:11.5pt}.slip .g{text-align:center;vertical-align:middle;font-weight:bold}.slip .hd td{font-weight:bold;text-align:center}.slip .tot td{font-weight:bold;font-size:12.5pt}.slip .nt{border:1px solid #000;border-top:0;padding:5px;text-align:center;font-style:italic;font-weight:bold;font-size:11pt;margin:0}</style>`;
function payslip(run, l, legal, cfg = {}) {
  const y = run.month.slice(0, 4), mo = run.month.slice(5), draft = !['da_duyet', 'da_chuyen'].includes(run.status), d = v => v ? fm(v) : '-', days = (+l.d100 || 0) + (+l.d85 || 0);
  const next = new Date(Date.UTC(+y, +mo, cfg.ask_day || 3)).toISOString().slice(0, 10), ask = `${next.slice(8)}/${next.slice(5, 7)}/${next.slice(0, 4)}`;
  const tr = (label, n, money) => `<tr><td>${label}</td><td class="c">${n}</td><td class="r">${money}</td></tr>`;
  return `<div class="slip"><h1>${draft ? 'PHIẾU LƯƠNG DỰ KIẾN' : 'PHIẾU LƯƠNG'}</h1><p class="m">Tháng ${mo} năm ${y}${legal ? ' · ' + esc(legal) : ''}</p><table>
  <tr><td colspan="2" class="g">Họ tên</td><td colspan="2" class="c"><b>${esc(l.name)}</b>${l.code ? ` (${esc(l.code)})` : ''}</td></tr>
  <tr class="hd"><td colspan="2" rowspan="4" class="g">Mức lương</td><td>Hệ số %</td><td>Công thực tế</td></tr>
  <tr><td class="c">Tổng công thực tế</td><td class="c">${fnum(l.worked)}</td></tr><tr><td class="c">100%</td><td class="c">${fnum(l.d100)}</td></tr><tr><td class="c">${fnum(l.trial_pct ?? 85)}%</td><td class="c">${fnum(l.d85)}</td></tr>
  <tr class="hd"><td colspan="2"></td><td>Số công</td><td>Thành tiền</td></tr>
  <tr><td rowspan="7" class="g">Tổng tiền lương</td>${tr('Công tính lương<br><small>(sau khi cộng phép &amp; ngày nghỉ lễ)</small>', fnum(days), fm(l.gross_base)).slice(4)}
  ${tr('Tiền ăn', fnum(l.worked), d(l.meal))}${tr('Số giờ tăng ca<br><small>(sau khi nhân hệ số)</small>', l.ot_h ? fnum(l.ot_h) : '-', d(l.ot_pay))}${tr('Công tác phí', '-', d(l.trip_pay))}${tr('Thưởng sinh nhật', '-', d(l.bday))}${tr(`Quyết toán phép còn lại tính đến hết T${mo}/${y}`, +l.leave_days ? fnum(l.leave_days) : '-', d(l.leave_pay))}${tr('Thưởng khác', '-', d(l.bonus))}
  <tr><td colspan="2">Các khoản giảm trừ <small>(BHXH, BHYT, BHTN, thuế TNCN, tạm ứng lương, giảm trừ khác)</small></td><td colspan="2" class="r">${fm(l.all_ded)}</td></tr>
  <tr class="tot"><td colspan="2" class="g">Thực lĩnh</td><td colspan="2" class="r">${fm(l.net)}</td></tr>
  <tr><td colspan="2" rowspan="2" class="g">Chi lương</td><td>Chuyển khoản${l.acct ? `<br><small>${esc(l.acct)} · ${esc(l.bank || '')}</small>` : ''}</td><td class="r">${l.acct ? fm(l.net) : '-'}</td></tr><tr><td>Tiền mặt</td><td class="r">${l.acct ? '-' : fm(l.net)}</td></tr>
  </table><p class="nt">Note: Mọi thắc mắc về lương vui lòng phản hồi trước 12h00 ngày ${ask}</p></div>`;
}
const fnum = v => v == null || v === '' ? '' : (+v).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const slips = (run, lines, legal, cfg) => page('TL03', SLIP_CSS + lines.map(l => payslip(run, l, legal, cfg)).join(''));

// ---------- TL04 bảng thanh toán tiền lương qua tài khoản — mỗi ngân hàng một trang, người chưa có TK vào danh sách tiền mặt ----------
function bank(run, legal) { return page('TL04', bankPages(run, legal)); }
function bankPages(run, legal) {
  const mm = `${+run.month.slice(5)} năm ${run.month.slice(0, 4)}`, by = {};
  for (const l of (run.lines || []).filter(l => l.net > 0)) (by[l.acct ? (String(l.bank || '').trim() || 'Ngân hàng chưa rõ') : ''] ||= []).push(l);
  const keys = Object.keys(by).sort((a, b) => (a === '') - (b === '') || (a === (legal.bank_main || 'Agribank') ? -1 : b === (legal.bank_main || 'Agribank') ? 1 : a.localeCompare(b)));
  const one = (bk, ls) => { const total = ls.reduce((s, l) => s + l.net, 0); return `<div style="break-after:page">
  <table class="nb"><tr><td class="c" style="width:45%"><b>${esc(legal.name.toUpperCase())}</b><br>Số : ĐNTL - ....</td><td class="c"><b>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</b><br><b><u>Độc lập - Tự do - Hạnh phúc</u></b></td></tr></table>
  <h1>${bk ? 'BẢNG THANH TOÁN TIỀN LƯƠNG QUA TÀI KHOẢN' : 'DANH SÁCH CHI LƯƠNG TIỀN MẶT'}</h1><p class="c"><b>(Tháng ${mm})</b></p>
  ${bk ? `<p><b><u>Kính gửi:</u> ${esc(bk)} Bắc Ninh</b></p><p>Đề nghị quý Ngân hàng hạch toán vào tài khoản của cán bộ và thu phí liên quan căn cứ ủy nhiệm chi của Đơn vị chúng tôi và danh sách chi trả lương tháng ${mm}.</p>` : '<p>Người lao động chưa có tài khoản ngân hàng — chi tiền mặt, ký nhận.</p>'}
  <table><tr><th>STT</th><th>HỌ VÀ TÊN</th>${bk ? '<th>SỐ TÀI KHOẢN</th>' : ''}<th>SỐ TIỀN</th>${bk ? '<th>NGÂN HÀNG</th>' : '<th>KÝ NHẬN</th>'}</tr>${ls.map((l, i) => `<tr><td class="c">${i + 1}</td><td>${esc(l.name)}</td>${bk ? `<td class="c">${esc(l.acct)}</td>` : ''}<td class="r">${fm(l.net)}</td><td class="c">${bk ? esc(l.bank || '') : ''}</td></tr>`).join('')}
  <tr><th colspan="${bk ? 3 : 2}">TỔNG CỘNG</th><th class="r">${fm(total)}</th><th></th></tr></table>
  <p><b>Bằng chữ:</b> <i>${esc(moneyWords(total))}</i></p><p style="text-align:right;font-style:italic">Bắc Ninh, ngày ...... tháng ...... năm ${run.month.slice(0, 4)}</p>
  <table class="nb"><tr><td class="c" style="width:40%"><b>${bk ? 'XÁC NHẬN CỦA NGÂN HÀNG' : 'NGƯỜI LẬP'}</b></td><td class="c" colspan="2"><b>XÁC NHẬN CỦA ĐƠN VỊ</b></td></tr><tr><td></td><td class="c"><b>KẾ TOÁN</b></td><td class="c"><b>TUQ. TỔNG GIÁM ĐỐC</b></td></tr></table></div>`; };
  return keys.map(k => one(k, by[k])).join('') || '<p>Không có dòng lương nào để chuyển.</p>';
}
// ---------- bộ hồ sơ lương tháng (in một lần): bảng chấm công · bảng tăng ca · bảng lương TL02 · chuyển khoản TL04 ----------
function payPack(run, legal, d, tl02) {
  const m = run.month, mm = `${m.slice(5)}/${m.slice(0, 4)}`, last = +d.last, DN = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'], dw = i => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5) - 1, i)).getUTCDay();
  const off = i => dw(i) === 0 || d.hol.includes(`${m}-${String(i).padStart(2, '0')}`), ds = Array.from({ length: last }, (_, i) => i + 1);
  const head = t => `<div class="top"><b>${esc((legal.name || '').toUpperCase())}</b><span>Tháng ${mm}</span></div><h1>${t}</h1>`;
  const sign = `<p style="text-align:right;font-style:italic">Bắc Ninh, ngày ...... tháng ...... năm ${m.slice(0, 4)}</p><div class="sign"><div><b>NGƯỜI LẬP</b><br><i>(Ký, ghi rõ họ tên)</i></div><div><b>TRƯỞNG PHÒNG HCNS</b><br><i>(Ký, ghi rõ họ tên)</i></div><div><b>TUQ. GIÁM ĐỐC</b><br><i>(Ký, đóng dấu)</i></div></div>`;
  const ts = `<div class="sheet">${head('BẢNG CHẤM CÔNG')}<table class="grid"><tr><th>STT</th><th>Họ và tên</th>${ds.map(i => `<th${off(i) ? ' style="background:#eee"' : ''}>${i}<br>${DN[dw(i)]}</th>`).join('')}<th>Đi làm</th><th>Phép, lễ</th><th>Không lương</th><th>Tổng công</th><th>Tăng ca (giờ)</th></tr>
    ${d.emps.map((e, n) => { const a = d.att[e.id] || { days: {} }; return `<tr><td class="c">${n + 1}</td><td>${esc(e.name)}</td>${ds.map(i => `<td class="c"${off(i) ? ' style="background:#f5f5f5"' : ''}>${esc(a.days?.[i] || '')}</td>`).join('')}<td class="r">${fnum(a.work || 0)}</td><td class="r">${fnum(a.paid_leave || 0)}</td><td class="r">${a.unpaid ? fnum(a.unpaid) : ''}</td><td class="r"><b>${fnum((a.work || 0) + (a.paid_leave || 0))}</b></td><td class="r">${d.ot[e.id] ? fnum(d.ot[e.id]) : ''}</td></tr>`; }).join('')}</table>
    <p class="notes">Ký hiệu: ${d.types.map(t => `${esc(t.code)} – ${esc(t.name)}`).join('; ')}</p>${sign}</div>`;
  const ot = `<div class="sheet">${head('BẢNG TĂNG CA')}${d.otRows.length ? `<table class="grid"><tr><th>STT</th><th>Ngày</th><th>Mã NV</th><th>Họ và tên</th><th>Bộ phận</th><th>Loại ngày</th><th>Từ giờ</th><th>Đến giờ</th><th>Giờ được duyệt</th><th>Công việc</th></tr>
    ${d.otRows.map((r, n) => `<tr><td class="c">${n + 1}</td><td class="c">${C.dmy(r.day)}</td><td class="c">${esc(r.code)}</td><td>${esc(r.name)}</td><td>${esc(r.dept || '')}</td><td class="c">${esc(r.kind)}</td><td class="c">${esc(r.from_t || '')}</td><td class="c">${esc(r.to_t || '')}</td><td class="r">${fnum(r.hours)}</td><td>${esc(r.task || '')}</td></tr>`).join('')}
    <tr class="sum"><td></td><td colspan="7"><b>TỔNG CỘNG</b></td><td class="r"><b>${fnum(d.otRows.reduce((s, r) => s + (+r.hours || 0), 0))}</b></td><td></td></tr></table>` : '<p class="c"><i>Không có tăng ca được duyệt trong tháng.</i></p>'}${sign}</div>`;
  return page(`Hồ sơ lương ${mm}`, SHEET_CSS('A3') + ts + ot + sheetHtml(tl02) + `<div class="sheet">${bankPages(run, legal)}</div>`);
}

// ---------- TL02 / BH-01 / CĐ-01 theo bố cục sheets.js ----------
function sheetHtml(t) {
  const two = t.head.some(h => h.g), v = (k, x) => { const a = x[k.k]; if (a == null || a === '') return ''; return k.t === 't' ? esc(a) : k.t === 'p' ? fnum(a) + '%' : k.t === 'n' ? fnum(a) : fm(a); };
  const h1 = `<tr><th rowspan="${two ? 2 : 1}">STT</th>${t.head.map(h => h.g ? `<th colspan="${h.cols.length}">${esc(h.g)}</th>` : `<th rowspan="${two ? 2 : 1}">${esc(h.l)}</th>`).join('')}</tr>`;
  const h2 = two ? `<tr>${t.head.filter(h => h.g).flatMap(h => h.cols).map(x => `<th>${esc(x.l)}</th>`).join('')}</tr>` : '';
  const body = t.rows.map((x, i) => `<tr><td class="c">${i + 1}</td>${t.cols.map(k => `<td class="${k.t === 't' ? '' : 'r'}${k.hl ? ' hl' + k.hl : ''}">${v(k, x)}</td>`).join('')}</tr>`).join('');
  const foot = `<tr class="sum"><td></td><td><b>TỔNG CỘNG</b></td>${t.cols.slice(1).map(k => `<td class="r${k.hl ? ' hl' + k.hl : ''}">${k.k in t.sum ? fm(t.sum[k.k]) : ''}</td>`).join('')}</tr>`;
  const after = (t.after || []).map(([l, a, b]) => `<tr><td>${b ? `<b>${esc(l)}</b>` : esc(l)}</td><td class="r">${b ? `<b>${fm(a)}</b>` : fm(a)}</td></tr>`).join('');
  return `<div class="sheet"><div class="top"><b>${esc(t.company)}</b><span>${esc(t.unit)}</span></div><h1>${esc(t.title)}</h1><p class="c"><b>${esc(t.sub)}</b></p>
  <table class="grid">${h1}${h2}${body}${foot}</table>
  <div class="row2">${(t.notes || []).length ? `<div class="notes">${t.notes.map(esc).join('<br>')}</div>` : ''}${after ? `<table class="adj">${after}</table>` : ''}</div>${t.adj_note ? `<p><i>Diễn giải: ${esc(t.adj_note)}</i></p>` : ''}
  <p style="text-align:right;font-style:italic">Bắc Ninh, ngày ...... tháng ...... năm ${t.month.slice(0, 4)}</p>
  <div class="sign">${t.sign.map(([a, b, nm]) => `<div><b>${esc(a)}</b><br><i>${esc(b)}</i><div style="height:60px"></div><b>${esc(nm).replace('\n', '<br>')}</b></div>`).join('')}</div></div>`;
}
const SHEET_CSS = size => `<style>@page{size:${size} landscape;margin:10mm}body{font-size:10pt}.grid th,.grid td{font-size:${size === 'A3' ? 8 : 9}pt;padding:2px 3px}.grid th{vertical-align:middle;text-align:center}.grid .sum td{font-weight:bold;background:#f2f2f2}.hly{background:#fff59d}.hlr{color:#c00;font-weight:bold}.row2{display:flex;gap:24px;justify-content:space-between;margin-top:6px}.adj{width:auto;min-width:320px}.adj td{border:0;padding:1px 8px;font-size:10.5pt}.notes{font-style:italic;font-size:10.5pt}.sheet{break-after:page}.sign div{min-width:200px}</style>`;
const sheets = tables => page(tables[0]?.ent === 'payroll' ? 'TL02' : tables[0]?.ent === 'ins_sheet' ? 'BH-01' : 'CĐ-01', SHEET_CSS(tables.some(t => t.ent === 'payroll') ? 'A3' : 'A4') + (tables.map(sheetHtml).join('') || '<p>Chưa có bảng nào trong kỳ.</p>'));

// ---------- Mẫu 01/PLI báo cáo tình hình sử dụng lao động — 27 cột như mẫu Sở Nội vụ ----------
function pli(groups, p) {
  const d = v => v ? C.dmy(v) : '', x = b => b ? 'x' : '', t = new Date(), today = `ngày ${t.getDate()} tháng ${t.getMonth() + 1} năm ${t.getFullYear()}`;
  const head = `<tr><th rowspan="3">STT</th><th rowspan="3">Họ tên</th><th rowspan="3">Mã số BHXH</th><th rowspan="3">Ngày tháng năm sinh</th><th rowspan="3">Giới tính</th><th rowspan="3">Số CCCD/ CMND/ Hộ chiếu</th><th rowspan="3">Cấp bậc, chức vụ, chức danh nghề, nơi làm việc</th><th colspan="4">Vị trí việc làm (2)</th><th colspan="6">Tiền lương</th><th colspan="2" rowspan="2">Ngành/nghề nặng nhọc, độc hại</th><th colspan="5">Loại và hiệu lực hợp đồng lao động</th><th rowspan="3">Thời điểm đơn vị bắt đầu đóng BHXH</th><th rowspan="3">Thời điểm đơn vị kết thúc đóng BHXH</th><th rowspan="3">Ghi chú</th></tr>
  <tr><th rowspan="2">Nhà quản lý</th><th rowspan="2">Chuyên môn kỹ thuật bậc cao</th><th rowspan="2">Chuyên môn kỹ thuật bậc trung</th><th rowspan="2">Khác</th><th rowspan="2">Hệ số/ Mức lương</th><th colspan="5">Phụ cấp</th><th rowspan="2">Ngày bắt đầu HĐLĐ không xác định thời hạn</th><th colspan="2">Hiệu lực HĐLĐ xác định thời hạn</th><th colspan="2">Hiệu lực HĐLĐ khác (dưới 1 tháng, thử việc)</th></tr>
  <tr><th>Chức vụ</th><th>Thâm niên VK (%)</th><th>Thâm niên nghề (%)</th><th>Phụ cấp lương</th><th>Các khoản bổ sung</th><th>Ngày bắt đầu</th><th>Ngày kết thúc</th><th>Ngày bắt đầu</th><th>Ngày kết thúc</th><th>Ngày bắt đầu</th><th>Ngày kết thúc</th></tr>
  <tr>${Array.from({ length: 27 }, (_, i) => `<th>${i + 1}</th>`).join('')}</tr>`;
  const one = g => `<div class="sheet"><table class="nb"><tr><td class="c" style="width:45%"><b>${esc((g.legal.name || '').toUpperCase())}</b><br>Số: ........../${t.getFullYear()}/BC-${esc(g.legal.code)}</td><td class="c"><b>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</b><br><b><u>Độc lập - Tự do - Hạnh phúc</u></b><br><i>Bắc Ninh, ${today}</i></td></tr></table>
  <h1>BÁO CÁO TÌNH HÌNH SỬ DỤNG LAO ĐỘNG</h1><p class="c">${esc(p.period || (p.month ? `Tháng ${p.month.slice(5)}/${p.month.slice(0, 4)}` : ''))}</p><p class="c">Kính gửi: Sở Nội Vụ tỉnh Bắc Ninh<br>Cơ quan BHXH liên huyện Thành phố Bắc Ninh – Quế Võ</p>
  <p><b>1. Thông tin chung về doanh nghiệp, cơ quan, tổ chức:</b><br>- Tên doanh nghiệp, cơ quan, tổ chức: ${esc(g.legal.name)}<br>- Địa chỉ: ${esc(g.legal.address || '')}<br>- Điện thoại: ${esc(g.legal.phone || '')}&emsp;&emsp;&emsp;Fax:<br>- Mã số giấy chứng nhận đăng ký doanh nghiệp: ${esc(g.legal.tax_code || '')}<br>- Lĩnh vực hoạt động, ngành nghề kinh doanh chính: ${esc(g.legal.business || '')}</p>
  <p><b>2. Thông tin tình hình sử dụng lao động của đơn vị:</b></p>
  <table class="grid">${head}${g.rows.map((r, i) => `<tr><td class="c">${i + 1}</td><td>${esc(r.name)}</td><td>${esc(r.ins)}</td><td class="c">${d(r.dob)}</td><td class="c">${esc(r.gender)}</td><td>${esc(r.cccd)}</td><td>${esc(r.title)}</td><td class="c">${x(r.pos === 'ql')}</td><td class="c">${x(r.pos === 'cao')}</td><td class="c">${x(r.pos === 'trung')}</td><td class="c">${x(r.pos === 'khac')}</td><td class="r">${fm(r.sal)}</td><td></td><td></td><td></td><td></td><td></td><td class="c">${r.hard ? d(r.join) : ''}</td><td></td><td class="c">${d(r.c3)}</td><td class="c">${d(r.c2a)}</td><td class="c">${d(r.c2b)}</td><td class="c">${d(r.c1a)}</td><td class="c">${d(r.c1b)}</td><td class="c">${esc(r.ins_from || '')}</td><td class="c">${esc(r.ins_to || '')}</td><td>${esc(r.note || '')}</td></tr>`).join('')}
  <tr class="sum"><td></td><td><b>Tổng: ${g.rows.length} người</b></td><td colspan="2"></td><td class="c">Nữ: ${g.rows.filter(r => r.gender === 'Nữ').length}</td><td colspan="22"></td></tr></table>
  <div class="sign" style="justify-content:flex-end"><div><b>ĐẠI DIỆN DOANH NGHIỆP, CƠ QUAN, TỔ CHỨC</b><br><i>(Chữ ký, dấu)</i></div></div>
  <p class="small"><i>Ghi chú: (2) Vị trí việc làm phân loại theo: Nhà quản lý — giữ chức vụ, có quyền quản lý, chỉ huy, điều hành; Chuyên môn kỹ thuật bậc cao — trình độ đại học trở lên; Chuyên môn kỹ thuật bậc trung — cao đẳng, trung cấp; Khác — còn lại.</i></p></div>`;
  return page('Mẫu 01/PLI', SHEET_CSS('A3') + (groups.map(one).join('') || '<p>Không có lao động trong kỳ.</p>'));
}
function report(r, p) {
  const v = (c, x) => { const a = x[c[0]]; return c[2] === 'm' ? fm(a) : c[2] === 'd' ? C.dmy(a) : c[2] === 'dt' && a ? new Date(new Date(a).getTime() + 7 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : a ?? ''; };
  const tbl = t => `<table>${t.groups ? `<tr>${t.groups.map(([l, n]) => `<th colspan="${n}">${esc(l || '')}</th>`).join('')}</tr>` : ''}<tr>${t.cols.map(c => `<th>${esc(c[1])}</th>`).join('')}</tr>${t.rows.map(x => `<tr>${t.cols.map(c => `<td${['n', 'm'].includes(c[2]) ? ' class="r"' : ''}>${esc(v(c, x))}</td>`).join('')}</tr>`).join('')}
  ${t.total && t.rows.length ? `<tr>${t.cols.map((c, i) => { const n = ['n', 'm'].includes(c[2]) && !(t.nosum || []).includes(c[0]); return `<th${n ? ' class="r"' : ''}>${i === 0 ? 'TỔNG CỘNG' : n ? (c[2] === 'm' ? fm : fnum)(t.rows.reduce((s, x) => s + (+x[c[0]] || 0), 0)) : ''}</th>`; }).join('')}</tr>` : ''}</table>`;
  return page(r.code, `<div class="top"><b>CÁT TƯỜNG GROUP</b><span>Mã: <b>${esc(r.code)}</b></span></div><h1>${esc(r.title.toUpperCase())}</h1><p class="c">${esc(p.month || p.year || '')}</p>
  <table class="nb"><tr>${r.kpis.map(k => `<td><b>${esc(k[0])}:</b> ${esc(typeof k[1] === 'number' ? fm(k[1]) : k[1])} ${esc(k[2] || '')}</td>`).join('')}</tr></table>
  ${tbl(r)}${(r.extra || []).map(x => `<p><b>${esc(x.title || '')}</b></p>${tbl(x)}`).join('')}
  <div class="sign"><div><b>NGƯỜI LẬP</b></div><div><b>NGƯỜI KIỂM TRA</b></div><div><b>NGƯỜI PHÊ DUYỆT</b></div></div>`);
}
module.exports = { form, payslip, slips, bank, payPack, report, page, moneyWords, sheets, pli };
