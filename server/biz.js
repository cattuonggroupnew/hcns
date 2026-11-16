// Nghiệp vụ & tự động hóa: mỗi thao tác của HCNS kéo theo các dữ liệu liên quan, để không phải nhập lại.
//   Ứng viên nhận Offer → hồ sơ NV + HĐ thử việc · QĐ duyệt → cập nhật hồ sơ, lương, lịch sử · HĐ mới → thay HĐ cũ
//   Đơn nghỉ / công tác / giải trình / chấm bù duyệt → tự ghi bảng công · Đơn nghỉ việc duyệt → QĐ chấm dứt nháp, thu hồi tài sản
//   Mỗi tháng (jobs.js): nháp bảng công – lương – BH – CĐ, tăng/giảm lao động so với tháng trước, cộng phép.
const C = require('./core');
const { q, one } = require('./db');
const { bad, today, addDays, dayDiff } = C;

const setting = k => C.setting(k);
// «1.500.000» = nghìn; «0.5», «12,5» = thập phân (trước đây «0.5» thành 5)
const n = v => { const s = String(v ?? '').trim(); return +(/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(',', '.')) || 0; };
const lastDay = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
const monthsOf = (a, b) => { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; };
const nextMonth = m => { const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 1)); return d.toISOString().slice(0, 7); };
const prevMonth = m => { const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 2, 1)); return d.toISOString().slice(0, 7); };
const hoursBetween = (a, b) => { const p = s => { const [h, m] = String(s).split(':').map(Number); return h + (m || 0) / 60; }; let x = p(b) - p(a); if (x < 0) x += 24; return Math.round(x * 100) / 100; };
const isWorkday = (d, hol) => new Date(d + 'T00:00:00Z').getUTCDay() !== 0 && !hol.has(d);
const holidays = async db => new Set((await db.q('SELECT day FROM hr_holiday')).map(r => r.day));

// ---------- kỳ công ----------
async function assertOpen(db, empId, day) {
  const r = await db.one(`SELECT p.status FROM hr_att_period p JOIN hr_employee e ON e.legal_id = p.legal_id WHERE e.id = $1 AND p.month = $2`, [empId, day.slice(0, 7)]);
  if (r?.status === 'khoa') bad(`Kỳ công ${day.slice(5, 7)}/${day.slice(0, 4)} đã khóa — không ghi được công`);
}
async function setMark(db, empId, day, mark, patch = {}, source = 'don', demo = false) {
  await assertOpen(db, empId, day);
  await db.q(`INSERT INTO hr_attendance (emp_id, day, mark, in_t, out_t, source, is_demo) VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (emp_id, day) DO UPDATE SET mark = EXCLUDED.mark, in_t = coalesce(EXCLUDED.in_t, hr_attendance.in_t), out_t = coalesce(EXCLUDED.out_t, hr_attendance.out_t), source = EXCLUDED.source, updated_at = now()`,
  [empId, day, mark, patch.in_t || null, patch.out_t || null, source, demo]);
}
// ---------- hoạt động văn hóa: áp dụng cho ai, ngày nào ----------
const dowOf = d => String(new Date(d + 'T00:00:00Z').getUTCDay());
const cultureOn = (a, d) => a.state === 'on' && a.from_on <= d && a.to_on >= d && (a.days?.length ? a.days.includes(dowOf(d)) : true);   // ngày d có hoạt động
const cultureFits = (a, e) => (!a.legal_id || a.legal_id === e.legal_id) && (!a.dept_id || a.dept_id === e.dept_id);   // nhân viên thuộc phạm vi
async function cultureRoster(db, a, day) {   // người phải tham gia + điểm danh của ngày
  const es = (await db.q("SELECT id, code, full_name, legal_id, dept_id FROM hr_employee WHERE state <> 'da_nghi' AND (join_on IS NULL OR join_on <= $1) ORDER BY code", [day])).filter(e => cultureFits(a, e));
  const logs = await db.q('SELECT emp_id, result, at, source FROM hr_culture_log WHERE act_id = $1 AND day = $2', [a.id, day]);
  return es.map(e => ({ ...e, log: logs.find(l => l.emp_id === e.id) || null }));
}
// «Tạo ngày nghỉ phép cho nhân viên chấm công tự động» (như Bravo): B1 chọn tháng → B2 danh sách người đang chấm tự động → B3 tạo đơn nghỉ (đã duyệt, ghi P vào bảng công)
async function autoLeaveList(db, month) {
  const f = `${month}-01`, l = lastDay(month);
  const rows = await db.q(`SELECT DISTINCT e.id, e.code, e.full_name, e.legal_id FROM hr_att_auto a JOIN hr_employee e ON e.id = a.emp_id WHERE a.from_on <= $2 AND (a.to_on IS NULL OR a.to_on >= $1) AND (a.state = 'chay' OR a.to_on >= $1) AND e.state <> 'da_nghi' ORDER BY e.code`, [f, l]);
  for (const r of rows) r.had = (await db.q("SELECT from_on, to_on, type_code FROM hr_leave WHERE emp_id = $1 AND status = 'da_duyet' AND from_on <= $3 AND to_on >= $2 ORDER BY from_on", [r.id, f, l])).map(x => `${C.dmy(x.from_on)}${x.to_on !== x.from_on ? '–' + C.dmy(x.to_on) : ''} ${x.type_code}`);
  return rows;
}
async function autoLeaveMake(db, user, month, items) {
  const f = `${month}-01`, l = lastDay(month), hol = await holidays(db), ok = await autoLeaveList(db, month), made = [];
  for (const it of items || []) {
    const e = ok.find(x => x.id === +it.emp_id); if (!e) bad('Nhân viên không thuộc danh sách chấm công tự động của tháng');
    for (const d of [...new Set(it.days || [])].sort()) {
      if (d < f || d > l) bad(`${e.full_name}: ngày ${C.dmy(d)} không thuộc tháng ${month.slice(5)}/${month.slice(0, 4)}`);
      if (!isWorkday(d, hol)) bad(`${e.full_name}: ${C.dmy(d)} là ngày nghỉ / lễ`);
      await assertOpen(db, e.id, d);
      if (await db.one("SELECT 1 AS x FROM hr_leave WHERE emp_id = $1 AND status IN ('cho_duyet','da_duyet') AND from_on <= $2 AND to_on >= $2", [e.id, d])) continue;   // đã có đơn ngày đó → bỏ qua
      const lv = await C.create('leave', { emp_id: e.id, type_code: it.type || 'P', from_on: d, to_on: d, days: 1, reason: 'Nghỉ phép — tạo cho nhân viên chấm công tự động', status: 'da_duyet' }, user, { db, system: true });
      await markRange(db, e.id, d, d, it.type || 'P', 'CC04', false); made.push(`${e.code} ${C.dmy(d)}`); if (lv.row) await C.audit(db, 'leave', lv.row.id, 'tu_dong', null, null, user, 'Tạo đơn nghỉ cho NV chấm công tự động');
    }
  }
  return made;
}
async function markRange(db, empId, from, to, mark, source, demo) {
  const hol = await holidays(db); let c = 0;
  for (const d of monthsOf(from, to)) if (isWorkday(d, hol)) { await setMark(db, empId, d, mark, {}, source, demo); c++; }
  return c;
}

// ---------- tồn kho VPP ----------
async function vppStock(db, legalId, upto) {
  const s = {}, W = upto ? ' AND d <= $2' : '', p = upto ? [legalId, upto] : [legalId];
  const add = (code, v) => { s[code] = (s[code] || 0) + v; };
  for (const r of await db.q(`SELECT lines, in_on AS d FROM hr_vpp_in t, LATERAL (SELECT t.in_on AS d) x WHERE legal_id = $1${W}`, p)) for (const l of r.lines || []) add(l.code, n(l.qty));
  for (const r of await db.q(`SELECT lines, issue_on AS d FROM hr_vpp_issue t, LATERAL (SELECT t.issue_on AS d) x WHERE legal_id = $1${W}`, p)) for (const l of r.lines || []) add(l.code, -n(l.qty_out));
  return s;
}

// đề xuất VPP: từng món còn thiếu bao nhiêu = SL đề xuất − tổng SL thực cấp ở các phiếu cấp phát gắn đề xuất này
async function vppLeft(db, r) {
  const got = {}; for (const x of await db.q('SELECT lines FROM hr_vpp_issue WHERE req_id = $1', [r.id])) for (const l of x.lines || []) got[l.code] = (got[l.code] || 0) + n(l.qty_out);
  return (r.lines || []).filter(l => l.code && n(l.qty) > 0).map(l => ({ code: l.code, line: l, need: n(l.qty) - (got[l.code] || 0) }));
}
// ---------- hook từng loại ----------
const empFill = async (rec, db) => { if (rec.emp_id && (!rec.dept_id || !rec.legal_id)) { const e = await db.one('SELECT legal_id, dept_id FROM hr_employee WHERE id = $1', [rec.emp_id]); if (e) { rec.dept_id ??= e.dept_id; rec.legal_id ??= e.legal_id; } } };
const chkTime = r => { if (r.start_at && r.end_at && r.end_at <= r.start_at) bad('Thời gian kết thúc phải sau thời gian bắt đầu'); };
const overlap = async (db, tbl, col, id, r, label) => {
  const x = await db.one(`SELECT code FROM ${tbl} WHERE ${col} = $1 AND id <> $2 AND status IN ('da_duyet','dang_di') AND tstzrange(start_at, end_at) && tstzrange($3::timestamptz, $4::timestamptz) LIMIT 1`, [r[col], id || 0, r.start_at, r.end_at]);
  return x && `${label} đã được giữ bởi ${x.code} trong khung giờ này`;
};
const empOfCode = (db, code) => db.one('SELECT * FROM hr_employee WHERE code = $1', [code]);
// ứng viên nhận việc → hồ sơ NV (thử việc) + HĐ thử việc đủ thông tin để in: chức danh, pháp nhân, ngày ký = ngày nhận việc, 2 tháng, % lương thử việc, lương thỏa thuận (nếu nhập)
// đã có hồ sơ từ ứng viên này (hoặc trùng số CCCD) thì không tạo lại
async function hire(ctx, r, d) {
  const db = ctx.db, start = d.start_on || r.start_on || today(), p1 = +d.p1 || null, p2 = +d.p2 || null;
  const had = await db.one("SELECT id, code FROM hr_employee WHERE note LIKE $1 OR ($2::text IS NOT NULL AND cccd = $2) ORDER BY id LIMIT 1", [`Từ ứng viên ${r.code}%`, r.id_no || null]);
  if (had) { const c = await db.one("SELECT id FROM hr_contract WHERE emp_id = $1 ORDER BY from_on DESC, id DESC LIMIT 1", [had.id]); return { made: false, code: had.code, contract: c?.id, start }; }
  if (!r.legal_id) bad('Ứng viên chưa có pháp nhân — gắn kế hoạch tuyển dụng hoặc chọn pháp nhân trước khi nhận việc');
  const next = (await db.one("SELECT coalesce(max(substring(code from 3)::int),0)+1 AS n FROM hr_employee WHERE code ~ '^NV[0-9]+$'")).n;
  const e = await C.create('employee', { code: 'NV' + String(next).padStart(3, '0'), full_name: r.full_name, gender: r.gender, dob: r.dob, cccd: r.id_no, phone: r.phone, email: r.email, address: r.address, school: [r.school, r.major].filter(Boolean).join(' / ') || null, exp: r.exp, jobs: r.jobs || null, legal_id: r.legal_id, dept_id: r.dept_id, title: r.position, join_on: start, state: 'thu_viec', pay_p1: p1, pay_p2: p2, note: `Từ ứng viên ${r.code}` }, ctx.user, { db, system: true, demo: r.is_demo });
  const pay = await setting('pay');
  const c = await C.create('contract', { emp_id: e.row.id, legal_id: r.legal_id, kind: 'HD01', no: `${e.row.code}/${start.slice(0, 4)}/HĐTV`, sign_on: start, from_on: start, title: r.position, salary: p1, p2, state: 'hieu_luc', trial_pct: pay.trial_pct, tpl: 'HDTV', note: p1 ? null : 'Chưa nhập lương thỏa thuận — điền Lương P1 / P2 trước khi in' }, ctx.user, { db, system: true, demo: r.is_demo });
  if (r.plan_id) {
    const p = await db.one('SELECT qty FROM hr_rec_plan WHERE id = $1', [r.plan_id]), got = (await db.one("SELECT count(*) AS n FROM hr_candidate WHERE plan_id = $1 AND status IN ('S53','S60') AND id <> $2", [r.plan_id, r.id])).n + 1;
    if (got >= p.qty) await db.q("UPDATE hr_rec_plan SET rec_state = 'da_tuyen' WHERE id = $1", [r.plan_id]);
  }
  const onb = await onboard(ctx, e.row, start);
  return { made: true, code: e.row.code, contract: c.row.id, start, onb };
}
// người mới nhận việc → vào khóa hội nhập: khóa hội nhập chưa kết thúc gần ngày nhận việc nhất (trong 30 ngày tới); chưa có thì mở khóa tháng đó
async function onboard(ctx, emp, start) {
  const db = ctx.db, row = { code: emp.code, name: emp.full_name, result: '' };
  let t = await db.one("SELECT id, code, emps FROM hr_training WHERE kind = 'hoi_nhap' AND state IN ('ke_hoach','dang_dt') AND coalesce(to_on, from_on) >= $1 AND from_on <= ($1::date + 30) ORDER BY from_on LIMIT 1", [start]);
  if (t) { if (!(t.emps || []).some(x => x.code === emp.code)) await C.update('training', t.id, { emps: [...(t.emps || []).filter(x => x.code), row] }, ctx.user, { db, system: true }); return t.code; }
  t = await C.create('training', { name: `Đào tạo hội nhập tháng ${start.slice(5, 7)}/${start.slice(0, 4)}`, kind: 'hoi_nhap', legal_id: emp.legal_id, from_on: start, sessions: 1, hours: 4, mode: 'truc_tiep', trainer: 'Phòng Hành chính Nhân sự', emps: [row], state: 'ke_hoach' }, ctx.user, { db, system: true, demo: emp.is_demo });
  return t.row.code;
}

const H = {
  employee: {
    acts: { async to_trinh_tv(r, d, ctx) {   // NV thử việc: lập tờ trình tiếp nhận chính thức (đã có tờ trình chưa bị từ chối → mở lại)
      if (r.state !== 'thu_viec') bad('Chỉ lập tờ trình hết thử việc cho nhân viên đang thử việc');
      const ex = await ctx.db.one("SELECT id FROM hr_rec_memo WHERE emp_id = $1 AND kind = 'het_tv' AND status <> 'tu_choi' ORDER BY id DESC LIMIT 1", [r.id]);
      if (ex) return { open: ['rec_memo', ex.id], note: 'Nhân viên đã có tờ trình hết thử việc — mở tờ trình hiện có' };
      const m = await C.create('rec_memo', { kind: 'het_tv', emp_id: r.id, eval_on: today(), comment: 'Nhân sự có tinh thần, thái độ tốt; kết quả công việc đạt yêu cầu.' }, ctx.user, { db: ctx.db, system: true, demo: r.is_demo });
      return { open: ['rec_memo', m.row.id], note: 'Đã lập tờ trình — bổ sung điểm, nhận xét, công việc đã đánh giá rồi bấm Trình' };
    } },
    async beforeSave(r, old, ctx) {
      if (r.leave_on && r.join_on && r.leave_on < r.join_on) bad('Ngày nghỉ việc không được trước ngày vào làm');
      if (r.state === 'da_nghi' && !r.leave_on) r.leave_on = today();
      // pháp nhân / phòng ban / chức danh đổi qua Thuyên chuyển nội bộ hoặc Quyết định để giữ lịch sử (nhập file Excel và việc tự động vẫn được ghi)
      const mv = old && !ctx.opts.system && !ctx.opts.imp && ['legal_id', 'dept_id', 'title'].filter(k => old[k] != null && String(r[k] ?? '') !== String(old[k]));
      if (mv && mv.length) bad('Đổi pháp nhân / phòng ban / chức danh qua «Thuyên chuyển nội bộ» (HS03) hoặc Quyết định nhân sự để giữ lịch sử làm việc');
      r.docs = (r.docs || []).filter(Boolean);
    },
  },
  contract: {
    async beforeSave(r, old, ctx) {
      await empFill(r, ctx.db);
      if (r.kind === 'HD03') r.to_on = null;
      if (r.kind === 'HD01' && r.from_on && !r.to_on) { const d = new Date(r.from_on + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 2); r.to_on = addDays(d.toISOString().slice(0, 10), -1); }   // HĐ thử việc mặc định 2 tháng
      else if (['HD01', 'HD02'].includes(r.kind) && !r.to_on) ctx.warn.push('Hợp đồng có thời hạn chưa có ngày hết hạn — sẽ vào danh sách «Cần cập nhật dữ liệu»');
      if (r.to_on && r.to_on < r.from_on) bad('Ngày hết hạn phải sau ngày hiệu lực');
      if (r.kind === 'HD01' && r.trial_pct == null) r.trial_pct = (await setting('pay')).trial_pct;
    },
    // tình trạng hạn HĐ ngay trên danh sách (thay cho báo cáo HD12 riêng): còn bao nhiêu ngày, sắp đến hạn / quá hạn / thiếu ngày hết hạn
    decorate(rows) {
      const t = today();
      for (const r of rows) {
        if (!['hieu_luc', 'cho_quyet_dinh'].includes(r.state) || r.kind === 'HD04') { r.c_left = null; r.c_due = ''; continue; }
        const left = r.to_on ? C.dayDiff(t, r.to_on) : null;
        r.c_left = left;
        r.c_due = ['HD01', 'HD02'].includes(r.kind) && !r.to_on ? 'Cần cập nhật ngày hết hạn' : left == null ? 'Không xác định thời hạn' : r.from_on > t ? 'Chưa đến ngày hiệu lực' : left < 0 ? 'Quá hạn' : left <= 30 ? 'Sắp đến hạn' : 'Còn hạn';
        r.c_due_c = { 'Cần cập nhật ngày hết hạn': 'a', 'Quá hạn': 'r', 'Sắp đến hạn': 'a', 'Còn hạn': 'g', 'Chưa đến ngày hiệu lực': 'b' }[r.c_due] || 's';
      }
    },
    // HĐ sắp / đã hết hạn: mở sẵn HĐ mới (chưa lưu) — cùng người, pháp nhân, chức danh, lương; hiệu lực từ ngày sau ngày hết hạn;
    // thử việc → HĐ xác định thời hạn; HĐ xác định thời hạn lần 2 trở lên → không xác định thời hạn (Điều 20 BLLĐ 2019 chỉ ký thêm 1 lần)
    acts: { async gia_han(r, d, ctx) {
      if (!['hieu_luc', 'cho_quyet_dinh'].includes(r.state) || r.kind === 'HD04' || r.kind === 'HD03') bad('Chỉ lập gia hạn cho HĐ thử việc / xác định thời hạn đang hiệu lực hoặc chờ quyết định');
      // số HĐ xác định thời hạn đã ký với CÙNG pháp nhân trong lần làm việc hiện tại (sau lần chấm dứt HĐ gần nhất, nếu có — người được tuyển lại tính lại từ đầu)
      const n2 = (await ctx.db.one("SELECT count(*)::int n FROM hr_contract c WHERE c.emp_id = $1 AND c.legal_id = $2 AND c.kind = 'HD02' AND c.from_on > coalesce((SELECT max(coalesce(x.to_on, x.from_on)) FROM hr_contract x WHERE x.emp_id = $1 AND x.legal_id = $2 AND x.state = 'cham_dut'), '1900-01-01')", [r.emp_id, r.legal_id])).n;
      const kind = r.kind === 'HD01' || n2 < 2 ? 'HD02' : 'HD03', from = r.to_on ? addDays(r.to_on, 1) : today();
      let to = null; if (kind === 'HD02') { const x = new Date(from + 'T00:00:00Z'); x.setUTCFullYear(x.getUTCFullYear() + 1); to = addDays(x.toISOString().slice(0, 10), -1); }
      const e = await ctx.db.one('SELECT code FROM hr_employee WHERE id = $1', [r.emp_id]);
      return { form: ['contract', { emp_id: r.emp_id, legal_id: r.legal_id, kind, no: `${e?.code || ''}/${from.slice(0, 4)}/${kind === 'HD03' ? 'HĐKXĐ' : 'HĐLĐ'}`, sign_on: from, from_on: from, to_on: to, title: r.title, salary: r.salary, p2: r.p2, al_lunch: r.al_lunch, al_trip: r.al_trip, state: 'hieu_luc' }],
        note: `${kind === 'HD03' ? 'Đã ký 2 HĐ xác định thời hạn → HĐ không xác định thời hạn' : 'HĐ xác định thời hạn 12 tháng'} — kiểm tra lương, ngày rồi Lưu` };
    } },
    async afterSave(r, old, ctx) {   // HĐ mới (không phải phụ lục) → HĐ cũ thành «Đã thay thế», hồ sơ đồng bộ theo
      if (old || r.kind === 'HD04') return;
      if (r.from_on > today()) return void ctx.warn.push(`HĐ có hiệu lực từ ${C.dmy(r.from_on)} — HĐ cũ giữ nguyên đến ngày đó, app tự chuyển «Đã thay thế»`);   // ký trước ngày hiệu lực
      await replaceContract(ctx.db, r);
    },
  },
  decision: {
    async beforeSave(r, old, ctx) {
      if (r.kind === 'HD08' && !(r.new_p1 || r.new_p2 || r.new_ins)) ctx.warn.push('QĐ điều chỉnh lương chưa có mức lương mới');
      if (r.kind === 'HD08' && r.emp_id && (!old || old.emp_id !== r.emp_id)) { const e = await ctx.db.one('SELECT pay_p1, pay_p2 FROM hr_employee WHERE id = $1', [r.emp_id]); r.old_p1 = e?.pay_p1 ?? null; r.old_p2 = e?.pay_p2 ?? null; }   // lương trước điều chỉnh, để in QĐ
    },
    async afterApprove(r, ok, ctx) { if (ok && due(r)) await applyDecision(ctx.db, r, ctx.user); },   // chưa đến ngày hiệu lực → việc nền cập nhật đúng ngày
  },
  resign: {
    async afterApprove(r, ok, ctx) {
      if (!ok) return;
      const db = ctx.db, e = await db.one('SELECT e.*, (SELECT kind FROM hr_contract c WHERE c.emp_id = e.id AND c.state = $2 ORDER BY from_on DESC LIMIT 1) AS ck FROM hr_employee e WHERE e.id = $1', [r.emp_id, 'hieu_luc']);
      const kind = e.ck === 'HD01' ? 'HD11' : 'HD10';
      await C.create('decision', { emp_id: r.emp_id, kind, no: `${r.code}/QĐ`, from_on: r.last_day, legal_id: e.legal_id, reason: `Theo đơn xin nghỉ việc ${r.code}: ${r.reason}` }, ctx.user, { db, system: true, note: 'Tự tạo nháp từ đơn nghỉ việc' });
      // tài sản người nghỉ đang giữ → tự lập phiếu điều chuyển (thu hồi về HCNS) ở trạng thái nháp, HCNS kiểm đếm rồi trình
      const held = await db.q("SELECT code, name, unit FROM hr_asset WHERE holder_id = $1 AND status <> 'da_thanh_ly' ORDER BY code", [r.emp_id]);
      if (held.length) {
        const hc = await db.one("SELECT e.id, e.dept_id FROM hr_user u JOIN hr_employee e ON e.id = u.emp_id WHERE u.role = 'tp_hcns' AND u.active LIMIT 1");
        if (hc && e.dept_id && hc.dept_id) {
          const mv = await C.create('asset_move', { legal_id: e.legal_id, dept_id: e.dept_id, to_dept_id: hc.dept_id, from_emp_id: r.emp_id, to_emp_id: hc.id, move_on: r.last_day, reason: `Thu hồi tài sản khi nghỉ việc (đơn ${r.code})`, lines: held.map(a => ({ code: a.code, name: a.name, unit: a.unit, qty: '1', cond: '' })) }, ctx.user, { db, system: true, demo: r.is_demo });
          ctx.warn.push(`Đã lập phiếu thu hồi ${held.length} tài sản (${mv.row.code}) — kiểm đếm rồi trình duyệt`);
        } else ctx.warn.push(`Cần thu hồi ${held.length} tài sản: ${held.map(x => x.code).join(', ')}`);
      }
    },
  },
  vpp_req: {
    async beforeSave(r, old, ctx) { await empFill(r, ctx.db); if (!(r.lines || []).some(l => n(l.qty) > 0)) bad('Phiếu đề xuất cần ít nhất 1 dòng có số lượng'); },
    // duyệt xong → tự lập phiếu cấp phát theo tồn kho (thiếu thì cấp theo số tồn, ghi chú «Tồn chỉ còn…»); kho hết sạch thì để «Đã duyệt» chờ nhập hàng
    async afterApprove(r, ok, ctx) {
      if (!ok) return; const st = await vppStock(ctx.db, r.legal_id);
      if (!(r.lines || []).some(l => n(l.qty) > 0 && (st[l.code] || 0) > 0)) return void ctx.warn?.push('Kho chưa có hàng — lập phiếu cấp phát sau khi nhập kho');
      const x = await H.vpp_req.acts.cap_phat(r, {}, ctx); if (x.patch) await C.sys(ctx.db, 'vpp_req', r.id, x.patch, ctx.user, 'tu_dong', 'Tự lập phiếu cấp phát khi duyệt');
      if (x.note) ctx.warn?.push(x.note);
    },
    // cấp theo phần CÒN THIẾU (đề xuất − đã cấp ở các phiếu trước), tối đa bằng tồn kho. Cấp đủ → «Đã cấp phát»; còn thiếu → giữ «Đã duyệt» để bấm cấp bổ sung khi có hàng
    acts: { async cap_phat(r, d, ctx) {
      const st = await vppStock(ctx.db, r.legal_id), left = await vppLeft(ctx.db, r);
      const lines = left.filter(l => l.need > 0).map(l => { const have = Math.max(st[l.code] || 0, 0), q2 = Math.min(l.need, have); return { ...l.line, qty: String(l.need), qty_out: String(q2), note: q2 < l.need ? `Tồn chỉ còn ${have}` : l.line.note }; });
      if (!lines.length) return { patch: { status: 'da_cap' }, note: 'Đề xuất đã được cấp đủ' };
      if (!lines.some(l => n(l.qty_out) > 0)) bad('Kho chưa có hàng cho các món còn thiếu — nhập kho rồi cấp bổ sung');
      const out = await C.create('vpp_issue', { legal_id: r.legal_id, req_id: r.id, issuer_id: ctx.user.emp_id, emp_id: r.emp_id, dept_id: r.dept_id, issue_on: today(), lines: lines.filter(l => n(l.qty_out) > 0) }, ctx.user, { db: ctx.db, system: true });
      const short = lines.filter(l => n(l.qty_out) < n(l.qty));
      return { patch: short.length ? null : { status: 'da_cap' }, open: ['vpp_issue', out.row.id], note: short.length ? `Cấp thiếu ${short.map(l => `${l.code} (${l.qty_out}/${l.qty})`).join(', ')} — đề xuất giữ «Đã duyệt», nhập kho rồi bấm «Lập phiếu cấp phát» để cấp bổ sung` : null };
    } },
  },
  mail_in: {   // thư / hàng đến: điền phòng theo người nhận; giao rồi thì tự ghi ngày; báo người nhận trên app
    async beforeSave(r, old, ctx) {
      await empFill(r, ctx.db); if (!r.emp_id && !r.dept_id) bad('Cần chọn người nhận hoặc bộ phận nhận');
      if (r.status === 'da_giao' && !r.handed_on) r.handed_on = today(); if (r.status === 'cho_giao') r.handed_on = null;
    },
    async afterSave(r, old, ctx) {
      if (r.status !== 'cho_giao' || (old && old.emp_id === r.emp_id && old.dept_id === r.dept_id)) return;
      const us = r.emp_id ? await ctx.db.q('SELECT id FROM hr_user WHERE emp_id = $1 AND active', [r.emp_id]) : await ctx.db.q('SELECT u.id FROM hr_dept d JOIN hr_user u ON u.emp_id = d.head_id AND u.active WHERE d.id = $1', [r.dept_id]);
      const kind = { thu: 'thư', buu_pham: 'bưu phẩm', hang: 'hàng' }[r.kind] || 'thư';
      if (us.length) await C.notify(ctx.db, us.map(u => u.id).filter(id => id !== ctx.user?.id), `Có ${kind} gửi đến ${r.emp_id ? 'anh/chị' : 'bộ phận'}: ${r.content}`, `Từ ${r.from_name} · nhận ngày ${C.dmy(r.got_on)} · liên hệ Hành chính để nhận`, `e/mail_in/${r.id}`);
      else ctx.warn.push('Người nhận chưa có tài khoản app — chưa gửi được thông báo, cần báo trực tiếp');
    },
  },
  vpp_issue: { async afterSave(r, old, ctx) {   // phiếu cấp phát gắn đề xuất: đã cấp đủ mọi món → đề xuất «Đã cấp phát»
    if (!r.req_id) return; const q2 = await ctx.db.one('SELECT * FROM hr_vpp_req WHERE id = $1', [r.req_id]);
    if (q2?.status === 'da_duyet' && (await vppLeft(ctx.db, q2)).every(l => l.need <= 0)) await ctx.db.q("UPDATE hr_vpp_req SET status = 'da_cap' WHERE id = $1", [r.req_id]);
  }, async beforeSave(r, old, ctx) {
    await empFill(r, ctx.db);
    const st = await vppStock(ctx.db, r.legal_id);
    if (old) for (const l of old.lines || []) st[l.code] = (st[l.code] || 0) + n(l.qty_out);
    for (const l of r.lines || []) { if (n(l.qty_out) > (st[l.code] || 0)) bad(`${l.code} ${l.name || ''}: tồn ${st[l.code] || 0}, không đủ cấp ${n(l.qty_out)}`); st[l.code] = (st[l.code] || 0) - n(l.qty_out); }
  } },
  vpp_norm: { async beforeSave(r, o, ctx) { if (!await ctx.db.one('SELECT 1 AS x FROM hr_vpp_item WHERE code = $1', [r.item_code])) bad(`Mã ${r.item_code} không có trong danh mục`); } },
  asset_in: { async afterSave(r, old, ctx) {    // nhập kho tự tạo / cập nhật danh mục tài sản
    if (old) return;
    for (const l of r.lines || []) {
      if (!l.code) continue;
      // cột «Người sử dụng» khớp mã / họ tên nhân viên → tài sản giao luôn cho người đó (người giữ, bộ phận, «Đang sử dụng»)
      // khớp theo mã trước (ô chọn từ danh sách lưu «mã · họ tên»); gõ họ tên thì chỉ nhận khi đúng 1 người đang làm — trùng tên / không khớp thì để trong kho và báo
      const u = String(l.user || '').trim(), code = u.split(' · ')[0].trim();
      let h = u && await ctx.db.one("SELECT id, dept_id FROM hr_employee WHERE upper(code) = upper($1) AND state <> 'da_nghi'", [code]);
      if (u && !h) { const xs = await ctx.db.q("SELECT id, dept_id FROM hr_employee WHERE lower(full_name) = lower($1) AND state <> 'da_nghi'", [u]); if (xs.length === 1) h = xs[0]; else ctx.warn.push(`${l.code}: ${xs.length ? `có ${xs.length} người tên «${u}» — chọn theo mã nhân viên` : `không thấy nhân viên đang làm «${u}»`}; tài sản để trong kho`); }
      const own = h ? { holder_id: h.id, dept_id: h.dept_id, status: 'dang_dung' } : { status: 'trong_kho', holder_id: null };
      const a = await ctx.db.one('SELECT id FROM hr_asset WHERE code = $1', [l.code]);
      if (a) await C.sys(ctx.db, 'asset', a.id, { in_on: r.in_on, ...own, ...(l.model ? { model: l.model } : {}), ...(l.place ? { location: l.place } : {}) }, ctx.user, 'tu_dong', `Theo ${r.code}`);
      else await C.create('asset', { code: l.code, name: l.name || l.code, unit: l.unit || 'Cái', model: l.model, legal_id: r.legal_id, in_on: r.in_on, location: l.place, ...own }, ctx.user, { db: ctx.db, system: true, demo: r.is_demo });
    }
  } },
  asset_move: { acts: { async da_nhan(r, d, ctx) {
    for (const l of r.lines || []) { const a = await ctx.db.one('SELECT id FROM hr_asset WHERE code = $1', [l.code]); if (a) await C.sys(ctx.db, 'asset', a.id, { dept_id: r.to_dept_id, holder_id: r.to_emp_id, status: 'dang_dung', ...(r.to_legal_id ? { legal_id: r.to_legal_id } : {}) }, ctx.user, 'tu_dong', `Theo ${r.code}`); }
    return { patch: { status: 'da_nhan' } };
  } } },
  asset_out: { async afterApprove(r, ok, ctx) {
    const st = { thanh_ly: 'da_thanh_ly', sua_chua: 'sua_chua' }[r.purpose]; if (!ok || !st) return;   // «Khác»: không đổi trạng thái tài sản
    for (const l of r.lines || []) { const a = await ctx.db.one('SELECT id FROM hr_asset WHERE code = $1', [l.code]); if (a) await C.sys(ctx.db, 'asset', a.id, { status: st, repair_due: st === 'sua_chua' ? r.due_on || null : null }, ctx.user, 'tu_dong', `Theo ${r.code}`); }
  } },
  asset_count: { async beforeSave(r, old, ctx) {   // kế thừa sổ quản lý tài sản
    if ((r.lines || []).length) return;
    r.lines = (await ctx.db.q(`SELECT a.code, a.name, a.status, e.full_name FROM hr_asset a LEFT JOIN hr_employee e ON e.id = a.holder_id WHERE a.legal_id = $1 AND a.status <> 'da_thanh_ly' ORDER BY a.code`, [r.legal_id])).map(a => ({ code: a.code, name: a.name, holder: a.full_name || '', sys: a.status, found: '', note: '' }));
  } },
  car_book: {
    async beforeSave(r, old, ctx) { chkTime(r); await empFill(r, ctx.db); const w = await overlap(ctx.db, 'hr_car_book', 'vehicle_id', r.id, r, 'Xe'); if (w) ctx.warn.push(w); },
    async onApprove(r, ok, ctx) { if (ok) { const w = await overlap(ctx.db, 'hr_car_book', 'vehicle_id', r.id, r, 'Xe'); if (w) bad(w); } },
    acts: {
      async di_xe(r, d, ctx) {   // xe giao đi → danh sách xe «Đang đi»; xe đang bảo dưỡng / ngừng dùng thì không giao
        const v = await ctx.db.one('SELECT plate, state FROM hr_vehicle WHERE id = $1', [r.vehicle_id]);
        if (v && ['bao_duong', 'ngung'].includes(v.state)) bad(`Xe ${v.plate} đang ${v.state === 'bao_duong' ? 'bảo dưỡng' : 'ngừng dùng'} — đổi xe khác hoặc cập nhật tình trạng xe trước`);
        await ctx.db.q("UPDATE hr_vehicle SET state = 'dang_di' WHERE id = $1 AND state = 'san_sang'", [r.vehicle_id]); return { patch: { status: 'dang_di' } };
      },
      async huy() { return { patch: { status: 'huy' } }; },
      // nhận xe về: mở sẵn phiếu trả xe — phiếu mượn, giờ nhận, km lúc nhận (km hiện tại của xe), giờ trả = bây giờ
      async tra_xe(r, d, ctx) {
        const had = await ctx.db.one('SELECT id FROM hr_car_return WHERE book_id = $1', [r.id]); if (had) return { open: ['car_return', had.id], note: 'Phiếu đã có phiếu trả xe' };
        const v = await ctx.db.one('SELECT km FROM hr_vehicle WHERE id = $1', [r.vehicle_id]), loc = x => new Date(new Date(x).getTime() + 7 * 3600e3).toISOString().slice(0, 16);
        const gave = await ctx.db.one("SELECT at FROM hr_audit WHERE ent = 'car_book' AND rec_id = $1 AND action = 'tt:di_xe' ORDER BY id DESC LIMIT 1", [r.id]);   // giờ nhận = lúc bấm «Bàn giao xe»
        return { form: ['car_return', { book_id: r.id, book_id__l: r.code, got_at: loc(gave?.at || r.start_at), back_at: loc(Date.now()), km_in: v?.km ?? null, cond_in: 'tot', cond_out: 'tot' }], note: 'Điền km khi trả, nhiên liệu, chi phí rồi Lưu' };
      },
    },
  },
  car_return: {
    async beforeSave(r, old, ctx) {
      if (r.km_out < r.km_in) bad('Km khi trả không được nhỏ hơn km khi nhận');
      if (r.back_at <= r.got_at) bad('Giờ trả phải sau giờ nhận');
      if (r.cost > 0 && !r.cost_doc) ctx.warn.push('Có chi phí phát sinh nhưng chưa có chứng từ');
    },
    async afterSave(r, old, ctx) {
      const b = await ctx.db.one('SELECT id, vehicle_id FROM hr_car_book WHERE id = $1', [r.book_id]);
      await ctx.db.q("UPDATE hr_car_book SET status = 'da_tra' WHERE id = $1", [b.id]);
      // trả xe → xe «Sẵn sàng» lại, trừ khi xe còn lượt mượn khác đang đi
      await ctx.db.q("UPDATE hr_vehicle SET km = greatest(coalesce(km,0), $1), state = CASE WHEN state = 'dang_di' AND NOT EXISTS (SELECT 1 FROM hr_car_book x WHERE x.vehicle_id = $2 AND x.id <> $3 AND x.status = 'dang_di') THEN 'san_sang' ELSE state END WHERE id = $2", [r.km_out, b.vehicle_id, b.id]);
    },
  },
  // gửi thư EMS: lưu phiếu có số bill mới / đổi bill → tra hành trình ngay (sau khi lưu xong, không làm chậm nút Lưu); nút «Tra cứu EMS» tra tay
  mail: {
    beforeSave(r) { if (r.status === 'da_giao' && !r.done_on) r.done_on = today(); },
    async afterSave(r, old, ctx) {
      // HCNS / EMS đổi trạng thái → người đề xuất gửi thư nhận thông báo trên app
      if (old && r.emp_id && old.status !== r.status && ['dang_chuyen', 'da_giao', 'that_lac'].includes(r.status)) {
        const us = await ctx.db.q('SELECT id FROM hr_user WHERE emp_id = $1 AND active', [r.emp_id]), st = { dang_chuyen: 'đang vận chuyển', da_giao: 'đã giao', that_lac: 'thất lạc / giao trễ' }[r.status];
        if (us.length) await C.notify(ctx.db, us.map(u => u.id).filter(id => id !== ctx.user?.id), `Thư gửi ${r.to_name} ${st}`, `${r.content}${r.bill_no ? ' · bill ' + r.bill_no : ''}${r.status === 'da_giao' && r.done_on ? ' · giao ngày ' + C.dmy(r.done_on) : ''}`, `e/mail/${r.id}`);
      }
    },   // đã bỏ tra cứu EMS (không có API)
  },
  // sổ con dấu: bộ phận theo người đề nghị; ghi ngày trả dấu ↔ trạng thái «Đã trả dấu»
  seal: {
    async beforeSave(r, o, ctx) {
      await empFill(r, ctx.db);
      if (r.stamper && r.status === 'cho_dong') r.status = 'da_dong';   // ghi người đóng dấu = đã đóng
      if (o && o.status === 'da_tra' && r.status === 'dang_muon' && r.back_on === o.back_on) r.back_on = null;   // chuyển lại «Đang mang ra ngoài» → xóa ngày trả cũ (không tự bật về «Đã trả»)
      if (r.status === 'da_tra' && !r.back_on) r.back_on = today();
      if (r.back_on && r.status === 'dang_muon') r.status = 'da_tra';
    },
    async afterSave(r, old, ctx) {
      const db = ctx.db, mine = ctx.user?.id;
      if (!old && r.status === 'cho_dong') {   // đề nghị mới → báo người phụ trách con dấu (HCNS được giao mục này)
        const us = await db.q("SELECT id FROM hr_user WHERE active AND role IN ('cv_hc','cv_hcns','tp_hcns') AND (items IS NULL OR 'e:seal' = ANY(items))");
        await C.notify(db, us.map(u => u.id).filter(id => id !== mine), `Đề nghị đóng dấu: ${r.doc}`, `${r.qty || 1} bản · ${C.dmy(r.used_on)}`, `e/seal/${r.id}`);
      }
      if (old && old.status === 'cho_dong' && r.status !== 'cho_dong' && r.emp_id) {   // đã đóng → báo người đề nghị
        const us = await db.q('SELECT id FROM hr_user WHERE emp_id = $1 AND active', [r.emp_id]);
        await C.notify(db, us.map(u => u.id).filter(id => id !== mine), `Đã đóng dấu: ${r.doc}`, `${r.stamper ? 'Người đóng dấu: ' + r.stamper + ' · ' : ''}liên hệ Hành chính để nhận văn bản`, `e/seal/${r.id}`);
      }
    },
  },
  meal_reg: { async beforeSave(r, o, ctx) { await empFill(r, ctx.db); r.n_days = (r.days || []).length; } },
  // suất ăn ngày: để trống «Suất thực phục vụ» → lấy số người đã đăng ký ăn ngày đó (SA01)
  meal_day: { async beforeSave(r, o, ctx) {
    if (o && o.day !== r.day && +r.actual === +o.actual) { r.actual = null; if (+r.charged === +o.charged) r.charged = null; }   // đổi ngày mà chưa sửa số suất → tính lại theo ngày mới
    if (r.actual == null || r.actual === '') r.actual = (await ctx.db.q('SELECT days FROM hr_meal_reg WHERE month = $1', [String(r.day).slice(0, 7)])).filter(x => (x.days || []).some(d => +d === +String(r.day).slice(8, 10) || d === r.day)).length;   // ngày đăng ký lưu dạng số ngày trong tháng
    if (r.charged == null || r.charged === '') r.charged = r.actual;
  } },
  meal_out: { beforeSave(r) { if (r.qty != null && r.price != null && !r.amount) r.amount = Math.round(r.qty * r.price); } },
  event_cost: { beforeSave(r) { r.plan_total = (r.lines || []).reduce((s, l) => s + n(l.plan), 0); r.actual_total = (r.lines || []).reduce((s, l) => s + n(l.actual), 0); } },
  event: {
    // giao đầu việc: cột «Người phụ trách» chọn từ danh sách nhân viên («NV049 · Họ tên») → người đó nhận thông báo trên app; mỗi cặp người – đầu việc chỉ báo 1 lần
    async afterSave(r, old, ctx) {
      const key = t => `${t.code}|${t.task || ''}`, tasks = (r.tasks || []).map(t => ({ ...t, code: /^(\S+)\s+·\s+/.exec(t.who || '')?.[1] })).filter(t => t.code);
      const sent = new Set(r.notified || []), fresh = tasks.filter(t => !sent.has(key(t))); if (!fresh.length) return;
      const us = await ctx.db.q('SELECT u.id, u.role, e.code FROM hr_employee e JOIN hr_user u ON u.emp_id = e.id AND u.active WHERE e.code = ANY($1)', [[...new Set(fresh.map(t => t.code))]]);
      for (const t of fresh) for (const u of us.filter(x => x.code === t.code))   // người ngoài HCNS không mở được phiếu sự kiện → thông báo ghi đủ nội dung, không gắn liên kết
        await C.notify(ctx.db, [u.id], `Bạn được giao việc sự kiện: ${r.name}`, `${t.task || 'Đầu việc'}${t.due ? ' · hạn ' + t.due : ''}${t.result ? ' · cần có: ' + t.result : ''}`, ['nld', 'truong_bp'].includes(u.role) ? null : `e/event/${r.id}`);
      const all = [...sent, ...fresh.map(key)]; await ctx.db.q('UPDATE hr_event SET notified = $1 WHERE id = $2', [JSON.stringify(all), r.id]); r.notified = all;
    },
    acts: { async dong(r, d, ctx) {
    const miss = []; if (r.attended == null) miss.push('số tham gia'); if (!r.review) miss.push('đánh giá / bài học rút ra');
    if (!await ctx.db.one('SELECT 1 AS x FROM hr_event_cost WHERE event_id = $1', [r.id])) miss.push('phiếu chi phí');
    if (miss.length) bad('Cần hoàn thiện trước khi đóng sự kiện: ' + miss.join(', '));
    return { patch: { status: 'dong' } };
  } } },
  room_book: {
    async beforeSave(r, old, ctx) { chkTime(r); await empFill(r, ctx.db); const w = await overlap(ctx.db, 'hr_room_book', 'room_id', r.id, r, 'Phòng'); if (w) ctx.warn.push(w); },
    async onApprove(r, ok, ctx) { if (ok) { const w = await overlap(ctx.db, 'hr_room_book', 'room_id', r.id, r, 'Phòng'); if (w) bad(w); } },
    acts: { async dong(r) { return { patch: { status: 'hoan_thanh', real_end: r.real_end || r.end_at } }; }, async huy() { return { patch: { status: 'huy' } }; } },
  },
  rec_plan: {
    async decorate(rows, { db }) {   // tiến trình tuyển: số ứng viên ở từng bước
      if (!rows.length) return; const c = await db.q(`SELECT plan_id, count(*) FILTER (WHERE status IN ('S12')) cv, count(*) FILTER (WHERE status = 'S33') cho_pv, count(*) FILTER (WHERE status IN ('S34','S35','S36','S52')) pv, count(*) FILTER (WHERE status = 'S53') cho_nv, count(*) FILTER (WHERE status = 'S60') nv FROM hr_candidate WHERE plan_id = ANY($1) GROUP BY plan_id`, [rows.map(r => r.id)]);
      for (const r of rows) { const x = c.find(y => y.plan_id === r.id) || {}; Object.assign(r, { n_cv: +x.cv || 0, n_cho_pv: +x.cho_pv || 0, n_pv: +x.pv || 0, n_cho_nv: +x.cho_nv || 0, n_nv: +x.nv || 0 }); }
    },
    async beforeSave(r, o, ctx) {   // kế hoạch có thể vượt định biên (sếp yêu cầu) → nhắc cập nhật định biên
      const ch = (r.channels || []).filter(x => x.channel); if (ch.length) { r.cost = ch.reduce((s, x) => s + n(x.budget), 0); r.channel = [...new Set([...String(r.channel || '').split(',').map(x => x.trim()).filter(Boolean), ...ch.map(x => x.channel)])].join(', '); }   // kênh đã chọn + kênh có ngân sách
    const h = await ctx.db.one("SELECT coalesce(sum(qty),0) n FROM hr_headcount WHERE dept_id = $1", [r.dept_id]), cur = await ctx.db.one("SELECT count(*) n FROM hr_employee WHERE dept_id = $1 AND state <> 'da_nghi'", [r.dept_id]);
    if (+h.n && +cur.n + (+r.qty || 0) > +h.n) ctx.warn.push(`Tuyển ${r.qty} người sẽ vượt định biên bộ phận (${cur.n}/${h.n}) — cần cập nhật định biên CCTC05`);
  } },
  candidate: {
    // đã nhận việc: tình trạng khóa hội nhập của nhân viên tạo từ ứng viên (hoàn thành → rời cột «Đã nhận việc» trên bảng tuyển dụng)
    async decorate(rows, { db }) {
      const hired = rows.filter(r => r.status === 'S60'); if (!hired.length) return;
      const es = await db.q("SELECT code, note FROM hr_employee WHERE note LIKE 'Từ ứng viên %'"), ts = await db.q("SELECT code, name, state, emps FROM hr_training WHERE kind = 'hoi_nhap' AND coalesce(state,'') <> 'huy'");
      for (const r of hired) {
        const e = es.find(x => x.note === `Từ ứng viên ${r.code}` || x.note.startsWith(`Từ ứng viên ${r.code} `) || x.note.startsWith(`Từ ứng viên ${r.code}\n`)); if (!e) continue;
        const t = ts.find(x => (x.emps || []).some(y => y.code === e.code)); r.emp_code = e.code; if (!t) continue;
        const me = t.emps.find(y => y.code === e.code); r.onb = t.code; r.onb_done = t.state === 'hoan_thanh' || !!me.result;
      }
    },
    async beforeSave(r, o, ctx) {   // gắn với kế hoạch tuyển dụng → đơn vị, bộ phận, vị trí lấy theo kế hoạch
      if (!r.plan_id) return; const p = await ctx.db.one('SELECT legal_id, dept_id, position FROM hr_rec_plan WHERE id = $1', [r.plan_id]); if (!p) return;
      r.legal_id ??= p.legal_id; r.dept_id ??= p.dept_id; r.position ??= p.position;
    },
    // chuyển «Đã nhận việc» bằng cách sửa trạng thái / kéo thẻ → tự lập hồ sơ NV + HĐ thử việc (đã lập rồi thì thôi)
    async afterSave(r, old, ctx) { if (r.status === 'S60' && old?.status !== 'S60') { const x = await hire(ctx, r, {}); if (x.made) ctx.warn.push(`Đã tạo hồ sơ ${x.code} và HĐ thử việc — mở mục Hợp đồng lao động để in`); } },
    acts: {
    // qua vòng: Nộp CV → Chờ phỏng vấn → Đã phỏng vấn → (đạt) lập tờ trình trình sếp; sếp duyệt mới sang Chờ nhận việc
    async qua_vong(r, d, ctx) {
      if (r.status === 'S12') return { patch: { status: 'S33' }, note: `${r.full_name} → Chờ phỏng vấn — lên lịch ở mục Lịch phỏng vấn` };
      if (r.status === 'S33') return { patch: { status: 'S34' }, note: `${r.full_name} → Đã phỏng vấn` };
      await ctx.db.q("UPDATE hr_candidate SET status = 'S35' WHERE id = $1 AND status = 'S34'", [r.id]);
      const x = await H.candidate.acts.to_trinh({ ...r, status: 'S35' }, d, ctx); return { ...x, note: `${r.full_name} đạt phỏng vấn · ${x.note}` };
    },
    async truot(r, d) {   // hồ sơ chưa phỏng vấn → «Hồ sơ không đạt»; đã vào vòng phỏng vấn → «Đã sơ tuyển không đạt»
      return { patch: { status: r.status === 'S12' ? 'S11' : 'S24', note: [r.note, `Không đạt (${C.dmy(today())}): ${d.reason}`].filter(Boolean).join('\n') }, note: `${r.full_name} — không đạt` };
    },
    async to_trinh(r, d, ctx) {   // sau phỏng vấn: lập tờ trình (nháp) → HCNS bổ sung nội dung, bấm Trình → sếp duyệt
      const ex = await ctx.db.one("SELECT id FROM hr_rec_memo WHERE cand_id = $1 AND status <> 'tu_choi' ORDER BY id DESC LIMIT 1", [r.id]);
      if (ex) return { open: ['rec_memo', ex.id], note: 'Ứng viên đã có tờ trình — mở tờ trình hiện có' };
      const pv = await ctx.db.one("SELECT code FROM hr_interview WHERE lines @> $1::jsonb ORDER BY day DESC LIMIT 1", [JSON.stringify([{ code: r.code }])]);
      const pvd = pv && await ctx.db.one('SELECT day FROM hr_interview WHERE code = $1', [pv.code]);
      const m = await C.create('rec_memo', { kind: 'sau_pv', cand_id: r.id, position: r.position, start_on: r.start_on, eval_on: pvd?.day || today(), comment: 'Ứng viên đạt yêu cầu phỏng vấn.', work_eval: pv ? `Phỏng vấn theo lịch ${pv.code}` : null }, ctx.user, { db: ctx.db, system: true, demo: r.is_demo });
      return { open: ['rec_memo', m.row.id], note: 'Đã lập tờ trình — bổ sung điểm, nhận xét, lương đề xuất rồi bấm Trình' };
    }, async nhan_viec(r, d, ctx) {    // một chạm: hồ sơ NV + HĐ thử việc (kèm lương thỏa thuận) → mở luôn HĐ để in
      const x = await hire(ctx, r, d);
      return { patch: { status: 'S60', start_on: x.start }, open: ['contract', x.contract], note: x.made ? `Đã tạo hồ sơ ${x.code} và HĐ thử việc — bấm In để in hợp đồng${x.onb ? ` · đã đưa vào khóa hội nhập ${x.onb}` : ''}` : 'Ứng viên đã có hồ sơ nhân viên — mở HĐ hiện có' };
    } },
  },
  training: {
    async beforeSave(r, o, ctx) {
      const ses = Math.max(1, Math.round(+r.sessions || 1)); r.sessions = ses;
      const dmyIso = s => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim()); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : null; };
      let sc = (r.sched || []).filter(x => x.day || x.topic);
      if (!sc.length || (o && (ses !== +o.sessions || r.from_on !== o.from_on || +r.hours !== +o.hours) && sc.length === (o.sched || []).length)) {   // chưa có lịch / đổi số buổi, ngày bắt đầu, số giờ → sinh lại
        const hol = await holidays(ctx.db), per = Math.round((+r.hours || 0) / ses * 10) / 10 || 4, hm = h => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round(h % 1 * 60)).padStart(2, '0')}`;
        const end = per <= 4 ? hm(8 + per) : hm(13.5 + per - 4); sc = []; let d = r.from_on;
        while (sc.length < ses) { if (isWorkday(d, hol)) sc.push({ day: C.dmy(d), from_t: '08:00', to_t: end, hours: per, topic: '' }); d = addDays(d, 1); }
      }
      r.sched = sc.map(x => ({ ...x, day: x.day && dmyIso(x.day) ? C.dmy(dmyIso(x.day)) : x.day }));
      const last = r.sched.map(x => dmyIso(x.day)).filter(Boolean).sort().pop(); if (last && (!r.to_on || r.to_on < last)) r.to_on = last;
      for (const x of r.emps || []) if (x.code && !x.name) x.name = (await ctx.db.one('SELECT full_name FROM hr_employee WHERE code = $1', [x.code]))?.full_name || '';
    },
    async afterSave(r, old, ctx) {   // học viên mới thêm → báo qua app (người có tài khoản); bị bỏ khỏi khóa → báo không còn trong danh sách; ghi nhớ đã báo để không gửi lặp
      const now = new Set((r.emps || []).map(x => x.code).filter(Boolean)), gone = (r.notified || []).filter(c => !now.has(c));
      if (gone.length) { const us = await ctx.db.q('SELECT u.id FROM hr_employee e JOIN hr_user u ON u.emp_id = e.id AND u.active WHERE e.code = ANY($1)', [gone]);
        if (us.length) await C.notify(ctx.db, us.map(u => u.id), `Bạn không còn trong danh sách khóa: ${r.name}`, 'Phòng Hành chính Nhân sự đã cập nhật danh sách học viên', 'v/portal');
        await ctx.db.q('UPDATE hr_training SET notified = $1 WHERE id = $2', [JSON.stringify((r.notified || []).filter(c => now.has(c))), r.id]); r.notified = (r.notified || []).filter(c => now.has(c)); }
      const sent = new Set(r.notified || []), fresh = (r.emps || []).filter(x => x.code && !sent.has(x.code)); if (!fresh.length) return;
      const us = await ctx.db.q('SELECT u.id, e.code FROM hr_employee e JOIN hr_user u ON u.emp_id = e.id AND u.active WHERE e.code = ANY($1)', [fresh.map(x => x.code)]);
      const when = (r.sched || []).map(x => `${x.day} ${x.from_t || ''}–${x.to_t || ''}`).join('; ');
      if (us.length) await C.notify(ctx.db, us.map(u => u.id), `Khóa đào tạo: ${r.name}`, `${when}${r.place ? ' · ' + r.place : ''}${r.trainer ? ' · GV ' + r.trainer : ''}`, `v/portal/trn${r.id}`);   // học viên (NLĐ) không mở được màn quản lý đào tạo → về «Khóa đào tạo của tôi»
      await ctx.db.q('UPDATE hr_training SET notified = $1 WHERE id = $2', [JSON.stringify([...sent, ...fresh.map(x => x.code)]), r.id]);
    },
    acts: {
      async diem_danh(r, d) {   // att: { mã NV: [true/false theo từng buổi] }
        const n = (r.sched || []).length, codes = new Set((r.emps || []).map(x => x.code).filter(Boolean)), att = {};
        for (const [k, v] of Object.entries(d.att || {})) if (codes.has(k)) att[k] = Array.from({ length: n }, (_, i) => !!(v || [])[i]);
        return { patch: { att, ...(r.state === 'ke_hoach' && Object.values(att).some(v => v.some(Boolean)) ? { state: 'dang_dt' } : {}) }, note: 'Đã lưu điểm danh' };
      },
      async ket_qua(r, d, ctx) {   // kết quả từng người → báo từng học viên; đủ kết quả → khóa «Hoàn thành»
        const res = d.res || {}, emps = (r.emps || []).map(x => x.code && res[x.code] ? { ...x, result: res[x.code].result || x.result || '', score: res[x.code].score ?? x.score ?? '' } : x);
        const changed = emps.filter(x => x.code && x.result && !(r.emps || []).some(y => y.code === x.code && y.result === x.result && (y.score || '') === (x.score || '')));
        for (const x of changed) { const u = await ctx.db.one('SELECT u.id FROM hr_employee e JOIN hr_user u ON u.emp_id = e.id AND u.active WHERE e.code = $1', [x.code]); if (u) await C.notify(ctx.db, [u.id], `Kết quả đào tạo: ${r.name}`, `${x.result}${x.score ? ' · ' + x.score : ''}`, `v/portal/trn${r.id}`); }
        const all = emps.filter(x => x.code).every(x => x.result);
        return { patch: { emps, ...(all && emps.some(x => x.code) ? { state: 'hoan_thanh' } : {}) }, note: `Đã cập nhật kết quả${changed.length ? ` · đã báo ${changed.length} học viên` : ''}` };
      },
    },
  },
  culture: {
    beforeSave(r) { if (r.to_on < r.from_on) bad('Ngày hết hạn phải sau ngày bắt đầu'); if (r.from_t && r.to_t && r.to_t <= r.from_t) bad('Giờ kết thúc điểm danh phải sau giờ bắt đầu'); },
    async decorate(rows, { db }) { const t = today(); for (const r of rows) r.n_today = cultureOn(r, t) ? `${(await db.one('SELECT count(*)::int n FROM hr_culture_log WHERE act_id = $1 AND day = $2 AND result = $3', [r.id, t, 'co_mat'])).n} có mặt` : (r.to_on < t ? 'Đã hết hạn' : '—'); },
    acts: { async ghi_nhan(r, d, ctx) {   // HCNS điểm danh / ghi vi phạm 5S cho cả danh sách một ngày; bỏ trống = giữ nguyên
      const day = d.day || today(); if (!cultureOn({ ...r, state: 'on' }, day)) bad(`Ngày ${C.dmy(day)} không có hoạt động này`);
      let n = 0; for (const [emp, res] of Object.entries(d.marks || {})) { if (!res) continue;
        await ctx.db.q(`INSERT INTO hr_culture_log (act_id, emp_id, day, result, source, created_by) VALUES ($1,$2,$3,$4,'hcns',$5) ON CONFLICT (act_id, emp_id, day) DO UPDATE SET result = EXCLUDED.result, source = CASE WHEN hr_culture_log.result = EXCLUDED.result THEN hr_culture_log.source ELSE 'hcns' END`, [r.id, +emp, day, res, ctx.user?.id || null]); n++; }
      return { note: `Đã ghi ${n} người ngày ${C.dmy(day)}` };
    } },
  },
  shift: {   // gắn người vào ca; không ai gắn → ca hành chính. Một người một ca: gắn sang ca này thì bỏ khỏi ca khác
    async decorate(rows, { db }) { const hc = rows.find(r => /^HC/i.test(r.code || '')), all = await db.q('SELECT members FROM hr_shift');
      const assigned = new Set(all.flatMap(s => (s.members || []).map(m => m.code)).filter(Boolean)), act = (await db.one("SELECT count(*) AS n FROM hr_employee WHERE state <> 'da_nghi' AND code <> ALL($1)", [[...assigned]])).n;
      for (const r of rows) r.n_emps = (r.members || []).filter(m => m.code).length + (r === hc ? +act : 0); },
    async beforeSave(r, o, ctx) {
      r.members = (r.members || []).filter(m => m.code); for (const m of r.members) { const e = await ctx.db.one('SELECT full_name FROM hr_employee WHERE code = $1', [m.code]); if (!e) bad(`Không có nhân viên mã «${m.code}»`); m.name ||= e.full_name; }
      const codes = r.members.map(m => m.code); if (!codes.length) return;
      for (const s of await ctx.db.q('SELECT id, code, members FROM hr_shift WHERE id <> $1', [r.id || 0])) { const keep = (s.members || []).filter(m => !codes.includes(m.code)); if (keep.length !== (s.members || []).length) { await ctx.db.q('UPDATE hr_shift SET members = $1 WHERE id = $2', [JSON.stringify(keep), s.id]); ctx.warn.push(`Đã chuyển ${(s.members || []).length - keep.length} người khỏi ca ${s.code}`); } }
    },
  },
  rec_memo: {
    async beforeSave(r, o, ctx) {
      const db = ctx.db;
      if (r.kind === 'het_tv') {   // hết thử việc: thông tin theo hồ sơ + HĐ thử việc gần nhất
        if (!r.emp_id) bad('Chọn nhân viên thử việc'); r.cand_id = null;
        const e = await db.one('SELECT full_name, legal_id, dept_id, title, pay_p1, pay_p2 FROM hr_employee WHERE id = $1', [r.emp_id]), h = await db.one("SELECT from_on, to_on, salary, p2 FROM hr_contract WHERE emp_id = $1 AND kind = 'HD01' ORDER BY from_on DESC LIMIT 1", [r.emp_id]);
        Object.assign(r, { full_name: e.full_name, legal_id: e.legal_id, dept_id: e.dept_id }); r.position ||= e.title;
        if (h) { r.trial_from ||= h.from_on; r.trial_to ||= h.to_on; } if (!r.start_on && r.trial_to) r.start_on = addDays(r.trial_to, 1);
        r.p1 ??= h?.salary ?? e.pay_p1; r.p2 ??= h?.p2 ?? e.pay_p2;
      } else {
        if (!r.cand_id) bad('Chọn ứng viên'); r.emp_id = null;
        const c = await db.one('SELECT full_name, legal_id, dept_id, position FROM hr_candidate WHERE id = $1', [r.cand_id]); if (c) { Object.assign(r, { full_name: c.full_name, legal_id: c.legal_id, dept_id: c.dept_id }); r.position ||= c.position; }
      }
    },
    async afterApprove(r, ok, ctx) {
      if (!ok) return; const db = ctx.db;
      if (r.kind !== 'het_tv') return db.q("UPDATE hr_candidate SET status = 'S53', start_on = coalesce($2, start_on) WHERE id = $1 AND status NOT IN ('S60')", [r.cand_id, r.start_on]);   // → «Chờ nhận việc»
      // hết thử việc được duyệt → lập sẵn HĐLĐ xác định thời hạn 12 tháng từ ngày tiếp nhận (đến ngày đó việc nền tự thay HĐ thử việc, hồ sơ «Đang làm»)
      const from = r.start_on || today(), had = await db.one("SELECT id FROM hr_contract WHERE emp_id = $1 AND kind IN ('HD02','HD03') AND from_on >= $2 ORDER BY from_on LIMIT 1", [r.emp_id, from]);
      let id = had?.id;
      if (!id) { const e = await db.one('SELECT code FROM hr_employee WHERE id = $1', [r.emp_id]), to = addDays(`${+from.slice(0, 4) + 1}${from.slice(4)}`, -1);
        id = (await C.create('contract', { emp_id: r.emp_id, legal_id: r.legal_id, kind: 'HD02', no: `${e.code}/${from.slice(0, 4)}/HĐLĐ`, sign_on: from, from_on: from, to_on: to, title: r.position, salary: r.p1, p2: r.p2, tpl: 'HDLD_XDTH', state: 'hieu_luc', note: `Theo tờ trình ${r.code}` }, ctx.user, { db, system: true, demo: r.is_demo })).row.id; }
      await db.q('UPDATE hr_rec_memo SET contract_id = $1 WHERE id = $2', [id, r.id]);
    },
  },
  interview: {
    async beforeSave(r, o, ctx) {
      const hm =s => new Date(new Date(s).getTime() + 7 * 3600e3).toISOString().slice(11, 16);
      if (Array.isArray(r.lines)) r.lines = r.lines.map(l => ({ ...l }));   // không sửa lẫn vào bản cũ (old.lines) → mới so được thay đổi
      if (o?.start_at && r.start_at && r.start_at !== o.start_at) for (const l of r.lines || []) if (l.start === hm(o.start_at)) l.start = hm(r.start_at);   // giờ ứng viên tự điền theo giờ cũ → dời theo giờ mới
      for (const l of r.lines || []) if (l.code && !l.start && r.start_at) l.start = hm(r.start_at);
      for (const l of (r.lines || []).filter(l => l.code && !(o?.lines || []).some(x => x.code === l.code))) {   // ứng viên mới thêm vào lịch: đúng mã, đang chờ (hồ sơ đạt / chờ phỏng vấn)
        const c = await ctx.db.one('SELECT full_name, status FROM hr_candidate WHERE code = $1', [l.code]);
        if (!c) bad(`Không có ứng viên mã «${l.code}» — chọn mã trong danh sách gợi ý`);
        if (!['S12', 'S33'].includes(c.status)) bad(`${c.full_name} (${l.code}) không ở danh sách chờ phỏng vấn`);
        l.name ||= c.full_name;
      }
      const c = (r.lines || []).find(l => l.code) && await ctx.db.one('SELECT legal_id, dept_id FROM hr_candidate WHERE code = $1', [r.lines.find(l => l.code).code]);   // pháp nhân, bộ phận theo ứng viên
      if (c) { r.legal_id = c.legal_id; r.dept_id = c.dept_id; }
      if (r.mode === 'online' && !r.link) ctx.warn.push('Phỏng vấn trực tuyến — nhớ dán link Teams');
      if (o && (r.start_at !== o.start_at || r.day !== o.day)) { r.confirm = 'cho_xn'; r.head_note = null; }   // đổi giờ → trưởng BP xác nhận lại
      if ((r.lines || []).length && r.lines.every(l => !l.code || l.result) && r.status === 'moi') r.status = 'da_pv';
    },
    async afterSave(r, old, ctx) {
      const go = () => autoLetters(r.id, ctx.user);   // tự gửi thư mời / thư kết quả lên app sau khi đã lưu xong (sau COMMIT)
      if (ctx.db.after) ctx.db.after.push(go); else await go();
      const db = ctx.db, cand = (r.lines || []).filter(l => l.code), RS = { 'Đạt': 'S35', 'Không đạt': 'S24', 'Vắng': 'S21' };
      for (const l of cand) {   // lên lịch → Chờ phỏng vấn; ghi kết quả → Đạt / Không đạt / Vắng
        if (l.result) await db.q("UPDATE hr_candidate SET status = $1 WHERE code = $2 AND status IN ('S12','S33','S34','S35','S24','S21')", [RS[l.result] || 'S34', l.code]);
        else await db.q("UPDATE hr_candidate SET status = 'S33' WHERE code = $1 AND status = 'S12'", [l.code]);
      }
      // trực tiếp + chọn phòng → tự đặt phòng họp
      // người đặt: người lưu lịch → người lập lịch → trưởng bộ phận; thiếu pháp nhân / người đặt thì chỉ nhắc, không làm hỏng việc lưu lịch
      const booker = r.mode === 'truc_tiep' && r.room_id && r.start_at && !r.room_book_id && r.status === 'moi' && (ctx.user?.emp_id || (await db.one('SELECT emp_id FROM hr_user WHERE id = $1', [r.created_by || 0]))?.emp_id || (r.dept_id && (await db.one('SELECT head_id FROM hr_dept WHERE id = $1', [r.dept_id]))?.head_id));
      if (r.mode === 'truc_tiep' && r.room_id && r.start_at && !r.room_book_id && r.status === 'moi' && (!r.legal_id || !booker)) ctx.warn.push('Chưa tự đặt được phòng họp (lịch chưa có pháp nhân / người đặt) — đặt phòng tay ở PH01');
      else if (booker) {
        const end = new Date(new Date(r.start_at).getTime() + (+r.minutes || 90) * 60e3).toISOString();
        const b = await C.create('room_book', { legal_id: r.legal_id, emp_id: booker, host: r.board || null, start_at: r.start_at, end_at: end, room_id: r.room_id, descr: `Phỏng vấn ${r.code}`, status: 'da_duyet' }, ctx.user, { db, system: true, demo: r.is_demo });
        await db.q('UPDATE hr_interview SET room_book_id = $1 WHERE id = $2', [b.row.id, r.id]); for (const w of b.warnings || []) ctx.warn.push(w);
      }
      if (r.room_book_id && (r.mode !== 'truc_tiep' || !r.room_id)) {   // chuyển trực tuyến / bỏ phòng → tự huỷ phiếu đặt phòng
        await db.q("UPDATE hr_room_book SET status = 'huy' WHERE id = $1", [r.room_book_id]);
        await db.q('UPDATE hr_interview SET room_book_id = NULL WHERE id = $1', [r.id]); r.room_book_id = null;
      }
      if (r.room_book_id && old && (r.start_at !== old.start_at || r.room_id !== old.room_id || r.status === 'huy')) {
        const end = new Date(new Date(r.start_at).getTime() + (+r.minutes || 90) * 60e3).toISOString();
        await db.q('UPDATE hr_room_book SET start_at = $1, end_at = $2, room_id = $3, status = $4 WHERE id = $5', [r.start_at, end, r.room_id, r.status === 'huy' ? 'huy' : 'da_duyet', r.room_book_id]);
      }
      // thông báo trưởng bộ phận: lịch mới / đổi giờ → xác nhận; có kết quả → báo kết quả
      const head = r.dept_id && await db.one('SELECT u.id FROM hr_dept d JOIN hr_user u ON u.emp_id = d.head_id AND u.active WHERE d.id = $1', [r.dept_id]), who = cand.map(l => l.name).filter(Boolean).join(', '), when = C.dmy(r.day) + (r.start_at ? ' ' + new Date(new Date(r.start_at).getTime() + 7 * 3600e3).toISOString().slice(11, 16) : '');
      if (!head && r.dept_id && (!old || r.confirm === 'cho_xn' && old.confirm !== 'cho_xn')) ctx.warn.push('Bộ phận chưa có trưởng BP có tài khoản app — chưa gửi được thông báo xác nhận');
      if (head && (!old || r.confirm === 'cho_xn' && old.confirm !== 'cho_xn')) await C.notify(db, [head.id], `Lịch phỏng vấn ${r.code} — cần xác nhận`, `${who} · ${when}${r.link ? ' · ' + r.link : ''}`, `e/interview/${r.id}`);
      const done = cand.filter(l => l.result && !(old?.lines || []).some(x => x.code === l.code && x.result === l.result));
      if (done.length) await C.notify(db, [head?.id, r.created_by].filter(id => id && id !== ctx.user?.id), `Kết quả phỏng vấn ${r.code}`, done.map(l => `${l.name || l.code}: ${l.result}`).join(' · '), `e/interview/${r.id}`);
    },
    acts: {
      async gui_tbp(r, d, ctx) {   // trưởng BP chưa nhận / chưa xem → gửi lại thông báo xác nhận lịch
        const head = r.dept_id && await ctx.db.one('SELECT u.id, u.full_name FROM hr_dept d JOIN hr_user u ON u.emp_id = d.head_id AND u.active WHERE d.id = $1', [r.dept_id]);
        if (!head) bad('Bộ phận chưa có trưởng BP có tài khoản app — gán «Người phụ trách» ở Danh mục bộ phận');
        const who = (r.lines || []).filter(l => l.code).map(l => l.name || l.code).join(', ');
        await C.notify(ctx.db, [head.id], `Nhắc: lịch phỏng vấn ${r.code} — cần xác nhận`, `${who} · ${C.dmy(r.day)}${r.link ? ' · ' + r.link : ''}`, `e/interview/${r.id}`);
        return { note: `Đã gửi lại thông báo cho ${head.full_name}` };
      },
      async xac_nhan(r, d, ctx) { await C.notify(ctx.db, [r.created_by].filter(id => id !== ctx.user?.id), `Trưởng BP đã xác nhận lịch ${r.code}`, ctx.user?.full_name, `e/interview/${r.id}`); return { patch: { confirm: 'da_xn' } }; },
      async doi_gio(r, d, ctx) { await C.notify(ctx.db, [r.created_by].filter(id => id !== ctx.user?.id), `Đề nghị đổi giờ phỏng vấn ${r.code}`, `${ctx.user?.full_name}: ${d.head_note}`, `e/interview/${r.id}`); return { patch: { confirm: 'doi_gio', head_note: d.head_note } }; },
      async gui_moi(r, d, ctx) { const o = await sendLetters(r, 'moi', ctx, (r.lines || []).filter(l => l.code && !l.result).map(l => l.code)), log = { ...(r.sent_log || {}) }; for (const l of (r.lines || []).filter(l => l.code && !l.result)) log[l.code] = { ...log[l.code], ik: inviteKey(r, l), invite_at: new Date().toISOString() }; return { ...o, patch: { ...o.patch, sent_log: log } }; },
      async gui_kq(r, d, ctx) { const o = await sendLetters(r, 'kq', ctx), log = { ...(r.sent_log || {}) }; for (const l of (r.lines || []).filter(l => l.code && l.result)) log[l.code] = { ...log[l.code], res: l.result, result_at: new Date().toISOString() }; return { ...o, patch: { ...o.patch, sent_log: log } }; },
      async huy(r, d, ctx) { if (r.room_book_id) await ctx.db.q("UPDATE hr_room_book SET status = 'huy' WHERE id = $1", [r.room_book_id]); return { patch: { status: 'huy' } }; },
    },
  },
  leave: {
    async beforeSave(r, o, ctx) {
      if (!r.from_on || !r.to_on) return;   // thiếu ngày → báo «Thiếu thông tin bắt buộc», không lỗi 500
      if (r.to_on < r.from_on) bad('Đến ngày phải sau hoặc bằng Từ ngày');
      const hol = await holidays(ctx.db); const wd = monthsOf(r.from_on, r.to_on).filter(d => isWorkday(d, hol)).length;
      if (o && (r.from_on !== o.from_on || r.to_on !== o.to_on || r.type_code !== o.type_code) && +r.days === +o.days) r.days = null;   // đổi ngày / loại nghỉ mà không sửa số ngày → tính lại
      if (r.days == null) r.days =/\/2$/.test(r.type_code || '') ? wd / 2 : wd;   // P/2: nửa ngày mỗi ngày
      const t = await ctx.db.one('SELECT 1 AS x FROM hr_att_type WHERE code = $1', [r.type_code]); if (!t) bad(`Loại nghỉ ${r.type_code} không có trong danh mục CC06`);
      if (['P', 'P/2', 'P>1'].includes(r.type_code)) {
        // phép tích lũy từ ngày ký HĐ thử việc nhưng chỉ được dùng khi đã có HĐLĐ chính thức hiệu lực tại ngày nghỉ
        const u = await leaveUsableFrom(ctx.db, r.emp_id);
        if (u === false || (u && r.from_on < u)) bad(`Đang thử việc — phép năm chỉ được dùng sau khi ký HĐLĐ chính thức${u ? ` (từ ${C.dmy(u)})` : ''}. Chọn loại nghỉ khác (VD nghỉ không lương)`);
        const b = await leaveLeft(ctx.db, r.emp_id, r.from_on.slice(0, 4), r.id);
        if (b != null && r.days > b) ctx.warn.push(`Số ngày phép còn lại ${b}, đơn này xin ${r.days} ngày`);
      }
    },
    async afterApprove(r, ok, ctx) { if (ok) await markRange(ctx.db, r.emp_id, r.from_on, r.to_on, r.type_code === 'P>1' ? 'P' : r.type_code, 'CC04', r.is_demo); },
  },
  leave_bal: {
    async decorate(rows, { db }) { for (const y of new Set(rows.map(r => r.year))) await syncLeave(db, y);   // phép được hưởng luôn theo số tháng làm việc tới hôm nay
      for (const r of rows) { const b = await db.one('SELECT earned FROM hr_leave_bal WHERE id = $1', [r.id]); r.earned = b ? +b.earned : r.earned;
        const u = await leaveUsableFrom(db, r.emp_id); r.use_st = u === false ? 'Chờ HĐ chính thức' : u && u > today() ? `Dùng từ ${C.dmy(u)}` : 'Được dùng'; r.use_st_c = u === false || (u && u > today()) ? 'a' : 'g'; r.used = await leaveUsed(db, r.emp_id, r.year); r.closing = +(r.opening || 0) + +(r.earned || 0) + +(r.adjust || 0) - +(r.used_before || 0) - r.used; } },
    async beforeSave(r, o, ctx) { const e = r.emp_id && await ctx.db.one(`SELECT ${LEAVE_BASE} AS join_on, leave_on FROM hr_employee WHERE id = $1`, [r.emp_id]); if (e) r.earned = leaveEarned(e.join_on, e.leave_on, r.year); },
    acts: { async chinh_phep(r, d) { const p = {}; for (const k of ['opening', 'used_before', 'adjust']) if (d[k] != null) p[k] = d[k]; p.note = d.reason; return { patch: p, note: 'Đã chỉnh phép' }; } },
  },
  trip: { beforeSave(r) { if (r.to_on < r.from_on) bad('Đến ngày phải sau hoặc bằng Từ ngày'); }, async afterApprove(r, ok, ctx) { if (ok) await markRange(ctx.db, r.emp_id, r.from_on, r.to_on, 'CT', 'CC08', r.is_demo); } },
  explain: { async afterApprove(r, ok, ctx) {
    if (!ok) return; const t = /(\d{1,2}:\d{2})/.exec(r.right_time || '')?.[1];
    await setMark(ctx.db, r.emp_id, r.day, 'HC', r.kind === 'quen_vao' ? { in_t: t } : r.kind === 'quen_ra' ? { out_t: t } : {}, 'CC03', r.is_demo);
  } },
  att_add: {   // chấm bù cả ngày / nửa ngày / chỉ giờ vào hoặc ra, cho một khoảng ngày, một hoặc nhiều người
    decorate(rows) { for (const r of rows) r.n_emps = new Set([r.emp_id ? 'id' + r.emp_id : null, ...(r.emps || []).map(x => x.code)].filter(Boolean)).size; },
    async beforeSave(r, o, ctx) {
      r.emps = (r.emps || []).filter(x => x.code); for (const x of r.emps) { const e = await ctx.db.one('SELECT full_name FROM hr_employee WHERE code = $1', [x.code]); if (!e) bad(`Không có nhân viên mã «${x.code}»`); x.name ||= e.full_name; }
      if (!r.emp_id && !r.emps.length) bad('Chọn ít nhất một nhân sự');
      if (r.to_on && r.to_on < r.from_on) bad('Đến ngày phải sau hoặc bằng Từ ngày');
      if (['vao', 'ra'].includes(r.kind) && !/^\d{1,2}:\d{2}$/.test(r.time || '')) bad('Nhập giờ chấm bù, dạng 08:00');
      if (!['vao', 'ra'].includes(r.kind)) r.time = null;
    },
    async afterApprove(r, ok, ctx) {
      if (!ok) return; const hol = await holidays(ctx.db);
      const [mark, t] = { ca_ngay: ['HC', { in_t: '08:00', out_t: '17:30' }], sang: ['HC/2', { in_t: '08:00', out_t: '12:00' }], chieu: ['HC/2', { in_t: '13:30', out_t: '17:30' }], vao: ['HC', { in_t: r.time }], ra: ['HC', { out_t: r.time }] }[r.kind];
      const ids = new Set([r.emp_id].filter(Boolean)); for (const x of r.emps || []) { const e = await ctx.db.one('SELECT id FROM hr_employee WHERE code = $1', [x.code]); if (e) ids.add(e.id); }
      for (const emp of ids) for (const d of monthsOf(r.from_on, r.to_on || r.from_on)) if (isWorkday(d, hol)) {
        let m = mark, p = t;
        if (mark === 'HC/2') {   // đã có nửa kia (sáng + chiều) → HC, giữ giờ của nửa kia; đã đủ công → giữ nguyên
          const x = await ctx.db.one('SELECT mark, in_t::text AS i, out_t::text AS o FROM hr_attendance WHERE emp_id = $1 AND day = $2', [emp, d]);
          if (x?.mark === 'HC') { m = 'HC'; p = {}; }
          else if (x?.mark === 'HC/2' && (r.kind === 'sang' ? x.o > '13' : x.i && x.i < '12')) { m = 'HC'; p = r.kind === 'sang' ? { in_t: t.in_t } : { out_t: t.out_t }; }
        }
        await setMark(ctx.db, emp, d, m, p, 'CC10', r.is_demo);
      }
    },
  },
  transfer: {
    async beforeSave(r, old, ctx) {
      if (r.emp_id && (!old || old.emp_id !== r.emp_id)) { const e = await ctx.db.one('SELECT legal_id, dept_id, title FROM hr_employee WHERE id = $1', [r.emp_id]); if (e) { r.from_legal_id = e.legal_id; r.from_dept_id = e.dept_id; r.from_title = e.title; } }
      if (!r.to_legal_id && !r.to_dept_id && !r.to_title) bad('Chọn ít nhất một thay đổi: pháp nhân, phòng ban hoặc chức danh mới');
    },
    async afterSave(r, old, ctx) {   // không qua duyệt: đến ngày hiệu lực → cập nhật hồ sơ ngay; ngày sau → việc nền cập nhật đúng ngày
      if (r.status === 'da_duyet' && !r.applied && r.from_on <= today()) await applyTransfer(ctx.db, r, ctx.user);
      if (old) return; const db = ctx.db, e = await db.one('SELECT full_name FROM hr_employee WHERE id = $1', [r.emp_id]);
      const heads = await db.q('SELECT DISTINCT u.id FROM hr_dept d JOIN hr_user u ON u.emp_id = d.head_id AND u.active WHERE d.id = ANY($1)', [[r.from_dept_id, r.to_dept_id].filter(Boolean)]);
      const nm = async id => id ? (await db.one('SELECT name FROM hr_dept WHERE id = $1', [id]))?.name : null, to = await nm(r.to_dept_id);
      if (heads.length) await C.notify(db, heads.map(h => h.id).filter(id => id !== ctx.user?.id), `Thuyên chuyển: ${e?.full_name}`, `${await nm(r.from_dept_id) || ''}${to ? ' → ' + to : ''}${r.to_title ? ' · ' + r.to_title : ''} · hiệu lực ${C.dmy(r.from_on)}`, `e/transfer/${r.id}`);
      else ctx.warn.push('Phòng ban chưa có trưởng phòng có tài khoản app — chưa gửi được thông báo');
      if (r.from_on > today()) ctx.warn.push(`Hồ sơ sẽ tự cập nhật vào ngày hiệu lực ${C.dmy(r.from_on)}`);
    },
  },
  ot: {
    beforeSave(r) { r.hours_reg = hoursBetween(r.from_t, r.to_t); },
    async onApprove(r, ok) { if (ok && r.hours_ok == null) return { patch: { hours_ok: r.hours_reg } }; },   // mặc định giờ duyệt = giờ đăng ký, HCNS sửa theo thực tế
  },
  att_auto: {
    async beforeSave(r, o, ctx) {
      await empFill(r, ctx.db); if (r.to_on && r.to_on < r.from_on) bad('Ngày kết thúc phải sau ngày bắt đầu');
      const dup = r.emp_id && await ctx.db.one("SELECT code FROM hr_att_auto WHERE emp_id = $1 AND id <> $2 AND state = 'chay' AND (to_on IS NULL OR to_on >= $3) AND ($4::date IS NULL OR from_on <= $4)", [r.emp_id, r.id || 0, r.from_on, r.to_on || null]);
      if (dup && r.state !== 'dung') bad(`Nhân viên đã có lịch chấm tự động ${dup.code} trùng thời gian`);
    },
    async afterSave(r, old, ctx) { if (r.state !== 'dung') await autoFill(ctx.db, r); },
    acts: { async dung(r) { if (r.state === 'dung') bad('Lịch này đã dừng'); const end = r.to_on && r.to_on < today() ? r.to_on : today(); return { patch: { state: 'dung', to_on: end < r.from_on ? r.from_on : end } }; } },   // chưa đến ngày bắt đầu → kết thúc = ngày bắt đầu
  },
  att_period: { acts: {
    async khoa(r, d, ctx) {
      // phải duyệt hết đơn trong kỳ (giải trình, nghỉ phép, công tác, tăng ca, chấm bổ sung) mới khóa được
      const L = [['explain', 'giải trình', 'day', 'day'], ['leave', 'đơn nghỉ', 'from_on', 'to_on'], ['trip', 'đơn công tác', 'from_on', 'to_on'], ['ot', 'đơn tăng ca', 'day', 'day'], ['att_add', 'phiếu chấm bổ sung', 'from_on', 'coalesce(x.to_on, x.from_on)']], miss = [];
      for (const [t, l, a, b] of L) { const n = +(await ctx.db.one(`SELECT count(*) AS n FROM hr_${t} x JOIN hr_employee e ON e.id = x.emp_id WHERE e.legal_id = $1 AND to_char(x.${a},'YYYY-MM') <= $2 AND to_char(${b.includes('(') ? b : 'x.' + b},'YYYY-MM') >= $2 AND x.status IN ('nhap','cho_duyet')`, [r.legal_id, r.month])).n; if (n) miss.push(`${n} ${l}`); }
      if (miss.length) bad(`Còn ${miss.join(', ')} chưa duyệt xong trong kỳ — duyệt hoặc từ chối hết rồi mới khóa công`);
      return { patch: { status: 'khoa', locked_at: new Date().toISOString() } };
    },
    async mo() { return { patch: { status: 'mo', locked_at: null } }; },
  } },
  payroll: { noDelete: r => r.status === 'da_chuyen' && 'Bảng lương đã chuyển tiền', async afterSave(r, old, ctx) { if (!old) await calcPayroll(ctx.db, r); },
    onSubmit: async (r, ctx) => { const miss = (r.lines || []).filter(l => !l.p1); if (miss.length) ctx.warn.push(`${miss.length} người chưa có lương P1`); },
    async afterApprove(r, ok, ctx) {   // bảng lương duyệt → báo từng nhân viên (có tài khoản) xem phiếu lương của mình trên «Chấm công & đơn từ»
      if (!ok) return; const us = await ctx.db.q('SELECT u.id, u.emp_id FROM hr_user u WHERE u.active AND u.emp_id = ANY($1)', [(r.lines || []).map(l => l.emp_id)]);
      for (const x of us) { const l = r.lines.find(y => y.emp_id === x.emp_id); await C.notify(ctx.db, [x.id], `Phiếu lương tháng ${r.month.slice(5)}/${r.month.slice(0, 4)}`, `Thực lĩnh ${Math.round(+l?.net || 0).toLocaleString('vi-VN')} đ · ${(+l?.d100 || 0) + (+l?.d85 || 0)} công — bấm để xem, in phiếu lương`, 'v/portal'); }
    },
    acts: { async tao_lai(r, d, ctx) { await calcPayroll(ctx.db, r); }, async chot() { return { patch: { status: 'da_chuyen' } }; } } },
  ins_sheet: { beforeSave(r) { r.total_due = insDueTotal(r); }, async afterSave(r, old, ctx) { if (!old && !(r.lines || []).length) await calcIns(ctx.db, r); }, acts: { async tao_lai(r, d, ctx) { await calcIns(ctx.db, r); }, async chot(r) { return { patch: { status: 'da_chuyen', paid: r.paid ?? r.total_due ?? r.due } }; } } },   // đã nộp = tổng phải nộp (kể cả lãi, truy thu)
  cd_sheet: { async afterSave(r, old, ctx) { if (!old && !(r.lines || []).length) await calcCd(ctx.db, r); }, acts: { async tao_lai(r, d, ctx) { await calcCd(ctx.db, r); }, async chot(r) { return { patch: { status: 'da_chuyen', paid: r.paid ?? r.due } }; } } },
};
C.hooks(H);
for (const [k, v] of Object.entries({ employee: [{ k: 'to_trinh_tv', l: 'Tờ trình hết thử việc', ico: 'fa-file-signature', from: '*', roles: ['cv_hcns', 'tp_hcns'] }], candidate: [{ k: 'qua_vong', l: 'Qua vòng tiếp theo', ico: 'fa-circle-check', from: ['S12', 'S33', 'S34', 'S35', 'S36', 'S52'], roles: ['cv_hcns', 'tp_hcns'] },
  { k: 'truot', l: 'Không đạt', ico: 'fa-circle-xmark', from: ['S12', 'S33', 'S34', 'S35', 'S36', 'S52', 'S53'], roles: ['cv_hcns', 'tp_hcns'], ask: [{ k: 'reason', l: 'Lý do không đạt', t: 'text', req: 1 }] },
  { k: 'to_trinh', l: 'Tạo tờ trình', ico: 'fa-file-signature', from: ['S34', 'S35', 'S36', 'S52'], roles: ['cv_hcns', 'tp_hcns'] }, { k: 'nhan_viec', l: 'Tạo hồ sơ NV + HĐ thử việc', ico: 'fa-user-check', from: ['S53'], roles: ['cv_hcns', 'tp_hcns'], ask: [{ k: 'start_on', l: 'Ngày nhận việc', t: 'date', req: 1, def: 'today' }, { k: 'p1', l: 'Lương P1 thỏa thuận (đ/tháng)', t: 'money' }, { k: 'p2', l: 'Lương P2 thỏa thuận (đ/tháng)', t: 'money' }] }] })) C.E[k].acts = v;

// thư mời / thư báo kết quả phỏng vấn → đẩy lên nền tảng chung (webhook hr.message): mỗi ứng viên một tin, kèm bản sao vào tài khoản trưởng bộ phận
// TỰ GỬI sau khi lịch đã lưu (chạy ngoài giao dịch, đọc bản đã ghi): thư mời khi có ứng viên mới hoặc đổi ngày/giờ/hình thức/phòng/link;
// thư kết quả khi ghi hoặc đổi kết quả. sent_log nhớ đã gửi gì cho ai → không gửi trùng.
const inviteKey = (r, l) => [r.day, l.start || r.start_at, r.mode, r.link || '', r.room_id || '', r.place || ''].join('|');
async function autoLetters(id, user) {
  {
    try {
      const db = { q: (s, p) => require('./db').q(s, p), one: (s, p) => require('./db').one(s, p) };
      const r = await db.one('SELECT * FROM hr_interview WHERE id = $1', [id]); if (!r || r.status === 'huy') return;
      const log = r.sent_log || {}, lines = (r.lines || []).filter(l => l.code), t = today();
      const inv = lines.filter(l => !l.result && r.day >= t && log[l.code]?.ik !== inviteKey(r, l)).map(l => l.code);
      const res = lines.filter(l => l.result && log[l.code]?.res !== l.result).map(l => l.code);
      if (!inv.length && !res.length) return;
      const ctx = { db, user };
      if (inv.length) await sendLetters(r, 'moi', ctx, inv);
      if (res.length) await sendLetters(r, 'kq', ctx, res);
      for (const l of lines) { if (inv.includes(l.code)) log[l.code] = { ...log[l.code], ik: inviteKey(r, l), invite_at: new Date().toISOString() }; if (res.includes(l.code)) log[l.code] = { ...log[l.code], res: l.result, result_at: new Date().toISOString() }; }
      await db.q(`UPDATE hr_interview SET sent_log = $1${inv.length ? ', invite_sent_at = now()' : ''}${res.length ? ', result_sent_at = now()' : ''} WHERE id = $2`, [JSON.stringify(log), id]);
      await C.audit(db, 'interview', id, 'tu_dong', null, null, user, `Tự gửi lên app: ${inv.length ? `thư mời ${inv.length}` : ''}${inv.length && res.length ? ', ' : ''}${res.length ? `thư kết quả ${res.length}` : ''}`);
    } catch (er) { console.error('Tự gửi thư phỏng vấn lỗi:', er.message); }
  }
}
async function sendLetters(r, kind, ctx, codes) {
  const FM = require('./forms'), P = require('./platform'), { items, title } = await FM.letterItems(r.id, ctx.user, kind, codes), db = ctx.db;
  const head = r.dept_id && await db.one("SELECT h.code, h.full_name, u.id uid FROM hr_dept d JOIN hr_employee h ON h.id = d.head_id AND h.state <> 'da_nghi' LEFT JOIN hr_user u ON u.emp_id = h.id AND u.active WHERE d.id = $1", [r.dept_id]);
  let sent = 0;
  for (const x of items) {
    const to = [{ type: 'ung_vien', code: x.cand.code, name: x.cand.name, email: x.cand.email, phone: x.cand.phone }, ...(head ? [{ type: 'nhan_vien', emp_code: head.code, name: head.full_name, role: 'truong_bp', copy: true }] : [])];
    const res = await P.pushMessage({ kind: kind === 'kq' ? 'interview.result' : 'interview.invite', ref: { type: 'interview', id: r.id, code: r.code }, to, subject: `${title} — ${x.cand.position || ''} — ${x.cand.name}`.replace(/ —  —/, ' —'), result: x.result, text: FM.letterText(x.html), html: x.html, sender: ctx.user?.full_name || null });
    if (res.queued) sent++;
    if (kind === 'kq' && x.result === 'Đạt') await db.q("UPDATE hr_candidate SET status = 'S36' WHERE code = $1 AND status = 'S35'", [x.cand.code]);
  }
  if (head?.uid) await C.notify(db, [head.uid], `${kind === 'kq' ? 'Đã gửi thư báo kết quả' : 'Đã gửi thư mời phỏng vấn'} ${r.code}`, items.map(x => x.cand.name + (x.result ? `: ${x.result}` : '')).join(' · '), `e/interview/${r.id}`);
  return { patch: { [kind === 'kq' ? 'result_sent_at' : 'invite_sent_at']: new Date().toISOString() }, note: `Đã gửi ${sent} thư lên app nền tảng chung` };
}

// HĐ mới (không phải phụ lục) đến ngày hiệu lực → HĐ cũ thành «Đã thay thế», trạng thái hồ sơ theo loại HĐ
async function replaceContract(db, r) {
  await db.q("UPDATE hr_contract SET state = 'thay_the' WHERE emp_id = $1 AND id <> $2 AND kind <> 'HD04' AND state IN ('hieu_luc','cho_quyet_dinh') AND from_on <= $3", [r.emp_id, r.id, r.from_on]);
  await db.q("UPDATE hr_employee SET state = CASE WHEN $2 = 'HD01' THEN 'thu_viec' WHEN state = 'thu_viec' THEN 'dang_lam' ELSE state END WHERE id = $1 AND state <> 'da_nghi'", [r.emp_id, r.kind]);
}
// QĐ chấm dứt: ngày hiệu lực = ngày làm việc cuối → khóa tài khoản, chấm dứt HĐ từ ngày hôm sau; QĐ khác: từ ngày hiệu lực
const due = r => ['HD10', 'HD11'].includes(r.kind) ? r.from_on < today() : r.from_on <= today();
// quyết định / thuyên chuyển đã duyệt → cập nhật hồ sơ (ngay nếu đã đến ngày hiệu lực, còn lại việc nền chạy đúng ngày)
async function applyDecision(db, r, user) {
  const p = {};
  if (['HD05', 'HD06', 'HD07'].includes(r.kind)) { if (r.legal_id) p.legal_id = r.legal_id; if (r.dept_id) p.dept_id = r.dept_id; if (r.title) p.title = r.title; }
  if (r.kind === 'HD08') { if (r.new_p1 != null) p.pay_p1 = r.new_p1; if (r.new_p2 != null) p.pay_p2 = r.new_p2; if (r.new_ins != null) p.ins_salary = r.new_ins; }
  if (['HD06', 'HD07'].includes(r.kind) && r.allow_code) {   // bổ nhiệm → hưởng phụ cấp kèm theo; miễn nhiệm → thôi
    const a = await db.one('SELECT code, name FROM hr_allowance WHERE code = $1', [r.allow_code]), cur = ((await db.one('SELECT allows FROM hr_employee WHERE id = $1', [r.emp_id]))?.allows || []).filter(x => x.code !== r.allow_code);
    p.allows = r.kind === 'HD06' && a ? [...cur, { code: a.code, name: a.name, from: C.dmy(r.from_on), dec: r.no }] : cur;
  }
  if (['HD10', 'HD11'].includes(r.kind)) {
    p.state = 'da_nghi'; p.leave_on = r.from_on;
    await db.q("UPDATE hr_contract SET state = 'cham_dut' WHERE emp_id = $1 AND state IN ('hieu_luc', 'cho_quyet_dinh')", [r.emp_id]);
    await db.q('UPDATE hr_user SET active = false WHERE emp_id = $1', [r.emp_id]);
  }
  if (Object.keys(p).length) await C.sys(db, 'employee', r.emp_id, p, user, 'tu_dong', `Theo ${r.no}`);
  await db.q('UPDATE hr_decision SET applied = true WHERE id = $1', [r.id]);
}
async function applyTransfer(db, r, user) {
  const p = {}; if (r.to_legal_id) p.legal_id = r.to_legal_id; if (r.to_dept_id) p.dept_id = r.to_dept_id; if (r.to_title) p.title = r.to_title;
  await C.sys(db, 'employee', r.emp_id, p, user, 'tu_dong', `Thuyên chuyển ${r.code}`);
  await db.q('UPDATE hr_transfer SET applied = true WHERE id = $1', [r.id]);
}
async function applyDue(db, user) {   // việc nền hằng ngày
  let n = 0;
  for (const r of await db.q("SELECT * FROM hr_decision WHERE status = 'da_duyet' AND applied IS NOT TRUE AND from_on <= $1 ORDER BY from_on, id", [today()])) if (due(r)) { await applyDecision(db, r, user); n++; }   // QĐ cũ trước, mới sau
  for (const r of await db.q("SELECT * FROM hr_transfer WHERE status = 'da_duyet' AND applied IS NOT TRUE AND from_on <= $1 ORDER BY from_on, id", [today()])) { await applyTransfer(db, r, user); n++; }
  // HĐ ký trước, nay đến ngày hiệu lực mà HĐ cũ vẫn đang hiệu lực → thay thế
  for (const r of await db.q("SELECT c.* FROM hr_contract c WHERE c.state = 'hieu_luc' AND c.kind <> 'HD04' AND c.from_on <= $1 AND EXISTS (SELECT 1 FROM hr_contract o WHERE o.emp_id = c.emp_id AND o.id <> c.id AND o.kind <> 'HD04' AND o.state IN ('hieu_luc','cho_quyet_dinh') AND o.from_on < c.from_on) ORDER BY c.from_on, c.id", [today()])) { await replaceContract(db, r); n++; }
  for (const r of await db.q("SELECT * FROM hr_att_auto WHERE state = 'chay'")) await autoFill(db, r);
  return n;
}
// chấm công tự động: ghi HC mọi ngày làm việc từ ngày bắt đầu đến min(kết thúc, hôm nay); ngày đã có công giữ nguyên, kỳ đã khóa bỏ qua
async function autoFill(db, r) {
  if (!r.emp_id || !r.from_on) return; const e = await db.one('SELECT join_on, leave_on FROM hr_employee WHERE id = $1', [r.emp_id]); if (!e) return;
  const hol = await holidays(db), t = today(), end = r.to_on && r.to_on < t ? r.to_on : t;
  // quét tiếp từ ngày sau ô công tự động gần nhất (các ngày trước đó đã xét ở lượt trước) — không quét lại từ đầu mỗi giờ
  const last = (await db.one("SELECT max(day)::text AS d FROM hr_attendance WHERE emp_id = $1 AND source = 'CC11' AND day >= $2", [r.emp_id, r.from_on]))?.d;
  const from = last ? addDays(last, 1) : r.from_on;
  for (const d of from <= end ? monthsOf(from, end) : []) {
    if (!isWorkday(d, hol) || (e.join_on && d < e.join_on) || (e.leave_on && d > e.leave_on)) continue;
    if (await db.one('SELECT 1 AS x FROM hr_attendance WHERE emp_id = $1 AND day = $2', [r.emp_id, d])) continue;
    try { await setMark(db, r.emp_id, d, 'HC', {}, 'CC11', r.is_demo); } catch { /* kỳ công đã khóa */ }
  }
  const n = (await db.one("SELECT count(*) AS n FROM hr_attendance WHERE emp_id = $1 AND source = 'CC11' AND day BETWEEN $2 AND $3", [r.emp_id, r.from_on, end])).n;
  await db.q("UPDATE hr_att_auto SET n_days = $1, state = CASE WHEN to_on IS NOT NULL AND to_on < $3 THEN 'dung' ELSE state END WHERE id = $2", [n, r.id, t]);
}

async function leaveUsed(db, empId, year, exceptId = 0) {   // exceptId: không tính chính đơn đang xét («còn lại trước đơn này»)
  return (await db.one(`SELECT coalesce(sum(days),0) AS n FROM hr_leave WHERE emp_id = $1 AND status = 'da_duyet' AND type_code IN ('P','P/2','P>1') AND to_char(from_on,'YYYY') = $2 AND id <> $3`, [empId, String(year), +exceptId || 0])).n;
}
async function leaveLeft(db, empId, year, exceptId) {
  await syncLeave(db, year, empId); const b = await db.one('SELECT * FROM hr_leave_bal WHERE emp_id = $1 AND year = $2', [empId, +year]); if (!b) return null;
  return +b.opening + +b.earned + +b.adjust - +(b.used_before || 0) - await leaveUsed(db, empId, year, exceptId);
}
// phép được hưởng = số tháng làm việc trong năm (tối đa 12): năm đầu từ tháng vào làm (vào sau ngày 15 → tính từ tháng sau), đến tháng của asOf / tháng nghỉ việc
function leaveEarned(joinOn, leaveOn, year, asOf = today()) {
  const y = String(year), lastM = [asOf, leaveOn, `${y}-12-31`].filter(Boolean).sort()[0].slice(0, 7);
  let firstM = `${y}-01`; if (joinOn && joinOn.slice(0, 4) === y) firstM = +joinOn.slice(8, 10) > 15 ? nextMonth(joinOn.slice(0, 7)) : joinOn.slice(0, 7); else if (joinOn && joinOn.slice(0, 4) > y) return 0;
  if (lastM < firstM || lastM.slice(0, 4) < y) return 0; return Math.min(12, (+lastM.slice(0, 4) - +firstM.slice(0, 4)) * 12 + +lastM.slice(5) - +firstM.slice(5) + 1);
}
// cập nhật «phép được hưởng» cho cả năm (một người nếu có empId); người đang làm chưa có dòng phép → tạo dòng
// ngày bắt đầu được dùng phép: HĐLĐ chính thức (HD02/HD03) sớm nhất; null = dùng được (NV cũ chưa nhập HĐ vào app); false = đang thử việc, chưa có HĐ chính thức
async function leaveUsableFrom(db, empId) {
  const e = await db.one(`SELECT state, (SELECT min(from_on) FROM hr_contract c WHERE c.emp_id = $1 AND c.kind IN ('HD02','HD03')) off, EXISTS (SELECT 1 FROM hr_contract c WHERE c.emp_id = $1 AND c.kind = 'HD01') tv FROM hr_employee WHERE id = $1`, [empId]);
  if (!e) return null; if (e.off) return e.off; return e.state === 'thu_viec' || e.tv ? false : null;
}
// mốc tính phép: ngày ký HĐ thử việc (sớm nhất); chưa có HĐ thử việc trong app → ngày vào làm; lấy ngày sớm hơn
const LEAVE_BASE = "least(join_on, (SELECT min(coalesce(c.sign_on, c.from_on)) FROM hr_contract c WHERE c.emp_id = hr_employee.id AND c.kind = 'HD01'))";
async function syncLeave(db, year, empId = null, asOf = today()) {
  const es = await db.q(`SELECT id, ${LEAVE_BASE} AS join_on, leave_on FROM hr_employee WHERE ($2::int IS NULL OR id = $2) AND (state <> 'da_nghi' OR leave_on >= $1::date) AND (join_on IS NULL OR join_on <= $3::date)`, [`${year}-01-01`, empId, `${year}-12-31`]);
  for (const e of es) await db.q('INSERT INTO hr_leave_bal (emp_id, year, opening, earned, adjust, used_before) VALUES ($1,$2,0,$3,0,0) ON CONFLICT (emp_id, year) DO UPDATE SET earned = EXCLUDED.earned WHERE hr_leave_bal.earned IS DISTINCT FROM EXCLUDED.earned', [e.id, +year, leaveEarned(e.join_on, e.leave_on, year, asOf)]);
}

// ---------- tổng hợp công tháng: nguồn duy nhất cho CC12, TL01, lương ----------
async function monthAtt(db, month, where = '', params = []) {
  const types = Object.fromEntries((await db.q('SELECT code, days, unpaid, grp FROM hr_att_type')).map(t => [t.code, t]));
  const rows = await db.q(`SELECT a.emp_id, a.day, a.mark, a.in_t, a.out_t, a.source, a.outside FROM hr_attendance a JOIN hr_employee e ON e.id = a.emp_id WHERE to_char(a.day,'YYYY-MM') = $1 AND (e.join_on IS NULL OR a.day >= e.join_on) AND (e.leave_on IS NULL OR a.day <= e.leave_on) ${where} ORDER BY a.day`, [month, ...params]);   // chỉ công trong thời gian làm việc (sau ngày nghỉ việc không tính)
  const by = {};
  for (const r of rows) {
    const x = by[r.emp_id] ||= { days: {}, out: {}, work: 0, paid_leave: 0, unpaid: 0, miss: 0 }, t = types[r.mark];
    x.days[+r.day.slice(8)] = r.mark;
    if (r.outside) x.out[+r.day.slice(8)] = r.outside;   // giờ chấm ngoài vùng
    if (['XI', 'XO', 'XX'].includes(r.mark)) x.miss++;
    else if (t) {
      const d = +t.days || 0, lv = t.unpaid || /nghỉ phép|lễ|việc riêng|tai nạn/i.test(t.grp || '');
      if (t.unpaid) x.unpaid += d; else if (lv) x.paid_leave += d; else x.work += d;
      if (lv && /\/2$/.test(r.mark)) x.work += 0.5;   // nghỉ nửa ngày (P/2, K/2…): nửa còn lại đi làm
    }
  }
  return by;
}
const attTypes = async db => Object.fromEntries((await db.q('SELECT code, days, unpaid, grp FROM hr_att_type')).map(t => [t.code, t]));
// công hưởng lương của 1 ký hiệu trong 1 ngày (như monthAtt)
const creditOf = (types, mk) => { const t = types[mk]; if (!t || ['XI', 'XO', 'XX'].includes(mk)) return 0; const lv = t.unpaid || /nghỉ phép|lễ|việc riêng|tai nạn/i.test(t.grp || ''); return (t.unpaid ? 0 : +t.days || 0) + (lv && /\/2$/.test(mk) ? 0.5 : 0); };
// tháng chuyển thử việc → chính thức (HĐ chính thức hiệu lực sau ngày 1): số công hưởng lương tính từ ngày HĐ chính thức.
// Đủ 14 công chính thức mới đóng BH tháng đó; chưa có dữ liệu công thì đếm ngày làm việc theo lịch
const BH_MIN_DAYS = 14;
async function officialDays(db, month, legalId) {
  const first = month + '-01', ld = lastDay(month);
  const rows = await db.q(`SELECT c.emp_id, min(c.from_on)::text AS o_from FROM hr_contract c JOIN hr_employee e ON e.id = c.emp_id WHERE e.legal_id = $1 AND c.kind IN ('HD02','HD03') AND c.from_on > $2 AND c.from_on <= $3
    AND EXISTS (SELECT 1 FROM hr_contract t WHERE t.emp_id = c.emp_id AND t.kind = 'HD01' AND t.from_on < c.from_on) GROUP BY 1`, [legalId, first, ld]);
  if (!rows.length) return {};
  const att = await monthAtt(db, month, 'AND e.legal_id = $2', [legalId]), hol = await holidays(db), types = await attTypes(db);
  return Object.fromEntries(rows.map(r => {
    const a = att[r.emp_id], days = monthsOf(r.o_from, ld);
    const n = a ? Object.entries(a.days).reduce((s, [d, mk]) => s + (`${month}-${String(d).padStart(2, '0')}` >= r.o_from ? creditOf(types, mk) : 0), 0) + days.filter(d => hol.has(d) && new Date(d + 'T00:00:00Z').getUTCDay() !== 0 && !a.days[+d.slice(8)]).length
      : days.filter(d => isWorkday(d, hol)).length;
    return [r.emp_id, { from: r.o_from, n }];
  }));
}

// ---------- lương: công thức theo ảnh Bảng tính tiền lương T09/2026 (TL02) ----------
// Tổng lương phải trả = P1 + P2 thực nhận + ăn ca + tăng ca + công tác phí + thưởng; chịu thuế = P1 + P2 + (tăng ca − phần miễn thuế) + thưởng (ăn ca, công tác phí không chịu thuế)
// Thực lĩnh = tổng lương phải trả − (BH NLĐ + thuế TNCN + điều chỉnh thuế + tạm ứng + khấu trừ khác); công ty đóng BHXH/BHYT/BHTN + KPCĐ 2% trên mức đóng BH
const PAY_EDIT = ['kpi', 'trip_pay', 'bonus', 'bday', 'leave_pay', 'advance', 'tax_adj', 'other_ded', 'gl'];
function taxOf(income, brackets) { let tax = 0, low = 0; for (const [top, pct] of brackets) { const hi = top ?? Infinity; if (income <= low) break; tax += (Math.min(income, hi) - low) * pct / 100; low = hi; } return Math.round(tax); }
function payLine(l, cfg, ins, std) {
  const x = { ...l }, r = v => Math.round(v), v = k => +x[k] || 0;
  const trialPct = (x.trial_pct ?? cfg.trial_pct) / 100, eq = v('d100') + v('d85') * trialPct;
  const kpi = (x.kpi ?? 100) / 100;
  x.coef = std ? Math.round((v('d100') + v('d85')) / std * 100) / 100 : 0;
  x.p1_net = r(v('p1') * eq / std); x.p2_net = r(v('p2') * eq / std * kpi);
  x.meal = x.meal_override ?? r(v('worked') * cfg.meal_day);
  x.gross_base = x.p1_net + x.p2_net;
  const extra = v('bonus') + v('bday') + v('leave_pay') + v('allow');   // allow: phụ cấp theo QĐ bổ nhiệm (phụ cấp kế toán…)
  x.total = x.gross_base + x.meal + v('ot_pay') + v('trip_pay') + extra;
  const base = v('ins_base');
  x.e_bhxh = r(base * ins.nld_bhxh / 100); x.e_bhyt = r(base * ins.nld_bhyt / 100); x.e_bhtn = r(base * ins.nld_bhtn / 100); x.e_ins = x.e_bhxh + x.e_bhyt + x.e_bhtn;
  x.deduct = cfg.ded_self + v('n_dep') * cfg.ded_dep;
  x.ot_free = Math.min(v('ot_free'), v('ot_pay'));
  x.taxable = x.gross_base + v('ot_pay') - x.ot_free + extra;
  x.tax_base = Math.max(x.taxable - x.e_ins - x.deduct, 0);
  x.tax = taxOf(x.tax_base, cfg.tax);
  for (const k of ['tax_adj', 'advance', 'other_ded']) x[k] = v(k);
  x.all_ded = x.e_ins + x.tax + x.tax_adj + x.advance + x.other_ded;
  x.net = x.total - x.all_ded;
  x.c_bhxh = r(base * ins.dn_bhxh / 100); x.c_bhyt = r(base * ins.dn_bhyt / 100); x.c_bhtn = r(base * ins.dn_bhtn / 100);
  x.c_kpcd = r(base * (x.kpcd_pct ?? 2) / 100);
  x.ins_all = x.e_ins + x.c_bhxh + x.c_bhyt + x.c_bhtn; x.ins_cd_all = x.ins_all + x.c_kpcd;
  x.gl = x.gl || cfg.gl || '6421';
  return x;
}
async function calcPayroll(db, r) {
  const cfg = await setting('pay'), ins = await setting('ins'), cd = await setting('cd'), std = +r.std_days || cfg.std_days, m = r.month;
  const old = Object.fromEntries((r.lines || []).map(l => [l.emp_id, l]));
  // ckind: HĐ đang hiệu lực đã đến ngày hiệu lực trong kỳ; t_from: HĐ thử việc gần nhất; o_from: HĐ chính thức đầu tiên sau thử việc (tách 85% / 100% theo ngày)
  const emps = await db.q(`SELECT e.*, d.name AS dept, (SELECT c.kind FROM hr_contract c WHERE c.emp_id = e.id AND c.state = 'hieu_luc' AND c.kind <> 'HD04' AND c.from_on <= $2 ORDER BY c.from_on DESC LIMIT 1) AS ckind,
    (SELECT c.trial_pct FROM hr_contract c WHERE c.emp_id = e.id AND c.kind = 'HD01' ORDER BY c.from_on DESC LIMIT 1) AS tp, t.t_from, o.o_from
    FROM hr_employee e LEFT JOIN hr_dept d ON d.id = e.dept_id
    LEFT JOIN LATERAL (SELECT c.from_on AS t_from FROM hr_contract c WHERE c.emp_id = e.id AND c.kind = 'HD01' AND c.from_on <= $2 ORDER BY c.from_on DESC LIMIT 1) t ON true
    LEFT JOIN LATERAL (SELECT min(c.from_on)::text AS o_from FROM hr_contract c WHERE c.emp_id = e.id AND c.kind IN ('HD02','HD03') AND c.from_on > t.t_from) o ON true
    WHERE e.legal_id = $1 AND e.join_on <= $2 AND (e.leave_on IS NULL OR e.leave_on >= $3) ORDER BY (e.code !~ '^[A-Za-z]+[0-9]+$'), e.code`, [r.legal_id, lastDay(m), m + '-01']);
  const att = await monthAtt(db, m, 'AND e.legal_id = $2', [r.legal_id]), hol = await holidays(db);
  const types = await attTypes(db), credit = mk => creditOf(types, mk), offi = await officialDays(db, m, r.legal_id);
  const ots = Object.fromEntries((await db.q(`SELECT emp_id, sum(hours_ok) FILTER (WHERE day_kind='thuong') h1, sum(hours_ok) FILTER (WHERE day_kind='nghi') h2, sum(hours_ok) FILTER (WHERE day_kind='le') h3 FROM hr_ot WHERE status='da_duyet' AND to_char(day,'YYYY-MM')=$1 GROUP BY 1`, [m])).map(o => [o.emp_id, o]));
  // phép năm còn lại không chuyển sang năm sau mà quy đổi thành tiền: trả ở lương tháng 12, hoặc tháng nghỉ việc nếu nghỉ giữa năm
  // tiền 1 ngày phép = (P1 + P2) / công chuẩn; còn lại ≤ 0 thì không trả, không trừ
  const y = m.slice(0, 4), payOut = e => m.endsWith('-12') || (e.leave_on && e.leave_on.slice(0, 7) === m);
  if (emps.some(payOut)) await syncLeave(db, y, null, lastDay(m));   // phép được hưởng tính đến hết tháng trả
  const bal = Object.fromEntries((await db.q(`SELECT b.emp_id, b.opening + b.earned + b.adjust - coalesce(b.used_before,0) - coalesce((SELECT sum(l.days) FROM hr_leave l WHERE l.emp_id = b.emp_id AND l.status = 'da_duyet' AND l.type_code IN ('P','P/2','P>1') AND to_char(l.from_on,'YYYY') = $1),0) AS left
    FROM hr_leave_bal b WHERE b.year = $2`, [y, +y])).map(b => [b.emp_id, Math.max(+b.left || 0, 0)]));
  const alw = Object.fromEntries((await db.q("SELECT code, amount FROM hr_allowance WHERE state = 'on'")).map(x => [x.code, +x.amount || 0])), allowOf = e => (e.allows || []).reduce((s, x) => s + (alw[x.code] || 0), 0);
  const lines = emps.map(e => {
    const a = att[e.id] || { work: 0, paid_leave: 0, days: {} }, o = ots[e.id] || {}, prev = old[e.id] || {};
    const leave_days = payOut(e) ? bal[e.id] || 0 : 0, leave_auto = Math.round(leave_days * ((+e.pay_p1 || 0) + (+e.pay_p2 || 0)) / std);
    const manualLeave = prev.leave_pay != null && 'leave_auto' in prev && +prev.leave_pay !== +prev.leave_auto;   // HCNS đã sửa tay thì giữ số đã sửa
    // ngày lễ (trừ Chủ nhật) trong thời gian làm việc, chưa có ký hiệu công → tính công hưởng lương
    const holi = monthsOf(m + '-01', lastDay(m)).filter(d => hol.has(d) && new Date(d + 'T00:00:00Z').getUTCDay() !== 0 && (!e.join_on || d >= e.join_on) && (!e.leave_on || d <= e.leave_on) && !a.days?.[+d.slice(8)]).length;
    const paidDays = a.work + a.paid_leave + holi, first = m + '-01';
    // tháng chuyển thử việc → chính thức: ngày trước HĐ chính thức tính % thử việc, từ ngày HĐ chính thức tính 100%
    const split = e.t_from && e.o_from && e.o_from > first && e.o_from <= lastDay(m) ? e.o_from : null;
    const trial = split ? false : e.t_from && e.o_from ? e.o_from > lastDay(m) : e.ckind === 'HD01';
    const d85 = split ? Object.entries(a.days || {}).reduce((s, [d, mk]) => s + (`${m}-${String(d).padStart(2, '0')}` < split ? credit(mk) : 0), 0)
      + monthsOf(first, addDays(split, -1)).filter(d => hol.has(d) && new Date(d + 'T00:00:00Z').getUTCDay() !== 0 && (!e.join_on || d >= e.join_on) && !a.days?.[+d.slice(8)]).length : trial ? paidDays : 0;
    const p1 = +e.pay_p1 || 0, hourly = (p1 + (+e.pay_p2 || 0)) / std / 8, h = k => +o[k] || 0;
    const ot_pay = Math.round((h('h1') * 1.5 + h('h2') * 2 + h('h3') * 3) * hourly), ot_free = Math.round((h('h1') * 0.5 + h('h2') * 1 + h('h3') * 2) * hourly);
    return payLine({ emp_id: e.id, code: e.code, name: e.full_name, dept_id: e.dept_id, dept: e.dept, title: e.title, bank: e.bank, acct: e.bank_acct, worked: a.work, holi, d100: Math.max(paidDays - d85, 0), d85, trial_pct: +(e.tp ?? cfg.trial_pct) * (+(e.tp ?? cfg.trial_pct) <= 1 ? 100 : 1), p1, p2: +e.pay_p2 || 0, allow: allowOf(e), kpi: prev.kpi ?? 100,
      ot_pay, ot_free, ot_h: h('h1') + h('h2') + h('h3'), ...Object.fromEntries(PAY_EDIT.filter(k => k !== 'kpi' && k !== 'leave_pay' && prev[k] != null).map(k => [k, prev[k]])),
      leave_days, leave_auto, leave_pay: manualLeave ? prev.leave_pay : leave_auto || (prev.leave_pay != null && !('leave_auto' in prev) ? prev.leave_pay : 0),
      ins_base: trial || (offi[e.id] && offi[e.id].n < BH_MIN_DAYS) ? 0 : (+e.ins_salary || +e.pay_p1 || 0), n_dep: (e.dependents || []).filter(d => { const f = C.isoMonth(d.from_m || ''), t = C.isoMonth(d.to_m || ''); return (!f || f <= m) && (!t || t >= m); }).length, kpcd_pct: cd.kpcd, no_att: !att[e.id], no_pay: !p1 }, cfg, ins, std);   // n_dep: giảm trừ từ tháng … đến tháng (mm/yyyy)
  });
  const net = lines.reduce((s, l) => s + l.net, 0);
  await db.q('UPDATE hr_payroll SET lines = $1, n_emp = $2, net_total = $3, std_days = $4 WHERE id = $5', [JSON.stringify(lines), lines.length, net, std, r.id]);
}
const editPayLine = async (db, r, empId, patch) => {
  if (['cho_duyet', 'da_duyet', 'da_chuyen'].includes(r.status)) bad('Bảng lương đã khóa — không sửa được');
  const cfg = await setting('pay'), ins = await setting('ins');
  const lines = r.lines.map(l => l.emp_id !== empId ? l : payLine({ ...l, ...Object.fromEntries(PAY_EDIT.filter(k => k in patch).map(k => [k, k === 'gl' ? String(patch[k] || '').trim() : +patch[k] || 0])) }, cfg, ins, +r.std_days));
  await db.q('UPDATE hr_payroll SET lines = $1, net_total = $2 WHERE id = $3', [JSON.stringify(lines), lines.reduce((s, l) => s + l.net, 0), r.id]);
};

// ---------- bảo hiểm & công đoàn: tăng/giảm tự so với tháng trước ----------
// một dòng theo file «Trích nộp BHXH»: DN nộp · NLĐ nộp · tổng số phải nộp theo loại · số được giữ lại tại công ty
function insRow(l, rt) {
  const s = +l.salary || 0, p = k => s * (+rt[k] || 0) / 100, o = {};
  for (const k of ['dn_bhxh', 'dn_bhyt', 'dn_bhtn', 'nld_bhxh', 'nld_bhyt', 'nld_bhtn', 'giu_bhxh', 'giu_bhyt', 'giu_bhtn']) o[k] = p(k);
  o.dn = o.dn_bhxh + o.dn_bhyt + o.dn_bhtn; o.nld = o.nld_bhxh + o.nld_bhyt + o.nld_bhtn;
  o.t_bhxh = o.dn_bhxh + o.nld_bhxh; o.t_bhyt = o.dn_bhyt + o.nld_bhyt; o.t_bhtn = o.dn_bhtn + o.nld_bhtn; o.total = o.dn + o.nld;
  o.note = [...new Set([l.change, l.need_data ? 'Cần cập nhật mức đóng' : '', l.note].filter(Boolean))].join(' · ');
  return o;
}
// một dòng theo file «Trích nộp KPCĐ + ĐPCĐ»: KPCĐ công ty 2% (nhận 75% / nộp 25%), ĐPCĐ NLĐ 0,5% (giữ 70% / nộp 30%)
function cdRow(l, rt) {
  const s = +l.salary || 0, kp = s * rt.kpcd / 100, dp = l.member === false ? 0 : s * rt.dpcd / 100;
  const o = { kp, dp, kp_giu: kp * rt.kpcd_giu / 100, kp_nop: kp * rt.kpcd_nop / 100, dp_giu: dp * rt.dpcd_giu / 100, dp_nop: dp * rt.dpcd_nop / 100 };
  o.nop = o.kp_nop + o.dp_nop; o.giu = o.kp_giu + o.dp_giu; o.year = dp * 12;
  o.note = [...new Set([l.change, l.need_data ? 'Cần cập nhật mức đóng' : '', l.member === false ? 'Không phải đoàn viên' : '', l.note].filter(Boolean))].join(' · ');
  return o;
}
const insDueTotal = r => (+r.due || 0) + (+r.late_prev || 0) + (+r.late_cur || 0) + (+r.arrears || 0) + (+r.short_prev || 0) - (+r.keep2 || 0);
function insTotals(lines, rt) {
  const sum = lines.reduce((s, l) => s + (+l.salary || 0), 0), pct = rt.dn_bhxh + rt.dn_bhyt + rt.dn_bhtn + rt.nld_bhxh + rt.nld_bhyt + rt.nld_bhtn;
  return { n: lines.filter(l => +l.salary > 0).length, base: sum, dn: sum * (rt.dn_bhxh + rt.dn_bhyt + rt.dn_bhtn) / 100, nld: sum * (rt.nld_bhxh + rt.nld_bhyt + rt.nld_bhtn) / 100, due: Math.round(sum * pct / 100) };
}
const staffFor = async (db, legalId, month, cond = '') => db.q(`SELECT e.* FROM hr_employee e WHERE e.legal_id = $1 AND e.join_on <= $2 AND (e.leave_on IS NULL OR e.leave_on >= $3) ${cond} ORDER BY (e.code !~ '^[A-Za-z]+[0-9]+$'), e.code`, [legalId, lastDay(month), month + '-01']);
function diffLines(cur, prev, key = 'emp_id') {
  if (!prev) return cur;
  const p = Object.fromEntries(prev.lines.map(l => [l[key], l])), c = new Set(cur.map(l => l[key]));
  for (const l of cur) { const o = p[l[key]]; l.change = !o ? 'Tăng mới' : +o.salary !== +l.salary ? `Điều chỉnh (${(+o.salary).toLocaleString('vi-VN')} → ${(+l.salary).toLocaleString('vi-VN')})` : ''; }
  return [...cur, ...prev.lines.filter(l => !c.has(l[key]) && +l.salary > 0).map(l => ({ ...l, salary: 0, change: 'Báo giảm' }))];
}
// người phải đóng BH / CĐ trong tháng: mức đóng = mức trên hồ sơ (đã theo QĐ điều chỉnh lương gần nhất), chưa có thì lương trên HĐLĐ;
// đủ 14 công (làm việc + nghỉ hưởng lương) mới đóng — nghỉ không lương cả tháng không đóng; tháng chưa có dữ liệu công thì chưa loại
async function insStaff(db, r) {
  const emps = await staffFor(db, r.legal_id, r.month, "AND e.state NOT IN ('da_nghi')");
  // thử việc theo HĐ đã có hiệu lực trong kỳ (HĐ ký trước, hiệu lực sau không tính sớm; HĐ chính thức hiệu lực trong kỳ → đóng BH nếu đủ 14 công chính thức)
  const ld = lastDay(r.month);
  const trialIds = new Set((await db.q("SELECT emp_id FROM (SELECT DISTINCT ON (emp_id) emp_id, kind FROM hr_contract WHERE kind <> 'HD04' AND state IN ('hieu_luc','cho_quyet_dinh') AND from_on <= $1 ORDER BY emp_id, from_on DESC, id DESC) x WHERE kind = 'HD01'", [ld])).map(x => x.emp_id));
  const hd = Object.fromEntries((await db.q("SELECT DISTINCT ON (emp_id) emp_id, salary FROM hr_contract WHERE state = 'hieu_luc' AND kind <> 'HD01' AND salary > 0 AND from_on <= $1 ORDER BY emp_id, from_on DESC", [ld])).map(c => [c.emp_id, +c.salary]));
  const att = await monthAtt(db, r.month, 'AND e.legal_id = $2', [r.legal_id]), hasAtt = Object.keys(att).length > 0, offi = await officialDays(db, r.month, r.legal_id);
  return emps.filter(e => !trialIds.has(e.id)).map(e => {
    const salary = +e.ins_salary || +e.pay_p1 || hd[e.id] || 0, a = att[e.id], days = a ? a.work + a.paid_leave : 0, o = offi[e.id];   // mức đóng BH: theo hồ sơ, chưa nhập thì mặc định = lương P1
    const off = ['thai_san', 'nghi_kl'].includes(e.state) ? 'Tạm dừng (thai sản / nghỉ không lương)' : hasAtt && days < BH_MIN_DAYS ? `Dưới ${BH_MIN_DAYS} công (${days}) — không đóng`
      : o && o.n < BH_MIN_DAYS ? `Chính thức từ ${o.from.split('-').reverse().join('/')}: ${o.n} công chính thức (dưới ${BH_MIN_DAYS}) — đóng từ tháng sau` : '';
    return { e, salary: off ? 0 : salary, need_data: !salary, note: off };
  });
}
async function calcIns(db, r) {
  const rt = (await db.one('SELECT rates FROM hr_ins_sheet WHERE id = $1', [r.id])).rates || await setting('ins');
  const prev = await db.one('SELECT lines FROM hr_ins_sheet WHERE legal_id = $1 AND month < $2 ORDER BY month DESC LIMIT 1', [r.legal_id, r.month]);   // so với bảng gần nhất trước đó (tháng liền trước chưa lập vẫn ra tăng / giảm)
  const lines = diffLines((await insStaff(db, r)).map(({ e, salary, need_data, note }) => ({ emp_id: e.id, code: e.code, name: e.full_name, ins_no: e.ins_no, title: e.title, salary, need_data, note })), prev);
  const t = insTotals(lines.filter(l => l.change !== 'Báo giảm'), rt);
  await db.q('UPDATE hr_ins_sheet SET lines = $1, rates = $2, n_emp = $3, base_total = $4, due = $5, total_due = $5 + coalesce(late_prev,0) + coalesce(late_cur,0) + coalesce(arrears,0) + coalesce(short_prev,0) - coalesce(keep2,0) WHERE id = $6', [JSON.stringify(lines), JSON.stringify(rt), t.n, t.base, t.due, r.id]);
}
function cdTotals(lines, rt) {
  const on = lines.filter(l => l.change !== 'Báo giảm'), base = on.reduce((s, l) => s + (+l.salary || 0), 0);
  const memberBase = on.filter(l => l.member !== false).reduce((s, l) => s + (+l.salary || 0), 0), kp = base * rt.kpcd / 100, dp = memberBase * rt.dpcd / 100;
  const due = kp * rt.kpcd_nop / 100 + dp * rt.dpcd_nop / 100, kept = kp * rt.kpcd_giu / 100 + dp * rt.dpcd_giu / 100;
  return { n: on.filter(l => +l.salary > 0).length, base, kp, dp, due, kept };
}
async function calcCd(db, r) {
  const rt = (await db.one('SELECT rates FROM hr_cd_sheet WHERE id = $1', [r.id])).rates || await setting('cd');
  const prev = await db.one('SELECT lines FROM hr_cd_sheet WHERE legal_id = $1 AND month < $2 ORDER BY month DESC LIMIT 1', [r.legal_id, r.month]);
  const lines = diffLines((await insStaff(db, r)).map(({ e, salary, need_data, note }) => ({ emp_id: e.id, code: e.code, name: e.full_name, salary, member: !!e.union_member, need_data, note })), prev);
  const t = cdTotals(lines, rt);
  await db.q('UPDATE hr_cd_sheet SET lines = $1, rates = $2, n_emp = $3, base_total = $4, due = $5, kept = $6 WHERE id = $7', [JSON.stringify(lines), JSON.stringify(rt), t.n, t.base, Math.round(t.due), Math.round(t.kept), r.id]);
}

// đăng ký suất ăn tháng m chép từ tháng trước: giữ các thứ trong tuần từng người hay ăn, bỏ Chủ nhật / lễ; người nghỉ việc, người đã có đăng ký tháng m bỏ qua
async function mealCopy(u, m, lg = null, from = null) {   // from: chỉ chép các ngày từ ngày này trở đi (việc nền: từ hôm nay — không đăng ký hộ ngày đã qua)
  const pm = prevMonth(m), hol = await holidays({ q }), out = { ok: 0, skip: 0, err: [] };
  const dows = d => new Date(d + 'T00:00:00Z').getUTCDay(), days = Array.from({ length: +lastDay(m).slice(8) }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`).filter(d => isWorkday(d, hol) && (!from || d >= from));
  for (const r2 of await q(`SELECT r.* FROM hr_meal_reg r JOIN hr_employee e ON e.id = r.emp_id AND e.state <> 'da_nghi' WHERE r.month = $1 ${lg ? 'AND r.legal_id = $2' : ''}`, lg ? [pm, lg] : [pm])) {
    if (await one('SELECT 1 x FROM hr_meal_reg WHERE emp_id = $1 AND month = $2', [r2.emp_id, m])) { out.skip++; continue; }
    const w = new Set((r2.days || []).map(d => dows(`${pm}-${String(d).padStart(2, '0')}`))); if (!w.size) continue;
    try { await C.create('meal_reg', { legal_id: r2.legal_id, emp_id: r2.emp_id, dept_id: r2.dept_id, month: m, days: days.filter(d => w.has(dows(d))).map(d => +d.slice(8)) }, u, { imp: 1 }); out.ok++; } catch (er) { out.err.push(er.message); }
  }
  return out;
}
module.exports = { mealCopy, H, n, lastDay, nextMonth, prevMonth, monthAtt, vppStock, setMark, assertOpen, calcPayroll, calcIns, calcCd, insStaff, officialDays, editPayLine, insTotals, cdTotals, insRow, cdRow, insDueTotal, payLine, PAY_EDIT, taxOf, leaveUsed, leaveLeft, leaveEarned, syncLeave, autoLeaveList, autoLeaveMake, cultureOn, cultureFits, cultureRoster, isWorkday, holidays, hoursBetween, applyDue };
