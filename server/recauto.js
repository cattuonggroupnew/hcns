// Tự động hóa tuyển dụng — chuỗi việc chạy nền (jobs.js gọi) và các móc nối sau từng bước:
//  1) Ngày 25: so định biên với nhân sự từng bộ phận (trừ người sắp nghỉ, cộng kế hoạch đang mở) → nháp kế hoạch tuyển tháng sau, báo TP HCNS duyệt
//  2) Duyệt kế hoạch → tự soạn tin tuyển dụng + lịch đăng theo kênh; đến ngày đăng nhắc HCNS (đăng tự động cần kết nối API từng kênh)
//  3) CV mới gắn kế hoạch → tự chấm điểm theo trình độ / kinh nghiệm / từ khóa → đạt / không đạt
//  4) CV đạt → tự đề xuất lịch phỏng vấn (nháp), báo CV HCNS chốt; chốt → báo trưởng BP + gửi thư mời
//  5) Phỏng vấn đạt → tự lập tờ trình nháp; tờ trình duyệt → lương thỏa thuận, checklist tiếp nhận, thư mời nhận việc
//  6) Trước ngày nhận việc 3 ngày → tự tạo hồ sơ NV + HĐ thử việc + khóa hội nhập + tài khoản app; nhắc việc checklist quá hạn
const crypto = require('crypto');
const { q, one, tx } = require('./db');
const C = require('./core');
const { SYS, today, addDays } = C;
const B = () => require('./biz');
const dbx = { q, one };
const dmy = C.dmy, mm = m => `${m.slice(5)}/${m.slice(0, 4)}`;
const lastOf = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
const nextMonth = m => { const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 1)); return d.toISOString().slice(0, 7); };
const low = s => String(s || '').normalize('NFC').toLowerCase().trim();
const tpHcns = async db => (await db.q("SELECT id FROM hr_user WHERE active AND role = 'tp_hcns'")).map(u => u.id);
const nsOf = async (db, ent, rec) => (await C.approversOf(db, C.E[ent], rec, { roles: ['cv_hcns', 'tp_hcns'] })).map(u => u.id);   // NV HCNS phụ trách pháp nhân của bản ghi

// ---------- 1) ngày 25: đề xuất kế hoạch tuyển dụng tháng sau theo định biên ----------
async function recDraft(db, m) {   // m: tháng cần tuyển (YYYY-MM)
  const end = lastOf(m), y = m.slice(0, 4), out = [];
  const hc = await db.q("SELECT h.*, d.name dept FROM hr_headcount h JOIN hr_dept d ON d.id = h.dept_id WHERE coalesce(h.qty, 0) > 0 AND (h.period IS NULL OR h.period = '' OR h.period LIKE '%' || $1 || '%' OR h.period = 'year')", [y]);
  for (const h of hc) {
    const byTitle = !!(h.title || '').trim(), tw = byTitle ? ' AND lower(e.title) = lower($2)' : '', pr = byTitle ? [h.dept_id, h.title.trim()] : [h.dept_id];
    const staff = +(await db.one(`SELECT count(*) n FROM hr_employee e WHERE e.dept_id = $1 AND e.state <> 'da_nghi'${tw}`, pr)).n;
    const leaving = +(await db.one(`SELECT count(*) n FROM hr_employee e WHERE e.dept_id = $1 AND e.state <> 'da_nghi'${tw} AND (e.leave_on <= $${pr.length + 1} OR EXISTS (SELECT 1 FROM hr_resign r WHERE r.emp_id = e.id AND r.status = 'da_duyet' AND r.last_day <= $${pr.length + 1}))`, [...pr, end]).catch(() => ({ n: 0 }))).n;
    const open = await db.q(`SELECT p.qty, (SELECT count(*) FROM hr_candidate c WHERE c.plan_id = p.id AND c.status IN ('S53','S60')) got FROM hr_rec_plan p WHERE p.dept_id = $1 AND p.rec_state IN ('de_xuat','chua_mo','dang_tuyen')${byTitle ? ' AND lower(p.position) = lower($2)' : ''}`, pr);
    const opening = open.reduce((s, p) => s + Math.max(0, +p.qty - +p.got), 0), gap = +h.qty - (staff - leaving) - opening;
    if (gap <= 0) continue;
    const pos = byTitle ? h.title.trim() : `Nhân sự ${h.dept}`;
    const r = await C.create('rec_plan', { legal_id: h.legal_id, dept_id: h.dept_id, period: `Tháng ${mm(m)}`, position: pos, qty: gap, channel: 'TopCV, Facebook, Website công ty', req_on: today(), due_on: end, rec_state: 'de_xuat', pass_score: 50,
      auto_note: `Tự đề xuất ngày ${dmy(today())}: định biên ${h.qty}${byTitle ? ` (${h.title})` : ''} · hiện có ${staff} · sắp nghỉ đến ${dmy(end)}: ${leaving} · đang tuyển chưa đủ: ${opening} → cần tuyển ${gap}` }, SYS, { db, system: true });
    out.push(`${pos} (${h.dept}): ${gap}`);
  }
  if (out.length) await C.notify(db, await tpHcns(db), `Đề xuất kế hoạch tuyển dụng tháng ${mm(m)} — ${out.length} vị trí`, out.join(' · ') + ' — xem, chỉnh tiêu chí rồi bấm «Duyệt kế hoạch & mở tuyển»', 'e/rec_plan');
  return out.length;
}

// ---------- 2) tin tuyển dụng + lịch đăng ----------
const DEG = { khong: 'Không yêu cầu', trung_cap: 'Trung cấp', cao_dang: 'Cao đẳng', dai_hoc: 'Đại học', thac_si: 'Thạc sĩ' };
async function campaign(db, p) {
  const L = p.legal_id && await db.one('SELECT name, short, address, phone FROM hr_legal WHERE id = $1', [p.legal_id]), D = p.dept_id && await db.one('SELECT name FROM hr_dept WHERE id = $1', [p.dept_id]);
  const req = [p.min_degree && p.min_degree !== 'khong' && `Tốt nghiệp ${DEG[p.min_degree]} trở lên`, +p.min_exp > 0 && `Có từ ${+p.min_exp} năm kinh nghiệm ở vị trí tương đương`, p.keywords && `Thành thạo / có kiến thức: ${p.keywords}`].filter(Boolean);
  const text = [`[TUYỂN DỤNG] ${String(p.position).toUpperCase()}${D ? ' – ' + D.name : ''}`,
    `${L?.name || 'Công ty'} tuyển ${p.qty} ${p.position}${L?.address ? `, làm việc tại ${L.address}` : ''}.`, '',
    p.criteria ? `▸ Mô tả công việc / tiêu chí:\n${p.criteria}` : null,
    req.length ? `▸ Yêu cầu:\n${req.map(x => '- ' + x).join('\n')}` : null,
    `▸ Quyền lợi:\n- Mức lương: ${p.salary || 'thỏa thuận theo năng lực'}\n- Đóng BHXH, BHYT đầy đủ; 12 ngày phép năm; thưởng lễ, Tết\n- Môi trường chuyên nghiệp, được đào tạo hội nhập`,
    `▸ Hạn nộp hồ sơ: ${dmy(p.due_on)}`, `▸ Liên hệ / nộp CV: Phòng Hành chính Nhân sự${L?.phone ? ' – ĐT ' + L.phone : ''}`].filter(x => x != null).join('\n');
  const ch = String(p.channel || 'TopCV, Facebook, Website công ty').split(',').map(x => x.trim()).filter(x => x && x !== 'Giới thiệu nội bộ' && x !== 'Headhunt');
  const t = today(), endOn = p.due_on && p.due_on > t ? p.due_on : addDays(t, 30);
  const posts = [...ch.map(c => ({ channel: c, post_on: dmy(t), end_on: dmy(endOn), state: 'Chờ đăng', link: '' })), ...(ch.includes('Facebook') ? [{ channel: 'Facebook', post_on: dmy(addDays(t, 7)), end_on: dmy(endOn), state: 'Chờ đăng', link: '(đăng lại)' }] : [])];
  return { post_text: text, posts };
}

// ---------- 3) sàng lọc CV ----------
const degLv = s => { s = low(s); return /thạc sĩ|tiến sĩ|master|mba/.test(s) ? 4 : /đại học|cử nhân|kỹ sư|bachelor|university/.test(s) ? 3 : /cao đẳng|college/.test(s) ? 2 : /trung cấp/.test(s) ? 1 : 0; };
const DLV = { trung_cap: 1, cao_dang: 2, dai_hoc: 3, thac_si: 4 };
function expYears(c) {
  const ym = s => { s = low(s); if (/nay|hiện tại|present|now/.test(s)) return new Date().getFullYear() * 12 + new Date().getMonth(); const a = /(\d{1,2})\s*[\/.-]\s*(\d{4})/.exec(s); if (a) return +a[2] * 12 + +a[1] - 1; const b = /(\d{4})/.exec(s); return b ? +b[1] * 12 : null; };
  let mon = 0; for (const j of c.jobs || []) { const a = ym(j.from), b = ym(j.to || 'nay'); if (a != null && b != null && b >= a) mon += b - a + 1; }
  const t = Math.max(0, ...[...String(c.exp || '').matchAll(/(\d+(?:[.,]\d+)?)\s*năm/gi)].map(x => +x[1].replace(',', '.')));
  return Math.max(Math.round(mon / 12 * 10) / 10, t || 0);
}
function screen(c, p) {
  const text = low([c.exp, c.major, c.school, c.degree, c.skill, c.position, c.note, ...(c.jobs || []).flatMap(j => [j.company, j.title])].join(' '));
  const need = DLV[p.min_degree] || 0, has = Math.max(degLv(c.degree), degLv(c.edu)), yrs = expYears(c), minE = +p.min_exp || 0;
  const kws = String(p.keywords || '').split(',').map(low).filter(Boolean), hit = kws.filter(k => text.includes(k));
  const sDeg = !need ? 30 : has >= need ? 30 : has ? 10 : 0, sExp = !minE ? 30 : Math.min(30, Math.round(30 * yrs / minE)), sKw = !kws.length ? 40 : Math.round(40 * hit.length / kws.length);
  const score = sDeg + sExp + sKw, pass = score >= (+p.pass_score || 50);
  const note = [`Tự sàng lọc ${dmy(today())} theo kế hoạch: ${score}/100 → ${pass ? 'ĐẠT' : 'không đạt'} (ngưỡng ${+p.pass_score || 50})`,
    `• Trình độ: ${c.degree || c.edu || 'không rõ'}${need ? ` — yêu cầu ${DEG[p.min_degree]} ${has >= need ? '✓' : '✗'}` : ''} (${sDeg}/30)`,
    `• Kinh nghiệm: ${yrs} năm${minE ? ` — yêu cầu ${minE} năm` : ''} (${sExp}/30)`,
    `• Từ khóa: ${kws.length ? `${hit.length}/${kws.length}${hit.length ? ' (' + hit.join(', ') + ')' : ''}` : 'không đặt'} (${sKw}/40)`].join('\n');
  return { score, pass, note };
}
// gọi từ beforeSave ứng viên MỚI gắn kế hoạch (chưa chấm): ghi điểm, không đạt → «Hồ sơ không đạt»
async function screenNew(db, r) {
  if (!r.plan_id || r.screen_score != null || (r.status && r.status !== 'S12')) return;
  const p = await db.one('SELECT * FROM hr_rec_plan WHERE id = $1', [r.plan_id]); if (!p) return;
  const s = screen(r, p); r.screen_score = s.score; r.screen_note = s.note; if (!s.pass) r.status = 'S11';
}

// ---------- 4) đề xuất lịch phỏng vấn cho CV đạt ----------
async function proposeInterviews() {
  const cs = await q("SELECT c.id, c.code, c.full_name, c.plan_id, c.dept_id, c.legal_id FROM hr_candidate c WHERE c.status = 'S12' AND c.screen_score IS NOT NULL AND NOT EXISTS (SELECT 1 FROM hr_interview i WHERE i.status <> 'huy' AND i.lines @> jsonb_build_array(jsonb_build_object('code', c.code))) ORDER BY c.dept_id, c.id");
  if (!cs.length) return 0;
  const hol = await B().holidays(dbx); let day = addDays(today(), 2); while (!B().isWorkday(day, hol)) day = addDays(day, 1);   // báo trước ít nhất 2 ngày
  const hm = mins => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  let n = 0;
  for (const dept of [...new Set(cs.map(c => c.dept_id))]) {
    const xs = cs.filter(c => c.dept_id === dept);
    const ex = await one("SELECT * FROM hr_interview WHERE status = 'de_xuat' AND dept_id = $1 AND day >= $2 ORDER BY day LIMIT 1", [dept, today()]);   // đề xuất đang chờ chốt → thêm người vào
    const base = ex ? [...(ex.lines || [])] : [], t0 = 9 * 60;
    const lines = [...base, ...xs.map((c, i) => { const k = base.length + i; return { code: c.code, name: c.full_name, start: hm(t0 + k * 45), end: hm(t0 + (k + 1) * 45), result: '' }; })];
    const r = ex ? (await C.update('interview', ex.id, { lines, minutes: lines.length * 45 }, SYS, { system: true })).row
      : (await C.create('interview', { day, start_at: `${day}T09:00:00+07:00`, minutes: lines.length * 45, mode: 'truc_tiep', round: 'vong_pv', status: 'de_xuat', lines, note: 'Lịch tự đề xuất cho CV đạt sàng lọc — chọn phòng / hội đồng rồi bấm «Chốt lịch & gửi thư mời»' }, SYS, { system: true })).row;
    const to = await nsOf(dbx, 'interview', r), plan = xs[0].plan_id && await one('SELECT created_by FROM hr_rec_plan WHERE id = $1', [xs[0].plan_id]);
    await C.notify(dbx, [...to, plan?.created_by].filter(Boolean), `${xs.length} CV đạt — lịch phỏng vấn đề xuất ${dmy(r.day)}`, xs.map(c => c.full_name).join(', ') + ' — kiểm tra rồi bấm «Chốt lịch & gửi thư mời»', `e/interview/${r.id}`);
    n += xs.length;
  }
  return n;
}

// ---------- 5) sau phỏng vấn đạt / tờ trình duyệt ----------
async function afterPass(ctx, codes) {   // phỏng vấn đạt → tờ trình nháp + báo CV HCNS bổ sung lương, trình
  for (const code of codes) {
    const c = await ctx.db.one('SELECT * FROM hr_candidate WHERE code = $1', [code]); if (!c) continue;
    const x = await B().H.candidate.acts.to_trinh(c, {}, { ...ctx, user: ctx.user || SYS });
    const id = x.open?.[1]; if (!id) continue;
    await C.notify(ctx.db, [...await nsOf(ctx.db, 'candidate', c)].filter(u => u !== ctx.user?.id), `${c.full_name} đạt phỏng vấn — tờ trình tiếp nhận đã lập`, 'Bổ sung điểm, nhận xét, lương đề xuất, ngày tiếp nhận rồi bấm «Trình»', `e/rec_memo/${id}`);
  }
}
const CHECK = start => [   // việc chuẩn bị tiếp nhận: [việc, phụ trách, số ngày trước ngày nhận việc]
  ['Gửi thư mời nhận việc cho ứng viên (In / email từ hồ sơ ứng viên)', 'HCNS', 7], ['Ứng viên xác nhận ngày nhận việc', 'HCNS', 5],
  ['Chuẩn bị chỗ ngồi, bàn ghế, văn phòng phẩm', 'Hành chính', 2], ['Chuẩn bị máy tính, email công ty, tài khoản phần mềm', 'IT', 2],
  ['Tạo hồ sơ NV, HĐ thử việc, tài khoản app (tự động)', 'Hệ thống', 3], ['In hợp đồng thử việc, trình ký', 'HCNS', 1], ['Thẻ nhân viên, đồng phục', 'Hành chính', 1],
  ['Thu hồ sơ cá nhân: CCCD, sơ yếu lý lịch, bằng cấp, giấy khám sức khỏe', 'HCNS', 0], ['Đào tạo hội nhập (tự đưa vào khóa)', 'HCNS', 0], ['Phân công người hướng dẫn, giao việc tuần đầu', 'Trưởng bộ phận', 0],
].map(([task, owner, d]) => { const due = addDays(start, -d) < today() ? today() : addDays(start, -d); return { task, owner, due: dmy(due), done: 'Chưa' }; });
async function afterMemo(ctx, m) {   // tờ trình sau PV duyệt → lương thỏa thuận, ngày nhận việc, checklist; báo CV HCNS gửi thư mời nhận việc
  const c = await ctx.db.one('SELECT * FROM hr_candidate WHERE id = $1', [m.cand_id]); if (!c) return;
  const start = m.start_on || c.start_on || addDays(today(), 7);
  await ctx.db.q('UPDATE hr_candidate SET p1 = coalesce($2, p1), p2 = coalesce($3, p2), start_on = $4, onb_check = CASE WHEN jsonb_array_length(coalesce(onb_check, \'[]\'::jsonb)) = 0 THEN $5::jsonb ELSE onb_check END WHERE id = $1', [c.id, m.p1 ?? null, m.p2 ?? null, start, JSON.stringify(CHECK(start))]);
  await C.notify(ctx.db, await nsOf(ctx.db, 'candidate', c), `Tờ trình ${m.code} đã duyệt — gửi thư mời nhận việc cho ${c.full_name}`, `Nhận việc ${dmy(start)} · checklist chuẩn bị đã lập · bấm In trên hồ sơ ứng viên để in / gửi thư mời. Trước ngày nhận việc 3 ngày app tự tạo hồ sơ, HĐ thử việc, tài khoản.`, `e/candidate/${c.id}`);
}

// ---------- 6) tự tạo hồ sơ + HĐ thử việc + tài khoản trước ngày nhận việc; nhắc checklist ----------
const hashPw = pw => { const s = crypto.randomBytes(16).toString('hex'); return s + ':' + crypto.scryptSync(pw, s, 32).toString('hex'); };
async function account(db, emp) {   // tài khoản app cho nhân viên mới: tên đăng nhập = mã NV, mật khẩu mặc định, đổi khi đăng nhập lần đầu
  const had = await db.one('SELECT id, username FROM hr_user WHERE emp_id = $1', [emp.id]) || await db.one('SELECT id, username FROM hr_user WHERE lower(username) = lower($1)', [emp.code]);
  if (had) return { made: false, username: had.username };
  await db.q('INSERT INTO hr_user (username, full_name, role, emp_id, dept_id, title, pw_hash, must_change, active) VALUES ($1,$2,$3,$4,$5,$6,$7,true,true)', [emp.code, emp.full_name, 'nld', emp.id, emp.dept_id, emp.title, hashPw(process.env.DEFAULT_PW || '123456')]);
  return { made: true, username: emp.code };
}
async function autoHire() {
  const cs = await q("SELECT * FROM hr_candidate WHERE status = 'S53' AND start_on IS NOT NULL AND start_on <= $1 AND jsonb_array_length(coalesce(onb_check, '[]'::jsonb)) > 0", [addDays(today(), 3)]);
  let n = 0;
  for (const c of cs) {
    await tx(async db => {
      const ctx = { db, user: SYS, warn: [], demo: c.is_demo };
      const x = await B().hire(ctx, c, { start_on: c.start_on, p1: c.p1, p2: c.p2 });
      const emp = await db.one('SELECT * FROM hr_employee WHERE code = $1', [x.code]), acc = await account(db, emp);
      const chk = (c.onb_check || []).map(k => /tự động|Tạo hồ sơ NV/.test(k.task) ? { ...k, done: 'Xong' } : k);
      await db.q("UPDATE hr_candidate SET status = 'S60', onb_check = $2 WHERE id = $1", [c.id, JSON.stringify(chk)]);
      await C.audit(db, 'candidate', c.id, 'tu_dong', null, null, SYS, `Tự tạo hồ sơ ${x.code}, HĐ thử việc${acc.made ? ', tài khoản app ' + acc.username : ''}`);
      await C.notify(db, await nsOf(db, 'candidate', c), `${c.full_name} nhận việc ${dmy(c.start_on)} — đã tạo hồ sơ ${x.code}, HĐ thử việc`, `${acc.made ? `Tài khoản app: ${acc.username} / mật khẩu mặc định (đổi khi đăng nhập lần đầu) · ` : ''}${x.onb ? `khóa hội nhập ${x.onb} · ` : ''}bấm để in HĐ thử việc`, x.contract ? `e/contract/${x.contract}` : `e/candidate/${c.id}`);
    });
    n++;
  }
  return n;
}
const iso = s => { const x = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim()); return x ? `${x[3]}-${x[2].padStart(2, '0')}-${x[1].padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : null; };
async function remindChecklist() {   // việc chuẩn bị tiếp nhận đến hạn / quá hạn chưa xong → báo HCNS (gộp theo ứng viên)
  let n = 0;
  for (const c of await q("SELECT * FROM hr_candidate WHERE status IN ('S53','S60') AND start_on >= $1", [addDays(today(), -7)])) {
    const due = (c.onb_check || []).filter(k => k.task && k.done !== 'Xong' && iso(k.due) && iso(k.due) <= today()); if (!due.length) continue;
    await C.notify(dbx, await nsOf(dbx, 'candidate', c), `Chuẩn bị tiếp nhận ${c.full_name} (${dmy(c.start_on)}): ${due.length} việc đến hạn`, due.map(k => `${k.task} — ${k.owner}`).join(' · '), `e/candidate/${c.id}`); n++;
  }
  return n;
}
async function remindPosts() {   // đến ngày đăng tin mà chưa đăng → nhắc HCNS (đăng tự động lên TopCV / Facebook cần kết nối tài khoản các kênh)
  let n = 0;
  for (const p of await q("SELECT * FROM hr_rec_plan WHERE rec_state = 'dang_tuyen' AND jsonb_array_length(coalesce(posts, '[]'::jsonb)) > 0")) {
    const due = (p.posts || []).filter(x => x.state === 'Chờ đăng' && iso(x.post_on) && iso(x.post_on) <= today()); if (!due.length) continue;
    await C.notify(dbx, [...await nsOf(dbx, 'rec_plan', p), p.created_by].filter(Boolean), `Đến lịch đăng tin: ${p.position}`, `${due.map(x => x.channel).join(', ')} — mở kế hoạch, sao chép «Nội dung bài đăng», đăng xong chuyển «Đã đăng» và dán link`, `e/rec_plan/${p.id}`); n++;
  }
  return n;
}
module.exports = { recDraft, campaign, screen, screenNew, proposeInterviews, afterPass, afterMemo, autoHire, remindChecklist, remindPosts, account, nextMonth };
