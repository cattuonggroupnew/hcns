// Việc chạy nền — thay HCNS làm phần lặp lại. Chạy khi khởi động và mỗi giờ; mỗi việc chỉ chạy 1 lần cho 1 kỳ (bảng hr_job).
const { q, one, tx } = require('./db');
const C = require('./core');
const B = require('./biz');
const { SYS, today, addDays, dayDiff } = C;

async function once(name, period, fn) {
  // giành lượt trước khi chạy: 2 lượt chạy song song (vd. «Xóa dữ liệu thử» + giờ chẵn) không làm trùng; lỗi thì trả lượt để giờ sau chạy lại
  if (!await one('INSERT INTO hr_job (name, period, result) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id', [name, period, 'đang chạy'])) return;
  let result; try { result = await fn(); } catch (e) { await q('DELETE FROM hr_job WHERE name = $1 AND period = $2', [name, period]); throw e; }
  await q('UPDATE hr_job SET result = $3 WHERE name = $1 AND period = $2', [name, period, result || 'xong']);
}
async function monthly(m) {
  const list = await q("SELECT l.id, l.short FROM hr_legal l WHERE EXISTS (SELECT 1 FROM hr_employee e WHERE e.legal_id = l.id AND e.state <> 'da_nghi')");
  await once('ky_cong', m, async () => { let c = 0; for (const l of list) if (!await one('SELECT 1 AS x FROM hr_att_period WHERE legal_id=$1 AND month=$2', [l.id, m])) { await C.create('att_period', { legal_id: l.id, month: m }, SYS, { system: true }); c++; } return `Mở ${c} kỳ công`; });
  await once('nhap_bh_cd', m, async () => { // nháp bảng BH, CĐ kế thừa nhân sự + tăng/giảm so với tháng trước
    let c = 0;
    for (const l of list) for (const ent of ['ins_sheet', 'cd_sheet']) if (!await one(`SELECT 1 AS x FROM hr_${ent} WHERE legal_id=$1 AND month=$2`, [l.id, m])) { await C.create(ent, { legal_id: l.id, month: m }, SYS, { system: true }); c++; }
    return `Tạo ${c} bảng nháp`;
  });
  await once('phep_thang', m, async () => {  // phép được hưởng = số tháng làm việc trong năm (tính lại, không cộng dồn → chạy lại không sai)
    await tx(db => B.syncLeave(db, +m.slice(0, 4))); return 'Đã tính lại phép được hưởng';
  });
}
// đầu tháng sau: nháp bảng lương tháng trước từ công + tăng ca + hồ sơ
async function payrollDraft(prev) {
  await once('nhap_luong', prev, async () => {
    let c = 0;
    for (const l of await q("SELECT DISTINCT legal_id FROM hr_employee WHERE state <> 'da_nghi'")) if (!await one('SELECT 1 AS x FROM hr_payroll WHERE legal_id=$1 AND month=$2', [l.legal_id, prev])) { await C.create('payroll', { legal_id: l.legal_id, month: prev }, SYS, { system: true }); c++; }
    return `Tạo ${c} bảng lương nháp`;
  });
}
async function daily() {
  const t = today();
  // HĐ quá hạn không tự coi là vi phạm: chuyển «Hết hạn – chờ quyết định»
  await q("UPDATE hr_contract SET state = 'cho_quyet_dinh' WHERE state = 'hieu_luc' AND to_on IS NOT NULL AND to_on < $1 AND kind IN ('HD01','HD02')", [t]);
  // quyết định / thuyên chuyển đến ngày hiệu lực → cập nhật hồ sơ; chấm công tự động ghi tiếp ngày mới
  await B.applyDue({ q, one }, SYS);
  await q("UPDATE hr_employee SET state = 'da_nghi' WHERE leave_on IS NOT NULL AND leave_on < $1 AND state <> 'da_nghi'", [t]);
  // báo cáo lao động: tự lập đầu việc cho kỳ 6 tháng và cả năm
  const y = t.slice(0, 4), mm = t.slice(5, 7);
  if (mm === '06' || mm === '12') await once('bc_dinh_ky', y + '-' + mm, async () => {
    const period = mm === '06' ? `6 tháng đầu năm ${y}` : `Cả năm ${y}`, due = mm === '06' ? `${y}-07-05` : `${+y + 1}-01-05`;
    for (const l of await q("SELECT id FROM hr_legal WHERE state = 'dang_hd'")) for (const kind of ['pli', 'atvsld', 'yte', 'tnld'])
      if (!await one('SELECT 1 AS x FROM hr_gov_report WHERE legal_id=$1 AND kind=$2 AND period=$3', [l.id, kind, period])) await C.create('gov_report', { legal_id: l.id, kind, period, due_on: due }, SYS, { system: true });
  });
}
// ---------- tự động hằng ngày (mỗi việc 1 lần / kỳ nhờ hr_job) ----------
const dbx = { q, one }, hourVN = () => (new Date().getUTCHours() + 7) % 24;
const usersOf = async empIds => (await q('SELECT id FROM hr_user WHERE active AND emp_id = ANY($1)', [empIds.filter(Boolean)])).map(u => u.id);
// ngày lễ năm y: dương lịch cố định + Tết, Giỗ Tổ theo âm lịch (Điều 112 BLLĐ 2019). Chỉ sinh cho năm CHƯA có ngày lễ nào — HCNS đã nhập theo thông báo của Chính phủ thì giữ nguyên
async function holidaysOf(y) {
  if ((await one("SELECT count(*)::int n FROM hr_holiday WHERE to_char(day,'YYYY') = $1", [String(y)])).n) return 'Đã có';
  const L = require('./lunar'), out = [['01-01', 'Tết Dương lịch'], ['04-30', 'Ngày Chiến thắng 30/4'], ['05-01', 'Quốc tế Lao động 1/5'], ['09-02', 'Quốc khánh 2/9']].map(([d, nm]) => [`${y}-${d}`, nm]);
  for (let d = `${y}-01-01`; d <= `${y}-12-31`; d = addDays(d, 1)) {
    const l = L(+d.slice(8), +d.slice(5, 7), +d.slice(0, 4)), next = L(+addDays(d, 1).slice(8), +addDays(d, 1).slice(5, 7), +addDays(d, 1).slice(0, 4));
    if (!l.leap && l.month === 1 && l.day <= 4) out.push([d, `Tết Nguyên đán (mùng ${l.day})`]);
    if (!l.leap && l.month === 12 && next.month === 1 && next.day === 1) out.push([d, 'Tết Nguyên đán (30 Tết)']);
    if (!l.leap && l.month === 3 && l.day === 10) out.push([d, 'Giỗ Tổ Hùng Vương 10/3']);
  }
  for (const [d, nm] of out) await q("INSERT INTO hr_holiday (day, name, applies) VALUES ($1, $2, 'Mọi pháp nhân — tự sinh, HCNS chỉnh theo thông báo nghỉ chính thức') ON CONFLICT DO NOTHING", [d, nm]);
  return `Tạo ${out.length} ngày lễ`;
}
async function auto() {
  const t = today(), y = +t.slice(0, 4), m = t.slice(0, 7), pm = B.prevMonth(m), h = hourVN();
  const step = async (nm, fn) => { try { await fn(); } catch (e) { console.error(`Tự động «${nm}» lỗi:`, e.message); } };
  await step('ngày lễ', async () => { await once('ngay_le', String(y), () => holidaysOf(y)); if (t.slice(5) >= '10-01') await once('ngay_le', String(y + 1), () => holidaysOf(y + 1)); });
  // suất ăn: đầu tháng chép đăng ký tháng trước; mùng 1 (từ 8h) gửi tiền ăn tháng trước kèm QR; cuối mỗi ngày làm việc (từ 14h) tự ghi suất thực tế = số đăng ký
  // chép đăng ký: chỉ trong 3 ngày đầu tháng (app bật giữa tháng không tự chép), chỉ các ngày từ hôm nay trở đi
  if (+t.slice(8) <= 3) await step('đăng ký suất ăn', () => once('an_dang_ky', m, async () => { const r = await B.mealCopy(SYS, m, null, t); return `Chép ${r.ok} đăng ký, bỏ qua ${r.skip}`; }));
  // ghi suất ngày TRƯỚC khi gửi tiền (các ngày cuối tháng có đơn giá); mỗi ngày chỉ tự ghi 1 lần — HCNS xóa ngày bếp nghỉ thì không tạo lại
  await step('suất ăn ngày', async () => {
    const hol = await B.holidays(dbx), price = +(await one('SELECT price FROM hr_meal_day WHERE price > 0 ORDER BY day DESC LIMIT 1'))?.price || +(await C.setting('pay'))?.meal_day || 0; if (!price) return;
    for (let i = 7; i >= 0; i--) {
      const d = addDays(t, -i); if (!B.isWorkday(d, hol) || (i === 0 && h < 14)) continue;
      await once('an_ngay', d, async () => {
        if (await one('SELECT 1 x FROM hr_meal_day WHERE day = $1', [d])) return 'Đã có';
        const n = (await q('SELECT days FROM hr_meal_reg WHERE month = $1', [d.slice(0, 7)])).filter(x => (x.days || []).some(v => +v === +d.slice(8))).length; if (!n) return 'Không ai đăng ký';
        await C.create('meal_day', { day: d, price, note: 'Tự ghi theo số đăng ký — sửa nếu thực tế khác' }, SYS, { system: true }); return `${n} suất`;
      });
    }
  });
  // gửi tiền ăn tháng trước (từ 8h mùng 1): chỉ gửi người chưa được báo — người đang «chờ thanh toán» không nhận lại thông báo
  await step('gửi tiền ăn', async () => {
    if (t.slice(8) === '01' && h < 8) return;
    const need = (await one("SELECT count(*)::int n FROM hr_meal_reg WHERE month = $1 AND coalesce(n_days,0) > 0 AND pay_st IS NULL", [pm])).n, price = await one('SELECT 1 x FROM hr_meal_day WHERE price > 0 LIMIT 1');
    if (need && price) await once('an_gui_tien', pm, async () => { const r = await require('./platform').mealBill(SYS, pm, { onlyNew: true }); return `Gửi ${r.n} người, ${r.total} đ`; });
  });
  // người đã nghỉ việc → khóa tài khoản app
  await step('khóa tài khoản', () => q("UPDATE hr_user SET active = false WHERE active AND emp_id IN (SELECT id FROM hr_employee WHERE state = 'da_nghi')"));
  // nhắc việc qua thông báo app
  // sinh nhật: gửi từ 7h sáng; năm không nhuận thì người sinh 29/2 được chúc ngày 28/2
  if (h >= 7) await step('sinh nhật', () => once('sinh_nhat', t, async () => {
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0), mds = t.slice(5) === '02-28' && !leap ? ['02-28', '02-29'] : [t.slice(5)];
    const es = await q("SELECT e.id, e.full_name, d.head_id FROM hr_employee e LEFT JOIN hr_dept d ON d.id = e.dept_id WHERE e.state <> 'da_nghi' AND to_char(e.dob,'MM-DD') = ANY($1)", [mds]);
    for (const e of es) { await C.notify(dbx, await usersOf([e.id]), 'Chúc mừng sinh nhật! 🎂', 'Cát Tường chúc bạn tuổi mới nhiều sức khỏe, niềm vui và thành công.', 'v/portal'); if (e.head_id && e.head_id !== e.id) await C.notify(dbx, await usersOf([e.head_id]), `Hôm nay sinh nhật ${e.full_name}`, 'Gửi lời chúc tới thành viên phòng bạn', null); }
    return `${es.length} người`;
  }));
  await step('hạn việc sự kiện', () => once('nhac_viec_sk', t, async () => {
    let c = 0; const iso = s => { const x = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim()); return x ? `${x[3]}-${x[2].padStart(2, '0')}-${x[1].padStart(2, '0')}` : null; };
    for (const ev of await q("SELECT id, name, tasks FROM hr_event WHERE status IN ('da_duyet','cho_duyet','nhap')"))
      for (const k of ev.tasks || []) { const d = iso(k.due), code = /^(\S+)\s+·/.exec(k.who || '')?.[1]; if (!d || !code || k.done === 'Xong') continue; const left = dayDiff(t, d); if (left > 2 || left < -1) continue;
        const e = await one('SELECT id FROM hr_employee WHERE code = $1', [code]); if (!e) continue;
        await C.notify(dbx, await usersOf([e.id]), `${left < 0 ? 'Quá hạn' : left === 0 ? 'Hôm nay đến hạn' : `Còn ${left} ngày`}: ${k.task || 'đầu việc'}`, `Sự kiện ${ev.name} · hạn ${k.due}`, null); c++; }
    return `${c} nhắc`;
  }));
  // tuyển dụng tự động (recauto.js): ngày 25 đề xuất kế hoạch tháng sau; mỗi giờ: CV đạt → đề xuất lịch PV, tới hạn → tạo hồ sơ + HĐ thử việc + tài khoản; 8h: nhắc đăng tin, checklist tiếp nhận
  const RA = require('./recauto');
  if (+t.slice(8) >= 25 && (+t.slice(8) > 25 || h >= 8)) await step('đề xuất kế hoạch tuyển', () => once('td_de_xuat', RA.nextMonth(m), async () => `Đề xuất ${await tx(db => RA.recDraft(db, RA.nextMonth(m)))} vị trí`));
  await step('đề xuất lịch phỏng vấn', () => RA.proposeInterviews());
  await step('tự tạo hồ sơ nhận việc', () => RA.autoHire());
  if (h >= 8) { await step('nhắc đăng tin', () => once('td_nhac_dang', t, async () => `${await RA.remindPosts()} kế hoạch`)); await step('nhắc checklist tiếp nhận', () => once('td_checklist', t, async () => `${await RA.remindChecklist()} ứng viên`)); }
  // ngày 20 (từ 8h): bảng trích nộp BH, CĐ tháng này tính lại theo dữ liệu mới nhất → báo NV HCNS phụ trách pháp nhân kiểm tra, trình giám đốc pháp nhân
  if (+t.slice(8) >= 20 && (+t.slice(8) > 20 || h >= 8)) await step('BH CĐ ngày 20', () => once('bh_cd_kiem_tra', m, async () => `Báo kiểm tra ${await tx(db => B.sheetReview(db, m))} bảng`));
  if (+t.slice(8) >= 3) await step('khóa kỳ công', async () => {
    const open = await q("SELECT p.id, l.short FROM hr_att_period p JOIN hr_legal l ON l.id = p.legal_id WHERE p.month = $1 AND p.status = 'mo'", [pm]); if (!open.length) return;
    await once('nhac_khoa_cong', pm, async () => { const us = (await q("SELECT id FROM hr_user WHERE active AND role = 'tp_hcns'")).map(u => u.id); await C.notify(dbx, us, `Kỳ công ${pm.slice(5)}/${pm.slice(0, 4)} chưa khóa`, open.map(x => x.short).join(', ') + ' — rà soát rồi khóa để lập bảng lương', 'e/att_period'); return `${open.length} pháp nhân`; });
  });
}
async function tick() {
  // máy chủ tắt qua tháng: chạy bù từng tháng bị lỡ kể từ lần chạy gần nhất (tối đa 12 tháng; mỗi việc chỉ chạy 1 lần / kỳ nên chạy lại không trùng)
  const m = today().slice(0, 7), last = (await one("SELECT max(period) AS p FROM hr_job WHERE name = 'ky_cong'").catch(() => null))?.p, ms = [];
  for (let x = last && last < m ? B.nextMonth(last) : m; x <= m && ms.length < 12; x = B.nextMonth(x)) ms.push(x);
  const steps = [...ms.flatMap(x => [() => monthly(x), () => payrollDraft(B.prevMonth(x))]), daily, auto];
  for (const fn of steps) try { await fn(); } catch (e) { console.error('Việc nền lỗi:', e.message); }   // từng bước riêng: một bước lỗi không chặn các bước sau
}
// phòng họp: lịch đã duyệt mà qua giờ kết thúc → tự «Đã đóng», giờ kết thúc thực tế = giờ kết thúc đăng ký (như bấm «Đóng lịch»); chạy mỗi phút
async function closeRooms() {
  const rs = await q("UPDATE hr_room_book SET status = 'hoan_thanh', real_end = coalesce(real_end, end_at) WHERE status = 'da_duyet' AND end_at <= now() RETURNING id, code");
  for (const r of rs) await C.audit({ q, one }, 'room_book', r.id, 'tu_dong', null, null, SYS, 'Tự đóng lịch khi hết giờ họp');
  return rs.length;
}
const start = (after = () => {}) => {   // after: báo màn hình đang mở tải lại số liệu
  const run = () => tick().then(after); run(); setInterval(run, 3600e3);
  const room = () => closeRooms().then(n => { if (n) after(); }).catch(e => console.error('Tự đóng phòng họp lỗi:', e.message)); room(); setInterval(room, 60e3);
};
module.exports = { start, tick, closeRooms };
