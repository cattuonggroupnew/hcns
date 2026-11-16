// Các màn hình: khung, dashboard, danh sách, báo cáo, bảng công, sơ đồ tổ chức, hộp duyệt, chất lượng dữ liệu, cấu hình.
'use strict';
const main = () => $('#main');
let refresh = () => {};
const F = { legal: '', dept: '', month: '' };
const opt = (xs, v, all = 'Tất cả') => `<option value="">${all}</option>` + xs.map(x => `<option value="${x[0]}" ${String(x[0]) === String(v) ? 'selected' : ''}>${esc(x[1])}</option>`).join('');
const legalSel = v => `<select id="fL">${opt(M.legals.map(l => [l.id, l.short]), v)}</select>`;
const deptSel = v => `<select id="fD">${opt(M.depts.map(d => [d.id, d.name]), v)}</select>`;
const go = h => { location.hash = '#/' + h; };

// ---------- đăng nhập ----------
function showLogin() {
  $('#app').innerHTML = `<div class="card login"><img src="logo.png" alt="Cát Tường"><h2 class="center mb">CTG-HCNS</h2><div class="fld mb"><label>Tài khoản (mã NV)</label><input id="u"></div><div class="fld mb"><label>Mật khẩu</label><input id="p" type="password"></div><button class="btn pri" style="width:100%;justify-content:center" id="l">Đăng nhập</button></div>`;
  $('#l').onclick = run(async () => { await api('POST', '/api/login', { username: $('#u').value, password: $('#p').value }); location.hash = '#/'; location.reload(); });   // tải lại trang (không gắn trùng luồng cập nhật / sự kiện của phiên trước), về trang đầu = Chấm công & đơn từ
}

// ---------- khung ----------
let bellAlerts = 0;
// mục có trong menu của người đang dùng (lối tắt chỉ hiện khi được giao)
const menuHas = it => M.menu.some(([, xs]) => xs.some(([, , x]) => Array.isArray(x) ? x.some(y => y[0] === it) : x === it));
const badge = () => api('GET', '/api/notices').then(n => { const d = $('#bd'); if (!d) return; d.textContent = n.unread; d.classList.toggle('hidden', !n.unread); }).catch(() => { });
function shell() {
  const me = M.me, initials = me.full_name.split(' ').filter(s => /^\p{L}/u.test(s)).slice(-2).map(s => s[0]).join('');
  const nav = M.menu.map(([g, items]) => `<h6>${g}</h6>` + items.map(([l, ic, x], i) => {
    if (Array.isArray(x) && ['e:ins_sheet', 'e:cd_sheet'].includes(x[0]?.[0])) x = x[0][0];   // BH, CĐ: một lối vào; tổng hợp năm mở bằng nút trong danh sách
    if (!Array.isArray(x)) return `<a href="#/${x.replace(':', '/')}" data-r="${x.replace(':', '/')}">${ico(ic)}${esc(l)}</a>`;
    return `<div class="fn" data-fn="${g}${i}">${ico(ic)}<span>${esc(l)}</span>${ico('fa-chevron-right', 'ch')}</div><div class="sub hidden" data-s="${g}${i}">${x.map(([it, ll, code]) => `<a href="#/${it.replace(':', '/')}" data-r="${it.replace(':', '/')}">${esc(ll)}${g === 'HÀNH CHÍNH' ? '' : `<small>${esc(code)}</small>`}</a>`).join('')}</div>`;
  }).join('')).join('');
  $('#app').innerHTML = `<header class="top"><button class="burger" id="bg" aria-label="Thu gọn menu">${ico('fa-table-cells-large')}</button><a class="brand" href="#/${M.home}"><img src="logo.png" alt=""><div><b>CÁT TƯỜNG</b><span>HỆ THỐNG QUẢN TRỊ</span></div></a>
  <div class="gs">${ico('fa-magnifying-glass')}<input id="gq" placeholder="Tìm nhân sự, hợp đồng, VPP, tài sản…"><div class="gsr hidden" id="gr"></div></div>
  <button class="ib" id="th" title="Đổi giao diện sáng/tối">${ico('fa-moon')}</button><button class="ib" id="bell" title="Cảnh báo">${ico('fa-bell')}<span class="dot hidden" id="bd"></span></button>
  <button class="me" id="me"><span class="av">${esc(initials)}</span><div><b>${esc(me.full_name)}</b><small>${esc(me.title || '')} · ${esc(M.roles.find(r => r[0] === me.role)?.[1] || '')}</small></div>${ico('fa-chevron-down')}</button></header>
  <aside class="side"><div class="sh"><span class="ct">CT</span><div><b>CTG-HCNS</b><small>ENTERPRISE</small></div></div><nav class="nav">${nav}</nav></aside><main class="main" id="main"></main>`;
  $('#bg').onclick = () => document.body.classList.toggle(innerWidth < 760 ? 'nav-open' : 'collapsed');
  $('#th').onclick = () => { const d = document.documentElement, t = d.dataset.theme === 'dark' ? 'light' : 'dark'; d.dataset.theme = t; try { localStorage.hrTheme = t; } catch { } };
  // chuông: thông báo trong app (đơn cần duyệt, đã duyệt / từ chối…) + lối vào danh sách cảnh báo nếu được giao
  const hasDB06 = JSON.stringify(M.menu).includes('"d:DB06"');
  $('#bell').onclick = run(async ev => {
    ev.stopPropagation(); if ($('.npanel')) return $('.npanel').remove();
    const n = await api('GET', '/api/notices'), p = document.createElement('div'); p.className = 'npanel';
    p.innerHTML = `<div class="nh">${ico('fa-bell')}&nbsp; Thông báo <span class="grow"></span>${n.unread ? '<button class="btn sm" id="nra">Đánh dấu đã đọc</button>' : ''}</div>${n.items.map(x => `<a class="ni ${x.read_at ? '' : 'un'}" data-id="${x.id}" href="#/${esc(x.link || '')}"><b>${esc(x.title)}</b><small>${esc(x.body || '')}</small><small>${dmyhm(x.at)}</small></a>`).join('') || '<div class="empty" style="padding:18px">Chưa có thông báo</div>'}
      ${hasDB06 ? `<a class="ni" href="#/d/DB06">${ico('fa-triangle-exclamation')} Cảnh báo & việc cần xử lý${bellAlerts ? ` <b>(${bellAlerts})</b>` : ''}</a>` : ''}`;
    document.body.append(p);
    // bấm thông báo: đánh dấu đã đọc; trỏ về đúng trang đang mở thì vẫn mở lại (trình duyệt không tự tải khi đường dẫn không đổi); thông báo tiền ăn → cuộn tới khung tiền ăn
    $$('a.ni[data-id]', p).forEach(a => a.onclick = run(async ev => {
      api('POST', '/api/notices/read', { id: +a.dataset.id }).then(badge); p.remove();
      const ml = /Tiền ăn tháng (\d{2})\/(\d{4})/.exec(a.textContent);   // thông báo tiền ăn → mở hộp QR + số tiền + «Đã thanh toán» ngay giữa màn hình
      if (ml) { ev.preventDefault(); if (location.hash !== '#/v/portal') location.hash = '#/v/portal'; return openMealBill(`${ml[2]}-${ml[1]}`); }
      const en = /^#\/e\/([a-z_]+)/.exec(a.getAttribute('href') || '');   // thông báo trỏ tới màn người nhận không có quyền xem (vd. NLĐ – quản lý đào tạo) → về trang cá nhân
      if (en && !M.ents[en[1]]?.perm?.r) { ev.preventDefault(); const tid = en[1] === 'training' && /\/(\d+)$/.exec(a.getAttribute('href'))?.[1]; location.hash = tid ? `#/v/portal/trn${tid}` : '#/v/portal'; return; }
      if (a.getAttribute('href') === location.hash || (a.getAttribute('href') === '#/' && location.hash === '#/' + M.home)) { ev.preventDefault(); return route(); }   // trỏ về đúng trang đang mở → vẫn mở lại
    }));
    if ($('#nra', p)) $('#nra', p).onclick = run(async e2 => { e2.stopPropagation(); await api('POST', '/api/notices/read', {}); p.remove(); badge(); });
  });
  document.addEventListener('click', e => { if (!e.target.closest('.npanel') && !e.target.closest('#bell')) $('.npanel')?.remove(); });
  // đang ở trang cảnh báo mà bấm lại lối vào (menu / chuông) → mở lại để hiện hộp quá hạn
  document.addEventListener('click', e => { const a = e.target.closest('a[href="#/d/DB06"]'); if (a && location.hash === '#/d/DB06') { e.preventDefault(); $('.npanel')?.remove(); route(); } });
  $$('.fn').forEach(f => f.onclick = () => { f.classList.toggle('open'); $(`[data-s="${f.dataset.fn}"]`).classList.toggle('hidden'); });
  $('#me').onclick = () => {
    if ($('.menu')) return $('.menu').remove();
    const d = document.createElement('div'); d.className = 'menu';
    // chạy thử: mọi tài khoản không phải NLĐ (từng người trong phòng HCNS, BGĐ, kế toán…) + 1 NLĐ mẫu
    const RL = Object.fromEntries(M.roles.map(r => [r[0], r[1]])), ord = Object.fromEntries(['tp_hcns', 'cv_hcns', 'cv_hc', 'admin', 'ke_toan', 'bgd', 'truong_bp', 'nld'].map((r, i) => [r, i]));
    const rs = [...M.users.filter(u => u.role !== 'nld'), ...M.users.filter(u => u.role === 'nld').slice(0, 1)].sort((a, b) => ord[a.role] - ord[b.role] || a.full_name.localeCompare(b.full_name));
    d.innerHTML = (M.noLogin ? `<div class="small muted" style="padding:6px 10px">Chạy thử: đổi người dùng</div>${rs.map(u => `<button data-as="${u.id}" ${u.id === me.id ? 'style="background:var(--bg)"' : ''}><b>${esc(u.full_name)}</b><div class="small muted">${esc(RL[u.role] || u.role)}${u.title ? ' · ' + esc(u.title) : ''}</div></button>`).join('')}<hr>` : '') + `<button id="out">${ico('fa-right-from-bracket')} Đăng xuất</button>`;
    document.body.append(d); $$('[data-as]', d).forEach(b => b.onclick = run(async () => { await api('POST', '/api/as/' + b.dataset.as, {}); location.hash = M.roles ? '#/' : ''; location.reload(); }));
    $('#out', d).onclick = run(async () => { await api('POST', '/api/logout', {}); location.reload(); });
  };
  let gt; $('#gq').oninput = e => { clearTimeout(gt); gt = setTimeout(run(async () => { const r = await api('GET', '/api/search?q=' + encodeURIComponent(e.target.value)), g = $('#gr'); g.classList.toggle('hidden', !r.length); g.innerHTML = r.map(x => `<a href="#/e/${x.ent}/${x.id}"><b>${esc(x.label)}</b><small>${esc(x.sub)}</small></a>`).join(''); }), 250); };
  document.addEventListener('click', e => { if (!e.target.closest('.gs')) $('#gr')?.classList.add('hidden'); if (!e.target.closest('.me') && !e.target.closest('.menu')) $('.menu')?.remove(); });
  if (hasDB06) api('GET', '/api/alerts').then(a => { bellAlerts = a.filter(x => !x.done && x.level !== 'can_cap_nhat').length; }).catch(() => { });
  badge(); clearInterval(shell.nt); shell.nt = setInterval(badge, 60e3);   // số thông báo chưa đọc, làm mới mỗi phút
}
function markNav() { const r = location.hash.slice(2); $$('.nav a').forEach(a => { const on = r === a.dataset.r || r.startsWith(a.dataset.r + '/'); a.classList.toggle('on', on); if (on) { const s = a.closest('.sub'); if (s) { s.classList.remove('hidden'); $(`[data-fn="${s.dataset.s}"]`).classList.add('open'); } } }); }
const demoBanner = () => M.demo && M.ents.payroll.perm.c ? `<div class="banner">${ico('fa-triangle-exclamation')} <span>Đang có dữ liệu mẫu (bảng công, tài sản, xe, tuyển dụng…) để chạy thử. Nhân sự, lương, BH trong bản demo đều là dữ liệu giả.</span><button class="btn warn sm x" id="clrDemo">Xóa dữ liệu mẫu</button></div>` : '';
function wireDemo() { const b = $('#clrDemo'); if (b) b.onclick = run(async () => { if (await ask('Xóa dữ liệu mẫu', 'Xóa toàn bộ bản ghi mẫu? Dữ liệu thật giữ nguyên.', { ok: 'Xóa', danger: 1 })) { await api('POST', '/api/demo/clear', {}); M.demo = 0; refresh(); } }); }

// ---------- dashboard ----------
function barChart(b) {
  const W = 640, H = 240, L = 10, T = 26, B = 26, n = b.values.length, hasT = !!b.target, max = Math.max(1, ...b.values, ...(b.target || [])), slot = (W - L * 2) / Math.max(n, 1), bw = Math.min(hasT ? 26 : 56, slot * (hasT ? .36 : .55));
  const y = v => T + (H - T - B) * (1 - v / max), rect = (x, v, c) => { const yy = y(v), h = H - B - yy; return `<path d="M${x},${H - B}V${yy + Math.min(4, h)}q0,-${Math.min(4, h)} ${Math.min(4, bw / 2)},-${Math.min(4, h)}H${x + bw - 4}q4,0 4,${Math.min(4, h)}V${H - B}Z" fill="${c}"/>`; };
  const vs = c => `var(--${c})`;
  return `${hasT ? `<div class="legend"><span><i style="background:var(--s1)"></i>Hiện có</span><span><i style="background:var(--s2)"></i>Định biên</span></div>` : ''}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(b.title)}">
  <line x1="0" x2="${W}" y1="${H - B}" y2="${H - B}" stroke="var(--line)"/>${b.values.map((v, i) => { const cx = L + slot * i + slot / 2, x = hasT ? cx - bw - 1 : cx - bw / 2; return `<g class="bar" data-go="${b.link || ''}"><title>${esc(b.labels[i])}: ${fnum(v)} ${esc(b.unit)}${hasT ? ` / định biên ${b.target[i]}` : ''}</title><rect x="${cx - slot / 2}" y="0" width="${slot}" height="${H}" fill="transparent"/>${rect(x, v, vs('s1'))}${hasT ? rect(cx + 1, b.target[i], vs('s2')) : ''}<text x="${cx}" y="${y(Math.max(v, b.target?.[i] || 0)) - 7}" text-anchor="middle" font-size="13" fill="var(--text)">${fnum(v)}</text><text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="${n > 7 ? 10 : 12.5}" fill="var(--muted)">${esc(String(b.labels[i]).slice(0, n > 4 ? 16 : 24))}</text></g>`; }).join('')}</svg>`;
}
const shareList = s => s.items.length ? s.items.map((x, i) => `<div class="sh-row" ${x.link ? `data-go="${x.link}" style="cursor:pointer"` : ''} title="${esc(x.l)}: ${fnum(x.v)}"><span>${esc(x.l)}</span><div class="tr"><div class="fl" style="width:${x.pct}%;background:var(--s${i % 4 + 1})"></div></div><span class="right muted">${x.pct}%</span></div>`).join('') : '<div class="empty">Chưa có dữ liệu</div>';
// tổng quan NS / HC: việc cần làm → chỉ tiêu → tình trạng kỳ (NS) / lịch hôm nay (HC) → biểu đồ → cảnh báo → lối tắt; DB06 = danh sách cảnh báo đầy đủ
const chartCard = c => `<div class="card chart"><div class="sec">${esc(c.title)}</div>${c.bar ? (c.bar.values.length ? barChart({ ...c.bar, title: c.title }) : '<div class="empty">Chưa có dữ liệu</div>') : shareList(c.share)}</div>`;
// ---------- Tổng quan Nhân sự — khung theo Bravo: kỳ, 4 thẻ đầu kỳ / tăng / giảm / cuối kỳ, 4 góc (bấm → chi tiết), biến động, theo bộ phận, sinh nhật, HĐ sắp hết hạn, bộ lọc ----------
const NSV = { mode: 'thang', view: 'tq', corner: null, depts: [], legalPick: null };
// 16 màu khác nhau: nhiều bộ phận không bị trùng màu (trùng màu → lát cuối dính vào lát đầu, trông như mất lát)
const PAL = ['#22c55e', '#ec4899', '#f59e0b', '#0ea5e9', '#8b5cf6', '#14b8a6', '#f97316', '#64748b', '#84cc16', '#e11d48', '#1d4ed8', '#a16207', '#d946ef', '#0f766e', '#facc15', '#7c2d12'], pal = i => PAL[i % PAL.length];
function donut(items, total, label) {
  const R = 70, r = 46, C2 = 90; let a0 = -Math.PI / 2;
  const arcs = items.map((x, i) => { const a1 = a0 + 2 * Math.PI * x.v / (total || 1), large = a1 - a0 > Math.PI ? 1 : 0, p = (a, rr) => `${C2 + rr * Math.cos(a)},${C2 + rr * Math.sin(a)}`;
    const d = items.length === 1 ? `M${C2 - R},${C2}a${R},${R} 0 1,0 ${2 * R},0a${R},${R} 0 1,0 ${-2 * R},0M${C2 - r},${C2}a${r},${r} 0 1,1 ${2 * r},0a${r},${r} 0 1,1 ${-2 * r},0` : `M${p(a0, R)}A${R},${R} 0 ${large},1 ${p(a1, R)}L${p(a1, r)}A${r},${r} 0 ${large},0 ${p(a0, r)}Z`; a0 = a1; return `<path d="${d}" fill="${pal(i)}" fill-rule="evenodd"><title>${esc(x.l)}: ${x.v} (${x.pct}%)</title></path>`; }).join('');
  return `<div class="dn"><svg viewBox="0 0 180 180">${arcs}<text x="90" y="88" text-anchor="middle" font-size="22" font-weight="700" fill="var(--ink)">${total}</text><text x="90" y="106" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(label)}</text></svg>
    <div class="dnl">${items.map((x, i) => `<span><i style="background:${pal(i)}"></i>${esc(x.l)} <b>${x.v}</b></span>`).join('')}</div></div>`;
}
// vòng tròn lớn kiểu Bravo: chú thích một hàng trên đầu, số người ghi quanh vòng
function donutBig(items, total, label, off = 0, key = '') {   // off: lệch dải màu khi đặt nhiều vòng cạnh nhau để không trùng màu; key: bấm lát / chú thích → data-dk, data-di
  const pal = i => PAL[(i + off) % PAL.length], dk = i => key ? ` data-dk="${key}" data-di="${i}" style="cursor:pointer"` : '';
  const R = 118, r = 76, C = 160; let a0 = -Math.PI / 2;
  const p = (a, rr) => `${(C + rr * Math.cos(a)).toFixed(1)},${(C + rr * Math.sin(a)).toFixed(1)}`, xy = (a, rr) => [C + rr * Math.cos(a), C + rr * Math.sin(a)];
  const labs = [];
  // vẽ xen kẽ lớn – nhỏ (1 lớn nhất, 1 nhỏ nhất, …) để lát nhỏ rải đều hai bên thay vì dồn một góc; màu giữ theo thứ tự chú thích
  const ord = []; for (let lo = 0, hi = items.length - 1; lo <= hi;) { ord.push(lo++); if (lo <= hi) ord.push(hi--); }
  const arcs = ord.map(i => [items[i], i]).map(([x, i]) => {
    const a1 = a0 + 2 * Math.PI * x.v / (total || 1), large = a1 - a0 > Math.PI ? 1 : 0, mid = (a0 + a1) / 2;
    const d = items.length === 1 ? `M${C - R},${C}a${R},${R} 0 1,0 ${2 * R},0a${R},${R} 0 1,0 ${-2 * R},0M${C - r},${C}a${r},${r} 0 1,1 ${2 * r},0a${r},${r} 0 1,1 ${-2 * r},0` : `M${p(a0, R)}A${R},${R} 0 ${large},1 ${p(a1, R)}L${p(a1, r)}A${r},${r} 0 ${large},0 ${p(a0, r)}Z`;
    if (x.pct >= 2) { const [ex, ey] = xy(mid, R + 10); labs.push({ v: x.v, mid, right: Math.cos(mid) >= 0, ex, ey, y: ey }); }
    a0 = a1; return `<path d="${d}" fill="${pal(i)}" fill-rule="evenodd"${dk(i)}><title>${esc(x.l)}: ${x.v} người (${x.pct}%)</title></path>`;
  }).join('');
  // số quanh vòng: hai cột thẳng hàng hai bên vòng (trái / phải), giãn dọc ≥ 15px để lát nhỏ không chồng số; đường kẻ: mép lát → khuỷu → cột số
  const GAP = 15, top = C - R - 8, bot = C + R + 8;
  for (const side of [true, false]) {
    const xs = labs.filter(l => l.right === side).sort((a, b) => a.y - b.y);
    xs.forEach((l, k) => { l.y = Math.max(l.y, top, k ? xs[k - 1].y + GAP : top); });
    for (let k = xs.length - 1; k >= 0; k--) xs[k].y = Math.min(xs[k].y, k < xs.length - 1 ? xs[k + 1].y - GAP : bot);
  }
  const lbl = labs.map(l => { const [sx, sy] = xy(l.mid, R + 2), cx = l.right ? C + R + 20 : C - R - 20;
    return `<polyline points="${sx.toFixed(1)},${sy.toFixed(1)} ${l.ex.toFixed(1)},${l.ey.toFixed(1)} ${cx},${l.y.toFixed(1)}" fill="none" stroke="var(--muted)"/><text x="${cx + (l.right ? 4 : -4)}" y="${l.y.toFixed(1)}" dominant-baseline="central" text-anchor="${l.right ? 'start' : 'end'}" font-size="12" fill="var(--text)">${l.v}</text>`; }).join('');
  return `<div class="dnb"><svg viewBox="-24 -12 368 344">${arcs}${lbl}<text x="160" y="156" text-anchor="middle" font-size="26" fill="var(--ink)">${total}</text><text x="160" y="182" text-anchor="middle" font-size="16" fill="var(--ink)">${esc(label)}</text></svg>
    <div class="dnt">${items.map((x, i) => `<span title="${esc(x.l)}: ${x.v} người (${x.pct}%)${key ? ' — bấm để xem chi tiết' : ''}"${dk(i)}><i style="background:${pal(i)}"></i>${esc(x.l)} <b>${x.v}</b></span>`).join('')}</div></div>`;
}
// quân số cuối mỗi tháng: đường + vùng tô, ghi số tại từng điểm
function lineChart(labels, vals, W = 640, H = 170) {
  const T = 22, Bm = 28, n = labels.length, lo = Math.max(0, Math.min(...vals) - 1), hi = Math.max(lo + 1, ...vals), slot = (W - 20) / Math.max(n, 1), x = i => 10 + slot * i + slot / 2, y = v => T + (H - T - Bm) * (1 - (v - lo) / (hi - lo));
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}"><line x1="10" x2="${W - 10}" y1="${H - Bm}" y2="${H - Bm}" stroke="var(--line)"/>${n ? `<polygon points="${x(0)},${H - Bm} ${pts} ${x(n - 1)},${H - Bm}" fill="#0ea5e9" opacity=".12"/><polyline points="${pts}" fill="none" stroke="#0ea5e9" stroke-width="2.5"/>` : ''}${vals.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="#0ea5e9"><title>${esc(labels[i])}: ${v} người</title></circle><text x="${x(i)}" y="${y(v) - 9}" text-anchor="middle" font-size="11" fill="var(--text)">${v}</text><text x="${x(i)}" y="${H - 9}" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(labels[i])}</text>`).join('')}</svg>`;
}
function bars2(f, W = 520, H = 210) {
  const T = 22, Bm = 28, n = f.labels.length, max = Math.max(1, ...f.inc, ...f.dec), slot = (W - 20) / Math.max(n, 1), bw = Math.min(26, slot * .32), y = v => T + (H - T - Bm) * (1 - v / max);
  const bar = (x, v, c, t, k, i) => `<rect x="${x}" y="${y(v)}" width="${bw}" height="${H - Bm - y(v)}" rx="3" fill="${c}"${v && f[k + 'P'] ? ` data-bk="${k}" data-bi="${i}" style="cursor:pointer"` : ''}><title>${t}: ${v}${v && f[k + 'P'] ? ' — bấm để xem danh sách' : ''}</title></rect>${v ? `<text x="${x + bw / 2}" y="${y(v) - 5}" text-anchor="middle" font-size="11" fill="var(--text)">${v}</text>` : ''}`;
  return `<div class="legend"><span><i style="background:#22c55e"></i>Tuyển mới</span><span><i style="background:#ec4899"></i>Nghỉ việc</span></div><svg viewBox="0 0 ${W} ${H}"><line x1="10" x2="${W - 10}" y1="${H - Bm}" y2="${H - Bm}" stroke="var(--line)"/>${f.labels.map((l, i) => { const cx = 10 + slot * i + slot / 2; return `${bar(cx - bw - 1, f.inc[i], '#22c55e', 'Tuyển mới', 'inc', i)}${bar(cx + 1, f.dec[i], '#ec4899', 'Nghỉ việc', 'dec', i)}<text x="${cx}" y="${H - 9}" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(l)}</text>`; }).join('')}</svg>`;
}
const miniTable = (cols, rows, empty = 'Không có') => `<div class="tw" style="max-height:330px"><table class="t"><thead><tr>${cols.map(c => `<th class="${['m', 'n'].includes(c[2]) ? 'n' : ''}">${esc(c[1])}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr class="${r._e || r._l ? 'c' : ''}" ${r._e ? `data-oe="${r._e[0]}" data-oi="${r._e[1]}"` : r._l ? `data-go="${r._l}"` : ''}>${cols.map(c => { const v = r[c[0]]; return `<td class="${['m', 'n'].includes(c[2]) ? 'n' : ''}">${v == null || v === '' ? '' : c[2] === 'm' ? fm(v) : c[2] === 'd' ? dmy(v) : c[2] === 'n' ? fnum(v) : c[2] === 'w' ? pill(v, ws(v)) : esc(v)}</td>`; }).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="empty" style="padding:14px">${empty}</td></tr>`}</tbody></table></div>`;
async function nsDashboard() {
  const y = (F.to || M.today).slice(0, 4);
  F.from ||= curM() + '-01'; F.to ||= new Date(Date.UTC(+curM().slice(0, 4), +curM().slice(5, 7), 0)).toISOString().slice(0, 10);
  const q2 = new URLSearchParams({ legal: F.legal, from: F.from, to: F.to, month: F.to.slice(0, 7), depts: NSV.depts.join(',') });
  const d = await api('GET', `/api/dash/NS?${q2}`), cur = +F.to.slice(5, 7), mo = F.from.slice(0, 7) === F.to.slice(0, 7) ? cur : null;
  const setRange = (a, b) => { F.from = a; F.to = b; refresh(); }, ld = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
  const periodBar = `<div class="pbar"><div class="seg">${[['thang', 'Tháng'], ['quy', 'Quý'], ['nam', 'Năm']].map(([k, l]) => `<button data-mode="${k}" class="${NSV.mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="seg2">${NSV.mode === 'thang' ? Array.from({ length: 12 }, (_, i) => `<button data-mo="${i + 1}" class="${mo === i + 1 ? 'on' : ''}">${i + 1}</button>`).join('') : NSV.mode === 'quy' ? [1, 2, 3, 4].map(k => `<button data-q="${k}" class="${F.from === `${y}-${String(k * 3 - 2).padStart(2, '0')}-01` && F.to === ld(+y, k * 3) ? 'on' : ''}">Quý ${k}</button>`).join('') : `<button data-y="${y}" class="on">Năm ${y}</button>`}</div>
    <span class="grow"></span><a class="btn sm" href="#/v/inbox">${ico('fa-inbox')} Chứng từ chờ duyệt <b>${d.pending}</b></a><span class="small muted">Làm mới lúc ${new Date().toTimeString().slice(0, 8)}</span></div>`;
  // điều kiện lọc: thanh ngang trên đầu (biểu đồ dùng hết bề ngang); bộ phận chọn trong ô xổ xuống
  const filt = `<div class="card nsf h"><div class="sec">${ico('fa-filter')} Điều kiện lọc</div><div class="fld"><label>Từ ngày</label><input type="date" id="nfF" value="${F.from}"></div><div class="fld"><label>Đến ngày</label><input type="date" id="nfT" value="${F.to}"></div>
    <div class="fld"><label>Pháp nhân</label>${legalSel(F.legal)}</div><div class="fld nfd"><label>Bộ phận</label><details id="nfW" ${NSV.ddOpen ? 'open' : ''}><summary>${NSV.depts.length ? `Đã chọn ${NSV.depts.length} bộ phận` : 'Tất cả bộ phận'}</summary><div class="ddp"><input id="nfQ" placeholder="Gõ để tìm bộ phận…"><div class="dl" id="nfD">${M.depts.map(x => `<label data-n="${esc(x.name.toLowerCase())}"><input type="checkbox" value="${x.id}" ${NSV.depts.includes(x.id) ? 'checked' : ''}> ${esc(x.name)}</label>`).join('')}</div></div></details></div>
    ${NSV.depts.length ? `<button class="btn sm" id="nfX">${ico('fa-xmark')} Bỏ chọn bộ phận</button>` : ''}</div>`;
  const cards = `<div class="grid4 ncards">${d.cards.map((c, i) => `<div class="card nc ${['g', 'b', 'r', 'n'][i]}"><span>${esc(c[0])}</span><b>${ico(c[2])} ${fnum(c[1])}</b></div>`).join('')}</div>`;
  const cb = d.corners.find(c => c.k === 'cb'), nsAl = cb ? `<div class="card mb alx"><div class="sec">${ico('fa-bell')} Cảnh báo cần xử lý <a class="btn sm" style="margin-left:auto" href="#/d/DB06">Xem tất cả</a></div><div class="alchips">${cb.items.map(x => `<button class="alchip ${x[1] ? 'on' : 'zero'}" data-cor="cb"><b>${fnum(x[1])}</b><span>${esc(x[0])}</span></button>`).join('')}<span class="small muted">${NSV.corner === 'cb' ? 'Đang xem chi tiết ▾' : 'Bấm để xem danh sách'}</span></div></div>` : '';
  const corners = `<div class="grid3 corners">${d.corners.filter(c => c.k !== 'cb').map(c => `<div class="card cor ${c.c} ${NSV.corner === c.k ? 'on' : ''}" data-cor="${c.k}"><div class="ch">${ico(c.icon)} ${esc(c.title)}</div>${c.items.map(x => `<div class="ci"><span>${esc(x[0])}</span><b>${typeof x[1] === 'number' ? fnum(x[1]) : esc(x[1])}</b></div>`).join('')}<div class="cm">${NSV.corner === c.k ? 'Đang xem chi tiết ▾' : 'Bấm để xem chi tiết'}</div></div>`).join('')}</div>`;
  const cd = d.corners.find(c => c.k === NSV.corner), det = cd ? `<div class="card mb" id="cdet"><div class="sec">${ico(cd.icon)} ${esc(cd.title)} — chi tiết ${cd.detail.link ? `<a class="btn sm" style="margin-left:auto" href="#/${cd.detail.link}">Mở đầy đủ</a>` : ''}</div>
    ${cd.detail.groups ? `<div class="cols even">${cd.detail.groups.map(g => `<div><div class="small" style="font-weight:700;margin:6px 0">${esc(g.title)} (${g.rows.length})</div>${miniTable(g.cols, g.rows)}</div>`).join('')}</div>` : miniTable(cd.detail.cols, cd.detail.rows, 'Chưa có dữ liệu')}
    ${cd.detail.extra ? `<div class="small mt" style="font-weight:700">${esc(cd.detail.extra.title)} <a href="#/${cd.detail.extra.link}">— báo cáo</a></div>${miniTable(cd.detail.extra.cols, cd.detail.extra.rows, 'Chưa có kế hoạch tuyển dụng')}` : ''}</div>` : '';
  // bố cục theo Bravo «Tổng quan nhân sự» (bỏ giới tính, độ tuổi): thẻ + biến động cạnh bộ lọc; dưới: theo bộ phận | sinh nhật + HĐ sắp hết hạn
  const xb = `<button class="xb" data-big title="Phóng to">${ico('fa-up-right-and-down-left-from-center')}</button>`;
  // biểu đồ lên đầu (cạnh bộ lọc): biến động | theo bộ phận; dưới: 4 thẻ, 4 góc, sinh nhật | HĐ sắp hết hạn
  const tq = `<div class="nsc"><div class="nsl"><div class="card chart bx"><div class="sec">Biến động nhân sự${xb}</div>${bars2(d.flow, 640, 170)}</div>
    <div class="card chart bx"><div class="sec">Quân số cuối tháng${xb}</div>${lineChart(d.flow.labels, d.flow.total || d.flow.inc.reduceRight((a, v, i) => (i && a.unshift(a[0] - v + d.flow.dec[i]), a), [d.cards[3][1]]))}</div></div>
    <div class="card bx"><div class="sec">Cơ cấu nhân sự${xb}</div><div class="dn2">${[['Khối Home theo bộ phận', d.byHome, 0, 'home'], ['Theo pháp nhân', d.byLegal, d.byHome.length, 'legal']].map(([t, g, off, k]) => { const n = g.reduce((s, x) => s + x.v, 0);
      return `<div><div class="dn2t">${t} · ${fnum(n)} người</div>${g.length ? donutBig(g, n, 'Nhân viên', off, k) : '<div class="empty">Chưa có dữ liệu</div>'}</div>`; }).join('')}</div>
      ${NSV.legalPick && d.legalDept[NSV.legalPick] ? `<div class="dnl"><div class="row"><b>${esc(NSV.legalPick)} — số người từng phòng</b><span class="grow"></span><button class="btn sm" id="dnlX">Đóng</button></div><div class="tw"><table class="t"><thead><tr><th>Bộ phận</th><th class="n">Số người</th></tr></thead><tbody>${d.legalDept[NSV.legalPick].map(([dp, n]) => `<tr class="c" data-dp="${esc(dp)}"><td>${esc(dp)}</td><td class="n">${fnum(n)}</td></tr>`).join('')}</tbody></table></div></div>`
        : '<div class="small muted mt" style="text-align:center">Bấm vào một phòng hoặc một pháp nhân để xem chi tiết</div>'}</div></div>`;
  const tq2 = `<div class="mt">${cards}${corners}${NSV.corner !== 'cb' ? det : ''}</div>`;   // sinh nhật, HĐ sắp hết hạn: xem ở góc «Cảnh báo»
  // «Quy trình nhân sự» tạm bỏ: chưa có quy trình nghiệp vụ (bàn giao công việc, tài sản, tài khoản…) — thêm lại khi có dữ liệu
  const bc = `<div class="card"><div class="sec">${ico('fa-list')} Danh sách báo cáo nhân sự</div><div class="quick">${d.reports.map(([c, l]) => `<a href="#/r/${encodeURIComponent(c)}">${ico('fa-file-lines')}<span>${esc(l)} <small class="muted">${esc(c)}</small></span></a>`).join('')}</div></div>`;
  main().innerHTML = `<div class="ph"><h1>${ico('fa-users')} ${esc(d.title)}</h1><span class="scope">${ico('fa-user-shield')} ${esc(d.sub)}</span></div>${demoBanner()}${periodBar}
    ${NSV.view === 'tq' ? nsAl + (NSV.corner === 'cb' ? det : '') : ''}${NSV.view === 'tq' ? filt : ''}<div class="nsw"><div>${NSV.view === 'bc' ? bc : tq}</div></div>${NSV.view === 'tq' ? tq2 : ''}
    <div class="btabs">${[['tq', 'TỔNG QUAN'], ['bc', 'DANH SÁCH BÁO CÁO']].map(([k, l]) => `<button data-v="${k}" class="${NSV.view === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  wireDemo();
  $$('[data-mode]', main()).forEach(b => b.onclick = () => { NSV.mode = b.dataset.mode; if (NSV.mode === 'nam') return setRange(`${y}-01-01`, `${y}-12-31`); if (NSV.mode === 'quy') { const k = Math.ceil(cur / 3); return setRange(`${y}-${String(k * 3 - 2).padStart(2, '0')}-01`, ld(+y, k * 3)); } setRange(`${y}-${String(cur).padStart(2, '0')}-01`, ld(+y, cur)); });
  $$('[data-mo]', main()).forEach(b => b.onclick = () => { const k = +b.dataset.mo; setRange(`${y}-${String(k).padStart(2, '0')}-01`, ld(+y, k)); });
  $$('[data-q]', main()).forEach(b => b.onclick = () => { const k = +b.dataset.q; setRange(`${y}-${String(k * 3 - 2).padStart(2, '0')}-01`, ld(+y, k * 3)); });
  $$('[data-cor]', main()).forEach(c => c.onclick = () => { NSV.corner = NSV.corner === c.dataset.cor ? null : c.dataset.cor; refresh().then(() => $('#cdet')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); });
  $$('[data-v]', main()).forEach(b => b.onclick = () => { NSV.view = b.dataset.v; refresh(); });
  // bấm phòng (Khối Home) → danh sách nhân sự đủ cột; bấm pháp nhân → bảng số người từng phòng của pháp nhân đó
  const peopleOf = (title, xs) => { const m = modal({ title: `${esc(title)} · ${xs.length} người`, cls: 'wide', body: miniTable([['code', 'Mã NV'], ['name', 'Họ tên'], ['title', 'Chức danh'], ['dept', 'Bộ phận'], ['legal', 'Pháp nhân'], ['join', 'Ngày vào làm', 'd'], ['st', 'Trạng thái']], xs.map(x => ({ ...x, _e: ['employee', x.id] }))) });
    $$('[data-oe]', m.el).forEach(r => r.onclick = run(() => { m.close(); return openDetail(r.dataset.oe, +r.dataset.oi); })); };
  $$('[data-bk]', main()).forEach(x => x.onclick = () => { const k = x.dataset.bk, i = +x.dataset.bi, xs = d.flow[k + 'P'][i] || [], mo = d.flow.months?.[i] || '';
    const m = modal({ title: `${k === 'inc' ? 'Tuyển mới' : 'Nghỉ việc'} tháng ${mo.slice(5)}/${mo.slice(0, 4)} · ${xs.length} người`, cls: 'wide', body: miniTable([['code', 'Mã NV'], ['name', 'Họ tên'], ['title', 'Chức danh'], ['dept', 'Bộ phận'], ['legal', 'Pháp nhân'], ['day', k === 'inc' ? 'Ngày vào làm' : 'Ngày nghỉ việc', 'd']], xs.map(p => ({ ...p, _e: ['employee', p.id] }))) });
    $$('[data-oe]', m.el).forEach(r => r.onclick = run(() => { m.close(); return openDetail(r.dataset.oe, +r.dataset.oi); })); });
  $$('[data-dk]', main()).forEach(x => x.onclick = () => { const i = +x.dataset.di;
    if (x.dataset.dk === 'home') { const dp = d.byHome[i].l; return peopleOf(dp, d.people.filter(p => p.home && p.dept === dp)); }
    NSV.legalPick = NSV.legalPick === d.byLegal[i].l ? null : d.byLegal[i].l; refresh(); });
  $$('[data-dp]', main()).forEach(r => r.onclick = () => peopleOf(`${NSV.legalPick} · ${r.dataset.dp}`, d.people.filter(p => p.legal === NSV.legalPick && p.dept === r.dataset.dp)));
  if ($('#dnlX')) $('#dnlX').onclick = () => { NSV.legalPick = null; refresh(); };
  $$('[data-big]', main()).forEach(b => b.onclick = ev => { ev.stopPropagation(); const c = b.closest('.bx'); c.classList.toggle('big'); document.body.classList.toggle('noscroll', c.classList.contains('big')); });
  $$('[data-oe]', main()).forEach(r => r.onclick = run(() => openDetail(r.dataset.oe, +r.dataset.oi)));
  $$('[data-go]', main()).forEach(x => { if (x.dataset.go) x.onclick = () => go(x.dataset.go); });
  if ($('#nfF')) {
    $('#nfF').onchange = () => setRange($('#nfF').value || F.from, F.to); $('#nfT').onchange = () => setRange(F.from, $('#nfT').value || F.to); $('#fL').onchange = () => { F.legal = $('#fL').value; refresh(); };
    $('#nfQ').oninput = ev => { const s = ev.target.value.toLowerCase(); $$('#nfD label', main()).forEach(l => l.classList.toggle('hidden', !!s && !l.dataset.n.includes(s))); };
    $$('#nfD input', main()).forEach(c => c.onchange = () => { NSV.depts = $$('#nfD input:checked', main()).map(i => +i.value); NSV.ddOpen = true; refresh(); });
    $('#nfW').ontoggle = () => { NSV.ddOpen = $('#nfW').open; };
    if ($('#nfX')) $('#nfX').onclick = () => { NSV.depts = []; refresh(); };
  }
}
// cảnh báo gọn đầu trang: đếm theo mức + 5 mục gấp nhất, «Xem thêm» bung hết
const alertBox = (list, allLink, key) => {
  const by = l => list.filter(a => a.level === l).length, open = DASH.alOpen[key], xs = open ? list : list.slice(0, 5);
  return `<div class="card mb alx"><div class="sec">${ico('fa-bell')} Cảnh báo cần xử lý <span class="alc">${['qua_han', 'sap_den_han', 'can_cap_nhat'].filter(by).map(l => pill(`${LV[l][0]} ${by(l)}`, LV[l][1])).join('')}</span><a class="btn sm" style="margin-left:auto" href="#/${allLink}">Xem tất cả</a></div>
    ${list.length ? `<div class="alist">${xs.map(a => `<a href="#/${a.link}">${pill(...LV[a.level])}<span>${esc(a.title)} <span class="d">${esc(a.detail || '')}</span></span><span class="d nowrap">${dmy(a.due)}</span></a>`).join('')}</div>${list.length > 5 ? `<button class="btn sm mt" data-almore="${key}">${open ? 'Thu gọn' : `Xem thêm ${list.length - 5} cảnh báo`}</button>` : ''}` : '<div class="empty" style="padding:10px">Không có cảnh báo — mọi việc đang đúng hạn</div>'}</div>`;
};
const DASH = { alOpen: {}, hc: null };
// Tổng quan Hành chính: cảnh báo → 6 ô tóm tắt (bấm → chi tiết bên dưới) → lối tắt
function hcDashboard(d) {
  const K = l => d.kpis.find(k => k[3] === l) || [], al = re => d.alerts.filter(a => re.test(a.title)), todoN = d.todo.reduce((s, t) => s + (+t[2] || 0), 0);
  const cost = d.charts?.[0]?.bar, costNow = cost ? cost.values[cost.values.length - 1] : 0;
  const alList = xs => xs.length ? `<div class="alist">${xs.map(a => `<a href="#/${a.link}">${pill(...LV[a.level])}<span>${esc(a.title)} <span class="d">${esc(a.detail || '')}</span></span><span class="d nowrap">${dmy(a.due)}</span></a>`).join('')}</div>` : '<div class="empty" style="padding:10px">Không có cảnh báo</div>';
  const T = [
    { k: 'todo', ic: 'fa-list-check', l: 'Việc chờ xử lý', v: todoN, s: 'phiếu chờ duyệt, đang làm', c: todoN ? 'a' : 'g', det: () => `<div class="grid4">${d.todo.map(t => `<div class="todo ${t[4]} ${t[2] ? '' : 'zero'}" data-go="${t[3]}"><div class="t"><span class="ic">${ico(t[0])}</span><div><b>${fnum(t[2])}</b><span>${esc(t[1])}</span></div></div></div>`).join('')}</div>` },
    { k: 'vpp', ic: 'fa-pen-ruler', l: 'Văn phòng phẩm', v: K('r/VPP06')[1] ?? 0, s: 'mặt hàng dưới định mức', c: K('r/VPP06')[1] ? 'a' : 'g', link: 'r/VPP06', det: () => alList(al(/VPP/)) },
    { k: 'ts', ic: 'fa-laptop', l: 'Tài sản', v: K('r/TS02')[1] ?? 0, s: `đang sử dụng ${K('r/TS02')[2] || ''}`, c: al(/Tài sản/).length ? 'r' : 'g', link: 'r/TS02', det: () => alList(al(/Tài sản/)) },
    { k: 'xe', ic: 'fa-car', l: 'Xe công vụ', v: K('r/XC03')[1] ?? 0, s: 'hạn bảo dưỡng, đăng kiểm, bảo hiểm', c: al(/ xe |xe /i).some(a => a.level === 'qua_han') ? 'r' : K('r/XC03')[1] ? 'a' : 'g', link: 'r/XC03', det: () => alList(al(/ xe |xe /i)) },
    { k: 'ph', ic: 'fa-door-open', l: 'Phòng họp, xe hôm nay', v: d.today?.rows.length || 0, s: `${fnum(K('r/PH02')[1] ?? 0)} lượt họp trong tháng`, c: 'b', link: 'r/PH02', det: () => d.today?.rows.length ? `<div class="cal">${d.today.rows.map(r => `<a href="#/${r.link}"><span class="tm">${dmyhm(r.at).slice(11)}–${dmyhm(r.end).slice(11)}</span><span class="k">${esc(r.kind)}</span><span><b>${esc(r.what || '')}</b> <span class="muted">· ${esc(r.where || '')} · ${esc(r.who || '')}</span></span>${pill(r.st, r.c)}</a>`).join('')}</div>` : '<div class="empty" style="padding:10px">Hôm nay không có lịch phòng họp, xe</div>' },
    { k: 'cp', ic: 'fa-coins', l: 'Chi phí hành chính', v: `${fnum(costNow)} tr`, s: `tháng ${F.month.slice(5)}/${F.month.slice(0, 4)}`, c: 'n', det: () => d.charts ? `<div class="cols">${d.charts.slice(0, 2).map(chartCard).join('')}</div>${d.charts[2] ? chartCard(d.charts[2]) : ''}` : '' },
  ];
  const op = T.find(t => t.k === DASH.hc);
  // các ô mục lên đầu, cảnh báo xuống dưới
  return `<div class="tiles">${T.map(t => `<div class="tile ${t.c} ${DASH.hc === t.k ? 'on' : ''}" data-tile="${t.k}"><div class="th">${ico(t.ic)} ${esc(t.l)}</div><b>${typeof t.v === 'number' ? fnum(t.v) : esc(t.v)}</b><span>${esc(t.s)}</span><i class="fa-solid fa-chevron-${DASH.hc === t.k ? 'up' : 'down'} tg"></i></div>`).join('')}</div>
    ${op ? `<div class="card mb tdet"><div class="sec">${ico(op.ic)} ${esc(op.l)} — chi tiết${op.link ? `<a class="btn sm" style="margin-left:auto" href="#/${op.link}">Mở báo cáo</a>` : ''}</div>${op.det()}</div>` : '<p class="small muted mb">Bấm vào từng ô để xem chi tiết.</p>'}
    ${alertBox(d.alerts, d.alertsAll, 'hc')}
    ${d.quick?.length ? `<div class="qrow">${d.quick.map(x => `<a href="#/${x[2]}">${ico(x[1])}${esc(x[0])}</a>`).join('')}</div>` : ''}`;
}
async function dashboard(id) {
  if (id === 'NS') return nsDashboard();
  F.month ||= curM();
  const q2 = new URLSearchParams({ legal: F.legal, dept: F.dept, month: F.month });
  const d = await api('GET', `/api/dash/${id}?${q2}`), [sc, ...rest] = String(d.sub).split(' · ');
  const matrix = d.matrix ? `<div class="card mb"><div class="sec">${ico('fa-table-list')} ${esc(d.matrix.title)}</div><div class="tw" style="max-height:none"><table class="t mx"><thead><tr><th>Pháp nhân</th>${d.matrix.cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${d.matrix.rows.map(r => `<tr><td class="lg">${esc(r.legal)}</td>${r.cells.map(c => `<td><div class="cl" data-go="${c.link}">${pill(c.l, c.c)}${c.v != null ? `<small>${fm(c.v)} đ</small>` : ''}</div></td>`).join('')}</tr>`).join('') || `<tr><td colspan="5" class="empty">Chưa có pháp nhân</td></tr>`}</tbody></table></div></div>` : '';
  const today = d.today ? `<div class="card mb"><div class="sec">${ico('fa-calendar-day')} ${esc(d.today.title)}</div>${d.today.rows.length ? `<div class="cal">${d.today.rows.map(r => `<a href="#/${r.link}"><span class="tm">${dmyhm(r.at).slice(11)}–${dmyhm(r.end).slice(11)}</span><span class="k">${esc(r.kind)}</span><span><b>${esc(r.what || '')}</b> <span class="muted">· ${esc(r.where || '')} · ${esc(r.who || '')}</span></span>${pill(r.st, r.c)}</a>`).join('')}</div>` : '<div class="empty" style="padding:14px">Hôm nay không có lịch phòng họp, xe</div>'}</div>` : '';
  const al = d.alerts ? `<div class="card"><div class="sec">${ico('fa-bell')} Cảnh báo cần xử lý <a class="btn sm" style="margin-left:auto" href="#/${d.alertsAll}">Xem tất cả</a></div>${d.alerts.length ? `<div class="alist">${d.alerts.map(a => `<a href="#/${a.link}">${pill(...LV[a.level])}<span>${esc(a.title)} <span class="d">${esc(a.detail || '')}</span></span><span class="d nowrap">${dmy(a.due)}</span></a>`).join('')}</div>` : '<div class="empty" style="padding:14px">Không có cảnh báo</div>'}</div>` : '';
  main().innerHTML = `<div class="ph"><h1>${ico(id === 'HC' ? 'fa-building' : id === 'NS' ? 'fa-users' : 'fa-bell')} ${esc(d.title)}</h1>${d.side ? `<span class="scope">${ico('fa-user-shield')} ${esc(sc)}</span><p>${esc(rest.join(' · '))}</p>` : `<p>${esc(d.sub)}</p>`}</div>
  <div class="card filters${id === 'DB06' ? ' hidden' : ''}"><div><label>Pháp nhân</label>${legalSel(F.legal)}</div>${id === 'NS' ? `<div><label>Phòng ban</label>${deptSel(F.dept)}</div>` : ''}<div><label>Kỳ</label><input type="month" id="fM" value="${F.month}"></div><button class="btn pri" id="rf">${ico('fa-rotate')} Làm mới</button></div>
  ${id === 'HC' ? '' : demoBanner()}
  ${id === 'HC' ? hcDashboard(d) + demoBanner() : `${d.todo?.length ? `<div class="sec">${ico('fa-list-check')} Việc cần làm</div><div class="grid4">${d.todo.map(t => `<div class="todo ${t[4]} ${t[2] ? '' : 'zero'}" data-go="${t[3]}"><div class="t"><span class="ic">${ico(t[0])}</span><div><b>${fnum(t[2])}</b><span>${esc(t[1])}</span></div></div></div>`).join('')}</div>` : ''}
  ${d.kpis?.length ? `<div class="grid4">${d.kpis.map((k, i) => `<div class="kpi ${k[4]}" ${k[3] ? `data-go="${k[3]}"` : d.list && KQ[i] ? `data-kq="${i}" style="cursor:pointer"` : ''}><div class="ic">${ico(k[5])}</div><b>${typeof k[1] === 'number' ? fnum(k[1]) : esc(k[1])}</b><span>${esc(k[0])}${k[2] ? ` · ${esc(k[2])}` : ''}</span></div>`).join('')}</div>` : ''}
  ${matrix}${today}
  ${d.charts ? `<div class="cols">${d.charts.slice(0, 2).map(chartCard).join('')}</div>${d.charts[2] ? `<div class="cols">${chartCard(d.charts[2])}${al}</div>` : al ? `<div class="mb">${al}</div>` : ''}` : ''}
  ${d.quick?.length ? `<div class="sec mt">${ico('fa-bolt')} Lối tắt</div><div class="quick">${d.quick.map(x => `<a href="#/${x[2]}">${ico(x[1])}${esc(x[0])}</a>`).join('')}</div>` : ''}
  ${d.list ? alertTable(d.list) : ''}`}`;
  $$('[data-tile]', main()).forEach(t => t.onclick = () => { DASH.hc = DASH.hc === t.dataset.tile ? null : t.dataset.tile; refresh().then(() => $('.tdet')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })); });
  $$('[data-almore]', main()).forEach(b => b.onclick = () => { DASH.alOpen[b.dataset.almore] = !DASH.alOpen[b.dataset.almore]; refresh(); });
  const set = () => { F.legal = $('#fL').value; if ($('#fD')) F.dept = $('#fD').value; F.month = $('#fM').value; refresh(); };
  ['#fL', '#fD', '#fM'].forEach(s => { if ($(s)) $(s).onchange = set; }); $('#rf').onclick = () => refresh(); wireDemo();
  $$('[data-go]', main()).forEach(x => { if (x.dataset.go) x.onclick = () => go(x.dataset.go); });
  $$('[data-al]', main()).forEach(b => b.onclick = run(async ev => { ev.stopPropagation(); await api('POST', '/api/alerts/' + encodeURIComponent(b.dataset.al), b.dataset.undo ? { undo: 1 } : {}); refresh(); }));
  // ô số trên trang cảnh báo: bấm → hộp giữa màn hình liệt kê các mục; không có mục nào thì không hiện
  const pop = i => alertModal(`${ico(d.kpis[i][5])} ${esc(d.kpis[i][0])}`, d.list.filter(KQ[i]));
  $$('[data-kq]', main()).forEach(t => t.onclick = () => pop(+t.dataset.kq));
  // vừa mở trang cảnh báo (từ menu / chuông) → tự hiện các mục quá hạn; làm mới trang thì không hiện lại
  if (dashboard.pop && d.list) { const n = d.list.filter(KQ[1]).length, s = d.list.filter(KQ[2]).length; if (n) {
    const m = modal({ title: `${ico('fa-triangle-exclamation')} CẢNH BÁO`, cls: 'warnbox', body: `<div class="wb-ic">${ico('fa-circle-exclamation')}</div><div class="wb-n">Có <b>${n}</b> việc quá hạn</div>${s ? `<div class="wb-s">và ${s} việc sắp đến hạn</div>` : ''}`,
      foot: `<button class="btn" data-x>Để sau</button><button class="btn danger" id="wbV">Xem danh sách</button>` });
    $('#wbV', m.el).onclick = () => { m.close(); pop(1); }; } }
  dashboard.pop = false;
}
// hộp giữa màn hình liệt kê các cảnh báo; bấm một dòng → đóng hộp, mở hồ sơ
function alertModal(title, xs) {
  if (!xs.length) return;
  const m = modal({ title: `${title} · ${xs.length} mục`, cls: 'wide', body: `<div class="alist">${xs.map(a => `<a href="#/${a.link}">${pill(...LV[a.done ? 'da_xu_ly' : a.level])}<span>${esc(a.title)} <span class="d">${esc(a.detail || '')}</span><span class="d"> · ${esc(a.owner || '')}</span></span><span class="d nowrap">${dmy(a.due)}</span></a>`).join('')}</div>` });
  $$('.alist a', m.el).forEach(a => a.addEventListener('click', () => m.close()));
}
// lọc cho 4 ô của trang cảnh báo DB06: tổng mở · quá hạn · sắp đến hạn · đã xử lý
const KQ = [a => !a.done, a => !a.done && a.level === 'qua_han', a => !a.done && a.level === 'sap_den_han', a => a.done];
const LV = { qua_han: ['Quá hạn', 'r'], sap_den_han: ['Sắp đến hạn', 'a'], can_cap_nhat: ['Cần cập nhật dữ liệu', 'b'], da_xu_ly: ['Đã xử lý', 'g'] };
const alertTable = list => `<div class="tw mt"><table class="t"><thead><tr><th>Mức</th><th>Nhóm</th><th>Nội dung</th><th>Chi tiết</th><th>Hạn</th><th>Nguồn</th><th>Phụ trách</th><th></th></tr></thead><tbody>${list.map(a => `<tr class="c" data-go="${a.link}"><td>${pill(...LV[a.level])}</td><td>${esc(a.grp)}</td><td>${esc(a.title)}</td><td class="muted">${esc(a.detail)}</td><td class="nowrap">${dmy(a.due)}</td><td><span class="tag">${esc(a.src)}</span></td><td>${esc(a.owner)}</td><td>${a.done ? `<button class="btn sm" data-al="${esc(a.key)}" data-undo="1">Mở lại</button>` : `<button class="btn sm" data-al="${esc(a.key)}">Đã xử lý</button>`}</td></tr>`).join('')}</tbody></table></div>`;

// ---------- tài khoản & phân công: vai trò, pháp nhân phụ trách, mục menu được dùng (trưởng phòng chỉnh cho từng người) ----------
async function usersScreen() {
  const us = await api('GET', '/api/users'), RL = Object.fromEntries(M.roles.map(r => [r[0], r[1]])), LG = Object.fromEntries(M.legals.map(l => [l.id, l.short]));
  const all = M.menuAll.flatMap(([g, fs]) => fs.flatMap(([l, , x]) => Array.isArray(x) ? x.map(i => i[0]) : [x])), total = all.length;
  const list = us.filter(u => u.active || usersScreen.off), sum = u => !u.items ? '<span class="muted">Tất cả mục theo vai trò</span>' : `${u.items.filter(i => all.includes(i)).length}/${total} mục · ${M.menuAll.filter(([, fs]) => fs.some(([, , x]) => (Array.isArray(x) ? x.map(i => i[0]) : [x]).some(i => u.items.includes(i)))).map(([g]) => `<span class="pill ${g === 'NHÂN SỰ' ? 'v' : g === 'HÀNH CHÍNH' ? 'b' : ''}">${esc(g.toLowerCase())}</span>`).join(' ')}`;
  main().innerHTML = `<div class="ph"><h1>${ico('fa-user-gear')} Tài khoản & phân công</h1><p>Phân công theo sheet «Menu» của DMCV. Mỗi người chỉ thấy các mục được tích; mục khác không hiện. Chuyên viên chỉ thấy pháp nhân được giao.</p></div>
  <div class="card filters"><label class="row" style="margin:0"><input type="checkbox" id="off" style="min-width:0;height:auto" ${usersScreen.off ? 'checked' : ''}> Hiện cả tài khoản đang khóa (${us.filter(u => !u.active).length})</label></div>
  <div class="tw"><table class="t"><thead><tr><th>Tài khoản</th><th>Họ tên</th><th>Vai trò</th><th>Pháp nhân phụ trách</th><th>Mục được dùng</th><th>Trạng thái</th><th></th></tr></thead><tbody>${list.map(u => `<tr class="c" data-id="${u.id}"><td>${esc(u.username)}</td><td><b>${esc(u.full_name)}</b><div class="small muted">${esc(u.title || '')}</div></td><td>${esc(RL[u.role] || u.role)}</td><td>${u.legal_ids?.length ? u.legal_ids.map(i => esc(LG[i] || i)).join(', ') : '<span class="muted">Mọi pháp nhân</span>'}</td><td>${sum(u)}</td><td>${u.active ? pill('Hoạt động', 'g') : pill('Đã khóa', 's')}</td><td><button class="btn sm">${ico('fa-pen')} Phân quyền</button></td></tr>`).join('')}</tbody></table></div>`;
  $('#off').onchange = e => { usersScreen.off = e.target.checked; refresh(); };
  $$('tr[data-id]', main()).forEach(t => t.onclick = () => {
    const u = us.find(x => x.id === +t.dataset.id), on = i => !u.items || u.items.includes(i), ck = (i, l, code) => `<label><input type="checkbox" data-it="${esc(i)}" ${on(i) ? 'checked' : ''}> ${esc(l)}${code ? ` <span class="muted small">${esc(code)}</span>` : ''}</label>`;
    const tree = M.menuAll.map(([g, fs]) => `<div class="mt"><b>${esc(g)}</b> <button type="button" class="btn sm" data-g="${esc(g)}">Chọn / bỏ cả nhóm</button><div class="mt" style="display:grid;gap:8px" data-gb="${esc(g)}">${fs.map(([l, , x]) => Array.isArray(x)
      ? `<div class="fnb" style="border:1px solid var(--line2);border-radius:10px;padding:8px 10px"><label class="row" style="margin:0 0 6px"><input type="checkbox" data-fn ${x.every(i => on(i[0])) ? 'checked' : ''}> <b>${esc(l)}</b></label><div class="ucheck">${x.map(([i, ll, code]) => ck(i, ll, code)).join('')}</div></div>`
      : `<div class="ucheck">${ck(x, l)}</div>`).join('')}</div></div>`).join('');
    const m = modal({ title: `Phân quyền · ${esc(u.full_name)}`, cls: 'wide', body: `<div class="fg"><div class="fld"><label>Vai trò</label><select id="uR">${M.roles.map(r => `<option value="${r[0]}" ${r[0] === u.role ? 'selected' : ''}>${esc(r[1])}</option>`).join('')}</select></div>
      <div class="fld"><label>Trạng thái</label><select id="uA"><option value="1">Hoạt động</option><option value="0" ${u.active ? '' : 'selected'}>Khóa tài khoản</option></select></div>
      <div class="fld full"><label>Pháp nhân phụ trách <span class="muted">(bỏ trống = mọi pháp nhân)</span></label><div class="ucheck" id="uL">${M.legals.map(l => `<label><input type="checkbox" value="${l.id}" ${(u.legal_ids || []).includes(l.id) ? 'checked' : ''}> ${esc(l.short)}</label>`).join('')}</div></div>
      <div class="fld full"><label>Mục được dùng</label><label class="row" style="margin:0"><input type="checkbox" id="uAll" ${u.items ? '' : 'checked'}> Tất cả mục theo vai trò (không giới hạn)</label><div id="uT" class="${u.items ? '' : 'hidden'}">${tree}</div>
      <div class="help">Mục không tích: ẩn khỏi menu và không mở được. Mục hành chính được tích thì xem mọi pháp nhân; mục nhân sự theo pháp nhân phụ trách. Người có vai trò Người lao động (vd. tạp vụ) được tích mục nào thì dùng mục đó như chuyên viên.</div></div></div>`,
      foot: `<button class="btn" id="rs">${ico('fa-key')} Đặt lại mật khẩu</button><span class="grow"></span><button class="btn" data-x>Hủy</button><button class="btn pri" id="ok">${ico('fa-floppy-disk')} Lưu</button>` });
    const el = m.el;
    $('#uAll', el).onchange = e => $('#uT', el).classList.toggle('hidden', e.target.checked);
    $$('[data-fn]', el).forEach(c => c.onchange = () => $$('[data-it]', c.closest('.fnb')).forEach(i => { i.checked = c.checked; }));
    $$('[data-it]', el).forEach(c => c.addEventListener('change', () => { const box = c.closest('.fnb'), f = box && $('[data-fn]', box); if (f) f.checked = $$('[data-it]', box).every(i => i.checked); }));
    $$('[data-g]', el).forEach(b => b.onclick = () => { const xs = $$('input[type=checkbox]', $(`[data-gb="${b.dataset.g}"]`, el)), v = !xs.every(i => i.checked); xs.forEach(i => { i.checked = v; }); });
    $('#rs', el).onclick = run(async () => { if (await ask('Đặt lại mật khẩu', `Đặt mật khẩu của ${esc(u.full_name)} về mật khẩu mặc định? Người dùng phải đổi khi đăng nhập.`)) { await api('POST', `/api/users/${u.id}/reset`, {}); toast('Đã đặt lại mật khẩu'); } });
    $('#ok', el).onclick = run(async () => {
      await api('PUT', '/api/users/' + u.id, { role: $('#uR', el).value, active: $('#uA', el).value === '1', legal_ids: $$('#uL input:checked', el).map(i => +i.value), items: $('#uAll', el).checked ? null : $$('[data-it]:checked', el).map(i => i.dataset.it) });
      m.close(); toast('Đã lưu — người dùng tải lại trang để thấy menu mới'); refresh();
    });
  });
}

// ---------- tờ lịch hôm nay (dương + âm lịch) ----------
// âm lịch Việt Nam: thuật toán Hồ Ngọc Đức, múi giờ +7 (đã đối chiếu 01/01/2021 = 19/11 Canh Tý, Tết 2026 = 17/02/2026)
const LUNAR = (() => {
  const F = Math.floor, PI = Math.PI, dr = PI / 180, TZ = 7;
  const jd = (d, m, y) => { const a = F((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3; return d + F((153 * mm + 2) / 5) + 365 * yy + F(yy / 4) - F(yy / 100) + F(yy / 400) - 32045; };
  const newMoon = k => {
    const T = k / 1236.85, T2 = T * T, T3 = T2 * T, s = Math.sin;
    const J = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3 + 0.00033 * s((166.56 + 132.87 * T - 0.009173 * T2) * dr);
    const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3, Mp = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3, Fx = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
    const C = (0.1734 - 0.000393 * T) * s(M * dr) + 0.0021 * s(2 * dr * M) - 0.4068 * s(Mp * dr) + 0.0161 * s(dr * 2 * Mp) - 0.0004 * s(dr * 3 * Mp) + 0.0104 * s(dr * 2 * Fx) - 0.0051 * s(dr * (M + Mp))
      - 0.0074 * s(dr * (M - Mp)) + 0.0004 * s(dr * (2 * Fx + M)) - 0.0004 * s(dr * (2 * Fx - M)) - 0.0006 * s(dr * (2 * Fx + Mp)) + 0.0010 * s(dr * (2 * Fx - Mp)) + 0.0005 * s(dr * (2 * Mp + M));
    const dt = T < -11 ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3 : -0.000278 + 0.000265 * T + 0.000262 * T2;
    return J + C - dt;
  };
  const nmDay = k => F(newMoon(k) + 0.5 + TZ / 24);
  const sunRad = n => { const T = (n - 0.5 - TZ / 24 - 2451545) / 36525, T2 = T * T, M = 357.5291 + 35999.0503 * T - 0.0001559 * T2 - 0.00000048 * T * T2, L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
    const L = (L0 + (1.9146 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M) + (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.00029 * Math.sin(dr * 3 * M)) * dr; return L - PI * 2 * F(L / (PI * 2)); };
  const sunL = n => F(sunRad(n) / PI * 6);
  const m11 = y => { const k = F((jd(31, 12, y) - 2415021) / 29.530588853); let n = nmDay(k); if (sunL(n) >= 9) n = nmDay(k - 1); return n; };
  const leapOff = a => { const k = F((a - 2415021.076998695) / 29.530588853 + 0.5); let last, i = 1, arc = sunL(nmDay(k + i)); do { last = arc; i++; arc = sunL(nmDay(k + i)); } while (arc !== last && i < 14); return i - 1; };
  return (d, m, y) => {
    const n = jd(d, m, y), k = F((n - 2415021.076998695) / 29.530588853); let ms = nmDay(k + 1), kk = k + 1; if (ms > n) { ms = nmDay(k); kk = k; }
    let a11 = m11(y), b11 = a11, ly; if (a11 >= ms) { ly = y; a11 = m11(y - 1); } else { ly = y + 1; b11 = m11(y + 1); }
    const diff = F((ms - a11) / 29); let lm = diff + 11, leap = false;
    if (b11 - a11 > 365) { const lo = leapOff(a11); if (diff >= lo) { lm = diff + 10; leap = diff === lo; } }
    if (lm > 12) lm -= 12; if (lm >= 11 && diff < 4) ly -= 1;
    return { day: n - ms + 1, month: lm, year: ly, leap, big: nmDay(kk + 1) - ms === 30, jd: n, sun: sunRad(n) * 180 / PI };   // sun: kinh độ mặt trời (độ) đầu ngày → tiết khí
  };
})();
const CAN = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'], CHI = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'];
const THANG = ['Giêng', 'Hai', 'Ba', 'Tư', 'Năm', 'Sáu', 'Bảy', 'Tám', 'Chín', 'Mười', 'Mười Một', 'Chạp'];
// ---- xem ngày tốt xấu — chỉ dùng quy tắc tra được, đã đối chiếu quantrimang.com/lich-am (12, 15, 16/11/2026, 08/11/2026) ----
// 12 thần trực ngày / giờ: ngày theo tháng âm (Thanh Long khởi ở Tý, Dần, Thìn, Ngọ, Thân, Tuất cho tháng 1–7, 2–8, …, 6–12); giờ theo chi ngày
const THAN = ['Thanh Long', 'Minh Đường', 'Thiên Hình', 'Chu Tước', 'Kim Quỹ', 'Kim Đường', 'Bạch Hổ', 'Ngọc Đường', 'Thiên Lao', 'Huyền Vũ', 'Tư Mệnh', 'Câu Trận'], HD = [0, 1, 4, 5, 7, 10];
const GIO = ['23–1', '1–3', '3–5', '5–7', '7–9', '9–11', '11–13', '13–15', '15–17', '17–19', '19–21', '21–23'];
// 24 tiết khí theo kinh độ mặt trời (0° = Xuân phân); trực đếm từ Kiến = ngày cùng chi với tháng tiết khí (Lập xuân → tháng Dần)
const TIET = ['Xuân phân', 'Thanh minh', 'Cốc vũ', 'Lập hạ', 'Tiểu mãn', 'Mang chủng', 'Hạ chí', 'Tiểu thử', 'Đại thử', 'Lập thu', 'Xử thử', 'Bạch lộ', 'Thu phân', 'Hàn lộ', 'Sương giáng', 'Lập đông', 'Tiểu tuyết', 'Đại tuyết', 'Đông chí', 'Tiểu hàn', 'Đại hàn', 'Lập xuân', 'Vũ thủy', 'Kinh trập'];
// 12 trực: tính chất, nên / kiêng theo lichamduong.net/kien-thuc/12-truc (một nguồn cho thống nhất; sách lịch khác có thể luận khác)
const TRUC = [['Kiến', 'Bình hòa', 'Cầu tài, gặp gỡ, đi lại ngắn ngày, thăm hỏi', 'Động thổ, lợp mái, mở kho, an táng'], ['Trừ', 'Tốt', 'Cúng tế, xua tà, dọn dẹp, chữa bệnh nhẹ', 'Cưới hỏi, khai trương, ký hợp đồng'],
  ['Mãn', 'Xấu', 'Lễ tế, kết giao bạn bè, may vá, đắp đê', 'Cưới hỏi, lập di chúc, mở kho, an táng'], ['Bình', 'Bình hòa', 'San lấp, làm đường, sửa chữa nhỏ', 'Cưới hỏi, cầu tài, khởi sự lớn, kiện tụng'],
  ['Định', 'Tốt', 'Cưới hỏi, nhập trạch, an táng, ký hợp đồng dài hạn', 'Kiện tụng, đi xa, chữa bệnh'], ['Chấp', 'Tốt', 'Truy thu nợ, sửa chữa, kết hôn, lập quy ước', 'Đi xa, mở kho, dời nhà'],
  ['Phá', 'Đại hung', 'Phá dỡ, tháo dỡ, chữa bệnh nặng, tiễn đưa', 'Cưới hỏi, khai trương, động thổ, ký kết'], ['Nguy', 'Xấu', 'Lễ tế, cầu phúc', 'Hầu như mọi việc, nhất là leo cao, đi biển, phẫu thuật'],
  ['Thành', 'Đại cát', 'Cưới hỏi, khai trương, nhập trạch, xây dựng, ký kết', 'Kiện tụng, tranh chấp'], ['Thu', 'Tốt', 'Thu hoạch, mua bán, nhập kho, gửi tiền, đòi nợ', 'An táng, dời đi, đi xa'],
  ['Khai', 'Tốt', 'Khai trương, nhập học, cưới hỏi, xây nhà, khám bệnh', 'An táng, hạ huyệt'], ['Bế', 'Xấu', 'Lập kế hoạch nội bộ, sửa nội thất, đắp đê, bịt lỗ', 'Khai trương, đi xa, mở cửa hàng']];
// ngày với tuổi người xem: chi ngày đối xung chi năm sinh (lục xung) → xung tuổi; cùng nhóm tam hợp → hợp tuổi.
// Năm sinh tính theo năm âm (sinh trước Tết thuộc năm âm trước). Lục hợp, can xung chưa có nguồn thống nhất nên không dùng.
const TAM_HOP = [[8, 0, 4], [2, 6, 10], [5, 9, 1], [11, 3, 7]];   // Thân Tý Thìn · Dần Ngọ Tuất · Tỵ Dậu Sửu · Hợi Mão Mùi
function tuoiNgay(dob, l) {
  if (!dob) return null;
  const [y, m, d] = dob.slice(0, 10).split('-').map(Number), b = LUNAR(d, m, y), yc = (b.year + 8) % 12, dc = (l.jd + 1) % 12;
  const tuoi = `${CAN[(b.year + 6) % 10]} ${CHI[yc]}`, kind = (dc + 6) % 12 === yc ? 'xung' : dc !== yc && TAM_HOP.some(g => g.includes(dc) && g.includes(yc)) ? 'hop' : '';
  return { tuoi, nam: b.year, kind, dayChi: CHI[dc] };
}
function xemNgay(l) {
  const dc = (l.jd + 1) % 12, mc = (2 + Math.floor(((l.sun - 315 + 360) % 360) / 30)) % 12;
  const than = (dc - [0, 2, 4, 6, 8, 10][(l.month - 1) % 6] + 12) % 12, g0 = [8, 10, 0, 2, 4, 6][dc % 6];
  return { than: THAN[than], tot: HD.includes(than), tiet: TIET[Math.floor(l.sun / 15) % 24], truc: TRUC[(dc - mc + 12) % 12],
    gio: Array.from({ length: 12 }, (_, h) => h).filter(h => HD.includes((h - g0 + 12) % 12)).map(h => ({ h, chi: CHI[h], t: GIO[h], than: THAN[(h - g0 + 12) % 12] })) };
}
// tờ lịch kiểu lịch bloc treo tường: dải đỏ hoa văn, tháng – năm, số ngày dương thật to (đỏ viền trắng, nổi khối) cạnh một loài hoa (đổi theo ngày);
// dải thứ; khối âm lịch: can chi bên trái, ngày âm xanh ở giữa, tên ngày âm bên phải; xem ngày; dải tuần ở chân
// ngày lễ, ngày truyền thống (dương / âm)
const LE_DL = { '01-01': 'Tết Dương lịch', '02-03': 'Thành lập Đảng CSVN', '03-08': 'Quốc tế Phụ nữ', '04-30': 'Giải phóng miền Nam', '05-01': 'Quốc tế Lao động', '09-02': 'Quốc khánh', '10-20': 'Phụ nữ Việt Nam', '11-20': 'Nhà giáo Việt Nam', '12-22': 'Quân đội Nhân dân VN' };
const LE_AL = { '1-1': 'Tết Nguyên đán', '1-2': 'Tết Nguyên đán', '1-3': 'Tết Nguyên đán', '1-15': 'Rằm tháng Giêng', '3-10': 'Giỗ Tổ Hùng Vương', '4-15': 'Lễ Phật đản', '5-5': 'Tết Đoan ngọ', '7-15': 'Lễ Vu Lan', '8-15': 'Tết Trung thu', '12-23': 'Ông Công Ông Táo' };
// hình trang trí vẽ bằng SVG (không dùng ảnh ngoài): bông 5 cánh, cành mai vàng, chậu đào, dây treo
const bong = (x, y, r, c, t = '#b45309') => `<g transform="translate(${x} ${y})">${[0, 72, 144, 216, 288].map(a => `<circle cx="${(r * .62 * Math.cos(a * Math.PI / 180)).toFixed(1)}" cy="${(r * .62 * Math.sin(a * Math.PI / 180)).toFixed(1)}" r="${(r * .55).toFixed(1)}" fill="${c}"/>`).join('')}<circle r="${(r * .35).toFixed(1)}" fill="${t}"/></g>`;
const SVG_MAI = `<svg viewBox="0 0 130 170" aria-hidden="true"><path d="M8 168C26 128 40 104 62 80S98 34 124 14" stroke="#6b3f1d" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M50 94C38 80 30 62 32 44M80 58C94 54 108 58 118 70M66 76C74 92 88 100 104 102" stroke="#6b3f1d" stroke-width="3" fill="none" stroke-linecap="round"/>
  ${[[32, 42, 11], [62, 80, 12], [100, 34, 11], [118, 70, 10], [104, 102, 11], [44, 108, 10], [84, 52, 9], [24, 140, 9], [122, 14, 8]].map(([x, yy, r]) => bong(x, yy, r, '#facc15')).join('')}${[[40, 60], [90, 96], [112, 24], [70, 66]].map(([x, yy]) => `<circle cx="${x}" cy="${yy}" r="4" fill="#fde047" stroke="#ca8a04"/>`).join('')}
  ${[[56, 88, -30], [96, 44, 20], [110, 88, 40]].map(([x, yy, a]) => `<ellipse cx="${x}" cy="${yy}" rx="7" ry="3" fill="#65a30d" transform="rotate(${a} ${x} ${yy})"/>`).join('')}</svg>`;
const SVG_DAO = `<svg viewBox="0 0 170 180" aria-hidden="true"><path d="M48 150h76l-8 24H56z" fill="#d4a017" stroke="#92650a" stroke-width="2"/><rect x="42" y="144" width="88" height="9" rx="3" fill="#eab308" stroke="#92650a" stroke-width="2"/>
  <ellipse cx="86" cy="142" rx="46" ry="12" fill="#16a34a"/><ellipse cx="72" cy="138" rx="18" ry="8" fill="#22c55e"/><path d="M86 140C80 116 92 100 84 80S94 48 112 38M84 96C68 86 52 82 40 70M90 74C108 72 124 62 136 48" stroke="#5b3416" stroke-width="6" fill="none" stroke-linecap="round"/>
  ${[[40, 66, 9], [52, 56, 8], [30, 80, 8], [62, 74, 7], [112, 34, 10], [124, 22, 8], [100, 24, 8], [136, 46, 9], [148, 34, 8], [126, 58, 8], [96, 52, 7], [74, 50, 8], [84, 36, 7], [58, 92, 7], [146, 60, 7], [108, 66, 7]].map(([x, yy, r], i) => bong(x, yy, r, i % 3 ? '#e11d48' : '#fb7185', '#fde68a')).join('')}</svg>`;
// vòng cánh hoa quanh tâm (sen, cúc, hướng dương)
const canh = (cx, cy, n, rx, ry, r0, c, a0 = 0) => Array.from({ length: n }, (_, i) => { const a = a0 + 360 * i / n; return `<ellipse cx="${cx}" cy="${cy - r0}" rx="${rx}" ry="${ry}" fill="${c}" transform="rotate(${a} ${cx} ${cy})"/>`; }).join('');
const SVG_SEN = `<svg viewBox="0 0 170 180" aria-hidden="true"><ellipse cx="85" cy="166" rx="80" ry="12" fill="#bae6fd"/><path d="M84 164C82 140 86 120 84 100M120 162C118 146 124 132 130 124" stroke="#15803d" stroke-width="4" fill="none"/>
  <ellipse cx="40" cy="156" rx="34" ry="11" fill="#16a34a"/><path d="M40 156L74 150" stroke="#14532d" stroke-width="1.5"/><ellipse cx="136" cy="158" rx="26" ry="9" fill="#22c55e"/>
  ${[[-62, '#f9a8d4'], [-34, '#f472b6'], [-12, '#f9a8d4'], [12, '#f9a8d4'], [34, '#f472b6'], [62, '#f9a8d4'], [-20, '#fbcfe8'], [20, '#fbcfe8'], [0, '#f472b6']].map(([a, c]) => `<ellipse cx="84" cy="66" rx="13" ry="34" fill="${c}" stroke="#db2777" stroke-width="1" transform="rotate(${a} 84 100)"/>`).join('')}
  <ellipse cx="84" cy="98" rx="14" ry="6" fill="#facc15"/><ellipse cx="130" cy="108" rx="9" ry="18" fill="#f472b6" stroke="#db2777"/><ellipse cx="130" cy="104" rx="5" ry="12" fill="#fbcfe8"/></svg>`;
const SVG_CUC = `<svg viewBox="0 0 170 180" aria-hidden="true"><path d="M52 150h66l-6 26H58z" fill="#c2410c" stroke="#7c2d12" stroke-width="2"/><rect x="46" y="143" width="78" height="9" rx="3" fill="#ea580c" stroke="#7c2d12" stroke-width="2"/>
  <path d="M85 144C84 120 70 96 52 78M85 144C86 116 90 84 86 52M85 144C90 122 108 102 124 88" stroke="#15803d" stroke-width="4" fill="none"/>
  ${[[64, 120, -30], [104, 118, 30], [72, 96, -40], [100, 92, 40]].map(([x, yy, a]) => `<ellipse cx="${x}" cy="${yy}" rx="13" ry="6" fill="#16a34a" transform="rotate(${a} ${x} ${yy})"/>`).join('')}
  ${[[52, 74, 26], [86, 48, 30], [124, 84, 24]].map(([x, yy, r]) => canh(x, yy, 22, 2.6, r * .42, r * .52, '#f59e0b') + canh(x, yy, 18, 2.4, r * .3, r * .32, '#facc15', 9) + `<circle cx="${x}" cy="${yy}" r="${r * .2}" fill="#ca8a04"/>`).join('')}</svg>`;
const SVG_HD = `<svg viewBox="0 0 170 180" aria-hidden="true"><path d="M86 178C86 140 84 110 88 70M60 178C62 150 58 132 50 116" stroke="#3f6212" stroke-width="5" fill="none"/>
  ${[[70, 132, -40, 22], [104, 120, 35, 24], [72, 92, -30, 16], [66, 156, 30, 16]].map(([x, yy, a, r]) => `<ellipse cx="${x}" cy="${yy}" rx="${r}" ry="${r * .45}" fill="#4d7c0f" transform="rotate(${a} ${x} ${yy})"/>`).join('')}
  ${canh(88, 58, 20, 7, 17, 30, '#f59e0b') + canh(88, 58, 20, 6, 14, 26, '#facc15', 9)}<circle cx="88" cy="58" r="20" fill="#78350f"/><circle cx="88" cy="58" r="13" fill="#92400e"/>
  ${canh(50, 110, 16, 4.5, 10, 18, '#fbbf24')}<circle cx="50" cy="110" r="11" fill="#78350f"/></svg>`;
// hình phụ bên trái — vẽ riêng, dáng khác hình chính (không lật / thu nhỏ hình bên phải)
const SVG_MAI2 = `<svg viewBox="0 0 120 130" aria-hidden="true"><path d="M112 4C92 22 70 30 52 52S24 92 10 124" stroke="#6b3f1d" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M64 40C70 56 84 66 100 68M38 76C28 70 20 58 18 44" stroke="#6b3f1d" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  ${[[64, 40, 10], [100, 68, 9], [30, 92, 10], [18, 44, 8]].map(([x, yy, r]) => bong(x, yy, r, '#fde047')).join('')}${[[88, 22], [50, 58], [84, 64], [16, 116], [42, 80]].map(([x, yy]) => `<ellipse cx="${x}" cy="${yy}" rx="3.5" ry="4.5" fill="#facc15" stroke="#ca8a04"/>`).join('')}
  ${[[76, 34, 30], [24, 60, -40]].map(([x, yy, a]) => `<ellipse cx="${x}" cy="${yy}" rx="7" ry="2.8" fill="#65a30d" transform="rotate(${a} ${x} ${yy})"/>`).join('')}</svg>`;
const SVG_DAO2 = `<svg viewBox="0 0 120 130" aria-hidden="true"><path d="M6 126C30 104 46 80 64 60S96 22 116 8" stroke="#5b3416" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M48 80C60 84 76 86 92 80M70 52C62 40 60 28 64 14" stroke="#5b3416" stroke-width="3" fill="none" stroke-linecap="round"/>
  ${[[92, 80, 9], [64, 14, 9], [84, 34, 8], [40, 92, 8], [108, 14, 7], [58, 66, 7], [26, 108, 7], [74, 70, 6]].map(([x, yy, r], i) => bong(x, yy, r, i % 2 ? '#fb7185' : '#f43f5e', '#fde68a')).join('')}
  ${[[100, 26], [50, 76], [18, 118]].map(([x, yy]) => `<circle cx="${x}" cy="${yy}" r="3.5" fill="#fda4af" stroke="#e11d48"/>`).join('')}</svg>`;
const SVG_SEN2 = `<svg viewBox="0 0 120 130" aria-hidden="true"><ellipse cx="60" cy="122" rx="56" ry="7" fill="#bae6fd"/><path d="M40 120C42 96 38 70 44 46M78 120C76 100 82 82 86 64" stroke="#15803d" stroke-width="3.5" fill="none"/>
  <path d="M8 104C20 82 54 80 70 98C54 94 34 98 8 104z" fill="#16a34a"/><path d="M14 102C30 92 48 92 64 97" stroke="#14532d" stroke-width="1.2" fill="none"/>
  <ellipse cx="44" cy="36" rx="10" ry="16" fill="#f472b6" stroke="#db2777"/><path d="M44 22C40 30 40 42 44 50C48 42 48 30 44 22z" fill="#fbcfe8"/>
  <path d="M72 56h28l-4 10H76z" fill="#65a30d" stroke="#3f6212" stroke-width="1.5"/><ellipse cx="86" cy="56" rx="14" ry="4" fill="#84cc16" stroke="#3f6212" stroke-width="1.5"/>${[[80, 56], [86, 54], [92, 56], [86, 58]].map(([x, yy]) => `<circle cx="${x}" cy="${yy}" r="1.6" fill="#3f6212"/>`).join('')}</svg>`;
const SVG_CUC2 = `<svg viewBox="0 0 120 130" aria-hidden="true"><path d="M58 128C56 100 52 72 44 40M56 96C66 82 78 72 90 66" stroke="#15803d" stroke-width="3.5" fill="none"/>
  ${[[50, 104, -35], [64, 86, 30], [48, 70, -30]].map(([x, yy, a]) => `<path d="M${x} ${yy}c-10-4-16 2-18 8c8 2 14-2 18-8z" fill="#16a34a" transform="rotate(${a} ${x} ${yy})"/>`).join('')}
  ${[[44, 34, 24], [92, 62, 18]].map(([x, yy, r]) => canh(x, yy, 18, 2.4, r * .42, r * .5, '#fbbf24') + canh(x, yy, 14, 2.2, r * .28, r * .3, '#fde047', 12) + `<circle cx="${x}" cy="${yy}" r="${r * .18}" fill="#b45309"/>`).join('')}
  <circle cx="22" cy="58" r="5" fill="#16a34a"/><path d="M22 54c0-4 2-6 4-6" stroke="#15803d" stroke-width="2" fill="none"/></svg>`;
const SVG_HD2 = `<svg viewBox="0 0 120 130" aria-hidden="true"><path d="M70 128C74 100 70 76 56 54" stroke="#3f6212" stroke-width="4" fill="none"/><path d="M71 100C86 92 98 94 106 102C94 108 82 106 71 100z" fill="#4d7c0f"/><path d="M68 82C54 76 44 78 36 86C48 90 60 88 68 82z" fill="#65a30d"/>
  <g transform="rotate(-25 46 40)">${canh(46, 40, 18, 5, 13, 22, '#f59e0b') + canh(46, 40, 18, 4.5, 10, 19, '#fde047', 10)}<ellipse cx="46" cy="40" rx="15" ry="14" fill="#78350f"/><ellipse cx="46" cy="40" rx="9" ry="8.5" fill="#a16207"/></g></svg>`;
// câu nói mỗi ngày trên tờ lịch: tục ngữ, ca dao quen thuộc (đổi theo ngày)
const CAU = [['Có công mài sắt, có ngày nên kim.', 'Tục ngữ'], ['Uống nước nhớ nguồn.', 'Tục ngữ'], ['Một cây làm chẳng nên non, ba cây chụm lại nên hòn núi cao.', 'Ca dao'],
  ['Ăn quả nhớ kẻ trồng cây.', 'Tục ngữ'], ['Đi một ngày đàng, học một sàng khôn.', 'Tục ngữ'], ['Lá lành đùm lá rách.', 'Tục ngữ'], ['Kiến tha lâu cũng đầy tổ.', 'Tục ngữ'],
  ['Chớ thấy sóng cả mà ngã tay chèo.', 'Tục ngữ'], ['Tốt gỗ hơn tốt nước sơn.', 'Tục ngữ'], ['Học ăn, học nói, học gói, học mở.', 'Tục ngữ'],
  ['Lời nói chẳng mất tiền mua, lựa lời mà nói cho vừa lòng nhau.', 'Ca dao'], ['Nhiễu điều phủ lấy giá gương, người trong một nước phải thương nhau cùng.', 'Ca dao'],
  ['Bầu ơi thương lấy bí cùng, tuy rằng khác giống nhưng chung một giàn.', 'Ca dao'], ['Không thầy đố mày làm nên.', 'Tục ngữ'], ['Gần mực thì đen, gần đèn thì rạng.', 'Tục ngữ'],
  ['Ai ơi bưng bát cơm đầy, dẻo thơm một hạt đắng cay muôn phần.', 'Ca dao'], ['Công cha như núi Thái Sơn, nghĩa mẹ như nước trong nguồn chảy ra.', 'Ca dao'],
  ['Một điều nhịn, chín điều lành.', 'Tục ngữ'], ['Có làm thì mới có ăn, không dưng ai dễ mang phần đến cho.', 'Ca dao'], ['Giấy rách phải giữ lấy lề.', 'Tục ngữ'],
  ['Đói cho sạch, rách cho thơm.', 'Tục ngữ'], ['Nước chảy đá mòn.', 'Tục ngữ'], ['Thương người như thể thương thân.', 'Tục ngữ'], ['Học thầy không tày học bạn.', 'Tục ngữ'],
  ['Ở hiền gặp lành.', 'Tục ngữ'], ['Một con ngựa đau, cả tàu bỏ cỏ.', 'Tục ngữ'], ['Ăn có nhai, nói có nghĩ.', 'Tục ngữ'], ['Có chí thì nên.', 'Tục ngữ'],
  ['Không có việc gì khó, chỉ sợ lòng không bền; đào núi và lấp biển, quyết chí ắt làm nên.', 'Hồ Chí Minh'],
  ...['Ăn vóc học hay.', 'Chậm mà chắc.', 'Cẩn tắc vô áy náy.', 'Siêng làm thì có, siêng học thì hay.', 'Tay làm hàm nhai, tay quai miệng trễ.', 'Người ta là hoa đất.',
    'Biết thì thưa thốt, không biết thì dựa cột mà nghe.', 'Thất bại là mẹ thành công.', 'Ăn cây nào rào cây ấy.', 'Một miếng khi đói bằng một gói khi no.', 'Bán anh em xa, mua láng giềng gần.',
    'Có đi mới đến, có học mới hay.', 'Gieo gió gặt bão.', 'Hữu xạ tự nhiên hương.', 'Lửa thử vàng, gian nan thử sức.', 'Mất lòng trước, được lòng sau.', 'Năng nhặt chặt bị.',
    'Nhập gia tùy tục.', 'Sai một li, đi một dặm.', 'Tích tiểu thành đại.', 'Tiên học lễ, hậu học văn.', 'Trăm hay không bằng tay quen.', 'Trăm nghe không bằng một thấy.',
    'Vạn sự khởi đầu nan.', 'Có cứng mới đứng đầu gió.', 'Gừng càng già càng cay.', 'Kính lão đắc thọ.', 'Nói có sách, mách có chứng.', 'Rừng có mạch, vách có tai.',
    'Một mặt người bằng mười mặt của.', 'Tấc đất tấc vàng.', 'Của bền tại người.', 'Ăn chắc mặc bền.', 'Ăn ngay nói thẳng.', 'Cây ngay không sợ chết đứng.', 'Chim có tổ, người có tông.',
    'Con hơn cha là nhà có phúc.', 'Đất lành chim đậu.', 'Lá rụng về cội.', 'Máu chảy ruột mềm.', 'Môi hở răng lạnh.', 'Nhà sạch thì mát, bát sạch ngon cơm.', 'Nhường cơm sẻ áo.',
    'Thua keo này, bày keo khác.', 'Tre già măng mọc.', 'Một nghề cho chín còn hơn chín nghề.', 'Lạt mềm buộc chặt.', 'Cái nết đánh chết cái đẹp.', 'Một nụ cười bằng mười thang thuốc bổ.',
    'Có bột mới gột nên hồ.', 'Mưa dầm thấm lâu.', 'Ăn trông nồi, ngồi trông hướng.', 'Đi hỏi già, về nhà hỏi trẻ.', 'Thời giờ là vàng bạc.', 'Uốn lưỡi bảy lần trước khi nói.'].map(c => [c, 'Tục ngữ']),
  ...['Muốn sang thì bắc cầu kiều, muốn con hay chữ thì yêu lấy thầy.', 'Cá không ăn muối cá ươn, con cãi cha mẹ trăm đường con hư.', 'Uốn cây từ thuở còn non, dạy con từ thuở con còn ngây thơ.',
    'Nước lã mà vã nên hồ, tay không mà nổi cơ đồ mới ngoan.', 'Thuận vợ thuận chồng, tát biển Đông cũng cạn.', 'Ngọc kia chuốt mãi cũng tròn, sắt kia mài mãi cũng còn nên kim.',
    'Ai ơi đã quyết thì hành, đã đan thì lận tròn vành mới thôi.', 'Dù ai nói ngả nói nghiêng, lòng ta vẫn vững như kiềng ba chân.', 'Ai ơi chớ bỏ ruộng hoang, bao nhiêu tấc đất tấc vàng bấy nhiêu.',
    'Cày đồng đang buổi ban trưa, mồ hôi thánh thót như mưa ruộng cày.', 'Ai ơi giữ chí cho bền, dù ai xoay hướng đổi nền mặc ai.', 'Khôn ngoan đối đáp người ngoài, gà cùng một mẹ chớ hoài đá nhau.',
    'Anh em như thể tay chân, rách lành đùm bọc dở hay đỡ đần.', 'Đi đâu mà vội mà vàng, mà vấp phải đá mà quàng phải dây.', 'Trong đầm gì đẹp bằng sen, lá xanh bông trắng lại chen nhị vàng.',
    'Có thờ có thiêng, có kiêng có lành.', 'Ơn cha nặng lắm ai ơi, nghĩa mẹ bằng trời chín tháng cưu mang.'].map(c => [c, 'Ca dao']),
  ['Vì lợi ích mười năm thì phải trồng cây, vì lợi ích trăm năm thì phải trồng người.', 'Hồ Chí Minh'], ['Đoàn kết, đoàn kết, đại đoàn kết. Thành công, thành công, đại thành công.', 'Hồ Chí Minh'],
  ['Không có gì quý hơn độc lập, tự do.', 'Hồ Chí Minh'], ['Một năm khởi đầu từ mùa xuân, một đời khởi đầu từ tuổi trẻ.', 'Hồ Chí Minh'],
  ['Hiền tài là nguyên khí của quốc gia.', 'Thân Nhân Trung'], ['Bàn tay ta làm nên tất cả, có sức người sỏi đá cũng thành cơm.', 'Hoàng Trung Thông'],
  ['Học, học nữa, học mãi.', 'V.I. Lênin'], ['Thắng không kiêu, bại không nản.', 'Châm ngôn']];
// mỗi ngày một loài hoa (xoay vòng theo ngày): [tên, hình chính (bên phải), hình phụ (bên trái)]
const HOA = [['mai', SVG_MAI, SVG_MAI2], ['đào', SVG_DAO, SVG_DAO2], ['sen', SVG_SEN, SVG_SEN2], ['cúc', SVG_CUC, SVG_CUC2], ['hướng dương', SVG_HD, SVG_HD2]];
const SVG_TREO =`<svg viewBox="0 0 60 120" aria-hidden="true"><path d="M30 0v28" stroke="#b91c1c" stroke-width="2"/><circle cx="30" cy="38" r="11" fill="#facc15" stroke="#b45309" stroke-width="2"/><rect x="26" y="34" width="8" height="8" fill="#b91c1c"/>
  <path d="M30 50l12 14-12 14-12-14z" fill="#dc2626" stroke="#7f1d1d" stroke-width="1.5"/><path d="M24 78v34M30 78v40M36 78v34" stroke="#dc2626" stroke-width="2"/><circle cx="30" cy="64" r="3" fill="#fde68a"/></svg>`;
function lichPage(iso, hol = [], dob) {
  const [y, m, d] = iso.split('-').map(Number), dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(), l = LUNAR(d, m, y);
  const ci = (l.year + 6) % 10, hi = (l.year + 8) % 12, mci = (l.year * 12 + l.month + 3) % 10, mhi = (l.month + 1) % 12, dci = (l.jd + 9) % 10, dhi = (l.jd + 1) % 12, gci = (dci * 2) % 10;   // gci: can của giờ Tý đầu ngày
  const TV = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'], EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const xn = xemNgay(l), hoa = HOA[l.jd % HOA.length], ngayAm = l.day === 15 ? 'Ngày Rằm' : l.day <= 10 ? `Mùng ${l.day}` : `Ngày ${l.day}`;
  const MV = ['Một', 'Hai', 'Ba', 'Tư', 'Năm', 'Sáu', 'Bảy', 'Tám', 'Chín', 'Mười', 'Mười Một', 'Mười Hai'], ME = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const le = LE_DL[iso.slice(5)] || (!l.leap && LE_AL[`${l.month}-${l.day}`]) || (hol.includes(iso) ? 'Ngày nghỉ lễ' : l.day === 1 ? 'Mùng một' : l.day === 15 ? 'Ngày rằm' : '');
  const off = dow === 0 || hol.includes(iso);
  return `<div class="lich ${off ? 'off' : ''}"><div class="lh"><span>CÁT TƯỜNG NHƯ Ý</span></div>
    <div class="lm"><b>THÁNG ${MV[m - 1].toUpperCase()}</b><span>${y}</span><em>${ME[m - 1]}</em></div>
    <div class="ldw"><div class="dtreo">${SVG_TREO}</div><div class="dhoa l" title="Hoa ${hoa[0]}">${hoa[2]}</div><div class="ld">${d}</div><div class="dhoa" title="Hoa ${hoa[0]}">${hoa[1]}</div>
      ${le ? `<div class="lhol">${esc(le)}</div>` : ''}</div>
    <div class="lw"><span>${EN[dow].toUpperCase()}</span><b>${TV[dow].toUpperCase()}</b><span class="ldt">${dmy(iso)}</span></div>
    ${(c => `<div class="lq">“${c[0].normalize('NFC')}”<small>— ${c[1]}</small></div>`)(CAU[l.jd % CAU.length])}
    <div class="la"><div class="lal"><b>NĂM ${(CAN[ci] + ' ' + CHI[hi]).toUpperCase()}</b><b>THÁNG ${THANG[l.month - 1].toUpperCase()}${l.leap ? ' NHUẬN' : ''} (${l.big ? 'Đủ' : 'Thiếu'})</b><span>${ngayAm} tháng ${THANG[l.month - 1]}</span><span>Tiết ${xn.tiet}</span></div>
      <div class="lad">${l.day}</div>
      <div class="lar"><b>Tháng ${CAN[mci]} ${CHI[mhi]}</b><b>Ngày ${CAN[dci]} ${CHI[dhi]}</b><span>Giờ ${CAN[gci]} Tý</span><em class="lhd ${xn.tot ? 'tot' : 'xau'}">${ico(xn.tot ? 'fa-sun' : 'fa-moon')} ${xn.tot ? 'Hoàng đạo' : 'Hắc đạo'} · ${xn.than}</em></div></div>
    ${(x => { const nowH = Math.floor(((new Date().getUTCHours() + 7) % 24 + 1) / 2) % 12;   // giờ hiện tại theo chi (Tý = 23h–1h)
      return `<div class="lx">
      ${(t => !t ? `<div class="ltu">${ico('fa-user')} Hồ sơ chưa có ngày sinh — HCNS cập nhật để xem ngày hợp / xung tuổi của bạn.</div>`
        : `<div class="ltu ${t.kind}"><b>${ico(t.kind === 'xung' ? 'fa-triangle-exclamation' : t.kind === 'hop' ? 'fa-heart' : 'fa-user')} Tuổi của bạn: ${t.tuoi}</b>${t.kind === 'xung'
          ? `<span>Ngày ${t.dayChi} <u>xung tuổi</u> bạn — nên tránh việc lớn: khởi công, cưới gả, khai trương, xuất hành xa.</span>`
          : t.kind === 'hop' ? `<span>Ngày ${t.dayChi} <u>tam hợp</u> với tuổi bạn — ngày may mắn, thuận lợi cho bạn.</span>` : `<span>Ngày ${t.dayChi} không xung, không hợp với tuổi bạn — bình thường.</span>`}</div>`)(tuoiNgay(dob, l))}
      <div class="lxr"><span class="k">Trực ${x.truc[0]}</span><span class="v ${/tốt|cát/i.test(x.truc[1]) ? 'g' : /xấu|hung/i.test(x.truc[1]) ? 'r' : ''}">${x.truc[1]}</span></div>
      <div class="lxn"><div><b>${ico('fa-circle-check')} Nên</b>${esc(x.truc[2])}</div><div><b>${ico('fa-ban')} Kiêng</b>${esc(x.truc[3])}</div></div>
      <div class="lxg"><b>Giờ hoàng đạo</b><div>${x.gio.map(g => `<span class="${g.h === nowH && iso === M.today ? 'now' : ''}" title="${g.than}">${g.chi}<small>${g.t}h</small></span>`).join('')}</div></div></div>`; })(xn)}
    </div>`;
}

// ---------- tiền ăn: mã QR VietQR (đã điền số tiền, nội dung) + hộp thanh toán mở từ thông báo ----------
const mealInfo = (x, code) => `TIEN AN ${x.month.slice(5)}${x.month.slice(0, 4)} ${code}`;
const mealQr = (x, bank, code) => bank?.bank && bank?.acc ? `https://img.vietqr.io/image/${encodeURIComponent(bank.bank)}-${encodeURIComponent(bank.acc)}-compact2.png?amount=${Math.round(+x.amount)}&addInfo=${encodeURIComponent(mealInfo(x, code))}&accountName=${encodeURIComponent(bank.name || '')}` : '';
async function openMealBill(month) {
  const d = await api('GET', '/api/portal'), bank = d.mealBank || {}, code = d.emp.code, x = (d.meal || []).find(m => m.month === month) || (d.meal || [])[0];
  if (!x) return toast('Không còn khoản tiền ăn nào cần thanh toán');
  const paid = x.pay_st === 'da_tt', q = mealQr(x, bank, code);
  const m = modal({ title: `${ico('fa-utensils')} Tiền ăn tháng ${mmy(x.month)}`, cls: 'nar', body: `<div class="mealbox">
    <div class="mealamt"><span>${x.n_days} suất</span><b>${fm(x.amount)} đ</b></div>
    ${paid ? `<div class="banner ok">${ico('fa-circle-check')} Bạn đã thanh toán lúc ${dmyhm(x.paid_at)}</div>`
      : q ? `<img class="mealqr" src="${q}" alt="Mã QR chuyển khoản tiền ăn"><div class="small center">${esc(bank.bank)} · <b>${esc(bank.acc)}</b>${bank.name ? ` · ${esc(bank.name)}` : ''}<br>Nội dung: <b>${mealInfo(x, esc(code))}</b></div><div class="small muted center">Mở app ngân hàng → Quét mã QR → số tiền và nội dung đã điền sẵn</div>`
      : `<div class="banner">${ico('fa-triangle-exclamation')} Phòng HCNS chưa cài tài khoản nhận tiền nên chưa có mã QR — liên hệ HCNS để nộp tiền.</div>`}</div>`,
    foot: paid ? `<button class="btn" data-x>Đóng</button>` : `<button class="btn" data-x>Để sau</button><button class="btn ok" id="mpd">${ico('fa-circle-check')} Tôi đã thanh toán</button>` });
  if ($('#mpd', m.el)) $('#mpd', m.el).onclick = run(async () => { const r = await api('POST', `/api/portal/meal-paid/${x.id}`, {}); m.close(); toast(`Đã ghi nhận thanh toán lúc ${dmyhm(r.paid_at)}`); refresh(); });
}

// ---------- Chấm công & đơn từ (nhân viên) — bản thử của mục sẽ cắm vào app các phòng; #/v/portal?embed=1 = không có khung app ----------
async function portalScreen() {
  const d = await api('GET', '/api/portal'), E = d.emp, T = d.today, mo = d.month, C2 = d.catalog, pend = d.reqs.filter(r => r.status === 'cho_duyet').length;
  const hm = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(11, 19), init = E.name.split(' ').filter(s => /^\p{L}/u.test(s)).slice(-2).map(s => s[0]).join('');
  const DN = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'], m = mo.month, md = new Map(mo.days.map(x => [+x.day.slice(8), x.mark]));
  // lịch công tháng: 7 cột T2 → CN như lịch thường; ô chỉ có số ngày + ký hiệu công; ngày làm việc đã qua mà chưa có công → chữ «thiếu» đỏ nhạt; hôm nay viền xanh
  const lead = (new Date(m + '-01T00:00:00Z').getUTCDay() + 6) % 7, cal = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(x => `<i class="${x === 'CN' ? 'cn' : ''}">${x}</i>`).join('') + '<span></span>'.repeat(lead) + Array.from({ length: mo.last }, (_, i) => { const dd = `${m}-${String(i + 1).padStart(2, '0')}`, dow = new Date(dd + 'T00:00:00Z').getUTCDay(), mk = md.get(i + 1), off = dow === 0 || mo.hol.includes(dd), kc = !mk && !off && dd < T.day; return `<div class="${off ? 'off' : ''} ${dd === T.day ? 'td' : ''} ${dd > T.day ? 'fu' : ''} ${mk ? (mkCls(mk) === 'X' ? 'warn' : 'ok') : kc ? 'kc' : ''}" title="${dmy(dd)}${mk ? ' · ' + esc(mk) : kc ? ' · chưa có công — chấm bù hoặc làm đơn nếu có đi làm / nghỉ có phép' : ''}"><b>${i + 1}</b>${mk ? `<span class="mk ${mkCls(mk)}">${esc(mk)}</span>` : kc ? '<em>chưa có</em>' : ''}</div>`; }).join(''), nKc = Array.from({ length: mo.last }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`).filter(dd => !md.get(+dd.slice(8)) && new Date(dd + 'T00:00:00Z').getUTCDay() !== 0 && !mo.hol.includes(dd) && dd < T.day).length;
  // tiền ăn tháng: khoản chờ thanh toán → số tiền + mã QR VietQR (đã điền số tiền, nội dung) + nút «Tôi đã thanh toán»; khoản đã trả → dòng xác nhận ngày giờ
  const bank = d.mealBank || {}, qr = x => mealQr(x, bank, E.code);
  const mealCard = (d.meal || []).map(x => x.pay_st === 'cho_tt' ? `<div class="card meal mb"><div class="sec">${ico('fa-utensils')} Tiền ăn tháng ${mmy(x.month)}</div>
      <div class="mealb"><div class="mealq">${qr(x) ? `<img src="${qr(x)}" alt="Mã QR chuyển khoản tiền ăn" loading="lazy">` : `<div class="small muted">Phòng HCNS chưa cài tài khoản nhận tiền — liên hệ HCNS để nộp tiền</div>`}</div>
      <div class="mealt"><span class="muted">${x.n_days} suất</span><b>${fm(x.amount)} đ</b>${bank.acc ? `<span class="small">${esc(bank.bank)} · ${esc(bank.acc)}${bank.name ? ` · ${esc(bank.name)}` : ''}</span><span class="small muted">Nội dung: TIEN AN ${x.month.slice(5)}${x.month.slice(0, 4)} ${esc(E.code)}</span>` : ''}
        <button class="btn ok mt" data-mpaid="${x.id}">${ico('fa-circle-check')} Tôi đã thanh toán</button></div></div></div>`
    : `<div class="card meal paid mb small">${ico('fa-circle-check')} Đã thanh toán tiền ăn tháng ${mmy(x.month)} · <b>${fm(x.amount)} đ</b> · ${dmyhm(x.paid_at)}</div>`).join('');
  // hoạt động văn hóa hôm nay: nằm giữa thẻ chấm công và bảng công tháng (cột trái), cho hai cột cao đều với tờ lịch
  const cult = `${(d.culture || []).length ? `<div class="sec">${ico('fa-people-pulling')} Hoạt động văn hóa hôm nay</div><div class="cult one mb">${d.culture.map(a => `<div class="card cu ${a.log ? 'ok' : a.open ? 'open' : ''}"><div class="row"><b>${esc(a.name)}</b><span class="grow"></span>${pill({ the_duc: 'Thể dục', s5: '5S', van_hoa: 'Văn hóa' }[a.kind] || '', { the_duc: 'g', s5: 'b', van_hoa: 'v' }[a.kind] || 's')}</div>
    <div class="small muted">${ico('fa-clock')} ${esc(a.from_t)}–${esc(a.to_t)}${a.place ? ` · ${ico('fa-location-dot')} ${esc(a.place)}` : ''} · đến ${dmy(a.to_on)}</div>${a.note ? `<div class="small mt">${esc(a.note)}</div>` : ''}
    <div class="mt">${a.log ? pill(a.log.result === 'co_mat' ? `Đã điểm danh ${a.log.at || ''}` : a.log.result === 'vi_pham' ? 'Ghi vi phạm' : 'Vắng', a.log.result === 'co_mat' ? 'g' : 'r') : a.open ? `<button class="btn ok" data-cu="${a.id}">${ico('fa-hand')} Điểm danh</button>` : `<span class="small muted">${a.past ? 'Đã hết giờ điểm danh' : `Mở điểm danh lúc ${esc(a.from_t)}`}</span>`}</div></div>`).join('')}</div>` : `<div class="sec">${ico('fa-people-pulling')} Hoạt động hôm nay</div><div class="card small muted mb">Hôm nay không có hoạt động văn hóa, thể dục.</div>`}`;
  const out = !!T.in_t, done = !!T.out_t;   // done: đã chấm ra — đồng hồ dừng ở giờ ra, chỉ còn «Cập nhật giờ ra»
  main().innerHTML = `<div class="ph"><h1>${ico('fa-mobile-screen-button')} Chấm công & đơn từ</h1><p>Chấm công, xem công – phép – phiếu lương và gửi đơn từ của bạn. Đơn gửi từ đây chuyển về phòng HCNS xử lý.</p></div>
  <div class="cols even pcols"><div>
    <div class="card"><div class="hero"><span class="av">${esc(init)}</span><div><h2>${esc(E.name)}</h2><div class="meta"><span>${ico('fa-id-badge')}${esc(E.code)}</span><span>${ico('fa-briefcase')}${esc(E.title || '')}</span><span>${ico('fa-sitemap')}${esc(E.dept || '')}</span><span>${ico('fa-landmark')}${esc(E.legal || '')}</span></div></div></div>
      <div class="punch mt"><div>${done ? `<div class="small muted">Đã hoàn thành chấm công hôm nay</div><div class="clk">${esc(T.in_t || '—')} – ${esc(T.out_t)}</div>` : `<div class="clk" id="clk">${hm()}</div>`}<div class="muted">${['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'][new Date(T.day + 'T00:00:00Z').getUTCDay()]}, ${dmy(T.day)}</div>
        <div class="row mt small"><span>Vào: <b>${esc(T.in_t || '—')}</b></span><span>Ra: <b>${esc(T.out_t || '—')}</b></span>${T.mark ? `<span class="mk ${mkCls(T.mark)}" style="display:inline-block;padding:0 8px">${esc(T.mark)}</span>` : ''}</div></div>
        ${done ? `<div class="center"><button class="pbtn done" disabled>${ico('fa-circle-check')}<span>Đã chấm công ra</span></button><button class="btn sm mt" id="pb">${ico('fa-rotate')} Cập nhật giờ ra</button></div>`
          : `<button class="pbtn ${out ? 'out' : ''}" id="pb">${ico(out ? 'fa-right-from-bracket' : 'fa-fingerprint')}<span>${out ? 'Chấm công ra' : 'Chấm công vào'}</span></button>`}</div>
      <div class="small muted mt" id="gps">${ico('fa-location-dot')} Khi chấm công, app lấy vị trí để đối chiếu điểm chấm công của công ty.</div></div>
    ${cult}
    <div class="card"><div class="sec">${ico('fa-calendar-days')} Bảng chấm công tháng ${mmy(m)}</div><div class="stat3"><div><b>${fnum(mo.work)}<small> / ${mo.std}</small></b><span>Công đã có</span></div><div><b>${d.leave.left ?? '—'}</b><span>Phép còn lại ${d.leave.year}</span></div><div class="${pend ? 'a' : ''}"><b>${pend}</b><span>Đơn chờ duyệt</span></div></div>
      <div class="mdays">${cal}</div><div class="mleg">${mo.missing ? `<span class="warn">${ico('fa-triangle-exclamation')} ${mo.missing} ngày thiếu chấm (XI/XO) — làm «Phiếu giải trình công»</span>` : ''}${nKc ? `<span class="warn soft">${ico('fa-circle-info')} ${nKc} ngày «chưa có» công — chấm bù hoặc làm đơn nếu bạn có đi làm / nghỉ có phép</span>` : ''}<span><i class="mk HC">HC</i> đủ công</span><span><i class="mk P">P</i> phép</span><span><i class="mk X">XI/XO</i> thiếu chấm</span><span><i class="mk CT">CT</i> công tác</span>${mo.locked ? '<span>· Kỳ công đã khóa</span>' : ''}</div></div>
  </div><div>${matchMedia('(max-width: 760px)').matches ? '' : lichPage(T.day, mo.hol, E.dob)}${/* điện thoại: bỏ tờ lịch cho nhanh, gọn */ ''}${mealCard ? `<div class="pmeal">${mealCard}</div>` : ''}</div></div>
  <div class="sec">${ico('fa-file-pen')} Tạo đơn</div>
  <div class="acts mb">${Object.entries(C2.types).map(([k, t]) => `<button data-nt="${k}">${ico(M.ents[k]?.icon || 'fa-file')}<span>${esc(t.title)}</span><small>${esc(t.code)}${k === 'leave' ? ' · trưởng phòng duyệt' : ''}</small></button>`).join('')}</div>
  <div class="cols even"><div class="card"><div class="sec">${ico('fa-list-check')} Đơn của tôi</div><div class="reqs">${d.reqs.map(r => `<a href="/print/${r.type}/${r.id}" target="_blank" title="Bấm để in đơn theo mẫu"><i class="fa-solid ${r.icon}"></i><div><b>${esc(r.title)}</b><small>${esc(r.label || '')} · ${dmyhm(r.at)}</small></div>${pill(r.status_label, r.color)}</a>`).join('') || '<div class="empty" style="padding:14px">Chưa có đơn nào</div>'}</div></div>
    <div class="card"><div class="sec">${ico('fa-file-invoice-dollar')} Phiếu lương</div><div class="reqs">${d.payslips.map(s => `<a href="/print-payslip/${s.id}?emp=${d.emp.id}" target="_blank"><i class="fa-solid fa-money-bill-wave"></i><div><b>Tháng ${mmy(s.month)}</b><small>${esc(s.legal)} · ${s.pay_to === 'chuyen_khoan' ? 'chuyển khoản' : 'tiền mặt'}</small></div><b>${fm(s.net)} đ</b></a>`).join('') || '<div class="empty" style="padding:14px">Chưa có bảng lương đã duyệt</div>'}</div></div></div>
  <div class="card mt"><div class="row"><div class="sec" style="margin:0">${ico('fa-graduation-cap')} Khóa đào tạo của tôi</div><span class="grow"></span><button class="btn sm" data-trn="new">${ico('fa-plus')} Khai báo khóa học bên ngoài</button></div>
    <div class="reqs mt">${(d.trainings || []).map(t => `<div class="trn" data-trv="${t.id}" title="Bấm để xem chi tiết khóa học"><i class="fa-solid fa-graduation-cap"></i><div><b>${esc(t.name)}</b><small>${esc(t.code || '')} · ${dmy(t.from_on)}${t.to_on && t.to_on !== t.from_on ? ' – ' + dmy(t.to_on) : ''}${t.place ? ' · ' + esc(t.place) : ''}${t.trainer ? ' · ' + esc(t.trainer) : ''}</small>
      ${t.score || t.files.length ? `<small>${t.score ? esc(t.score) : ''}${t.files.map(f => ` <a href="/api/file/${f.id}?view=1" target="_blank" rel="noopener">${ico(/pdf/.test(f.mime || '') ? 'fa-file-pdf' : /image/.test(f.mime || '') ? 'fa-file-image' : 'fa-paperclip')} ${esc(f.name)}</a>`).join('')}</small>` : ''}</div>
      <div class="center">${t.result ? pill(t.result + (t.self ? ' · tự nộp' : ''), t.result === 'Đạt' ? 'g' : t.result === 'Vắng' ? 's' : 'r') : pill('Chưa có kết quả', 'a')}<button class="btn sm mt" data-trn="${t.id}">${ico('fa-upload')} ${t.self ? 'Nộp lại' : 'Nộp kết quả'}</button></div></div>`).join('') || '<div class="empty" style="padding:14px">Chưa có khóa đào tạo nào. Đi học bên ngoài → bấm «Khai báo khóa học bên ngoài» để nộp kết quả, chứng chỉ.</div>'}</div></div>`;
  clearInterval(portalScreen.tk); const tk = portalScreen.tk = setInterval(() => { const c = $('#clk'); if (!c) return clearInterval(tk); c.textContent = hm(); }, 1000);   // tải lại màn hình không chồng thêm đồng hồ
  $('#pb').onclick = run(async () => {
    if (done && !await ask('Cập nhật giờ ra', `Đã chấm ra lúc ${esc(T.out_t)}. Ghi lại giờ ra thành bây giờ (${hm().slice(0, 5)})?`, { ok: 'Cập nhật' })) return;
    const b = $('#pb'); b.disabled = true; $('#gps').textContent = 'Đang lấy vị trí…';
    const pos = await new Promise(ok => navigator.geolocation ? navigator.geolocation.getCurrentPosition(p => ok(p.coords), () => ok(null), { timeout: 6000, enableHighAccuracy: true }) : ok(null));
    try { const r = await api('POST', '/api/portal/punch', pos ? { lat: pos.latitude, lng: pos.longitude } : {}); toast(r.err?.length ? r.err[0] : r.outside?.length ? 'Đã chấm công — vị trí ngoài điểm chấm công, HCNS sẽ kiểm tra' : r.skip ? 'Ngày này đã có đơn được duyệt, giữ nguyên bảng công' : `Đã chấm công ${out ? 'ra' : 'vào'} lúc ${hm().slice(0, 5)}`, !!r.err?.length); refresh(); }
    finally { b.disabled = false; }
  });
  $$('[data-nt]', main()).forEach(b => b.onclick = () => portalForm(b.dataset.nt, C2));
  $$('[data-mpaid]', main()).forEach(b => b.onclick = run(async () => {
    if (!await ask('Xác nhận đã thanh toán', 'Bạn đã chuyển khoản đủ tiền ăn tháng này? Phòng HCNS sẽ thấy tên bạn kèm ngày giờ trả trong phiếu thu.', { ok: 'Đã thanh toán' })) return;
    const r = await api('POST', `/api/portal/meal-paid/${b.dataset.mpaid}`, {}); toast(`Đã ghi nhận thanh toán lúc ${dmyhm(r.paid_at)}`); refresh();
  }));
  $$('[data-cu]', main()).forEach(b => b.onclick = run(async () => { const r = await api('POST', `/api/portal/culture/${b.dataset.cu}`, {}); toast(`Đã điểm danh lúc ${r.at}`); refresh(); }));
  $$('[data-trn]', main()).forEach(b => b.onclick = ev => { ev.stopPropagation(); trainSelfForm(b.dataset.trn === 'new' ? null : (d.trainings || []).find(t => String(t.id) === b.dataset.trn)); });
  $$('[data-trv]', main()).forEach(x => x.onclick = ev => { if (ev.target.closest('a')) return; myTraining((d.trainings || []).find(t => String(t.id) === x.dataset.trv)); });
  portalScreen.data = d;
}
// lịch sử làm việc của 1 người (HD13): trước khi vào công ty (bảng từ CV) + tại công ty theo chặng pháp nhân / phòng / chức danh, bấm căn cứ để mở HĐ / QĐ
async function empHistory(id) {
  const h = await api('GET', `/api/emp-history/${id}`), E = h.emp, mo = s => { const x = String(s || '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(x) ? dmy(x) : esc(x); };
  const len = (a, b) => { if (!a) return ''; const d = (Date.parse(b || M.today) - Date.parse(a)) / 864e5 + 1, y = Math.floor(d / 365.25), m = Math.floor((d - y * 365.25) / 30.44); return [y && `${y} năm`, m && `${m} tháng`].filter(Boolean).join(' ') || `${Math.max(1, Math.round(d))} ngày`; };
  const pri = h.prior.length ? `<div class="tw"><table class="t"><thead><tr><th>#</th><th>Từ</th><th>Đến</th><th>Công ty / đơn vị</th><th>Chức danh / công việc</th></tr></thead><tbody>${h.prior.map((j, i) => `<tr><td>${i + 1}</td><td class="nowrap">${mo(j.from)}</td><td class="nowrap">${mo(j.to)}</td><td><b>${esc(j.company)}</b></td><td>${esc(j.title || '')}</td></tr>`).join('')}</tbody></table></div>`
    : h.exp ? `<div class="card small" style="white-space:pre-line">${esc(h.exp)}</div><p class="small muted">Chưa tách thành bảng — mở hồ sơ NV, điền «Quá trình công tác trước khi vào công ty» (hoặc dùng «Nhập từ CV (AI)» ở hồ sơ ứng viên).</p>` : '<p class="small muted">Chưa có thông tin từ CV — điền «Quá trình công tác trước khi vào công ty» trong hồ sơ nhân sự.</p>';
  const ins = h.stints.length ? `<div class="tw"><table class="t"><thead><tr><th>Từ ngày</th><th>Đến ngày</th><th>Thời gian</th><th>Pháp nhân</th><th>Phòng ban</th><th>Chức danh</th><th>Căn cứ</th></tr></thead><tbody>${h.stints.map(s => `<tr><td class="nowrap">${dmy(s.from)}</td><td class="nowrap">${s.to ? dmy(s.to) : '<b>nay</b>'}</td><td class="nowrap muted">${len(s.from, s.to)}</td><td>${esc(s.legal)}</td><td>${esc(s.dept)}</td><td><b>${esc(s.title)}</b></td><td>${s.docs.map(x => `<a href="#" data-hx="${x.ent}:${x.id}" class="nowrap" style="display:block">${esc(x.src)}</a>`).join('') || '<span class="muted">Ngày vào làm</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">Chưa có dữ liệu hợp đồng / quyết định.</p>';
  const m = modal({ title: `${ico('fa-clock-rotate-left')} Lịch sử làm việc · ${esc(E.name)} <span class="tag">${esc(E.code)}</span>`, cls: 'wide', body: `<p class="muted">Vào làm ${dmy(E.join_on)}${E.leave_on ? ` · nghỉ việc ${dmy(E.leave_on)}` : ''} · thâm niên ${len(E.join_on, E.leave_on)}</p>
    <div class="sec">${ico('fa-building')} Trước khi vào công ty <span class="small muted" style="font-weight:400">— theo CV${h.cand ? ' ứng viên ' + esc(h.cand.code) : ''}</span></div>${pri}
    <div class="sec mt">${ico('fa-sitemap')} Tại công ty <span class="small muted" style="font-weight:400">— theo hợp đồng, quyết định, thuyên chuyển trên app</span></div>${ins}${h.exp_ct ? `<p class="small mt"><b>Ghi chú kinh nghiệm tại công ty:</b> ${esc(h.exp_ct)}</p>` : ''}`,
    foot: `<button class="btn" data-x>Đóng</button><button class="btn" id="hxe">${ico('fa-user')} Mở hồ sơ nhân sự</button>` });
  $$('[data-hx]', m.el).forEach(a => a.onclick = run(async ev => { ev.preventDefault(); const [en, rid] = a.dataset.hx.split(':'); await openDetail(en, +rid); }));
  $('#hxe', m.el).onclick = run(async () => { m.close(); await openDetail('employee', E.id); });
}
// hộp thông tin khóa học của học viên: mở từ thông báo (#/v/portal/trn<id>) hoặc bấm vào khóa trong «Khóa đào tạo của tôi»
function myTraining(t) {
  if (!t) return toast('Không tìm thấy khóa học — có thể bạn không còn trong danh sách học viên, hoặc khóa đã quá 12 tháng', 'err');
  const row = (l, v) => v ? `<div class="fld"><label>${l}</label><div><b>${v}</b></div></div>` : '';
  const place = t.place ? (/^https?:\/\//i.test(t.place) ? `<a href="${esc(t.place)}" target="_blank" rel="noopener">${esc(t.place)}</a>` : esc(t.place)) : '';
  const sc = (t.sched || []).filter(x => x.day || x.topic);
  const body = `<div class="row mb">${pill(t.state_l || t.state, { ke_hoach: 'b', dang_dt: 'a', hoan_thanh: 'g' }[t.state] || 's')}${t.kind ? pill(t.kind, 'v') : ''}<span class="grow"></span><span class="muted small">${esc(t.code || '')}</span></div>
    <div class="fg">${row('Thời gian', `${dmy(t.from_on)}${t.to_on && t.to_on !== t.from_on ? ' – ' + dmy(t.to_on) : ''}`)}${row('Số buổi / tổng giờ', `${t.sessions || 1} buổi · ${fnum(t.hours || 0)} giờ`)}${row('Hình thức', esc(t.mode))}${row('Địa điểm / link học', place)}${row('Giảng viên / đơn vị đào tạo', esc(t.trainer || ''))}${row('Số học viên', t.n_emps ? `${t.n_emps} người` : '')}</div>
    ${sc.length ? `<div class="sec mt">${ico('fa-calendar-days')} Lịch học</div><div class="tw"><table class="t"><thead><tr><th>#</th><th>Ngày</th><th>Giờ</th><th class="n">Số giờ</th><th>Nội dung</th></tr></thead><tbody>${sc.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.day || '')}</td><td>${esc(x.from_t || '')}${x.to_t ? '–' + esc(x.to_t) : ''}</td><td class="n">${esc(String(x.hours ?? ''))}</td><td>${esc(x.topic || '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="sec mt">${ico('fa-award')} Kết quả của tôi</div><div class="row">${t.result ? pill(t.result + (t.self ? ` · tự nộp ${t.self}` : ''), t.result === 'Đạt' ? 'g' : t.result === 'Vắng' ? 's' : 'r') : pill('Chưa có kết quả', 'a')}${t.score ? `<span>${esc(t.score)}</span>` : ''}</div>
    ${t.files.length ? `<div class="small mt">${t.files.map(f => `<a href="/api/file/${f.id}?view=1" target="_blank" rel="noopener" style="margin-right:12px">${ico(/pdf/.test(f.mime || '') ? 'fa-file-pdf' : /image/.test(f.mime || '') ? 'fa-file-image' : 'fa-paperclip')} ${esc(f.name)}</a>`).join('')}</div>` : ''}
    ${t.note ? `<p class="small muted mt">${esc(t.note)}</p>` : ''}`;
  const m = modal({ title: `${ico('fa-graduation-cap')} ${esc(t.name)}`, body, foot: `<button class="btn" data-x>Đóng</button><button class="btn pri" id="trup">${ico('fa-upload')} ${t.self ? 'Nộp lại kết quả' : 'Nộp kết quả'}</button>` });
  $('#trup', m.el).onclick = () => { m.close(); trainSelfForm(t); };
}
// học viên tự nộp kết quả đào tạo: khóa có sẵn (HCNS lập) hoặc khóa học bên ngoài tự khai
function trainSelfForm(t) {
  const fld = (k, l, h, full) => `<div class="fld ${full ? 'full' : ''}" data-f="${k}"><label>${l}</label>${h}</div>`;
  const body = `${t ? `<p><b>${esc(t.name)}</b><br><span class="muted small">${esc(t.code || '')} · ${dmy(t.from_on)}${t.to_on && t.to_on !== t.from_on ? ' – ' + dmy(t.to_on) : ''}</span></p>` : '<p class="muted small">Khóa học do bạn tự đi học ở đơn vị ngoài. App lập hồ sơ khóa học, phòng HCNS nhận thông báo để xác nhận.</p>'}
    <div class="fg">${t ? '' : fld('name', 'Tên khóa học <span class="req">*</span>', '<input name="name">', 1) + fld('trainer', 'Đơn vị / giảng viên đào tạo', '<input name="trainer">') + fld('place', 'Địa điểm / link học', '<input name="place">')
      + fld('from_on', 'Từ ngày <span class="req">*</span>', `<input type="date" name="from_on" value="${M.today}">`) + fld('to_on', 'Đến ngày', '<input type="date" name="to_on">') + fld('sessions', 'Số buổi', '<input type="number" name="sessions" min="1" value="1">') + fld('hours', 'Tổng số giờ <span class="req">*</span>', '<input type="number" name="hours" step="0.5" min="0.5">')
      + fld('mode', 'Hình thức', '<select name="mode"><option value="truc_tiep">Trực tiếp</option><option value="online">Trực tuyến (online)</option><option value="ket_hop">Kết hợp</option></select>')}
      ${fld('result', 'Kết quả <span class="req">*</span>', `<select name="result"><option value="Đạt" ${t?.result !== 'Chưa đạt' ? 'selected' : ''}>Đạt</option><option value="Chưa đạt" ${t?.result === 'Chưa đạt' ? 'selected' : ''}>Chưa đạt</option></select>`)}
      ${fld('score', 'Điểm / xếp loại / nhận xét', `<input name="score" value="${esc(t?.score || '')}" placeholder="VD: 8.5 · Giỏi">`)}
      ${fld('f', 'File kết quả / chứng chỉ (PDF, ảnh, Word…)', '<input type="file" name="f" multiple>', 1)}</div>`;
  const m = modal({ title: `${ico('fa-graduation-cap')} ${t ? 'Nộp kết quả đào tạo' : 'Khai báo khóa học bên ngoài'}`, body, foot: `<button class="btn" data-x>Hủy</button><button class="btn pri" id="go">${ico('fa-upload')} Nộp kết quả</button>` });
  $('#go', m.el).onclick = run(async () => {
    const fd = new FormData();
    for (const i of $$('[name]', m.el)) { if (i.type === 'file') [...i.files].forEach(f => fd.append('f', f)); else if (i.value.trim() !== '') fd.append(i.name, i.value.trim()); }
    await api('POST', `/api/portal/training/${t ? t.id : 'new'}`, fd); m.close(); toast('Đã nộp kết quả — phòng HCNS đã nhận thông báo'); refresh();
  });
}
// form đơn dựng từ danh mục của cổng nhận (cùng danh sách trường nền tảng dùng)
function portalForm(type, C2) {
  const t = C2.types[type], val = f => ['from_on', 'day', 'req_on', 'send_on', 'reg_on', 'made_on', 'used_on'].includes(f.k) ? M.today : f.k === 'month' ? curM() : '';
  const one = f => {
    const n = `name="${f.k}"`;
    if (f.k === 'type_code') return `<select ${n}>${C2.leave_types.map(x => `<option value="${esc(x.code)}" ${x.code === 'P' ? 'selected' : ''}>${esc(x.code)} · ${esc(x.name)}</option>`).join('')}</select>`;
    if (f.k === 'room_code') return `<select ${n}><option value="">— chọn phòng —</option>${C2.rooms.map(x => `<option value="${esc(x.code)}">${esc(x.name)}${x.seats ? ` (${x.seats} chỗ)` : ''}</option>`).join('')}</select>`;
    if (f.k === 'vehicle_code') return `<select ${n}><option value="">— chọn xe —</option>${C2.vehicles.map(x => `<option value="${esc(x.code)}">${esc(x.plate)} · ${esc(x.brand || '')}</option>`).join('')}</select>`;
    if (f.k === 'lines') return `<div data-lines>${[0, 1, 2].map(() => `<div class="row mb"><select data-li class="grow"><option value="">— văn phòng phẩm —</option>${C2.vpp_items.map(x => `<option value="${esc(x.code)}">${esc(x.code)} · ${esc(x.name)} (${esc(x.unit || '')})</option>`).join('')}</select><input data-lq type="number" min="1" placeholder="SL" style="width:90px"></div>`).join('')}</div>`;
    if (f.type === 'days') return `<div class="days">${Array.from({ length: 31 }, (_, i) => `<label><input type="checkbox" data-day value="${i + 1}">${i + 1}</label>`).join('')}</div><button type="button" class="btn sm mt" data-wd>Chọn T2–T7 trong tháng</button>`;
    if (f.options) return `<select ${n}>${f.required ? '' : '<option value="">—</option>'}${f.options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>`;
    return { long: `<textarea ${n}></textarea>`, date: `<input type="date" ${n} value="${val(f)}">`, dt: `<input type="datetime-local" ${n}>`, month: `<input type="month" ${n} value="${val(f)}">`, bool: `<label class="row" style="margin-top:8px"><input type="checkbox" ${n}> Có</label>`, num: `<input type="number" step="0.5" ${n}>`, int: `<input type="number" ${n}>` }[f.type]
      || `<input ${n} ${f.k === 'cover_code' ? 'placeholder="Mã NV, vd NV044"' : f.k.endsWith('_t') || f.k === 'time' ? 'placeholder="08:00"' : ''}>`;
  };
  const fs_ = t.fields.filter(f => !(type === 'leave' && f.k === 'days'));
  const m = modal({ title: `${esc(t.title)} <span class="tag">${esc(t.code)}</span>`, body: `${type === 'leave' ? '<p class="muted">Số ngày nghỉ app tự tính theo ngày làm việc. Đơn được chuyển trưởng bộ phận / HCNS duyệt.</p>' : ''}<div class="fg">${fs_.map(f => `<div class="fld ${['long', 'json', 'days'].includes(f.type) || f.k === 'lines' ? 'full' : ''}" data-f="${f.k}"><label>${esc(f.label)}${f.required ? '<span class="req"> *</span>' : ''}</label>${one(f)}</div>`).join('')}</div>`,
    foot: `<button class="btn" data-x>Hủy</button><button class="btn pri" id="go">${ico('fa-paper-plane')} Gửi đơn</button>` });
  const w = $('[data-wd]', m.el); if (w) w.onclick = () => { const mm = $('[name=month]', m.el)?.value || curM(); $$('[data-day]', m.el).forEach(c => { const dt = new Date(+mm.slice(0, 4), +mm.slice(5, 7) - 1, +c.value), dw = dt.getDay(); c.checked = dt.getMonth() === +mm.slice(5, 7) - 1 && dw > 0; }); };
  $('#go', m.el).onclick = run(async () => {
    const data = {};
    for (const f of fs_) {
      if (f.k === 'lines') { data.lines = $$('[data-lines] .row', m.el).map(r => ({ code: $('[data-li]', r).value, qty: $('[data-lq]', r).value })).filter(x => x.code && +x.qty > 0); continue; }
      if (f.type === 'days') { data[f.k] = $$('[data-day]:checked', m.el).map(c => +c.value); continue; }
      const i = $(`[name="${f.k}"]`, m.el); if (!i) continue;
      const v = f.type === 'bool' ? i.checked : i.value.trim(); if (v === '' || v === false) continue;
      data[f.k] = f.type === 'dt' ? v + ':00+07:00' : v;
    }
    $$('.fld.err', m.el).forEach(x => x.classList.remove('err'));
    try { const r = await api('POST', '/api/portal/request/' + type, { data }); m.close(); toast(`Đã gửi ${t.title.toLowerCase()} ${r.code || ''} — ${r.status_label || 'đã ghi nhận'}`); refresh(); }
    catch (er) { (er.fields || []).forEach(k => $(`[data-f="${k}"]`, m.el)?.classList.add('err')); throw er; }
  });
}

// ---------- danh sách ----------
async function listScreen(ent, openId) {
  const e = M.ents[ent], st = (listScreen.s[ent] ||= { q: '', f: (e.filters || []).includes('month') ? { month: curM() } : {} });
  const qp = new URLSearchParams({ q: st.q, ...Object.fromEntries(Object.entries(st.f).filter(([, v]) => v).map(([k, v]) => k === 'status' ? [k, v] : ['f_' + k, v])) });
  // pháp nhân chọn trên thanh trên cùng: chỉ lọc phiếu nhân sự; phiếu hành chính (e.mod: VPP, xe, phòng họp…) xem chung mọi pháp nhân, pháp nhân chỉ tự điền
  if (F.legal && !e.mod && e.fields.some(f => f.k === 'legal_id' && !f.auto) && !st.f.legal_id) qp.set('f_legal_id', F.legal);
  // chứng từ / đơn từ: lọc năm → tháng theo ngày của phiếu (mặc định năm nay), như Bravo
  const dk = (e.filters || []).includes('month') ? null : e.cal || ['day', 'from_on', 'req_on', 'reg_on', 'made_on', 'send_on', 'in_on', 'issue_on', 'pay_on', 'got_on', 'start_at', 'count_on', 'at'].find(k => e.fields.some(f => f.k === k)) || (e.flow ? 'created_at' : null);
  // từ ngày → đến ngày: có khoảng ngày thì bỏ lọc năm / tháng (tránh hai bộ lọc chồng nhau ra rỗng)
  const dr = dk || ((e.filters || []).includes('month') ? 'month' : 'created_at'), rng = !e.noRange && (st.df || st.dt);
  if (ent === 'meal_reg' && st.f.pay_st === 'da_tt') qp.set('sort', '-paid_at');   /* đã thanh toán: người nộp tiền gần nhất lên đầu */
  if (rng) { qp.set('dr', dr); if (st.df) qp.set('df', st.df); if (st.dt) qp.set('dt', st.dt); qp.delete('f_month'); }
  if (dk) { st.y ??= M.today.slice(0, 4); qp.set('dk', dk); if (st.y && !rng) qp.set('y', st.y); if (st.y && st.mo && !rng) qp.set('mo', st.mo); }
  // mục dạng lịch (phỏng vấn, phòng họp, xe, sự kiện…): mặc định xem lịch tháng — lấy mọi phiếu trong tháng đang xem, bỏ lọc năm / khoảng ngày
  const calOn = e.cal && (st.view || 'cal') === 'cal';
  if (calOn) { st.cm ||= M.today.slice(0, 7); const [cy, cmo] = st.cm.split('-').map(Number); ['y', 'mo', 'f_month', 'df', 'dt'].forEach(k => qp.delete(k)); qp.set('dr', e.cal); qp.set('df', new Date(Date.UTC(cy, cmo - 1, 1) - 62 * 864e5).toISOString().slice(0, 10));   /* lùi 2 tháng: bắt cả đơn nghỉ / công tác bắt đầu từ tháng trước kéo sang; calView chỉ vẽ ngày thuộc tháng đang xem */ qp.set('dt', new Date(Date.UTC(cy, cmo, 0)).toISOString().slice(0, 10)); qp.set('limit', 1000); }
  // hồ sơ nhân sự: chưa gõ tìm / chưa lọc thì không hiện ai (tránh lộ thông tin), gõ tên → gợi ý
  const hide = ent === 'employee' && !st.q.trim() && !rng && !Object.values(st.f).some(Boolean); if (hide) qp.set('limit', 1);
  const d = await api('GET', `/api/e/${ent}?${qp}`); if (hide) d.rows = [];
  // cột «Tài liệu»: mỗi tệp một biểu tượng, bấm mở xem (PDF / ảnh xem ngay, Word tải về) — không mở chi tiết dòng
  const fileIcons = fs => (fs || []).map(f => `<a class="fic" href="/api/file/${f.id}?view=1" target="_blank" rel="noopener" data-nf title="${esc(f.kind ? f.kind + ': ' : '')}${esc(f.name)}">${ico(/pdf/.test(f.mime || '') ? 'fa-file-pdf' : /image/.test(f.mime || '') ? 'fa-file-image' : /word|docx?$/.test(f.mime || f.name) ? 'fa-file-word' : /sheet|excel|xlsx?$/.test(f.mime || f.name) ? 'fa-file-excel' : 'fa-paperclip')}</a>`).join('');
  // hợp đồng: dòng báo đầu trang số HĐ quá hạn / sắp hết hạn (≤ 30 ngày), bấm để xem danh sách
  const hdA = ent === 'contract' ? (await api('GET', '/api/alerts').catch(() => [])).filter(a => a.grp === 'HĐLĐ' && !a.done && ['qua_han', 'sap_den_han'].includes(a.level)) : [];
  const hdN = l => hdA.filter(a => a.level === l).length;
  // phiếu thu tiền ăn: tự tạo khi người ăn bấm «Đã thanh toán» → đầu trang cho biết tháng này đã gửi tiền ăn chưa, ai đã trả / còn chờ
  const mrg = ent === 'meal_in' && M.ents.meal_reg?.perm.r ? (await api('GET', `/api/e/meal_reg?${new URLSearchParams({ f_month: st.f.month || curM(), limit: 1000 })}`).catch(() => ({ rows: [] }))).rows : null;
  const mBar = mrg ? (() => { const reg = mrg.filter(r => +r.n_days > 0), cho = reg.filter(r => r.pay_st === 'cho_tt'), da = reg.filter(r => r.pay_st === 'da_tt'), sum = xs => fm(xs.reduce((s, r) => s + (+r.amount || 0), 0));
    return `<div class="banner ${cho.length || !(cho.length + da.length) ? '' : 'ok'}">${ico('fa-circle-info')} <span>Phiếu thu <b>tự tạo</b> khi người ăn bấm «Đã thanh toán» trên thông báo tiền ăn — không cần nhập tay (chỉ «Tạo mới» khi thu tiền mặt). Tháng ${mmy(st.f.month || curM())}: ${!(cho.length + da.length) ? `<b>chưa gửi tiền ăn</b> cho ${reg.length} người đăng ký — vào <a href="#/e/meal_reg">Đăng ký suất ăn tháng</a> bấm «Tổng hợp & gửi tiền ăn».` : `<b>${da.length}</b> người đã trả (${sum(da)} đ) · <b>${cho.length}</b> người chờ thanh toán (${sum(cho)} đ)${cho.length ? `: ${cho.slice(0, 8).map(r => esc(String(r.emp_id__l || '').split(' · ').pop())).join(', ')}${cho.length > 8 ? '…' : ''}` : ''}.`}</span></div>`; })() : '';
  const hdBar = hdA.length ? `<div class="banner hdw">${ico('fa-triangle-exclamation')} <span>${[hdN('qua_han') && `<a href="#" data-hdw="qua_han"><b>${hdN('qua_han')}</b> hợp đồng đã quá hạn</a>`, hdN('sap_den_han') && `<a href="#" data-hdw="sap_den_han"><b>${hdN('sap_den_han')}</b> hợp đồng sắp hết hạn (≤ 30 ngày)</a>`].filter(Boolean).join(' · ')} — cần xử lý</span></div>` : '';
  const sf = e.fields.find(f => f.k === 'status' && f.t === 'sel'), cols = [...(e.flow && !e.noHandler && !e.list.includes('_handler') ? [...e.list, '_handler'] : e.list), ...(e.files?.length ? ['_files'] : [])];   // noHandler: chỉ HCNS duyệt → không cần cột «Người đang xử lý»; _files: tài liệu đính kèm, bấm mở xem ngay
  const ys = Array.from({ length: 4 }, (_, i) => String(+M.today.slice(0, 4) - i));
  const vw = e.cal ? `<div><label>Xem</label><div class="vsw"><button class="${calOn ? 'on' : ''}" data-vw="cal">${ico('fa-calendar-days')} Lịch</button><button class="${calOn ? '' : 'on'}" data-vw="list">${ico('fa-list')} Danh sách</button></div></div>` : '';
  const ym = calOn ? vw : vw + (dk ? `<div><label>Năm</label><select id="fy" ${rng ? 'disabled title="Đang tìm theo khoảng ngày"' : ''}>${opt(ys.map(y => [y, y]), st.y, 'Mọi năm')}</select></div><div><label>Tháng</label><select id="fmo" ${st.y && !rng ? '' : 'disabled'}>${opt(Array.from({ length: 12 }, (_, i) => [String(i + 1), 'Tháng ' + (i + 1)]), st.mo, 'Cả năm')}</select></div>` : '')
    + (e.noRange ? '' : `<div class="drng"><label>Từ ngày${dr === 'created_at' ? ' (ngày tạo)' : ''}</label><input type="date" id="fdf" value="${esc(st.df || '')}" max="${esc(st.dt || '')}"></div><div class="drng"><label>Đến ngày</label><input type="date" id="fdt" value="${esc(st.dt || '')}" min="${esc(st.df || '')}"></div>${rng ? `<div class="drng"><label>&nbsp;</label><button class="btn" id="fdx" title="Bỏ lọc khoảng ngày">${ico('fa-xmark')}</button></div>` : ''}`);
  const tabs = sf && d.counts ? `<div class="stabs"><button data-st="" class="${st.f.status ? '' : 'on'}">Tất cả<b>${Object.values(d.counts).reduce((a, b) => a + +b, 0)}</b></button>${sf.o.filter(o => d.counts[o[0]]).map(o => `<button data-st="${o[0]}" class="${st.f.status === o[0] ? 'on' : ''}">${esc(o[1])}<b>${d.counts[o[0]]}</b></button>`).join('')}</div>` : '';
  const fl = ym + (e.filters || []).filter(k => !(k === 'status' && tabs)).map(k => { const f = e.fields.find(x => x.k === k); if (f?.t === 'month') return `<div><label>${esc(f.l)}</label><input type="month" data-fk="${k}" value="${esc(st.f[k] || '')}"></div>`; if (!f || f.t === 'int') return ''; const o = k === 'legal_id' ? M.legals.map(l => [l.id, l.short]) : k === 'dept_id' ? M.depts.map(x => [x.id, x.name]) : (f.fo || f.o) ? (f.fo || f.o).map(x => [x[0], x[1]]) : null; return o ? `<div><label>${esc(f.l)}</label><select data-fk="${k}">${opt(o, st.f[k])}</select></div>` : ''; }).join('');
  // đơn từ có duyệt (như Bravo): chưa lọc trạng thái thì gom nhóm Chưa duyệt / Đã duyệt / Từ chối, bấm tiêu đề nhóm để thu gọn
  const row = r => `<tr class="c" data-id="${r.id}">${cols.map(k => `<td class="${isNum(e, k) ? 'n' : ''}">${k === '_handler' ? esc(r._handler || '') : k === '_files' ? fileIcons(r._files) : cell(e, k, r)}</td>`).join('')}</tr>`;
  const pend = r => ['nhap', 'cho_duyet'].includes(r.status), rej = r => ['tu_choi', 'huy'].includes(r.status);
  const GS = [['cho', 'Chưa duyệt', 'fa-hourglass-half', pend], ['ok', 'Đã duyệt', 'fa-circle-check', r => !pend(r) && !rej(r)], ['tc', 'Từ chối / hủy', 'fa-ban', rej]];
  const grp = e.flow && sf && !st.f.status && d.rows.length ? GS.map(([g, l, ic, t]) => [g, l, ic, d.rows.filter(t)]).filter(x => x[3].length) : null;
  const p = e.perm, wk = ent === 'meal_day' ? await api('GET', `/api/meal-week?${new URLSearchParams({ start: listScreen.wk || M.today, legal: '' })   /* cả công ty ăn chung một bếp */}`) : null;
  main().innerHTML = `<div class="ph"><h1>${ico(e.icon)} ${esc(e.title)} <span class="tag">${esc(e.code || '')}</span></h1><p>${d.total} ${esc(e.one)}${e.help ? ' · ' + esc(e.help) : ''}</p></div>
  ${wk ? mealWeek(wk) : ''}${hdBar}${mBar}
  <div class="card filters"><div><label>Tìm kiếm</label><input id="q" value="${esc(st.q)}" placeholder="${ent === 'employee' ? 'Gõ tên hoặc mã nhân viên…' : ent === 'training' ? 'Gõ tên khóa đào tạo…' : 'Gõ để tìm…'}"></div>${fl}<span class="grow"></span>
  ${(ent === 'vpp_req' || ent === 'vpp_in') && M.ents.vpp_in.perm.c ? `<button class="btn" id="buy">${ico('fa-cart-plus')} Tạo phiếu nhập từ nhu cầu</button>` : ''}${(r => r && JSON.stringify(M.menu).includes(`"r:${r}"`) ? `<a class="btn" href="#/r/${encodeURIComponent(r)}">${ico('fa-calendar')} Tổng hợp theo năm</a>` : '')({ ins_sheet: 'BH-02', cd_sheet: 'CĐ-02' }[ent])}${ent === 'gov_report' ? `<button class="btn" id="tpl">${ico('fa-download')} Mẫu báo cáo</button>` : ''}${ent === 'meal_reg' && p.c && p.d ? `<button class="btn" id="mcp">${ico('fa-copy')} Tạo từ tháng trước</button><button class="btn ok" id="mbill">${ico('fa-paper-plane')} Tổng hợp & gửi tiền ăn</button>` : ''}
  ${p.x ? `<a class="btn" href="/api/e/${ent}/export">${ico('fa-file-excel')} Xuất Excel</a>` : ''}${e.imp && p.c ? `<label class="btn">${ico('fa-file-import')} Nhập Excel<input type="file" id="imp" accept=".xlsx" hidden></label>` : ''}${ent === 'att_auto' && p.c ? `<button class="btn ok" id="alv">${ico('fa-umbrella-beach')} Tạo ngày nghỉ phép</button>` : ''}${p.c ? `<button class="btn pri" id="add">${ico('fa-plus')} Tạo mới</button>` : ''}</div>
  ${tabs}${calOn ? calView(e, d.rows, st.cm, sf) : `<div class="tw"><table class="t"><thead><tr>${cols.map(k => `<th class="${isNum(e, k) ? 'n' : ''}">${esc(colL(e, k))}</th>`).join('')}</tr></thead><tbody>${(grp ? grp.map(([g, l, ic, xs]) => `<tr class="grp ${g}" data-g="${g}"><td colspan="${cols.length}">${ico(st.gc?.[g] ? 'fa-chevron-right' : 'fa-chevron-down')} ${ico(ic)} ${l} <b>${xs.length}</b></td></tr>${st.gc?.[g] ? '' : xs.map(row).join('')}`).join('') : d.rows.map(row).join('')) || `<tr><td colspan="${cols.length}" class="empty">${hide ? `${ico('fa-magnifying-glass')} Gõ tên hoặc mã nhân viên vào ô tìm kiếm để xem hồ sơ` : 'Chưa có dữ liệu'}</td></tr>`}</tbody></table></div>`}`;
  $$('[data-vw]', main()).forEach(b => b.onclick = () => { st.view = b.dataset.vw; refresh(); });
  $$('[data-cm]', main()).forEach(b => b.onclick = () => { st.cm = b.dataset.cm; refresh(); });
  $$('[data-ce]', main()).forEach(a => a.onclick = run(ev => { ev.stopPropagation(); return openDetail(ent, +a.dataset.ce); }));
  if (e.perm.c) $$('[data-cd]', main()).forEach(c => c.ondblclick = run(() => openForm(ent, null, { [e.cal]: e.fields.find(f => f.k === e.cal)?.t === 'dt' ? `${c.dataset.cd}T08:00` : c.dataset.cd })));
  if ($('#alv')) $('#alv').onclick = run(autoLeaveWizard);
  $$('[data-nf]', main()).forEach(a => a.onclick = ev => ev.stopPropagation());   // bấm biểu tượng tệp: chỉ mở tệp
  $$('tr[data-id]', main()).forEach(t => t.onclick = run(() => openDetail(ent, +t.dataset.id)));
  $$('tr[data-g]', main()).forEach(t => t.onclick = () => { st.gc = { ...st.gc, [t.dataset.g]: !st.gc?.[t.dataset.g] }; refresh(); });
  $$('[data-hdw]', main()).forEach(a => a.onclick = ev => { ev.preventDefault(); alertModal(`${ico('fa-file-contract')} ${LV[a.dataset.hdw][0]}`, hdA.filter(x => x.level === a.dataset.hdw)); });
  $$('[data-st]', main()).forEach(b => b.onclick = () => { st.f.status = b.dataset.st; refresh(); });
  if ($('#fy')) { $('#fy').onchange = ev => { st.y = ev.target.value; st.mo = ''; refresh(); }; $('#fmo').onchange = ev => { st.mo = ev.target.value; refresh(); }; }
  if ($('#fdf')) { $('#fdf').onchange = ev => { st.df = ev.target.value; refresh(); }; $('#fdt').onchange = ev => { st.dt = ev.target.value; refresh(); }; }   // chế độ lịch tháng không có ô khoảng ngày
  if ($('#fdx')) $('#fdx').onclick = () => { st.df = st.dt = ''; refresh(); };
  let dq; $('#q').oninput = ev => { clearTimeout(dq); dq = setTimeout(async () => { st.q = ev.target.value; await refresh(); const i = $('#q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 300); };
  $$('[data-fk]', main()).forEach(s => s.onchange = () => { st.f[s.dataset.fk] = s.value; refresh(); });
  if ($('#add')) $('#add').onclick = run(() => openForm(ent));
  if ($('#imp')) $('#imp').onchange = run(async ev => { const fd = new FormData(); fd.append('f', ev.target.files[0]); const r = await api('POST', '/api/import/' + ent, fd); toast(`Thêm ${r.ok}, cập nhật ${r.upd}${r.err.length ? `, lỗi ${r.err.length}: ${r.err[0]}` : ''}`, !!r.err.length); delete OPT[ent]; refresh(); });
  if ($('#buy')) $('#buy').onclick = run(async () => { const l = F.legal || M.legals[0].id, x = await api('POST', '/api/vpp/buy', { legal_id: l }); refresh(); openDetail('vpp_in', x.row.id); });
  if ($('#tpl')) $('#tpl').onclick = run(async () => { const fs_ = await api('GET', '/api/gov-files'); modal({ title: 'Mẫu báo cáo lao động định kỳ', body: fs_.map(f => `<div class="mb"><a href="/api/gov/${encodeURIComponent(f)}">${ico('fa-download')} ${esc(f)}</a></div>`).join('') + '<p class="muted">Số lao động, lao động nữ lấy tại báo cáo PLI.</p>' }); });
  // cuối tháng: tính tiền ăn từng người (ngày đăng ký × đơn giá từng ngày), báo từng người kèm mã QR; người đã thanh toán giữ nguyên
  if ($('#mbill')) $('#mbill').onclick = run(async () => {
    const m = st.f.month || curM(); if (!await ask('Tổng hợp & gửi tiền ăn', `Tính tiền ăn tháng ${mmy(m)} cho từng người theo số ngày đăng ký × đơn giá từng ngày, rồi gửi thông báo kèm mã QR chuyển khoản? Gửi lại được nhiều lần — người đã thanh toán không bị tính lại.`, { ok: 'Tổng hợp & gửi' })) return;
    const r = await api('POST', '/api/meal/bill', { month: m });
    modal({ title: `Đã gửi tiền ăn tháng ${mmy(m)}`, cls: 'nar', body: `<p><b>${r.n}</b> người · tổng <b>${fm(r.total)} đ</b>${r.paid ? ` · ${r.paid} người đã thanh toán từ trước (giữ nguyên)` : ''}</p>${r.noAcc.length ? `<div class="banner">${ico('fa-triangle-exclamation')} ${r.noAcc.length} người chưa có tài khoản app nên không nhận được thông báo — thu trực tiếp: ${esc(r.noAcc.join(', '))}</div>` : ''}` });
    refresh();
  });
  if ($('#mcp')) $('#mcp').onclick = run(async () => { const m = st.f.month || curM(); if (!await ask('Tạo đăng ký suất ăn', `Chép danh sách người đăng ký tháng trước sang tháng ${mmy(m)}? Giữ các thứ trong tuần từng người hay ăn, bỏ Chủ nhật và ngày lễ; người đã có đăng ký tháng ${mmy(m)} giữ nguyên.`, { ok: 'Tạo' })) return; const r = await api('POST', '/api/meal-reg/copy', { month: m, legal_id: st.f.legal_id || F.legal || null }); toast(`Đã tạo ${r.ok} đăng ký${r.skip ? `, bỏ qua ${r.skip} người đã có` : ''}${r.err?.length ? `, lỗi ${r.err.length}: ${r.err[0]}` : ''}`, !!r.err?.length); refresh(); });
  if (wk) {
    $$('[data-wk]', main()).forEach(b => b.onclick = () => { listScreen.wk = b.dataset.wk; refresh(); });
    $$('[data-md]', main()).forEach(c => c.onclick = run(() => c.dataset.id ? openDetail('meal_day', +c.dataset.id) : p.c ? openForm('meal_day', null, { day: c.dataset.md, legal_id: +(st.f.legal_id || F.legal) || M.legals[0].id }) : null));
  }
  if (openId) openDetail(ent, openId).catch(er => toast(er.message, true));
}
listScreen.s = {};
// lịch tháng (T2 → CN): mỗi phiếu một thẻ màu theo trạng thái ở ngày của nó (phiếu nhiều ngày hiện ở mọi ngày); bấm thẻ mở phiếu, bấm đúp ô trống tạo phiếu ngày đó
function calView(e, rows, cm, sf) {
  const [y, m] = cm.split('-').map(Number), first = new Date(Date.UTC(y, m - 1, 1)), lastD = new Date(Date.UTC(y, m, 0)).getUTCDate(), lead = (first.getUTCDay() + 6) % 7;
  const vn = s => { const x = new Date(new Date(s).getTime() + 7 * 3600e3).toISOString(); return [x.slice(0, 10), x.slice(11, 16)]; };
  const isDt = e.fields.find(f => f.k === e.cal)?.t === 'dt', end = { from_on: 'to_on', start_at: 'end_at' }[e.cal];
  const by = {};
  for (const r of rows) {
    if (!r[e.cal]) continue; const [d0, tm] = isDt ? vn(r[e.cal]) : [String(r[e.cal]).slice(0, 10), ''];
    let d1 = end && r[end] ? (isDt ? vn(r[end])[0] : String(r[end]).slice(0, 10)) : d0; if (d1 < d0 || (Date.parse(d1) - Date.parse(d0)) > 62 * 864e5) d1 = d0;
    for (let d = d0; d <= d1; d = new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10)) (by[d] ||= []).push({ r, tm: d === d0 ? tm : '' });
  }
  const inM = new Set(Object.entries(by).filter(([d]) => d.startsWith(cm)).flatMap(([, xs]) => xs.map(x => x.r.id)));   // số phiếu có mặt trong tháng đang xem
  rows = rows.filter(r => inM.has(r.id));
  const st = r => sf?.o.find(o => o[0] === r.status) || [], txt = r => (e.calL || []).map(k => r[k + '__l'] ?? r[k]).filter(Boolean).join(' · ') || r.code || '';
  const shift = k => { const x = new Date(Date.UTC(y, m - 1 + k, 1)); return x.toISOString().slice(0, 7); };
  const cells = Array.from({ length: Math.ceil((lead + lastD) / 7) * 7 }, (_, i) => {
    const dn = i - lead + 1; if (dn < 1 || dn > lastD) return '<div class="cd out"></div>';
    const d = `${cm}-${String(dn).padStart(2, '0')}`, xs = (by[d] || []).sort((a, b) => a.tm.localeCompare(b.tm));
    return `<div class="cd ${d === M.today ? 'now' : ''} ${i % 7 === 6 ? 'cn' : ''} ${xs.length ? 'has' : ''}" data-cd="${d}"><b>${dn}</b>${xs.slice(0, 4).map(({ r, tm }) => `<a class="ce ${st(r)[2] || 's'}" data-ce="${r.id}" title="${esc([r.code, txt(r), st(r)[1]].filter(Boolean).join(' · '))}">${tm ? `<i>${tm}</i>` : ''}${esc(txt(r))}</a>`).join('')}${xs.length > 4 ? `<small>+${xs.length - 4} phiếu</small>` : ''}</div>`;
  }).join('');
  return `<div class="card calv"><div class="row mb"><button class="btn sm" data-cm="${shift(-1)}">${ico('fa-chevron-left')}</button><b class="cm">Tháng ${m}/${y}</b><button class="btn sm" data-cm="${shift(1)}">${ico('fa-chevron-right')}</button><button class="btn sm" data-cm="${M.today.slice(0, 7)}">Tháng này</button><span class="grow"></span><span class="cleg">${(sf?.o || []).filter(o => rows.some(r => r.status === o[0])).map(o => `<span><i class="ce ${o[2] || 's'}"></i>${esc(o[1])}</span>`).join('')}</span><span class="muted small">${rows.length} ${esc(e.one)} · bấm thẻ để mở${e.perm.c ? ', bấm đúp ô ngày để tạo mới' : ''}</span></div>
    <div class="cgrid">${['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((x, i) => `<em class="${i === 6 ? 'cn' : ''}">${x}</em>`).join('')}${cells}</div></div>`;
}
// hàng lịch tuần: ngày · suất đăng ký (SA01) · suất thực tế; bấm ô để mở / ghi suất ngày đó
function mealWeek(w) {
  const DN = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'], sh = n => w[0].day && new Date(Date.parse(w[0].day) + n * 864e5).toISOString().slice(0, 10);
  return `<div class="card mb"><div class="row mb"><b>${ico('fa-calendar-week')} Tuần ${dmy(w[0].day)} – ${dmy(w[6].day)}</b><span class="grow"></span><button class="btn sm" data-wk="${sh(-7)}">${ico('fa-chevron-left')} Tuần trước</button><button class="btn sm" data-wk="${M.today}">Tuần này</button><button class="btn sm" data-wk="${sh(7)}">Tuần sau ${ico('fa-chevron-right')}</button></div>
  <div class="mweek">${w.map((x, i) => `<div class="md ${x.off ? 'off' : ''} ${x.day === M.today ? 'now' : ''}" data-md="${x.day}" data-id="${x.id || ''}" title="Bấm để ${x.id ? 'mở' : 'ghi'} suất ăn ngày ${dmy(x.day)}"><div class="dh">${DN[i]} <span>${dmy(x.day).slice(0, 5)}</span></div><b>${x.reg}</b><small>suất đăng ký</small><div class="da">${x.actual != null ? `Thực tế: <b>${x.actual}</b>${x.actual !== x.reg ? ` <span class="${x.actual > x.reg ? 'up' : 'down'}">(${x.actual > x.reg ? '+' : ''}${x.actual - x.reg})</span>` : ''}` : '<span class="muted">Chưa ghi thực tế</span>'}</div></div>`).join('')}</div></div>`;
}

// ---------- bảng lương, BH, CĐ trong chi tiết ----------
function sheetView(ent, r, t) {
  if (!t || !t.rows.length) return '<div class="empty">Chưa có dòng — bấm «Tính lại từ dữ liệu»</div>';
  const edit = ent === 'payroll' && ['nhap', 'tu_choi'].includes(r.status), two = t.head.some(h => h.g);
  const v = (k, x) => { const a = x[k.k]; if (edit && k.edit) return `<input class="pl" data-pl="${x.emp_id}" data-k="${k.k}" value="${esc(k.t === 't' ? a ?? '' : k.t === 'p' ? a ?? 100 : fm(a ?? 0))}"${!['t', 'p'].includes(k.t) && !k.neg ? ' data-money inputmode="numeric" title="Nhập số tiền đủ (đồng), VD 1.500.000"' : ''}>`; if (a == null || a === '') return ''; return k.t === 't' ? esc(a) : k.t === 'p' ? fnum(a) + '%' : k.t === 'n' ? fnum(a) : fm(a); };
  const cls = (k, i) => [k.t === 't' ? '' : 'n', i === 0 ? 'nm' : '', k.hl ? 'hl' + k.hl : ''].join(' ');
  const h1 = `<tr><th rowspan="${two ? 2 : 1}">STT</th>${t.head.map((h, i) => h.g ? `<th colspan="${h.cols.length}">${esc(h.g)}</th>` : `<th rowspan="${two ? 2 : 1}" class="${i === 0 ? 'nm' : ''} ${h.hl ? 'hl' + h.hl : ''}">${esc(h.l)}</th>`).join('')}</tr>`;
  const h2 = two ? `<tr>${t.head.filter(h => h.g).flatMap(h => h.cols).map(x => `<th class="${x.hl ? 'hl' + x.hl : ''}">${esc(x.l)}</th>`).join('')}</tr>` : '';
  const warn = ent === 'payroll' ? [t.rows.filter(l => l.no_pay).length && `${t.rows.filter(l => l.no_pay).length} người cần cập nhật lương P1.`, t.rows.filter(l => l.no_att).length && `${t.rows.filter(l => l.no_att).length} người chưa có dữ liệu công.`].filter(Boolean).join(' ') : t.rows.filter(l => l.need_data).length ? `${t.rows.filter(l => l.need_data).length} người chưa có mức đóng — cần cập nhật hồ sơ.` : '';
  return `${warn ? `<div class="banner">${ico('fa-triangle-exclamation')} ${esc(warn)}</div>` : ''}<div class="row mb"><b>${esc(t.company)}</b><span class="muted">· ${esc(t.title)} · ${esc(t.sub)}</span>${edit ? '<span class="muted small">· ô trắng sửa được (KPI, công tác phí, thưởng, tạm ứng, điều chỉnh thuế, TK)</span>' : ''}</div>
  <div class="tw" style="max-height:56vh"><table class="t xs"><thead>${h1}${h2}</thead><tbody>${t.rows.map((x, i) => `<tr><td>${i + 1}</td>${t.cols.map((k, j) => `<td class="${cls(k, j)}">${v(k, x)}</td>`).join('')}</tr>`).join('')}</tbody>
  <tfoot><tr><td></td><td class="nm">TỔNG CỘNG</td>${t.cols.slice(1).map(k => `<td class="n ${k.hl ? 'hl' + k.hl : ''}">${k.k in t.sum ? fm(t.sum[k.k]) : ''}</td>`).join('')}</tr></tfoot></table></div>
  ${t.after ? `<div class="adj">${t.after.map(([l, a, b]) => `<div class="${b ? 'tot' : ''}"><span>${esc(l)}</span><b>${fm(a ?? 0)}</b></div>`).join('')}</div>` : ''}${t.notes ? `<div class="small muted mt">${t.notes.map(esc).join(' · ')}</div>` : ''}`;
}

// ---------- báo cáo ----------
const YEARLY = new Set(['BH-02', 'CĐ-02', 'SK03']), NOPERIOD = new Set(['TS02', 'XC03', 'TD04', 'HD12', 'HD13', 'CCTC05']);
async function reportScreen(code, snap) {
  F.month ||= curM(); F.year ||= M.today.slice(0, 4);
  const qp = new URLSearchParams({ legal: F.legal, dept: F.dept, month: F.month, year: F.year }); if (snap) qp.set('snapshot', snap); if (code === 'HD13' && reportScreen.emp) qp.set('emp', reportScreen.emp); if (code === 'TD04') { if (reportScreen.from) qp.set('from', reportScreen.from); if (reportScreen.to) qp.set('to', reportScreen.to); }
  const d = await api('GET', `/api/report/${encodeURIComponent(code)}?${qp}`);
  const val = (c, r) => { const v = r[c[0]]; if (v == null || v === '') return ''; return c[2] === 'm' ? fm(v) : c[2] === 'n' ? fnum(v) : c[2] === 'd' ? dmy(v) : c[2] === 'dt' ? dmyhm(v) : c[2] === 'w' ? pill(v, ws(v)) : esc(v); };
  const num = c => ['m', 'n'].includes(c[2]);
  main().innerHTML = `<div class="ph"><h1>${ico('fa-file-lines')} ${esc(d.title)} <span class="tag">${esc(d.code)}</span></h1>${d.snapshot ? `<p>Bản chốt phiên bản ${d.snapshot.version} · ${dmyhm(d.snapshot.at)} · số liệu không đổi khi nguồn cập nhật muộn <a href="#" id="live"><b>Xem số hiện tại</b></a></p>` : ''}</div>
  <div class="card filters"><div><label>Pháp nhân</label>${legalSel(F.legal)}</div>${['HS02', 'CC12', 'PLI'].includes(code) ? `<div><label>Phòng ban</label>${deptSel(F.dept)}</div>` : ''}${code === 'HD13' ? `<div><label>Người lao động</label><div class="ta" style="min-width:260px"><input id="fE" data-id="${reportScreen.emp || ''}" value="${esc(reportScreen.empL || '')}" placeholder="Gõ tên hoặc mã NV — trống = tất cả" autocomplete="off"><div class="tal hidden"></div></div></div>` : ''}
  ${code === 'TD04' ? `<div><label>Từ ngày</label><input type="date" id="fFr" value="${reportScreen.from || ''}"></div><div><label>Đến ngày</label><input type="date" id="fTo" value="${reportScreen.to || ''}"></div>` : ''}${YEARLY.has(code) ? `<div><label>Năm</label><input id="fY" type="number" value="${F.year}" style="min-width:100px"></div>` : NOPERIOD.has(code) ? '' : `<div><label>Kỳ</label><input type="month" id="fM" value="${F.month}"></div>`}
  <span class="grow"></span>${code === 'VPP06' && M.ents.vpp_in.perm.c ? `<button class="btn" id="buy">${ico('fa-cart-plus')} Tạo phiếu nhập từ nhu cầu</button>` : ''}${d.snapshots?.length ? `<div><label>Bản đã chốt</label><select id="sn">${opt(d.snapshots.map(s => [s.id, `${s.period} v${s.version}`]), snap, '— số hiện tại —')}</select></div>` : ''}
  <a class="btn" href="/api/report/${encodeURIComponent(code)}/xlsx?${qp}">${ico('fa-file-excel')} Excel</a><a class="btn" target="_blank" href="/print-report/${encodeURIComponent(code)}?${qp}">${ico('fa-file-pdf')} PDF</a><a class="btn" href="/print-report/${encodeURIComponent(code)}?${qp}&fmt=doc">${ico('fa-file-word')} Word</a>${['cv_hc', 'cv_hcns', 'tp_hcns', 'admin'].includes(M.me.role) ? `<button class="btn pri" id="close">${ico('fa-lock')} Chốt kỳ</button>` : ''}</div>
  <div class="grid4 ${d.kpis.length > 4 ? 'g5' : ''}">${d.kpis.map((k, i) => `<div class="kpi flat ${['g', 'n', 'b', 'v', 'a'][d.kpis.length > 4 ? i : [0, 1, 2, 4][i]]}"><b>${typeof k[1] === 'number' ? fnum(k[1]) : esc(k[1])}${k[2] ? ` <span style="font-size:14px">${esc(k[2])}</span>` : ''}</b><span>${esc(k[0])}</span></div>`).join('')}</div>
  ${d.note ? `<div class="banner">${esc(d.note)}</div>` : ''}
  ${d.opening && d.open_edit && !d.snapshot ? `<div class="card filters"><div class="sec" style="width:100%">Số dư đầu năm ${esc(d.open_year)} <span class="muted small">(còn nợ nhập số dương, nộp thừa nhập số âm)</span></div>${d.opening.map(o => `<div><label>${esc(o.short)}</label><input class="opn" data-id="${o.id}" type="number" step="1" value="${o.amt}" style="min-width:160px"></div>`).join('')}<button class="btn pri" id="opnS">${ico('fa-floppy-disk')} Lưu số dư</button></div>` : ''}
  <div class="tw"><table class="t ${d.groups ? 'xs' : ''}"><thead>${d.groups ? `<tr>${d.groups.map(([l, n]) => `<th colspan="${n}">${esc(l || '')}</th>`).join('')}</tr>` : ''}<tr>${d.cols.map(c => `<th class="${num(c) ? 'n' : ''}">${esc(c[1])}</th>`).join('')}</tr></thead><tbody>${d.rows.map((r, i) => `<tr class="${r._e ? 'c' : ''}" data-i="${i}">${d.cols.map(c => `<td class="${num(c) ? 'n' : ''}">${val(c, r)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${d.cols.length}" class="empty">Chưa có dữ liệu trong kỳ</td></tr>`}</tbody>
  ${d.total && d.rows.length ? `<tfoot><tr>${d.cols.map((c, i) => `<td class="${num(c) ? 'n' : ''}">${i === 0 ? 'TỔNG CỘNG' : num(c) && !(d.nosum || []).includes(c[0]) ? (c[2] === 'm' ? fm : fnum)(d.rows.reduce((s, x) => s + (+x[c[0]] || 0), 0)) : ''}</td>`).join('')}</tr></tfoot>` : ''}</table></div>
  ${(d.extra || []).map(x => `<div class="sec mt">${esc(x.title)}</div><div class="tw"><table class="t"><thead><tr>${x.cols.map(c => `<th class="${num(c) ? 'n' : ''}">${esc(c[1])}</th>`).join('')}</tr></thead><tbody>${x.rows.map(r => `<tr>${x.cols.map(c => `<td class="${num(c) ? 'n' : ''}">${val(c, r)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${x.cols.length}" class="empty">Chưa có dữ liệu</td></tr>`}</tbody>${x.total && x.rows.length ? `<tfoot><tr>${x.cols.map((c, i) => `<td class="${num(c) ? 'n' : ''}">${i === 0 ? 'TỔNG CỘNG' : num(c) && !(x.nosum || []).includes(c[0]) ? (c[2] === 'm' ? fm : fnum)(x.rows.reduce((s, y) => s + (+y[c[0]] || 0), 0)) : ''}</td>`).join('')}</tr></tfoot>` : ''}</table></div>`).join('')}
  <div class="card spec mt"><b>Cách tính:</b> ${esc(d.rule)} <b>Kiểm soát:</b> ${esc(d.control)} <b>Nguồn:</b> ${esc(d.source)} <b>Luồng:</b> ${esc(d.flow)}</div>`;
  $$('tr[data-i]', main()).forEach(t => { const r = d.rows[+t.dataset.i], x = r._e; if (r._h) t.onclick = run(() => empHistory(r._h)); else if (x) t.onclick = run(() => openDetail(x[0], x[1])); });
  const set = () => { F.legal = $('#fL').value; if ($('#fD')) F.dept = $('#fD').value; if ($('#fM')) F.month = $('#fM').value; if ($('#fY')) F.year = $('#fY').value; refresh(); };
  ['#fL', '#fD', '#fM', '#fY'].forEach(s => { if ($(s)) $(s).onchange = set; });
  ['#fFr', '#fTo'].forEach(s => { if ($(s)) $(s).onchange = () => { reportScreen.from = $('#fFr').value; reportScreen.to = $('#fTo').value; refresh(); }; });
  if ($('#fE')) { const i = $('#fE'); typeahead(i, 'employee', x => { reportScreen.emp = x.id; reportScreen.empL = x.label; refresh(); }); i.addEventListener('change', () => { if (!i.value.trim() && reportScreen.emp) { reportScreen.emp = ''; reportScreen.empL = ''; refresh(); } }); }
  if ($('#sn')) $('#sn').onchange = run(() => reportScreen(code, $('#sn').value)); if ($('#live')) $('#live').onclick = ev => { ev.preventDefault(); refresh(); };
  if ($('#close')) $('#close').onclick = run(async () => { const r = await api('POST', `/api/report/${encodeURIComponent(code)}/close`, { legal: F.legal, dept: F.dept, month: YEARLY.has(code) ? undefined : F.month, year: F.year }); toast(`Đã chốt kỳ · phiên bản ${r.version}`); refresh(); });
  if ($('#opnS')) $('#opnS').onclick = run(async () => { for (const i of $$('.opn', main())) await api('PUT', '/api/ins-open', { year: d.open_year, legal_id: +i.dataset.id, amount: +i.value || 0 }); toast('Đã lưu số dư đầu năm'); refresh(); });
  if ($('#buy')) $('#buy').onclick = run(async () => { const x = await api('POST', '/api/vpp/buy', { legal_id: F.legal || M.legals[0].id }); openDetail('vpp_in', x.row.id); });
}

// ---------- bảng công ----------
// nhóm ký hiệu công CC06 → màu trên bảng công (thứ tự kiểm quan trọng: HC trước H, TS trước T)
const MKG = [['HC', 'Đi làm', /^(HC|LB)/], ['CT', 'Công tác', /^CT/], ['P', 'Nghỉ phép', /^P/], ['L', 'Lễ tết', /^L$/], ['H', 'Hiếu hỉ', /^(H$|VHH)/], ['TS', 'Thai sản, chăm vợ sinh', /^(TS|DS|CV)/], ['O', 'Chế độ BHXH (ốm, con ốm, tai nạn)', /^(O|CÔ|T)/], ['K', 'Không lương', /^K/], ['X', 'Thiếu chấm', /^X/]];
const mkCls = m => (MKG.find(g => g[2].test(m || '')) || ['O'])[0];
const mkLegend = types => `<div class="mkl mb">${MKG.map(([c, l]) => { const xs = types.filter(t => mkCls(t.code) === c); return xs.length ? `<span class="mkg">${xs.map(t => `<span class="mk ${c}" title="${esc(t.code)} · ${esc(t.name)}">${esc(t.code)}</span>`).join('')}<span class="small muted">${esc(l)}</span></span>` : ''; }).join('')}</div>`;
async function timesheet() {
  F.month ||= curM(); const d = await api('GET', `/api/timesheet?${new URLSearchParams({ month: F.month, legal: F.legal, dept: F.dept })}`), ds = Array.from({ length: d.last }, (_, i) => i + 1), m = F.month;
  const dow = i => new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, i).getDay(), DN = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'], off = i => dow(i) === 0 || d.hol.includes(`${m}-${String(i).padStart(2, '0')}`), edit = M.ents.attendance.perm.c;
  main().innerHTML = `<div class="ph"><h1>${ico('fa-table-cells')} Bảng chấm công <span class="tag">TL01</span></h1><p>${d.emps.length} người · ${d.locked ? `${d.locked} pháp nhân đã khóa kỳ` : 'kỳ đang mở'} · bấm ô để sửa, đơn đã duyệt tự ghi vào đây</p></div>
  <div class="card filters one"><div><label>Kỳ</label><input type="month" id="fM" value="${m}"></div><div><label>Pháp nhân</label>${legalSel(F.legal)}</div><div><label>Phòng ban</label>${deptSel(F.dept)}</div><span class="grow"></span><div class="fbtn">${edit ? `<label class="btn">${ico('fa-file-import')} Nhập máy chấm công<input type="file" id="iA" accept=".xlsx" hidden></label><button class="btn" id="auto">${ico('fa-wand-magic-sparkles')} Công tự động</button><button class="btn" id="tsSend" title="Gửi thông báo bảng công tháng cho trưởng từng phòng (mỗi người chỉ xem phòng mình)">${ico('fa-paper-plane')} Gửi trưởng phòng</button>` : ''}<a class="btn" href="/api/report/CC12/xlsx?${new URLSearchParams({ month: m, legal: F.legal, dept: F.dept })}">${ico('fa-file-excel')} Xuất Excel</a></div></div>
  <div class="tw"><table class="t ts"><thead><tr><th class="nm">Nhân sự</th>${ds.map(i => `<th class="${off(i) ? 'wk' : ''}">${String(i).padStart(2, '0')}<br>${DN[dow(i)]}</th>`).join('')}<th>Đi làm</th><th>Phép, lễ</th><th>Không lương</th><th class="tsum">Tổng công</th><th class="tsum">Tăng ca (giờ)</th><th>Thiếu chấm</th></tr></thead><tbody>${d.emps.map(e => { const a = d.att[e.id] || { days: {}, work: 0, paid_leave: 0, miss: 0 }; return `<tr><td class="nm"><a href="#" data-h="${e.id}" title="Xem lịch sử chấm công">${esc(e.full_name)}</a> <span class="small muted">${esc(e.code)}</span></td>${ds.map(i => `<td class="${off(i) ? 'wk' : ''}" data-e="${e.id}" data-d="${i}">${a.days[i] ? `<span class="mk ${mkCls(a.days[i])}">${esc(a.days[i])}</span>` : ''}${a.out?.[i] ? `<span class="ovz" title="Chấm ngoài vùng lúc ${esc(a.out[i])} — cần rà soát">!</span>` : ''}</td>`).join('')}<td>${fnum(a.work)}</td><td>${fnum(a.paid_leave)}</td><td>${a.unpaid ? fnum(a.unpaid) : ''}</td><td class="tsum"><b>${fnum((a.work || 0) + (a.paid_leave || 0))}</b></td><td class="tsum">${d.ot?.[e.id] ? fnum(d.ot[e.id]) : ''}</td><td>${a.miss || ''}</td></tr>`; }).join('') || `<tr><td class="empty" colspan="${d.last + 7}">Chưa có nhân sự</td></tr>`}</tbody>
    ${d.emps.length ? `<tfoot><tr><td class="nm"><b>Tổng cộng</b></td>${ds.map(() => '<td></td>').join('')}${[e => e.work, e => e.paid_leave, e => e.unpaid].map(g => `<td><b>${fnum(d.emps.reduce((s, e) => s + (+g(d.att[e.id] || {}) || 0), 0))}</b></td>`).join('')}<td class="tsum"><b>${fnum(d.emps.reduce((s, e) => s + (d.att[e.id]?.work || 0) + (d.att[e.id]?.paid_leave || 0), 0))}</b></td><td class="tsum"><b>${fnum(Object.values(d.ot || {}).reduce((s, h) => s + h, 0))}</b></td><td><b>${d.emps.reduce((s, e) => s + (d.att[e.id]?.miss || 0), 0) || ''}</b></td></tr></tfoot>` : ''}</table></div>
  <div class="mt">${mkLegend(d.types)}</div>`;
  const set = () => { F.month = $('#fM').value; F.legal = $('#fL').value; F.dept = $('#fD').value; refresh(); }; ['#fM', '#fL', '#fD'].forEach(s => $(s).onchange = set);
  $$('[data-h]', main()).forEach(a => a.onclick = run(ev => { ev.preventDefault(); return attHistory(+a.dataset.h, m); }));
  if (edit) {
    $$('td[data-e]', main()).forEach(td => td.onclick = run(async () => { const cur = $('.mk', td)?.textContent || ''; const mm = modal({ title: 'Sửa ô công', cls: 'nar', body: `<div class="fld"><select id="mk"><option value="">— xóa —</option>${d.types.map(t => `<option value="${esc(t.code)}" ${t.code === cur ? 'selected' : ''}>${esc(t.code)} · ${esc(t.name)}</option>`).join('')}</select></div>`, foot: `<button class="btn pri" id="ok">Lưu</button>` }); $('#ok', mm.el).onclick = run(async () => { await api('PUT', '/api/timesheet', { emp_id: td.dataset.e, day: `${m}-${String(td.dataset.d).padStart(2, '0')}`, mark: $('#mk', mm.el).value }); mm.close(); refresh(); }); }));
    $('#iA').onchange = run(async ev => { const fd = new FormData(); fd.append('f', ev.target.files[0]); const r = await api('POST', '/api/import-att', fd); toast(`Ghi ${r.ok} ô · giữ nguyên ${r.skip} ô theo đơn đã duyệt${r.err.length ? ` · lỗi ${r.err.length}` : ''}`, !!r.err.length); refresh(); });
    $('#auto').onclick = run(() => openForm('att_auto'));
    $('#tsSend').onclick = run(async () => { if (!await ask('Gửi bảng công cho trưởng phòng', `Gửi thông báo bảng công tháng ${mmy(m)} cho trưởng từng phòng${F.dept ? ' (phòng đang lọc)' : ''}? Mỗi trưởng phòng chỉ xem được người trong phòng mình.`, { ok: 'Gửi' })) return;
      const r = await api('POST', '/api/timesheet/send', { month: m, legal: F.legal, dept: F.dept }); toast(`Đã gửi ${r.sent.length} trưởng phòng${r.skip.length ? ` · chưa gửi được ${r.skip.length} phòng (chưa có trưởng phòng có tài khoản): ${r.skip.join(', ')}` : ''}`, !!r.skip.length); });
  }
}

// lịch sử chấm công một người: 3 tháng đến hết kỳ đang xem + các đơn liên quan (bấm đơn để mở)
const SRC = { may: 'Máy chấm công', app: 'App điện thoại', don: 'Theo đơn', tay: 'Sửa tay', CC03: 'Giải trình', CC04: 'Đơn nghỉ', CC08: 'Công tác', CC10: 'Chấm bổ sung', CC11: 'Chấm tự động', nen_tang: 'Nền tảng chung' };
async function attHistory(id, month) {
  const d = await api('GET', `/api/att-history/${id}?month=${month}`), DN = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'], dw = s => DN[new Date(s + 'T00:00:00Z').getUTCDay()];
  const mm = modal({ title: `Lịch sử chấm công · ${esc(d.emp.full_name)} <span class="tag">${esc(d.emp.code)}</span>`, cls: 'wide', body: `<p class="muted">${esc(d.emp.title || '')}${d.emp.dept ? ' · ' + esc(d.emp.dept) : ''} · từ ${dmy(d.from)} đến ${dmy(d.to)} · ${d.days.length} ngày có công</p>
    <div class="grid2"><div class="tw" style="max-height:460px"><table class="t"><thead><tr><th>Ngày</th><th>Thứ</th><th>Ký hiệu</th><th>Vào</th><th>Ra</th><th>Nguồn</th></tr></thead><tbody>${d.days.map(x => `<tr><td>${dmy(x.day)}</td><td>${dw(x.day)}</td><td><span class="mk ${mkCls(x.mark)}">${esc(x.mark)}</span></td><td>${esc(x.in_t || '')}</td><td>${esc(x.out_t || '')}</td><td class="small">${esc(SRC[x.source] || x.source || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Chưa có dữ liệu</td></tr>'}</tbody></table></div>
    <div><div class="sec" style="font-size:15px">Đơn từ liên quan</div><div class="tw" style="max-height:420px"><table class="t"><tbody>${d.reqs.map((x, i) => `<tr class="c" data-r="${i}"><td>${esc(x.title)}<div class="small muted">${esc(x.code || '')} · ${esc(x.info || '')}</div></td><td>${(o => pill(o?.[1] || x.status, o?.[2]))(M.ents[x.ent].fields.find(f => f.k === 'status')?.o?.find(o => o[0] === x.status))}</td></tr>`).join('') || '<tr><td class="empty">Không có đơn</td></tr>'}</tbody></table></div></div></div>` });
  $$('[data-r]', mm.el).forEach(t => t.onclick = run(() => { const x = d.reqs[+t.dataset.r]; mm.close(); return openDetail(x.ent, x.id); }));
}

// ---------- tạo ngày nghỉ phép cho nhân viên chấm công tự động (như Bravo): B1 điều kiện lọc → B2 chọn nhân viên → B3 tạo đơn ----------
async function autoLeaveWizard() {
  const S = { step: 1, month: (M.today || '').slice(0, 7), rows: [] }, steps = ['Điều kiện lọc', 'Chọn nhân viên', 'Tạo đơn'];
  const m = modal({ title: 'Tạo ngày nghỉ phép cho nhân viên chấm công tự động', cls: 'wide', body: '<div id="alw"></div>', foot: '<button class="btn" data-x>Đóng</button><button class="btn" id="alB">← Quay lại</button><button class="btn pri" id="alN">Tiếp theo →</button>' });
  const box = $('#alw', m.el), iso = s => { const x = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(s.trim()); return x ? `${x[3] || S.month.slice(0, 4)}-${x[2].padStart(2, '0')}-${x[1].padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}$/.test(s.trim()) ? s.trim() : null; };
  const read = () => $$('tr[data-e]', box).forEach(tr => { const r = S.rows.find(x => x.id === +tr.dataset.e); r.ck = $('.ck', tr).checked; r.days = $('.dd', tr).value; r.type = $('.tp', tr).value; });
  const draw = () => {
    const nav = `<div class="row mb">${steps.map((s, i) => `<span class="tag" style="${S.step === i + 1 ? 'background:var(--ink);color:#fff' : ''}">${i + 1}. ${s}</span>`).join(' ')}</div>`;
    if (S.step === 1) box.innerHTML = nav + `<div class="fld" style="max-width:260px"><label>Tháng</label><input type="month" id="alM" value="${S.month}"></div><p class="muted small">Hiện các nhân viên có lịch chấm công tự động (CC11) trong tháng.</p>`;
    if (S.step === 2) box.innerHTML = nav + (S.rows.length ? `<p class="muted small">Tích chọn nhân viên, nhập ngày nghỉ (dd/mm, nhiều ngày cách nhau dấu phẩy). App tạo đơn nghỉ đã duyệt và ghi công.</p><div class="tw"><table class="t"><thead><tr><th>Chọn</th><th>Nhân viên</th><th>Tên nhân viên</th><th>Ngày nghỉ phép</th><th>Loại</th><th>Đã có đơn trong tháng</th></tr></thead><tbody>${S.rows.map(r => `<tr data-e="${r.id}"><td><input type="checkbox" class="ck" ${r.ck ? 'checked' : ''}></td><td>${esc(r.code)}</td><td>${esc(r.full_name)}</td><td><input class="dd" value="${esc(r.days || '')}" placeholder="VD 31/10, 15/10" style="width:180px"></td><td><select class="tp">${['P', 'P/2'].map(t => `<option ${t === (r.type || 'P') ? 'selected' : ''}>${t}</option>`).join('')}</select></td><td class="small muted">${esc((r.had || []).join('; '))}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Tháng này không có nhân viên chấm công tự động</div>');
    if (S.step === 3) { const xs = S.rows.filter(r => r.ck); box.innerHTML = nav + `<p>Sẽ tạo đơn nghỉ (đã duyệt) và ghi công cho <b>${xs.length}</b> nhân viên:</p><ul>${xs.map(r => `<li>${esc(r.code)} · ${esc(r.full_name)}: <b>${esc(r.days || '(chưa nhập ngày)')}</b> (${esc(r.type || 'P')})</li>`).join('')}</ul>`; }
    $('#alB', m.el).disabled = S.step === 1; $('#alN', m.el).innerHTML = S.step === 3 ? `${ico('fa-check')} Tạo đơn` : 'Tiếp theo →';
  };
  box.addEventListener('input', ev => { if (ev.target.classList.contains('dd') && ev.target.value) ev.target.closest('tr').querySelector('.ck').checked = true; });   // nhập ngày → tự tích chọn
  $('#alB', m.el).onclick = () => { if (S.step === 2) read(); S.step--; draw(); };
  $('#alN', m.el).onclick = run(async () => {
    if (S.step === 1) { S.month = $('#alM', box).value || S.month; S.rows = await api('GET', `/api/att-auto/leave?month=${S.month}`); S.step = 2; return draw(); }
    if (S.step === 2) { read(); const xs = S.rows.filter(r => r.ck); if (!xs.length) return toast('Chọn ít nhất một nhân viên', true);
      for (const r of xs) { const ds = String(r.days || '').split(/[,;\s]+/).filter(Boolean).map(iso); if (!ds.length || ds.some(d => !d)) return toast(`${r.full_name}: nhập ngày nghỉ dạng dd/mm`, true); r.iso = ds; } S.step = 3; return draw(); }
    const x = await api('POST', '/api/att-auto/leave', { month: S.month, items: S.rows.filter(r => r.ck).map(r => ({ emp_id: r.id, days: r.iso, type: r.type || 'P' })) });
    m.close(); toast(x.made.length ? `Đã tạo ${x.made.length} ngày nghỉ: ${x.made.join(', ')}` : 'Các ngày này đã có đơn — không tạo thêm'); refresh();
  });
  draw();
}

// ---------- sơ đồ tổ chức ----------
async function org() {
  const d = await api('GET', '/api/org'), total = d.depts.reduce((s, x) => s + x.n, 0);
  const box = x => `<div class="d"><div class="row" data-id="${x.id}" style="cursor:pointer"><b>${esc(x.name)}</b><span class="grow"></span><span class="tag">${x.n} người</span></div><div class="small">${x.head ? 'Phụ trách: <b>' + esc(x.head) + '</b>' : pill('Chưa bổ nhiệm phụ trách', 'a')}</div>
    <div class="orgp">${x.people.map(p => `<a href="#" data-emp="${p.id}">${esc(p.full_name)}<span class="muted"> · ${esc(p.title || '')}</span></a>`).join('') || '<span class="muted small">Chưa có nhân sự</span>'}</div></div>`;
  main().innerHTML = `<div class="ph"><h1>${ico('fa-sitemap')} Cơ cấu tổ chức Khối Home <span class="tag">CCTC04</span></h1><p>${d.depts.length} phòng ban · ${total} nhân sự</p></div>
  <div class="org mb">${d.depts.map(box).join('')}</div>
  ${d.unassigned.length ? `<div class="card"><div class="sec" style="font-size:15px">${ico('fa-user-slash')} Chưa thuộc phòng ban nào (${d.unassigned.length}) <span class="small muted" style="font-weight:400">— bấm tên để mở hồ sơ, gán phòng ban</span></div><div class="orgp">${d.unassigned.map(p => `<a href="#" data-emp="${p.id}">${esc(p.full_name)}<span class="muted"> · ${esc(p.code)}${p.title ? ' · ' + esc(p.title) : ''}</span></a>`).join('')}</div></div>` : ''}`;
  $$('[data-id]', main()).forEach(x => x.onclick = run(() => openDetail('dept', +x.dataset.id)));
  $$('[data-emp]', main()).forEach(a => a.onclick = ev => { ev.preventDefault(); run(() => openDetail('employee', +a.dataset.emp))(); });
}

// ---------- quy trình tuyển dụng (kéo thả ứng viên giữa các bước) ----------
// 4 cột; ứng viên đã nhận việc / không đạt không hiện trên bảng
const KB = [['cv', 'Nộp CV', ['S12'], 'b'], ['pv0', 'Chờ phỏng vấn', ['S33'], 'a'], ['pv1', 'Đã phỏng vấn', ['S34', 'S35', 'S36', 'S52'], 'v'], ['nv0', 'Chờ nhận việc', ['S53'], 'g'], ['nv1', 'Đã nhận việc', ['S60'], 't']], KB_OFF = ['S11', 'S21', 'S24'];   // kéo vào «Đã nhận việc» → hỏi ngày + lương, tự tạo hồ sơ NV và HĐ thử việc
const RK = { plan: '', only: '' };
async function recruit() {
  const tm = M.ents.rec_memo, [c, p, mm] = await Promise.all([api('GET', '/api/e/candidate?limit=1000'), api('GET', '/api/e/rec_plan?limit=500'), tm?.perm.r ? api('GET', '/api/e/rec_memo?limit=200').catch(() => ({ rows: [] })) : { rows: [] }]), edit = M.ents.candidate.perm.u;
  const hired = x => ['S53', 'S60'].includes(x.status), plans = p.rows.filter(x => x.rec_state !== 'hoan'), st = Object.fromEntries((M.ents.candidate.fields.find(f => f.k === 'status').o || []).map(o => [o[0], o[1]]));
  const cs = c.rows.filter(x => (!RK.plan || String(x.plan_id) === RK.plan) && (RK.only !== 'hired' || hired(x)));
  const lg = !['tp_hcns', 'admin'].includes(M.me.role) && (M.me.legal_ids || []).length ? M.me.legal_ids.map(id => M.legals.find(l => l.id === id)?.short || id).join(', ') : '';   // chuyên viên chỉ thấy ứng viên của pháp nhân được giao
  main().innerHTML = `<div class="ph"><h1>${ico('fa-diagram-next')} Quy trình tuyển dụng</h1><p>Kéo thẻ ứng viên sang cột kế tiếp để cập nhật trạng thái · bấm thẻ để mở hồ sơ</p></div>
  ${lg ? `<div class="card mb small">${ico('fa-filter')} Anh/chị đang xem ứng viên thuộc pháp nhân được phân công: <b>${esc(lg)}</b>${cs.some(x => !KB_OFF.includes(x.status)) ? '' : ' — hiện chưa có ứng viên nào đang tuyển'}. Ứng viên của pháp nhân khác do người phụ trách pháp nhân đó xử lý.</div>` : ''}
  <div class="card filters"><div><label>Kế hoạch tuyển</label><select id="kP"><option value="">Tất cả kế hoạch</option>${plans.map(x => `<option value="${x.id}" ${String(x.id) === RK.plan ? 'selected' : ''}>${esc(x.code)} · ${esc(x.position)}</option>`).join('')}</select></div>${RK.only ? `<div><label>&nbsp;</label><button class="btn" id="kAll">${ico('fa-xmark')} Bỏ lọc «thực tuyển»</button></div>` : ''}<span class="grow"></span>${M.ents.candidate.perm.c ? `<button class="btn pri" id="kN">${ico('fa-plus')} Thêm ứng viên</button>` : ''}<a class="btn" href="#/e/rec_plan">${ico('fa-bullhorn')} Kế hoạch</a><a class="btn" href="#/r/TD04">${ico('fa-chart-column')} Báo cáo</a></div>
  <div class="kb mb">${KB.map(([k, l, ss, cl]) => { const xs = cs.filter(x => k === 'nv1' ? ss.includes(x.status) && !x.onb_done && (x.onb || !x.start_on || x.start_on >= new Date(Date.parse(M.today) - 30 * 864e5).toISOString().slice(0, 10)) /* đã nhận việc: hiện đến khi xong khóa hội nhập (chưa có khóa → 30 ngày) */ : ss.includes(x.status) ||(k === 'cv' && !KB_OFF.includes(x.status) && !KB.some(b => b[2].includes(x.status)))); return `<div class="kc ${cl}" data-k="${k}"><div class="kh ${cl}">${esc(l)} <b>${xs.length}</b></div>${xs.map(x => `<div class="kt" draggable="${edit ? 'true' : 'false'}" data-id="${x.id}"><b>${esc(x.full_name)}${(x._files || []).length ? ` <span style="float:right">${x._files.map(f => `<a class="fic" href="/api/file/${f.id}?view=1" target="_blank" rel="noopener" data-nf title="${esc(f.name)}">${ico(/pdf/.test(f.mime || '') ? 'fa-file-pdf' : 'fa-paperclip')}</a>`).join('')}</span>` : ''}</b><span class="small muted">${esc(x.code || '')} · ${esc(x.position || '')}</span><span class="small">${esc(x.dept_id__l || '')}${x.source ? ' · ' + esc(x.source) : ''}</span>${ss.length > 1 || k === 'cv' ? `<span class="small muted">${esc(st[x.status] || '')}</span>` : ''}${k === 'nv1' ? `<span class="small muted">${x.emp_code ? esc(x.emp_code) + ' · ' : ''}${x.onb ? `Đang hội nhập (${esc(x.onb)})` : 'Chưa có khóa hội nhập'}</span>` : ''}${k === 'pv1' && edit ? `<button class="btn sm mt" data-tt="${x.id}">${ico('fa-file-signature')} Tạo tờ trình</button>` : ''}</div>`).join('')}</div>`; }).join('')}</div>
  <div class="tw"><table class="t"><thead><tr><th>Kế hoạch</th><th>Vị trí</th><th>Bộ phận</th><th>Kênh</th><th class="n">Cần tuyển</th><th class="n">Ứng viên</th><th class="n">Thực tuyển</th><th>Hạn</th></tr></thead><tbody>${plans.map(x => { const mine = c.rows.filter(y => y.plan_id === x.id); return `<tr><td>${esc(x.code)}</td><td>${esc(x.position)}</td><td>${esc(x.dept_id__l || '')}</td><td>${esc(x.channel || '')}</td><td class="n">${x.qty}</td><td class="n"><a href="#" data-pl="${x.id}">${mine.length}</a></td><td class="n"><a href="#" data-pl="${x.id}" data-h="1"><b>${mine.filter(hired).length}</b></a></td><td>${dmy(x.due_on)}</td></tr>`; }).join('') || '<tr><td colspan="8" class="empty">Chưa có kế hoạch tuyển dụng</td></tr>'}</tbody></table></div>
  ${tm?.perm.r ? (() => { const sf = tm.fields.find(f => f.k === 'status'), kd = tm.fields.find(f => f.k === 'kind'), lb = (f, v) => f?.o?.find(o => o[0] === v) || [v, v, 's'];
    const ids = new Set(cs.map(x => x.id)), ms = mm.rows.filter(x => !RK.plan || (x.cand_id && ids.has(x.cand_id)));   /* lọc theo kế hoạch: tờ trình của ứng viên thuộc kế hoạch đó */
    return `<div class="row mt mb" style="align-items:center"><div class="sec" style="margin:0">${ico('fa-file-signature')} Tờ trình tiếp nhận nhân sự <span class="tag">TD05</span></div><span class="grow"></span>${tm.perm.c ? `<button class="btn" id="kMemo">${ico('fa-plus')} Tạo tờ trình</button>` : ''}<a class="btn" href="#/e/rec_memo">${ico('fa-list')} Xem đầy đủ</a></div>
    <div class="tw"><table class="t"><thead><tr><th>Số tờ trình</th><th>Trường hợp</th><th>Họ và tên</th><th>Vị trí</th><th>Phòng/Ban</th><th>Tiếp nhận từ</th><th>Trạng thái</th></tr></thead><tbody>${ms.map(x => `<tr data-memo="${x.id}" style="cursor:pointer"><td>${esc(x.code || '')}</td><td>${pill(lb(kd, x.kind)[1].replace(/^Tiếp nhận (\S)/, (_, ch) => ch.toUpperCase()), lb(kd, x.kind)[2] || 's')}</td><td><b>${esc(x.full_name || '')}</b></td><td>${esc(x.position || '')}</td><td>${esc(x.dept_id__l || '')}</td><td>${dmy(x.start_on)}</td><td>${pill(lb(sf, x.status)[1], lb(sf, x.status)[2] || 's')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Chưa có tờ trình — bấm «Tạo tờ trình» trên thẻ ứng viên ở cột «Đã phỏng vấn»</td></tr>'}</tbody></table></div>`; })() : ''}`;
  $$('[data-memo]', main()).forEach(r => r.onclick = run(() => openDetail('rec_memo', +r.dataset.memo)));
  if ($('#kMemo')) $('#kMemo').onclick = run(() => openForm('rec_memo', null, {}));
  $('#kP').onchange = () => { RK.plan = $('#kP').value; refresh(); }; if ($('#kAll')) $('#kAll').onclick = () => { RK.only = ''; refresh(); }; if ($('#kN')) $('#kN').onclick = run(() => openForm('candidate', null, RK.plan ? { plan_id: +RK.plan } : {}));
  $$('[data-pl]', main()).forEach(a => a.onclick = ev => { ev.preventDefault(); RK.plan = a.dataset.pl; RK.only = a.dataset.h ? 'hired' : ''; refresh(); });
  $$('[data-nf]', main()).forEach(a => a.onclick = ev => ev.stopPropagation());
  $$('[data-tt]', main()).forEach(b => b.onclick = ev => { ev.stopPropagation(); const a = (M.ents.candidate.acts || []).find(x => x.k === 'to_trinh'); if (a) run(() => runAct('candidate', +b.dataset.tt, a))(); });
  $$('.kt', main()).forEach(t => { t.onclick = run(() => openDetail('candidate', +t.dataset.id)); t.ondragstart = ev => ev.dataTransfer.setData('text/plain', t.dataset.id); });
  if (edit) $$('.kc', main()).forEach(col => {
    col.ondragover = ev => { ev.preventDefault(); col.classList.add('over'); }; col.ondragleave = () => col.classList.remove('over');
    col.ondrop = run(async ev => {
      ev.preventDefault(); col.classList.remove('over'); const id = +ev.dataTransfer.getData('text/plain'), x = c.rows.find(y => y.id === id), b = KB.find(y => y[0] === col.dataset.k);
      if (!x || b[2].includes(x.status)) return;
      const nv = (M.ents.candidate.acts || []).find(a => a.k === 'nhan_viec'), tt = (M.ents.candidate.acts || []).find(a => a.k === 'to_trinh');
      if (b[0] === 'nv1' && nv) { if (x.status !== 'S53') return toast('Ứng viên cần được duyệt tờ trình (sang «Chờ nhận việc») trước khi nhận việc', 'err'); return runAct('candidate', id, nv); }
      if (b[0] === 'nv0' && tt && tt.from.includes(x.status)) return runAct('candidate', id, tt);   // chờ nhận việc phải qua tờ trình sếp duyệt
      await api('PUT', `/api/e/candidate/${id}`, { status: b[2][0] });
      toast(`${x.full_name} → ${b[1]}`); refresh();
    });
  });
}

﻿// ---------- mẫu in: sửa như Word, ô xanh = chỗ app tự điền; mở từ phiếu (nút Sửa mẫu / Thêm mẫu mới) hoặc từ Kho biểu mẫu ----------
const SRC_L = { soqld: 'Theo Sổ quản lý lao động', tu_tao: '<span class="mau">MẪU</span> app tự tạo — chưa có mẫu gốc', hcns: 'HCNS thêm', bo53: 'Theo Bộ 53 biểu mẫu công ty', chung: 'Mẫu chung của app' };
async function tplEdit(key, onDone) {
  const t = await api('GET', '/api/templates/' + encodeURIComponent(key)), VL = Object.fromEntries(t.vars), chip = k => `<span class="ph" contenteditable="false" data-k="${esc(k)}">${esc((VL[k] || k).replace(/^• /, ''))}</span>`, own = t.src === 'hcns';
  const m = modal({ title: `Sửa mẫu in · ${esc(t.entL || '')}`, cls: 'wide tplm', body: `<div class="row mb" style="gap:10px;flex-wrap:wrap">${own ? `<div class="fld grow" style="min-width:260px"><label>Tên mẫu</label><input id="tN" value="${esc(t.name)}"></div><label class="row" style="gap:6px;align-self:end;height:38px"><input type="checkbox" id="tD" ${t.is_default ? 'checked' : ''}> Dùng làm mẫu mặc định khi in</label>` : `<div><b>${esc(t.name)}</b><div class="small muted">${SRC_L[t.src] || ''}</div></div>`}</div>
    <div class="te"><div class="tb"><button class="btn sm" data-c="bold"><b>B</b></button><button class="btn sm" data-c="italic"><i>I</i></button><button class="btn sm" data-c="underline"><u>U</u></button><button class="btn sm" data-c="justifyCenter">${ico('fa-align-center')}</button><button class="btn sm" data-c="justifyFull">${ico('fa-align-justify')}</button>
    <select id="tV"><option value="">+ Chèn chỗ tự điền…</option>${t.vars.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join('')}</select></div>
    <div id="tE" class="paper" contenteditable="true" spellcheck="false">${t.body.replace(/\{\{(\w+)\}\}/g, (_, k) => chip(k))}</div></div>`,
    foot: `${own ? `<button class="btn danger" id="tX">${ico('fa-trash')} Xóa mẫu</button>` : t.custom ? `<button class="btn" id="tR">${ico('fa-rotate-left')} Khôi phục mẫu gốc</button>` : ''}<span class="grow"></span><button class="btn" data-x2>Đóng</button><button class="btn pri" id="tS">${ico('fa-floppy-disk')} Lưu mẫu</button>` });
  const ed = $('#tE', m.el), done = () => { m.close(); onDone?.(); };
  $('[data-x2]', m.el).onclick = m.close;
  $$('[data-c]', m.el).forEach(b => b.onmousedown = ev => { ev.preventDefault(); document.execCommand(b.dataset.c); });
  $('#tV', m.el).onchange = () => { const k = $('#tV', m.el).value; if (!k) return; ed.focus(); document.execCommand('insertHTML', false, chip(k) + '&nbsp;'); $('#tV', m.el).value = ''; };
  $('#tS', m.el).onclick = run(async () => { const c = ed.cloneNode(true); $$('.ph', c).forEach(s => s.replaceWith(`{{${s.dataset.k}}}`)); await api('PUT', '/api/templates/' + encodeURIComponent(key), { body: c.innerHTML, name: $('#tN', m.el)?.value, is_default: $('#tD', m.el)?.checked }); toast('Đã lưu mẫu'); done(); });
  if ($('#tR', m.el)) $('#tR', m.el).onclick = run(async () => { if (!await ask('Khôi phục mẫu gốc', 'Bỏ các chỉnh sửa, dùng lại mẫu gốc?', { ok: 'Khôi phục', danger: 1 })) return; await api('DELETE', '/api/templates/' + encodeURIComponent(key)); toast('Đã khôi phục'); done(); });
  if ($('#tX', m.el)) $('#tX', m.el).onclick = run(async () => { if (!await ask('Xóa mẫu', `Xóa mẫu «${esc(t.name)}»?`, { ok: 'Xóa', danger: 1 })) return; await api('DELETE', '/api/templates/' + encodeURIComponent(key)); toast('Đã xóa mẫu'); done(); });
}
// thêm mẫu mới cho một mục: chép từ mẫu đang chọn, mẫu cố định → khung có sẵn mọi trường của phiếu
async function tplNew(ent, from, kinds, onDone) {
  const name = await ask('Thêm mẫu mới', `Tên mẫu mới cho «${esc(M.ents[ent].title)}» (chép từ mẫu đang chọn, sửa tiếp ngay sau đây):`, { reason: 1, ok: 'Tạo mẫu' }); if (!name) return;
  const x = await api('POST', '/api/templates', { ent, name, from, kinds }); await tplEdit(x.key, onDone);
}
// khu vực In trong phiếu: chọn mẫu → In / Word; HCNS: Sửa mẫu, Thêm mẫu mới
async function printBar(el, ent, id, r) {
  const d = await api('GET', `/api/tpl-for/${ent}/${id}`), sel = () => $('#pS', el)?.value || d.def, href = w => `/print/${ent}/${id}?tpl=${encodeURIComponent(sel())}${w ? '&fmt=doc' : ''}`;
  const again = () => printBar(el, ent, id, r);
  el.innerHTML = `${d.list.length > 1 ? `<select id="pS" class="psel" title="Chọn mẫu in">${d.list.map(x => `<option value="${esc(x.key)}" ${x.key === d.def ? 'selected' : ''}>${esc(x.name)}${x.is_default ? ' (mặc định)' : ''}</option>`).join('')}</select>` : ''}<a class="btn" target="_blank" id="pI" href="${href()}">${ico('fa-print')} In</a><a class="btn" id="pW" href="${href(1)}">${ico('fa-file-word')} Word</a>${d.can ? `<button class="btn" id="pE">${ico('fa-pen-ruler')} Sửa mẫu</button><button class="btn" id="pN">${ico('fa-file-circle-plus')} Thêm mẫu mới</button>` : ''}`;
  if ($('#pS', el)) $('#pS', el).onchange = () => { $('#pI', el).href = href(); $('#pW', el).href = href(1); };
  const kinds = ['contract', 'decision'].includes(ent) && r.kind ? [r.kind] : [];
  if ($('#pE', el)) $('#pE', el).onclick = run(async () => {
    const k = sel(), x = d.list.find(y => y.key === k);
    if (x?.fixed) { if (await ask('Sửa mẫu', `«${esc(x.name)}» dựng sẵn theo file, không sửa trực tiếp được. Tạo một mẫu sửa được cho mục này (có sẵn mọi trường của phiếu)?`, { ok: 'Tạo mẫu sửa được' })) await tplNew(ent, k, kinds, again); return; }
    await tplEdit(k, again);
  });
  if ($('#pN', el)) $('#pN', el).onclick = run(() => tplNew(ent, sel(), kinds, again));
}
const TPV = { ent: '' };
async function templatesScreen() {
  const d = await api('GET', '/api/templates'), by = {};
  for (const x of d.list) if (x.ent) (by[x.ent] ||= []).push(x);
  const ents = Object.keys(by).sort((a, b) => M.ents[a]?.title.localeCompare(M.ents[b]?.title));
  main().innerHTML = `<div class="ph"><h1>${ico('fa-file-pen')} Mẫu in trên app</h1><p>Mỗi mục (hợp đồng, quyết định, đơn…) có mẫu in riêng; bấm In trong phiếu là app tự điền và in theo mẫu. Sửa mẫu / thêm mẫu mới ngay trong phiếu (nút <b>Sửa mẫu</b>, <b>Thêm mẫu mới</b>) hoặc tại đây. Mẫu có chữ <span class="mau">MẪU</span> là app tự tạo vì chưa có mẫu gốc. File Word / Excel gốc: <a href="#/e/doc_tpl">File mẫu gốc</a>.</p></div>
  <div class="tgrid">${ents.map(e => `<div class="card"><div class="row" style="justify-content:space-between"><b>${esc(M.ents[e]?.title || e)} <span class="tag">${esc(M.ents[e]?.code || '')}</span></b><button class="btn sm" data-new="${e}">${ico('fa-plus')} Thêm mẫu</button></div>
    ${by[e].filter(x => !/^THU_/.test(x.key) || e === 'interview').map(x => `<a href="#" class="ti" data-k="${esc(x.key)}"><span>${esc(x.name)}${x.is_default ? ' <span class="pill g">mặc định</span>' : ''}</span><span class="small muted">${SRC_L[x.src] || ''}${x.custom && x.src !== 'hcns' ? ' · đã sửa' : ''}${x.by ? ` · ${esc(x.by)} ${dmyhm(x.at)}` : ''}</span></a>`).join('')}</div>`).join('')}
  <div class="card"><b>In đúng Bộ 53 biểu mẫu công ty</b><div class="small muted mt">${d.fixed.map(x => `${esc(x.code)} ${esc(x.name)}`).join(' · ')}</div><div class="small mt">Các mục này in theo mẫu gốc. Muốn mẫu khác: mở phiếu → <b>Thêm mẫu mới</b>.</div></div></div>`;
  $$('.ti', main()).forEach(a => a.onclick = run(ev => { ev.preventDefault(); return tplEdit(a.dataset.k, refresh); }));
  $$('[data-new]', main()).forEach(b => b.onclick = run(() => tplNew(b.dataset.new, by[b.dataset.new][0]?.key, [], refresh)));
}

// ---------- hộp duyệt ----------
async function inboxScreen() {
  const [d, done] = await Promise.all([api('GET', '/api/inbox'), api('GET', '/api/inbox/done').catch(() => [])]);
  main().innerHTML = `<div class="ph"><h1>${ico('fa-inbox')} Việc chờ tôi duyệt</h1><p>${d.length} phiếu · tích chọn nhiều phiếu rồi bấm «Duyệt các phiếu đã chọn»</p></div><div class="card filters"><span class="grow"></span><button class="btn ok" id="all" ${d.length ? '' : 'disabled'}>${ico('fa-check-double')} Duyệt các phiếu đã chọn</button></div>
  <div class="tw"><table class="t"><thead><tr><th><input type="checkbox" id="ck"></th><th>Nội dung</th><th>Người làm đơn</th><th>Ngày</th><th>Lý do</th><th>Người trình</th><th>Trình lúc</th></tr></thead><tbody>${d.map(a => `<tr class="c" data-e="${a.ent}" data-id="${a.rec_id}"><td><input type="checkbox" class="pk"></td><td>${esc(a.title)}</td><td>${esc(a.who || '')}</td><td class="nowrap">${esc(a.when || '')}</td><td class="small" style="max-width:320px">${esc(a.reason || '')}</td><td>${esc(a.by_name || '')}</td><td class="nowrap">${dmyhm(a.requested_at)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Không còn phiếu nào chờ duyệt</td></tr>'}</tbody></table></div>
  ${done.length ? `<div class="sec mt">${ico('fa-clock-rotate-left')} Đã duyệt / từ chối 30 ngày qua</div><div class="tw"><table class="t"><thead><tr><th>Nội dung</th><th>Kết quả</th><th>Người duyệt</th><th>Lúc</th><th>Ý kiến</th></tr></thead><tbody>${done.map(a => `<tr class="c" data-e="${a.ent}" data-id="${a.rec_id}"><td>${esc(a.title)}</td><td>${pill(a.status === 'da_duyet' ? 'Đã duyệt' : 'Từ chối', a.status === 'da_duyet' ? 'g' : 'r')}</td><td><b>${esc(a.dec_name || '')}</b></td><td class="nowrap">${dmyhm(a.decided_at)}</td><td class="small">${esc(a.comment || '')}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  $$('tr[data-id]', main()).forEach(t => t.onclick = run(ev => { if (ev.target.type !== 'checkbox') return openDetail(t.dataset.e, +t.dataset.id); }));
  $('#ck').onchange = e => $$('.pk', main()).forEach(c => c.checked = e.target.checked);
  $('#all').onclick = run(async () => { const xs = $$('tr[data-id]', main()).filter(t => $('.pk', t)?.checked); let ok = 0; const er = []; for (const t of xs) try { await api('POST', `/api/e/${t.dataset.e}/${t.dataset.id}/approve`, { ok: true }); ok++; } catch (x) { er.push(x.message); } toast(`Đã duyệt ${ok}/${xs.length}${er[0] ? ' · ' + er[0] : ''}`, !!er.length); refresh(); });
}

// ---------- chất lượng dữ liệu ----------
const SEV = { mau_thuan: ['Mâu thuẫn giữa các file', 'r'], can_cap_nhat: ['Cần cập nhật', 'a'], thong_tin: ['Thông tin', 'b'], da_tu_xu_ly: ['App đã tự xử lý', 'g'] };
async function dataScreen() {
  const [d, j] = await Promise.all([api('GET', '/api/issues'), api('GET', '/api/jobs')]), c = k => d.filter(x => x.severity === k).length;
  main().innerHTML = `<div class="ph"><h1>${ico('fa-database')} Chất lượng dữ liệu</h1><p>Kết quả đối soát chéo khi nạp các file của phòng HCNS và nhật ký việc tự động</p></div>
  <div class="grid4">${Object.entries(SEV).map(([k, v], i) => `<div class="kpi flat ${['r', 'a', 'b', 'g'][i]}"><b>${c(k)}</b><span>${v[0]}</span></div>`).join('')}</div>
  <div class="tw"><table class="t"><thead><tr><th>Mức</th><th>Nguồn</th><th>Vấn đề</th><th>Chi tiết / cách xử lý</th></tr></thead><tbody>${d.map(x => `<tr><td>${pill(...SEV[x.severity])}</td><td><span class="tag">${esc(x.src)}</span></td><td>${esc(x.title)}</td><td class="muted">${esc(x.detail)}</td></tr>`).join('')}</tbody></table></div>
  <div class="sec mt">Việc tự động đã chạy</div><div class="tw" style="max-height:280px"><table class="t"><thead><tr><th>Việc</th><th>Kỳ</th><th>Kết quả</th><th>Lúc</th></tr></thead><tbody>${j.map(x => `<tr><td>${esc({ ky_cong: 'Mở kỳ công', nhap_bh_cd: 'Nháp bảng BH + công đoàn', cong_phep: 'Cộng phép tháng', nhap_luong: 'Nháp bảng lương', bc_dinh_ky: 'Lập báo cáo định kỳ' }[x.name] || x.name)}</td><td>${esc(x.period)}</td><td>${esc(x.result)}</td><td>${dmyhm(x.at)}</td></tr>`).join('')}</tbody></table></div>`;
}

// ---------- cấu hình, nhật ký ----------
async function settings() {
  const s = await api('GET', '/api/settings');
  const LB = { ins: ['Bảo hiểm (%)', { dn_bhxh: 'DN BHXH', dn_bhyt: 'DN BHYT', dn_bhtn: 'DN BHTN', nld_bhxh: 'NLĐ BHXH', nld_bhyt: 'NLĐ BHYT', nld_bhtn: 'NLĐ BHTN' }], cd: ['Công đoàn (%)', { kpcd: 'KPCĐ công ty trích', dpcd: 'ĐPCĐ NLĐ trích', kpcd_nop: 'KPCĐ nộp cấp trên', kpcd_giu: 'KPCĐ giữ lại', dpcd_nop: 'ĐPCĐ nộp', dpcd_giu: 'ĐPCĐ giữ lại' }], pay: ['Lương', { std_days: 'Công chuẩn', trial_pct: '% lương thử việc', meal_day: 'Tiền ăn / công (đ)', ded_self: 'Giảm trừ bản thân (đ)', ded_dep: 'Giảm trừ người phụ thuộc (đ)' }] };
  main().innerHTML = `<div class="ph"><h1>${ico('fa-sliders')} Cấu hình tỷ lệ</h1><p>Tỷ lệ do HCNS cấu hình. Bảng đã lập giữ tỷ lệ tại thời điểm lập.</p></div>${Object.entries(LB).map(([k, [t, fs_]]) => `<div class="card mb"><div class="sec">${t}</div><div class="fg">${Object.entries(fs_).map(([f, l]) => `<div class="fld"><label>${l}</label><input data-s="${k}" data-k="${f}" value="${s[k][f]}"></div>`).join('')}</div><button class="btn pri mt" data-save="${k}">Lưu</button></div>`).join('')}
  <div class="card mb"><div class="sec">${ico('fa-qrcode')} Tài khoản nhận tiền ăn (mã QR trên thông báo tiền ăn)</div><div class="fg">
    <div class="fld"><label>Mã ngân hàng</label><input id="mbk" value="${esc(s.meal?.bank || '')}" placeholder="VD: VCB, MB, TCB, BIDV, ACB"></div>
    <div class="fld"><label>Số tài khoản</label><input id="mac" value="${esc(s.meal?.acc || '')}"></div>
    <div class="fld"><label>Tên chủ tài khoản</label><input id="mnm" value="${esc(s.meal?.name || '')}" placeholder="VIẾT HOA KHÔNG DẤU"></div></div>
    <button class="btn pri mt" id="smeal">Lưu</button><p class="muted small">Mã QR theo chuẩn VietQR — quét bằng mọi app ngân hàng, đã điền sẵn số tiền và nội dung «TIEN AN tháng mã NV».</p></div>
  <div class="card"><div class="sec">Biểu thuế TNCN lũy tiến</div><div class="fld"><label>Mỗi dòng: thu nhập tính thuế đến | thuế suất %</label><textarea id="tx" rows="6">${s.pay.tax.map(x => `${x[0] ?? 'trên'} | ${x[1]}`).join('\n')}</textarea></div><button class="btn pri mt" id="stx">Lưu biểu thuế</button><p class="muted small">Mỗi dòng: mức thu nhập tính thuế đến (đ) | thuế suất (%). Cập nhật khi quy định thay đổi.</p></div>`;
  $$('[data-save]', main()).forEach(b => b.onclick = run(async () => { const k = b.dataset.save, o = { ...s[k] }; $$(`[data-s="${k}"]`, main()).forEach(i => o[i.dataset.k] = +i.value.replace(',', '.')); await api('PUT', '/api/settings/' + k, o); toast('Đã lưu'); }));
  $('#smeal').onclick = run(async () => { await api('PUT', '/api/settings/meal', { bank: $('#mbk').value.trim().toUpperCase(), acc: $('#mac').value.replace(/\s/g, ''), name: $('#mnm').value.trim().toUpperCase() }); toast('Đã lưu tài khoản nhận tiền ăn'); });
  $('#stx').onclick = run(async () => { const tax = $('#tx').value.trim().split('\n').map(l => { const [a, b] = l.split('|').map(x => x.trim()); return [isNaN(+a) ? null : +a, +b]; }); await api('PUT', '/api/settings/pay', { ...s.pay, tax }); toast('Đã lưu'); });
}
async function audit() { const d = await api('GET', '/api/audit'); main().innerHTML = `<div class="ph"><h1>${ico('fa-clock-rotate-left')} Nhật ký thao tác</h1><p>300 thao tác gần nhất</p></div><div class="tw"><table class="t"><thead><tr><th>Thời gian</th><th>Người</th><th>Thao tác</th><th>Dữ liệu</th><th>Ghi chú</th></tr></thead><tbody>${d.map(a => `<tr><td class="nowrap">${dmyhm(a.at)}</td><td>${esc(a.by || 'Hệ thống')}</td><td>${esc(ACTION[a.action] || a.action)}</td><td>${esc(M.ents[a.ent]?.title || a.ent)}${a.rec_id ? ' #' + a.rec_id : ''}</td><td>${esc(a.note || '')}</td></tr>`).join('')}</tbody></table></div>`; }

// ---------- định tuyến ----------
async function route() {
  const [k, a, b] = location.hash.slice(2).split('?')[0].split('/').map(decodeURIComponent);
  if (!k) { location.replace('#/' + M.home); return; }
  const V = { timesheet, org, inbox: inboxScreen, data: dataScreen, settings, audit, users: usersScreen, portal: portalScreen, recruit, templates: templatesScreen };
  document.body.classList.toggle('embed', /[?&]embed=1/.test(location.hash));
  refresh = run(k === 'd' ? () => dashboard(a) : k === 'e' ? () => listScreen(a) : k === 'r' ? () => reportScreen(a) : V[a]);
  dashboard.pop = k === 'd' && a === 'DB06';
  markNav(); main().innerHTML = '<div class="empty">Đang tải…</div>'; $$('.ov').forEach(x => x.remove()); document.body.classList.remove('nav-open');
  try { if (!['d', 'e', 'r'].includes(k) && !V[a]) throw new Error('Không tìm thấy trang'); if (k === 'e' && b) await listScreen(a, +b); else await (k === 'd' ? dashboard(a) : k === 'e' ? listScreen(a) : k === 'r' ? reportScreen(a) : V[a]());
    if (a === 'portal' && /^trn\d+$/.test(b || '')) { history.replaceState(null, '', '#/v/portal'); myTraining((portalScreen.data?.trainings || []).find(t => t.id === +b.slice(3))); } }   /* thông báo khóa học → mở hộp thông tin 1 lần; bỏ đuôi trn… khỏi địa chỉ để tải lại trang không tự mở lại */ catch (e) { main().innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function boot() {
  try { if (localStorage.hrTheme) document.documentElement.dataset.theme = localStorage.hrTheme; } catch { }
  const r = await fetch('/api/meta'); if (r.status === 401) return showLogin();
  M = await r.json(); shell(); window.onhashchange = route; route(); live();
}
// cập nhật trực tiếp: ai đó lưu / duyệt / xóa ở máy khác (hoặc việc nền chạy) → số liệu, bảng, biểu đồ đang mở tự tải lại.
// Đang mở hộp thoại, đang gõ hoặc đang phóng to một khung thì chờ xong mới tải, để không mất chữ đang nhập.
function live() {
  let v = null, wait = false, es;
  const busy = () => $('.ov') || $('.bx.big') || (document.activeElement?.matches('input:not([type=checkbox]),textarea,select') && document.activeElement.closest('#main'));
  const reload = async () => {
    if (busy() || document.hidden) return void (wait = true);
    wait = false; const y = $('#main')?.scrollTop, wy = scrollY;
    try { await refresh(); } finally { if ($('#main')) $('#main').scrollTop = y; scrollTo(0, wy); }
    badge();
  };
  const open = () => { es = new EventSource('/api/live'); es.onmessage = ev => { const nv = ev.data; if (v !== null && nv !== v && Date.now() - (api.wrote || 0) > 2500) reload(); v = nv; }; };
  open();
  setInterval(() => { if (wait) reload(); }, 2000);   // hết bận (đóng hộp thoại, rời ô nhập, quay lại tab) → tải phần đã lỡ
  document.addEventListener('visibilitychange', () => { if (!document.hidden && wait) reload(); });
}
boot();
