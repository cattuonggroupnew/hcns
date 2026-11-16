// Máy chủ CTG-HCNS — node server/server.js → http://localhost:3600
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Busboy = require('busboy');
const { q, one, tx } = require('./db');
const { migrate } = require('./schema');
const M = require('./meta');
const C = require('./core');
const B = require('./biz');
const V = require('./reports');
const P = require('./print');
const J = require('./jobs');
const S = require('./sheets');
const PF = require('./platform');
const { buildXlsx, readXlsx } = require('./xlsx');
const { bad, deny, notFound, HttpError, can } = C;

const PORT = +(process.env.PORT || 3600), HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, '..', 'public'), DATA = path.join(__dirname, '..', 'data'), FILES = path.join(DATA, 'files');
const SESSION_H = 12;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const send = (res, code, body, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const html = (res, s, q2 = {}, name = 'bieu-mau') => q2.fmt === 'doc' ? sendFile(res, Buffer.from('﻿' + s.replace(/<div class="bar">[\s\S]*?<\/div>/, '').replace(' contenteditable="true"', '')), name + '.doc', 'application/msword') : send(res, 200, s, { 'Content-Type': 'text/html; charset=utf-8' });
const sendFile = (res, buf, name, mime, inline) => { res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store', 'Content-Length': buf.length, 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}` }); res.end(buf); };
const readJson = req => new Promise((ok, no) => { const a = []; let z = 0; req.on('data', c => { z += c.length; if (z > 8e6) { no(new HttpError(413, 'Dữ liệu quá lớn')); req.destroy(); } else a.push(c); }); req.on('end', () => { try { ok(a.length ? JSON.parse(Buffer.concat(a).toString('utf8')) : {}); } catch { no(new HttpError(400, 'JSON không hợp lệ')); } }); req.on('error', no); });
const readUpload = req => new Promise((ok, no) => { const files = [], fields = {}; const bb = Busboy({ headers: req.headers, limits: { fileSize: 50e6, files: 30 }, defParamCharset: 'utf8' }); bb.on('field', (k, v) => { fields[k] = v; }); bb.on('file', (_n, s, i) => { const c = []; s.on('data', x => c.push(x)); s.on('end', () => { if (s.truncated) return no(new HttpError(413, 'Tệp quá 50MB')); const b = Buffer.concat(c); if (b.length) files.push({ buffer: b, name: i.filename, mime: i.mimeType }); }); }); bb.on('close', () => ok({ files, fields })); bb.on('error', no); req.pipe(bb); });
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(a => a[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const hashPw = pw => { const s = crypto.randomBytes(16).toString('hex'); return s + ':' + crypto.scryptSync(pw, s, 32).toString('hex'); };
const checkPw = (pw, h) => { if (!h) return false; const [s, x] = h.split(':'); return crypto.timingSafeEqual(Buffer.from(x, 'hex'), crypto.scryptSync(pw, s, 32)); };

// ---------- phiên ----------
const NO_LOGIN = /^(1|true|yes)$/i.test(process.env.NO_LOGIN || ''), NO_LOGIN_USER = process.env.NO_LOGIN_USER || 'admin';
const UC = 'u.id, u.username, u.full_name, u.role, u.title, u.emp_id, u.dept_id, u.legal_ids, u.items, u.must_change';
async function userFromReq(req) {
  const sid = cookies(req).hr_sid;
  const u = sid && await one(`SELECT ${UC} FROM hr_session s JOIN hr_user u ON u.id=s.user_id WHERE s.sid=$1 AND s.expires_at>now() AND u.active`, [sid]);
  if (!NO_LOGIN) return u || null;
  const r = u || await one(`SELECT ${UC} FROM hr_user u WHERE lower(u.username)=lower($1)`, [NO_LOGIN_USER]);
  return r && { ...r, must_change: false };
}
async function newSession(res, uid, body = { ok: true }) { const sid = crypto.randomBytes(32).toString('base64url'); await q(`INSERT INTO hr_session (sid,user_id,expires_at) VALUES ($1,$2,now()+interval '${SESSION_H} hours')`, [sid, uid]); send(res, 200, body, { 'Set-Cookie': `hr_sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_H * 3600}` }); }
const fails = new Map();
async function login(req, res) {
  const { username, password } = await readJson(req), key = String(username || '').toLowerCase(), f = fails.get(key) || { n: 0, t: 0 };
  if (f.n >= 5 && Date.now() - f.t < 300e3) bad('Sai mật khẩu quá 5 lần — thử lại sau 5 phút');
  const u = await one('SELECT * FROM hr_user WHERE lower(username)=$1', [key]);
  if (!u || !u.active || !checkPw(password || '', u.pw_hash)) { fails.set(key, { n: f.n + 1, t: Date.now() }); bad('Sai tài khoản hoặc mật khẩu'); }
  fails.delete(key); await q('UPDATE hr_user SET last_login=now() WHERE id=$1', [u.id]);
  await q("INSERT INTO hr_audit (ent,rec_id,action,user_id) VALUES ('user',$1,'dang_nhap',$1)", [u.id]);
  await newSession(res, u.id, { ok: true, must_change: u.must_change });
}

const NSR = ['tp_hcns', 'cv_hcns', 'bgd', 'ke_toan', 'admin', 'truong_bp'], HCR = ['tp_hcns', 'cv_hc', 'cv_hcns', 'bgd', 'admin'];   // vai trò xem tổng quan NS / HC
async function metaFor(user) {
  const strip = e => ({ ...e, fields: e.fields.filter(f => !f.hide), perm: { r: can(user, e, 'r'), c: can(user, e, 'c'), u: can(user, e, 'u'), d: can(user, e, 'd'), a: can(user, e, 'a'), x: can(user, e, 'x') } });
  const ents = Object.fromEntries(Object.values(M.E).map(e => [e.key, strip(e)]));
  // menu: chỉ mục được giao (items) mà vai trò cho phép; NLĐ dùng menu cá nhân
  const roleOk = it => Array.isArray(user.items) && /^[rd]:/.test(it) ? true : it.startsWith('e:') ? ents[it.slice(2)].perm.r : it.startsWith('r:') ? V.roleSees(user, it.slice(2))
    : it === 'd:NS' ? NSR.includes(user.role) : it === 'd:HC' ? HCR.includes(user.role) : it.startsWith('d:') ? user.role !== 'nld'
    : it === 'v:portal' ? !!user.emp_id : it === 'v:recruit' ? ents.candidate.perm.r : it === 'v:templates' ? ['cv_hc', 'cv_hcns', 'tp_hcns', 'admin'].includes(user.role) : it === 'v:data' ? ['cv_hc', 'cv_hcns', 'tp_hcns', 'admin'].includes(user.role) : ['v:settings', 'v:audit', 'v:users'].includes(it) ? ['tp_hcns', 'admin'].includes(user.role) : true;
  const allowed = it => (it === 'v:portal' || C.has(user, it)) && roleOk(it);   // chấm công & đơn của tôi: luôn có, không cần giao
  const label = it => it.startsWith('e:') ? [it, ents[it.slice(2)].title, ents[it.slice(2)].code] : it.startsWith('r:') ? [it, V.SPEC[it.slice(2)]?.[0] || it, it.slice(2)] : it === 'v:timesheet' ? [it, 'Bảng chấm công', 'TL01'] : it === 'v:org' ? [it, 'Sơ đồ cơ cấu tổ chức', 'CCTC04'] : it === 'v:recruit' ? [it, 'Quy trình tuyển dụng', 'TD-QT'] : it === 'v:templates' ? [it, 'Mẫu in trên app (sửa được)', 'MẪU'] : [it, it, ''];
  const build = (src, ok) => src.map(([g, items]) => [g, items.map(([l, ic, x]) => Array.isArray(x) ? [l, ic, x.filter(ok).map(label)] : ok(x) ? [l, ic, x] : null).filter(i => i && (!Array.isArray(i[2]) || i[2].length))]).filter(g => g[1].length);
  const menu = build(user.role === 'nld' && !Array.isArray(user.items) ? M.MENU_ME : M.MENU, allowed), first = (menu.find(g => g[0] !== 'CỦA TÔI') || menu[0])?.[1][0];   // trang chủ: mục công việc đầu tiên, không phải trang cá nhân
  // mở app / đăng nhập: vào thẳng «Chấm công & đơn từ» (ai có hồ sơ nhân viên); không có thì về tổng quan như cũ
  const home = allowed('v:portal') ? 'v/portal' : ['d:NS', 'd:HC'].find(allowed)?.replace(':', '/') || (first ? (Array.isArray(first[2]) ? first[2][0][0] : first[2]).replace(':', '/') : 'v/inbox');
  // trưởng phòng / quản trị: toàn bộ mục để phân quyền từng người
  const menuAll = ['tp_hcns', 'admin'].includes(user.role) ? build(M.MENU, () => true) : null;
  const pool2 = await q("SELECT id, full_name, role, title, emp_id FROM hr_user WHERE active ORDER BY username");
  // hồ sơ của chính tài khoản: điền sẵn (và khóa) người làm đơn trên các đơn từ
  const meEmp = user.emp_id ? await one('SELECT e.id, e.code, e.full_name, e.title, e.legal_id, e.dept_id, l.short AS legal, d.name AS dept FROM hr_employee e LEFT JOIN hr_legal l ON l.id=e.legal_id LEFT JOIN hr_dept d ON d.id=e.dept_id WHERE e.id=$1', [user.emp_id]) : null;
  return { me: user, meEmp, roles: M.ROLES, menu, menuAll, home, ents, virt: M.VIRT, piiRoles: M.PII_ROLES, payRoles: M.PAY_ROLES, noLogin: NO_LOGIN, today: C.today(), users: NO_LOGIN ? pool2 : [],
    legals: await q('SELECT id, code, short FROM hr_legal ORDER BY id'), depts: await q('SELECT id, code, name FROM hr_dept ORDER BY name'), demo: (await one('SELECT (SELECT count(*) FROM hr_attendance WHERE is_demo) + (SELECT count(*) FROM hr_asset WHERE is_demo) n')).n };
}

// ---------- định tuyến ----------
const routes = [];
const r = (method, pattern, fn, opts = {}) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn, ...opts });
const need = (u, roles) => { if (u.role !== 'admin' && !roles.includes(u.role)) deny(); };
const needIt = (u, roles, it) => { need(u, roles); if (!C.has(u, it)) deny(); };   // + mục menu được giao (hr_user.items)
r('POST', '/api/login', login, { open: 1 });
r('POST', '/api/logout', async (req, res) => { const s = cookies(req).hr_sid; if (s) await q('DELETE FROM hr_session WHERE sid=$1', [s]); send(res, 200, { ok: true }, { 'Set-Cookie': 'hr_sid=; Path=/; Max-Age=0' }); }, { open: 1 });
r('GET', '/api/login-info', async (req, res) => send(res, 200, { noLogin: NO_LOGIN }), { open: 1 });
r('POST', '/api/as/:id', async (req, res, u, p) => { if (!NO_LOGIN) deny('Chỉ dùng khi chạy thử'); notFound(await one('SELECT id FROM hr_user WHERE id=$1 AND active', [+p.id]), 'tài khoản'); await newSession(res, +p.id); });
r('POST', '/api/password', async (req, res, u) => { const { old, pw } = await readJson(req); const x = await one('SELECT pw_hash FROM hr_user WHERE id=$1', [u.id]); if (!checkPw(old || '', x.pw_hash)) bad('Mật khẩu hiện tại không đúng'); if (!pw || pw.length < 6) bad('Mật khẩu mới tối thiểu 6 ký tự'); await q('UPDATE hr_user SET pw_hash=$1, must_change=false WHERE id=$2', [hashPw(pw), u.id]); send(res, 200, { ok: true }); });
r('GET', '/api/meta', async (req, res, u) => send(res, 200, await metaFor(u)));
// thông báo trong app (thay email): có đơn cần duyệt, đơn đã duyệt / từ chối, lịch phỏng vấn, phiếu lương…
// việc đã xử lý xong (phiếu đã duyệt / từ chối / huỷ / xoá, lịch PV đã xác nhận) → thông báo «cần làm» tự coi như đã đọc
const tidyNotices = uid => q(`UPDATE hr_notice n SET read_at = now() WHERE n.user_id = $1 AND n.read_at IS NULL AND n.link ~ '^e/[a-z_]+/[0-9]+$' AND (
  n.title LIKE 'Cần duyệt:%' AND NOT EXISTS (SELECT 1 FROM hr_approval a WHERE a.ent = split_part(n.link, '/', 2) AND a.rec_id = split_part(n.link, '/', 3)::int AND a.status = 'cho_duyet' AND a.requested_at <= n.at)
  OR n.title LIKE '%cần xác nhận' AND split_part(n.link, '/', 2) = 'interview' AND NOT EXISTS (SELECT 1 FROM hr_interview i WHERE i.id = split_part(n.link, '/', 3)::int AND i.confirm = 'cho_xn' AND i.status = 'moi'))`, [uid]);
r('GET', '/api/notices', async (req, res, u) => (await tidyNotices(u.id), send(res, 200, { unread: (await one('SELECT count(*) n FROM hr_notice WHERE user_id = $1 AND read_at IS NULL', [u.id])).n, items: await q('SELECT * FROM hr_notice WHERE user_id = $1 ORDER BY id DESC LIMIT 40', [u.id]) })));
r('POST', '/api/notices/read', async (req, res, u) => { const b = await readJson(req); await q(`UPDATE hr_notice SET read_at = now() WHERE user_id = $1 AND read_at IS NULL ${b.id ? 'AND id = $2' : ''}`, b.id ? [u.id, +b.id] : [u.id]); send(res, 200, { ok: true }); });
// chọn nhân viên trên form → tự điền pháp nhân, bộ phận, chức danh từ hồ sơ (sổ quản lý lao động)
r('GET', '/api/emp-brief/:id', async (req, res, u, p) => {
  const e = +p.id === u.emp_id ? await one('SELECT * FROM hr_employee WHERE id = $1', [u.emp_id]) : (await C.get('employee', p.id, u)).row;
  const x = await one('SELECT (SELECT short FROM hr_legal WHERE id = $1) legal, (SELECT name FROM hr_dept WHERE id = $2) dept, (SELECT full_name FROM hr_employee WHERE id = $3) manager', [e.legal_id, e.dept_id, e.manager_id]);
  send(res, 200, { id: e.id, code: e.code, full_name: e.full_name, legal_id: e.legal_id, legal: x.legal, dept_id: e.dept_id, dept: x.dept, title: e.title, level: e.level, manager: x.manager, join_on: e.join_on });
});
r('GET', '/api/opts/:ent', async (req, res, u, p, qs) => {
  const e = M.E[p.ent] || bad('Sai loại'); const w = [], pr = []; const a = (s, ...v) => { const b = pr.length; pr.push(...v); w.push(s.replace(/\$(\d+)/g, (_, i) => '$' + (b + +i))); };   // $1 dùng 2 lần (L OR P) → cùng một tham số
  if (!['employee', 'legal', 'dept', 'vpp_item', 'att_type', 'room', 'vehicle', 'position'].includes(p.ent)) { if (!can(u, e, 'r')) deny(); C.scopeSql(e, u, a); }
  // người (nhân viên, ứng viên): không trả sẵn cả danh sách — gõ ≥ 2 ký tự để tìm; all=1 chỉ cho người xem được hồ sơ (bảng nhiều dòng chọn theo mã)
  if (['employee', 'candidate'].includes(p.ent) && String(qs.q || '').trim().length < 2 && !(qs.all === '1' && can(u, e, 'r') && C.seesAll(u, e))) return send(res, 200, []);
  if (qs.q) a(`(${e.disp}) ILIKE $1`, `%${qs.q}%`);
  const hasCode = C.F[p.ent].code, cols = [`t.id`, `(${e.disp}) AS label`, ...(hasCode ? ['t.code'] : []), ...['name', 'unit', 'full_name'].filter(k => C.F[p.ent][k]).map(k => 't.' + k), ...(p.ent === 'candidate' ? ['t.status'] : [])];
  const ord = hasCode ? M.CODE_ORDER : '2';   // có mã: theo số thứ tự trong mã (NV001, NV002…, VPP01…), mã đặc biệt xuống cuối
  send(res, 200, await q(`SELECT ${cols.join(',')} FROM ${e.table} t ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY ${ord} LIMIT ${qs.q ? 30 : 400}`, pr));
});
r('GET', '/api/e/:ent', async (req, res, u, p, qs) => send(res, 200, await C.list(p.ent, u, qs)));
r('GET', '/api/e/:ent/export', async (req, res, u, p, qs) => {
  const e = M.E[p.ent] || bad('Sai loại'); if (!can(u, e, 'x')) deny('Bạn không được xuất dữ liệu này');
  const { rows } = await C.list(p.ent, u, { ...qs, limit: 20000 }), f = e.fields.filter(x => !x.grid && !x.hide && x.t !== 'json' && x.t !== 'days');
  const data = [f.map(x => x.l), ...rows.map(r2 => f.map(x => { const v = r2[x.k]; return x.t === 'ref' ? r2[x.k + '__l'] ?? '' : x.t === 'sel' ? (x.o || []).find(o => o[0] === v)?.[1] ?? v ?? '' : x.t === 'date' ? C.dmy(v) : x.t === 'bool' ? (v ? 'Có' : '') : ['money', 'num', 'int'].includes(x.t) ? (v == null ? null : +v) : v ?? ''; }))];
  await C.audit({ q }, p.ent, null, 'xuat_excel', null, null, u, `${rows.length} dòng`);
  sendFile(res, buildXlsx({ sheet: e.code || e.key, rows: data, boldRows: [0], widths: f.map(() => 20) }), `${e.code || e.key}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});
r('GET', '/api/e/:ent/:id', async (req, res, u, p, qs) => { const x = await C.get(p.ent, p.id, u, { reveal: qs.reveal === '1' }); if (qs.reveal === '1') await C.audit({ q }, p.ent, +p.id, 'xem_dinh_danh', null, null, u); if (S.TABLE[p.ent]) x.table = await S.table(p.ent, x.row); x.history = await q('SELECT a.action, a.at, a.note, u.full_name AS by FROM hr_audit a LEFT JOIN hr_user u ON u.id=a.user_id WHERE a.ent=$1 AND a.rec_id=$2 ORDER BY a.at DESC LIMIT 40', [p.ent, +p.id]); send(res, 200, x); });
r('POST', '/api/e/:ent', async (req, res, u, p) => send(res, 200, await C.create(p.ent, await readJson(req), u)));
r('PUT', '/api/e/:ent/:id', async (req, res, u, p) => send(res, 200, await C.update(p.ent, p.id, await readJson(req), u)));
r('DELETE', '/api/e/:ent/:id', async (req, res, u, p) => send(res, 200, await C.remove(p.ent, p.id, u)));
r('POST', '/api/e/:ent/:id/submit', async (req, res, u, p) => send(res, 200, await C.submit(p.ent, p.id, u, await readJson(req))));
r('POST', '/api/e/:ent/:id/approve', async (req, res, u, p) => { const b = await readJson(req); send(res, 200, await C.approve(p.ent, p.id, u, b)); });
r('POST', '/api/e/:ent/:id/act/:k', async (req, res, u, p) => send(res, 200, await C.act(p.ent, p.id, p.k, u, await readJson(req))));
r('POST', '/api/e/:ent/:id/note', async (req, res, u, p) => { await C.addNote(p.ent, p.id, (await readJson(req)).body, u); send(res, 200, { ok: true }); });
r('POST', '/api/e/:ent/:id/files', async (req, res, u, p) => {
  const g = await C.get(p.ent, p.id, u); if (!g.perm.files) deny(); const { files, fields } = await readUpload(req); if (!files.length) bad('Chưa chọn tệp');
  const dir = path.join(FILES, p.ent, p.id); fs.mkdirSync(dir, { recursive: true });
  // nhiều loại giấy tờ (hồ sơ NV…): đặt tên tệp theo mã + loại, giữ tên gốc khi chỉ có 1 loại (file mẫu, bản ký)
  const kinds = M.E[p.ent].files || [], lab = kinds.length > 1 && kinds.find(k => k[0] === fields.kind)?.[1], who = g.row.code || g.row.no || '';
  const BAN = ['.exe', '.bat', '.cmd', '.js', '.vbs', '.ps1', '.html', '.htm', '.xhtml', '.svg', '.hta', '.scr', '.msi', '.lnk'];
  for (const f of files) { const ext = path.extname(f.name).toLowerCase(); if (BAN.includes(ext)) bad(`Không nhận tệp ${ext}`); }   // kiểm hết trước khi ghi tệp nào
  for (const [i, f] of files.entries()) { const ext = path.extname(f.name).toLowerCase(); if (lab) f.name = `${who ? who + ' - ' : ''}${lab.replace(/[\\/:*?"<>|]/g, '-')}${files.length > 1 ? ` (${i + 1})` : ''}${ext}`; const disk = path.join(dir, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}${ext}`); fs.writeFileSync(disk, f.buffer); await q('INSERT INTO hr_file (ent,rec_id,kind,name,mime,size,path,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [p.ent, +p.id, fields.kind || 'tai_lieu', f.name, f.mime, f.buffer.length, path.relative(FILES, disk), u.id]); await C.audit({ q }, p.ent, +p.id, 'tai_tep', null, null, u, f.name); }
  // khóa đào tạo: tải «File kết quả khóa học» dạng Excel (cột Mã NV / Họ tên, Kết quả, Điểm / nhận xét) → tự điền kết quả từng học viên
  let note = null;
  if (p.ent === 'training' && fields.kind === 'kq') for (const f of files.filter(x => /\.xlsx$/i.test(x.name))) {
    const rows = readXlsx(f.buffer)[0]?.rows || [], hi = rows.findIndex(x => x?.some(s => /mã\s*nv|họ.*tên/i.test(String(s ?? '')))); if (hi < 0) { note = 'File kết quả đã lưu — không thấy cột «Mã NV» / «Họ tên» nên chưa tự điền kết quả'; continue; }
    const hd = rows[hi].map(s => String(s ?? '').trim().toLowerCase()), col = re => hd.findIndex(h => re.test(h));
    const cC = col(/mã\s*nv|mã nhân viên/), cN = col(/họ.*tên/), cR = col(/kết quả|xếp loại|đạt/), cS = col(/điểm|nhận xét/);
    const emps = [...(g.row.emps || [])]; let n = 0;
    for (const r of rows.slice(hi + 1)) {
      const code = cC >= 0 ? String(r?.[cC] ?? '').trim() : '', name = cN >= 0 ? String(r?.[cN] ?? '').trim() : ''; if (!code && !name) continue;
      let x = emps.find(e => code && e.code === code) || emps.find(e => name && String(e.name || '').toLowerCase() === name.toLowerCase());
      if (!x) { const e = await one('SELECT code, full_name FROM hr_employee WHERE code = $1 OR lower(full_name) = lower($2) ORDER BY (code = $1) DESC LIMIT 1', [code, name]); if (!e) continue; x = { code: e.code, name: e.full_name, result: '', score: '' }; emps.push(x); }
      const rs = cR >= 0 ? String(r?.[cR] ?? '').trim() : ''; if (rs) x.result = /không|chưa|trượt|fail/i.test(rs) ? 'Chưa đạt' : /vắng/i.test(rs) ? 'Vắng' : /đạt|pass|x|có/i.test(rs) ? 'Đạt' : rs;
      if (cS >= 0 && r?.[cS] != null && r[cS] !== '') x.score = String(r[cS]); n++;
    }
    if (n) { await C.update('training', p.id, { emps }, u); note = `Đã điền kết quả ${n} học viên từ file`; }
  }
  send(res, 200, { ok: true, note });
});
// ---------- học viên tự nộp kết quả đào tạo (học nơi khác / khóa bên ngoài): kết quả + điểm + file chứng chỉ → ghi vào dòng học viên của khóa, báo HCNS ----------
const BAN_EXT = ['.exe', '.bat', '.cmd', '.js', '.vbs', '.ps1', '.html', '.htm', '.xhtml', '.svg', '.hta', '.scr', '.msi', '.lnk'];
async function trainSelf(u, id, req) {
  const me = await one('SELECT id, code, full_name, legal_id FROM hr_employee WHERE id = $1', [u.emp_id || 0]) || bad('Tài khoản chưa gắn với hồ sơ nhân viên');
  const { files, fields: b } = await readUpload(req);
  for (const f of files) if (BAN_EXT.includes(path.extname(f.name).toLowerCase())) bad(`Không nhận tệp ${path.extname(f.name)}`);
  const result = ['Đạt', 'Chưa đạt'].includes(b.result) ? b.result : bad('Chọn kết quả: Đạt / Chưa đạt');
  if (!files.length && !String(b.score || '').trim()) bad('Tải file kết quả / chứng chỉ hoặc ghi điểm, nhận xét');
  let t;
  if (id) {
    t = await one('SELECT * FROM hr_training WHERE id = $1', [+id]);
    if (!t || !(t.emps || []).some(x => x.code === me.code)) bad('Bạn không có trong danh sách học viên của khóa này');
    if (t.state === 'huy') bad('Khóa đào tạo đã hủy');
  } else {   // khóa học bên ngoài nhân viên tự khai → lập khóa mới (chờ HCNS xác nhận)
    for (const k of ['name', 'from_on']) if (!String(b[k] || '').trim()) bad(k === 'name' ? 'Nhập tên khóa học' : 'Chọn ngày học');
    if (!(+b.hours > 0)) bad('Nhập tổng số giờ học');
    const x = await C.create('training', { name: b.name.trim(), legal_id: me.legal_id, kind: 'chuyen_mon', from_on: b.from_on, to_on: b.to_on || null, sessions: Math.max(1, +b.sessions || 1), hours: +b.hours, mode: b.mode || 'truc_tiep', place: b.place || null, trainer: b.trainer || null, emps: [{ code: me.code, name: me.full_name, result: '', score: '' }], notified: [me.code], state: 'hoan_thanh', note: `Học bên ngoài — ${me.full_name} (${me.code}) tự khai trên app, chờ HCNS xác nhận` }, u, { system: true });
    t = x.row;
  }
  const dir = path.join(FILES, 'training', String(t.id)); fs.mkdirSync(dir, { recursive: true });
  for (const [i, f] of files.entries()) { const ext = path.extname(f.name).toLowerCase(), disk = path.join(dir, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}${ext}`); fs.writeFileSync(disk, f.buffer);
    await q('INSERT INTO hr_file (ent,rec_id,kind,name,mime,size,path,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', ['training', t.id, 'hv', `${me.code} ${me.full_name} - Kết quả${files.length > 1 ? ` (${i + 1})` : ''}${ext}`, f.mime, f.buffer.length, path.relative(FILES, disk), u.id]); }
  const emps = (t.emps || []).map(x => x.code === me.code ? { ...x, result, score: String(b.score || '').trim() || x.score || '', self: C.dmy(C.today()) } : x);
  await C.update('training', t.id, { emps }, u, { system: true });
  await C.audit({ q }, 'training', t.id, 'hv_nop_kq', null, null, u, `${me.code}: ${result}${files.length ? ` · ${files.length} tệp` : ''}`);
  const hc = (await q("SELECT id FROM hr_user WHERE active AND (id = $1 OR role = 'tp_hcns')", [t.created_by || 0])).map(x => x.id).filter(x => x !== u.id);
  if (hc.length) await C.notify({ q, one }, hc, `${me.full_name} nộp kết quả đào tạo: ${t.name}`, `${result}${b.score ? ' · ' + b.score : ''}${files.length ? ` · ${files.length} tệp đính kèm` : ''}${id ? '' : ' · khóa bên ngoài, cần xác nhận'}`, `e/training/${t.id}`);
  return { ok: true, id: t.id };
}
// ---------- lịch sử làm việc của 1 người (HD13 bấm vào dòng): trước khi vào công ty (bảng từ CV) + tại công ty theo từng chặng pháp nhân / phòng / chức danh ----------
r('GET', '/api/emp-history/:id', async (req, res, u, p) => {
  const e = (await C.get('employee', p.id, u)).row;
  const L = Object.fromEntries((await q('SELECT id, short FROM hr_legal')).map(x => [x.id, x.short])), D = Object.fromEntries((await q('SELECT id, name FROM hr_dept')).map(x => [x.id, x.name]));
  const cand = await one("SELECT id, code, jobs, exp FROM hr_candidate WHERE $1 LIKE 'Từ ứng viên ' || code || '%' OR ($2::text IS NOT NULL AND id_no = $2) ORDER BY id DESC LIMIT 1", [e.note || '', e.cccd || null]).catch(() => null);
  const prior = (e.jobs || []).some(j => j.company) ? e.jobs.filter(j => j.company) : (cand?.jobs || []).filter(j => j.company);
  // sự kiện nội bộ theo ngày: HĐ (pháp nhân, chức danh), quyết định đã duyệt, thuyên chuyển đã thực hiện → mỗi lần đổi pháp nhân / phòng / chức danh mở một chặng mới
  const ev = [], CT = { HD01: 'HĐ thử việc', HD02: 'HĐLĐ có thời hạn', HD03: 'HĐLĐ không thời hạn', HD04: 'Phụ lục HĐ' }, DK = { HD05: 'QĐ điều chuyển', HD06: 'QĐ bổ nhiệm', HD07: 'QĐ miễn nhiệm', HD08: 'QĐ điều chỉnh lương', HD10: 'QĐ chấm dứt HĐLĐ', HD11: 'QĐ chấm dứt thử việc' };
  for (const c of await q('SELECT * FROM hr_contract WHERE emp_id = $1 ORDER BY from_on, id', [e.id])) if (c.from_on) ev.push({ on: c.from_on, legal: c.kind === 'HD04' ? null : c.legal_id, title: c.title || null, src: `${CT[c.kind] || 'HĐ'}${c.no ? ' ' + c.no : ''}`, ent: 'contract', id: c.id });
  for (const d of await q("SELECT * FROM hr_decision WHERE emp_id = $1 AND status = 'da_duyet' ORDER BY from_on, id", [e.id])) if (d.from_on) ev.push({ on: d.from_on, legal: ['HD05'].includes(d.kind) ? d.legal_id : null, dept: ['HD05', 'HD06'].includes(d.kind) ? d.dept_id : null, title: ['HD05', 'HD06', 'HD07'].includes(d.kind) ? d.title : null, end: ['HD10', 'HD11'].includes(d.kind), src: `${DK[d.kind] || 'QĐ'}${d.no ? ' ' + d.no : ''}`, ent: 'decision', id: d.id });
  const trs = await q("SELECT * FROM hr_transfer WHERE emp_id = $1 AND status = 'da_duyet' ORDER BY from_on, id", [e.id]);
  for (const t of trs) ev.push({ on: t.from_on, legal: t.to_legal_id, dept: t.to_dept_id, title: t.to_title, src: `Thuyên chuyển${t.dec_no ? ' ' + t.dec_no : ' ' + t.code}`, ent: 'transfer', id: t.id });
  ev.sort((a, b) => String(a.on).localeCompare(String(b.on)));
  // điểm xuất phát: trước thuyên chuyển đầu tiên thì lấy «hiện tại» ghi trên phiếu đó; không có thì theo hồ sơ
  // trước khi có HĐ trên app (vào làm trước ngày HĐ đầu tiên) → coi như theo HĐ / phiếu sớm nhất, không lấy chức danh hiện tại (tránh «thay đổi» giả)
  const t0 = trs[0], fl = ev.find(x => x.legal), ft = ev.find(x => x.title), st = { legal: t0?.from_legal_id ?? fl?.legal ?? e.legal_id, dept: t0?.from_dept_id ?? e.dept_id, title: t0?.from_title ?? ft?.title ?? e.title };
  const start = [e.join_on, ev[0]?.on].filter(Boolean).sort()[0], stints = []; let cur = start ? { from: start, ...st, src: e.join_on ? 'Ngày vào làm' : ev[0]?.src, ent: null, id: null } : null, endOn = e.leave_on || null;
  const dayBefore = s => new Date(Date.parse(s) - 864e5).toISOString().slice(0, 10);
  const doc = x => ({ src: x.src, ent: x.ent, id: x.id });   // mỗi chặng giữ đủ các HĐ / QĐ thuộc chặng (căn cứ)
  if (cur) cur.docs = [];
  for (const x of ev) {
    if (x.end) { endOn = endOn || x.on; if (cur) cur.docs.push(doc(x)); continue; }
    const nx = { legal: x.legal ?? cur?.legal, dept: x.dept ?? cur?.dept, title: x.title || cur?.title };
    if (!cur) { cur = { from: x.on, ...nx, docs: [doc(x)] }; continue; }
    if (nx.legal === cur.legal && nx.dept === cur.dept && (nx.title || '') === (cur.title || '')) { cur.docs.push(doc(x)); continue; }
    if (x.on <= cur.from) { Object.assign(cur, nx); cur.docs.push(doc(x)); continue; }   // cùng ngày bắt đầu (HĐ thử việc ký ngày vào làm) → sửa chặng đầu
    stints.push({ ...cur, to: dayBefore(x.on) }); cur = { from: x.on, ...nx, docs: [doc(x)] };
  }
  if (cur) stints.push({ ...cur, to: endOn });
  send(res, 200, { emp: { id: e.id, code: e.code, name: e.full_name, join_on: e.join_on, leave_on: e.leave_on, state: e.state }, exp: e.exp || cand?.exp || '', exp_ct: e.exp_ct || '', prior, cand: cand ? { id: cand.id, code: cand.code } : null,
    stints: stints.map(s => ({ from: s.from, to: s.to, legal: L[s.legal] || '', dept: D[s.dept] || '', title: s.title || '', docs: s.docs || [] })) });
});
r('POST', '/api/portal/training/:id',async (req, res, u, p) => send(res, 200, await trainSelf(u, p.id === 'new' ? null : p.id, req)));
r('GET', '/api/file/:id', async (req, res, u, p, qs) => { const f = notFound(await one('SELECT * FROM hr_file WHERE id=$1 AND deleted_at IS NULL', [+p.id]), 'tệp');
  if (!(f.ent === 'training' && f.kind === 'hv' && f.uploaded_by === u.id)) await C.get(f.ent, f.rec_id, u);   // học viên xem lại file mình đã nộp
  if (f.ent === 'employee' && ['cccd', 'syll', 'gks', 'cu_tru'].includes(f.kind) && !M.PII_ROLES.includes(u.role) && f.rec_id !== u.emp_id) deny('Giấy tờ cá nhân chỉ HCNS và chính nhân viên được xem');
  await C.audit({ q }, f.ent, f.rec_id, 'tai_ve', null, null, u, f.name); sendFile(res, fs.readFileSync(path.join(FILES, f.path)), f.name, f.mime || 'application/octet-stream', qs.view && /^(application\/pdf|image\/(png|jpeg|webp|gif))$/.test(f.mime || '')); });   // ?view=1: PDF / ảnh mở xem ngay trên trình duyệt
r('POST', '/api/import/:ent', async (req, res, u, p) => {   // nhập Excel: dòng tiêu đề trùng nhãn trường; có mã thì cập nhật
  const e = M.E[p.ent] || bad('Sai loại'); if (!can(u, e, 'c')) deny();
  const { files } = await readUpload(req); if (!files[0]) bad('Chưa chọn tệp');
  const sheet = readXlsx(files[0].buffer)[0] || bad('File không có trang tính'), hi = sheet.rows.findIndex(x => x && x.filter(Boolean).length >= 2), hd = (sheet.rows[hi] || bad('Không thấy dòng tiêu đề — dùng file «Xuất Excel» làm mẫu')).map(s => String(s).trim().toLowerCase());
  const map = hd.map(h => e.fields.find(f => !f.grid && (f.l.toLowerCase() === h || f.k === h || (h === 'mã sp' && f.k === 'code') || (h === 'mô tả' && p.ent === 'vpp_item' && f.k === 'name'))));
  if (!map.filter(Boolean).length) bad('Không nhận ra cột nào — dùng file «Xuất Excel» làm mẫu');
  const out = { ok: 0, upd: 0, err: [] };
  for (let i = hi + 1; i < sheet.rows.length; i++) { const x = sheet.rows[i]; if (!x?.some(v => v !== '')) continue;
    try { const o = {}; for (const [j, f] of map.entries()) if (f && x[j] !== '' && x[j] != null) o[f.k] = f.t === 'ref' ? (await one(`SELECT id FROM ${M.E[f.ref].table} t WHERE (${M.E[f.ref].disp}) = $1 OR t.code = $1`, [String(x[j])]))?.id ?? bad(`${f.l}: không tìm thấy «${x[j]}»`) : x[j];
      const uq = (e.uniq || [])[0], old = (o.code && C.F[p.ent].code && await one(`SELECT id FROM ${e.table} WHERE code=$1`, [String(o.code)])) || (uq && uq.every(k => o[k] != null) && await one(`SELECT id FROM ${e.table} WHERE ${uq.map((k, i) => `${k}::text = $${i + 1}`).join(' AND ')}`, uq.map(k => String(o[k])))); /* không có mã: trùng khóa (vd. nhân viên + năm) → cập nhật */ if (old) { await C.update(p.ent, old.id, o, u, { imp: 1 }); out.upd++; } else { await C.create(p.ent, o, u, { keepCode: 1 }); out.ok++; } } catch (er) { out.err.push(`Dòng ${i + 1}: ${er.message}`); } }
  send(res, 200, out);
});
r('POST', '/api/cv-parse', async (req, res, u) => {   // AI đọc CV → điền sẵn form ứng viên (chưa lưu gì)
  if (!can(u, M.E.candidate, 'c')) deny();
  const { files } = await readUpload(req); if (!files[0]) bad('Chưa chọn tệp CV');
  send(res, 200, { data: await require('./cvai').parseCv(files[0]) });
});
r('POST', '/api/import-att', async (req, res, u) => {   // nhập file máy chấm công: Mã NV | Ngày | Vào | Ra → tự ra ký hiệu HC / XI / XO / XX; không đè đơn đã duyệt
  needIt(u, M.NS, 'v:timesheet'); const { files } = await readUpload(req); if (!files[0]) bad('Chưa chọn tệp');
  const rows = readXlsx(files[0].buffer)[0].rows, hi = rows.findIndex(x => x?.some(s => /mã\s*nv/i.test(String(s)))); if (hi < 0) bad('Cần cột «Mã NV», «Ngày», «Vào», «Ra»');
  const hd = rows[hi].map(s => String(s).trim().toLowerCase()), ci = re => hd.findIndex(h => re.test(h)), [a, b, c, d] = [ci(/mã\s*nv/), ci(/ngày/), ci(/vào/), ci(/ra/)];
  const out = { ok: 0, skip: 0, err: [] }, t = v => { if (v === '' || v == null) return null; if (typeof v === 'number') { const m = Math.round(v * 1440); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; } return String(v).slice(0, 5); };
  for (const x of rows.slice(hi + 1)) { if (!x?.[a]) continue; const e = await one('SELECT id, legal_id FROM hr_employee WHERE code=$1', [String(x[a]).trim()]), day = C.isoDate(x[b]); if (!e || !day) { out.err.push(`${x[a]} ${x[b]}: không nhận ra`); continue; }
    if (u.legal_ids?.length && !u.legal_ids.includes(e.legal_id)) { out.err.push(`${x[a]}: nhân viên thuộc pháp nhân bạn không phụ trách`); continue; }
    const cur = await one('SELECT source FROM hr_attendance WHERE emp_id=$1 AND day=$2', [e.id, day]); if (cur && cur.source !== 'may') { out.skip++; continue; }
    const i = t(x[c]), o = t(x[d]); try { await B.setMark({ q, one }, e.id, day, i && o ? 'HC' : i ? 'XO' : o ? 'XI' : 'XX', { in_t: i, out_t: o }, 'may'); out.ok++; } catch (er) { out.err.push(er.message); } }
  send(res, 200, out);
});
r('GET', '/api/report/:code', async (req, res, u, p, qs) => {
  const code = decodeURIComponent(p.code);
  if (qs.snapshot) { const s = notFound(await one('SELECT * FROM hr_snapshot WHERE id=$1', [+qs.snapshot]), 'bản chốt'); if (s.code !== code || !V.roleSees(u, code) || !C.has(u, 'r:' + code)) deny(); return send(res, 200, { ...s.data, snapshot: { id: s.id, version: s.version, at: s.closed_at, period: s.period } }); }
  const data = await V.report(code, qs, u); data.snapshots = await q('SELECT s.id, s.period, s.version, s.closed_at, u.full_name AS by FROM hr_snapshot s LEFT JOIN hr_user u ON u.id=s.closed_by WHERE s.code=$1 ORDER BY s.id DESC LIMIT 12', [code]); send(res, 200, data);
});
r('POST', '/api/report/:code/close', async (req, res, u, p) => {  // chốt kỳ: lưu phiên bản, nguồn cập nhật muộn không đổi số đã chốt
  need(u, M.HC); const code = decodeURIComponent(p.code), b = await readJson(req), data = await V.report(code, b, u), period = b.month || b.year || C.today();
  const v = (await one('SELECT coalesce(max(version),0)+1 AS v FROM hr_snapshot WHERE code=$1 AND period=$2', [code, period])).v;
  await q('INSERT INTO hr_snapshot (code,period,filters,data,version,closed_by) VALUES ($1,$2,$3,$4,$5,$6)', [code, period, JSON.stringify(b), JSON.stringify(data), v, u.id]); await C.audit({ q }, 'report', null, 'chot_ky', null, null, u, `${code} ${period} v${v}`); send(res, 200, { version: v });
});
r('GET', '/api/report/:code/xlsx', async (req, res, u, p, qs) => {
  const code = decodeURIComponent(p.code);
  if (sheetOk(code, u)) { const ts = (await sheetTables(SHEET_OF[code], u, qs)).map(S.printable); if (!ts.length) bad('Chưa có bảng nào trong kỳ'); await C.audit({ q }, 'report', null, 'xuat_excel', null, null, u, code); return xlsxSend(res, `${code} ${qs.month || ''}`, S.xlsxOf(ts)); }
  if (code === 'PLI') { await C.audit({ q }, 'report', null, 'xuat_excel', null, null, u, code); return xlsxSend(res, 'Mau 01-PLI', S.pliXlsx(await pliGroups(u, qs))); }
  const d = await V.report(code, qs, u), cell = (c, x) => { const v = x[c[0]]; return c[2] === 'd' ? C.dmy(v) : ['n', 'm'].includes(c[2]) && v !== '' && v != null ? +v : v ?? ''; };
  const g = d.groups ? [d.groups.flatMap(([l, n]) => [l || '', ...Array(n - 1).fill('')])] : [], hr = 3 + g.length;
  const tot = d.total ? [d.cols.map((c, i) => i === 0 ? 'TỔNG CỘNG' : ['n', 'm'].includes(c[2]) && !(d.nosum || []).includes(c[0]) ? d.rows.reduce((s, x) => s + (+x[c[0]] || 0), 0) : '')] : [];
  // bảng phụ (vd. GT02 hàng đã nhận, TD04 theo kênh) nối tiếp bên dưới bảng chính
  const ext = (d.extra || []).flatMap(x => [[], [x.title || ''], x.cols.map(c => c[1]), ...x.rows.map(r => x.cols.map(c => cell(c, r))),
    ...(x.total && x.rows.length ? [x.cols.map((c, i) => i === 0 ? 'TỔNG CỘNG' : ['n', 'm'].includes(c[2]) && !(x.nosum || []).includes(c[0]) ? x.rows.reduce((s, r) => s + (+r[c[0]] || 0), 0) : '')] : [])]);
  const rows = [[d.title], [`Kỳ: ${qs.month || qs.year || ''}`], [], ...g, d.cols.map(c => c[1]), ...d.rows.map(x => d.cols.map(c => cell(c, x))), ...tot, ...ext];
  const merges = []; if (d.groups) { let ci = 0; const L = i => String.fromCharCode(65 + i % 26).padStart(i >= 26 ? 2 : 1, String.fromCharCode(64 + Math.floor(i / 26))); for (const [l, n] of d.groups) { if (l && n > 1) merges.push(`${L(ci)}4:${L(ci + n - 1)}4`); ci += n; } }
  const styleOf = (ri, ci) => ri === 0 ? 5 : ri >= 3 && ri <= hr ? 4 : ri > hr && ri < rows.length - tot.length ? (['n', 'm'].includes(d.cols[ci]?.[2]) ? 7 : 6) : tot.length && ri === rows.length - 1 ? (['n', 'm'].includes(d.cols[ci]?.[2]) ? 8 : 9) : null;
  await C.audit({ q }, 'report', null, 'xuat_excel', null, null, u, code); sendFile(res, buildXlsx({ sheet: code, rows, styleOf, merges, widths: d.cols.map(() => 16) }), `${code}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});
r('GET', '/api/dash/:id', async (req, res, u, p, qs) => { if (!C.has(u, 'd:' + p.id) || (u.role === 'nld' && !Array.isArray(u.items)) || (!Array.isArray(u.items) && (p.id === 'NS' && !NSR.includes(u.role) || p.id === 'HC' && !HCR.includes(u.role)))) deny(); send(res, 200, await V.dash(p.id, qs, u)); });
r('GET', '/api/alerts', async (req, res, u) => send(res, 200, u.role === 'nld' ? [] : await V.alerts(u)));
r('POST', '/api/alerts/:key', async (req, res, u, p) => { need(u, M.HC); const b = await readJson(req), k = decodeURIComponent(p.key); if (b.undo) await q('DELETE FROM hr_alert_state WHERE key=$1', [k]); else await q('INSERT INTO hr_alert_state (key,state,note,by) VALUES ($1,$2,$3,$4) ON CONFLICT (key) DO UPDATE SET state=$2, note=$3, by=$4, at=now()', [k, 'da_xu_ly', b.note || null, u.id]); send(res, 200, { ok: true }); });
r('GET', '/api/inbox', async (req, res, u) => send(res, 200, await V.inbox(u)));
// thư mời / thư kết quả phỏng vấn soạn sẵn thành email cho từng ứng viên (mở Gmail / Outlook để gửi, kèm PDF in từ nút «In thư»)
r('GET', '/api/letter-mail/interview/:id', async (req, res, u, p, qs) => { need(u, M.NS); const F2 = require('./forms'), x = await F2.letterItems(p.id, u, qs.kind, qs.code ? [String(qs.code)] : undefined), it = x.items[0] || bad('Không có ứng viên');
  const subject = `${x.title} — ${it.cand.position || ''} — ${it.cand.name}`.replace(/ —  —/, ' —');
  await C.audit({ q }, 'interview', x.r.id, 'soan_email', null, null, u, `${x.title}: ${it.cand.name}${it.cand.email ? '' : ' (ứng viên chưa có email)'}`);
  send(res, 200, { to: it.cand.email || '', name: it.cand.name, subject, text: F2.letterText(it.html) }); });
// gửi bảng công tháng cho trưởng từng phòng: thông báo kèm tóm tắt (số người, tổng công, ngày thiếu chấm), bấm mở «Bảng chấm công» (trưởng phòng chỉ thấy phòng mình)
r('POST', '/api/timesheet/send', async (req, res, u) => { need(u, M.NS); const b = await readJson(req), m = /^\d{4}-\d{2}$/.test(b.month || '') ? b.month : C.today().slice(0, 7);
  const pr = [], w = []; if (b.dept) { pr.push(+b.dept); w.push(`d.id = $${pr.length}`); }
  const depts = await q(`SELECT d.id, d.name, u.id uid, u.full_name FROM hr_dept d LEFT JOIN hr_user u ON u.emp_id = d.head_id AND u.active WHERE coalesce(d.state,'hieu_luc') <> 'ngung' ${w.length ? 'AND ' + w.join(' AND ') : ''} ORDER BY d.code`, pr);
  const att = await B.monthAtt({ q }, m), sent = [], skip = [];
  for (const d of depts) {
    const pe = [d.id]; let lw = ''; if (b.legal) { pe.push(+b.legal); lw = ' AND legal_id = $2'; }
    const es = await q(`SELECT id FROM hr_employee WHERE dept_id = $1 AND state <> 'da_nghi'${lw}`, pe); if (!es.length) continue;
    if (!d.uid) { skip.push(d.name); continue; }
    const work = es.reduce((s, e) => s + (att[e.id]?.work || 0) + (att[e.id]?.paid_leave || 0), 0), miss = es.reduce((s, e) => s + (att[e.id]?.miss || 0), 0);
    await C.notify({ q, one }, [d.uid], `Bảng chấm công tháng ${m.slice(5)}/${m.slice(0, 4)} — ${d.name}`, `${es.length} người · tổng ${Math.round(work * 10) / 10} công${miss ? ` · ${miss} ngày thiếu chấm cần giải trình` : ''} · HCNS gửi để trưởng phòng rà soát`, 'v/timesheet'); sent.push(d.full_name);
  }
  await C.audit({ q }, 'attendance', null, 'gui_bang_cong', null, null, u, `Tháng ${m}: gửi ${sent.length} trưởng phòng`); send(res, 200, { sent, skip }); });
// hoạt động văn hóa: danh sách người tham gia + điểm danh của một ngày (HCNS ghi nhận)
r('GET', '/api/culture/:id/roster', async (req, res, u, p, qs) => { need(u, M.NS); const a = (await C.get('culture', p.id, u)).row; send(res, 200, { act: a, day: qs.day || C.today(), rows: await B.cultureRoster({ q, one }, a, qs.day || C.today()) }); });
// tạo ngày nghỉ phép cho nhân viên chấm công tự động (Bravo): GET danh sách theo tháng, POST tạo đơn
r('GET', '/api/att-auto/leave', async (req, res, u, p, qs) => { need(u, M.NS); if (!/^\d{4}-\d{2}$/.test(qs.month || '')) bad('Chọn tháng'); send(res, 200, await B.autoLeaveList({ q, one }, qs.month)); });
r('POST', '/api/att-auto/leave', async (req, res, u) => { need(u, M.NS); const b = await readJson(req); if (!/^\d{4}-\d{2}$/.test(b.month || '')) bad('Chọn tháng');
  const made = await tx(db => B.autoLeaveMake(db, u, b.month, b.items)); send(res, 200, { made }); });
r('GET', '/api/inbox/done', async (req, res, u) => send(res, 200, await V.decidedRecent(u)));
r('GET', '/api/search', async (req, res, u, p, qs) => {
  const s = String(qs.q || '').trim(); if (s.length < 2) return send(res, 200, []); const out = [];
  for (const k of ['employee', 'contract', 'vpp_item', 'asset', 'vehicle', 'candidate', 'decision']) { const e = M.E[k]; if (!can(u, e, 'r')) continue; for (const x of (await C.list(k, u, { q: s, limit: 5 })).rows) out.push({ ent: k, id: x.id, label: x.full_name || x.no || x.name || x.code, sub: `${e.title}${x.code ? ' · ' + x.code : ''}` }); }
  send(res, 200, out.slice(0, 20));
});
r('GET', '/api/issues', async (req, res, u) => { needIt(u, M.HC, 'v:data'); send(res, 200, await q("SELECT * FROM hr_issue ORDER BY CASE severity WHEN 'mau_thuan' THEN 0 WHEN 'can_cap_nhat' THEN 1 WHEN 'thong_tin' THEN 2 ELSE 3 END, id")); });
r('GET', '/api/jobs', async (req, res, u) => { needIt(u, M.HC, 'v:data'); send(res, 200, await q('SELECT * FROM hr_job ORDER BY at DESC LIMIT 50')); });
r('GET', '/api/audit', async (req, res, u) => { needIt(u, M.TP, 'v:audit'); send(res, 200, await q('SELECT a.*, u.full_name AS by FROM hr_audit a LEFT JOIN hr_user u ON u.id=a.user_id ORDER BY a.at DESC LIMIT 300')); });
r('GET', '/api/settings', async (req, res, u) => { needIt(u, M.TP, 'v:settings'); send(res, 200, Object.fromEntries((await q('SELECT key,value FROM hr_setting')).map(x => [x.key, x.value]))); });
// BH-02: số dư công nợ BH đầu năm theo pháp nhân — người lập / duyệt bảng BH nhập, chỉ cho pháp nhân trong phạm vi được giao
r('PUT', '/api/ins-open', async (req, res, u) => {
  const b = await readJson(req), y = String(+b.year || ''), lid = +b.legal_id;
  if (!C.has(u, 'r:BH-02') || !(['cv_hcns', 'tp_hcns', 'admin'].includes(u.role) || C.can(u, M.E.ins_sheet, 'u'))) deny();
  if (!/^\d{4}$/.test(y) || !lid || (u.legal_ids?.length && !u.legal_ids.includes(lid))) bad('Thiếu năm hoặc pháp nhân');
  const cur = (await C.setting('ins_open')) || {}; cur[y] = { ...(cur[y] || {}), [lid]: Math.round(+b.amount || 0) };
  await q('INSERT INTO hr_setting (key, value, updated_by) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now(), updated_by=$3', ['ins_open', JSON.stringify(cur), u.id]);
  await C.audit({ q }, 'setting', null, 'sua_cau_hinh', null, null, u, `ins_open ${y}`); send(res, 200, { ok: true });
});
r('PUT', '/api/settings/:k', async (req, res, u, p) => { needIt(u, M.TP, 'v:settings'); await q('UPDATE hr_setting SET value=$1, updated_at=now(), updated_by=$2 WHERE key=$3', [JSON.stringify(await readJson(req)), u.id, p.k]); await C.audit({ q }, 'setting', null, 'sua_cau_hinh', null, null, u, p.k); send(res, 200, { ok: true }); });
// sơ đồ tổ chức Khối Home (phần mềm làm cho Home): phòng ban + người trong phòng lấy thẳng từ hồ sơ nhân sự; người chưa gán phòng hiện riêng để gán
r('GET', '/api/org', async (req, res, u) => {
  const depts = await q(`SELECT d.id, d.code, d.name, d.parent_id, e.full_name head FROM hr_dept d LEFT JOIN hr_employee e ON e.id=d.head_id WHERE d.block='Khối Home' AND coalesce(d.state,'hieu_luc')<>'ngung' ORDER BY d.code`);
  const ppl = await q(`SELECT id, code, full_name, title, level, dept_id FROM hr_employee WHERE state<>'da_nghi' AND dept_id = ANY($1) ORDER BY (level IS NULL), array_position(ARRAY['TGĐ','PTGĐ','GĐ','TP','PP','CV','NV'], level), ${M.CODE_ORDER.replace(/t\./g, '')}`, [depts.map(d => d.id)]);
  for (const d of depts) { d.people = ppl.filter(x => x.dept_id === d.id); d.n = d.people.length; }
  send(res, 200, { depts, unassigned: await q("SELECT id, code, full_name, title FROM hr_employee WHERE dept_id IS NULL AND state<>'da_nghi' ORDER BY code") }); });
r('GET', '/api/timesheet', async (req, res, u, p, qs) => {
  const m = qs.month || C.today().slice(0, 7), w = [], pr = [m + '-31'.replace('31', B.lastDay(m).slice(8))]; const a = (s, ...v) => { let i = 0; w.push(s.replace(/\$(\d+)/g, () => '$' + (pr.push(v[i++]), pr.length))); };
  if (qs.legal) a('t.legal_id=$1', +qs.legal); if (qs.dept) a('t.dept_id=$1', +qs.dept); C.scopeSql(M.E.employee, u, a);
  const emps = await q(`SELECT t.id, t.code, t.full_name FROM hr_employee t WHERE t.join_on <= $1 AND t.state<>'da_nghi' ${w.length ? 'AND ' + w.join(' AND ') : ''} ORDER BY (t.code !~ '^[A-Za-z]+[0-9]+$'), t.code`, pr);
  const ot = Object.fromEntries((await q("SELECT emp_id, sum(hours_ok)::float h FROM hr_ot WHERE status = 'da_duyet' AND to_char(day,'YYYY-MM') = $1 AND emp_id = ANY($2) GROUP BY 1", [m, emps.map(e => e.id)])).map(x => [x.emp_id, x.h]));   // giờ tăng ca đã duyệt — cột cuối bảng chấm công
  send(res, 200, { emps, ot, att: await B.monthAtt({ q }, m, 'AND e.id = ANY($2)', [emps.map(e => e.id)]), hol: [...await B.holidays({ q })].filter(d => d.startsWith(m)), last: +B.lastDay(m).slice(8), locked: (await q("SELECT legal_id FROM hr_att_period WHERE month=$1 AND status='khoa'", [m])).length, types: await q('SELECT code, name FROM hr_att_type ORDER BY grp, id') });
});
r('PUT', '/api/timesheet', async (req, res, u) => { needIt(u, M.NS, 'v:timesheet'); const b = await readJson(req); await C.get('employee', +b.emp_id, u); if (b.mark) await B.setMark({ q, one }, +b.emp_id, b.day, b.mark, {}, 'hcns'); else { await B.assertOpen({ q, one }, +b.emp_id, String(b.day)); await q('DELETE FROM hr_attendance WHERE emp_id=$1 AND day=$2', [+b.emp_id, b.day]); } await C.audit({ q }, 'attendance', +b.emp_id, 'sua_cong', null, null, u, `${b.day}: ${b.mark || 'xóa'}`); send(res, 200, { ok: true }); });
r('GET', '/api/sheet/:ent/:id', async (req, res, u, p) => { const g = await C.get(p.ent, p.id, u); send(res, 200, g.row); });
r('PUT', '/api/payroll/:id/line/:emp', async (req, res, u, p) => { need(u, M.NS); await C.get('payroll', p.id, u); await tx(async db => { const x = notFound(await db.one('SELECT * FROM hr_payroll WHERE id=$1 FOR UPDATE', [+p.id])); await B.editPayLine(db, x, +p.emp, await readJson(req)); }); send(res, 200, { ok: true }); });
// lịch tuần suất ăn: mỗi ngày — số suất đăng ký (SA01 tháng) và suất thực tế (SA04-N)
r('GET', '/api/meal-week', async (req, res, u, p, qs) => {
  if (!can(u, M.E.meal_day, 'r')) deny();
  const d0 = /^\d{4}-\d{2}-\d{2}$/.test(qs.start || '') ? qs.start : C.today(), dow = (new Date(d0 + 'T00:00:00Z').getUTCDay() + 6) % 7, mon = C.addDays(d0, -dow), days = Array.from({ length: 7 }, (_, i) => C.addDays(mon, i));
  const lg = qs.legal ? +qs.legal : null, months = [...new Set(days.map(d => d.slice(0, 7)))], hol = await B.holidays({ q });
  const regs = await q(`SELECT month, days FROM hr_meal_reg WHERE month = ANY($1) ${lg ? 'AND legal_id = $2' : ''}`, lg ? [months, lg] : [months]);
  const act = await q(`SELECT id, day, actual FROM hr_meal_day WHERE day BETWEEN $1 AND $2 ${lg ? 'AND legal_id = $3' : ''}`, lg ? [days[0], days[6], lg] : [days[0], days[6]]);
  send(res, 200, days.map(d => { const a = act.filter(x => x.day === d); return { day: d, off: !B.isWorkday(d, hol), reg: regs.filter(r2 => r2.month === d.slice(0, 7) && (r2.days || []).includes(+d.slice(8))).length, actual: a.length ? a.reduce((s, x) => s + (+x.actual || 0), 0) : null, id: a.length === 1 ? a[0].id : null }; }));
});
// đăng ký suất ăn tháng mới từ tháng trước: giữ thứ trong tuần từng người đã đăng ký, bỏ Chủ nhật / ngày lễ, ai đã có thì giữ nguyên
r('POST', '/api/meal-reg/copy', async (req, res, u) => {
  const e = M.E.meal_reg; if (!can(u, e, 'c') || !can(u, e, 'd')) deny();
  const b = await readJson(req), m = C.isoMonth(b.month) || bad('Chọn tháng');
  send(res, 200, await B.mealCopy(u, m, b.legal_id ? +b.legal_id : null));
});
// lịch sử chấm công 1 người (bấm tên trên bảng công): từng ngày + các đơn liên quan
r('GET', '/api/att-history/:emp', async (req, res, u, p, qs) => {
  if (!can(u, M.E.attendance, 'r')) deny(); const e = (await C.get('employee', p.emp, u)).row;
  const to = /^\d{4}-\d{2}$/.test(qs.month || '') ? B.lastDay(qs.month) : C.today(), from = C.addDays(to, -92);
  const days = await q('SELECT day, mark, in_t, out_t, source, updated_at FROM hr_attendance WHERE emp_id = $1 AND day BETWEEN $2 AND $3 ORDER BY day DESC', [e.id, from, to]);
  const D = [['leave', 'from_on', "t.type_code||' · '||t.from_on||' → '||t.to_on"], ['explain', 'day', "t.kind||' · '||t.day"], ['trip', 'from_on', "t.descr||' · '||t.from_on||' → '||t.to_on"], ['ot', 'day', "t.day||' '||t.from_t||'–'||t.to_t"], ['att_add', 'from_on', "t.kind||' · '||t.from_on"]], reqs = [];
  for (const [ent, dk, lab] of D) for (const x of await q(`SELECT t.id, t.code, t.status, ${lab} AS info FROM ${M.E[ent].table} t WHERE t.emp_id = $1 AND t.${dk} BETWEEN $2 AND $3 ORDER BY t.${dk} DESC`, [e.id, from, to])) reqs.push({ ent, title: M.E[ent].title, ...x });
  send(res, 200, { emp: { id: e.id, code: e.code, full_name: e.full_name, title: e.title, dept: e.dept_id__l }, from, to, days, reqs });
});
﻿// mẫu in: mẫu gốc (Sổ QLLĐ / app tự tạo) sửa được, «Khôi phục» về bản gốc; HCNS thêm mẫu mới cho từng mục (key U…), đặt mẫu mặc định khi in
const tplOk = u => C.has(u, 'v:templates') && ['cv_hc', 'cv_hcns', 'tp_hcns', 'admin'].includes(u.role) || deny('Bạn không được sửa mẫu in');
// lọc mẫu in theo danh sách cho phép: chỉ thẻ / thuộc tính định dạng văn bản; bỏ mọi thẻ lạ (svg, form…), on…=, javascript:
const TAG_OK = new Set('a b i u s em strong small sub sup br hr p div span h1 h2 h3 h4 h5 h6 ul ol li table thead tbody tfoot tr td th col colgroup caption img font center blockquote pre label'.split(' '));
const ATTR_OK = new Set('class style colspan rowspan width height align valign border cellpadding cellspacing src href title alt id color size face'.split(' '));
const cleanAttrs = a => { const out = []; for (const m of a.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g)) {
  const k = m[1].toLowerCase(); let v = (m[2] || '').replace(/^["']|["']$/g, ''); if (!ATTR_OK.has(k)) continue;
  const plain = v.replace(/&#x?[0-9a-f]+;?|[\s\0]/gi, '').toLowerCase();
  if ((k === 'href' && !/^(https?:|mailto:|#|\/)/.test(plain) && plain) || (k === 'src' && !/^(https?:|data:image\/|\/)/.test(plain))) continue;
  if (k === 'style' && /expression|javascript|url\s*\(/i.test(plain)) continue;
  out.push(` ${k}="${v.replace(/"/g, '&quot;')}"`); } return out.join(''); };
const cleanHtml = s => String(s || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<\s*(script|iframe|object|embed|link|meta|style|svg|math|template|noscript|textarea|form|xml)\b[\s\S]*?(<\/\s*\1\s*>|$)/gi, '')
  .replace(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g, (_, sl, t, a) => TAG_OK.has(t.toLowerCase()) ? `<${sl}${t.toLowerCase()}${sl ? '' : cleanAttrs(a.replace(/\/\s*$/, ''))}>` : '');
const tplInfo = async key => { const FM = require('./forms'), b = FM.TPL[key], o = await one('SELECT * FROM hr_template WHERE key = $1', [key]); if (!b && !o?.ent) notFound(null, 'mẫu'); return { key, b, o, ent: b ? b.ent : o.ent, name: o?.name || b?.name, src: b ? b.src : 'hcns', body: o?.body || b?.body }; };
r('GET', '/api/templates', async (req, res, u, p, qs) => {
  tplOk(u); const FM = require('./forms'), own = await q('SELECT t.key, t.ent, t.name, t.kinds, t.is_default, t.updated_at, u.full_name FROM hr_template t LEFT JOIN hr_user u ON u.id = t.updated_by');
  const byKey = Object.fromEntries(own.map(x => [x.key, x]));
  send(res, 200, { vars: FM.VARS, list: [...Object.entries(FM.TPL).map(([k, t]) => ({ key: k, name: t.name, kinds: t.kinds, src: t.src, ent: t.ent, custom: !!byKey[k], at: byKey[k]?.updated_at, by: byKey[k]?.full_name })),
    ...own.filter(x => x.ent).map(x => ({ key: x.key, name: x.name, kinds: x.kinds, src: 'hcns', ent: x.ent, is_default: x.is_default, custom: true, at: x.updated_at, by: x.full_name, entL: M.E[x.ent]?.title }))],
    fixed: FM.T_CODE.map(k => ({ ent: k, code: M.E[k].code, name: M.E[k].title })) });
});
// mẫu in của một phiếu (ai xem được phiếu đều chọn được mẫu để in)
r('GET', '/api/tpl-for/:ent/:id', async (req, res, u, p) => { const FM = require('./forms'), r0 = (await C.get(p.ent, p.id, u)).row; send(res, 200, { list: await FM.templatesFor(p.ent, r0), def: await FM.defaultKey(p.ent, r0), can: !!(C.has(u, 'v:templates') && ['cv_hc', 'cv_hcns', 'tp_hcns', 'admin'].includes(u.role)) }); });
r('GET', '/api/templates/:key', async (req, res, u, p) => { tplOk(u); const t = await tplInfo(p.key), FM = require('./forms'); send(res, 200, { key: p.key, name: t.name, src: t.src, ent: t.ent, entL: M.E[t.ent]?.title, body: t.body, custom: !!t.o, is_default: !!t.o?.is_default, kinds: t.o?.kinds || t.b?.kinds, vars: [...FM.VARS, ...FM.fieldVars(t.ent)] }); });
// thêm mẫu mới cho một mục: chép từ mẫu đang chọn (mẫu cố định Bộ 53 / mẫu chung → khung có sẵn mọi trường của phiếu)
r('POST', '/api/templates', async (req, res, u) => {
  tplOk(u); const b = await readJson(req), FM = require('./forms'); if (!M.E[b.ent]) bad('Chưa chọn mục'); const name = String(b.name || '').trim() || bad('Đặt tên cho mẫu mới');
  const from = b.from && !FM.FIXED[b.from] ? (await tplInfo(b.from)).body : FM.skeleton(b.ent), key = 'U' + Date.now().toString(36);
  await q('INSERT INTO hr_template (key, ent, name, kinds, body, is_default, updated_by) VALUES ($1,$2,$3,$4,$5,false,$6)', [key, b.ent, name, (b.kinds || []).length ? b.kinds : null, from, u.id]);
  await C.audit({ q, one }, 'template', null, 'tao', null, null, u, `Thêm mẫu in «${name}» cho ${M.E[b.ent].title}`); send(res, 200, { key });
});
r('PUT', '/api/templates/:key', async (req, res, u, p) => {
  tplOk(u); const t = await tplInfo(p.key), b = await readJson(req), body = cleanHtml(b.body); if (body.trim().length < 20) bad('Mẫu trống');
  if (t.b) await q('INSERT INTO hr_template (key, body, updated_by) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, updated_by = EXCLUDED.updated_by, updated_at = now()', [p.key, body, u.id]);
  else {
    await q('UPDATE hr_template SET body = $2, name = coalesce(nullif($3, \'\'), name), is_default = $4, updated_by = $5, updated_at = now() WHERE key = $1', [p.key, body, String(b.name || '').trim(), !!b.is_default, u.id]);
    if (b.is_default) await q('UPDATE hr_template SET is_default = false WHERE ent = $1 AND key <> $2 AND (kinds IS NULL OR $3::text[] IS NULL OR kinds && $3)', [t.ent, p.key, t.o.kinds]);   // một mẫu mặc định cho mỗi mục / loại
  }
  await C.audit({ q, one }, 'template', null, 'sua', null, null, u, `Sửa mẫu in ${t.name}`); send(res, 200, { ok: true });
});
// mẫu gốc: bỏ bản sửa (khôi phục); mẫu HCNS thêm: xóa
r('DELETE', '/api/templates/:key', async (req, res, u, p) => { tplOk(u); const t = await tplInfo(p.key); await q('DELETE FROM hr_template WHERE key = $1', [p.key]); await C.audit({ q, one }, 'template', null, 'xoa', null, null, u, `${t.b ? 'Khôi phục mẫu gốc' : 'Xóa mẫu'} ${t.name}`); send(res, 200, { ok: true }); });
r('POST', '/api/vpp/buy', async (req, res, u) => {   // tổng hợp đề xuất đã duyệt + hàng dưới định mức → nháp phiếu nhập kho
  need(u, M.HC); const b = await readJson(req), legal = +b.legal_id || bad('Chọn pháp nhân'), st = await B.vppStock({ q }, legal), want = {};
  for (const n of await q('SELECT item_code, min_qty FROM hr_vpp_norm WHERE legal_id=$1', [legal])) { const g = +n.min_qty - (st[n.item_code] || 0); if (g > 0) want[n.item_code] = g; }
  for (const r2 of await q("SELECT lines FROM hr_vpp_req WHERE legal_id=$1 AND status='da_duyet'", [legal])) for (const l of r2.lines || []) { const g = B.n(l.qty) - (st[l.code] || 0); if (g > 0) want[l.code] = Math.max(want[l.code] || 0, g); }
  const items = Object.fromEntries((await q('SELECT code,name,unit FROM hr_vpp_item')).map(i => [i.code, i])), lines = Object.entries(want).map(([c, v]) => ({ code: c, name: items[c]?.name, unit: items[c]?.unit, qty: String(v), note: '' }));
  if (!lines.length) bad('Không có mặt hàng nào cần mua');
  send(res, 200, await C.create('vpp_in', { legal_id: legal, supplier: 'Nháp từ đề xuất & định mức', in_on: C.today(), lines }, u));
});
r('POST', '/api/contract/:id/renew', async (req, res, u, p) => {   // một chạm: sinh HĐ kế tiếp từ HĐ sắp hết hạn
  need(u, M.NS); const c = (await C.get('contract', p.id, u)).row, b = await readJson(req), from = C.addDays(c.to_on || C.today(), 1), kind = b.kind || (c.kind === 'HD01' ? 'HD02' : 'HD03');
  const e = await one('SELECT code FROM hr_employee WHERE id=$1', [c.emp_id]), yr = from.slice(0, 4), to = kind === 'HD02' ? `${+yr + (+b.years || 1)}${from.slice(4)}` : null;
  send(res, 200, await C.create('contract', { emp_id: c.emp_id, legal_id: c.legal_id, kind, no: `${e.code}/${yr}/${kind}`, from_on: from, to_on: to && C.addDays(to, -1), title: c.title, salary: c.salary }, u));
});
r('GET', '/api/gov/:name', async (req, res, u, p) => { need(u, M.NS); const n = path.basename(decodeURIComponent(p.name)), f = path.join(DATA, 'templates', n); if (!fs.existsSync(f)) notFound(null, 'mẫu'); sendFile(res, fs.readFileSync(f), n, 'application/octet-stream'); });
r('GET', '/api/gov-files', async (req, res) => send(res, 200, fs.readdirSync(path.join(DATA, 'templates'))));
r('POST', '/api/demo/clear', async (req, res, u) => { need(u, M.TP);
  // một giao dịch, chỉ dữ liệu thử (is_demo); bảng lương nháp thật được tính lại (bỏ công thử) chứ không xóa
  await tx(async db => { for (const e of Object.values(M.E).reverse()) await db.q(`DELETE FROM ${e.table} WHERE is_demo`); await db.q('DELETE FROM hr_approval WHERE is_demo');
    for (const p of await db.q("SELECT * FROM hr_payroll WHERE status = 'nhap'")) await B.calcPayroll(db, p); });
  await C.audit({ q }, 'demo', null, 'xoa_du_lieu_thu', null, null, u); await J.tick(); send(res, 200, { ok: true }); });
// tài khoản & phân công (TP HCNS, quản trị): vai trò, pháp nhân phụ trách, mảng hành chính được giao
r('GET', '/api/users', async (req, res, u) => { needIt(u, M.TP, 'v:users'); send(res, 200, await q(`SELECT u.id, u.username, u.full_name, u.role, u.title, u.legal_ids, u.items, u.active, u.last_login, e.code emp_code, l.short emp_legal, d.name dept
  FROM hr_user u LEFT JOIN hr_employee e ON e.id=u.emp_id LEFT JOIN hr_legal l ON l.id=e.legal_id LEFT JOIN hr_dept d ON d.id=e.dept_id ORDER BY (u.username !~ '^[A-Za-z]+[0-9]+$'), u.username`)); });
r('PUT', '/api/users/:id', async (req, res, u, p) => {
  needIt(u, M.TP, 'v:users'); const b = await readJson(req), x = notFound(await one('SELECT * FROM hr_user WHERE id=$1', [+p.id]), 'tài khoản');
  if (!M.ROLES.some(r2 => r2[0] === b.role)) bad('Vai trò không hợp lệ');
  if ((b.role === 'admin' || x.role === 'admin') && u.role !== 'admin') deny('Chỉ quản trị hệ thống được sửa / cấp / gỡ quyền quản trị');
  if (x.username === 'nen-tang') deny('Tài khoản kết nối nền tảng — không sửa ở đây');
  const legal_ids = Array.isArray(b.legal_ids) && b.legal_ids.length ? b.legal_ids.map(Number).filter(Number.isInteger) : null;
  const ALL_IT = new Set(M.MENU.flatMap(([, fs]) => fs.flatMap(([, , x]) => Array.isArray(x) ? x : [x]))), items = Array.isArray(b.items) ? b.items.filter(i => ALL_IT.has(i)) : null;
  if (x.id === u.id && b.active === false) bad('Không tự khóa tài khoản của mình');
  await q('UPDATE hr_user SET role=$1, legal_ids=$2, items=$3, active=$4 WHERE id=$5', [b.role, legal_ids, items, b.active !== false, x.id]);
  await C.audit({ q }, 'user', x.id, 'sua', { role: x.role, legal_ids: x.legal_ids, items: x.items, active: x.active }, { role: b.role, legal_ids, items, active: b.active !== false }, u, x.full_name);
  send(res, 200, { ok: true });
});
r('POST', '/api/users/:id/reset', async (req, res, u, p) => { needIt(u, M.TP, 'v:users'); const x = notFound(await one('SELECT id, full_name, role, username FROM hr_user WHERE id=$1', [+p.id]), 'tài khoản'); if ((x.role === 'admin' && u.role !== 'admin') || x.username === 'nen-tang') deny('Không đặt lại mật khẩu tài khoản này'); await q('UPDATE hr_user SET pw_hash=$1, must_change=true WHERE id=$2', [hashPw(process.env.DEFAULT_PW || '123456'), x.id]); await C.audit({ q }, 'user', x.id, 'sua', null, null, u, 'Đặt lại mật khẩu'); send(res, 200, { ok: true }); });

// bảng lương / BH / CĐ theo mẫu: một bảng, hoặc mọi bảng của kỳ trong phạm vi người xem (báo cáo TL05, BH-01, CĐ-01)
const SHEET_OF = { TL02: 'payroll', TL05: 'payroll', 'BH-01': 'ins_sheet', 'CĐ-01': 'cd_sheet' };
// in / Excel theo mẫu chỉ khi được giao báo cáo và xem được bảng; không thì như báo cáo thường (BGĐ chỉ thấy số tổng)
const sheetOk = (code, u) => !!SHEET_OF[code] && can(u, M.E[SHEET_OF[code]], 'r') && C.has(u, 'r:' + code) && !['nld', 'truong_bp'].includes(u.role);
async function sheetTables(ent, u, qs) {
  const m = qs.month || C.today().slice(0, 7), { rows } = await C.list(ent, u, { limit: 50, f_month: m, ...(qs.legal ? { f_legal_id: qs.legal } : {}) });   // lọc kỳ trong SQL: quá 50 bảng thì kỳ cũ không bị mất
  return Promise.all(rows.filter(r2 => r2.month === m).sort((a, b) => a.legal_id - b.legal_id).map(r2 => S.table(ent, r2)));
}
const xlsxSend = (res, name, x) => sendFile(res, buildXlsx({ sheet: name, ...x }), `${name}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
r('GET', '/print-sheet/:ent/:id', async (req, res, u, p, qs) => { if (!S.TABLE[p.ent]) bad('Không phải bảng tính'); const g = await C.get(p.ent, p.id, u); html(res, P.sheets([S.printable(await S.table(p.ent, g.row))]), qs, `${p.ent}-${g.row.month}`); });
r('GET', '/api/sheet/:ent/:id/xlsx', async (req, res, u, p) => { if (!S.TABLE[p.ent]) bad('Không phải bảng tính'); const g = await C.get(p.ent, p.id, u), t = S.printable(await S.table(p.ent, g.row)); await C.audit({ q }, p.ent, g.row.id, 'xuat_excel', null, null, u); xlsxSend(res, `${M.E[p.ent].code} ${t.legal} ${g.row.month}`, S.xlsxOf([t])); });
async function pliGroups(u, qs) {
  const d = await V.report('PLI', qs, u), by = {};
  for (const r2 of d.rows) (by[r2.legal_id] ||= []).push(r2);
  return Promise.all(Object.keys(by).map(async id => ({ legal: await one('SELECT * FROM hr_legal WHERE id=$1', [+id]), rows: by[id] })));
}

// in
r('GET', '/print/:ent/:id', async (req, res, u, p, qs) => html(res, await P.form(p.ent, p.id, u, qs.tpl), qs, p.ent + '-' + p.id));
r('GET', '/print-letter/interview/:id', async (req, res, u, p, qs) => { const x = await require('./forms').letters(p.id, u, qs.kind, qs.code); html(res, P.page(x.title, x.body), qs, 'thu-' + p.id); });
r('GET', '/print-report/:code', async (req, res, u, p, qs) => {
  const c = decodeURIComponent(p.code);
  if (sheetOk(c, u)) return html(res, P.sheets(await sheetTables(SHEET_OF[c], u, qs)), qs, `${c}-${qs.month || ''}`);
  if (c === 'PLI') return html(res, P.pli(await pliGroups(u, qs), qs), qs, 'Mau-01-PLI');
  html(res, P.report(await V.report(c, qs, u), qs), qs, c);
});
r('GET', '/print-payslip/:id', async (req, res, u, p, qs) => {   // NLĐ chỉ in được phiếu của mình, khi bảng lương đã duyệt
  const x = notFound(await one('SELECT t.*, l.name lg FROM hr_payroll t JOIN hr_legal l ON l.id=t.legal_id WHERE t.id=$1', [+p.id])), mine = !can(u, M.E.payroll, 'r');   // không được giao bảng lương → như NLĐ
  if (!mine) await C.scopeCheck({ q, one }, M.E.payroll, x, u);   // đúng pháp nhân phụ trách
  if (mine &&!['da_duyet', 'da_chuyen'].includes(x.status)) deny('Bảng lương chưa duyệt');
  const ls = (x.lines || []).filter(l => mine ? l.emp_id === u.emp_id : (!qs.emp || l.emp_id === +qs.emp)); if (!ls.length) deny();
  await C.audit({ q }, 'payroll', x.id, 'in_phieu_luong', null, null, u); html(res, P.slips(x, ls, x.lg, await C.setting('pay')), qs, 'phieu-luong');
});
// bộ hồ sơ lương tháng in một lần: bảng chấm công · bảng tăng ca · bảng lương TL02 · chuyển khoản TL04 (theo pháp nhân của bảng lương)
r('GET', '/print-payroll-pack/:id', async (req, res, u, p, qs) => {
  const run = (await C.get('payroll', p.id, u)).row, m = run.month, ids = (run.lines || []).map(l => l.emp_id), legal = await one('SELECT name, bank_main FROM hr_legal WHERE id=$1', [run.legal_id]);
  const OTK = { thuong: 'Ngày thường', nghi: 'Ngày nghỉ', le: 'Lễ/tết' };
  const otRows = (await q("SELECT t.day, t.from_t, t.to_t, t.day_kind, t.hours_ok, t.task, e.code, e.full_name, d.name dept FROM hr_ot t JOIN hr_employee e ON e.id=t.emp_id LEFT JOIN hr_dept d ON d.id=e.dept_id WHERE t.status='da_duyet' AND to_char(t.day,'YYYY-MM')=$1 AND t.emp_id = ANY($2) ORDER BY t.day, e.code", [m, ids])).map(r2 => ({ day: r2.day, from_t: r2.from_t, to_t: r2.to_t, kind: OTK[r2.day_kind] || r2.day_kind, hours: +r2.hours_ok || 0, task: r2.task, code: r2.code, name: r2.full_name, dept: r2.dept }));
  const ot = {}; for (const l of run.lines || []) ot[l.emp_id] = otRows.filter(r2 => r2.code === l.code).reduce((s, r2) => s + r2.hours, 0);
  const d = { last: B.lastDay(m).slice(8), hol: [...await B.holidays({ q })].filter(x => x.startsWith(m)), emps: (run.lines || []).map(l => ({ id: l.emp_id, name: l.name })), att: await B.monthAtt({ q }, m, 'AND e.id = ANY($2)', [ids]), ot, otRows, types: await q('SELECT code, name FROM hr_att_type ORDER BY grp, id') };
  html(res, P.payPack(run, legal, d, S.printable(await S.table('payroll', run))), qs, `ho-so-luong-${m}`); });
r('GET', '/print-bank/:id', async (req, res, u, p, qs) => { need(u, [...M.NS, 'ke_toan']); const x = notFound(await one('SELECT * FROM hr_payroll WHERE id=$1', [+p.id])); if (u.role !== 'ke_toan') { if (!can(u, M.E.payroll, 'r')) deny(); await C.scopeCheck({ q, one }, M.E.payroll, x, u); } html(res, P.bank(x, await one('SELECT name, bank_main FROM hr_legal WHERE id=$1', [x.legal_id])), qs, 'chuyen-khoan'); });

// tích hợp nền tảng chung: /api/v1/* (X-Api-Key)
PF.mount(r, { send, readJson });

// ---------- cập nhật trực tiếp: có thao tác ghi dữ liệu (lưu, duyệt, xóa, nhập file, nền tảng gửi đơn, việc nền) → báo mọi màn hình đang mở tải lại ----------
const LIVE = { v: Date.now(), subs: new Set(), t: null };
const bump = () => { clearTimeout(LIVE.t); LIVE.t = setTimeout(() => { LIVE.v++; for (const s of LIVE.subs) s.write(`data: ${LIVE.v}\n\n`); }, 400); };   // gom nhiều lần ghi liền nhau thành 1 lần báo
const NO_BUMP = /^\/api\/(login|logout|cv-parse|as\/|notices\/read)/;
r('GET', '/api/live', async (req, res) => {   // luồng sự kiện (SSE): mỗi lần dữ liệu đổi gửi số phiên bản mới
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`retry: 5000\ndata: ${LIVE.v}\n\n`); LIVE.subs.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25e3);
  req.on('close', () => { clearInterval(ping); LIVE.subs.delete(res); });
});
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), qs = Object.fromEntries(url.searchParams), pathn = (() => { try { return decodeURI(url.pathname); } catch { return url.pathname; } })();   // %E0… sai mã không làm sập máy chủ
  try {
    if (pathn.startsWith('/api/') || pathn.startsWith('/print')) {
      for (const rt of routes) { if (rt.method !== req.method) continue; const m = rt.re.exec(url.pathname); if (!m) continue;
        const u = rt.open ? null : await userFromReq(req); if (!rt.open && !u) throw new HttpError(401, 'Cần đăng nhập');
        if (req.method !== 'GET' && !NO_BUMP.test(url.pathname)) res.on('finish', () => { if (res.statusCode < 400) bump(); });
        return await rt.fn(req, res, u, m.groups || {}, qs); }
      throw new HttpError(404, 'Không có đường dẫn này');
    }
    const f = path.normalize(path.join(PUBLIC, pathn === '/' ? 'index.html' : pathn)); if (!f.startsWith(PUBLIC) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, 'Không tìm thấy', { 'Content-Type': 'text/plain; charset=utf-8' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); fs.createReadStream(f).pipe(res);
  } catch (e) { if (!(e instanceof HttpError)) console.error(e); if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Lỗi máy chủ: ' + e.message, fields: e.fields }); }
});
(async () => { await migrate({ q, one }); await PF.ensure(); J.start(bump); PF.start(); server.listen(PORT, HOST, () => console.log(`CTG-HCNS: http://localhost:${PORT}`)); })().catch(e => { console.error(e); process.exit(1); });
