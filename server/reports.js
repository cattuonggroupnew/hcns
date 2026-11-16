// 23 biểu mẫu đầu ra (cột H) + Mẫu 01/PLI, cảnh báo và 6 dashboard. Mọi số đều tính từ phiếu gốc, bộ lọc pháp nhân áp theo quyền người xem.
const { q, one } = require('./db');
const C = require('./core');
const B = require('./biz');
const M = require('./meta');
const { today, addDays, dayDiff, dmy } = C;
const n = B.n;
const lbl = (o, v) => (o.find(x => x[0] === v) || [])[1] || v || '';
const curMonth = () => today().slice(0, 7);
const legals = u => u.legal_ids?.length ? u.legal_ids : null;
const canPay = u => M.PAY_ROLES.includes(u.role);
function lg(u, p, col = 'legal_id', params = []) {   // lọc pháp nhân: ∩ phạm vi được phân công và bộ lọc màn hình
  const a = legals(u), w = [];
  if (a) { params.push(a); w.push(`${col} = ANY($${params.length})`); }
  if (p.legal) { params.push(+p.legal); w.push(`${col} = $${params.length}`); }
  return w.length ? ' AND ' + w.join(' AND ') : '';
}
const mq = (sql, params) => q(sql, params);
const days = (m) => `${m}-01`;
const SPEC = {
  VPP06: ['Sổ kho văn phòng phẩm', 'Tồn cuối = Tồn đầu + tổng nhập − tổng xuất; tính riêng từng pháp nhân, mã VPP.', 'Cảnh báo dưới định mức VPP04.', 'VPP01–VPP05', 'NLĐ đề xuất → CV Hành chính duyệt và cấp phát → TP HCNS kiểm tra'],
  TS02: ['Sổ quản lý tài sản', 'Trạng thái lấy theo giao dịch hợp lệ gần nhất.', 'Cảnh báo thiếu người quản lý, đang sửa chữa quá hạn.', 'TS01; TS03; TS04; TS05', 'CV HCNS cập nhật → TP HCNS kiểm tra'],
  XC02: ['Báo cáo sử dụng xe', 'Km thực chạy = km trả − km nhận.', 'Đánh dấu chi phí chưa chứng từ.', 'XC01; XC04; XC05', 'Hành chính lập → TP HCNS duyệt báo cáo tháng'],
  XC03: ['Nhắc hạn xe: bảo dưỡng – đăng kiểm – bảo hiểm', 'Ngày còn lại = ngày đến hạn − hôm nay.', 'Ngưỡng 30/7/0 ngày (cấu hình được).', 'XC01', 'Hành chính cập nhật hạn → TP HCNS theo dõi'],
  GT02: ['Sổ quản lý chuyển phát nhanh', 'Gửi đi: đếm theo trạng thái, tổng cước. Đã nhận: tổng số kiện nhận trong kỳ (sổ nhận GT03).', 'Cảnh báo thất lạc / giao trễ; hàng nhận chưa giao người nhận.', 'GT01; GT03', 'Hành chính cập nhật → TP HCNS đối soát'],
  SA04: ['Báo cáo tổng hợp suất ăn tháng', 'Chênh lệch = thực tế − đăng ký; thành tiền = suất tính phí × đơn giá.', 'Phân biệt đăng ký – thực ăn – suất tính phí.', 'SA01; đối soát bếp', 'NV bếp → CV HCNS đối soát → TP HCNS xác nhận'],
  SA05: ['Báo cáo thu chi bếp', 'Số dư cuối = đầu + thu − chi.', 'Đối soát SA04; cảnh báo thiếu chứng từ.', 'SA02; SA03; SA04', 'Quản lý bếp → CV HCNS → TP HCNS'],
  SK03: ['Báo cáo sự kiện', 'Tỷ lệ tham gia = tham gia / mời; chênh lệch = thực chi − dự toán.', 'Hoàn thiện nghiệm thu trước khi đóng.', 'SK01; Sk02', 'Đầu mối → HCNS tổng hợp → TP HCNS nghiệm thu'],
  PH02: ['Tình hình sử dụng phòng họp', 'Giờ sử dụng = kết thúc thực tế − bắt đầu.', 'Cảnh báo lịch chưa đóng.', 'PH01', 'CV HCNS / lễ tân lập → TP HCNS theo dõi'],
  XC06: ['Lịch trình sử dụng xe', 'Kiểm tra xung đột theo xe + khoảng thời gian; chỉ lịch đã duyệt mới giữ xe.', 'Màu theo trạng thái.', 'XC04; XC05; XC01', 'Người đăng ký → HCNS điều phối và duyệt'],
  TD04: ['Báo cáo tuyển dụng', 'Tỷ lệ hoàn thành = nhận việc / nhu cầu được duyệt.', 'Theo dõi quá hạn; không cộng trùng.', 'TD-01; TD02; TD03', 'CV tuyển dụng → TP HCNS → BGĐ'],
  NOP: ['Tổng hợp nộp bảo hiểm – công đoàn', 'Tổng phải nộp = BH (doanh nghiệp + người lao động, kể cả truy thu/điều chỉnh) + công đoàn nộp cấp trên; tính riêng từng pháp nhân.', 'Đối chiếu BH-01, CĐ-01.', 'BH-01; CĐ-01', 'CV BH → TP HCNS → kế toán'],
  CC14: ['Báo cáo tuân thủ tháng', 'Đi muộn / về sớm so với giờ ca; nghỉ không đơn = ngày làm việc không có công, quá 1 ngày chưa có đơn; tạo đơn muộn = đơn lập sau ngày nghỉ quá 1 ngày; văn hóa = có mặt / buổi bắt buộc; 5S = số lần ghi vi phạm.', 'Tự thống kê từ bảng công, đơn từ, điểm danh văn hóa.', 'CC03–CC12; VH01; VH02', 'HCNS rà soát → TP HCNS → trưởng bộ phận'],
  DT02: ['Báo cáo sau đào tạo', 'Tỷ lệ có mặt = số buổi có mặt / số buổi × học viên; tỷ lệ đạt = đạt / học viên có kết quả.', 'Khóa đã hủy không tính.', 'DT01 (lịch học, điểm danh, kết quả)', 'CV HCNS cập nhật → TP HCNS → BGĐ'],
  HS02: ['Sổ quản lý lao động', 'Cuối kỳ = đầu kỳ + tăng − giảm; riêng từng pháp nhân.', 'Chỉ người được phân quyền xem.', 'HS01; HD01–HD11', 'CV HCNS cập nhật → TP HCNS kiểm tra'],
  HD12: ['Tình trạng hợp đồng lao động', 'HĐ không xác định thời hạn không có ngày hết hạn, không vào cảnh báo.', 'Ngưỡng 30/15/7 ngày; phân biệt thử việc.', 'HD01–HD04; HS01', 'CV HCNS lập → TP HCNS xử lý → BGĐ xem'],
  HD13: ['Lịch sử làm việc của NLĐ', 'Nhiều chặng ở các pháp nhân; không gộp quan hệ lao động.', 'Lưu theo hiệu lực từng quyết định.', 'HS01; HD01–HD11', 'CV HCNS → TP HCNS'],
  CC12: ['Bảng tổng hợp công', 'Công thực tế theo ký hiệu CC06; ưu tiên đơn đã duyệt.', 'Chỉ chốt kỳ khi đã xử lý giải trình.', 'CC01–CC11', 'NLĐ giải trình → Trưởng BP → HCNS đối soát → TP chốt'],
  CC13: ['Bảng tăng ca', 'Giờ tính trong khung được duyệt.', 'Không tự duyệt từ máy chấm công; tách loại ngày.', 'CC09; CC10; CC12', 'NLĐ đề xuất → quản lý duyệt → HCNS tổng hợp'],
  TL05: ['Hồ sơ lương tháng', 'Thực nhận = tổng thu nhập − các khoản khấu trừ.', 'Khóa sau duyệt; BGĐ chỉ xem tổng.', 'TL01–TL04; CC12; CC13', 'CV lương → TP HCNS → BGĐ'],
  'BH-01': ['Bảng trích nộp bảo hiểm hàng tháng', 'Khoản trích = căn cứ × tỷ lệ cấu hình theo thời điểm.', 'Đối chiếu phải nộp / đã nộp.', 'HĐLĐ; bảng công; cấu hình', 'CV BH → TP HCNS → duyệt'],
  'BH-02': ['Tổng hợp trích nộp bảo hiểm theo năm', 'Công nợ = đầu kỳ + phải nộp − đã nộp.', 'Không cộng gộp số người giữa các tháng.', 'BH-01 12 kỳ', 'CV BH → TP HCNS → kế toán'],
  'CĐ-01': ['Bảng trích nộp công đoàn hàng tháng', 'Tách KPCĐ và ĐPCĐ; tỷ lệ cấu hình.', 'Quản lý riêng công ty đã/chưa có CĐCS.', 'HĐLĐ; hồ sơ CĐ', 'CV HCNS → TP HCNS → duyệt'],
  'CĐ-02': ['Tổng hợp trích nộp công đoàn theo năm', 'Số dư = đầu + được để lại − đã chi.', 'Tỷ lệ phân phối không ấn định mặc định.', 'CĐ-01', 'HCNS → TP HCNS → kế toán'],
  CCTC05: ['Định biên nhân sự', 'Thiếu/thừa = định biên − hiện có; còn thiếu trừ người đã chốt nhận việc.', 'Đối chiếu TD-01.', 'CCTC01–03, 06; kế hoạch định biên', 'Trưởng BP → HCNS → TP → BGĐ'],
  PLI: ['Báo cáo tình hình sử dụng lao động (Mẫu 01/PLI)', 'Lấy từ hồ sơ, HĐLĐ, lương đóng BH theo từng pháp nhân.', 'Gửi Sở Nội vụ, BHXH.', 'HS01; HD01–04', 'CV HCNS lập → TP HCNS ký'],
};
const R = {};

R.VPP06 = async (p, u) => {
  const m = p.month || curMonth(), first = days(m), last = B.lastDay(m), pr = [], w = lg(u, p, 'id', pr);
  const ids = (await mq(`SELECT id, short FROM hr_legal WHERE true ${w}`, pr));
  const items = Object.fromEntries((await q('SELECT code, name, unit FROM hr_vpp_item')).map(i => [i.code, i]));
  const rows = [];
  for (const l of ids) {
    const open = await B.vppStock({ q }, l.id, addDays(first, -1)), close = await B.vppStock({ q }, l.id, last);
    const inq = {}, out = {};
    for (const r of await q('SELECT lines FROM hr_vpp_in WHERE legal_id=$1 AND in_on BETWEEN $2 AND $3', [l.id, first, last])) for (const x of r.lines || []) inq[x.code] = (inq[x.code] || 0) + n(x.qty);
    for (const r of await q('SELECT lines FROM hr_vpp_issue WHERE legal_id=$1 AND issue_on BETWEEN $2 AND $3', [l.id, first, last])) for (const x of r.lines || []) out[x.code] = (out[x.code] || 0) + n(x.qty_out);
    const norms = Object.fromEntries((await q('SELECT item_code, min_qty FROM hr_vpp_norm WHERE legal_id=$1', [l.id])).map(x => [x.item_code, +x.min_qty]));
    for (const c of new Set([...Object.keys(open), ...Object.keys(inq), ...Object.keys(out), ...Object.keys(norms)])) {
      const c1 = close[c] || 0, mn = norms[c];
      rows.push({ legal: l.short, code: c, name: items[c]?.name, unit: items[c]?.unit, open: open[c] || 0, inq: inq[c] || 0, outq: out[c] || 0, close: c1, min: mn ?? '', need: mn != null && c1 < mn ? mn - c1 : '', warn: mn != null && c1 < mn ? 'Dưới định mức' : '' });
    }
  }
  rows.sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code));
  return { kpis: [['Mặt hàng có phát sinh', rows.length], ['Tổng nhập', rows.reduce((s, r) => s + r.inq, 0)], ['Tổng xuất', rows.reduce((s, r) => s + r.outq, 0)], ['Dưới định mức', rows.filter(r => r.warn).length]],
    cols: [['legal', 'Pháp nhân'], ['code', 'Mã VPP'], ['name', 'Tên hàng'], ['unit', 'ĐVT'], ['open', 'Tồn đầu kỳ', 'n'], ['inq', 'Nhập trong kỳ', 'n'], ['outq', 'Xuất trong kỳ', 'n'], ['close', 'Tồn cuối kỳ', 'n'], ['min', 'Định mức', 'n'], ['need', 'Cần mua bổ sung', 'n'], ['warn', 'Cảnh báo', 'w']], rows };
};
R.TS02 = async (p, u) => {
  const pr = [], w = lg(u, p, 'a.legal_id', pr);
  const rows = (await mq(`SELECT a.id, a.code, a.name, a.model, l.short legal, d.name dept, e.full_name holder, a.in_on, a.status, a.location, a.repair_due FROM hr_asset a LEFT JOIN hr_legal l ON l.id=a.legal_id LEFT JOIN hr_dept d ON d.id=a.dept_id LEFT JOIN hr_employee e ON e.id=a.holder_id WHERE true ${w} ORDER BY a.code`, pr))
    .map(r => ({ ...r, status_l: lbl(M.ASSET_ST, r.status), warn: !r.holder && r.status === 'dang_dung' ? 'Thiếu người quản lý' : r.status === 'sua_chua' && r.repair_due && r.repair_due < today() ? 'Sửa chữa quá hạn' : '', _e: ['asset', r.id] }));
  const c = s => rows.filter(r => r.status === s).length;
  return { kpis: [['Tổng tài sản', rows.length], ['Đang sử dụng', c('dang_dung')], ['Đang sửa chữa', c('sua_chua')], ['Chờ thanh lý', c('cho_thanh_ly')]],
    cols: [['code', 'Mã tài sản'], ['name', 'Tên tài sản'], ['model', 'Model / số seri'], ['legal', 'Pháp nhân sở hữu'], ['dept', 'Bộ phận sử dụng'], ['holder', 'Người giữ'], ['in_on', 'Ngày ghi nhận', 'd'], ['status_l', 'Trạng thái'], ['location', 'Vị trí'], ['warn', 'Cảnh báo', 'w']], rows };
};
R.XC02 = async (p, u) => {
  const m = p.month || curMonth(), pr = [m], w = lg(u, p, 'b.legal_id', pr);
  const rows = (await mq(`SELECT b.id, b.start_at, b.end_at, v.plate, e.full_name who, d.name dept, b.route, r.km_in, r.km_out, r.cost, r.cost_doc, b.status FROM hr_car_book b JOIN hr_vehicle v ON v.id=b.vehicle_id JOIN hr_employee e ON e.id=b.emp_id LEFT JOIN hr_dept d ON d.id=e.dept_id LEFT JOIN hr_car_return r ON r.book_id=b.id
    WHERE to_char(b.start_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM')=$1 AND b.status IN ('da_duyet','dang_di','da_tra') ${w} ORDER BY b.start_at`, pr))
    .map(r => ({ ...r, km: r.km_out != null ? r.km_out - r.km_in : null, warn: r.status === 'dang_di' && r.end_at < new Date().toISOString() ? 'Chưa trả xe' : r.cost > 0 && !r.cost_doc ? 'Chi phí chưa chứng từ' : '', _e: ['car_book', r.id] }));
  return { kpis: [['Số lượt sử dụng', rows.length], ['Tổng km vận hành', rows.reduce((s, r) => s + (r.km || 0), 0)], ['Chi phí phát sinh', rows.reduce((s, r) => s + (+r.cost || 0), 0), 'đ'], ['Số lượt trả muộn', rows.filter(r => r.warn === 'Chưa trả xe').length]],
    cols: [['start_at', 'Giờ đi', 'dt'], ['end_at', 'Giờ về', 'dt'], ['plate', 'Biển số'], ['who', 'Người sử dụng'], ['dept', 'Phòng ban'], ['route', 'Nơi đi – đến'], ['km_in', 'Km đầu', 'n'], ['km_out', 'Km cuối', 'n'], ['km', 'Km thực chạy', 'n'], ['cost', 'Chi phí', 'm'], ['warn', 'Cảnh báo', 'w']], rows };
};
const vehicleDue = async (u, p = {}) => {
  const pr = [], w = lg(u, p, 'v.legal_id', pr), t = today(), out = [];
  for (const v of await mq(`SELECT v.*, e.full_name owner FROM hr_vehicle v LEFT JOIN hr_employee e ON e.id=v.owner_id WHERE true ${w}`, pr))
    for (const [k, l] of [['service_to', 'Bảo dưỡng'], ['inspect_to', 'Đăng kiểm'], ['insure_to', 'Bảo hiểm']]) out.push({ id: v.id, plate: `${v.code} · ${v.plate}`, kind: l, due: v[k], left: v[k] ? dayDiff(t, v[k]) : null, owner: v.owner || '' });
  return out;
};
R.XC03 = async (p, u) => {
  const rows = (await vehicleDue(u, p)).map(r => ({ ...r, st: r.left == null ? 'Cần cập nhật dữ liệu' : r.left < 0 ? 'Quá hạn' : r.left <= 30 ? 'Sắp đến hạn' : 'Bình thường', _e: ['vehicle', r.id] })).sort((a, b) => (a.left ?? 1e9) - (b.left ?? 1e9));
  return { kpis: [['Quá hạn', rows.filter(r => r.left < 0 && r.left != null).length], ['Đến hạn ≤ 7 ngày', rows.filter(r => r.left != null && r.left >= 0 && r.left <= 7).length], ['Đến hạn 8–30 ngày', rows.filter(r => r.left > 7 && r.left <= 30).length], ['Thiếu ngày hạn', rows.filter(r => r.left == null).length]],
    cols: [['plate', 'Mã xe / biển số'], ['kind', 'Loại công việc'], ['due', 'Ngày đến hạn', 'd'], ['left', 'Còn (ngày)', 'n'], ['owner', 'Người phụ trách'], ['st', 'Tình trạng', 'w']], rows };
};
R.GT02 = async (p, u) => {
  const m = p.month || curMonth(), pr = [m], w = lg(u, p, 't.legal_id', pr);
  const rows = (await mq(`SELECT t.*, e.full_name who, d.name dept FROM hr_mail t LEFT JOIN hr_employee e ON e.id=t.emp_id LEFT JOIN hr_dept d ON d.id=t.dept_id WHERE to_char(t.send_on,'YYYY-MM')=$1 ${w} ORDER BY t.send_on`, pr)).map(r => ({ ...r, st: lbl(M.MAIL, r.status), _e: ['mail', r.id] }));
  // thư, hàng gửi ĐẾN công ty trong kỳ (sổ nhận GT03)
  const pi = [m], wi = lg(u, p, 't.legal_id', pi);
  const got = (await mq(`SELECT t.*, e.full_name who, d.name dept FROM hr_mail_in t LEFT JOIN hr_employee e ON e.id=t.emp_id LEFT JOIN hr_dept d ON d.id=t.dept_id WHERE to_char(t.got_on,'YYYY-MM')=$1 ${wi} ORDER BY t.got_on`, pi))
    .map(r => ({ ...r, kind_l: lbl(M.E.mail_in.fields.find(f => f.k === 'kind').o, r.kind), st: lbl(M.E.mail_in.fields.find(f => f.k === 'status').o, r.status), _e: ['mail_in', r.id] }));
  return { kpis: [['Số kiện đã gửi', rows.length], ['Đang vận chuyển', rows.filter(r => r.status === 'dang_chuyen').length], ['Đã giao', rows.filter(r => r.status === 'da_giao').length], ['Đã nhận', got.reduce((s, r) => s + (+r.qty || 1), 0), 'kiện'], ['Tổng cước phí', rows.reduce((s, r) => s + (+r.fee || 0), 0), 'đ']],
    cols: [['send_on', 'Ngày gửi', 'd'], ['code', 'Mã yêu cầu'], ['who', 'Người gửi'], ['dept', 'Phòng'], ['to_name', 'Người nhận'], ['bill_no', 'Mã vận đơn'], ['st', 'Trạng thái'], ['done_on', 'Ngày giao', 'd'], ['fee', 'Cước phí', 'm']], rows,
    extra: [{ title: 'Thư, hàng đã nhận trong kỳ (sổ nhận GT03)', total: 1, nosum: ['handed_on'], cols: [['got_on', 'Ngày nhận', 'd'], ['code', 'Mã nhận'], ['kind_l', 'Loại'], ['content', 'Nội dung'], ['qty', 'Số kiện', 'n'], ['from_name', 'Người / đơn vị gửi'], ['who', 'Người nhận'], ['dept', 'Bộ phận'], ['st', 'Trạng thái'], ['handed_on', 'Ngày giao người nhận', 'd']], rows: got }] };
};
R.SA04 = async (p, u) => {
  const m = p.month || curMonth(), pr = [m], w = lg(u, p, 'legal_id', pr), regs = {};
  for (const r of await mq(`SELECT legal_id, days FROM hr_meal_reg WHERE month=$1 ${w}`, pr)) for (const d of r.days || []) regs[r.legal_id + '-' + d] = (regs[r.legal_id + '-' + d] || 0) + 1;   // theo từng pháp nhân
  const rows = (await mq(`SELECT id, legal_id, day, actual, charged, price, note FROM hr_meal_day WHERE to_char(day,'YYYY-MM')=$1 ${w} ORDER BY day`, pr)).map(r => { const reg = regs[r.legal_id + '-' + +r.day.slice(8)] || 0, ch = r.charged ?? r.actual; return { ...r, reg, diff: r.actual - reg, amount: ch * r.price, _e: ['meal_day', r.id] }; });
  const sum = k => rows.reduce((s, r) => s + (+r[k] || 0), 0);
  return { kpis: [['Suất đăng ký', sum('reg')], ['Suất thực phục vụ', sum('actual')], ['Chênh lệch suất', sum('diff')], ['Chi phí bình quân / suất', sum('actual') ? Math.round(sum('amount') / sum('actual')) : 0, 'đ']],
    cols: [['day', 'Ngày', 'd'], ['reg', 'Đăng ký', 'n'], ['actual', 'Thực tế', 'n'], ['diff', 'Chênh lệch', 'n'], ['price', 'Đơn giá', 'm'], ['amount', 'Thành tiền', 'm'], ['note', 'Ghi chú']], rows, total: ['reg', 'actual', 'diff', 'amount'] };
};
R.SA05 = async (p, u) => {
  // cả công ty ăn chung một bếp: quỹ bếp tính chung, không tách theo pháp nhân (thu, chi, hỗ trợ, số dư cùng một phạm vi)
  const m = p.month || curMonth(), pr = [m], w = '', first = days(m), pr0 = [first], w0 = '';
  // công ty hỗ trợ bếp theo suất ăn thực phục vụ (SA04-N): số suất × mức hỗ trợ (Cấu hình → tiền ăn, mặc định 10.000 đ/suất) — tính vào thu, cả trong số dư các kỳ trước
  const rate = +((await C.setting('meal'))?.support ?? 10000) || 0, fmN = x => Number(x || 0).toLocaleString('vi-VN'), lastDay = mm => new Date(Date.UTC(+mm.slice(0, 4), +mm.slice(5, 7), 0)).toISOString().slice(0, 10);
  const n0 = (await mq('SELECT coalesce(sum(actual),0) n FROM hr_meal_day WHERE day < $1', [first]))[0].n, n1 = (await mq(`SELECT coalesce(sum(actual),0) n FROM hr_meal_day WHERE to_char(day,'YYYY-MM')=$1`, [m]))[0].n;   // một bếp chung: số suất không lọc theo pháp nhân
  const inA = (await mq(`SELECT coalesce(sum(amount),0) n FROM hr_meal_in WHERE month < to_char($1::date,'YYYY-MM') ${w0}`, pr0).catch(() => [{ n: 0 }]))[0].n, outA = (await mq(`SELECT coalesce(sum(amount),0) n FROM hr_meal_out WHERE pay_on < $1 ${w0}`, pr0))[0].n;
  const ins_ = (await mq(`SELECT id, got_on d, 'Thu' typ, 'Thu tiền ăn: '||name content, amount FROM hr_meal_in WHERE month=$1 ${w}`, pr)), outs = await mq(`SELECT id, pay_on d, 'Chi' typ, content, amount, doc FROM hr_meal_out WHERE to_char(pay_on,'YYYY-MM')=$1 ${w}`, pr);
  const sup = +n1 * rate, supRow = sup ? [{ d: lastDay(m), typ: 'Hỗ trợ', content: `Công ty hỗ trợ suất ăn: ${fmN(n1)} suất × ${fmN(rate)} đ`, amount: sup }] : [];
  let bal = +inA + +n0 * rate - +outA; const open = bal;
  const rows = [...ins_, ...supRow, ...outs].sort((a, b) => a.d.localeCompare(b.d)).map(r => { const i = r.typ !== 'Chi' ? +r.amount : 0, o = r.typ === 'Chi' ? +r.amount : 0; bal += i - o; return { d: r.d, typ: r.typ, content: r.content, inn: i || '', out: o || '', bal, warn: r.typ === 'Chi' && !r.doc ? 'Thiếu chứng từ' : '', ...(r.id ? { _e: [r.typ === 'Thu' ? 'meal_in' : 'meal_out', r.id] } : {}) }; });
  const ti = ins_.reduce((s, r) => s + +r.amount, 0), to = outs.reduce((s, r) => s + +r.amount, 0);
  return { kpis: [['Dư cuối kỳ trước', open, 'đ'], ['Tổng thu tiền ăn', ti, 'đ'], [`Hỗ trợ suất ăn (${fmN(n1)} suất × ${fmN(rate)} đ)`, sup, 'đ'], ['Tổng chi', to, 'đ'], ['Dư cuối kỳ', open + ti + sup - to, 'đ']], cols: [['d', 'Ngày', 'd'], ['typ', 'Loại thu/chi'], ['content', 'Nội dung'], ['inn', 'Thu (đ)', 'm'], ['out', 'Chi (đ)', 'm'], ['bal', 'Số dư', 'm'], ['warn', 'Cảnh báo', 'w']], rows };
};
R.SK03 = async (p, u) => {
  const y = String(p.year || today().slice(0, 4)), pr = [y], w = lg(u, p, 't.legal_id', pr);
  const rows = (await mq(`SELECT t.*, e.full_name host, (SELECT sum(actual_total) FROM hr_event_cost c WHERE c.event_id=t.id) actual FROM hr_event t LEFT JOIN hr_employee e ON e.id=t.host_id WHERE to_char(t.at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY')=$1 ${w} ORDER BY t.at`, pr)).map(r => ({ ...r, ratio: r.invited ? `${r.attended ?? 0} / ${r.invited}` : '', goal: r.goal_ok ? 'Đạt' : '', diff: (r.actual || 0) - (r.budget || 0), _e: ['event', r.id] }));
  const inv = rows.reduce((s, r) => s + (r.invited || 0), 0), att = rows.reduce((s, r) => s + (r.attended || 0), 0);
  return { kpis: [['Số hoạt động hoàn thành', rows.filter(r => r.status === 'dong').length], ['Tỷ lệ tham gia', inv ? Math.round(att / inv * 100) : 0, '%'], ['Dự toán', rows.reduce((s, r) => s + (+r.budget || 0), 0), 'đ'], ['Thực chi', rows.reduce((s, r) => s + (+r.actual || 0), 0), 'đ']],
    cols: [['code', 'Mã sự kiện'], ['name', 'Tên sự kiện'], ['at', 'Ngày tổ chức', 'dt'], ['host', 'Chủ trì'], ['ratio', 'Tham dự / mời'], ['goal', 'Đạt mục tiêu'], ['budget', 'Dự toán', 'm'], ['actual', 'Thực chi', 'm'], ['review', 'Đánh giá']], rows };
};
R.PH02 = async (p, u) => {
  const m = p.month || curMonth(), pr = [m], w = lg(u, p, 't.legal_id', pr);
  const rows = (await mq(`SELECT t.*, r.name room, e.full_name who FROM hr_room_book t JOIN hr_room r ON r.id=t.room_id JOIN hr_employee e ON e.id=t.emp_id WHERE to_char(t.start_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM')=$1 ${w} ORDER BY t.start_at`, pr)).map(r => { const end = r.real_end || r.end_at, h = Math.round((Date.parse(end) - Date.parse(r.start_at)) / 36e5 * 10) / 10; return { ...r, hours: h, st: lbl(M.E.room_book.fields.find(f => f.k === 'status').o, r.status), warn: r.status === 'da_duyet' && r.end_at < new Date().toISOString() ? 'Lịch chưa đóng' : '', _e: ['room_book', r.id] }; });
  const used = rows.filter(r => r.status === 'hoan_thanh'), hrs = used.reduce((s, r) => s + r.hours, 0);
  const pa = [], wa = lg(u, p, 'b.legal_id', pa);   // phòng có lịch của pháp nhân đang xem (phòng họp không gắn pháp nhân)
  const avail = (await q(`SELECT count(*) n FROM hr_room r WHERE ${wa ? `EXISTS (SELECT 1 FROM hr_room_book b WHERE b.room_id = r.id ${wa})` : 'true'}`, pa)).at(0).n * 8 * 26;
  return { kpis: [['Lượt đăng ký', rows.length], ['Lượt sử dụng', used.length], ['Giờ sử dụng', Math.round(hrs * 10) / 10], ['Tỷ lệ sử dụng khung giờ', avail ? Math.round(hrs / avail * 1000) / 10 : 0, '%']],
    cols: [['start_at', 'Bắt đầu', 'dt'], ['end_at', 'Kết thúc', 'dt'], ['room', 'Phòng họp'], ['who', 'Người đăng ký'], ['host', 'Người chủ trì'], ['hours', 'Thời lượng (giờ)', 'n'], ['st', 'Trạng thái'], ['service', 'Phục vụ hậu cần'], ['warn', 'Cảnh báo', 'w']], rows };
};
R.XC06 = async (p, u) => {
  const m = p.month || curMonth(), pr = [m], w = lg(u, p, 't.legal_id', pr), o = M.E.car_book.fields.find(f => f.k === 'status').o;
  const rows = (await mq(`SELECT t.*, v.plate, e.full_name who, d.name dept FROM hr_car_book t JOIN hr_vehicle v ON v.id=t.vehicle_id JOIN hr_employee e ON e.id=t.emp_id LEFT JOIN hr_dept d ON d.id=e.dept_id WHERE to_char(t.start_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM')=$1 ${w} ORDER BY t.start_at`, pr)).map(r => ({ ...r, st: lbl(o, r.status), _e: ['car_book', r.id] }));
  const held = rows.filter(r => ['da_duyet', 'dang_di'].includes(r.status));
  const clash = held.filter((a, i) => held.some((b, j) => j !== i && a.vehicle_id === b.vehicle_id && a.start_at < b.end_at && b.start_at < a.end_at)).length;
  const pv = [], wv = lg(u, p, 'legal_id', pv);   // xe theo pháp nhân sở hữu
  return { kpis: [['Xe sẵn sàng', (await q(`SELECT count(*) n FROM hr_vehicle WHERE state='san_sang' ${wv}`, pv))[0].n], ['Xe đã đặt', held.length], ['Lịch trùng', clash], ['Lượt đang sử dụng', rows.filter(r => r.status === 'dang_di').length]],
    cols: [['start_at', 'Từ', 'dt'], ['end_at', 'Đến', 'dt'], ['plate', 'Xe / biển số'], ['who', 'Người đăng ký'], ['dept', 'Phòng ban'], ['route', 'Hành trình'], ['st', 'Trạng thái duyệt'], ['reason', 'Ghi chú']], rows };
};
﻿R.TD04 = async (p, u) => {
  // lọc thời gian: ứng viên theo ngày nhận hồ sơ, kế hoạch theo ngày yêu cầu (trống = tất cả)
  const D = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null, from = D(p.from), to = D(p.to), inR = d => (!from || (d && d >= from)) && (!to || (d && d <= to));
  const pr = [], w = lg(u, p, 'p.legal_id', pr);
  const plans = await mq(`SELECT p.*, l.short legal, d.name dept FROM hr_rec_plan p JOIN hr_legal l ON l.id=p.legal_id LEFT JOIN hr_dept d ON d.id=p.dept_id WHERE coalesce(p.rec_state,'') <> 'hoan' ${w} ORDER BY p.due_on`, pr);
  const pr2 = [], w2 = lg(u, p, 'coalesce(p.legal_id, c.legal_id)', pr2);
  const cands = (await mq(`SELECT c.plan_id, c.status, c.got_on, coalesce(nullif(c.source,''), CASE WHEN p.channel NOT LIKE '%,%' THEN nullif(p.channel,'') END, 'Không rõ') ch FROM hr_candidate c LEFT JOIN hr_rec_plan p ON p.id = c.plan_id WHERE (p.id IS NULL OR coalesce(p.rec_state,'') <> 'hoan') ${w2}`, pr2)).filter(c => inR(c.got_on));
  const ST = { cv: ['S12'], cho_pv: ['S33'], pv: ['S34', 'S35', 'S36', 'S52', 'S53', 'S60'], pass: ['S35', 'S36', 'S52', 'S53', 'S60'], cho_nv: ['S53'], got: ['S53', 'S60'], nv: ['S60'], ko: ['S11', 'S21', 'S24'] };
  const cnt = xs => Object.fromEntries(Object.entries(ST).map(([k, s]) => [k, xs.filter(c => s.includes(c.status)).length]));
  const rows = plans.filter(r => !from && !to || inR(r.req_on) || cands.some(c => c.plan_id === r.id)).map(r => { const xs = cands.filter(c => c.plan_id === r.id); return { ...r, cand: xs.length, ...cnt(xs), warn: r.due_on < today() && cnt(xs).got < r.qty ? 'Quá hạn tuyển' : '', _e: ['rec_plan', r.id] }; });
  const need = rows.reduce((s, r) => s + r.qty, 0), got = rows.reduce((s, r) => s + r.got, 0);
  // theo kênh: ứng viên theo nguồn (không ghi thì kênh của kế hoạch); chi phí = ngân sách / đã chi từng kênh trong kế hoạch
  const by = {}, at = k => by[k] ||= { channel: k, cand: 0, budget: 0, spent: 0, list: [] };
  for (const c of cands) { at(c.ch).cand++; at(c.ch).list.push(c); }
  for (const r of rows) { const chs = (r.channels || []).filter(x => x.channel); if (chs.length) for (const x of chs) { at(x.channel).budget += n(x.budget); at(x.channel).spent += n(x.spent); } else if (r.cost) at(r.channel || 'Không rõ').budget += +r.cost; }
  const ch = Object.values(by).map(x => { const c = cnt(x.list), cost = x.spent || x.budget; return { channel: x.channel, cand: x.cand, ...c, rate: c.pv ? Math.round(c.pass / c.pv * 100) + '%' : '', budget: x.budget, spent: x.spent, per: c.got && cost ? Math.round(cost / c.got) : null }; }).sort((a, b) => b.cand - a.cand);
  return { kpis: [['Nhu cầu tuyển', need], ['Ứng viên nhận', cands.length], ['Nhận việc', got], ['Tỷ lệ hoàn thành tuyển', need ? Math.round(got / need * 100) : 0, '%']],
    note: from || to ? `Kỳ: ${from ? dmy(from) : '…'} → ${to ? dmy(to) : '…'} (ứng viên theo ngày nhận hồ sơ)` : '',
    cols: [['position', 'Vị trí'], ['legal', 'Pháp nhân'], ['dept', 'Phòng ban'], ['channel', 'Kênh'], ['qty', 'Cần tuyển', 'n'], ['cand', 'Ứng viên', 'n'], ['cv', 'Nộp CV', 'n'], ['cho_pv', 'Chờ PV', 'n'], ['pv', 'Đã PV', 'n'], ['cho_nv', 'Chờ nhận việc', 'n'], ['nv', 'Đã nhận việc', 'n'], ['ko', 'Không đạt', 'n'], ['cost', 'Ngân sách', 'm'], ['due_on', 'Ngày cần', 'd'], ['warn', 'Cảnh báo', 'w']], rows, total: 1, nosum: ['due_on'],
    extra: [{ title: 'Theo kênh tuyển dụng: số ứng viên từng bước, chi phí', total: 1, nosum: ['rate', 'per'], cols: [['channel', 'Kênh'], ['cand', 'Số ứng viên', 'n'], ['cv', 'Nộp CV', 'n'], ['cho_pv', 'Chờ PV', 'n'], ['pv', 'Đã PV', 'n'], ['pass', 'Đạt', 'n'], ['rate', 'Tỷ lệ đạt / PV'], ['cho_nv', 'Chờ nhận việc', 'n'], ['nv', 'Đã nhận việc', 'n'], ['ko', 'Không đạt', 'n'], ['budget', 'Ngân sách', 'm'], ['spent', 'Đã chi', 'm'], ['per', 'Chi phí / người tuyển được', 'm']], rows: ch }] };
};
const staffRows = async (u, p, m) => {
  const last = B.lastDay(m), pr = [last, m + '-01'], w = lg(u, p, 'e.legal_id', pr); let dw = ''; if (p.dept) { pr.push(+p.dept); dw = ` AND e.dept_id=$${pr.length}`; }
  return mq(`SELECT e.*, l.short legal, d.name dept, (SELECT kind FROM hr_contract c WHERE c.emp_id=e.id AND c.kind<>'HD04' ORDER BY c.from_on DESC LIMIT 1) ckind FROM hr_employee e JOIN hr_legal l ON l.id=e.legal_id LEFT JOIN hr_dept d ON d.id=e.dept_id WHERE e.join_on <= $1 AND (e.leave_on IS NULL OR e.leave_on >= $2) ${w}${dw} ORDER BY (e.code !~ '^[A-Za-z]+[0-9]+$'), e.code`, pr);
};
const stL = v => lbl(M.E.employee.fields.find(f => f.k === 'state').o, v);
// báo cáo tuân thủ tháng: văn hóa (thể dục…), chấm công (đi muộn, về sớm, nghỉ không đơn / tạo đơn muộn quá 1 ngày), 5S — tự thống kê từ dữ liệu
R.CC14 = async (p, u) => {
  const m = p.month || curMonth(), f = m + '-01', l = B.lastDay(m), t = today(), upto = l < t ? l : addDays(t, -1), s = await staffRows(u, p, m), hol = await B.holidays({ q });
  const wd = []; for (let d = f; d <= upto; d = addDays(d, 1)) if (B.isWorkday(d, hol)) wd.push(d);
  const ids = s.map(e => e.id), shifts = await q('SELECT code, from_t, to_t, members FROM hr_shift'), hc = shifts.find(x => /^HC/i.test(x.code)) || { from_t: '08:00', to_t: '17:30' };
  const shiftOf = e => shifts.find(x => (x.members || []).some(mm => mm.code === e.code)) || hc;
  const att = await q("SELECT emp_id, day, mark, in_t::text i, out_t::text o FROM hr_attendance WHERE emp_id = ANY($1) AND day BETWEEN $2 AND $3", [ids, f, l]);
  const cover = [...await q("SELECT emp_id, from_on, to_on, created_at, status FROM hr_leave WHERE emp_id = ANY($1) AND status <> 'tu_choi' AND from_on <= $3 AND to_on >= $2", [ids, f, l]), ...await q("SELECT emp_id, from_on, to_on, NULL created_at, status FROM hr_trip WHERE emp_id = ANY($1) AND status <> 'tu_choi' AND from_on <= $3 AND to_on >= $2", [ids, f, l])];
  const acts = await q("SELECT * FROM hr_culture WHERE required AND from_on <= $2 AND to_on >= $1", [f, l]), logs = await q('SELECT act_id, emp_id, day, result FROM hr_culture_log WHERE day BETWEEN $1 AND $2', [f, l]);
  const vn = x => x && new Date(new Date(x).getTime() + 7 * 3600e3).toISOString().slice(0, 10), hhmm = x => String(x || '').slice(0, 5);
  const rows = s.map(e => {
    const a = att.filter(x => x.emp_id === e.id), sh = shiftOf(e), from = e.join_on > f ? e.join_on : f, mine = wd.filter(d => d >= from && (!e.leave_on || d <= e.leave_on));
    const late = a.filter(x => x.i && hhmm(x.i) > hhmm(sh.from_t)).length, early = a.filter(x => x.o && x.mark === 'HC' && hhmm(x.o) < hhmm(sh.to_t)).length;
    const cv = cover.filter(x => x.emp_id === e.id), covered = d => cv.some(x => x.from_on <= d && x.to_on >= d);
    const noReq = mine.filter(d => addDays(d, 1) < t && !covered(d) && !a.some(x => x.day === d && !['XX', 'KC'].includes(x.mark))).length;   // vắng, quá 1 ngày vẫn chưa có đơn
    const lateReq = cv.filter(x => x.created_at && vn(x.created_at) > addDays(x.from_on, 1)).length;   // đơn tạo sau ngày nghỉ quá 1 ngày
    let need = 0, came = 0; for (const ac of acts.filter(x => x.kind !== 's5' && B.cultureFits(x, e))) for (const d of mine) if (B.cultureOn(ac, d)) { need++; if (logs.some(g => g.act_id === ac.id && g.emp_id === e.id && g.day === d && g.result === 'co_mat')) came++; }
    const v5 = logs.filter(g => g.emp_id === e.id && g.result === 'vi_pham' && acts.some(x => x.id === g.act_id && x.kind === 's5')).length;
    const total = late + early + noReq + lateReq + (need - came) + v5;
    return { code: e.code, name: e.full_name, dept: e.dept || 'Chưa gán phòng', legal: e.legal, cul: need ? `${came}/${need}` : '', cul_miss: need - came, late, early, no_req: noReq, late_req: lateReq, v5, total, st: total ? 'Cần nhắc nhở' : 'Đạt', _e: ['employee', e.id] };
  }).sort((a, b) => b.total - a.total || a.code.localeCompare(b.code));
  const S = k => rows.reduce((x, r) => x + (+r[k] || 0), 0);
  const per = acts.map(ac => { let need = 0, came = 0; for (const e of s.filter(e => B.cultureFits(ac, e))) for (const d of wd.filter(d => d >= (e.join_on > f ? e.join_on : f))) if (B.cultureOn(ac, d)) { need++; if (logs.some(g => g.act_id === ac.id && g.emp_id === e.id && g.day === d && g.result === 'co_mat')) came++; }
    const v = logs.filter(g => g.act_id === ac.id && g.result === 'vi_pham').length; return { code: ac.code, name: ac.name, kind: { the_duc: 'Thể dục', s5: '5S', van_hoa: 'Văn hóa khác' }[ac.kind], time: `${ac.from_t}–${ac.to_t}`, need, came, rate: need ? Math.round(came / need * 100) + '%' : '', v, _e: ['culture', ac.id] }; });
  return { kpis: [['Nhân sự cần nhắc nhở', `${rows.filter(r => r.total).length}/${rows.length}`], ['Đi muộn / về sớm (lượt)', `${S('late')} / ${S('early')}`], ['Nghỉ không đơn / tạo đơn muộn', `${S('no_req')} / ${S('late_req')}`], ['Vắng hoạt động văn hóa · vi phạm 5S', `${S('cul_miss')} · ${S('v5')}`]],
    cols: [['code', 'Mã NV'], ['name', 'Họ tên'], ['dept', 'Bộ phận'], ['legal', 'Pháp nhân'], ['cul', 'Văn hóa (có mặt / yêu cầu)'], ['cul_miss', 'Vắng hoạt động', 'n'], ['late', 'Đi muộn', 'n'], ['early', 'Về sớm', 'n'], ['no_req', 'Nghỉ không đơn', 'n'], ['late_req', 'Tạo đơn muộn (>1 ngày)', 'n'], ['v5', 'Vi phạm 5S', 'n'], ['total', 'Tổng vi phạm', 'n'], ['st', 'Đánh giá', 'w']], rows, total: 1, nosum: ['cul'],
    note: `Tính đến ${C.dmy(upto)} · giờ làm theo ca (mặc định ${hc.from_t}–${hc.to_t}) · chỉ tính hoạt động «bắt buộc»`,
    extra: [{ title: 'Theo hoạt động văn hóa', cols: [['code', 'Mã'], ['name', 'Hoạt động'], ['kind', 'Loại'], ['time', 'Khung giờ'], ['need', 'Lượt yêu cầu', 'n'], ['came', 'Có mặt', 'n'], ['rate', 'Tỷ lệ'], ['v', 'Vi phạm 5S', 'n']], rows: per }] };
};
R.DT02 = async (p, u) => {   // theo khóa (trong kỳ) + chi tiết từng học viên
  const y = (p.month || curMonth()).slice(0, 4), from = p.from || `${y}-01-01`, to = p.to || `${y}-12-31`, pr = [from, to], w = lg(u, p, 't.legal_id', pr);
  const kl = Object.fromEntries(M.E.training.fields.find(f => f.k === 'kind').o), sl = Object.fromEntries(M.E.training.fields.find(f => f.k === 'state').o.map(o => [o[0], o[1]]));
  const ts = await mq(`SELECT t.* FROM hr_training t WHERE t.from_on <= $2 AND coalesce(t.to_on, t.from_on) >= $1 AND coalesce(t.state,'') <> 'huy' ${w} ORDER BY t.from_on`, pr), rows = [], det = [];
  for (const t of ts) {
    const es = (t.emps || []).filter(x => x.code), n = (t.sched || []).length, pres = es.reduce((s, x) => s + ((t.att || {})[x.code] || []).filter(Boolean).length, 0), got = es.filter(x => x.result), pass = got.filter(x => x.result === 'Đạt').length;
    rows.push({ code: t.code, name: t.name, kind: kl[t.kind] || t.kind, from: t.from_on, to: t.to_on, ses: n || t.sessions, hours: t.hours, stu: es.length, att: n && es.length ? Math.round(pres / (n * es.length) * 100) + '%' : '', pass, rate: got.length ? Math.round(pass / got.length * 100) + '%' : '', cost: canPay(u) || u.role === 'bgd' ? t.cost : '', st: sl[t.state] || '', _e: ['training', t.id] });
    for (const x of es) det.push({ code: x.code, name: x.name, course: t.name, from: t.from_on, att: n ? `${((t.att || {})[x.code] || []).filter(Boolean).length}/${n}` : '', result: x.result || 'Chưa có', score: x.score || '', _e: ['training', t.id] });
  }
  return { kpis: [['Số khóa', rows.length], ['Lượt học viên', det.length], ['Đạt', det.filter(x => x.result === 'Đạt').length], ['Chưa có kết quả', det.filter(x => x.result === 'Chưa có').length]],
    cols: [['code', 'Mã khóa'], ['name', 'Khóa đào tạo'], ['kind', 'Loại'], ['from', 'Từ ngày', 'd'], ['to', 'Đến ngày', 'd'], ['ses', 'Số buổi', 'n'], ['hours', 'Số giờ', 'n'], ['stu', 'Học viên', 'n'], ['att', 'Tỷ lệ có mặt'], ['pass', 'Đạt', 'n'], ['rate', 'Tỷ lệ đạt'], ['cost', 'Chi phí', 'm'], ['st', 'Tình trạng']], rows, total: 1, nosum: ['from', 'to', 'att', 'rate'],
    extra: [{ title: 'Kết quả từng học viên (lịch sử đào tạo)', cols: [['code', 'Mã NV'], ['name', 'Họ tên'], ['course', 'Khóa'], ['from', 'Ngày học', 'd'], ['att', 'Có mặt'], ['result', 'Kết quả'], ['score', 'Điểm / nhận xét']], rows: det.sort((a, b) => a.code.localeCompare(b.code) || String(a.from).localeCompare(b.from)) }] };
};
R.HS02 = async (p, u) => {
  const m = p.month || curMonth(), s = await staffRows(u, p, m), f = m + '-01', l = B.lastDay(m);
  const inc = s.filter(e => e.join_on >= f && e.join_on <= l).length, dec = s.filter(e => e.leave_on && e.leave_on >= f && e.leave_on <= l).length, ini = s.length - inc;
  // chứng từ pháp lý theo pháp nhân: chức danh / bộ phận theo HĐLĐ và quyết định đã duyệt (thuyên chuyển nội bộ không làm đổi sổ)
  const doc = {}, dn = Object.fromEntries((await q('SELECT id, name FROM hr_dept')).map(x => [x.id, x.name]));
  for (const e of s) {
    const ev = [...(await q("SELECT from_on, title, NULL::int dept_id FROM hr_contract WHERE emp_id=$1 AND from_on <= $2 AND title IS NOT NULL", [e.id, l])), ...(await q("SELECT from_on, title, dept_id FROM hr_decision WHERE emp_id=$1 AND status='da_duyet' AND from_on <= $2 AND kind IN ('HD05','HD06','HD07')", [e.id, l]))].sort((a, b) => String(a.from_on).localeCompare(b.from_on));
    const tr = await one("SELECT from_title, from_dept_id FROM hr_transfer WHERE emp_id=$1 AND applied ORDER BY from_on, id LIMIT 1", [e.id]);   // trước thuyên chuyển đầu tiên
    const t = ev.filter(x => x.title).pop()?.title || tr?.from_title || e.title, d = ev.filter(x => x.dept_id).pop()?.dept_id || tr?.from_dept_id || e.dept_id;
    doc[e.id] = `${t || ''} / ${dn[d] || 'Chưa gán'}`;
  }
  const pay = canPay(u), rows = s.map(e => ({ code: e.code, name: e.full_name, dob: M.PII_ROLES.includes(u.role) ? e.dob : '', gender: e.gender, title: doc[e.id], legal: e.legal, join: e.join_on, ck: e.ckind || '', sal: pay ? e.ins_salary : '', st: stL(e.state), _e: ['employee', e.id] }));
  return { kpis: [['Lao động đầu kỳ', ini], ['Tăng trong kỳ', inc], ['Giảm trong kỳ', dec], ['Lao động cuối kỳ', ini + inc - dec]], cols: [['code', 'Mã NV'], ['name', 'Họ tên'], ['dob', 'Ngày sinh', 'd'], ['gender', 'Giới tính'], ['title', 'Chức danh / bộ phận'], ['legal', 'Pháp nhân'], ['join', 'Ngày bắt đầu', 'd'], ['ck', 'Loại HĐLĐ'], ['sal', 'Tiền lương HĐ', 'm'], ['st', 'Trạng thái']], rows };
};
R.HD12 = async (p, u) => {
  const pr = [], w = lg(u, p, 'c.legal_id', pr), t = today(), o = M.E.contract.fields.find(f => f.k === 'kind').o;
  const rows = (await mq(`SELECT c.*, e.code ec, e.full_name, l.short legal FROM hr_contract c JOIN hr_employee e ON e.id=c.emp_id JOIN hr_legal l ON l.id=c.legal_id WHERE c.state IN ('hieu_luc','cho_quyet_dinh') AND c.kind<>'HD04' AND e.state<>'da_nghi' ${w} ORDER BY c.to_on NULLS LAST`, pr)).map(c => {
    const left = c.to_on ? dayDiff(t, c.to_on) : null, need = ['HD01', 'HD02'].includes(c.kind) && !c.to_on;
    return { ec: c.ec, name: c.full_name, legal: c.legal, kind: lbl(o, c.kind).split(' · ')[1], no: c.no, sign: c.sign_on, from: c.from_on, to: c.to_on, left, st: need ? 'Cần cập nhật dữ liệu' : left == null ? 'Không xác định thời hạn' : left < 0 ? 'Quá hạn' : left <= 30 ? 'Sắp đến hạn' : 'Hiệu lực', _e: ['contract', c.id] };
  });
  return { kpis: [['HĐ đang hiệu lực', rows.length], ['Sắp hết hạn ≤ 30 ngày', rows.filter(r => r.st === 'Sắp đến hạn').length], ['Đã hết hạn', rows.filter(r => r.st === 'Quá hạn').length], ['Chưa cập nhật hồ sơ', rows.filter(r => r.st === 'Cần cập nhật dữ liệu').length]],
    cols: [['ec', 'Mã NV'], ['name', 'Họ tên'], ['legal', 'Pháp nhân ký HĐ'], ['kind', 'Loại HĐ'], ['no', 'Số HĐ'], ['sign', 'Ngày ký', 'd'], ['from', 'Ngày hiệu lực', 'd'], ['to', 'Ngày hết hạn', 'd'], ['left', 'Còn (ngày)', 'n'], ['st', 'Tình trạng', 'w']], rows };
};
R.HD13 = async (p, u) => {
  const pr = [], w = lg(u, p, 'e.legal_id', pr); let f = ''; if (p.emp) { pr.push(+p.emp); f = ` AND e.id=$${pr.length}`; }
  const rows = [];
  const scope = M.E.employee; const sc = []; C.scopeSql(scope, u, (s, ...v) => { let i = 0; sc.push(s.replace(/\$(\d+)/g, () => '$' + (pr.push(v[i++]), pr.length)).replace(/\bt\./g, 'e.')); });
  const es = await mq(`SELECT e.*, l.short legal, d.name dept FROM hr_employee e JOIN hr_legal l ON l.id=e.legal_id LEFT JOIN hr_dept d ON d.id=e.dept_id WHERE true ${w}${f}${sc.length ? ' AND ' + sc.join(' AND ') : ''} ORDER BY (e.code !~ '^[A-Za-z]+[0-9]+$'), e.code`, pr);
  for (const e of es) {
    for (const c of await q('SELECT c.*, l.short FROM hr_contract c JOIN hr_legal l ON l.id=c.legal_id WHERE c.emp_id=$1 ORDER BY c.from_on', [e.id])) rows.push({ _c: e.code, name: e.full_name, from: c.from_on, to: c.to_on, legal: c.short, dept: e.dept, title: c.title || e.title, kind: { HD01: 'Thử việc', HD02: 'HĐLĐ có thời hạn', HD03: 'HĐLĐ không thời hạn', HD04: 'Phụ lục' }[c.kind], no: c.no, _e: ['contract', c.id] });
    for (const d of await q("SELECT d.*, l.short, x.name dn FROM hr_decision d LEFT JOIN hr_legal l ON l.id=d.legal_id LEFT JOIN hr_dept x ON x.id=d.dept_id WHERE d.emp_id=$1 AND d.status='da_duyet' ORDER BY d.from_on", [e.id])) rows.push({ _c: e.code, name: e.full_name, from: d.from_on, to: null, legal: d.short || e.legal, dept: d.dn || e.dept, title: d.title || e.title, kind: { HD05: 'Điều chuyển', HD06: 'Bổ nhiệm', HD07: 'Miễn nhiệm', HD08: 'Điều chỉnh lương', HD10: 'Chấm dứt HĐLĐ', HD11: 'Chấm dứt thử việc' }[d.kind] + (d.kind === 'HD08' && canPay(u) ? ` — P1 ${d.new_p1 != null ? (+d.new_p1).toLocaleString('vi-VN') : '—'}${d.new_p2 != null ? ', P2 ' + (+d.new_p2).toLocaleString('vi-VN') : ''}` : ''), no: d.no, _e: ['decision', d.id] });
    // thuyên chuyển nội bộ (HS03) đã duyệt: một chặng mới (phần không đổi giữ như trước khi chuyển)
    for (const t of await q("SELECT t.*, l.short, x.name dn FROM hr_transfer t LEFT JOIN hr_legal l ON l.id=coalesce(t.to_legal_id, t.from_legal_id) LEFT JOIN hr_dept x ON x.id=coalesce(t.to_dept_id, t.from_dept_id) WHERE t.emp_id=$1 AND t.status='da_duyet' ORDER BY t.from_on", [e.id])) rows.push({ _c: e.code, name: e.full_name, from: t.from_on, to: null, legal: t.short || e.legal, dept: t.dn || e.dept, title: t.to_title || t.from_title || e.title, kind: 'Thuyên chuyển nội bộ', no: t.dec_no || t.code, _e: ['transfer', t.id] });
    // lịch sử đào tạo: khóa có tên người này, kèm kết quả
    for (const t of await q("SELECT id, code, name, from_on, to_on, emps FROM hr_training WHERE emps @> $1::jsonb AND coalesce(state,'') <> 'huy' ORDER BY from_on", [JSON.stringify([{ code: e.code }])])) { const x = (t.emps || []).find(y => y.code === e.code) || {};
      rows.push({ _c: e.code, name: e.full_name, from: t.from_on, to: t.to_on, legal: e.legal, dept: e.dept, title: e.title, kind: `Đào tạo: ${t.name}${x.result ? ' — ' + x.result : ''}${x.score ? ' (' + x.score + ')' : ''}`, no: t.code, _e: ['training', t.id] }); }
  }
  rows.sort((a, b) => a._c.length - b._c.length || a._c.localeCompare(b._c) || String(a.from).localeCompare(b.from));   // theo mã NV
  const idOf = Object.fromEntries(es.map(e => [e.code, e.id])); for (const r of rows) r._h = idOf[r._c];   /* bấm dòng → hộp «Lịch sử làm việc» của người đó (CV + nội bộ) */
  const e0 = es.length === 1 ? es[0] : null, yrs = e0 ? Math.floor(dayDiff(e0.join_on, today()) / 365.25 * 10) / 10 : '';
  return { kpis: [['Ngày vào làm', e0 ? dmy(e0.join_on) : `${es.length} người`], ['Thâm niên', e0 ? yrs + ' năm' : '—'], ['Pháp nhân hiện tại', e0?.legal || '—'], ['Chức danh hiện tại', e0?.title || '—']], cols: [['name', 'Họ tên'], ['from', 'Từ ngày', 'd'], ['to', 'Đến ngày', 'd'], ['legal', 'Pháp nhân'], ['dept', 'Phòng ban'], ['title', 'Chức danh'], ['kind', 'Loại biến động'], ['no', 'Số HĐ/QĐ']], rows };
};
R.CC12 = async (p, u) => {
  const m = p.month || curMonth(), s = await staffRows(u, p, m), a = await B.monthAtt({ q }, m), hol = await B.holidays({ q }), last = +B.lastDay(m).slice(8); let std = 0; for (let d = 1; d <= last; d++) if (B.isWorkday(`${m}-${String(d).padStart(2, '0')}`, hol)) std++;
  const pend = Object.fromEntries((await q(`SELECT emp_id, count(*) n FROM hr_explain WHERE to_char(day,'YYYY-MM')=$1 AND status IN ('nhap','cho_duyet') GROUP BY 1`, [m])).map(r => [r.emp_id, r.n]));
  const ots = Object.fromEntries((await q(`SELECT emp_id, sum(hours_ok) h FROM hr_ot WHERE to_char(day,'YYYY-MM')=$1 AND status='da_duyet' GROUP BY 1`, [m])).map(r => [r.emp_id, +r.h]));
  const rows = s.map(e => { const x = a[e.id] || { work: 0, paid_leave: 0, unpaid: 0, miss: 0 }; return { code: e.code, name: e.full_name, dept: e.dept, std, work: x.work, leave: x.paid_leave, unpaid: x.unpaid, ot: ots[e.id] || 0, st: !a[e.id] ? 'Chưa có dữ liệu' : pend[e.id] ? `Còn ${pend[e.id]} giải trình` : x.miss ? `Thiếu công ${x.miss} lượt` : 'Đã đối soát', _e: ['employee', e.id] }; });
  const pr = [m], w = lg(u, p, 'legal_id', pr), per = await mq(`SELECT status FROM hr_att_period WHERE month=$1 ${w}`, pr);
  return { kpis: [['Tổng ngày công', rows.reduce((t, r) => t + r.work, 0)], ['Ngày nghỉ phép', rows.reduce((t, r) => t + r.leave, 0)], ['Lượt thiếu công', s.reduce((t, e) => t + (a[e.id]?.miss || 0), 0)], ['Tình trạng chốt kỳ', `${per.filter(x => x.status === 'khoa').length}/${per.length} khóa`]],
    cols: [['code', 'Mã NV'], ['name', 'Họ tên'], ['dept', 'Phòng ban'], ['std', 'Công chuẩn', 'n'], ['work', 'Công thực tế', 'n'], ['leave', 'Phép hưởng lương', 'n'], ['unpaid', 'Nghỉ không lương', 'n'], ['ot', 'Tăng ca (giờ)', 'n'], ['st', 'Trạng thái đối soát']], rows };
};
R.CC13 = async (p, u) => {
  const m = p.month || curMonth(), pr = [m], w = lg(u, p, 'e.legal_id', pr), o = { thuong: 'Ngày thường', nghi: 'Ngày nghỉ', le: 'Lễ/tết' };
  const rows = (await mq(`SELECT t.*, e.code ec, e.full_name, d.name dept FROM hr_ot t JOIN hr_employee e ON e.id=t.emp_id LEFT JOIN hr_dept d ON d.id=e.dept_id WHERE to_char(t.day,'YYYY-MM')=$1 AND t.status='da_duyet' ${w} ORDER BY t.day`, pr)).map(r => ({ ...r, dk: o[r.day_kind], _e: ['ot', r.id] }));
  const s = k => rows.filter(r => !k || r.day_kind === k).reduce((t, r) => t + (+r.hours_ok || 0), 0);
  return { kpis: [['Tổng giờ tăng ca', s()], ['Giờ ngày thường', s('thuong')], ['Giờ ngày nghỉ', s('nghi')], ['Giờ lễ/tết', s('le')]], cols: [['day', 'Ngày', 'd'], ['ec', 'Mã NV'], ['full_name', 'Họ tên'], ['dept', 'Bộ phận'], ['dk', 'Loại ngày'], ['hours_reg', 'Giờ đăng ký', 'n'], ['hours_real', 'Giờ thực tế', 'n'], ['hours_ok', 'Giờ được duyệt', 'n'], ['task', 'Công việc']], rows };
};
// lương – BH – CĐ: từng người, đúng nhóm cột như file mẫu; groups = dòng tiêu đề nhóm [nhãn | null, số cột]; total = dòng TỔNG CỘNG
const canIns = u => canPay(u) || u.role === 'ke_toan';
const runsOf = (tbl, m, u, p) => { const pr = [m], w = lg(u, p, 't.legal_id', pr); return mq(`SELECT t.*, l.short FROM ${tbl} t JOIN hr_legal l ON l.id=t.legal_id WHERE t.month=$1 ${w} ORDER BY l.id`, pr); };
const pc = v => String(v).replace('.', ',') + '%';
R.TL05 = async (p, u) => {
  const m = p.month || curMonth(), o = M.E.payroll.fields.find(f => f.k === 'status').o, runs = await runsOf('hr_payroll', m, u, p);
  const all = runs.flatMap(r => (r.lines || []).map(l => ({ ...l, legal: r.short, _e: ['payroll', r.id] })));
  const S = k => all.reduce((s, l) => s + (+l[k] || 0), 0);
  const rows = canPay(u) ? all.map(l => ({ code: l.code, name: l.name, legal: l.legal, dept: l.dept || '', days: (+l.d100 || 0) + (+l.d85 || 0), gross: l.gross_base, meal: l.meal, ot: l.ot_pay || 0, other: (+l.trip_pay || 0) + (+l.bday || 0) + (+l.leave_pay || 0) + (+l.bonus || 0), total: l.total,
    ins: l.e_ins, tax: l.tax, ded: (+l.tax_adj || 0) + (+l.advance || 0) + (+l.other_ded || 0), net: l.net, comp: (l.c_bhxh || 0) + (l.c_bhyt || 0) + (l.c_bhtn || 0) + (l.c_kpcd || 0), pay: l.acct ? 'Chuyển khoản' : 'Tiền mặt', gl: l.gl || '', _e: l._e })) : [];
  return { kpis: [['Tổng lương phải trả', S('total'), 'đ'], ['Các khoản phải trừ', S('all_ded'), 'đ'], ['Thực lĩnh', S('net'), 'đ'], ['Trạng thái', runs.map(r => `${r.short}: ${lbl(o, r.status)}`).join(' · ') || 'Chưa lập']],
    cols: [['code', 'Mã NV'], ['name', 'Họ tên'], ['legal', 'Pháp nhân'], ['dept', 'Bộ phận'], ['days', 'Công tính lương', 'n'], ['gross', 'Lương thực nhận P1+P2', 'm'], ['meal', 'Ăn ca', 'm'], ['ot', 'Làm thêm giờ', 'm'], ['other', 'Công tác phí, thưởng', 'm'], ['total', 'Tổng lương phải trả', 'm'], ['ins', 'BHXH, BHYT, BHTN', 'm'], ['tax', 'Thuế TNCN', 'm'], ['ded', 'Tạm ứng, khấu trừ khác', 'm'], ['net', 'Thực lĩnh', 'm'], ['comp', 'Công ty đóng BH + KPCĐ', 'm'], ['pay', 'Chi lương'], ['gl', 'TK hạch toán']],
    groups: [[null, 5], ['Thu nhập', 5], ['Khấu trừ', 3], [null, 1], [null, 1], [null, 2]], rows, total: 1, note: canPay(u) ? '' : 'Vai trò của bạn chỉ xem số tổng; lương cá nhân được ẩn.' };
};
R['BH-01'] = async (p, u) => {
  const m = p.month || curMonth(), rows = [], show = canIns(u), sh = await runsOf('hr_ins_sheet', m, u, p), rt = sh[0]?.rates || await C.setting('ins') || {};
  let base = 0, dn = 0, nld = 0;
  for (const s of sh) for (const l of s.lines || []) {
    const x = B.insRow(l, s.rates); if (l.change !== 'Báo giảm') { base += +l.salary || 0; dn += x.dn; nld += x.nld; }
    rows.push(show ? { legal: s.short, name: l.name, ins_no: l.ins_no || '', title: l.title || '', salary: +l.salary || 0, ...x, _e: ['ins_sheet', s.id] } : { legal: s.short, name: l.name, title: l.title || '', note: x.note, _e: ['ins_sheet', s.id] });
  }
  const T = k => pc(Math.round(((+rt['dn_' + k] || 0) + (+rt['nld_' + k] || 0)) * 100) / 100);
  return { kpis: [['Quỹ lương đóng BH', base, 'đ'], ['Phần NLĐ', Math.round(nld), 'đ'], ['Phần doanh nghiệp', Math.round(dn), 'đ'], ['Tổng phải nộp', Math.round(nld + dn), 'đ']],
    cols: [['legal', 'Pháp nhân'], ['name', 'Họ và tên'], ['ins_no', 'Số sổ BHXH'], ['title', 'Chức vụ'], ['salary', 'Tiền lương', 'm'],
      ['dn_bhxh', `BHXH (${pc(rt.dn_bhxh)})`, 'm'], ['dn_bhyt', `BHYT (${pc(rt.dn_bhyt)})`, 'm'], ['dn_bhtn', `BHTN (${pc(rt.dn_bhtn)})`, 'm'], ['dn', 'Cộng', 'm'],
      ['nld_bhxh', `BHXH (${pc(rt.nld_bhxh)})`, 'm'], ['nld_bhyt', `BHYT (${pc(rt.nld_bhyt)})`, 'm'], ['nld_bhtn', `BHTN (${pc(rt.nld_bhtn)})`, 'm'], ['nld', 'Cộng', 'm'],
      ['t_bhxh', `BHXH (${T('bhxh')})`, 'm'], ['t_bhyt', `BHYT (${T('bhyt')})`, 'm'], ['t_bhtn', `BHTN (${T('bhtn')})`, 'm'], ['total', 'Tổng', 'm'], ['note', 'Ghi chú']],
    groups: [[null, 5], ['Doanh nghiệp nộp', 4], ['Người lao động nộp', 4], ['Tổng số phải nộp', 4], [null, 1]], rows, total: 1 };
};
// tổng hợp nộp bảo hiểm + công đoàn trong tháng theo pháp nhân (gộp BH-01 và CĐ-01); bấm dòng → bảng chi tiết của pháp nhân đó để in đi nộp
R.NOP = async (p, u) => {
  const m = p.month || curMonth(), ins = await runsOf('hr_ins_sheet', m, u, p), cd = await runsOf('hr_cd_sheet', m, u, p), by = {}, st = (o, v) => lbl(o, v);
  const so = M.E.ins_sheet.fields.find(f => f.k === 'status')?.o || [], co = M.E.cd_sheet.fields.find(f => f.k === 'status')?.o || [];
  for (const s of ins) { const x = { dn: 0, nld: 0, n: 0, base: 0 }; for (const l of (s.lines || []).filter(l => l.change !== 'Báo giảm')) { const r = B.insRow(l, s.rates); x.dn += r.dn; x.nld += r.nld; if (+l.salary) { x.n++; x.base += +l.salary; } }
    by[s.short] = { legal: s.short, n: x.n, base: x.base, dn: Math.round(x.dn), nld: Math.round(x.nld), bh: Math.round(+(s.total_due ?? s.due) || x.dn + x.nld), bh_st: st(so, s.status), _e: ['ins_sheet', s.id] }; }
  for (const s of cd) { const x = { kp: 0, dp: 0, nop: 0 }; for (const l of (s.lines || []).filter(l => l.change !== 'Báo giảm')) { const r = B.cdRow(l, s.rates); x.kp += r.kp; x.dp += r.dp; x.nop += r.nop; }
    const o = by[s.short] ||= { legal: s.short, n: 0, base: 0, dn: 0, nld: 0, bh: 0, bh_st: 'Chưa lập', _e: ['cd_sheet', s.id] }; Object.assign(o, { kp: Math.round(x.kp), dp: Math.round(x.dp), cd: Math.round(x.nop), cd_st: st(co, s.status), cd_id: s.id }); }
  const rows = Object.values(by).map(r => ({ ...r, kp: r.kp || 0, dp: r.dp || 0, cd: r.cd || 0, cd_st: r.cd_st || 'Chưa lập', all: (r.bh || 0) + (r.cd || 0) }));
  const S = k => rows.reduce((s, r) => s + (+r[k] || 0), 0);
  return { kpis: [['BH phải nộp', S('bh'), 'đ'], ['CĐ nộp cấp trên', S('cd'), 'đ'], ['Tổng phải nộp', S('all'), 'đ'], ['Pháp nhân', rows.length]],
    cols: [['legal', 'Pháp nhân'], ['n', 'Số NLĐ đóng BH', 'n'], ['base', 'Quỹ lương đóng BH', 'm'], ['dn', 'BH doanh nghiệp', 'm'], ['nld', 'BH người lao động', 'm'], ['bh', 'Tổng BH phải nộp', 'm'], ['kp', 'KPCĐ công ty', 'm'], ['dp', 'ĐPCĐ người lao động', 'm'], ['cd', 'CĐ nộp cấp trên', 'm'], ['all', 'Tổng phải nộp', 'm'], ['bh_st', 'Bảng BH'], ['cd_st', 'Bảng CĐ']],
    groups: [[null, 3], ['Bảo hiểm', 3], ['Công đoàn', 3], [null, 3]], rows, total: 1,
    note: 'Bấm một dòng để mở bảng trích nộp bảo hiểm của pháp nhân (in đi nộp); bảng công đoàn ở danh sách bên dưới.',
    extra: [{ title: 'Bảng trích nộp công đoàn theo pháp nhân — bấm để mở / in', cols: [['legal', 'Pháp nhân'], ['kp', 'KPCĐ công ty', 'm'], ['dp', 'ĐPCĐ người lao động', 'm'], ['cd', 'Nộp cấp trên', 'm'], ['cd_st', 'Tình trạng']], rows: rows.filter(r => r.cd_id).map(r => ({ ...r, _e: ['cd_sheet', r.cd_id] })) }] };
};
R['BH-02'] = async (p, u) => {
  const y = String(p.year || today().slice(0, 4)), pr = [y + '%'], w = lg(u, p, 't.legal_id', pr), rows = [];
  const sh = await mq(`SELECT t.*, l.short FROM hr_ins_sheet t JOIN hr_legal l ON l.id=t.legal_id WHERE t.month LIKE $1 ${w} ORDER BY l.id, t.month`, pr), debt = {};
  // số dư đầu năm (còn nợ > 0, nộp thừa < 0) do HCNS nhập theo từng pháp nhân — lũy kế công nợ bắt đầu từ số này
  const op0 = (await C.setting('ins_open'))?.[y] || {}, pl = [], wl = lg(u, p, 'id', pl);
  const opening = (await q(`SELECT id, short FROM hr_legal WHERE true ${wl} ORDER BY id`, pl)).map(l => ({ id: l.id, short: l.short, amt: +op0[l.id] || 0 }));
  for (const o of opening) debt[o.short] = o.amt;
  for (const s of sh) {
    const x = { dn_bhxh: 0, dn_bhyt: 0, dn_bhtn: 0, nld_bhxh: 0, nld_bhyt: 0, nld_bhtn: 0 }; for (const l of (s.lines || []).filter(l => l.change !== 'Báo giảm')) { const r = B.insRow(l, s.rates); for (const k in x) x[k] += r[k]; }
    const due = +(s.total_due ?? s.due) || 0, paid = +s.paid || 0, adj = due - (+s.due || 0); debt[s.short] = (debt[s.short] || 0) + due - paid;
    rows.push({ legal: s.short, m: +s.month.slice(5), n: s.n_emp, base: +s.base_total || 0, ...x, dn: x.dn_bhxh + x.dn_bhyt + x.dn_bhtn, nld: x.nld_bhxh + x.nld_bhyt + x.nld_bhtn, inc: +s.due || 0, adj, due, paid, diff: due - paid, debt: debt[s.short], doc: s.paid_doc || '', _e: ['ins_sheet', s.id] });
  }
  const S = k => rows.reduce((s, r) => s + (+r[k] || 0), 0);
  const op = opening.reduce((s, o) => s + o.amt, 0);
  return { kpis: [['Tổng phải nộp năm', S('due'), 'đ'], ['Tổng đã nộp năm', S('paid'), 'đ'], ['Công nợ cuối năm', op + S('diff'), 'đ'], ['Kỳ còn chênh lệch', rows.filter(r => Math.round(r.diff)).length]],
    opening, open_year: y, open_edit: ['cv_hcns', 'tp_hcns', 'admin'].includes(u.role) || C.can(u, M.E.ins_sheet, 'u'),
    note: `Số dư đầu năm ${y}: ${opening.map(o => `${o.short} ${o.amt.toLocaleString('vi-VN')} đ`).join(' · ') || 'chưa có'}. Công nợ cuối năm = số dư đầu năm + chênh lệch các kỳ.`,
    cols: [['legal', 'Pháp nhân'], ['m', 'Tháng', 'n'], ['n', 'Số NLĐ', 'n'], ['base', 'Quỹ lương đóng BH', 'm'], ['dn_bhxh', 'BHXH', 'm'], ['dn_bhyt', 'BHYT', 'm'], ['dn_bhtn', 'BHTN', 'm'], ['dn', 'Cộng', 'm'], ['nld_bhxh', 'BHXH', 'm'], ['nld_bhyt', 'BHYT', 'm'], ['nld_bhtn', 'BHTN', 'm'], ['nld', 'Cộng', 'm'],
      ['inc', 'Số phát sinh', 'm'], ['adj', 'Lãi, truy thu, giữ lại', 'm'], ['due', 'Tổng phải nộp', 'm'], ['paid', 'Đã nộp', 'm'], ['diff', 'Chênh lệch kỳ', 'm'], ['debt', 'Lũy kế còn nợ', 'm'], ['doc', 'Chứng từ']],
    groups: [[null, 4], ['Doanh nghiệp nộp', 4], ['Người lao động nộp', 4], ['Đối chiếu nộp', 6], [null, 1]], rows, total: 1, nosum: ['m', 'debt'] };
};
R['CĐ-01'] = async (p, u) => {
  const m = p.month || curMonth(), rows = [], sh = await runsOf('hr_cd_sheet', m, u, p), rt = sh[0]?.rates || await C.setting('cd') || {}, show = canIns(u);
  const t = { base: 0, kp: 0, dp: 0, nop: 0, giu: 0 };
  for (const s of sh) for (const l of s.lines || []) {
    const x = B.cdRow(l, s.rates); if (l.change !== 'Báo giảm') { t.base += +l.salary || 0; for (const k of ['kp', 'dp', 'nop', 'giu']) t[k] += x[k]; }
    rows.push(show ? { legal: s.short, name: l.name, salary: +l.salary || 0, ...x, _e: ['cd_sheet', s.id] } : { legal: s.short, name: l.name, note: x.note, _e: ['cd_sheet', s.id] });
  }
  return { kpis: [['Căn cứ tính (tiền lương)', t.base, 'đ'], ['KPCĐ công ty trích', Math.round(t.kp), 'đ'], ['ĐPCĐ người lao động', Math.round(t.dp), 'đ'], ['Tổng nộp cấp trên', Math.round(t.nop), 'đ']], sums: t,
    cols: [['legal', 'Pháp nhân'], ['name', 'Tên nhân viên'], ['salary', 'Tiền lương', 'm'], ['kp', `KPCĐ Công ty trích nộp ${pc(rt.kpcd)}`, 'm'], ['dp', `ĐPCĐ NLĐ trích nộp ${pc(rt.dpcd)}`, 'm'], ['kp_giu', `Nhận ${pc(rt.kpcd_giu)}`, 'm'], ['kp_nop', `Nộp ${pc(rt.kpcd_nop)}`, 'm'], ['dp_giu', `Giữ ${pc(rt.dpcd_giu)}`, 'm'], ['dp_nop', `Nộp ${pc(rt.dpcd_nop)}`, 'm'], ['nop', 'Tổng nộp KPCĐ + ĐPCĐ', 'm'], ['giu', 'Tổng giữ KPCĐ + ĐPCĐ', 'm'], ['note', 'Ghi chú'], ['year', '1 năm đóng (ĐPCĐ)', 'm']],
    groups: [[null, 5], ['KPCĐ', 2], ['ĐPCĐ', 2], [null, 4]], rows, total: 1 };
};
R['CĐ-02'] = async (p, u) => {
  const y = String(p.year || today().slice(0, 4)), pr = [y + '%'], w = lg(u, p, 't.legal_id', pr), rows = [], bal = {};
  for (const s of await mq(`SELECT t.*, l.short FROM hr_cd_sheet t JOIN hr_legal l ON l.id=t.legal_id WHERE t.month LIKE $1 ${w} ORDER BY l.id, t.month`, pr)) {
    const x = { kp: 0, dp: 0, kp_giu: 0, kp_nop: 0, dp_giu: 0, dp_nop: 0 }; for (const l of (s.lines || []).filter(l => l.change !== 'Báo giảm')) { const r = B.cdRow(l, s.rates); for (const k in x) x[k] += r[k]; }
    const nop = x.kp_nop + x.dp_nop, giu = x.kp_giu + x.dp_giu; bal[s.short] = (bal[s.short] || 0) + giu - (+s.used || 0);
    rows.push({ legal: s.short, m: +s.month.slice(5), n: s.n_emp, base: +s.base_total || 0, ...x, nop, giu, paid: +s.paid || 0, used: +s.used || 0, bal: bal[s.short], _e: ['cd_sheet', s.id] });
  }
  const S = k => rows.reduce((s, r) => s + (+r[k] || 0), 0);
  return { kpis: [['KPCĐ cả năm', Math.round(S('kp')), 'đ'], ['ĐPCĐ cả năm', Math.round(S('dp')), 'đ'], ['Đã nộp cấp trên', S('paid'), 'đ'], ['Số dư được giữ lại', Math.round(Object.values(bal).reduce((s, v) => s + v, 0)), 'đ']],
    cols: [['legal', 'Pháp nhân'], ['m', 'Tháng', 'n'], ['n', 'Số NLĐ', 'n'], ['base', 'Tiền lương', 'm'], ['kp', 'KPCĐ', 'm'], ['dp', 'ĐPCĐ', 'm'], ['kp_giu', 'KPCĐ nhận', 'm'], ['kp_nop', 'KPCĐ nộp', 'm'], ['dp_giu', 'ĐPCĐ giữ', 'm'], ['dp_nop', 'ĐPCĐ nộp', 'm'], ['nop', 'Tổng nộp', 'm'], ['giu', 'Tổng giữ', 'm'], ['paid', 'Đã nộp', 'm'], ['used', 'Đã sử dụng', 'm'], ['bal', 'Số dư giữ lại', 'm']],
    groups: [[null, 4], ['Trích', 2], ['Phân phối', 4], ['Tổng hợp', 5]], rows, total: 1, nosum: ['m', 'bal'] };
};
R.CCTC05 = async (p, u) => {   // định biên kế hoạch do HCNS nhập; thực tế tự đếm từ hồ sơ theo phòng ban (theo chức danh nếu dòng định biên ghi chức danh)
  const pr = [String(p.year || today().slice(0, 4))], w = lg(u, p, 'h.legal_id', pr);   // chỉ định biên của kỳ (năm) đang xem
  const hc = await mq(`SELECT h.*, l.short, d.name dept FROM hr_headcount h JOIN hr_legal l ON l.id=h.legal_id JOIN hr_dept d ON d.id=h.dept_id WHERE strpos(coalesce(h.period, $1), $1) > 0 ${w} ORDER BY l.id, d.name, h.title NULLS FIRST`, pr);
  const rows = []; for (const h of hc) {
    const t = h.title ? ' AND title=$3' : '', a = h.title ? [h.dept_id, h.legal_id, h.title] : [h.dept_id, h.legal_id];
    const cur = (await one(`SELECT count(*) n FROM hr_employee WHERE dept_id=$1 AND legal_id=$2${t} AND state<>'da_nghi'`, a)).n;
    const doing = (await one(`SELECT coalesce(sum(qty),0) n FROM hr_rec_plan WHERE dept_id=$1 AND legal_id=$2${h.title ? ' AND position=$3' : ''} AND rec_state='dang_tuyen'`, a)).n;
    const sure = (await one(`SELECT count(*) n FROM hr_candidate c JOIN hr_rec_plan r ON r.id=c.plan_id WHERE r.dept_id=$1 AND r.legal_id=$2${h.title ? ' AND r.position=$3' : ''} AND c.status='S53'`, a)).n;
    rows.push({ legal: h.short, dept: h.dept, title: h.title || 'Cả bộ phận', plan: h.qty, cur, gap: h.qty - cur, doing, left: h.qty - cur - sure, note: h.note, _e: ['headcount', h.id] });
  }
  const pl = rows.reduce((s, r) => s + r.plan, 0), cu = rows.reduce((s, r) => s + r.cur, 0);
  return { kpis: [['Định biên kế hoạch', pl], ['Thực tế (từ hồ sơ)', cu], ['Chênh lệch định biên', pl - cu], ['Vị trí đang tuyển', rows.reduce((s, r) => s + +r.doing, 0)]], cols: [['legal', 'Pháp nhân'], ['dept', 'Phòng ban'], ['title', 'Chức danh'], ['plan', 'Định biên kế hoạch', 'n'], ['cur', 'Thực tế', 'n'], ['gap', 'Thiếu (+) / thừa (−)', 'n'], ['doing', 'Đang tuyển', 'n'], ['left', 'Còn thiếu sau tuyển', 'n'], ['note', 'Ghi chú']], rows, total: 1 };
};
R.PLI = async (p, u) => {
  const m = p.month || curMonth(), s = await staffRows(u, p, m), pii = M.PII_ROLES.includes(u.role);
  const ct = Object.fromEntries((await q("SELECT DISTINCT ON (emp_id) emp_id, kind, from_on, to_on FROM hr_contract WHERE kind<>'HD04' ORDER BY emp_id, from_on DESC")).map(c => [c.emp_id, c]));
  // vị trí việc làm (2) theo mẫu: lãnh đạo, trưởng phòng → nhà quản lý; phó phòng, chuyên viên → CMKT bậc cao; nhân viên → CMKT bậc trung
  const POS = { ql: 'Nhà quản lý', cao: 'CMKT bậc cao', trung: 'CMKT bậc trung', khac: 'Khác' }, posOf = l => ['TGĐ', 'PTGĐ', 'GĐ', 'TP'].includes(l) ? 'ql' : ['PP', 'CV'].includes(l) ? 'cao' : l === 'NV' ? 'trung' : 'khac';
  const first = Object.fromEntries((await q("SELECT emp_id, min(from_on) f FROM hr_contract WHERE kind IN ('HD02','HD03') GROUP BY 1")).map(c => [c.emp_id, c.f])), mY = d => d ? `T${+d.slice(5, 7)}/${d.slice(0, 4)}` : '';
  const rows = s.map(e => { const c = ct[e.id] || {}, pos = posOf(e.level), start = first[e.id] || (c.kind !== 'HD01' ? e.join_on : null); return { legal: e.legal, legal_id: e.legal_id, name: e.full_name, ins: pii ? e.ins_no : '', dob: pii ? e.dob : '', gender: e.gender, cccd: pii ? e.cccd : '', title: e.title, pos, pos_l: POS[pos], sal: canPay(u) ? e.ins_salary : '', cond: e.work_cond, hard: e.work_cond === 'Nặng nhọc', join: e.join_on,
    c3: c.kind === 'HD03' ? c.from_on : '', c2a: c.kind === 'HD02' ? c.from_on : '', c2b: c.kind === 'HD02' ? c.to_on : '', c1a: c.kind === 'HD01' ? c.from_on : '', c1b: c.kind === 'HD01' ? c.to_on : '', ins_from: mY(start), ins_to: e.leave_on ? mY(e.leave_on) : '', note: e.state === 'thai_san' ? 'Thai sản' : e.state === 'nghi_kl' ? 'Nghỉ không lương' : '', _e: ['employee', e.id] }; });
  return { kpis: [['Tổng lao động', s.length], ['Lao động nữ', s.filter(e => e.gender === 'Nữ').length], ['Nặng nhọc, độc hại', s.filter(e => e.work_cond === 'Nặng nhọc').length], ['Pháp nhân', new Set(s.map(e => e.legal)).size]],
    cols: [['legal', 'Pháp nhân'], ['name', 'Họ tên'], ['ins', 'Mã số BHXH'], ['dob', 'Ngày sinh', 'd'], ['gender', 'Giới tính'], ['cccd', 'Số CCCD'], ['title', 'Chức danh'], ['pos_l', 'Vị trí việc làm'], ['sal', 'Mức lương', 'm'], ['c3', 'Không XĐTH từ', 'd'], ['c2a', 'XĐTH từ', 'd'], ['c2b', 'XĐTH đến', 'd'], ['c1a', 'Thử việc từ', 'd'], ['c1b', 'Thử việc đến', 'd'], ['ins_from', 'Bắt đầu đóng BHXH'], ['ins_to', 'Kết thúc đóng BHXH'], ['note', 'Ghi chú']],
    groups: [[null, 9], ['Loại và hiệu lực HĐLĐ', 5], [null, 3]], rows };
};
// báo cáo của mảng hành chính được giao: xem mọi pháp nhân (VPP, suất ăn, phòng họp phục vụ cả văn phòng)
const forMod = (u, mod) => C.modOn(u, mod) ? { ...u, legal_ids: null } : u;
// NLĐ, trưởng bộ phận chỉ xem lịch sử làm việc của mình / lịch phòng họp / lịch xe (như menu)
const OPEN_REPORTS = ['HD13', 'XC06', 'PH02'];
const okMonth = p => { if (p.month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.month)) C.bad('Kỳ không hợp lệ (yyyy-mm)'); };
// chưa giao mục riêng (items trống): báo cáo nhân sự cho khối nhân sự – BGĐ – kế toán, báo cáo hành chính cho khối hành chính – BGĐ; HD13, XC06, PH02 mở cho mọi người
const roleSees = (u, code) => Array.isArray(u.items) || u.role === 'admin' || OPEN_REPORTS.includes(code) || (M.REPORT_MOD[code] ? ['tp_hcns', 'cv_hc', 'cv_hcns', 'bgd'] : ['tp_hcns', 'cv_hcns', 'bgd', 'ke_toan']).includes(u.role);
async function report(code, p, u, inner) { const fn = R[code]; if (!fn) C.notFound(null, 'báo cáo'); okMonth(p); if (!inner && (!roleSees(u, code) || !C.has(u, 'r:' + code))) C.deny(); const s = SPEC[code]; return { code, title: s[0], rule: s[1], control: s[2], source: s[3], flow: s[4], ...(await fn(p, forMod(u, M.REPORT_MOD[code]))) }; }

// ---------- cảnh báo: Cần cập nhật dữ liệu / Sắp đến hạn / Quá hạn / Đã xử lý — có nguồn, người phụ trách, hành động ----------
async function alerts(u) {
  const t = today(), out = [], pr = [], w = lg(u, {}, 'c.legal_id', pr);
  const hcns = (await one("SELECT full_name FROM hr_user WHERE role='tp_hcns' LIMIT 1"))?.full_name || 'HCNS';
  const push = (key, grp, title, detail, level, due, src, link, owner = hcns) => out.push({ key, grp, title, detail, level, due, src, link, owner });
  const lv = d => d < 0 ? 'qua_han' : 'sap_den_han';
  for (const c of await mq(`SELECT c.id, c.no, c.kind, c.to_on, c.state, e.full_name, l.short FROM hr_contract c JOIN hr_employee e ON e.id=c.emp_id JOIN hr_legal l ON l.id=c.legal_id WHERE c.state IN ('hieu_luc','cho_quyet_dinh') AND e.state<>'da_nghi' AND c.kind IN ('HD01','HD02') ${w}`, pr)) {
    if (!c.to_on) { push('hd-' + c.id, 'HĐLĐ', `${c.full_name}: thiếu ngày hết hạn HĐ`, `${c.no} · ${c.short}`, 'can_cap_nhat', null, 'HD12', `e/contract/${c.id}`); continue; }
    const d = dayDiff(t, c.to_on); if (d <= 30) push('hd-' + c.id + '-' + c.to_on, 'HĐLĐ', `${c.kind === 'HD01' ? 'Hết thử việc' : 'HĐ hết hạn'}: ${c.full_name}`, `${c.no} · ${c.short} · ${d < 0 ? 'quá ' + -d : 'còn ' + d} ngày${c.state === 'cho_quyet_dinh' ? ' · chờ quyết định' : ''}`, lv(d), c.to_on, 'HD12', `e/contract/${c.id}`);
  }
  for (const v of await vehicleDue(forMod(u, 'xe'))) { if (v.left == null) push(`xe-${v.id}-${v.kind}`, 'Xe – tài sản', `${v.plate}: thiếu ngày ${v.kind.toLowerCase()}`, '', 'can_cap_nhat', null, 'XC03', `e/vehicle/${v.id}`); else if (v.left <= 30) push(`xe-${v.id}-${v.kind}-${v.due}`, 'Xe – tài sản', `${v.kind} xe ${v.plate}`, `${v.left < 0 ? 'quá ' + -v.left : 'còn ' + v.left} ngày`, lv(v.left), v.due, 'XC03', `e/vehicle/${v.id}`, v.owner || hcns); }
  const pa = [], wa = lg(forMod(u, 'ts'), {}, 'a.legal_id', pa);
  for (const a of await mq(`SELECT a.id, a.code, a.name, a.status, a.holder_id, a.repair_due FROM hr_asset a WHERE a.status IN ('dang_dung','sua_chua') ${wa}`, pa)) {
    if (a.status === 'dang_dung' && !a.holder_id) push('ts-' + a.id, 'Xe – tài sản', `Tài sản ${a.code}: thiếu người quản lý`, a.name, 'can_cap_nhat', null, 'TS02', `e/asset/${a.id}`);
    if (a.status === 'sua_chua' && a.repair_due && a.repair_due < t) push('ts-sc-' + a.id, 'Xe – tài sản', `Tài sản ${a.code}: sửa chữa quá hạn`, a.name, 'qua_han', a.repair_due, 'TS02', `e/asset/${a.id}`);
  }
  // bảo hành tài sản còn ≤ 30 ngày (tài sản đang dùng / trong kho)
  const pw = [addDays(t, 30), t], ww = lg(forMod(u, 'ts'), {}, 'a.legal_id', pw);
  for (const a of await mq(`SELECT a.id, a.code, a.name, a.warranty_to FROM hr_asset a WHERE a.warranty_to IS NOT NULL AND a.warranty_to <= $1 AND a.warranty_to >= ($2::date - 30) AND a.status IN ('dang_dung','trong_kho') ${ww}`, pw))
    push(`ts-bh-${a.id}-${a.warranty_to}`, 'Xe – tài sản', `Tài sản ${a.code}: hết bảo hành`, a.name, lv(dayDiff(t, a.warranty_to)), a.warranty_to, 'TS02', `e/asset/${a.id}`);
  // xe quá giờ hẹn trả mà chưa có phiếu trả xe
  const pv = [], wv = lg(forMod(u, 'xe'), {}, 'b.legal_id', pv);
  for (const b of await mq(`SELECT b.id, b.code, to_char(b.end_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS end_d, v.plate, e.full_name FROM hr_car_book b JOIN hr_vehicle v ON v.id = b.vehicle_id LEFT JOIN hr_employee e ON e.id = b.emp_id WHERE b.status = 'dang_di' AND b.end_at < now() ${wv}`, pv))
    push(`xe-tra-${b.id}`, 'Xe – tài sản', `Xe ${b.plate} quá giờ trả`, `${b.code} · ${b.full_name || ''} · hẹn trả ${dmy(b.end_d)}`, 'qua_han', b.end_d, 'XC03', `e/car_book/${b.id}`);
  // chứng chỉ chuyên môn / thẻ an toàn lao động còn ≤ 30 ngày
  const pz = [addDays(t, 30)], wz = lg(u, {}, 'e.legal_id', pz);
  for (const e of await mq(`SELECT e.id, e.full_name, e.cert, e.cert_to, e.safety_group, e.safety_to FROM hr_employee e WHERE e.state <> 'da_nghi' AND (e.cert_to <= $1 OR e.safety_to <= $1) ${wz}`, pz))
    for (const [k, d, nm] of [['cc', e.cert_to, `Chứng chỉ ${e.cert || ''}`.trim()], ['atld', e.safety_to, `Thẻ an toàn lao động${e.safety_group ? ' nhóm ' + e.safety_group : ''}`]])
      if (d && d <= pz[0]) push(`hs-${k}-${e.id}-${d}`, 'Nhân sự', `${e.full_name}: ${nm} hết hạn`, `${dayDiff(t, d) < 0 ? 'quá ' + -dayDiff(t, d) : 'còn ' + dayDiff(t, d)} ngày`, lv(dayDiff(t, d)), d, 'HS02', `e/employee/${e.id}`);
  const m = t.slice(5, 7), pb = [m], wb = lg(u, {}, 'e.legal_id', pb);
  for (const e of await mq(`SELECT e.id, e.full_name, e.dob, d.name dept FROM hr_employee e LEFT JOIN hr_dept d ON d.id=e.dept_id WHERE to_char(e.dob,'MM')=$1 AND e.state<>'da_nghi' ${wb} ORDER BY to_char(e.dob,'DD')`, pb)) push(`sn-${e.id}-${t.slice(0, 7)}`, 'Nhân sự', `Sinh nhật ${e.dob.slice(8, 10)}/${m}: ${e.full_name}`, e.dept || '', 'sap_den_han', `${t.slice(0, 4)}-${m}-${e.dob.slice(8, 10)}`, 'HS02', `e/employee/${e.id}`);
  const pc = [], wc = lg(u, {}, 'e.legal_id', pc);
  for (const e of await mq(`SELECT e.id, e.full_name, e.dept_id, e.phone, e.bank_acct, e.manager_id, e.level FROM hr_employee e WHERE e.state<>'da_nghi' AND (e.dept_id IS NULL OR e.phone IS NULL OR e.bank_acct IS NULL OR (e.manager_id IS NULL AND e.level NOT IN ('TGĐ','PTGĐ','GĐ'))) ${wc}`, pc)) {
    const miss = [!e.dept_id && 'phòng ban', !e.phone && 'điện thoại', !e.bank_acct && 'tài khoản', !e.manager_id && !['TGĐ', 'PTGĐ', 'GĐ'].includes(e.level) && 'quản lý trực tiếp'].filter(Boolean);
    push('hs-' + e.id, 'Nhân sự', `${e.full_name}: hồ sơ thiếu thông tin`, miss.join(', '), 'can_cap_nhat', null, 'HS01', `e/employee/${e.id}`);
  }
  if (!u.legal_ids || C.modOn(u, 'vpp')) for (const r of (await R.VPP06({ month: t.slice(0, 7) }, forMod(u, 'vpp'))).rows.filter(r => r.warn)) push(`vpp-${r.code}-${t.slice(0, 7)}`, 'Khác', `VPP dưới định mức: ${r.name}`, `Tồn ${r.close}/${r.min} ${r.unit || ''}`, 'sap_den_han', null, 'VPP06', 'r/VPP06');
  for (const r of (await R.TD04({}, u)).rows.filter(r => r.warn)) push('td-' + r.id, 'Khác', `Vị trí quá hạn tuyển: ${r.position}`, `${r.got}/${r.qty} · hạn ${dmy(r.due_on)}`, 'qua_han', r.due_on, 'TD04', `e/rec_plan/${r.id}`);
  const pg = [addDays(t, 30)], wg = lg(u, {}, 'legal_id', pg);   // đúng pháp nhân phụ trách
  for (const r of await q(`SELECT id, kind, period, due_on FROM hr_gov_report WHERE status='chua' AND due_on <= $1 ${wg}`, pg)) push('bc-' + r.id, 'Khác', `Báo cáo lao động đến hạn nộp`, `${r.period}`, lv(dayDiff(t, r.due_on)), r.due_on, 'BC-6T', `e/gov_report/${r.id}`);
  const st = Object.fromEntries((await q('SELECT key, state, note FROM hr_alert_state')).map(r => [r.key, r]));
  for (const a of out) if (st[a.key]) { a.done = true; a.level = 'da_xu_ly'; a.note = st[a.key].note; }
  for (const a of out) a.side = M.REPORT_MOD[a.src] ? 'hc' : 'ns';
  const ord = { qua_han: 0, sap_den_han: 1, can_cap_nhat: 2, da_xu_ly: 3 };
  // theo vai trò: cảnh báo nhân sự cho khối nhân sự, hành chính cho khối hành chính (như báo cáo nguồn); bản ghi phải xem được toàn bộ (không chỉ phần của mình)
  const okEnt = l => { const m = /^e\/(\w+)\//.exec(l), e = m && M.E[m[1]]; return !e || (C.can(u, e, 'r') && C.seesAll(u, e)); };
  return out.filter(a => C.has(u, a.link.replace('/', ':').replace(/\/\d+$/, '')) && roleSees(u, a.src) && okEnt(a.link)).sort((a, b) => ord[a.level] - ord[b.level] || String(a.due || 'z').localeCompare(b.due || 'z'));
}

// ---------- hộp việc: phiếu chờ tôi duyệt ----------
// chỉ phiếu mình là cấp duyệt: đúng vai trò, đúng mảng được giao, đúng pháp nhân / phòng ban phụ trách
async function inbox(u) {
  const rows = await q("SELECT a.*, r.full_name by_name FROM hr_approval a LEFT JOIN hr_user r ON r.id=a.requested_by WHERE a.status='cho_duyet' ORDER BY a.requested_at"), out = [];
  // lý do + thời gian hiện ngay trong danh sách (không phải mở từng đơn)
  const why = r => r.reason || r.content || r.task || r.descr || r.purpose || r.note || '', when = r => r.day ? C.dmy(r.day) : r.from_on ? C.dmy(r.from_on) + (r.to_on && r.to_on !== r.from_on ? ' – ' + C.dmy(r.to_on) : '') : r.start_at ? C.dmy(String(r.start_at).slice(0, 10)) : r.month || '';
  for (const a of rows) {
    const e = M.E[a.ent]; if (!e) continue;
    const rec = await one(`SELECT * FROM ${e.table} WHERE id=$1`, [a.rec_id]); if (!rec) continue;
    if (!(u.role === 'admin' && !C.offDuty(u, e))) {
      if (a.approver_id ? a.approver_id !== u.id : !a.roles.includes(C.offDuty(u, e) ? 'nld' : u.role)) continue;
      try { await C.scopeCheck({ q, one }, e, rec, u); } catch { continue; }
    }
    const who = rec.emp_id && await one('SELECT full_name FROM hr_employee WHERE id=$1', [rec.emp_id]);
    out.push({ ...a, ent_title: e.title, code: e.code, reason: String(why(rec)).slice(0, 300), when: when(rec), who: who?.full_name || '' });
  }
  return out;
}
// đã duyệt / từ chối gần đây (30 ngày) — hiện người duyệt
async function decidedRecent(u) {
  const rows = await q("SELECT a.ent, a.rec_id, a.title, a.status, a.decided_at, a.comment, d.full_name dec_name, r.full_name by_name FROM hr_approval a LEFT JOIN hr_user d ON d.id=a.decided_by LEFT JOIN hr_user r ON r.id=a.requested_by WHERE a.status IN ('da_duyet','tu_choi') AND a.decided_at > now() - interval '30 days' AND (a.decided_by = $1 OR a.requested_by = $1 OR $2) ORDER BY a.decided_at DESC LIMIT 100", [u.id, ['admin', 'tp_hcns'].includes(u.role)]);
  return rows.filter(a => M.E[a.ent]);
}

// ---------- dashboard ----------
const sMonths = (m, c = 6) => { const o = []; for (let i = c - 1; i >= 0; i--) { const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 - i, 1)); o.push(d.toISOString().slice(0, 7)); } return o; };
const share = items => { const t = items.reduce((s, x) => s + x[1], 0) || 1; return items.map(([l, v, link]) => ({ l, v, pct: Math.round(v / t * 100), link })); };
// hai màn tổng quan: NS (nhân sự – công – lương – BH – CĐ – tuyển dụng – hợp đồng) và HC (tài sản – VPP – xe – phòng họp – suất ăn – chuyển phát)
// mỗi thẻ có đường dẫn tới danh sách / báo cáo gốc; chuyên viên chỉ thấy mảng hành chính được giao, pháp nhân phụ trách
const ST_C = { nhap: 'a', cho_duyet: 'b', da_duyet: 'g', tu_choi: 'r', da_chuyen: 't', mo: 'a', khoa: 'g' };
const fmtM = v => (Math.round(v / 1e5) / 10).toLocaleString('vi-VN') + ' tr';
const hasMod =(u, mod) => !Array.isArray(u.items) || C.modOn(u, mod);
async function scopeLine(u) {
  const ls = u.legal_ids?.length ? (await q('SELECT short FROM hr_legal WHERE id = ANY($1) ORDER BY id', [u.legal_ids])).map(x => x.short) : null;
  return ls ? `Pháp nhân phụ trách: ${ls.join(', ')}` : 'Mọi pháp nhân';
}
async function dash(id, p, u) {
  okMonth(p);   // m được ghép thẳng vào SQL bên dưới → chỉ nhận yyyy-mm
  const m = p.month || curMonth(), A =await alerts(u), open = A.filter(a => !a.done), ms = sMonths(m), inb = await inbox(u), scope = await scopeLine(u);
  const mmY = `${m.slice(5)}/${m.slice(0, 4)}`;
  if (id === 'NS') {
    // khung theo Bravo «Tổng quan nhân sự»: kỳ (từ – đến), đầu kỳ / tăng / giảm / cuối kỳ, biến động, theo bộ phận, sinh nhật, HĐ sắp hết hạn;
    // 4 góc theo góp ý: Định biên – tuyển dụng · Đào tạo · Chấm công – lương · Cảnh báo (bấm góc → chi tiết bên dưới)
    const t = today(), from = /^\d{4}-\d{2}-\d{2}$/.test(p.from || '') ? p.from : m + '-01', to = /^\d{4}-\d{2}-\d{2}$/.test(p.to || '') ? p.to : B.lastDay(m);
    // trưởng bộ phận (không được giao hồ sơ toàn công ty): chỉ số liệu phòng mình
    const deps = u.role === 'truong_bp' && !C.seesAll(u, M.E.employee) ? [u.dept_id || 0] : String(p.depts || '').split(',').map(Number).filter(Boolean), pr = [], w = lg(u, p, 'e.legal_id', pr) + (deps.length ? ` AND e.dept_id = ANY($${pr.push(deps)})` : '');
    const all = await mq(`SELECT e.*, d.name dept, d.block, l.short legal FROM hr_employee e LEFT JOIN hr_dept d ON d.id=e.dept_id JOIN hr_legal l ON l.id=e.legal_id WHERE true ${w}`, pr);
    const at = d => all.filter(e => e.join_on && e.join_on <= d && (!e.leave_on || e.leave_on >= d)), prev = addDays(from, -1);
    const begin = at(prev), end = at(to), inc = all.filter(e => e.join_on >= from && e.join_on <= to), dec = all.filter(e => e.leave_on && e.leave_on >= from && e.leave_on <= to);
    // biến động theo tháng trong kỳ (kỳ ngắn hơn 2 tháng → 6 tháng gần nhất)
    const mos = []; for (let x = from.slice(0, 7); x <= to.slice(0, 7); x = B.nextMonth(x)) mos.push(x); const bm = mos.length > 1 ? mos.slice(-12) : sMonths(to.slice(0, 7));
    const who = (e, d) => ({ id: e.id, code: e.code, name: e.full_name, title: e.title, dept: e.dept || 'Chưa gán phòng', legal: e.legal, day: d });   // bấm cột → danh sách người tuyển mới / nghỉ việc trong tháng
    const flow = { labels: bm.map(x => `${+x.slice(5)}/${x.slice(2, 4)}`), inc: bm.map(x => all.filter(e => e.join_on?.startsWith(x)).length), dec: bm.map(x => all.filter(e => e.leave_on?.startsWith(x)).length), total: bm.map(x => at(B.lastDay(x)).length),
      incP: bm.map(x => all.filter(e => e.join_on?.startsWith(x)).map(e => who(e, e.join_on))), decP: bm.map(x => all.filter(e => e.leave_on?.startsWith(x)).map(e => who(e, e.leave_on))), months: bm };
    // 2 biểu đồ: các phòng Khối Home | theo pháp nhân; bấm pháp nhân → số người từng phòng, bấm phòng → danh sách nhân sự
    const byHome = {}, byLegal = {}, legalDept = {}; for (const e of end) { const k = e.dept || 'Chưa gán phòng';
      if (e.block === 'Khối Home') byHome[k] = (byHome[k] || 0) + 1; byLegal[e.legal] = (byLegal[e.legal] || 0) + 1; const ld = legalDept[e.legal] ||= {}; ld[k] = (ld[k] || 0) + 1; }
    const shareOf = g => share(Object.entries(g).sort((a, b) => b[1] - a[1]));
    const stL = Object.fromEntries(M.E.employee.fields.find(f => f.k === 'state').o.map(o => [o[0], o[1]]));
    const people = end.map(e => ({ id: e.id, code: e.code, name: e.full_name, title: e.title, dept: e.dept || 'Chưa gán phòng', home: e.block === 'Khối Home', legal: e.legal, join: e.join_on, st: stL[e.state] || e.state }));
    // sinh nhật 30 ngày tới · HĐ hết hạn ≤ 30 ngày (đang làm)
    const t30 = addDays(t, 30);
    const pc = [], wc = lg(u, p, 'c.legal_id', pc) + (deps.length ? ` AND e.dept_id = ANY($${pc.push(deps)})` : '');
    const hdx = (await mq(`SELECT c.id, c.no, c.kind, c.to_on, e.code, e.full_name FROM hr_contract c JOIN hr_employee e ON e.id=c.emp_id WHERE c.state IN ('hieu_luc','cho_quyet_dinh') AND c.to_on IS NOT NULL AND c.to_on <= $${pc.push(t30)} AND e.state <> 'da_nghi' ${wc} ORDER BY c.to_on`, pc));
    // ---- 4 góc ----
    const h = await report('CCTC05', p, u, 1), td = await report('TD04', { ...p, from: '', to: '' }, u, 1), plan = h.kpis[0][1], need = td.kpis[0][1], got = td.kpis[2][1];
    const corner1 = { k: 'dbtd', title: 'Định biên – tuyển dụng', icon: 'fa-people-group', c: 'g', items: [['Tổng nhân sự', end.length], ['Định biên kế hoạch', plan || '—'], ['Cần tuyển', Math.max(need - got, 0)], ['Đã tuyển', got]],
      detail: { cols: [['legal', 'Pháp nhân'], ['dept', 'Phòng ban'], ['title', 'Chức danh'], ['plan', 'Định biên', 'n'], ['cur', 'Thực tế', 'n'], ['gap', 'Thiếu/thừa', 'n'], ['doing', 'Đang tuyển', 'n']], rows: h.rows, link: 'r/CCTC05', extra: { cols: td.cols.filter(c => ['position', 'dept', 'qty', 'due_on', 'warn'].includes(c[0])).flatMap(c => c[0] === 'qty' ? [c, ['got', 'Đã tuyển', 'n']] : [c]), rows: td.rows, link: 'r/TD04', title: 'Kế hoạch tuyển dụng' } } };
    const ptr = [from, to], wtr = lg(u, p, 't.legal_id', ptr), tr = await mq(`SELECT t.* FROM hr_training t WHERE t.from_on <= $2 AND coalesce(t.to_on, t.from_on) >= $1 AND coalesce(t.state,'') <> 'huy' ${wtr} ORDER BY t.from_on`, ptr).catch(() => []);
    const corner2 = { k: 'dt', title: 'Đào tạo', icon: 'fa-graduation-cap', c: 'v', items: [['Khóa trong kỳ', tr.length], ['Học viên', tr.reduce((s, x) => s + ((x.emps || []).length || +x.qty || 0), 0)], ['Hoàn thành', tr.filter(x => x.state === 'hoan_thanh').length], ['Chi phí dự kiến', fmtM(tr.reduce((s, x) => s + (+x.cost || 0), 0))]],
      detail: { cols: [['code', 'Mã'], ['name', 'Khóa đào tạo'], ['from_on', 'Từ ngày', 'd'], ['to_on', 'Đến ngày', 'd'], ['qty', 'Học viên', 'n'], ['cost', 'Chi phí', 'm'], ['state_l', 'Tình trạng']], rows: tr.map(x => ({ ...x, qty: (x.emps || []).length || x.qty, state_l: lbl(M.E.training.fields.find(f => f.k === 'state').o, x.state), _e: ['training', x.id] })), link: 'e/training' } };
    // chấm công – lương: số nhân sự và chi phí theo từng pháp nhân, tổng tiền lương phải chi
    const showPay = canPay(u) || u.role === 'bgd', pl = [], wl = lg(u, p, 'l.id', pl), legs = await mq(`SELECT l.id, l.short FROM hr_legal l WHERE EXISTS (SELECT 1 FROM hr_employee e WHERE e.legal_id=l.id AND e.state<>'da_nghi') ${wl} ORDER BY l.id`, pl);
    const payRows = []; for (const g of legs) {
      const py = await one('SELECT id, status, net_total, lines FROM hr_payroll WHERE legal_id=$1 AND month=$2', [g.id, m]), ap = await one('SELECT status FROM hr_att_period WHERE legal_id=$1 AND month=$2', [g.id, m]);
      const ins = await one('SELECT coalesce(total_due, due) n FROM hr_ins_sheet WHERE legal_id=$1 AND month=$2', [g.id, m]), cd = await one('SELECT due n FROM hr_cd_sheet WHERE legal_id=$1 AND month=$2', [g.id, m]);
      const L = py?.lines || [], S = k => L.reduce((s, x) => s + (+x[k] || 0), 0);
      payRows.push({ legal: g.short, n: end.filter(e => e.legal === g.short).length, work: S('d100') + S('d85'), total: showPay ? S('total') : '', net: showPay ? +py?.net_total || 0 : '', ins: showPay ? +ins?.n || 0 : '', cd: showPay ? +cd?.n || 0 : '', ky: ap ? (ap.status === 'khoa' ? 'Đã khóa' : 'Đang mở') : 'Chưa mở', st: py ? lbl(M.E.payroll.fields.find(f => f.k === 'status').o, py.status) : 'Chưa lập', _e: py ? ['payroll', py.id] : null });
    }
    const totalPay = payRows.reduce((s, x) => s + (+x.total || 0), 0);
    const corner3 = { k: 'cl', title: `Chấm công – lương ${m.slice(5)}/${m.slice(0, 4)}`, icon: 'fa-money-bills', c: 'b', items: [['Nhân sự tính lương', payRows.reduce((s, x) => s + x.n, 0)], ['Pháp nhân', payRows.length], ['Tổng lương phải chi', showPay ? fmtM(totalPay) : '—'], ['BH + CĐ phải nộp', showPay ? fmtM(payRows.reduce((s, x) => s + (+x.ins || 0) + (+x.cd || 0), 0)) : '—']],
      detail: { cols: [['legal', 'Pháp nhân'], ['n', 'Số nhân sự', 'n'], ['work', 'Tổng công', 'n'], ['total', 'Tổng lương phải trả', 'm'], ['net', 'Thực lĩnh', 'm'], ['ins', 'BH phải nộp', 'm'], ['cd', 'CĐ nộp cấp trên', 'm'], ['ky', 'Kỳ công'], ['st', 'Bảng lương']], rows: payRows, link: 'e/payroll', total: 1 } };
    // cảnh báo có số lượng
    const trialEnd = hdx.filter(c => c.kind === 'HD01'), hdEnd = hdx.filter(c => c.kind !== 'HD01'), certEnd = end.filter(e => [e.cert_to, e.safety_to].some(d => d && d <= t30)).map(e => ({ code: e.code, name: e.full_name, dept: e.dept, cert_to: [e.cert_to, e.safety_to].filter(Boolean).sort()[0], _e: ['employee', e.id] }));
    const miss = open.filter(a => a.src === 'HS01'), bmo = end.filter(e => e.dob?.slice(5, 7) === t.slice(5, 7));
    const corner4 = { k: 'cb', title: 'Cảnh báo', icon: 'fa-triangle-exclamation', c: 'a', items: [['Hồ sơ thiếu', miss.length], ['HĐ sắp hết hạn', hdEnd.length], ['Sắp hết thử việc', trialEnd.length], ['Chứng chỉ sắp hết hạn', certEnd.length], ['Sinh nhật trong tháng', bmo.length]],
      detail: { groups: [
        { title: 'Hồ sơ thiếu thông tin', cols: [['title', 'Nhân sự'], ['detail', 'Còn thiếu']], rows: miss.map(a => ({ title: a.title.split(':')[0], detail: a.detail, _l: a.link })) },
        { title: 'Hợp đồng sắp hết hạn (≤ 30 ngày)', cols: [['no', 'Số HĐ'], ['code', 'Mã NV'], ['full_name', 'Họ tên'], ['to_on', 'Ngày hết hạn', 'd']], rows: hdEnd.map(c => ({ ...c, _e: ['contract', c.id] })) },
        { title: 'Sắp hết thử việc', cols: [['no', 'Số HĐ'], ['code', 'Mã NV'], ['full_name', 'Họ tên'], ['to_on', 'Hết thử việc', 'd']], rows: trialEnd.map(c => ({ ...c, _e: ['contract', c.id] })) },
        { title: 'Chứng chỉ / thẻ ATLĐ sắp hết hạn', cols: [['code', 'Mã NV'], ['name', 'Họ tên'], ['dept', 'Bộ phận'], ['cert_to', 'Hết hạn', 'd']], rows: certEnd },
        { title: 'Sinh nhật trong tháng', cols: [['code', 'Mã NV'], ['full_name', 'Họ tên'], ['dob', 'Ngày sinh', 'd'], ['dept', 'Bộ phận']], rows: bmo.map(e => ({ id: e.id, code: e.code, full_name: e.full_name, dob: e.dob, dept: e.dept, _e: ['employee', e.id] })) }] } };   // không gửi cả hồ sơ (CCCD, TK ngân hàng, lương…)
    return { side: 'ns', title: 'Tổng quan Nhân sự', sub: scope, from, to, depts: deps, pending: inb.length,
      cards: [['Số lượng nhân viên đầu kỳ', begin.length, 'fa-users'], ['Số lượng nhân viên tăng', inc.length, 'fa-user-plus'], ['Số lượng nhân viên giảm', dec.length, 'fa-user-minus'], ['Số lượng nhân viên cuối kỳ', end.length, 'fa-users-line']],
      corners: [corner1, corner2, corner3, corner4], flow, byHome: shareOf(byHome), byLegal: shareOf(byLegal), legalDept: Object.fromEntries(Object.entries(legalDept).map(([l, g]) => [l, Object.entries(g).sort((a, b) => b[1] - a[1])])), people,
      reports: ['HS02', 'HD12', 'HD13', 'CC12', 'CC13', 'CC14', 'DT02', 'TL05', 'NOP', 'BH-01', 'BH-02', 'CĐ-01', 'CĐ-02', 'CCTC05', 'TD04', 'PLI'].filter(c => C.has(u, 'r:' + c) && roleSees(u, c) && SPEC[c]).map(c => [c, SPEC[c][0]]) };
  }
  if (id === 'HC') {
    const has = mod => hasMod(u, mod), U = mod => forMod(u, mod), cnt = async (mod, sql) => { const pr = [], w = lg(U(mod), p, 't.legal_id', pr); return (await one(`${sql} ${w}`, pr)).n; };
    const todo = [], kpis = [];
    if (has('vpp')) { todo.push(['fa-pen-ruler', 'Đề xuất VPP chờ duyệt / chờ cấp', await cnt('vpp', "SELECT count(*) n FROM hr_vpp_req t WHERE t.status IN ('cho_duyet','da_duyet')"), 'e/vpp_req', 'v']); const v = await report('VPP06', p, u, 1); kpis.push(['VPP dưới định mức', v.kpis[3][1], 'mặt hàng', 'r/VPP06', 'a', 'fa-pen-ruler']); }
    if (has('xe')) { todo.push(['fa-car-side', 'Lịch xe chờ duyệt', await cnt('xe', "SELECT count(*) n FROM hr_car_book t WHERE t.status='cho_duyet'"), 'e/car_book', 'b']); const x = await vehicleDue(U('xe')); kpis.push(['Xe cần xử lý hạn', x.filter(r => r.left != null && r.left <= 30).length, 'mục', 'r/XC03', 'b', 'fa-car']); }
    if (has('ph')) { todo.push(['fa-chalkboard-user', 'Phòng họp chờ duyệt', await cnt('ph', "SELECT count(*) n FROM hr_room_book t WHERE t.status='cho_duyet'"), 'e/room_book', 'a']); kpis.push(['Lượt họp trong tháng', await cnt('ph', `SELECT count(*) n FROM hr_room_book t WHERE t.status NOT IN ('nhap','tu_choi','huy') AND to_char(t.start_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM')='${m}'`), 'lượt', 'r/PH02', 'n', 'fa-door-open']); }
    if (has('gt')) todo.push(['fa-envelope', 'Thư chờ gửi / đang chuyển', await cnt('gt', "SELECT count(*) n FROM hr_mail t WHERE t.status IN ('cho_gui','dang_chuyen')"), 'e/mail', 'g']);
    if (has('ts')) { const t = await report('TS02', p, u, 1); kpis.unshift(['Tài sản đang sử dụng', t.kpis[1][1], `/ ${t.kpis[0][1]} tài sản`, 'r/TS02', 'g', 'fa-laptop']); todo.push(['fa-screwdriver-wrench', 'Tài sản đang sửa chữa', t.kpis[2][1], 'r/TS02', 'a']); }
    if (has('sa')) kpis.push(['Suất ăn thực tế tháng', await cnt('sa', `SELECT coalesce(sum(actual),0) n FROM hr_meal_day t WHERE to_char(t.day,'YYYY-MM')='${m}'`), 'suất', 'e/meal_day', 'v', 'fa-utensils']);
    if (has('sk')) kpis.push(['Sự kiện trong năm', await cnt('sk', `SELECT count(*) n FROM hr_event t WHERE to_char(t.at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY')='${m.slice(0, 4)}'`), 'sự kiện', 'r/SK03', 'n', 'fa-champagne-glasses']);
    // lịch hôm nay: phòng họp + xe
    const now = today(), cal = [];
    if (has('ph')) { const pr = [now], w = lg(U('ph'), {}, 't.legal_id', pr); for (const r of await mq(`SELECT t.id, t.start_at, t.end_at, t.descr, t.status, r.name room, e.full_name who FROM hr_room_book t JOIN hr_room r ON r.id=t.room_id JOIN hr_employee e ON e.id=t.emp_id WHERE (t.start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date=$1 AND t.status IN ('cho_duyet','da_duyet','hoan_thanh') ${w} ORDER BY t.start_at`, pr)) cal.push({ at: r.start_at, end: r.end_at, kind: 'Phòng họp', what: r.descr || 'Họp', where: r.room, who: r.who, st: lbl(M.E.room_book.fields.find(x => x.k === 'status').o, r.status), c: ST_C[r.status] || 's', link: `e/room_book/${r.id}` }); }
    if (has('xe')) { const pr = [now], w = lg(U('xe'), {}, 't.legal_id', pr); for (const r of await mq(`SELECT t.id, t.start_at, t.end_at, t.route, t.status, v.plate, e.full_name who FROM hr_car_book t JOIN hr_vehicle v ON v.id=t.vehicle_id JOIN hr_employee e ON e.id=t.emp_id WHERE $1 BETWEEN (t.start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AND (t.end_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AND t.status IN ('cho_duyet','da_duyet','dang_di') ${w} ORDER BY t.start_at`, pr)) cal.push({ at: r.start_at, end: r.end_at, kind: 'Xe', what: r.route, where: r.plate, who: r.who, st: lbl(M.E.car_book.fields.find(x => x.k === 'status').o, r.status), c: r.status === 'dang_di' ? 'b' : ST_C[r.status] || 's', link: `e/car_book/${r.id}` }); }
    cal.sort((a, b) => a.at.localeCompare(b.at));
    const costParts = async mm => { const parts = []; if (has('sa')) parts.push(['Suất ăn', await cnt('sa', `SELECT coalesce(sum(amount),0) n FROM hr_meal_out t WHERE to_char(t.pay_on,'YYYY-MM')='${mm}'`), 'r/SA05']); if (has('gt')) parts.push(['Chuyển phát', await cnt('gt', `SELECT coalesce(sum(fee),0) n FROM hr_mail t WHERE to_char(t.send_on,'YYYY-MM')='${mm}'`), 'r/GT02']); if (has('xe')) { const pr = [mm], w = lg(U('xe'), p, 'b.legal_id', pr); parts.push(['Xe', (await one(`SELECT coalesce(sum(r.cost),0) n FROM hr_car_return r JOIN hr_car_book b ON b.id=r.book_id WHERE to_char(b.start_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM')=$1 ${w}`, pr)).n, 'r/XC02']); } if (has('sk')) parts.push(['Sự kiện', await cnt('sk', `SELECT coalesce(sum(c.actual_total),0) n FROM hr_event_cost c JOIN hr_event t ON t.id=c.event_id WHERE to_char(t.at,'YYYY-MM')='${mm}'`), 'r/SK03']); return parts; };
    const hist = []; for (const x of ms) hist.push(Math.round((await costParts(x)).reduce((s, y) => s + +y[1], 0) / 1e4) / 100);
    const quick = [['Đề xuất VPP', 'fa-pen-ruler', 'e/vpp_req', 'vpp'], ['Sổ kho VPP', 'fa-boxes-stacked', 'r/VPP06', 'vpp'], ['Danh mục tài sản', 'fa-laptop', 'e/asset', 'ts'], ['Điều chuyển tài sản', 'fa-right-left', 'e/asset_move', 'ts'], ['Lịch xe', 'fa-car-side', 'r/XC06', 'xe'], ['Phòng họp', 'fa-chalkboard-user', 'e/room_book', 'ph'], ['Suất ăn ngày', 'fa-bowl-food', 'e/meal_day', 'sa'], ['Gửi thư', 'fa-envelope', 'e/mail', 'gt'], ['Sự kiện', 'fa-champagne-glasses', 'e/event', 'sk']].filter(x => has(x[3]) && C.has(u, x[2].replace('/', ':'))).map(x => x.slice(0, 3));
    return { side: 'hc', title: 'Tổng quan Hành chính', sub: `${scope} · Kỳ ${mmY}`, todo, kpis: kpis.slice(0, 4), today: { title: `Lịch hôm nay ${C.dmy(now)}`, rows: cal },
      charts: [{ title: 'Chi phí hành chính 6 tháng (triệu đồng)', bar: { labels: ms.map(x => 'T' + +x.slice(5)), values: hist, unit: 'tr' } }, { title: `Cơ cấu chi phí tháng ${mmY}`, share: { items: share(await costParts(m)) } }],
      alerts: open.filter(a => a.side === 'hc'), alertsAll: 'd/DB06', quick };
  }
  // DB06 — danh sách cảnh báo đầy đủ
  const cnt = f => open.filter(f).length, by = g => open.filter(a => a.grp === g).length, hist = [];
  for (const x of ms) hist.push(open.filter(a => a.due?.startsWith(x)).length);
  return { title: 'Cảnh báo – công việc cần xử lý', sub: 'Mỗi mục có nguồn, người phụ trách và hành động; bấm để mở hồ sơ', kpis: [['Tổng cảnh báo mở', open.length, 'mục', null, 'g', 'fa-bell'], ['Quá hạn', cnt(a => a.level === 'qua_han'), 'mục', null, 'r', 'fa-circle-exclamation'], ['Sắp đến hạn', cnt(a => a.level === 'sap_den_han'), 'mục', null, 'a', 'fa-clock'], ['Đã xử lý', A.filter(a => a.done).length, 'mục', null, 'b', 'fa-circle-check']],
    charts: [{ title: 'Cảnh báo theo tháng đến hạn', bar: { labels: ms.map(x => 'T' + +x.slice(5)), values: hist, unit: 'mục' } }, { title: 'Cơ cấu cảnh báo', share: { items: share([['HĐLĐ', by('HĐLĐ')], ['Xe – tài sản', by('Xe – tài sản')], ['Nhân sự', by('Nhân sự')], ['Khác', by('Khác')]]) } }], list: A };
}

module.exports = { report, alerts, inbox, decidedRecent, dash, SPEC, R, OPEN_REPORTS, roleSees };
