// Lõi giao diện: tiện ích, API, hộp thoại, form tự sinh từ meta, chi tiết.
'use strict';
let M = null;
const OPT = {};
const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fm = n => n == null || n === '' || isNaN(n) ? '' : Math.round(+n).toLocaleString('vi-VN');
const fnum = n => n == null || n === '' ? '' : isNaN(n) ? n : (+n).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const dmy = v => v && /^\d{4}-\d{2}-\d{2}/.test(v) ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : '';
const dmyhm = v => { if (!v) return ''; const z = new Date(new Date(v).getTime() + 7 * 3600e3).toISOString(); return `${dmy(z)} ${z.slice(11, 16)}`; };
const mmy = v => v && /^\d{4}-\d{2}$/.test(v) ? `${v.slice(5)}/${v.slice(0, 4)}` : v || '';
const ico = (n, c = '') => `<i class="fa-solid ${n} ${c}"></i>`;
const curM = () => M.today.slice(0, 7);
const pill = (l, c) => `<span class="pill ${c || ''}">${esc(l)}</span>`;
const ws = s => /Quá hạn|Thiếu|thiếu|Chưa trả|trùng/.test(s) ? 'r' : /Sắp|Dưới|Cần|chưa/.test(s) ? 'a' : 'g';
async function api(method, url, body) {
  if (method !== 'GET') api.wrote = Date.now();   // thao tác của chính mình: màn hình tự làm mới rồi, bỏ qua lần báo «dữ liệu đổi» ngay sau đó
  const o = { method, headers: {} }; if (body instanceof FormData) o.body = body; else if (body !== undefined) { o.body = JSON.stringify(body); o.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(url, o), d = (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text();
  if (r.status === 401) { showLogin(); throw new Error('Cần đăng nhập'); }
  if (!r.ok) { const e = new Error(d.error || d); e.fields = d.fields; throw e; } return d;
}
let tT; function toast(m, err) { let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.append(t); } t.textContent = m; t.classList.toggle('err', !!err); t.hidden = false; clearTimeout(tT); tT = setTimeout(() => t.hidden = true, err ? 7000 : 3500); }
const run = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };
function modal({ title, body = '', cls = '', foot = '' }) {
  const ov = document.createElement('div'); ov.className = 'ov';
  ov.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true"><div class="mh"><h3>${title}</h3><button class="btn sm" data-x aria-label="Đóng">${ico('fa-xmark')}</button></div><div class="mb2">${body}</div>${foot ? `<div class="mf">${foot}</div>` : ''}</div>`;
  document.body.append(ov); const close = () => ov.remove();
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); }); $$('[data-x]', ov).forEach(b => b.onclick = close);
  return { el: ov, close, body: $('.mb2', ov), foot: $('.mf', ov) };
}
function ask(title, msg, { ok = 'Đồng ý', reason, danger, date } = {}) {
  return new Promise(res => {
    const m = modal({ title, cls: 'nar', body: `<p>${msg}</p>${reason ? `<div class="fld">${date ? `<input type="date" id="askR" value="${M.today}">` : `<textarea id="askR"></textarea>`}</div>` : ''}`, foot: `<button class="btn" data-x>Hủy</button><button class="btn ${danger ? 'danger' : 'pri'}" id="askOk">${ok}</button>` });
    $('[data-x]', m.foot).addEventListener('click', () => res(false));
    $('#askOk', m.el).onclick = () => { const v = reason ? $('#askR', m.el).value.trim() : true; m.close(); res(v); };
  });
}
// hỏi các ô của một thao tác (vd. nhận việc: ngày + lương thỏa thuận); 1 ô chữ thì dùng hộp lý do như cũ
function askForm(title, fields) {
  if (fields.length === 1 && fields[0].t !== 'money') { const f = fields[0]; return ask(title, f.l, { reason: 1, date: f.t === 'date' }).then(v => v ? { [f.k]: v } : false); }
  return new Promise(res => {
    const m = modal({ title, cls: 'nar', body: fields.map(f => `<div class="fld"><label>${esc(f.l)}${f.req ? '<span class="req"> *</span>' : ''}</label><input data-k="${f.k}" ${f.t === 'date' ? `type="date" value="${f.def === 'today' ? M.today : ''}"` : f.t === 'money' ? 'inputmode="numeric" class="money" placeholder="Bỏ trống nếu chưa chốt"' : ''}></div>`).join(''), foot: `<button class="btn" data-x>Hủy</button><button class="btn pri" id="askOk">Đồng ý</button>` });
    $$('input.money', m.el).forEach(i => i.oninput = () => { const v = i.value.replace(/\D/g, ''); i.value = v ? (+v).toLocaleString('vi-VN') : ''; });
    $('[data-x]', m.foot).addEventListener('click', () => res(false));
    $('#askOk', m.el).onclick = () => {
      const d = {}; for (const f of fields) { const v = $(`[data-k="${f.k}"]`, m.el).value.trim(); if (f.req && !v) return toast(`Chưa nhập ${f.l}`, true); if (v) d[f.k] = f.t === 'money' ? +v.replace(/\D/g, '') : v; }
      m.close(); res(d);
    };
  });
}
// thao tác cần bảng riêng: điểm danh (tick từng buổi × từng học viên), cập nhật kết quả đào tạo
const ACT_UI = {
  // HCNS điểm danh / ghi vi phạm 5S cho cả danh sách người áp dụng của một ngày
  'culture.ghi_nhan': async id => new Promise(ok => {
    const m = modal({ title: 'Điểm danh / ghi vi phạm', cls: 'wide', body: `<div class="row mb"><label>Ngày</label><input type="date" id="cgD" value="${M.today}" style="height:36px"><span class="grow"></span><button type="button" class="btn sm" id="cgA">${ico('fa-check-double')} Tất cả có mặt</button></div><div id="cgL"><div class="empty">Đang tải…</div></div>`, foot: `<button class="btn" data-x>Hủy</button><button class="btn pri" id="cgOk">${ico('fa-floppy-disk')} Lưu</button>` });
    const L = { co_mat: 'Có mặt', vang: 'Vắng', vi_pham: 'Vi phạm (5S)' };
    const load = async () => { const r = await api('GET', `/api/culture/${id}/roster?day=${$('#cgD', m.el).value}`);
      $('#cgL', m.el).innerHTML = r.rows.length ? `<div class="tw" style="max-height:52vh"><table class="t"><thead><tr><th>Mã NV</th><th>Họ tên</th><th>Đã ghi</th><th>Kết quả</th></tr></thead><tbody>${r.rows.map(x => `<tr data-e="${x.id}"><td>${esc(x.code)}</td><td>${esc(x.full_name)}</td><td class="small muted">${x.log ? `${esc(L[x.log.result] || x.log.result)}${x.log.at ? ' ' + esc(x.log.at) : ''} · ${x.log.source === 'nv' ? 'tự điểm danh' : 'HCNS'}` : ''}</td><td><select class="cgr"><option value="">— giữ nguyên —</option>${Object.entries(L).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Không có nhân viên thuộc phạm vi hoạt động</div>'; };
    $('#cgD', m.el).onchange = run(load); load().catch(e => toast(e.message, true));
    $('#cgA', m.el).onclick = () => $$('tr[data-e]', m.el).forEach(tr => { if (!$('.small', tr).textContent) $('.cgr', tr).value = 'co_mat'; });
    $('[data-x]', m.el).onclick = () => { m.close(); ok(false); };
    $('#cgOk', m.el).onclick = () => { const marks = Object.fromEntries($$('tr[data-e]', m.el).map(tr => [tr.dataset.e, $('.cgr', tr).value]).filter(x => x[1])); m.close(); ok({ day: $('#cgD', m.el).value, marks }); };
  }),
  'training.diem_danh': async id => { const r = (await api('GET', `/api/e/training/${id}`)).row, ss = r.sched || [], es = (r.emps || []).filter(x => x.code);
    if (!ss.length || !es.length) { toast('Khóa chưa có lịch học hoặc học viên — bấm Sửa để thêm', true); return false; }
    return new Promise(ok => { const m = modal({ title: `Điểm danh · ${esc(r.name)}`, cls: 'wide', body: `<div class="tw"><table class="t"><thead><tr><th>Học viên</th>${ss.map((s, i) => `<th class="c">Buổi ${i + 1}<div class="small muted">${esc(s.day || '')}</div><label class="small"><input type="checkbox" data-col="${i}"> cả buổi</label></th>`).join('')}<th class="n">Có mặt</th></tr></thead><tbody>${es.map(x => `<tr data-e="${esc(x.code)}"><td><b>${esc(x.name || '')}</b> <span class="small muted">${esc(x.code)}</span></td>${ss.map((_, i) => `<td class="c"><input type="checkbox" data-i="${i}" ${(r.att || {})[x.code]?.[i] ? 'checked' : ''}></td>`).join('')}<td class="n" data-sum></td></tr>`).join('')}</tbody></table></div>`, foot: `<button class="btn" data-x>Hủy</button><button class="btn pri" id="ddOk">${ico('fa-floppy-disk')} Lưu điểm danh</button>` });
      const sum = () => $$('tr[data-e]', m.el).forEach(tr => { $('[data-sum]', tr).textContent = `${$$('[data-i]:checked', tr).length}/${ss.length}`; }); sum();
      m.el.addEventListener('change', ev => { const c = ev.target.dataset.col; if (c != null) $$(`[data-i="${c}"]`, m.el).forEach(x => x.checked = ev.target.checked); sum(); });
      $('[data-x]', m.el).onclick = () => { m.close(); ok(false); };
      $('#ddOk', m.el).onclick = () => { const att = Object.fromEntries($$('tr[data-e]', m.el).map(tr => [tr.dataset.e, $$('[data-i]', tr).map(x => x.checked)])); m.close(); ok({ att }); }; }); },
  'training.ket_qua': async id => { const r = (await api('GET', `/api/e/training/${id}`)).row, es = (r.emps || []).filter(x => x.code), n = (r.sched || []).length;
    if (!es.length) { toast('Khóa chưa có học viên', true); return false; }
    return new Promise(ok => { const m = modal({ title: `Kết quả đào tạo · ${esc(r.name)}`, cls: 'wide', body: `<p class="muted small">Lưu xong app gửi kết quả cho từng học viên qua app và ghi vào lịch sử đào tạo của người đó.</p><div class="tw"><table class="t"><thead><tr><th>Học viên</th><th class="n">Có mặt</th><th>Kết quả</th><th>Điểm / nhận xét</th></tr></thead><tbody>${es.map(x => `<tr data-e="${esc(x.code)}"><td><b>${esc(x.name || '')}</b> <span class="small muted">${esc(x.code)}</span></td><td class="n">${n ? `${((r.att || {})[x.code] || []).filter(Boolean).length}/${n}` : ''}</td><td><select data-r><option></option>${['Đạt', 'Chưa đạt', 'Vắng'].map(o => `<option ${o === x.result ? 'selected' : ''}>${o}</option>`).join('')}</select></td><td><input data-s value="${esc(x.score || '')}" style="width:100%"></td></tr>`).join('')}</tbody></table></div>`, foot: `<button class="btn" data-x>Hủy</button><button class="btn pri" id="kqOk">${ico('fa-floppy-disk')} Lưu và gửi kết quả</button>` });
      $('[data-x]', m.el).onclick = () => { m.close(); ok(false); };
      $('#kqOk', m.el).onclick = () => { const res = Object.fromEntries($$('tr[data-e]', m.el).map(tr => [tr.dataset.e, { result: $('[data-r]', tr).value, score: $('[data-s]', tr).value.trim() }])); m.close(); ok({ res }); }; }); },
};
async function runAct(ent, id, a) {
  const d = ACT_UI[`${ent}.${a.k}`] ? await ACT_UI[`${ent}.${a.k}`](id) : a.ask ? await askForm(a.l, a.ask) : {}; if (!d) return;
  const x = await api('POST', `/api/e/${ent}/${id}/act/${a.k}`, d); toast(x.note || 'Đã thực hiện'); await refresh(); if (x.form) await openForm(x.form[0], null, x.form[1]); else if (x.open) await openDetail(x.open[0], x.open[1]); else await openDetail(ent, id);   // form: mở sẵn phiếu mới đã điền (chưa lưu)
}
async function opts(ent) { return OPT[ent] ||= await api('GET', '/api/opts/' + ent); }

// ---------- hiển thị ----------
function show(f, r) {
  if (f.created && r.created_at) return dmyhm(r.created_at);   // ngày làm đơn / đăng ký: tự lấy lúc tạo phiếu, hiện đủ ngày giờ
  const v = r[f.k]; if (v == null || v === '') return '<span class="muted">—</span>';
  switch (f.t) {
    case 'money': return fm(v); case 'num': return fnum(v); case 'date': return dmy(v); case 'dt': return dmyhm(v); case 'month': return mmy(v);
    case 'bool': return v ? ico('fa-circle-check') + ' Có' : 'Không'; case 'sel': { const o = (f.o || []).find(x => x[0] === v); return o?.[2] ? pill(o[1], o[2]) : esc(o?.[1] ?? v); }
    case 'ref': return esc(r[f.k + '__l'] ?? '#' + v); case 'days': return esc(v.join(', ')); case 'multi': return esc(v.map(x => (f.o.find(o => o[0] === x) || [])[1] || x).join(', '));
    case 'json': return f.grid ? gridView(f, v) : ''; case 'long': return esc(v).replace(/\n/g, '<br>'); default: return esc(v);
  }
}
const gridView = (f, v) => !v?.length ? '<span class="muted">—</span>' : `<div class="tw" style="max-height:300px"><table class="t"><thead><tr><th>#</th>${f.grid.map(c => `<th>${esc(c.l)}</th>`).join('')}</tr></thead><tbody>${v.map((x, i) => `<tr><td>${i + 1}</td>${f.grid.map(c => `<td${c.n ? ' class="n"' : ''}>${esc(x[c.k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const colL = (e, k) => e.fields.find(f => f.k === k)?.l || M.virt[k] || k;
const cell = (e, k, r) => { const f = e.fields.find(x => x.k === k); return f ? show(f, r) : r[k] == null || r[k] === '' ? '<span class="muted">—</span>' : typeof r[k] === 'string' ? (r[k + '_c'] ? pill(r[k], r[k + '_c']) : esc(r[k])) : esc(fnum(r[k])); };   // cột ảo chữ: kèm màu «_c» thì hiện nhãn màu
const isNum = (e, k) => ['money', 'num', 'int'].includes(e.fields.find(f => f.k === k)?.t) || (k in M.virt && !['_handler', 'c_due', '_files', 'appr_by', 'use_st'].includes(k));

// ---------- form ----------
// người (nhân viên, ứng viên): ô gõ để tìm, không hiện sẵn danh sách (mấy trăm người, tránh lộ thông tin)
const PEOPLE = new Set(['employee', 'candidate']);
function typeahead(i, ref, onPick) {
  const box = i.nextElementSibling; let t, items = [], at = -1;
  const draw = () => { box.innerHTML = items.map((x, k) => `<div data-k="${k}" class="${k === at ? 'on' : ''}">${esc(x.label)}</div>`).join('') || '<div class="muted">Không tìm thấy</div>'; box.classList.remove('hidden'); };
  const pick = x => { i.value = x.label; i.dataset.id = x.id; box.classList.add('hidden'); i.dispatchEvent(new Event('change', { bubbles: true })); onPick?.(x); };
  i.addEventListener('input', () => { i.dataset.id = ''; clearTimeout(t); const s = i.value.trim(); if (s.length < 2) return box.classList.add('hidden'); t = setTimeout(async () => { items = await api('GET', `/api/opts/${ref}?q=${encodeURIComponent(s)}`); at = items.length ? 0 : -1; draw(); }, 200); });
  i.addEventListener('keydown', ev => { if (box.classList.contains('hidden') || !items.length) return; if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); at = (at + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; draw(); } else if (ev.key === 'Enter') { ev.preventDefault(); pick(items[Math.max(at, 0)]); } });
  box.addEventListener('mousedown', ev => { const d = ev.target.closest('[data-k]'); if (!d) return; ev.preventDefault(); pick(items[+d.dataset.k]); });
  i.addEventListener('blur', () => setTimeout(() => { box.classList.add('hidden'); if (!i.dataset.id) i.value = ''; }, 150));
}
// ô ngày: gõ tay theo ngày/tháng/năm (ngày sinh, ngày đã lâu) hoặc bấm lịch để chọn (ngày gần đây); giá trị gốc vẫn dạng ISO cho code đọc
const DX = { date: 'dd/mm/yyyy', month: 'mm/yyyy', 'datetime-local': 'dd/mm/yyyy hh:mm' };
function enhanceDate(n) {
  if (n.dataset.dx) return; n.dataset.dx = 1;
  const t = n.type, w = document.createElement('span'), tx = document.createElement('input'), b = document.createElement('button');
  w.className = 'dx'; tx.className = 'dxt'; tx.placeholder = DX[t]; tx.autocomplete = 'off'; b.type = 'button'; b.className = 'dxb'; b.tabIndex = -1; b.title = 'Chọn trên lịch'; b.innerHTML = ico('fa-calendar-days');
  const p2 = x => String(x).padStart(2, '0');
  const fmt = v => !v ? '' : t === 'date' ? dmy(v) : t === 'month' ? `${v.slice(5, 7)}/${v.slice(0, 4)}` : `${dmy(v.slice(0, 10))} ${v.slice(11, 16)}`;
  const parse = s => {
    s = s.trim(); if (!s) return ''; let m;
    if (t === 'month') { m = /^(\d{1,2})[/.-](\d{4})$/.exec(s); return m && +m[1] >= 1 && +m[1] <= 12 ? `${m[2]}-${p2(m[1])}` : null; }
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s+(\d{1,2})[:hg](\d{2}))?$/.exec(s); if (!m) return null;
    const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])); if (d.getUTCMonth() !== +m[2] - 1) return null;
    const iso = `${m[3]}-${p2(m[2])}-${p2(m[1])}`; return t === 'date' ? iso : `${iso}T${p2(m[4] || '08')}:${m[5] || '00'}`;
  };
  n.classList.add('dxn'); n.tabIndex = -1; n.parentNode.insertBefore(w, n); w.append(tx, n, b); tx.value = fmt(n.value);
  tx.addEventListener('input', ev => { if (ev.inputType?.startsWith('delete')) return; const v = tx.value; if (t === 'month' ? /^\d{2}$/.test(v) : /^\d{2}$|^\d{2}\/\d{2}$/.test(v)) tx.value = v + '/'; });   // gõ 03 → 03/
  tx.addEventListener('change', ev => { ev.stopPropagation(); const v = parse(tx.value); tx.classList.toggle('bad', v === null); if (v === null) return toast(`Ngày không hợp lệ — nhập theo ${DX[t]}`, true); n.value = v; tx.value = fmt(v); n.dispatchEvent(new Event('change', { bubbles: true })); });
  n.addEventListener('change', () => { tx.value = fmt(n.value); tx.classList.remove('bad'); });
  b.onclick = () => { try { n.showPicker(); } catch { n.focus(); } };
}
new MutationObserver(ms => { for (const m of ms) for (const nd of m.addedNodes) if (nd.nodeType === 1) { if (nd.matches('input[type=date],input[type=month],input[type=datetime-local]')) enhanceDate(nd); nd.querySelectorAll('input[type=date],input[type=month],input[type=datetime-local]').forEach(enhanceDate); } })
  .observe(document.documentElement, { childList: true, subtree: true });
const shownF = (f, r) => !f.show || Object.entries(f.show).every(([k, v]) => v.includes(r[k]));
function inp(f, v) {
  const a = `name="${f.k}"`;
  switch (f.t) {
    case 'long': return `<textarea ${a}>${esc(v)}</textarea>`;
    case 'date': return `<input type="date" ${a} value="${esc(v || '')}">`;
    case 'dt': { const z = v ? new Date(new Date(v).getTime() + 7 * 3600e3).toISOString().slice(0, 16) : ''; return `<input type="datetime-local" ${a} value="${z}">`; }
    case 'month': return `<input type="month" ${a} value="${esc(v || '')}">`;
    case 'time': return `<input type="time" ${a} value="${esc(v || '')}">`;
    case 'money': return `<input ${a} inputmode="numeric" data-money value="${v == null ? '' : fm(v)}">`;
    case 'int': case 'num': return `<input ${a} inputmode="decimal" value="${esc(v ?? '')}">`;
    case 'bool': return `<label class="row" style="margin-top:8px"><input type="checkbox" ${a} ${v ? 'checked' : ''}> Có</label>`;
    case 'sel': return `<select ${a}><option value="">— chọn —</option>${(f.o || []).map(o => `<option value="${esc(o[0])}" ${o[0] === v ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
    case 'ref': return PEOPLE.has(f.ref) ? `<div class="ta"><input data-ta="${f.ref}" ${a} data-id="${v ?? ''}" placeholder="Gõ tên hoặc mã để tìm…" autocomplete="off"><div class="tal hidden"></div></div>`
      : `<input list="dl_${f.ref}" data-ref="${f.ref}" ${a} data-id="${v ?? ''}" placeholder="Gõ để tìm…" autocomplete="off">`;
    case 'days': return `<div class="days" data-days="${f.k}">${Array.from({ length: 31 }, (_, i) => `<label><input type="checkbox" value="${i + 1}" ${(v || []).includes(i + 1) ? 'checked' : ''}>${i + 1}</label>`).join('')}</div><button type="button" class="btn sm mt" data-alld>Chọn T2–T7 trong tháng</button>`;
    case 'multi': return `<div class="row" data-multi="${f.k}">${f.o.map(o => `<label class="row" style="margin:0"><input type="checkbox" value="${o[0]}" ${(v || []).includes(o[0]) ? 'checked' : ''}> ${esc(o[1])}</label>`).join('')}</div>`;
    case 'tags': { const cur = String(v || '').split(',').map(x => x.trim()).filter(Boolean), extra = cur.filter(x => !f.sug.includes(x));
      return `<div class="row" data-tags="${f.k}" style="flex-wrap:wrap;gap:4px 14px">${f.sug.map(s => `<label class="row" style="margin:0"><input type="checkbox" value="${esc(s)}" ${cur.includes(s) ? 'checked' : ''}> ${esc(s)}</label>`).join('')}<input data-tagx placeholder="Kênh khác (cách nhau dấu phẩy)" value="${esc(extra.join(', '))}" style="flex:1;min-width:180px"></div>`; }
    case 'json': return f.grid ? `<div class="gt" data-grid="${f.k}"></div>` : '';
    default: return `<input ${a} value="${esc(v ?? '')}" ${f.pick ? `list="dl_${f.pick}c"` : f.sugEmp ? 'list="dl_empname"' : f.sug ? `list="sg_${f.k}"` : ''} autocomplete="off">${f.sug ? `<datalist id="sg_${f.k}">${f.sug.map(s => `<option value="${esc(s)}">`).join('')}</datalist>` : ''}`;
  }
}
// ô tiền: tự thêm dấu chấm ngăn cách ngay khi gõ (1.500.000), giữ con trỏ đúng chỗ
const moneyLive = root => root.addEventListener('input', ev => { const i = ev.target; if (!i.matches?.('[data-money]')) return;
  const digitsAfter = i.value.slice(i.selectionStart ?? i.value.length).replace(/\D/g, '').length, d = i.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  i.value = d ? fm(+d) : ''; let k = i.value.length, c = 0; while (k > 0 && c < digitsAfter) { k--; if (/\d/.test(i.value[k])) c++; } i.setSelectionRange?.(k, k); });
function drawGrid(el, f, rows) {
  el.innerHTML = `<div class="tw" style="max-height:320px"><table class="t"><thead><tr><th>#</th>${f.grid.map(c => `<th style="min-width:${c.w || 110}px">${esc(c.l)}</th>`).join('')}<th></th></tr></thead><tbody>${rows.map((x, i) => `<tr><td>${i + 1}</td>${f.grid.map(c => `<td>${c.o ? `<select data-c="${c.k}"><option></option>${c.o.map(o => `<option ${o === x[c.k] ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : c.d && (isoOf(x[c.k]) || !String(x[c.k] ?? '').trim()) ? `<input type="date" data-c="${c.k}" data-dmy value="${esc(isoOf(x[c.k]))}">` : `<input data-c="${c.k}" value="${esc(c.m && x[c.k] !== '' && x[c.k] != null && !isNaN(+String(x[c.k]).replace(/\./g, '')) ? fm(+String(x[c.k]).replace(/\./g, '')) : x[c.k])}" ${c.pick ? `list="dl_${c.pick}c"` : ''}${c.m ? ' data-money inputmode="numeric"' : ''} autocomplete="off">`}</td>`).join('')}<td><button type="button" class="btn sm" data-del="${i}">${ico('fa-xmark')}</button></td></tr>`).join('')}</tbody></table></div><button type="button" class="btn sm mt" data-add>${ico('fa-plus')} Thêm dòng</button>`;
}
// cột ngày trong bảng (d: 1): ô có nút lịch; vẫn lưu dạng dd/mm/yyyy như trước (dữ liệu cũ, phần tính lịch học / ca đọc dạng này)
const isoOf = v => { const s = String(v ?? '').trim(), m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; };
// ngày cũ không đọc được (dạng lạ) thì vẫn hiện ô chữ để không mất dữ liệu; chỉ ô lịch (type=date) mới đổi về dd/mm/yyyy
const gridRead = (el, f) => $$('tbody tr', el).map(tr => Object.fromEntries(f.grid.map(c => { const i = $(`[data-c="${c.k}"]`, tr), v = i.value.trim(); return [c.k, c.d && v && i.type === 'date' ? dmy(v) : v]; })));
async function wire(root, e, rec) {
  const refs = [...new Set(e.fields.filter(f => f.t === 'ref' && !PEOPLE.has(f.ref)).map(f => f.ref))], picks = [...new Set(e.fields.flatMap(f => [f.pick, ...(f.grid || []).map(c => c.pick)]).filter(Boolean))];
  for (const r of refs) { const o = await opts(r); root.insertAdjacentHTML('beforeend', `<datalist id="dl_${r}">${o.map(x => `<option value="${esc(x.label)}">`).join('')}</datalist>`); }
  // ô nhân viên: gõ để tìm; chọn nhân viên trên phiếu → tự điền pháp nhân, bộ phận, chức danh từ hồ sơ
  for (const i of $$('input[data-ta]', root)) {
    if (i.dataset.id && rec[i.name + '__l']) i.value = rec[i.name + '__l'];
    typeahead(i, i.dataset.ta, async x => {
      if (i.name !== 'emp_id' || i.dataset.ta !== 'employee') return;
      const b = await api('GET', '/api/emp-brief/' + x.id).catch(() => null); if (!b) return;
      for (const [k, id, lab] of [['legal_id', b.legal_id, b.legal], ['dept_id', b.dept_id, b.dept]]) { const t = $(`[name="${k}"][data-ref]`, root); if (t && id) { t.dataset.id = id; t.value = OPT[t.dataset.ref]?.find(y => y.id === id)?.label || lab || ''; } }
      const tt = $('[name="title"]', root); if (tt && !tt.value && b.title) tt.value = b.title;
      root.dispatchEvent(new Event('change'));
    });
  }
  // người (NV, ứng viên): tải mới mỗi lần mở form — ứng viên vừa thêm ở màn khác vẫn chọn được; cột có pickSt chỉ gợi ý đúng trạng thái (vd. ứng viên đang chờ phỏng vấn)
  for (const p of picks) { let o = PEOPLE.has(p) ? (OPT[p] = await api('GET', `/api/opts/${p}?all=1`)) : await opts(p); const st = e.fields.flatMap(f => f.grid || []).find(c => c.pick === p && c.pickSt)?.pickSt; if (st) o = o.filter(x => st.includes(x.status)); const full = e.fields.flatMap(f => f.grid || []).some(c => c.pick === p && c.pickFull);   // pickFull: ô lưu «mã · họ tên» (gõ tên để chọn, vẫn biết đúng người)
    root.insertAdjacentHTML('beforeend', `<datalist id="dl_${p}c">${o.map(x => `<option value="${esc(full ? `${x.code} · ${x.name || x.full_name || x.label}` : x.code ?? x.label)}">${full ? '' : esc(x.name || x.full_name || x.label)}</option>`).join('')}</datalist>`); }
  // ô tên người gõ tự do (người ký, người đóng dấu, người chủ trì…): gợi ý họ tên nhân viên, vẫn gõ được tên người ngoài
  if (e.fields.some(f => f.sugEmp)) { const o = await api('GET', '/api/opts/employee?all=1').catch(() => []);
    root.insertAdjacentHTML('beforeend', `<datalist id="dl_empname">${o.map(x => `<option value="${esc(x.full_name || x.name || x.label)}">${esc(x.code || '')}</option>`).join('')}</datalist>`); }
  for (const i of $$('input[data-ref]', root)) { const o = OPT[i.dataset.ref], x = o.find(y => y.id === +i.dataset.id); if (x) i.value = x.label; else if (i.dataset.id && rec[i.name + '__l']) i.value = rec[i.name + '__l']; i.onchange = () => { const y = o.find(z => z.label === i.value); i.dataset.id = y?.id ?? ''; if (!y && i.value) i.value = ''; }; }
  for (const f of e.fields.filter(f => f.grid && !f.ro)) {
    const el = $(`[data-grid="${f.k}"]`, root); if (!el) continue; drawGrid(el, f, rec[f.k]?.length ? [...rec[f.k]] : [{}, {}]);
    // Enter trong bảng: xuống ô cùng cột dòng dưới; dòng cuối → tự thêm dòng (nhập liền nhiều học viên / ứng viên)
    el.addEventListener('keydown', ev => { if (ev.key !== 'Enter' || !ev.target.dataset?.c) return; ev.preventDefault(); ev.target.dispatchEvent(new Event('change', { bubbles: true }));
      const c = ev.target.dataset.c, trs = $$('tbody tr', el), i = trs.indexOf(ev.target.closest('tr'));
      setTimeout(() => { if (i === trs.length - 1) drawGrid(el, f, [...gridRead(el, f), {}]); const t = $$('tbody tr', el)[i + 1]; $(`[data-c="${c}"]`, t)?.focus(); }, 0); });
    el.addEventListener('click', ev => { if (ev.target.closest('[data-add]')) drawGrid(el, f, [...gridRead(el, f), {}]); const d = ev.target.closest('[data-del]'); if (d) drawGrid(el, f, gridRead(el, f).filter((_, i) => i !== +d.dataset.del)); });
    el.addEventListener('change', ev => { const c = f.grid.find(x => x.k === ev.target.dataset.c); if (!c?.pick) return; const o = OPT[c.pick].find(x => x.code === ev.target.value); if (o) for (const [to, from] of Object.entries(c.fill || {})) { const t = $(`[data-c="${to}"]`, ev.target.closest('tr')); if (t && !t.value) t.value = o[from] ?? ''; } });
  }
  moneyLive(root);
  $$('[data-alld]', root).forEach(b => b.onclick = () => { const m = $('[name=month]', root).value; if (!m) return toast('Chọn tháng trước', true); $$('[data-days] input', root).forEach(c => { const d = new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, +c.value), dow = d.getDay(); c.checked = d.getMonth() === +m.slice(5, 7) - 1 && dow > 0; }); });
  const dep = () => { const r = readForm(root, e); for (const f of e.fields) { const w = $(`[data-f="${f.k}"]`, root); if (w) w.classList.toggle('hidden', !shownF(f, r)); } };
  root.addEventListener('change', dep); dep();
}
function readForm(root, e) {
  const o = {};
  for (const f of e.fields) {
    if (f.ro) continue; const i = $(`[name="${f.k}"]`, root);
    if (f.t === 'days') { o[f.k] = $$(`[data-days="${f.k}"] input:checked`, root).map(c => +c.value); continue; }
    if (f.t === 'multi') { o[f.k] = $$(`[data-multi="${f.k}"] input:checked`, root).map(c => c.value); continue; }
    if (f.t === 'tags') { const el = $(`[data-tags="${f.k}"]`, root); if (el) o[f.k] = [...$$('input:checked', el).map(c => c.value), ...$('[data-tagx]', el).value.split(',')].map(x => x.trim()).filter(Boolean).join(', ') || null; continue; }
    if (f.grid) { const el = $(`[data-grid="${f.k}"]`, root); if (el) o[f.k] = gridRead(el, f); continue; }
    if (!i) continue;
    o[f.k] = f.t === 'bool' ? i.checked : f.t === 'ref' ? (i.dataset.id ? +i.dataset.id : null) : f.t === 'money' ? (i.value ? +i.value.replace(/\D/g, '') : null) : i.value.trim() === '' ? null : f.t === 'dt' ? i.value + ':00+07:00' : i.value.trim();
  }
  return o;
}
// đính kèm ngay khi tạo / sửa: mỗi dòng = loại giấy tờ + tệp; lưu xong mới tải lên (cần id bản ghi)
const attRow = e => `<div class="row att">${e.files.length > 1 ? `<select class="atk" style="height:36px">${e.files.map(k => `<option value="${k[0]}">${esc(k[1])}</option>`).join('')}</select>` : `<input type="hidden" class="atk" value="${e.files[0][0]}">`}<input type="file" class="atf" multiple></div>`;
async function upAtt(root, ent, id) {
  for (const r of $$('.att', root)) { const fl = $('.atf', r).files; if (!fl.length) continue; const fd = new FormData(); [...fl].forEach(f => fd.append('f', f)); fd.append('kind', $('.atk', r).value); await api('POST', `/api/e/${ent}/${id}/files`, fd); }
}
async function openForm(ent, id, preset = {}) {
  const e = M.ents[ent], rec = id ? (await api('GET', `/api/e/${ent}/${id}?reveal=1`)).row : { ...Object.fromEntries(e.fields.filter(f => f.def !== undefined).map(f => [f.k, f.def === 'today' ? M.today : f.def === 'year' ? (f.t === 'int' ? +M.today.slice(0, 4) : M.today.slice(0, 4)) : f.def === 'me_emp' ? M.me.emp_id : f.def])), ...preset };
  // đơn từ không lập hộ: người làm đơn (và pháp nhân, bộ phận) lấy theo tài khoản đăng nhập, chỉ hiển thị
  const lockK = new Set(e.own ? [e.own, 'legal_id', 'dept_id'] : []), me = M.meEmp;
  const fs_ = e.fields.filter(f => !f.ro && !f.auto && f.t !== 'code' && !(f.hcns && M.me.role === 'nld') && !lockK.has(f.k));   // ô chỉ HCNS nhập: ẩn với nhân viên
  const has = k => e.fields.some(f => f.k === k && !f.hide);
  const who = !e.own ? '' : id ? [rec[e.own + '__l'], has('legal_id') && rec.legal_id__l, has('dept_id') && rec.dept_id__l] : me ? [`${me.code} – ${me.full_name}${me.title ? ` (${me.title})` : ''}`, has('legal_id') && me.legal, has('dept_id') && me.dept] : null;
  const ownBox = !e.own ? '' : who ? `<div class="banner mb">${ico('fa-user-pen')} Người làm đơn: <b>${esc(who[0] || '')}</b>${who[1] ? ` · Pháp nhân: <b>${esc(who[1])}</b>` : ''}${who[2] ? ` · Bộ phận: <b>${esc(who[2])}</b>` : ''}</div>` : `<div class="banner mb">Tài khoản chưa gắn hồ sơ nhân viên — không lập được ${esc(e.one)}. Liên hệ HCNS để gắn hồ sơ.</div>`;
  const m = modal({ title: `${id ? 'Sửa' : 'Tạo'} ${esc(e.one)} <span class="tag">${esc(e.code || '')}</span>`, cls: fs_.some(f => f.grid) ? 'wide' : '', body: `${ownBox}${e.help ? `<p class="muted">${esc(e.help)}</p>` : ''}${ent === 'candidate' && !id ? `<div class="cvai"><label class="btn pri">${ico('fa-wand-magic-sparkles')} Nhập từ CV (AI)<input type="file" id="cvf" accept=".pdf,.docx,.jpg,.jpeg,.png,.webp" hidden></label><span class="small muted" id="cvs">Chọn file CV (PDF, Word, ảnh) — AI điền sẵn các ô, kiểm tra lại rồi bổ sung phần còn thiếu</span></div>` : ''}<div class="fg">${fs_.map(f => `${f.sec ? `<h4>${esc(f.sec)}</h4>` : ''}<div class="fld ${['long', 'json', 'days', 'multi'].includes(f.t) ? 'full' : ''}" data-f="${f.k}"><label>${esc(f.l)}${f.req ? '<span class="req"> *</span>' : ''}</label>${inp(f, rec[f.k])}${f.help ? `<div class="help">${esc(f.help)}</div>` : ''}</div>`).join('')}${e.files?.length ? `<div class="fld full"><label>Đính kèm hồ sơ / giấy tờ</label><div id="fatt">${attRow(e)}</div><button type="button" class="btn sm mt" id="fadd">${ico('fa-plus')} Thêm tệp</button><div class="help">Chọn loại giấy tờ rồi chọn tệp — tệp được đặt tên theo loại để dễ tìm.</div></div>` : ''}</div>`, foot: `<button class="btn" data-x2>Hủy</button><button class="btn pri" id="sv">${ico('fa-floppy-disk')} Lưu</button>` });
  $('[data-x2]', m.el).onclick = m.close; await wire(m.body, e, rec); if ($('#fadd', m.el)) $('#fadd', m.el).onclick = () => $('#fatt', m.el).insertAdjacentHTML('beforeend', attRow(e));
  // ứng viên: AI đọc CV → điền các ô còn trống (ô đã gõ thì giữ nguyên), gắn luôn file CV vào phần đính kèm
  if ($('#cvf', m.el)) $('#cvf', m.el).onchange = async ev => {
    const f = ev.target.files[0], s = $('#cvs', m.el), lb = ev.target.closest('label'); if (!f) return;
    s.textContent = 'AI đang đọc CV… (khoảng 10–30 giây)'; lb.classList.add('busy');
    try {
      const fd = new FormData(); fd.append('f', f); const { data } = await api('POST', '/api/cv-parse', fd); let n = 0;
      for (const [k, v] of Object.entries(data)) {
        if (Array.isArray(v)) { const gf = e.fields.find(x => x.k === k && x.grid), el = gf && $(`[data-grid="${k}"]`, m.body); if (el && !gridRead(el, gf).some(r => Object.values(r).some(Boolean))) { drawGrid(el, gf, v); $(`[data-f="${k}"]`, m.body)?.classList.add('ai'); n++; } continue; }   /* bảng quá trình công tác từ CV */
        const i = $(`[name="${k}"]`, m.body); if (!i || i.value) continue; i.value = v; i.dispatchEvent(new Event('change', { bubbles: true })); $(`[data-f="${k}"]`, m.body)?.classList.add('ai'); n++; }
      const at = $('.atf', m.el); if (at && !at.files.length) { const dt = new DataTransfer(); dt.items.add(f); at.files = dt.files; }
      s.textContent = n ? `Đã điền ${n} ô từ CV (tô vàng) — kiểm tra lại, bổ sung vị trí, bộ phận rồi bấm Lưu` : 'CV không có thêm thông tin cho các ô còn trống';
    } catch (er) { s.textContent = er.message; toast(er.message, true); }
    finally { lb.classList.remove('busy'); ev.target.value = ''; }
  };
  $('#sv', m.el).onclick = run(async () => {
    const d = readForm(m.body, e); $$('.fld.err', m.el).forEach(x => x.classList.remove('err'));
    if (!id) for (const f of e.fields) if (f.auto && preset[f.k] != null && d[f.k] == null) d[f.k] = preset[f.k];   // ô tự điền (pháp nhân…) không hiện trên form: giữ giá trị truyền sẵn (vd. tạo suất ăn từ lịch tuần)
    try { const r = id ? await api('PUT', `/api/e/${ent}/${id}`, d) : await api('POST', `/api/e/${ent}`, d); await upAtt(m.el, ent, r.row.id); m.close(); delete OPT[ent]; toast((r.warnings || [])[0] || 'Đã lưu', !!(r.warnings || []).length); refresh(); openDetail(ent, r.row.id); }
    catch (er) { (er.fields || []).forEach(k => $(`[data-f="${k}"]`, m.el)?.classList.add('err')); throw er; }
  });
}

// ---------- chi tiết ----------
const ACTION = { tao: 'Tạo', sua: 'Sửa', xoa: 'Xóa', trinh_duyet: 'Trình duyệt', phe_duyet: 'Phê duyệt', tu_choi: 'Từ chối', tu_dong: 'Tự động cập nhật', xem_dinh_danh: 'Xem định danh', tai_tep: 'Tải tệp lên', tai_ve: 'Tải tệp về', xuat_excel: 'Xuất Excel', in_phieu_luong: 'In phiếu lương', sua_cong: 'Sửa công', chot_ky: 'Chốt kỳ', soan_email: 'Soạn email ứng viên', gui_bang_cong: 'Gửi bảng công trưởng phòng', sua_cau_hinh: 'Sửa cấu hình', dang_nhap: 'Đăng nhập' };
async function openDetail(ent, id, { reveal } = {}) {
  const e = M.ents[ent], g = await api('GET', `/api/e/${ent}/${id}${reveal ? '?reveal=1' : ''}`), r = g.row, p = g.perm;
  $$('.ov.dt').forEach(x => x.remove());
  const sheet = e.sheet && g.table, tit = esc(r.code || r.no || r.full_name || r.name || mmy(r.month) || e.one);
  const body = `<div class="tabs"><button class="on" data-tab="i">Thông tin</button><button data-tab="h">Lịch sử (${g.history.length})</button><button data-tab="f">Tệp & ghi chú (${g.files.length + g.notes.length})</button></div>
  <div data-p="i">${e.files?.length && g.files.length ? `<div class="mb"><small class="muted">Tài liệu đính kèm — bấm để xem</small><div class="atts">${g.files.map(f => { const k = (e.files || []).find(x => x[0] === f.kind); return `<a href="/api/file/${f.id}?view=1" target="_blank" rel="noopener">${ico(/pdf/.test(f.mime || '') ? 'fa-file-pdf' : /image/.test(f.mime || '') ? 'fa-file-image' : 'fa-paperclip')} ${k && e.files.length > 1 ? `<span class="tag">${esc(k[1])}</span> ` : ''}${esc(f.name)}</a>`; }).join('')}</div></div>` : ''}${sheet ? sheetView(ent, r, g.table) : ''}<div class="fv ${sheet ? 'mt' : ''}">${e.fields.filter(f => shownF(f, r)).map(f => `<div class="${f.t === 'json' || f.t === 'long' ? 'full' : ''}"><small>${esc(f.l)}</small><div>${show(f, r)}</div></div>`).join('')}</div>
  ${ent === 'interview' && (r.lines || []).some(l => l.code) ? `<div class="mt"><small class="muted">Thư gửi ứng viên — in / lưu PDF từng người để gửi email</small><table class="t"><tbody>${r.lines.filter(l => l.code).map(l => `<tr><td><b>${esc(l.name || '')}</b> <span class="muted small">${esc(l.code)}${l.start ? ' · ' + esc(l.start) : ''}</span></td><td class="right nowrap"><a class="btn sm" target="_blank" href="/print-letter/interview/${id}?kind=moi&code=${encodeURIComponent(l.code)}">${ico('fa-print')} In thư mời</a> <button class="btn sm" data-ml="moi" data-mc="${esc(l.code)}">${ico('fa-envelope')} Email thư mời</button>${l.result ? ` <a class="btn sm" target="_blank" href="/print-letter/interview/${id}?kind=kq&code=${encodeURIComponent(l.code)}">${ico('fa-print')} In thư kết quả</a> <button class="btn sm" data-ml="kq" data-mc="${esc(l.code)}">${ico('fa-envelope')} Email kết quả</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
  ${r._handler && ['cho_duyet', 'nhap', 'tu_choi'].includes(r.status) ? `<div class="mt"><small class="muted">${r.status === 'cho_duyet' ? 'Người duyệt' : 'Người đang xử lý'}</small><div><b>${esc(r._handler)}</b></div></div>` : ''}
  ${g.approvals.length ? `<div class="mt small muted">${g.approvals.map(a => `${esc(a.title)} · ${esc(a.requested_by_l || '')} → ${{ cho_duyet: 'chờ duyệt', da_duyet: 'đã duyệt', tu_choi: 'từ chối', huy: 'hủy' }[a.status]} ${a.decided_by_l ? '· ' + esc(a.decided_by_l) : ''} ${a.comment ? '· ' + esc(a.comment) : ''}`).join('<br>')}</div>` : ''}</div>
  <div data-p="h" class="hidden"><table class="t"><tbody>${g.history.map(h => `<tr><td class="nowrap">${dmyhm(h.at)}</td><td>${esc(ACTION[h.action] || h.action.replace('tt:', ''))}</td><td>${esc(h.by || 'Hệ thống')}</td><td>${esc(h.note || '')}</td></tr>`).join('') || '<tr><td class="empty">Chưa có</td></tr>'}</tbody></table></div>
  <div data-p="f" class="hidden">${g.files.map(f => `<div><a href="/api/file/${f.id}">${ico('fa-paperclip')} ${esc(f.name)}</a> ${(e.files || []).find(k => k[0] === f.kind) ? `<span class="tag">${esc(e.files.find(k => k[0] === f.kind)[1])}</span>` : ''} <span class="small muted">${dmyhm(f.uploaded_at)} · ${esc(f.by || '')}</span></div>`).join('')}${g.notes.map(n => `<div class="small"><b>${esc(n.by)}</b> ${dmyhm(n.at)}: ${esc(n.body)}</div>`).join('')}<div class="row mt"><input id="nt" class="grow" placeholder="Ghi chú…" style="height:38px;border:1px solid var(--line);border-radius:9px;padding:0 10px;background:var(--card)"><button class="btn sm" id="ntb">Thêm</button>${p.files ? `${e.files?.length > 1 ? `<select id="upk" style="height:34px">${e.files.map(k => `<option value="${k[0]}">${esc(k[1])}</option>`).join('')}</select>` : ''}<label class="btn sm">${ico('fa-upload')} Tải tệp<input type="file" id="up" multiple hidden></label>` : ''}</div></div>`;
  const b = (i, l, cls, ic) => `<button class="btn ${cls}" id="${i}">${ic ? ico(ic) : ''} ${l}</button>`;
  const acts = (e.acts || []).filter(a => p.acts.includes(a.k));
  const extra = [
    r._masked && M.piiRoles.includes(M.me.role) ? b('rv', 'Xem định danh', '', 'fa-eye') : '',
    ent === 'contract' && ['HD01', 'HD02'].includes(r.kind) && ['hieu_luc', 'cho_quyet_dinh'].includes(r.state) && p.edit ? b('rn', 'Tạo HĐ kế tiếp', 'ok', 'fa-file-circle-plus') : '',
    ent === 'car_book' && r.status === 'dang_di' && M.ents.car_return.perm.c ? b('ret', 'Lập phiếu trả xe', 'ok', 'fa-square-parking') : '',
    ent === 'payroll' ? `<a class="btn pri" target="_blank" href="/print-payroll-pack/${id}" title="In một lần: bảng chấm công, bảng tăng ca, bảng lương, chuyển khoản">${ico('fa-folder-open')} In bộ hồ sơ lương</a><a class="btn" target="_blank" href="/print-payslip/${id}">${ico('fa-file-invoice')} Phiếu lương TL03</a><a class="btn" target="_blank" href="/print-bank/${id}">${ico('fa-building-columns')} Chuyển khoản TL04</a>` : '',
    ...(sheet ? [`<a class="btn" target="_blank" href="/print-sheet/${ent}/${id}">${ico('fa-print')} In theo mẫu</a>`, `<a class="btn" href="/api/sheet/${ent}/${id}/xlsx">${ico('fa-file-excel')} Excel theo mẫu</a>`]
      : e.noprint ? [] : ['<span class="prbar" id="pbar"></span>']),   // chọn mẫu in + In / Word + Sửa mẫu / Thêm mẫu mới (printBar)   // phiếu đề xuất: không in, không ký
    p.del ? b('dl', 'Xóa', 'danger', 'fa-trash') : '', p.edit && !(p.locked && !p.lockKeep?.length) ? b('ed', 'Sửa', '', 'fa-pen') : '', ...acts.map(a => b('a_' + a.k, a.l, 'ok', a.ico)), p.submit ? b('sb', 'Trình duyệt', 'pri', 'fa-paper-plane') : '',
    p.approve ? b('ap', 'Duyệt', 'ok', 'fa-check') + b('rj', 'Từ chối', 'danger', 'fa-xmark') : ''].join('');
  const m = modal({ title: `${esc(e.title)} · ${tit} <span class="tag">${esc(e.code || '')}</span>`, cls: sheet || e.fields.some(f => f.grid) ? 'wide' : '', body, foot: extra }); m.el.classList.add('dt');
  if ($('#pbar', m.el)) printBar($('#pbar', m.el), ent, id, r).catch(er => toast(er.message, true));
  $$('[data-tab]', m.el).forEach(t => t.onclick = () => { $$('[data-tab]', m.el).forEach(x => x.classList.toggle('on', x === t)); $$('[data-p]', m.el).forEach(x => x.classList.toggle('hidden', x.dataset.p !== t.dataset.tab)); });
  const on = (s, fn) => { const x = $(s, m.el); if (x) x.onclick = run(fn); };
  const again = async () => { refresh(); await openDetail(ent, id); };
  on('#rv', () => openDetail(ent, id, { reveal: true })); on('#ed', async () => { m.close(); await openForm(ent, id); });
  on('#dl', async () => { if (await ask('Xóa', `Xóa ${esc(e.one)} này?`, { danger: 1, ok: 'Xóa' })) { await api('DELETE', `/api/e/${ent}/${id}`); m.close(); refresh(); toast('Đã xóa'); } });
  on('#sb', async () => { await api('POST', `/api/e/${ent}/${id}/submit`, {}); toast('Đã trình duyệt'); again(); }); on('#ap', async () => { await api('POST', `/api/e/${ent}/${id}/approve`, { ok: true }); toast('Đã duyệt'); again(); });
  on('#rj', async () => { const c = await ask('Từ chối', 'Ghi rõ lý do:', { reason: 1, ok: 'Từ chối', danger: 1 }); if (c) { await api('POST', `/api/e/${ent}/${id}/approve`, { ok: false, comment: c }); again(); } });
  on('#rn', async () => { const x = await api('POST', `/api/contract/${id}/renew`, {}); toast('Đã tạo HĐ kế tiếp — kiểm tra lại số HĐ, thời hạn'); refresh(); openDetail('contract', x.row.id); });
  on('#ret', async () => { m.close(); await openForm('car_return', null, { book_id: id, got_at: r.start_at, back_at: new Date().toISOString() }); });
  for (const a of acts) on('#a_' + a.k, () => runAct(ent, id, a));
  on('#ntb', async () => { await api('POST', `/api/e/${ent}/${id}/note`, { body: $('#nt', m.el).value }); openDetail(ent, id); });
  const up = $('#up', m.el); if (up) up.onchange = run(async () => { const fd = new FormData(); [...up.files].forEach(f => fd.append('f', f)); fd.append('kind', $('#upk', m.el)?.value || e.files?.[0]?.[0] || 'tai_lieu'); const x = await api('POST', `/api/e/${ent}/${id}/files`, fd); if (x?.note) toast(x.note); openDetail(ent, id); });
  // email thư mời / kết quả: soạn sẵn → mở Gmail (tài khoản đang đăng nhập trên trình duyệt) hoặc Outlook (mailto); PDF in từ nút «In thư» rồi đính kèm
  $$('[data-ml]', m.el).forEach(b => b.onclick = run(async () => {
    const x = await api('GET', `/api/letter-mail/interview/${id}?kind=${b.dataset.ml}&code=${encodeURIComponent(b.dataset.mc)}`), enc = encodeURIComponent;
    const mm = modal({ title: `Email cho ${esc(x.name)}`, cls: 'wide', body: `${x.to ? `<p>Gửi tới: <b>${esc(x.to)}</b></p>` : `<div class="banner">${ico('fa-triangle-exclamation')} Ứng viên chưa có email — nhập email trong hồ sơ ứng viên, hoặc điền tay khi soạn.</div>`}
      <div class="fld"><label>Tiêu đề</label><input id="emS" value="${esc(x.subject)}"></div><div class="fld"><label>Nội dung (sửa được)</label><textarea id="emB" style="min-height:260px">${esc(x.text)}</textarea></div><p class="small muted">Muốn gửi kèm thư PDF: bấm «In thư» → In → Lưu dạng PDF, rồi đính kèm vào email.</p>`,
      foot: `<button class="btn" data-x>Đóng</button><button class="btn" id="emC">${ico('fa-copy')} Sao chép nội dung</button><a class="btn" id="emO" href="#">${ico('fa-envelope')} Mở Outlook / ứng dụng mail</a><a class="btn pri" id="emG" href="#" target="_blank" rel="noopener">${ico('fa-envelope-open-text')} Mở Gmail</a>` });
    const cur = () => ({ s: $('#emS', mm.el).value, t: $('#emB', mm.el).value });
    $('#emG', mm.el).onclick = () => { const c = cur(); $('#emG', mm.el).href = `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(x.to)}&su=${enc(c.s)}&body=${enc(c.t)}`; };
    $('#emO', mm.el).onclick = ev => { ev.preventDefault(); const c = cur(); location.href = `mailto:${enc(x.to)}?subject=${enc(c.s)}&body=${enc(c.t)}`; };
    $('#emC', mm.el).onclick = () => { const c = cur(); navigator.clipboard?.writeText(`${c.s}\n\n${c.t}`).then(() => toast('Đã sao chép tiêu đề + nội dung'), () => toast('Trình duyệt chặn sao chép — bôi đen nội dung để chép', true)); };
  }));
  if ($('[data-pl]', m.el)) moneyLive(m.el);   // ô tiền bảng lương: dấu chấm ngăn cách khi gõ
  $$('[data-pl]', m.el).forEach(i => i.onchange = run(async () => { const s = i.value.trim(), v = i.dataset.k === 'gl' ? s : i.dataset.k === 'kpi' ? (+s.replace('%', '').replace(',', '.') || 0) : (s.startsWith('-') ? -1 : 1) * (+s.replace(/\D/g, '') || 0); await api('PUT', `/api/payroll/${id}/line/${i.dataset.pl}`, { [i.dataset.k]: v }); await openDetail(ent, id); }));
}
