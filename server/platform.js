// Tích hợp nền tảng chung (app của mọi phòng ban): nhân viên viết đơn / chấm công trên nền tảng → dữ liệu đổ về app HCNS;
// HCNS duyệt ở đây → báo trạng thái ngược lại (webhook, có gửi lại). Nền tảng đọc được phép, công, phiếu lương của từng nhân viên.
//   Xác thực: header X-Api-Key = PLATFORM_KEY (.env). Mỗi đơn mang ext_id riêng của nền tảng → gửi lại bao nhiêu lần cũng chỉ ghi 1 đơn.
//   Đơn nghỉ phép: trưởng phòng đã duyệt trên nền tảng → vào app ở trạng thái Đã duyệt (tự ghi bảng công). Đơn khác: chờ HCNS duyệt.
const crypto = require('crypto');
const { q, one, tx } = require('./db');
const C = require('./core');
const B = require('./biz');
const M = require('./meta');

const KEY = process.env.PLATFORM_KEY || '', HOOK = process.env.PLATFORM_WEBHOOK || '';
// webhook ký HMAC bằng khóa riêng PLATFORM_HOOK_SECRET (không gửi khóa API chính ra ngoài); chưa đặt khóa riêng → như cũ (X-Api-Key)
const HOOK_SECRET = process.env.PLATFORM_HOOK_SECRET || '', MAX_TRIES = 20;
const SRC = 'nen_tang';
// loại đơn nhận từ nền tảng; ref: trường liên kết nhận theo mã (vd. vehicle_code → vehicle_id)
const TYPES = { leave: {}, explain: {}, ot: {}, trip: {}, att_add: {}, resign: {}, vpp_req: {}, room_book: { room_code: ['room_id', 'room'] }, car_book: { vehicle_code: ['vehicle_id', 'vehicle'] }, mail: {}, meal_reg: {}, seal: {} };
const PRE_APPROVED = ['leave'];   // trưởng phòng duyệt trên nền tảng
let PU = null;                    // tài khoản hệ thống «Nền tảng chung» (không đăng nhập được) — ghi người trình, nhật ký

async function ensure(db = { q, one }) {
  await db.q(`CREATE TABLE IF NOT EXISTS hr_ext (src text NOT NULL, ext_id text NOT NULL, ent text NOT NULL, rec_id integer NOT NULL, at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (src, ext_id));
    CREATE INDEX IF NOT EXISTS hr_ext_rec ON hr_ext (ent, rec_id);
    CREATE TABLE IF NOT EXISTS hr_outbox (id serial PRIMARY KEY, body jsonb NOT NULL, tries integer NOT NULL DEFAULT 0, last_error text, sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());`);
  await db.q("INSERT INTO hr_user (username, full_name, role, title, active, must_change) VALUES ('nen-tang', 'Nền tảng chung', 'admin', 'Tích hợp', false, false) ON CONFLICT (lower(username)) DO NOTHING");
  const u = await db.one("SELECT id, username, full_name FROM hr_user WHERE username = 'nen-tang'");
  PU = { ...u, role: 'admin', sys: true };
}

const fail = (m, fields) => C.bad(m, fields ? { fields } : undefined);
const auth = req => { const k = Buffer.from(String(req.headers['x-api-key'] || '')), K = Buffer.from(KEY); if (!KEY || k.length !== K.length || !crypto.timingSafeEqual(k, K)) throw new C.HttpError(401, 'Sai hoặc thiếu X-Api-Key'); };   // so độ dài theo byte (khóa có ký tự lạ không làm lỗi 500)
const empBy = async code => (code && await one('SELECT * FROM hr_employee WHERE code = $1', [String(code).trim()])) || fail(`Không có nhân viên mã «${code}» trong app HCNS`);
const statusOf = async (ent, id) => { const r = await one(`SELECT * FROM ${M.E[ent].table} WHERE id = $1`, [id]), f = M.E[ent].fields.find(x => x.k === 'status'); return r && { id: r.id, code: r.code || null, status: r.status || null, status_label: f ? (f.o.find(o => o[0] === r.status)?.[1] || r.status) : null }; };

// ---------- nhận đơn ----------
async function request(type, b) {
  const t = (Object.hasOwn(TYPES, type) && TYPES[type]) || fail(`Loại đơn «${type}» không nhận (${Object.keys(TYPES).join(', ')})`), e = M.E[type];
  const ext = String(b.ext_id || '').trim() || fail('Thiếu ext_id (mã đơn trên nền tảng)');
  const had = await one('SELECT ent, rec_id FROM hr_ext WHERE src = $1 AND ext_id = $2', [SRC, ext]);
  if (had) { if (had.ent !== type) fail(`ext_id ${ext} đã dùng cho loại đơn ${had.ent}`); return { duplicate: true, ...await statusOf(had.ent, had.rec_id) }; }
  const emp = await empBy(b.emp_code), d = { ...(b.data || {}) };
  // chỉ nhận trường nhập được của biểu mẫu; trạng thái, mã phiếu, pháp nhân do app tự xác định
  const input = {};
  for (const f of e.fields) if (!f.ro && !f.hcns && f.t !== 'code' && f.k !== 'status' && f.t !== 'ref' && f.k in d) input[f.k] = d[f.k];
  input.emp_id = emp.id;
  if (C.F[type].legal_id) input.legal_id = emp.legal_id;
  if (C.F[type].dept_id && emp.dept_id) input.dept_id = emp.dept_id;
  for (const [k, [to, ent]] of Object.entries(t)) if (d[k] != null) input[to] = (await one(`SELECT id FROM ${M.E[ent].table} WHERE code = $1`, [String(d[k])]))?.id || fail(`Không có ${M.E[ent].one} mã «${d[k]}»`);
  if (d.cover_code) input.cover_id = (await empBy(d.cover_code)).id;
  if (type === 'vpp_req') { const items = Object.fromEntries((await q('SELECT code, name, unit FROM hr_vpp_item')).map(i => [i.code, i])); input.lines = (d.lines || []).map(l => ({ code: l.code, name: items[l.code]?.name || l.name || '', unit: items[l.code]?.unit || l.unit || '', qty: String(l.qty ?? ''), note: l.note || '' })); }
  const note = `Từ nền tảng chung · ${ext}`;
  // tạo + trình + duyệt trong một giao dịch: lỗi giữa chừng (vd. kỳ công đã khóa) thì không để lại đơn dở, nền tảng gửi lại cùng ext_id được
  const id = await tx(async db => {
    const row = (await C.create(type, input, PU, { system: true, note, db })).row;
    await db.q('INSERT INTO hr_ext (src, ext_id, ent, rec_id) VALUES ($1,$2,$3,$4)', [SRC, ext, type, row.id]);
    if (e.flow) {
      await C.submit(type, row.id, PU, { comment: note, db });
      if (PRE_APPROVED.includes(type) && b.approved) {
        const by = b.approved.by ? `${b.approved.by}${b.approved.title ? ` (${b.approved.title})` : ''}` : 'trưởng phòng', at = b.approved.at ? ` lúc ${b.approved.at}` : '';
        await C.approve(type, row.id, PU, { ok: b.approved.ok !== false, comment: `${b.approved.ok === false ? 'Từ chối' : 'Đã duyệt'} trên nền tảng chung bởi ${by}${at}${b.approved.comment ? ': ' + b.approved.comment : ''}`, db });
      }
    }
    return row.id;
  });
  return await statusOf(type, id);
}

// ---------- chấm công từ app điện thoại: gộp lượt vào / ra theo ngày, ghi bảng công (không đè đơn đã duyệt) ----------
const R = 6371000, rad = x => x * Math.PI / 180;
const dist = (a, b) => 2 * R * Math.asin(Math.sqrt(Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2));
async function punches(list) {
  if (!Array.isArray(list) || !list.length) fail('Cần mảng punches [{ emp_code, at, kind?, lat?, lng? }]');
  const sites = (await q("SELECT name, lat, lng, radius FROM hr_site WHERE state = 'on'")).map(s => ({ ...s, lat: +s.lat, lng: +s.lng }));
  const by = {}, out = { ok: 0, skip: 0, outside: [], err: [] };
  for (const p of list) {
    const t = new Date(p.at || NaN), code = String(p.emp_code || '').trim(); if (!code || isNaN(t)) { out.err.push(`${code || '?'}: thiếu mã NV hoặc thời điểm`); continue; }   // at null → không lấy nhầm ngày 01/01/1970
    const v = new Date(t.getTime() + 7 * 3600e3).toISOString(), day = v.slice(0, 10), hm = v.slice(11, 16);
    const far = sites.length && p.lat != null && p.lng != null && !sites.some(s => dist(s, { lat: +p.lat, lng: +p.lng }) <= +s.radius);
    if (far) out.outside.push(`${code} ${day} ${hm}`);
    ((by[code] ||= {})[day] ||= []).push({ hm, kind: p.kind, far });
  }
  for (const [code, days] of Object.entries(by)) {
    const e = await one('SELECT id FROM hr_employee WHERE code = $1', [code]); if (!e) { out.err.push(`${code}: không có trong app HCNS`); continue; }
    for (const [day, ps] of Object.entries(days)) {
      const cur = await one('SELECT * FROM hr_attendance WHERE emp_id = $1 AND day = $2', [e.id, day]);
      if (cur && !['may', 'app'].includes(cur.source)) { out.skip++; continue; }     // đã có đơn duyệt / HCNS sửa tay
      // có ghi kind thì theo kind; không ghi thì lượt sớm nhất là vào, muộn nhất (nếu > 1 lượt) là ra
      const hs = ps.map(x => x.hm).sort(), typed = ps.some(x => x.kind);
      const ins = typed ? ps.filter(x => x.kind === 'in').map(x => x.hm) : [hs[0]], outs = typed ? ps.filter(x => x.kind === 'out').map(x => x.hm) : hs.length > 1 ? [hs.at(-1)] : [];
      const i = [cur?.in_t, ...ins].filter(Boolean).sort()[0] || null, o = [cur?.out_t, ...outs].filter(Boolean).sort().at(-1) || null;
      try {
        await B.setMark({ q, one }, e.id, day, i && o ? 'HC' : i ? 'XO' : o ? 'XI' : 'XX', { in_t: i, out_t: o }, 'app'); out.ok++;
        // chấm ngoài vùng: vẫn tính công, đánh dấu trên ô công để HCNS rà soát
        const far = ps.filter(x => x.far).map(x => x.hm); if (far.length) await q("UPDATE hr_attendance SET outside = concat_ws(', ', nullif(outside, ''), $3::text) WHERE emp_id = $1 AND day = $2", [e.id, day, far.join(', ')]);
      } catch (er) { out.err.push(`${code} ${day}: ${er.message}`); }
    }
  }
  if (out.outside.length) await C.notify({ q }, (await q("SELECT id FROM hr_user WHERE active AND role IN ('cv_hcns','tp_hcns')")).map(x => x.id), `Chấm công ngoài vùng: ${out.outside.length} lượt`, out.outside.slice(0, 10).join(' · '), 'v/timesheet');
  return out;
}

// ---------- báo trạng thái về nền tảng (webhook); lỗi thì gửi lại mỗi phút, tối đa 20 lần ----------
async function notify(ent, recId) {
  const x = await one('SELECT ext_id FROM hr_ext WHERE src = $1 AND ent = $2 AND rec_id = $3', [SRC, ent, recId]); if (!x) return;
  const s = await statusOf(ent, recId), a = await one("SELECT a.status, a.comment, a.decided_at, u.full_name FROM hr_approval a LEFT JOIN hr_user u ON u.id = a.decided_by WHERE a.ent = $1 AND a.rec_id = $2 ORDER BY a.id DESC LIMIT 1", [ent, recId]);
  await q('INSERT INTO hr_outbox (body) VALUES ($1)', [JSON.stringify({ event: 'request.status', type: ent, ext_id: x.ext_id, ...s, decided_by: a?.full_name || null, comment: a?.comment || null, at: new Date().toISOString() })]);
  flush().catch(() => {});
}
// tin HCNS gửi người dùng qua nền tảng (thư mời PV, thư báo kết quả…): nền tảng chuyển vào tài khoản nhân viên / gửi ứng viên qua email, SMS
async function pushMessage(msg) {
  await q('INSERT INTO hr_outbox (body) VALUES ($1)', [JSON.stringify({ event: 'hr.message', ...msg, at: new Date().toISOString() })]);
  flush().catch(() => {});
  return { queued: true, webhook: !!HOOK };
}
// một lượt gửi tại một thời điểm: nhiều tin xếp hàng liền nhau (thư PV cho nhiều ứng viên) không gửi trùng cùng một dòng
let FL = null, AGAIN = false;
function flush() {
  if (FL) { AGAIN = true; return FL; }
  return FL = (async () => { do { AGAIN = false; await flush1(); } while (AGAIN); })().finally(() => { FL = null; });
}
async function flush1() {
  if (!HOOK) return;
  for (const m of await q('SELECT * FROM hr_outbox WHERE sent_at IS NULL AND tries < $1 ORDER BY id LIMIT 50', [MAX_TRIES])) {
    try {
      const body = JSON.stringify(m.body), ts = String(Math.floor(Date.now() / 1000));
      const auth = HOOK_SECRET ? { 'X-Timestamp': ts, 'X-Signature': 'sha256=' + crypto.createHmac('sha256', HOOK_SECRET).update(ts + '.' + body).digest('hex') } : { 'X-Api-Key': KEY };
      const r = await fetch(HOOK, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      await q('UPDATE hr_outbox SET sent_at = now(), tries = tries + 1, last_error = NULL WHERE id = $1', [m.id]);
    } catch (er) {
      const x = await one('UPDATE hr_outbox SET tries = tries + 1, last_error = $2 WHERE id = $1 RETURNING tries', [m.id, String(er.message).slice(0, 300)]);
      if (x?.tries >= MAX_TRIES) await C.notify({ q }, (await q("SELECT id FROM hr_user WHERE active AND role IN ('tp_hcns','admin') AND username <> 'nen-tang'")).map(u => u.id),   // hết lượt gửi lại → báo người quản lý
        `Không gửi được tin #${m.id} sang nền tảng chung`, `${m.body?.event || ''} · đã thử ${x.tries} lần · ${String(er.message).slice(0, 120)}`, null);
    }
  }
}

// ---------- đọc cho nền tảng ----------
async function leave(code, year) {
  const e = await empBy(code), y = +year || +C.today().slice(0, 4); await B.syncLeave({ q }, y, e.id);
  const b = await one('SELECT * FROM hr_leave_bal WHERE emp_id = $1 AND year = $2', [e.id, y]), used = await B.leaveUsed({ one }, e.id, y);
  const total = b ? +b.opening + +b.earned + +b.adjust - +(b.used_before || 0) : null;
  return { emp_code: e.code, year: y, opening: b ? +b.opening : null, earned: b ? +b.earned : null, adjust: b ? +b.adjust : null, used: +used, left: total == null ? null : total - used };
}
async function timesheet(code, month) {
  const e = await empBy(code), m = C.isoMonth(month) || C.today().slice(0, 7), a = (await B.monthAtt({ q }, m, 'AND e.id = $2', [e.id]))[e.id] || { days: {}, work: 0, paid_leave: 0, unpaid: 0, miss: 0 };
  const rows = await q("SELECT to_char(day,'YYYY-MM-DD') AS day, mark, in_t, out_t, source FROM hr_attendance WHERE emp_id = $1 AND to_char(day,'YYYY-MM') = $2 ORDER BY day", [e.id, m]);
  const lock = await one('SELECT status FROM hr_att_period WHERE legal_id = $1 AND month = $2', [e.legal_id, m]);
  return { emp_code: e.code, month: m, locked: lock?.status === 'khoa', work: a.work, paid_leave: a.paid_leave, unpaid: a.unpaid, missing: a.miss, days: rows };
}
const SLIP = ['worked', 'd100', 'd85', 'p1', 'p2', 'kpi', 'p1_net', 'p2_net', 'meal', 'ot_h', 'ot_pay', 'trip_pay', 'bday', 'leave_pay', 'bonus', 'total', 'e_bhxh', 'e_bhyt', 'e_bhtn', 'e_ins', 'tax', 'tax_adj', 'advance', 'other_ded', 'all_ded', 'net'];
async function payslips(code, month) {   // chỉ bảng lương đã duyệt / đã chuyển
  const e = await empBy(code), out = [];
  for (const r of await q(`SELECT t.id, t.month, t.status, t.lines, l.short legal FROM hr_payroll t JOIN hr_legal l ON l.id = t.legal_id WHERE t.status IN ('da_duyet','da_chuyen') ${month ? 'AND t.month = $1' : ''} ORDER BY t.month DESC LIMIT 24`, month ? [C.isoMonth(month)] : [])) {
    const l = (r.lines || []).find(x => x.emp_id === e.id); if (!l) continue;
    out.push({ id: r.id, month: r.month, legal: r.legal, status: r.status, ...Object.fromEntries(SLIP.map(k => [k, l[k] ?? null])), pay_to: l.acct ? 'chuyen_khoan' : 'tien_mat' });
  }
  return { emp_code: e.code, payslips: out };
}
async function requests(code) {
  // lọc theo nhân viên ngay trong SQL (trước đây lấy 500 đơn mới nhất của mọi người rồi mới lọc → người ít gửi bị mất đơn cũ)
  const e = await empBy(code), xs = [];
  for (const k of Object.keys(TYPES)) xs.push(...await q(`SELECT x.ext_id, x.ent, x.rec_id, x.at FROM hr_ext x JOIN ${M.E[k].table} t ON t.id = x.rec_id WHERE x.src = $1 AND x.ent = $2 AND t.emp_id = $3`, [SRC, k, e.id]));
  const out = [];
  for (const x of xs.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 100)) { const s = await statusOf(x.ent, x.rec_id); if (s) out.push({ ext_id: x.ext_id, type: x.ent, ...s, received_at: x.at }); }
  return { emp_code: e.code, requests: out };
}
async function catalog() {
  return { leave_types: await q('SELECT code, name, days, grp FROM hr_att_type ORDER BY grp, id'), rooms: await q('SELECT code, name, place, seats FROM hr_room ORDER BY code'), vehicles: await q("SELECT code, plate, brand FROM hr_vehicle WHERE state = 'san_sang' ORDER BY code"),
    vpp_items: await q(`SELECT code, name, unit FROM hr_vpp_item t ORDER BY ${M.CODE_ORDER}`), sites: await q("SELECT name, lat, lng, radius FROM hr_site WHERE state = 'on'"), holidays: await q("SELECT to_char(day,'YYYY-MM-DD') AS day, name FROM hr_holiday ORDER BY day"),
    types: Object.fromEntries(Object.keys(TYPES).map(k => [k, { title: k === 'seal' ? 'Đề nghị đóng dấu' : M.E[k].title, code: M.E[k].code, pre_approved: PRE_APPROVED.includes(k), fields: M.E[k].fields.filter(f => !f.ro && !f.hcns && f.t !== 'code' && f.k !== 'status' && !['emp_id', 'legal_id', 'dept_id'].includes(f.k)).map(f => ({ k: f.t === 'ref' ? Object.keys(TYPES[k]).find(x => TYPES[k][x][0] === f.k) || (f.k === 'cover_id' ? 'cover_code' : f.k) : f.k, label: f.l, type: f.t === 'ref' ? 'code' : f.t, required: !!f.req && !(k === 'leave' && f.k === 'days'), options: f.o?.map(o => ({ value: o[0], label: o[1] })) })) }])) };
}

// ---------- mục «Chấm công & đơn từ» cho nhân viên (bản thử của phần sẽ cắm vào app các phòng): đi đúng đường nhận đơn / chấm công như nền tảng ----------
const MY = Object.keys(TYPES);
async function portal(u) {
  const e = u.emp_id && await one('SELECT e.*, l.short legal, d.name dept FROM hr_employee e LEFT JOIN hr_legal l ON l.id = e.legal_id LEFT JOIN hr_dept d ON d.id = e.dept_id WHERE e.id = $1', [u.emp_id]);
  if (!e) C.bad('Tài khoản chưa gắn với hồ sơ nhân viên');
  const now = new Date(Date.now() + 7 * 3600e3).toISOString(), day = now.slice(0, 10), m = day.slice(0, 7);
  const reqs = [];
  for (const k of MY) {
    const E = M.E[k], f = E.fields.find(x => x.k === 'status');
    for (const r of await q(`SELECT t.*, ${E.disp} AS label FROM ${E.table} t WHERE t.emp_id = $1 ORDER BY t.id DESC LIMIT 8`, [e.id]))
      reqs.push({ type: k, id: r.id, title: E.title, icon: E.icon, label: r.label, status: r.status || null, status_label: f ? (f.o.find(o => o[0] === r.status)?.[1] || r.status) : 'Đã ghi nhận', color: f ? f.o.find(o => o[0] === r.status)?.[2] || 's' : 'g', at: r.created_at });
  }
  reqs.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const ts = await timesheet(e.code, m), hol = await B.holidays({ q }), last = +B.lastDay(m).slice(8); let std = 0; for (let d = 1; d <= last; d++) if (B.isWorkday(`${m}-${String(d).padStart(2, '0')}`, hol)) std++;
  // hoạt động văn hóa hôm nay của nhân viên (hết hạn / không áp dụng thì không hiện)
  const hm = now.slice(11, 16), culture = [];
  for (const a of await q("SELECT * FROM hr_culture WHERE state = 'on' AND from_on <= $1 AND to_on >= $1 ORDER BY from_t", [day])) if (B.cultureOn(a, day) && B.cultureFits(a, e)) {
    const l = await one('SELECT result, at FROM hr_culture_log WHERE act_id = $1 AND emp_id = $2 AND day = $3', [a.id, e.id, day]);
    culture.push({ id: a.id, name: a.name, kind: a.kind, place: a.place, from_t: a.from_t, to_t: a.to_t, to_on: a.to_on, note: a.note, log: l, open: hm >= a.from_t && hm <= a.to_t, past: hm > a.to_t });
  }
  // tiền ăn của chính người xem: khoản chờ thanh toán + khoản vừa trả (3 tháng gần nhất); tài khoản nhận tiền để dựng mã QR
  const meal = await q("SELECT id, month, n_days, amount, pay_st, paid_at FROM hr_meal_reg WHERE emp_id = $1 AND pay_st IN ('cho_tt', 'da_tt') ORDER BY month DESC LIMIT 3", [e.id]), mealBank = await C.setting('meal');
  // khóa đào tạo của chính người xem (12 tháng gần nhất): kết quả + file đã tự nộp
  const trainings = [];
  const TF = M.E.training.fields, lab = (k, v) => TF.find(f => f.k === k)?.o?.find(o => o[0] === v)?.[1] || v || '';
  for (const t of await q("SELECT id, code, name, kind, mode, sessions, hours, sched, from_on, to_on, place, trainer, state, note, emps FROM hr_training WHERE state <> 'huy' AND emps @> $1::jsonb AND coalesce(to_on, from_on) >= $2::date - 365 ORDER BY from_on DESC LIMIT 8", [JSON.stringify([{ code: e.code }]), day])) {
    const me = (t.emps || []).find(x => x.code === e.code) || {};
    trainings.push({ id: t.id, code: t.code, name: t.name, from_on: t.from_on, to_on: t.to_on, place: t.place, trainer: t.trainer, state: t.state, result: me.result || '', score: me.score || '', self: me.self || '',
      kind: lab('kind', t.kind), mode: lab('mode', t.mode), state_l: lab('state', t.state), sessions: t.sessions, hours: t.hours, sched: t.sched || [], note: t.note || '', n_emps: (t.emps || []).filter(x => x.code).length,
      files: await q("SELECT id, name, mime FROM hr_file WHERE ent = 'training' AND rec_id = $1 AND kind = 'hv' AND uploaded_by = $2 AND deleted_at IS NULL ORDER BY id", [t.id, u.id]) });
  }
  // dob: ngày sinh của chính người xem — tờ lịch xem ngày xung / hợp tuổi
  return { meal, mealBank, trainings, emp: { id: e.id, code: e.code, name: e.full_name, title: e.title, dept: e.dept, legal: e.legal, dob: e.dob || null }, today: { day, now, ...(ts.days.find(x => x.day === day) || {}) }, leave: await leave(e.code), culture,
    month: { ...ts, std, last, hol: [...hol].filter(d => d.startsWith(m)) }, reqs: reqs.slice(0, 15), payslips: (await payslips(e.code)).payslips.slice(0, 6), catalog: await catalog() };
}
async function portalPunch(u, b) {
  const e = await one('SELECT id, code FROM hr_employee WHERE id = $1', [u.emp_id || 0]) || C.bad('Tài khoản chưa gắn với hồ sơ nhân viên');
  const day = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), cur = await one('SELECT in_t FROM hr_attendance WHERE emp_id = $1 AND day = $2', [e.id, day]);
  return punches([{ emp_code: e.code, at: new Date().toISOString(), kind: cur?.in_t ? 'out' : 'in', lat: b.lat, lng: b.lng }]);
}
// ---------- tiền ăn tháng: HCNS tổng hợp & gửi → người ăn quét QR chuyển khoản → bấm «Đã thanh toán» → tự lập phiếu thu SA02 ----------
// tiền = Σ đơn giá các ngày đã đăng ký (đơn giá theo «Suất ăn thực tế theo ngày»; ngày chưa nhập đơn giá → lấy đơn giá gần nhất trong tháng)
async function mealBill(u, month, { onlyNew = false } = {}) {   // onlyNew (việc nền): chỉ người chưa được báo tiền ăn
  if (!M.HC.includes(u.role) && u.role !== 'admin') C.deny('Chỉ phòng HCNS tổng hợp tiền ăn');
  if (!/^\d{4}-\d{2}$/.test(month || '')) C.bad('Chọn tháng cần tổng hợp');
  const prices = new Map((await q("SELECT to_char(day,'YYYY-MM-DD') d, price FROM hr_meal_day WHERE to_char(day,'YYYY-MM') = $1 AND price > 0 ORDER BY day", [month])).map(x => [x.d, +x.price]));
  const last = [...prices.values()].pop() ?? (+(await one('SELECT price FROM hr_meal_day WHERE price > 0 ORDER BY day DESC LIMIT 1'))?.price || 0);
  if (!last) C.bad('Chưa có đơn giá suất ăn — nhập «Suất ăn thực tế theo ngày» (có đơn giá) trước khi tổng hợp');
  const regs = await q("SELECT r.*, e.code, e.full_name FROM hr_meal_reg r JOIN hr_employee e ON e.id = r.emp_id WHERE r.month = $1 AND coalesce(r.n_days, 0) > 0", [month]);
  const out = { n: 0, total: 0, paid: 0, noAcc: [] }, mm = `${month.slice(5)}/${month.slice(0, 4)}`;
  for (const r of regs) {
    if (r.pay_st === 'da_tt') { out.paid++; continue; }
    if (onlyNew && r.pay_st) continue;
    const amount = (r.days || []).reduce((s, d) => s + (prices.get(`${month}-${String(d).padStart(2, '0')}`) ?? last), 0);
    await q("UPDATE hr_meal_reg SET amount = $1, pay_st = 'cho_tt', bill_at = now() WHERE id = $2", [amount, r.id]);
    const us = await q('SELECT id FROM hr_user WHERE emp_id = $1 AND active', [r.emp_id]);
    if (us.length) await C.notify({ q, one }, us.map(x => x.id), `Tiền ăn tháng ${mm}: ${amount.toLocaleString('vi-VN')} đ`, `${r.n_days} suất — bấm để xem mã QR chuyển khoản và xác nhận đã thanh toán`, 'v/portal');
    else out.noAcc.push(`${r.code} ${r.full_name}`);
    out.n++; out.total += amount;
  }
  await C.audit({ q }, 'meal_reg', null, 'tu_dong', null, null, u, `Tổng hợp tiền ăn ${mm}: ${out.n} người, ${out.total} đ`);
  return out;
}
async function mealPaid(u, id) {   // người ăn tự xác nhận đã chuyển khoản
  const r = await one('SELECT r.*, e.code, e.full_name FROM hr_meal_reg r JOIN hr_employee e ON e.id = r.emp_id WHERE r.id = $1', [+id]);
  if (!r || r.emp_id !== u.emp_id) C.bad('Không tìm thấy khoản tiền ăn của bạn');
  if (r.pay_st === 'da_tt') return { ok: true, paid_at: r.paid_at };
  if (r.pay_st !== 'cho_tt') C.bad('Khoản này chưa được phòng HCNS gửi thông báo');
  return tx(async db => {
    const now = new Date().toISOString(), day = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
    await db.q("UPDATE hr_meal_reg SET pay_st = 'da_tt', paid_at = $1 WHERE id = $2", [now, r.id]);
    await C.create('meal_in', { legal_id: r.legal_id, month: r.month, name: `${r.code} · ${r.full_name}`, qty: r.n_days, amount: r.amount, got_on: day, paid_at: now, reg_id: r.id, doc: 'Tự xác nhận chuyển khoản trên app' }, u, { db, system: true });
    return { ok: true, paid_at: now };
  });
}
async function portalCulture(u, id) {   // nhân viên tự điểm danh đúng khung giờ
  const e = await one('SELECT id, legal_id, dept_id FROM hr_employee WHERE id = $1', [u.emp_id || 0]) || C.bad('Tài khoản chưa gắn với hồ sơ nhân viên');
  const now = new Date(Date.now() + 7 * 3600e3).toISOString(), day = now.slice(0, 10), hm = now.slice(11, 16), a = await one('SELECT * FROM hr_culture WHERE id = $1', [+id]);
  if (!a || !B.cultureOn(a, day) || !B.cultureFits(a, e)) C.bad('Hôm nay bạn không có hoạt động này');
  if (hm < a.from_t || hm > a.to_t) C.bad(`Chỉ điểm danh được trong khung ${a.from_t}–${a.to_t}`);
  const r = await one(`INSERT INTO hr_culture_log (act_id, emp_id, day, at, result, source, created_by) VALUES ($1,$2,$3,$4,'co_mat','nv',$5) ON CONFLICT (act_id, emp_id, day) DO NOTHING RETURNING id`, [a.id, e.id, day, hm, u.id]);
  if (!r) C.bad('Bạn đã điểm danh hoạt động này hôm nay'); return { ok: true, at: hm };
}
async function portalRequest(u, type, b) {
  const e = await one('SELECT code FROM hr_employee WHERE id = $1', [u.emp_id || 0]) || C.bad('Tài khoản chưa gắn với hồ sơ nhân viên');
  return request(type, { ext_id: 'portal-' + crypto.randomUUID(), emp_code: e.code, data: b.data || {} });   // đơn nghỉ: chờ duyệt trong app (trên nền tảng thật trưởng phòng duyệt trước)
}

// ---------- định tuyến /api/v1/* ----------
function mount(r, { send, readJson }) {
  const open = (method, path, fn) => r(method, path, async (req, res, u, p, qs) => { auth(req); send(res, 200, await fn(req, p, qs)); }, { open: 1 });
  open('GET', '/api/v1/ping', async () => ({ ok: true, app: 'CTG-HCNS', at: new Date().toISOString() }));
  open('GET', '/api/v1/catalog', catalog);
  open('POST', '/api/v1/requests/:type', async (req, p) => request(p.type, await readJson(req)));
  open('GET', '/api/v1/requests/:ext', async (req, p) => { const x = await one('SELECT ent, rec_id FROM hr_ext WHERE src = $1 AND ext_id = $2', [SRC, decodeURIComponent(p.ext)]) || C.notFound(null, 'đơn'); return { ext_id: decodeURIComponent(p.ext), type: x.ent, ...await statusOf(x.ent, x.rec_id) }; });
  open('POST', '/api/v1/punches', async req => punches((await readJson(req)).punches));
  open('GET', '/api/v1/employees/:code/leave', async (req, p, qs) => leave(decodeURIComponent(p.code), qs.year));
  open('GET', '/api/v1/employees/:code/timesheet', async (req, p, qs) => timesheet(decodeURIComponent(p.code), qs.month));
  open('GET', '/api/v1/employees/:code/payslips', async (req, p, qs) => payslips(decodeURIComponent(p.code), qs.month));
  open('GET', '/api/v1/employees/:code/requests', async (req, p) => requests(decodeURIComponent(p.code)));
  // mục «Chấm công & đơn từ» trong app (đăng nhập bằng tài khoản nhân viên)
  r('GET', '/api/portal', async (req, res, u) => send(res, 200, await portal(u)));
  r('POST', '/api/portal/punch', async (req, res, u) => send(res, 200, await portalPunch(u, await readJson(req))));
  r('POST', '/api/portal/culture/:id', async (req, res, u, p) => send(res, 200, await portalCulture(u, p.id)));
  r('POST', '/api/portal/meal-paid/:id', async (req, res, u, p) => send(res, 200, await mealPaid(u, p.id)));
  r('POST', '/api/meal/bill', async (req, res, u) => send(res, 200, await mealBill(u, (await readJson(req)).month)));
  r('POST', '/api/portal/request/:type', async (req, res, u, p) => send(res, 200, await portalRequest(u, p.type, await readJson(req))));
}
const start = () => { C.onDecide((ent, id) => notify(ent, id).catch(e => console.error('Báo nền tảng lỗi:', e.message))); setInterval(() => flush().catch(() => {}), 60e3); };

module.exports = { ensure, mount, start, request, punches, flush, pushMessage, mealBill, TYPES };
