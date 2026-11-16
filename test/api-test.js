// Kiểm thử luồng nghiệp vụ & tự động hóa qua API thật, chạy trên schema tạm? Không: chạy trên DB thật, bản ghi test đánh dấu is_demo rồi dọn ở cuối.
const assert = require('assert');
const B = require('../server/biz');
const { q, one, pool } = require('../server/db');
const U = 'http://127.0.0.1:3600';
let cookie = '';
const api = async (m, u, b) => { const r = await fetch(U + u, { method: m, headers: { 'Content-Type': 'application/json', cookie }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { s: r.status, d }; };
const as = async code => { const u = await one('SELECT id FROM hr_user WHERE username=$1', [code]); assert.equal((await api('POST', '/api/as/' + u.id, {})).s, 200); };
let pass = 0, fail = 0;
const T = async (name, fn) => { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, '→', e.message); } };

(async () => {
  await q("UPDATE hr_user SET active = true WHERE username IN ('NV068','NV001')");   // tài khoản NLĐ, BGĐ chỉ mở trong lúc kiểm thử
  const tStart = (await one('SELECT now() AS t')).t;   /* thông báo sinh ra trong lúc kiểm thử → xóa khi xong, không để lại cho người dùng thật */
  const cfg = (await one("SELECT value FROM hr_setting WHERE key='pay'")).value, ins = (await one("SELECT value FROM hr_setting WHERE key='ins'")).value;
  await as('NV049');
  await T('Lương: khớp dòng 14 ảnh TL02 (thử việc 4 công)', () => { const x = B.payLine({ p1: 15204000, p2: 9796000, d100: 0, d85: 4, worked: 4, trial_pct: 85, kpi: 100, ins_base: 0, n_dep: 6, kpcd_pct: 2 }, cfg, ins, 26); assert.equal(x.p1_net, 1988215); assert.ok(Math.abs(x.p2_net - 1281014) <= 1); assert.equal(x.meal, 100000); assert.ok(Math.abs(x.total - 3369229) <= 1); assert.equal(x.deduct, 52700000); assert.equal(x.tax, 0); assert.ok(Math.abs(x.net - 3369229) <= 1); });
  await T('Lương: khớp dòng 15 ảnh TL02 (P1 7,8tr, 26 công)', () => { const x = B.payLine({ p1: 7800000, p2: 4200000, d100: 26, d85: 0, worked: 24, kpi: 100, ins_base: 7800000, n_dep: 1, union: true, kpcd_pct: 2 }, cfg, ins, 26); assert.equal(x.total, 12600000); assert.equal(x.e_ins, 819000); assert.equal(x.net, 11781000); assert.equal(x.c_bhxh + x.c_bhyt + x.c_bhtn, 1677000); assert.equal(x.deduct, 21700000); });
  await T('BH-01 T11/2026 Cát Tường = file (64.682.240; NLĐ 21.223.860; DN 43.458.380)', async () => { const r = (await api('GET', '/api/report/BH-01?month=2026-11&legal=' + (await one("SELECT id FROM hr_legal WHERE code='CT'")).id)).d; const k = r.kpis; assert.equal(k[3][1], 64682240); assert.equal(k[1][1], 21223860); assert.equal(k[2][1], 43458380); });
  await T('CĐ-01 T11/2026 = file (KPCĐ 4.042.640; ĐPCĐ 1.010.660; nộp 1.313.858; giữ 3.739.442)', async () => { const r = (await api('GET', '/api/report/' + encodeURIComponent('CĐ-01') + '?month=2026-11&legal=' + (await one("SELECT id FROM hr_legal WHERE code='CT'")).id)).d; assert.equal(r.kpis[0][1], 202132000); assert.equal(r.kpis[1][1], 4042640); assert.equal(r.kpis[2][1], 1010660); assert.equal(r.kpis[3][1], 1313858); assert.equal(Math.round(r.sums.giu), 3739442); });
  await T('BH dòng theo file: 22.000.000 → DN 4.730.000, NLĐ 2.310.000, tổng 7.040.000', () => { const x = B.insRow({ salary: 22000000 }, ins); assert.equal(Math.round(x.dn), 4730000); assert.equal(Math.round(x.nld), 2310000); assert.equal(Math.round(x.total), 7040000); assert.equal(Math.round(x.t_bhxh), 5610000); });
  await T('CĐ dòng theo file: 9.438.000 → KPCĐ 188.760, nhận 141.570, ĐPCĐ nộp 14.157, tổng nộp 61.347', () => { const x = B.cdRow({ salary: 9438000 }, { kpcd: 2, dpcd: 0.5, kpcd_nop: 25, kpcd_giu: 75, dpcd_nop: 30, dpcd_giu: 70 }); assert.equal(x.kp, 188760); assert.equal(Math.round(x.kp_giu), 141570); assert.equal(Math.round(x.dp_nop), 14157); assert.equal(Math.round(x.nop), 61347); });
  await T('VPP06 T10 khớp file (Giấy A4 nhập 30, Keo dán nước xuất hết)', async () => { const r = (await api('GET', '/api/report/VPP06?month=2026-10')).d.rows; const a = r.find(x => x.name === 'Giấy A4'); assert.equal(a.inq, 30); assert.equal(a.close, 30); });
  await T('Số liệu HD12: HĐ thiếu ngày hết hạn báo «Cần cập nhật», không coi là vi phạm', async () => { const r = (await api('GET', '/api/report/HD12')).d.rows.filter(x => x.st === 'Cần cập nhật dữ liệu');
    const n = (await one("SELECT count(*)::int AS n FROM hr_contract c JOIN hr_employee e ON e.id=c.emp_id WHERE c.kind IN ('HD01','HD02') AND c.to_on IS NULL AND c.state IN ('hieu_luc','cho_quyet_dinh') AND e.state<>'da_nghi'")).n; assert.ok(n > 0); assert.equal(r.length, n); });

  const legal = (await one("SELECT id FROM hr_legal WHERE code='CT'")).id, dept = (await one("SELECT id FROM hr_dept WHERE code='HOME-KD'")).id;
  await T('Tự động: ứng viên → 1 chạm → hồ sơ NV + HĐ thử việc', async () => {
    const c = (await api('POST', '/api/e/candidate', { full_name: 'TEST Ứng viên', position: 'NV Test', source: 'TopCV', legal_id: legal, dept_id: dept, status: 'S53', phone: '0912345678' })).d.row;
    const x = await api('POST', `/api/e/candidate/${c.id}/act/nhan_viec`, { start_on: '2026-11-01', p1: 8000000, p2: 2000000 }); assert.equal(x.s, 200, JSON.stringify(x.d)); assert.equal(x.d.open[0], 'contract');
    const h = await one('SELECT * FROM hr_contract WHERE id=$1', [x.d.open[1]]), e = await one('SELECT * FROM hr_employee WHERE id=$1', [h.emp_id]); assert.equal(e.state, 'thu_viec'); assert.equal(h.kind, 'HD01'); assert.equal(h.to_on, '2026-12-31'); assert.equal(+h.salary, 8000000); assert.equal(h.sign_on, '2026-11-01'); global.tEmp = e.id;
    assert.equal((await one('SELECT count(*)::int AS n FROM hr_employee WHERE note LIKE $1', [`Từ ứng viên ${c.code}%`])).n, 1, 'chuyển S60 không được tạo hồ sơ lần 2');
  });
  // HĐ kế tiếp hiệu lực từ ngày sau HĐ cũ: đến ngày đó việc nền mới chuyển HĐ cũ «Đã thay thế», hồ sơ «Đang làm» (không thay sớm)
  await T('Tự động: HĐ kế tiếp ký trước — HĐ cũ giữ đến ngày hiệu lực của HĐ mới', async () => { const c = await one('SELECT id FROM hr_contract WHERE emp_id=$1', [tEmp]); const r = await api('POST', `/api/contract/${c.id}/renew`, {}); assert.equal(r.s, 200, JSON.stringify(r.d)); assert.equal(r.d.row.kind, 'HD02'); const early = r.d.row.from_on > new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10); assert.equal((await one('SELECT state FROM hr_contract WHERE id=$1', [c.id])).state, early ? 'hieu_luc' : 'thay_the'); assert.equal((await one('SELECT state FROM hr_employee WHERE id=$1', [tEmp])).state, early ? 'thu_viec' : 'dang_lam'); global.tNext = r.d.row.from_on.slice(0, 7); });
  await T('Tự động: QĐ điều chỉnh lương duyệt → hồ sơ đổi lương, BH tháng sau hiện Điều chỉnh', async () => {
    const d = (await api('POST', '/api/e/decision', { emp_id: tEmp, kind: 'HD08', no: 'TEST/QD', from_on: '2026-11-01', new_p1: 9000000, new_ins: 9000000 })).d.row;
    assert.equal((await api('POST', `/api/e/decision/${d.id}/submit`, {})).s, 200); const a = await api('POST', `/api/e/decision/${d.id}/approve`, { ok: true }); assert.equal(a.s, 200, JSON.stringify(a.d));
    const e = await one('SELECT * FROM hr_employee WHERE id=$1', [tEmp]); assert.equal(+e.ins_salary, 9000000);
    // tháng HĐ chính thức có hiệu lực (tháng thử việc không đóng BH); bảng thử luôn được xóa, kể cả khi kiểm tra trượt
    const x = await api('POST', '/api/e/ins_sheet', { legal_id: legal, month: tNext }); assert.equal(x.s, 200, JSON.stringify(x.d)); const s = x.d.row;
    try { const row = await one('SELECT lines FROM hr_ins_sheet WHERE id=$1', [s.id]); const l = row.lines.find(y => y.emp_id === tEmp); assert.ok(l, 'NV thử không có trong bảng BH tháng HĐ chính thức'); assert.equal(l.change, 'Tăng mới'); }
    finally { await q("DELETE FROM hr_audit WHERE ent='ins_sheet' AND rec_id=$1", [s.id]); await q('DELETE FROM hr_ins_sheet WHERE id=$1', [s.id]); }
  });
  await T('Tự động: đơn nghỉ duyệt → ghi công, trừ ngày làm việc; thử việc chưa được dùng phép năm', async () => {
    // đơn từ không lập hộ: gửi emp_id người khác vẫn lưu theo người đang đăng nhập; đơn của tEmp lập qua kênh hệ thống (như app nền tảng)
    const px = (await api('POST', '/api/e/leave', { emp_id: tEmp, type_code: 'P', from_on: '2026-12-28', to_on: '2026-12-28', reason: 't' })).d.row; assert.notEqual(px.emp_id, tEmp); await q("DELETE FROM hr_audit WHERE ent='leave' AND rec_id=$1", [px.id]); await q('DELETE FROM hr_leave WHERE id=$1', [px.id]);
    const C = require('../server/core');
    await assert.rejects(C.create('leave', { emp_id: tEmp, type_code: 'P', from_on: '2026-11-02', to_on: '2026-11-03', reason: 't' }, C.SYS, { system: true }), /thử việc/);   // HĐ chính thức từ 2027 → chưa được dùng phép
    const l = (await C.create('leave', { emp_id: tEmp, type_code: 'K', from_on: '2026-11-02', to_on: '2026-11-03', reason: 't' }, C.SYS, { system: true })).row; assert.equal(+l.days, 2);
    await api('POST', `/api/e/leave/${l.id}/submit`, {}); assert.equal((await api('POST', `/api/e/leave/${l.id}/approve`, { ok: true })).s, 200); assert.equal((await one("SELECT mark FROM hr_attendance WHERE emp_id=$1 AND day='2026-11-02'", [tEmp])).mark, 'K');
  });
  await T('Khóa kỳ công: còn giải trình thì không khóa; đã khóa không ghi được công', async () => {
    let p = await one("SELECT id FROM hr_att_period WHERE legal_id=$1 AND month='2026-10'", [legal]), made = false;   // kỳ T10 chưa mở thì tạo tạm, dọn ở cuối
    if (!p) { p = await one("INSERT INTO hr_att_period (legal_id, month, status) VALUES ($1, '2026-10', 'mo') RETURNING id", [legal]); made = true; }
    try {
    const x = (await api('POST', `/api/e/att_period/${p.id}/act/khoa`, {})); assert.equal(x.s, 400, 'phải bị chặn');
    await q("UPDATE hr_explain SET status='da_duyet' WHERE is_demo"); assert.equal((await api('POST', `/api/e/att_period/${p.id}/act/khoa`, {})).s, 200);
    const w = await api('PUT', '/api/timesheet', { emp_id: tEmp, day: '2026-10-05', mark: 'HC' }); assert.equal(w.s, 400); await api('POST', `/api/e/att_period/${p.id}/act/mo`, {}); await q("UPDATE hr_explain SET status='cho_duyet' WHERE is_demo");
    } finally { if (made) await q('DELETE FROM hr_att_period WHERE id=$1', [p.id]); }
  });
  await T('VPP: đề xuất → duyệt → cấp phát chặn vượt tồn, sổ kho giảm đúng', async () => {
    const before = (await B.vppStock({ q }, legal)).VPP01 || 0; await as('NV044');
    const r = (await api('POST', '/api/e/vpp_req', { legal_id: legal, emp_id: tEmp, req_on: '2026-11-01', lines: [{ code: 'VPP01', name: 'x', unit: 'Cuộn', qty: '3' }] })); assert.equal(r.s, 200, JSON.stringify(r.d));
    await api('POST', `/api/e/vpp_req/${r.d.row.id}/submit`, {}); await as('NV049'); assert.equal((await api('POST', `/api/e/vpp_req/${r.d.row.id}/approve`, { ok: true })).s, 200);
    // duyệt xong app tự lập phiếu cấp phát (kho còn hàng); kho hết thì để «Đã duyệt» → cấp tay
    if ((await one('SELECT status FROM hr_vpp_req WHERE id=$1', [r.d.row.id])).status !== 'da_cap') { const c = await api('POST', `/api/e/vpp_req/${r.d.row.id}/act/cap_phat`, {}); assert.equal(c.s, 200, JSON.stringify(c.d)); }
    assert.equal((await B.vppStock({ q }, legal)).VPP01 || 0, before - Math.min(3, Math.max(before, 0)));
    const over = await api('POST', '/api/e/vpp_issue', { legal_id: legal, emp_id: tEmp, lines: [{ code: 'VPP01', qty_out: '99999' }] }); assert.equal(over.s, 400); assert.match(over.d.error, /không đủ/);
    await q('DELETE FROM hr_vpp_issue WHERE req_id=$1', [r.d.row.id]); await q('DELETE FROM hr_vpp_req WHERE id=$1', [r.d.row.id]);
  });
  await T('Xe: duyệt lịch trùng bị chặn; km trả < km nhận bị chặn', async () => {
    const v = (await one("SELECT id FROM hr_vehicle WHERE legal_id=$1 AND state='san_sang' ORDER BY id LIMIT 1", [legal])).id, mk = async () => (await api('POST', '/api/e/car_book', { legal_id: legal, emp_id: tEmp, start_at: '2026-12-01T08:00:00+07:00', end_at: '2026-12-01T12:00:00+07:00', route: 'A-B', vehicle_id: v })).d.row;
    const a = await mk(), b = await mk(); await as('NV044'); for (const x of [a, b]) await api('POST', `/api/e/car_book/${x.id}/submit`, {}); await as('NV049'); assert.equal((await api('POST', `/api/e/car_book/${a.id}/approve`, { ok: true })).s, 200); assert.equal((await api('POST', `/api/e/car_book/${b.id}/approve`, { ok: true })).s, 400);
    assert.equal((await api('POST', '/api/e/car_return', { book_id: a.id, got_at: '2026-12-01T08:00:00+07:00', back_at: '2026-12-01T12:00:00+07:00', km_in: 100, km_out: 50 })).s, 400);
    await q('DELETE FROM hr_approval WHERE ent=$1 AND rec_id = ANY($2)', ['car_book', [a.id, b.id]]); await q('DELETE FROM hr_car_book WHERE id = ANY($1)', [[a.id, b.id]]);
  });
  await T('Chốt kỳ: số đã chốt không đổi khi nguồn thay đổi', async () => {
    await api('POST', '/api/report/TS02/close', { month: '2026-10' }); const s = (await api('GET', '/api/report/TS02')).d.snapshots[0], before = (await api('GET', `/api/report/TS02?snapshot=${s.id}`)).d.rows.length;
    const x = await api('POST', '/api/e/asset', { code: 'TEST-TS', name: 't', legal_id: legal, status: 'trong_kho' }); const after = (await api('GET', `/api/report/TS02?snapshot=${s.id}`)).d.rows.length; assert.equal(before, after); await api('DELETE', '/api/e/asset/' + x.d.row.id); await q('DELETE FROM hr_snapshot WHERE id=$1', [s.id]);
  });
  await T('KPI = chi tiết: thẻ Tổng nhân sự bằng số dòng HS02', async () => { const d = (await api('GET', '/api/dash/NS?month=2026-10')).d, r = (await api('GET', '/api/report/HS02?month=2026-10')).d; assert.equal(d.cards[3][1], r.rows.length); });
  // ---- phân quyền ----
  await as('NV068');
  await T('NLĐ: chỉ thấy hồ sơ của mình', async () => { const r = (await api('GET', '/api/e/employee')).d; assert.equal(r.total, 1); });
  await T('NLĐ: không xem bảng lương, không mở dashboard, không mở hồ sơ người khác', async () => { assert.equal((await api('GET', '/api/e/payroll')).s, 403); assert.equal((await api('GET', '/api/dash/NS')).s, 403); assert.equal((await api('GET', '/api/e/employee/' + tEmp)).s, 403); });
  await as('NV001');
  await T('BGĐ: thấy tổng lương nhưng không thấy dòng cá nhân; CCCD che', async () => { const r = (await api('GET', '/api/report/TL05?month=2026-09')).d; assert.equal(r.rows.length, 0); const e = (await api('GET', '/api/e/employee')).d.rows.find(x => x.code === 'NV049'); assert.ok(String(e.cccd).startsWith('•')); assert.equal(e.pay_p1, null); });
  await as('NV151');
  await T('CV HCNS: chỉ pháp nhân được phân công', async () => { const r = (await api('GET', '/api/e/employee?limit=100')).d.rows; assert.ok(r.every(x => ['Thống Nhất', 'Tiến Đạt'].includes(x.legal_id__l))); });
  await T('Phân công: Huyền thấy phần Nhân sự + VPP, suất ăn; không thấy tài sản, xe', async () => { const m = (await api('GET', '/api/meta')).d, g = m.menu.map(x => x[0]), hc = m.menu.find(x => x[0] === 'HÀNH CHÍNH')[1].map(x => x[0]); assert.ok(g.includes('NHÂN SỰ')); assert.ok(hc.includes('Văn phòng phẩm') && hc.includes('Quản lý suất ăn')); assert.ok(!hc.includes('Quản lý tài sản') && !hc.includes('Quản lý xe công vụ')); assert.equal((await api('POST', '/api/e/asset', { code: 'TEST-X', name: 'x', legal_id: legal })).s, 403); });
  await T('Phân công: Huyền xem VPP mọi pháp nhân (mảng được giao)', async () => { assert.equal((await api('GET', '/api/report/VPP06')).s, 200); assert.ok((await api('GET', '/api/e/vpp_item')).d.total > 0); });
  await as('NV044');
  await T('Phân công: Yến thấy tài sản, xe; không thấy VPP, suất ăn; nhân sự chỉ Cát Tường, Đại Hưng Phát', async () => { const hc = (await api('GET', '/api/meta')).d.menu.find(x => x[0] === 'HÀNH CHÍNH')[1].map(x => x[0]); assert.ok(hc.includes('Quản lý tài sản') && !hc.includes('Văn phòng phẩm') && !hc.includes('Quản lý suất ăn')); assert.equal((await api('GET', '/api/report/VPP06')).s, 403); const r = (await api('GET', '/api/e/employee?limit=100')).d.rows; assert.ok(r.length && r.every(x => ['Cát Tường', 'Đại Hưng Phát'].includes(x.legal_id__l))); });
  await as('NV047');
  await T('Hường (tạp vụ): chỉ suất ăn theo ngày, đăng ký suất ăn', async () => { const m = (await api('GET', '/api/meta')).d, it = m.menu.flatMap(g => g[1].flatMap(f => Array.isArray(f[2]) ? f[2].map(x => x[0]) : [f[2]])); assert.ok(it.includes('e:meal_day') && it.includes('v:portal') && it.every(x => /^(e:meal_|r:SA0|v:portal$|v:inbox$|d:HC$)/.test(x)), it.join(',')); /* chỉ mảng suất ăn (mục cụ thể do TP HCNS giao) */ assert.equal((await api('GET', '/api/e/employee')).d.total, 1); assert.equal((await api('GET', '/api/e/payroll')).s, 403); });
  await as('NV021');
  await T('Minh (IT, quản trị): menu chỉ phần hệ thống, không có Nhân sự / Hành chính', async () => { const g = (await api('GET', '/api/meta')).d.menu.map(x => x[0]); assert.ok(!g.includes('NHÂN SỰ') && !g.includes('HÀNH CHÍNH') && g.includes('HỆ THỐNG')); });
  await as('NV049');
  // dọn
  const tCode = (await one('SELECT code FROM hr_employee WHERE id=$1', [tEmp]))?.code;   // khóa hội nhập tự mở cho người thử → xóa; khóa có sẵn → bỏ tên người thử
  for (const t of await q("SELECT id, emps FROM hr_training WHERE emps @> $1::jsonb", [JSON.stringify([{ code: tCode }])])) {
    const rest = (t.emps || []).filter(x => x.code !== tCode);
    if (rest.some(x => x.code)) await q('UPDATE hr_training SET emps=$1 WHERE id=$2', [JSON.stringify(rest), t.id]); else { await q("DELETE FROM hr_audit WHERE ent='training' AND rec_id=$1", [t.id]); await q('DELETE FROM hr_training WHERE id=$1', [t.id]); } }
  await q('DELETE FROM hr_decision WHERE emp_id=$1', [tEmp]); await q('DELETE FROM hr_leave WHERE emp_id=$1', [tEmp]); await q('DELETE FROM hr_attendance WHERE emp_id=$1', [tEmp]); await q('DELETE FROM hr_contract WHERE emp_id=$1', [tEmp]); await q('UPDATE hr_candidate SET plan_id=NULL WHERE full_name=$1', ['TEST Ứng viên']); await q('DELETE FROM hr_candidate WHERE full_name=$1', ['TEST Ứng viên']); await q('DELETE FROM hr_leave_bal WHERE emp_id=$1', [tEmp]); await q('DELETE FROM hr_employee WHERE id=$1', [tEmp]);
  await q("DELETE FROM hr_approval WHERE rec_id NOT IN (SELECT id FROM hr_leave) AND ent='leave'"); await q("DELETE FROM hr_approval WHERE ent='decision' AND rec_id NOT IN (SELECT id FROM hr_decision)");
  // ---- tích hợp nền tảng chung (/api/v1, X-Api-Key) ----
  const pf = async (m, u, b, key = process.env.PLATFORM_KEY) => { const r = await fetch(U + u, { method: m, headers: { 'Content-Type': 'application/json', 'X-Api-Key': key || '' }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, d: await r.json() }; };
  const X = 'TEST-NT-' + Date.now(), made = [];
  try {
    await T('Nền tảng: thiếu / sai khóa API bị chặn', async () => { assert.equal((await pf('GET', '/api/v1/ping', null, 'sai')).s, 401); assert.equal((await pf('GET', '/api/v1/ping')).s, 200); });
    await T('Nền tảng: đơn giải trình → chờ HCNS duyệt, gửi lại không tạo trùng, Yến (CT) thấy trong hộp duyệt', async () => {
      const a = await pf('POST', '/api/v1/requests/explain', { ext_id: X + '-gt', emp_code: 'NV068', data: { day: '2026-11-04', kind: 'quen_ra', right_time: '17:30', reason: 'Quên chấm ra' } }); assert.equal(a.s, 200, JSON.stringify(a.d)); assert.equal(a.d.status, 'cho_duyet'); made.push(['explain', a.d.id]);
      const b = await pf('POST', '/api/v1/requests/explain', { ext_id: X + '-gt', emp_code: 'NV068', data: { day: '2026-11-04', kind: 'quen_ra', reason: 'x' } }); assert.equal(b.d.duplicate, true); assert.equal(b.d.id, a.d.id);
      await as('NV044'); assert.ok((await api('GET', '/api/inbox')).d.some(x => x.ent === 'explain' && x.rec_id === a.d.id));
      await as('NV151'); assert.ok(!(await api('GET', '/api/inbox')).d.some(x => x.ent === 'explain' && x.rec_id === a.d.id));
      await as('NV049'); assert.equal((await api('POST', `/api/e/explain/${a.d.id}/approve`, { ok: true })).s, 200);
      await new Promise(r => setTimeout(r, 300)); const o = await one("SELECT body FROM hr_outbox WHERE body->>'ext_id' = $1 ORDER BY id DESC LIMIT 1", [X + '-gt']); assert.equal(o?.body.status, 'da_duyet');
      assert.equal((await pf('GET', '/api/v1/requests/' + encodeURIComponent(X + '-gt'))).d.status, 'da_duyet');
    });
    await T('Nền tảng: đơn nghỉ trưởng phòng đã duyệt → vào app Đã duyệt, ghi P vào bảng công', async () => {
      const r = await pf('POST', '/api/v1/requests/leave', { ext_id: X + '-np', emp_code: 'NV068', data: { type_code: 'P', from_on: '2026-11-16', to_on: '2026-11-17', reason: 'Việc gia đình' }, approved: { by: 'Nguyễn Văn An', title: 'Trưởng phòng kinh doanh', at: '2026-11-10 09:00' } });
      assert.equal(r.s, 200, JSON.stringify(r.d)); assert.equal(r.d.status, 'da_duyet'); made.push(['leave', r.d.id]);
      const e = await one("SELECT id FROM hr_employee WHERE code='NV068'"); assert.equal((await one("SELECT mark FROM hr_attendance WHERE emp_id=$1 AND day='2026-11-16'", [e.id])).mark, 'P');
    });
    await T('Nền tảng: chấm công app điện thoại → bảng công HC, giờ vào / ra', async () => {
      const r = await pf('POST', '/api/v1/punches', { punches: [{ emp_code: 'NV068', at: '2026-11-12T08:02:00+07:00' }, { emp_code: 'NV068', at: '2026-11-12T17:36:00+07:00' }, { emp_code: 'KHONG-CO', at: '2026-11-12T08:00:00+07:00' }] });
      assert.equal(r.d.ok, 1); assert.equal(r.d.err.length, 1); const e = await one("SELECT id FROM hr_employee WHERE code='NV068'"), a = await one("SELECT * FROM hr_attendance WHERE emp_id=$1 AND day='2026-11-12'", [e.id]); assert.equal(a.mark, 'HC'); assert.equal(a.in_t, '08:02'); assert.equal(a.out_t, '17:36');
    });
    await T('Nền tảng: đọc phép, bảng công, đơn của nhân viên', async () => {
      assert.equal((await pf('GET', '/api/v1/employees/NV068/leave?year=2026')).s, 200);
      const t = (await pf('GET', '/api/v1/employees/NV068/timesheet?month=2026-11')).d; assert.ok(t.days.some(x => x.day === '2026-11-12' && x.mark === 'HC'));
      const q2 = (await pf('GET', '/api/v1/employees/NV068/requests')).d.requests; assert.ok(q2.some(x => x.ext_id === X + '-np'));
      assert.equal((await pf('GET', '/api/v1/employees/NV068/payslips')).s, 200); assert.equal((await pf('GET', '/api/v1/employees/KHONG-CO/leave')).s, 400);
    });
  } finally {
    const e = await one("SELECT id FROM hr_employee WHERE code='NV068'");
    for (const [ent, id] of made) { await q('DELETE FROM hr_approval WHERE ent=$1 AND rec_id=$2', [ent, id]); await q(`DELETE FROM hr_${ent} WHERE id=$1`, [id]); }
    await q("DELETE FROM hr_attendance WHERE emp_id=$1 AND day IN ('2026-11-04','2026-11-12','2026-11-16','2026-11-17')", [e.id]); await q("DELETE FROM hr_ext WHERE ext_id LIKE $1", [X + '%']); await q("DELETE FROM hr_outbox WHERE body->>'ext_id' LIKE $1", [X + '%']);
  }
  await q("UPDATE hr_user SET active = false WHERE username = 'NV001'");
  await q('DELETE FROM hr_notice WHERE at >= $1', [tStart]);
  console.log(`\n${pass} đạt, ${fail} trượt`); await pool.end(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
