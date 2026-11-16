// Bản in đầy đủ theo «Bộ 53 biểu mẫu HCNS»: trên app nhập gọn, khi in dựng lại đúng mẫu giấy và tự điền phần còn thiếu
// (pháp nhân, phòng ban, chức danh, quản lý, trưởng bộ phận, phép còn lại, người duyệt…) từ hồ sơ và từ chính phiếu.
// Mẫu nào trong bộ chỉ có ảnh màn hình phần mềm (CC04, CC08, CC09, CC10, HD09, PH01, XC04) dựng thành đơn hành chính chuẩn.
const { q, one } = require('./db');
const C = require('./core');
const B = require('./biz');

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fm = v => v == null || v === '' ? '' : Math.round(+v).toLocaleString('vi-VN');
const nu = v => v == null || v === '' ? '' : (+v).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const dmy = v => v ? C.dmy(String(v).slice(0, 10)) : '';
const vn = v => v ? new Date(new Date(v).getTime() + 7 * 3600e3).toISOString() : '';
const dhm = v => v ? `${vn(v).slice(11, 16)} ${dmy(vn(v))}` : '';
// ô điền: có giá trị thì in đậm, chưa có thì để dòng chấm để ghi tay
const F = (v, n = 34) => v != null && v !== '' ? `<b>${esc(v)}</b>` : `<span class="dot">${'.'.repeat(n)}</span>`;
const kv = (l, v, n) => `${esc(l)}: ${F(v, n)}`;
const row2 = (...cells) => `<table class="nb kv"><tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr></table>`;
const box = (on, l) => `${on ? '☑' : '☐'} ${esc(l)}`;
const grid = (cols, rows, min = 5) => { const all = [...rows]; while (all.length < min) all.push(null);
  return `<table class="g"><tr>${cols.map(c => `<th${c[2] ? ` style="width:${c[2]}"` : ''}>${esc(c[0])}</th>`).join('')}</tr>${all.map((r, i) => `<tr>${cols.map(c => { const v = r ? (typeof c[1] === 'function' ? c[1](r, i) : r[c[1]]) : c[1] === 'stt' ? i + 1 : ''; return `<td${c[3] ? ` class="${c[3]}"` : ''}>${c[1] === 'stt' ? i + 1 : esc(v ?? '')}</td>`; }).join('')}</tr>`).join('')}</table>`; };
const dateLine = d => { const x = d ? String(vn(d) || d).slice(0, 10) : ''; return `<p class="dl"><i>Bắc Ninh, ngày ${x ? x.slice(8) : '......'} tháng ${x ? x.slice(5, 7) : '......'} năm ${x ? x.slice(0, 4) : '........'}</i></p>`; };
const signs = list => `<table class="nb sg"><tr>${list.map(s => `<td><b>${esc(s[0])}</b><br><i>(Ký, ghi rõ họ tên)</i>${s[2] ? `<div class="ok">${esc(s[2])}</div>` : '<div class="sp"></div>'}<b>${esc(s[1] || '')}</b></td>`).join('')}</tr></table>`;
const QH = `<table class="nb qh"><tr><td class="c"><b>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</b><br><b><u>Độc lập - Tự do - Hạnh phúc</u></b></td></tr></table>`;

const CSS = `<style>.hd{margin-bottom:6px}.hd td{font-size:11.5pt}.kv td{padding:3px 0;width:50%;font-size:13pt}.sg td{font-size:12.5pt}.g td .dot{letter-spacing:0}.g th,.g td{font-size:11pt;padding:4px 5px}.g th{text-align:center}.g td.r{text-align:right}.g td.c{text-align:center}.dot{color:#555;letter-spacing:1px}
.dl{text-align:right;margin:14px 0 4px}.sg td{text-align:center;vertical-align:top;width:33%;padding-top:4px}.sg .sp{height:70px}.sg .ok{height:70px;padding-top:18px;font-size:10.5pt;font-style:italic;color:#1a5d1a}.qh{margin-bottom:4px}.ln{margin:5px 0}.sub{text-align:center;font-style:italic;margin-top:-2px}.days td{text-align:center;width:12.5%}</style>`;

// ---------- ngữ cảnh: phiếu + nhân viên + pháp nhân + người duyệt ----------
async function ctx(ent, g) {
  const r = g.row, x = { r, files: g.files };
  x.legal = r.legal_id ? await one('SELECT * FROM hr_legal WHERE id = $1', [r.legal_id]) : null;
  const empOf = async id => id && await one(`SELECT e.*, d.name dept, l.name legal_name, m.full_name manager, h.full_name dept_head FROM hr_employee e LEFT JOIN hr_dept d ON d.id = e.dept_id LEFT JOIN hr_legal l ON l.id = e.legal_id
    LEFT JOIN hr_employee m ON m.id = e.manager_id LEFT JOIN hr_employee h ON h.id = d.head_id WHERE e.id = $1`, [id]);
  x.emp = await empOf(ent === 'employee' ? r.id : r.emp_id);
  if (!x.legal && x.emp) x.legal = await one('SELECT * FROM hr_legal WHERE id = $1', [x.emp.legal_id]);
  x.dept = r.dept_id ? (await one('SELECT name FROM hr_dept WHERE id = $1', [r.dept_id]))?.name : x.emp?.dept;
  x.empOf = empOf;
  // người duyệt: lần duyệt gần nhất; duyệt trên nền tảng chung thì lấy tên trong ghi chú «… trên nền tảng chung bởi …» (không bắt nhầm chữ «bởi» trong ý kiến duyệt thường)
  const a = [...(g.approvals || [])].reverse().find(y => ['da_duyet', 'tu_choi'].includes(y.status));
  if (a) { const via = /trên nền tảng chung bởi (.+?)(?: lúc|:|$)/.exec(a.comment || '')?.[1]; x.appr = { name: via || a.decided_by_l, at: a.decided_at, ok: a.status === 'da_duyet', note: `${a.status === 'da_duyet' ? 'Đã duyệt' : 'Từ chối'}${via ? ' trên nền tảng chung' : ' trên app'} ${dhm(a.decided_at).slice(6)}` }; }
  return x;
}
const head = (code, x, t, sub) => `<table class="nb hd"><tr><td>PHÁP NHÂN / CÔNG TY: <b>${esc((x.legal?.name || '').toUpperCase()) || '.'.repeat(40)}</b></td><td style="text-align:right">MÃ: <b>${esc(code)}</b></td></tr></table>${t ? `<h1>${esc(t)}</h1>` : ''}${sub ? `<p class="sub">${sub}</p>` : ''}`;
const no = x => x.r.code ? `Số: ${esc(x.r.code)}` : '';
const who = x => x.emp ? `${x.emp.full_name}` : '';
const kg = x => `<p class="ln"><b>Kính gửi:</b> Ban Giám đốc ${esc(x.legal?.name || '')}<br>&emsp;&emsp;&emsp;&emsp;&nbsp; Trưởng bộ phận ${esc(x.dept || '')}<br>&emsp;&emsp;&emsp;&emsp;&nbsp; Phòng Hành chính Nhân sự</p>`;
const me = x => `<p class="ln">Tôi tên là: ${F(who(x))}&emsp; Mã nhân viên: ${F(x.emp?.code, 12)}</p><p class="ln">Chức danh: ${F(x.emp?.title)}&emsp; Bộ phận: ${F(x.dept)}</p>`;
const boss = x => x.emp?.dept_head || x.emp?.manager || '';
const okTo = (x, i) => x.appr && x.appr.ok ? x.appr.note : '';

const T = {
  // ===== VĂN PHÒNG PHẨM =====
  vpp_req: x => head('VPP01', x, 'PHIẾU ĐỀ XUẤT VĂN PHÒNG PHẨM', no(x)) + row2(kv('Phòng ban/bộ phận', x.dept), kv('Người đề xuất', who(x))) + row2(kv('Thời gian đề xuất', dmy(x.r.req_on))) +
    '<p class="ln"><b>Danh mục sản phẩm đề xuất:</b></p>' + grid([['STT', 'stt', '6%', 'c'], ['Mã sản phẩm', 'code', '16%'], ['Mô tả', 'name'], ['Đơn vị tính', 'unit', '12%', 'c'], ['Số lượng', 'qty', '11%', 'r'], ['Ghi chú', 'note', '18%']], x.r.lines || []) +
    dateLine(x.r.req_on) + signs([['NGƯỜI ĐỀ XUẤT', who(x)], ['TRƯỞNG BỘ PHẬN', boss(x)], ['HÀNH CHÍNH DUYỆT', x.appr?.name, okTo(x)]]),
  vpp_issue: async x => { const is = await x.empOf(x.r.issuer_id);
    return head('VPP02', x, 'PHIẾU CẤP PHÁT VPP', no(x)) + row2(kv('Người cấp phát', is?.full_name), kv('Phòng ban/bộ phận', is?.dept)) + row2(kv('Người nhận', who(x)), kv('Phòng ban/bộ phận', x.dept)) + row2(kv('Thời gian cấp phát', dmy(x.r.issue_on)), x.r.req_id__l ? kv('Theo phiếu đề xuất', x.r.req_id__l) : '') +
      '<p class="sub">(kế thừa danh mục từ phiếu đề xuất VPP, số lượng thực cấp theo tồn kho)</p>' + grid([['STT', 'stt', '6%', 'c'], ['Mã sản phẩm', 'code', '14%'], ['Mô tả', 'name'], ['Đơn vị tính', 'unit', '11%', 'c'], ['SL đề nghị', 'qty', '11%', 'r'], ['SL thực cấp', 'qty_out', '11%', 'r'], ['Ghi chú', 'note', '16%']], x.r.lines || []) +
      dateLine(x.r.issue_on) + signs([['NGƯỜI CẤP PHÁT', is?.full_name], ['NGƯỜI NHẬN', who(x)]]); },
  vpp_in: x => head('VPP03', x, 'PHIẾU NHẬP KHO VPP', no(x)) + row2(kv('Đơn vị cung cấp', x.r.supplier), kv('Ngày nhập', dmy(x.r.in_on))) + '<p class="ln"><b>Danh sách nhập kho</b> (kế thừa từ danh sách tổng hợp đề xuất)</p>' +
    grid([['STT', 'stt', '6%', 'c'], ['Mã VPP', 'code', '15%'], ['Tên/quy cách', 'name'], ['ĐVT', 'unit', '12%', 'c'], ['SL nhập', 'qty', '12%', 'r']], x.r.lines || []) + dateLine(x.r.in_on) + signs([['NGƯỜI GIAO HÀNG', ''], ['NGƯỜI NHẬN / THỦ KHO', ''], ['PHỤ TRÁCH HÀNH CHÍNH', '']]),
  // ===== TÀI SẢN =====
  asset_in: x => head('TS03', x, 'PHIẾU NHẬP KHO TÀI SẢN', no(x)) + row2(kv('Ngày nhập kho', dmy(x.r.in_on))) +
    grid([['STT', 'stt', '5%', 'c'], ['Mã TS', 'code', '11%'], ['Tên tài sản', 'name'], ['Model / số seri', 'model', '13%'], ['ĐVT', 'unit', '7%', 'c'], ['SL', 'qty', '6%', 'r'], ['Người sử dụng', 'user', '14%'], ['Vị trí đặt để', 'place', '12%'], ['Tình trạng', 'cond', '10%']], x.r.lines || [], 4) + dateLine(x.r.in_on) + signs([['NGƯỜI GIAO', ''], ['NGƯỜI NHẬN', ''], ['PHỤ TRÁCH HCNS', '']]),
  asset_move: async x => { const fe = await x.empOf(x.r.from_emp_id), te = await x.empOf(x.r.to_emp_id);
    return head('TS04', x, 'PHIẾU ĐIỀU CHUYỂN TÀI SẢN', no(x)) + row2(kv('Phòng ban/bộ phận', x.dept)) + row2(kv('Ngày lập', dmy(x.r.made_on))) +
      `<table class="nb kv"><tr><td>${kv('Đơn vị/bộ phận chuyển đi', x.r.dept_id__l)}</td><td>${kv('Đơn vị/bộ phận nhận', [x.r.to_dept_id__l, x.r.to_legal_id__l].filter(Boolean).join(' – '))}</td></tr><tr><td>${kv('Người bàn giao', fe?.full_name)}</td><td>${kv('Người tiếp nhận', te?.full_name)}</td></tr><tr><td>${kv('Ngày điều chuyển dự kiến', dmy(x.r.move_on))}</td><td>${kv('Lý do điều chuyển', x.r.reason)}</td></tr></table>` +
      grid([['STT', 'stt', '6%', 'c'], ['Mã TS', 'code', '14%'], ['Tên tài sản', 'name'], ['Đơn vị tính', 'unit', '11%', 'c'], ['Số lượng', 'qty', '10%', 'r'], ['Tình trạng', 'cond', '18%']], x.r.lines || [], 4) +
      dateLine(x.r.made_on) + signs([['NGƯỜI BÀN GIAO', fe?.full_name], ['NGƯỜI TIẾP NHẬN', te?.full_name], ['PHỤ TRÁCH HCNS', x.appr?.name, okTo(x)]]); },
  asset_out: x => head('TS05', x, 'PHIẾU XUẤT KHO TÀI SẢN THANH LÝ/SỬA CHỮA') + row2(kv('Pháp nhân/đơn vị', x.legal?.short), kv('Phòng ban/bộ phận', x.dept)) + row2(kv('Số phiếu/số hồ sơ', x.r.code), kv('Ngày lập', dmy(x.r.made_on))) +
    `<table class="nb kv"><tr><td>${kv('Kho xuất', x.r.store)}</td><td>${kv('Bộ phận đề xuất', x.dept)}</td></tr><tr><td>${kv('Người nhận tài sản', x.r.receiver)}</td><td>${kv('Địa điểm giao', x.r.place)}</td></tr></table>` +
    `<p class="ln">Mục đích xuất: ${box(x.r.purpose === 'thanh_ly', 'Thanh lý')}&emsp;${box(x.r.purpose === 'sua_chua', 'Mang đi sửa chữa')}&emsp;${box(x.r.purpose === 'khac', 'Khác: ....................................')}</p>` +
    grid([['STT', 'stt', '6%', 'c'], ['Mã tài sản', r => `${r.code || ''}${r.name ? ' · ' + r.name : ''}`], ['Đơn vị tính', 'unit', '11%', 'c'], ['SL', 'qty', '7%', 'r'], ['Tình trạng khi xuất', 'cond', '17%'], ['Nơi nhận / ghi chú', 'note', '20%']], x.r.lines || [], 4) +
    `<p class="ln">Căn cứ phê duyệt / chứng từ bàn giao: ${F(x.r.basis, 70)}</p><p class="ln">Thời hạn hoàn trả (nếu sửa chữa): ${F(dmy(x.r.due_on), 40)}</p>` + dateLine(x.r.made_on) + signs([['NGƯỜI LẬP', ''], ['NGƯỜI NHẬN TÀI SẢN', x.r.receiver], ['NGƯỜI PHÊ DUYỆT', x.appr?.name, okTo(x)]]),
  // ===== CHUYỂN PHÁT – SUẤT ĂN – SỰ KIỆN =====
  mail: x => head('GT01', x, 'THEO DÕI GỬI THƯ', `Biểu mẫu GT01 • Phiên bản 01 • Đơn vị sử dụng: ${esc(x.legal?.short || '')}`) +
    grid([['Ngày', r => dmy(r.send_on), '9%'], ['Nội dung', 'content'], ['Người gửi', () => who(x), '13%'], ['Bộ phận', () => x.dept, '12%'], ['Người nhận', 'to_name', '12%'], ['Địa chỉ nhận', 'to_addr', '16%'], ['SĐT', 'to_phone', '9%'], ['Số bill', 'bill_no', '8%'], ['Trạng thái', r => x.r.status__lbl || '', '9%']], [x.r], 4) +
    `<p class="ln">${kv('Nhà vận chuyển', x.r.carrier, 20)}&emsp;${kv('Cước phí', x.r.fee ? fm(x.r.fee) + ' đ' : '', 14)}&emsp;${kv('Ngày giao', dmy(x.r.done_on), 14)}</p>` + dateLine(x.r.send_on) + signs([['NGƯỜI GỬI', who(x)], ['HÀNH CHÍNH', '']]),
  meal_reg: x => { const ds = new Set(x.r.days || []), cell = d => d <= 31 ? `<td>${d}</td><td>${ds.has(d) ? '<b>X</b>' : ''}</td>` : '<td></td><td></td>';
    return head('SA01', x, 'ĐĂNG KÝ SUẤT ĂN THÁNG') + row2(kv('Họ tên', who(x)), kv('Phòng ban/bộ phận', x.dept)) + row2(kv('Tháng / năm đăng ký', x.r.month ? `${x.r.month.slice(5)}/${x.r.month.slice(0, 4)}` : '')) +
      '<p class="sub">Đánh dấu X ở ngày đăng ký; ghi mã ca ăn nếu đơn vị có nhiều ca.</p>' +
      `<table class="g days"><tr><th>Ngày</th><th>Đăng ký</th><th>Ngày</th><th>Đăng ký</th></tr>${Array.from({ length: 16 }, (_, i) => `<tr>${cell(i + 1)}${cell(i + 17)}</tr>`).join('')}</table>` +
      row2(kv('Tổng số ngày đăng ký', x.r.n_days ?? ds.size)) + dateLine(x.r.created_at) + signs([['NGƯỜI ĐĂNG KÝ', who(x)], ['HÀNH CHÍNH', '']]); },
  meal_in: x => head('SA02', x, 'PHIẾU THU TIỀN ĂN', `Kỳ: tháng ${x.r.month ? `${x.r.month.slice(5)}/${x.r.month.slice(0, 4)}` : '.../....'}`) +
    grid([['STT', 'stt', '6%', 'c'], ['Họ tên', 'name'], ['Số suất', 'qty', '10%', 'r'], ['Số tiền', r => fm(r.amount), '15%', 'r'], ['Ngày nhận', r => dmy(r.got_on), '13%'], ['Chứng từ (nếu có)', 'doc', '18%']], [x.r], 4) + dateLine(x.r.got_on) + signs([['NGƯỜI NỘP', x.r.name], ['NGƯỜI THU', '']]),
  meal_out: x => head('SA03', x, 'PHIẾU CHI BẾP', `Ngày chi: ${dmy(x.r.pay_on)}`) +
    grid([['STT', 'stt', '6%', 'c'], ['Nội dung chi', 'content'], ['Số lượng', r => nu(r.qty), '10%', 'r'], ['Đơn giá', r => fm(r.price), '13%', 'r'], ['Thành tiền', r => fm(r.amount), '14%', 'r'], ['Chứng từ (nếu có)', 'doc', '16%']], [x.r], 4) +
    `<p class="ln">Tổng tiền chi: ${F(x.r.amount ? fm(x.r.amount) + ' đồng' : '', 60)}</p>` + dateLine(x.r.pay_on) + signs([['NGƯỜI NHẬN TIỀN', ''], ['NGƯỜI CHI', ''], ['PHỤ TRÁCH HCNS', '']]),
  event: async x => { const host = await x.empOf(x.r.host_id), kinds = new Set((x.files || []).map(f => f.kind));
    return head('SK01', x, 'PHIẾU TẠO SỰ KIỆN', `Biểu mẫu SK01 • Phiên bản 01 • Đơn vị sử dụng: ${esc(x.legal?.short || '')}`) + row2(kv('Tên sự kiện/chủ đề', x.r.name), kv('Đơn vị tổ chức', x.r.org)) +
      `<table class="nb kv"><tr><td>${kv('Ngày/giờ tổ chức', dhm(x.r.at))}</td><td>${kv('Địa điểm', x.r.place)}</td></tr><tr><td>${kv('Số lượng tham gia', x.r.attended ?? x.r.invited)}</td><td>${kv('Ngân sách đề xuất', x.r.budget ? fm(x.r.budget) + ' đ' : '')}</td></tr></table>` +
      '<p class="ln"><b>Kế hoạch đầu việc</b></p>' + grid([['STT', 'stt', '6%', 'c'], ['Đầu việc', 'task'], ['Người phụ trách', 'who', '18%'], ['Hạn hoàn thành', 'due', '14%'], ['Kết quả cần có', 'result', '22%']], x.r.tasks || []) +
      `<p class="ln">Hồ sơ kèm theo: ${box(kinds.has('ct'), 'Chương trình')}&emsp;${box(kinds.has('dt'), 'Dự toán')}&emsp;${box(kinds.has('ds'), 'Danh sách khách')}</p>` + dateLine(x.r.created_at) + signs([['NGƯỜI LẬP', host?.full_name], ['PHÊ DUYỆT', x.appr?.name, okTo(x)]]); },
  event_cost: async x => { const ev = x.r.event_id && await one('SELECT * FROM hr_event WHERE id = $1', [x.r.event_id]); if (ev && !x.legal) x.legal = await one('SELECT * FROM hr_legal WHERE id = $1', [ev.legal_id]);
    const L = x.r.lines || [], S = k => L.reduce((s, l) => s + (+l[k] || 0), 0);
    return head('Sk02', x, 'PHIẾU CHI PHÍ SỰ KIỆN', no(x)) + row2(kv('Mã / tên sự kiện', ev ? `${ev.code} · ${ev.name}` : ''), kv('Ngày tổ chức', ev ? dhm(ev.at) : '')) +
      grid([['STT', 'stt', '6%', 'c'], ['Hạng mục chi', 'item'], ['Dự toán', r => fm(r.plan), '14%', 'r'], ['Thực chi', r => fm(r.actual), '14%', 'r'], ['Chênh lệch', r => fm((+r.actual || 0) - (+r.plan || 0)), '13%', 'r'], ['Chứng từ', 'doc', '16%']], L, 6).replace('</table>', `<tr><td></td><td><b>TỔNG CỘNG</b></td><td class="r"><b>${fm(S('plan'))}</b></td><td class="r"><b>${fm(S('actual'))}</b></td><td class="r"><b>${fm(S('actual') - S('plan'))}</b></td><td></td></tr></table>`) +
      dateLine(x.r.created_at) + signs([['NGƯỜI LẬP', ''], ['KẾ TOÁN', ''], ['PHÊ DUYỆT', '']]); },
  // ===== DỊCH VỤ CÔNG =====
  car_return: async x => { const b = x.r.book_id && await one('SELECT b.*, v.plate, v.code vc FROM hr_car_book b JOIN hr_vehicle v ON v.id = b.vehicle_id WHERE b.id = $1', [x.r.book_id]), be = b && await x.empOf(b.emp_id);
    if (b && !x.legal) x.legal = await one('SELECT * FROM hr_legal WHERE id = $1', [b.legal_id]);
    const ck = (v, l) => `${box(v === 'tot', 'Bình thường')}&emsp;${box(v === 'hong', 'Có hư hỏng')}`;
    return head('XC05', x, 'PHIẾU TRẢ XE', `Kế thừa từ phiếu mượn xe ${esc(b?.code || '')}`) + row2(kv('Người mượn', be?.full_name), kv('Xe', b ? `${b.vc} · ${b.plate}` : '')) +
      `<table class="g"><tr><th>NHẬN XE</th><th>TRẢ XE</th></tr><tr><td>${kv('Ngày/giờ nhận xe', dhm(x.r.got_at))}</td><td>${kv('Ngày/giờ trả xe', dhm(x.r.back_at))}</td></tr><tr><td>${kv('Km khi nhận', nu(x.r.km_in))}</td><td>${kv('Km khi trả', nu(x.r.km_out))}</td></tr>
      <tr><td>${kv('Mức nhiên liệu lúc nhận', x.r.fuel_in)}</td><td>${kv('Mức nhiên liệu lúc trả', x.r.fuel_out)}</td></tr><tr><td>Tình trạng khi nhận: ${ck(x.r.cond_in)}</td><td>Tình trạng khi trả: ${ck(x.r.cond_out)}</td></tr></table>` +
      `<p class="ln">Hư hỏng / sự cố / vi phạm (nếu có): ${F(x.r.damage, 70)}</p><p class="ln">Chi phí phát sinh, chứng từ: ${F([x.r.cost ? fm(x.r.cost) + ' đ' : '', x.r.cost_doc].filter(Boolean).join(' · '), 70)}</p>` +
      `<p class="ln">Phụ kiện, giấy tờ đã bàn giao lại: ${box(x.r.papers_back === true, 'Đã trả')}&emsp;${box(x.r.papers_back === false, 'Chưa trả')}</p>` + dateLine(x.r.back_at) + signs([['NGƯỜI TRẢ XE', be?.full_name], ['NGƯỜI NHẬN XE (HÀNH CHÍNH)', '']]); },
  // ===== TUYỂN DỤNG – HỒ SƠ =====
  rec_plan: x => head('TD01', x, 'KẾ HOẠCH TUYỂN DỤNG', no(x)) + row2(kv('Kỳ kế hoạch', x.r.period), kv('Tổng ngân sách tuyển dụng', x.r.cost ? fm(x.r.cost) + ' đ' : '')) + row2(kv('Bộ phận', x.r.dept_id__l), kv('Ngày yêu cầu', dmy(x.r.req_on))) +
    grid([['STT', 'stt', '5%', 'c'], ['Vị trí / chức danh', 'position'], ['Số lượng', 'qty', '8%', 'r'], ['Tiêu chí tuyển dụng', 'criteria', '24%'], ['Kênh tuyển dụng', 'channel', '13%'], ['Thời hạn cần', r => dmy(r.due_on), '11%'], ['Chi phí dự kiến', r => fm(r.cost), '12%', 'r']], [x.r]) +
    dateLine(x.r.req_on) + signs([['NGƯỜI LẬP', ''], ['TRƯỞNG PHÒNG HCNS', ''], ['PHÊ DUYỆT', x.appr?.name, okTo(x)]]),
  employee: async x => { const e = x.emp || {}, d = new Set(x.r.docs || []), ppl = (rows, cols) => grid(cols, rows, 3);
    return head('HS01', x, 'HỒ SƠ NHÂN SỰ', `Biểu mẫu HS01 • Phiên bản 01 • Đơn vị sử dụng: ${esc(e.legal_name ? x.legal?.short : '')}`) + row2(kv('Pháp nhân/đơn vị', x.legal?.short), kv('Phòng ban/bộ phận', e.dept)) +
      `<table class="nb kv"><tr><td>${kv('Mã nhân viên', e.code)}</td><td>${kv('Pháp nhân ký HĐLĐ', x.legal?.name)}</td></tr><tr><td>${kv('Họ và tên', e.full_name)}</td><td>${kv('Giới tính', e.gender)}</td></tr><tr><td>${kv('Ngày sinh', dmy(x.r.dob))}</td><td></td></tr>
      <tr><td>${kv('Số định danh/CCCD', x.r.cccd)}</td><td>${kv('Ngày cấp / nơi cấp', [dmy(x.r.cccd_date), x.r.cccd_place].filter(Boolean).join(' – '))}</td></tr><tr><td colspan="2">${kv('Địa chỉ cư trú', x.r.address, 80)}</td></tr><tr><td>${kv('Điện thoại cá nhân', x.r.phone)}</td><td>${kv('Email cá nhân', x.r.email)}</td></tr></table>` +
      `<p class="ln">Trường học / chuyên ngành: ${F(x.r.school, 60)}</p><p class="ln">Chứng chỉ/ chứng nhận: ${F(x.r.cert, 60)}</p><p class="ln">Phân loại sức khỏe: ${F(x.r.health, 30)}</p><p class="ln">An toàn lao động: Nhóm: ${F(x.r.safety_group, 10)} Thời hạn: ${F(dmy(x.r.safety_to), 14)}</p>` +
      '<p class="ln"><b>Thông tin làm việc và thanh toán</b></p>' + `<table class="nb kv"><tr><td colspan="2">${kv('Phòng ban / chức danh', [e.dept, x.r.title].filter(Boolean).join(' / '), 60)}</td></tr><tr><td colspan="2">${kv('Ngày vào làm', dmy(x.r.join_on))}</td></tr><tr><td>${kv('Ngân hàng / chi nhánh', x.r.bank)}</td><td>${kv('Số tài khoản', x.r.bank_acct)}</td></tr></table>` +
      '<p class="ln"><b>Liên hệ khẩn cấp</b></p>' + ppl(x.r.contacts || [], [['Họ tên', 'name'], ['Quan hệ', 'rel', '15%'], ['Số điện thoại', 'phone', '20%'], ['Thông tin cần thiết', 'info', '30%']]) +
      '<p class="ln"><b>Thông tin người phụ thuộc</b></p>' + ppl(x.r.dependents || [], [['Họ tên', 'name'], ['Quan hệ', 'rel', '15%'], ['Số CCCD', 'id_no', '22%'], ['Ngày sinh', r => dmy(r.dob), '16%']]) +
      `<p class="ln"><b>Hồ sơ đã nộp / đối chiếu</b><br>${[['gks', 'Giấy khám sức khỏe'], ['syll', 'SYLL'], ['cu_tru', 'Xác nhận cư trú'], ['cccd', 'CCCD'], ['bang', 'Bằng cấp/chứng chỉ'], ['khac', 'Hồ sơ khác']].map(([k, l]) => box(d.has(k), l)).join('&emsp;')}</p>` +
      dateLine(new Date().toISOString()) + signs([['NGƯỜI LAO ĐỘNG', e.full_name], ['CÁN BỘ HCNS', '']]); },
  // ===== CHẤM CÔNG – ĐƠN TỪ =====
  explain: x => { const k = x.r.kind;
    return head('CC03', x, 'PHIẾU GIẢI TRÌNH CÔNG', no(x)) + row2(kv('Họ tên / mã NV', x.emp ? `${x.emp.full_name} / ${x.emp.code}` : ''), kv('Ngày cần giải trình', dmy(x.r.day))) + row2(kv('Bộ phận', x.dept), kv('Loại sai lệch', { quen_vao: 'Thiếu giờ vào', quen_ra: 'Thiếu giờ ra', sai_diem: 'Sai địa điểm', loi_ht: 'Lỗi hệ thống', khac: 'Khác' }[k])) +
      `<p class="ln">Lỗi: ${box(k === 'quen_vao', 'Quên check-in')}&emsp;${box(k === 'quen_ra', 'Quên check-out')}&emsp;${box(k === 'sai_diem', 'Sai địa điểm')}&emsp;${box(k === 'loi_ht', 'Lỗi hệ thống')}&emsp;${box(k === 'khac', 'Khác')}</p>` +
      row2(kv('Thời gian đúng đề nghị', x.r.right_time)) + `<p class="ln">Lý do giải trình: ${F(x.r.reason, 80)}</p><p class="ln">Minh chứng kèm theo: ${F(x.r.proof, 80)}</p>` +
      dateLine(x.r.created_at) + signs([['NGƯỜI GIẢI TRÌNH', who(x)], ['QUẢN LÝ TRỰC TIẾP', x.emp?.manager || ''], ['HCNS DUYỆT CÔNG', x.appr?.name, okTo(x)]]); },
};

// ---------- mẫu HĐ / QĐ / đơn nghỉ việc theo Sổ QLLĐ: HCNS sửa được (hr_template), {{tên}} = chỗ tự điền ----------
const TPL = { ...require('./tpl-defaults'), ...require('./tpl-don') };   // tpl-don: app tự dựng (có chữ MẪU)
const DON = new Set(Object.keys(require('./tpl-don')));
const ENT_TPL = { leave: 'DON_PHEP', trip: 'DON_CONG_TAC', ot: 'DON_TANG_CA', att_add: 'PHIEU_CHAM_BS', room_book: 'PHONG_HOP', car_book: 'MUON_XE', resign: 'DON_NGHI', rec_memo: 'TO_TRINH' };
const entOfTpl = k => Object.values(CT_TPL).includes(k) || k === 'HDLD_QL' ? 'contract' : Object.values(DEC_TPL).includes(k) ? 'decision' : Object.keys(ENT_TPL).find(e => ENT_TPL[e] === k);
for (const [k, v] of Object.entries(TPL)) { v.ent = null; v.src = DON.has(k) ? 'tu_tao' : 'soqld'; }
const CT_TPL = { HD01: 'HDTV', HD02: 'HDLD_XDTH', HD03: 'HDLD_KXD', HD04: 'PLHD' }, DEC_TPL = { HD08: 'QD_LUONG', HD10: 'QD_CD', HD11: 'QD_CD_TV' };
const tplKey = (ent, r) => ent === 'contract' ? r.tpl || CT_TPL[r.kind] : ent === 'decision' ? DEC_TPL[r.kind] : ENT_TPL[ent] || null;
const tplBody = async key => (await one('SELECT body FROM hr_template WHERE key = $1', [key]))?.body || TPL[key]?.body;
const VARS = [['legal_upper', 'TÊN PHÁP NHÂN (in hoa)'], ['legal_name', 'Tên pháp nhân'], ['legal_address', 'Địa chỉ pháp nhân'], ['legal_phone', 'Điện thoại pháp nhân'], ['legal_tax', 'MST pháp nhân'], ['legal_rep', 'Đại diện pháp luật'], ['legal_signer', 'Người ký HĐLĐ (theo ủy quyền)'], ['hcns_head', 'Trưởng phòng HCNS (ký TUQ)'],
  ['full_name', 'Họ tên NLĐ'], ['emp_code', 'Mã NV'], ['dob', 'Ngày sinh'], ['address', 'Hộ khẩu / địa chỉ'], ['cccd', 'Số CCCD'], ['cccd_date', 'Ngày cấp CCCD'], ['cccd_place', 'Nơi cấp CCCD'], ['phone', 'Điện thoại NLĐ'], ['school', 'Trình độ chuyên môn'], ['title', 'Chức danh'], ['dept', 'Bộ phận'], ['manager', 'Quản lý trực tiếp'], ['dept_head', 'Trưởng bộ phận'], ['join_on', 'Ngày vào làm'],
  ['no', 'Số HĐ / phụ lục'], ['dec_no', 'Số quyết định'], ['code', 'Số đơn'], ['sign_d', 'Ngày ký'], ['sign_m', 'Tháng ký'], ['sign_y', 'Năm ký'], ['from_on', 'Hiệu lực từ ngày'], ['to_on', 'Đến ngày'], ['eff_on', 'Ngày hiệu lực QĐ'],
  ['p1', 'Lương P1'], ['p2', 'Lương P2'], ['support', 'Tổng phụ cấp tháng'], ['al_lunch', 'Phụ cấp ăn trưa (đ/suất/ngày)'], ['al_trip', 'Công tác phí'],
  ['ref_no', 'Số HĐ căn cứ'], ['ref_sign', 'Ngày ký HĐ căn cứ'], ['old_p1', 'P1 cũ'], ['old_p2', 'P2 cũ'], ['old_support', 'Hỗ trợ cũ'], ['old_total', 'Tổng cũ'], ['new_p1', 'P1 mới'], ['new_p2', 'P2 mới'], ['new_total', 'Tổng mới'],
  ['last_day', 'Ngày làm việc cuối'], ['reason', 'Lý do'], ['approver', 'Người duyệt'], ['appr_note', 'Ghi chú đã duyệt (ngày, nơi duyệt)'], ['leave_type', 'Loại nghỉ'], ['leave_left', 'Phép còn lại'], ['cover', 'Người làm thay']];
// chỗ điền theo từng trường của phiếu: {{f_<mã trường>}}
const fieldVars = ent => [...(C.E[ent]?.fields || []).filter(f => !f.grid && f.t !== 'json' && f.k !== 'status').map(f => ['f_' + f.k, '• ' + f.l]), ...(C.E[ent]?.fields || []).filter(f => f.grid).map(f => ['grid_' + f.k, '• Bảng: ' + f.l])];
const fmtField = (f, r) => { const v = r[f.k]; if (v == null || v === '') return ''; return f.t === 'date' ? dmy(v) : f.t === 'dt' ? dhm(v) : f.t === 'money' ? fm(v) : ['num', 'int'].includes(f.t) ? nu(v) : f.t === 'bool' ? (v ? '☑ Có' : '☐ Không') : f.t === 'sel' ? (f.o || []).find(o => o[0] === v)?.[1] || v : f.t === 'ref' ? r[f.k + '__l'] || v : Array.isArray(v) ? v.join(', ') : v; };
const AL = ['al_trip'], sumAl = c => c ? AL.reduce((s, k) => s + (+c[k] || 0), 0) : 0;   // hỗ trợ xăng xe / điện thoại / nhà ở / trang phục đã bỏ khỏi HĐ; ăn trưa tính theo suất/ngày, không cộng vào tổng tháng
async function tplVars(ent, x) {
  const r = x.r, e = x.emp || {}, L = x.legal || {}, d = String(r.sign_on || r.made_on || r.reg_on || (r.created_at && vn(r.created_at)) || r.from_on || C.today()).slice(0, 10);
  const v = { legal_upper: (L.name || '').toUpperCase(), legal_name: L.name, legal_address: L.address, legal_phone: L.phone, legal_tax: L.tax_code, legal_rep: L.rep,
    full_name: e.full_name, emp_code: e.code, dob: dmy(e.dob), address: e.address, cccd: e.cccd, cccd_date: dmy(e.cccd_date), cccd_place: e.cccd_place, phone: e.phone, school: e.school, title: r.title || e.title, dept: x.dept, manager: e.manager || e.dept_head || 'Trưởng bộ phận', dept_head: e.dept_head || e.manager, join_on: dmy(e.join_on),
    no: r.no || r.code, dec_no: r.no, code: r.code, sign_d: d.slice(8, 10), sign_m: d.slice(5, 7), sign_y: d.slice(0, 4), from_on: dmy(r.from_on), to_on: dmy(r.to_on), eff_on: dmy(r.from_on), last_day: dmy(r.last_day), reason: r.reason, approver: x.appr?.ok ? x.appr.name : '', appr_note: x.appr?.ok ? x.appr.note : '' };
  for (const f of C.E[ent].fields) if (!f.grid && f.t !== 'json') v['f_' + f.k] = fmtField(f, r);
  if (ent === 'leave') { const tt = r.type_code && await one('SELECT name FROM hr_att_type WHERE code = $1', [r.type_code]), cv = await x.empOf(r.cover_id), y = String(r.from_on || '').slice(0, 4), bal = x.emp && y && await B.leaveLeft({ q, one }, x.emp.id, y, r.id);
    Object.assign(v, { leave_type: tt ? `${r.type_code} – ${tt.name}` : r.type_code, cover: cv ? `${cv.full_name} (${cv.code})` : '', leave_left: bal == null ? '' : nu(bal), dept_head: x.appr?.ok ? x.appr.name : v.dept_head }); }
  if (['trip', 'ot'].includes(ent) && x.appr?.ok) v.dept_head = x.appr.name;
  v.gender = e.gender || '';
  v.hcns_head = (await one("SELECT full_name FROM hr_user WHERE role = 'tp_hcns' AND active ORDER BY id LIMIT 1"))?.full_name || '';   // ký TUQ trên HĐ/QĐ — không viết cứng tên trong mẫu
  if (L.signer) v.legal_signer = L.signer + (L.signer_auth ? ` (${L.signer_auth})` : '');   // người ký HĐLĐ theo từng pháp nhân (chưa khai báo → để chấm điền tay)
  if (ent === 'resign') { const q2 = r.last_day ? C.addDays(r.last_day, 1) : null; Object.assign(v, { quit_on: dmy(q2), notice_days: q2 && r.made_on ? String(C.dayDiff(r.made_on, q2)) : '' }); }   // nghỉ từ ngày sau ngày làm việc cuối
  if (ent === 'rec_memo') { const tv = r.kind === 'het_tv';
    Object.assign(v, { memo_about: tv ? 'sau thời gian thử việc' : 'sau phỏng vấn tuyển dụng', memo_basis: tv ? `kết quả đánh giá thử việc ngày ${dmy(r.eval_on)} và đề xuất tiếp nhận nhân sự sau thử việc` : `kết quả phỏng vấn tuyển dụng ngày ${dmy(r.eval_on)} và đề xuất tiếp nhận nhân sự`,
      memo_sec2: tv ? 'KẾT QUẢ ĐÁNH GIÁ THỬ VIỆC' : 'KẾT QUẢ PHỎNG VẤN', memo_trial: { html: tv ? `<p>- Thời gian thử việc: Từ ngày ${esc(dmy(r.trial_from))} đến hết ngày ${esc(dmy(r.trial_to))}</p>` : '' },
      sender: (await one("SELECT full_name FROM hr_user WHERE role = 'tp_hcns' AND active ORDER BY id LIMIT 1"))?.full_name || '', to_whom_up: String(r.to_whom || 'Tổng Giám đốc').toUpperCase(), memo_more: { html: r.content ? `<p>${esc(r.content).replace(/\n/g, '<br>')}</p>` : '' },
      memo_accept: tv ? `Tiếp nhận ${r.full_name || ''} vào làm việc chính thức ở vị trí nêu trên kể từ ngày ${dmy(r.start_on)}.` : `Tiếp nhận ${r.full_name || ''} vào thử việc ở vị trí nêu trên kể từ ngày ${dmy(r.start_on)}.`,
      memo_salary: r.p1 ? `${fm((+r.p1 || 0) + (+r.p2 || 0))} đồng/tháng theo thỏa thuận${r.p2 ? ` (P1 ${fm(r.p1)} đồng, P2 ${fm(r.p2)} đồng)` : ''}` : '……… đồng/tháng theo thỏa thuận',
      memo_do: tv ? 'Giao Phòng Hành chính Nhân sự hoàn thiện thủ tục tiếp nhận và ký hợp đồng lao động theo quy định, sau khi được phê duyệt.' : 'Giao Phòng Hành chính Nhân sự thông báo kết quả, hoàn thiện thủ tục tiếp nhận và ký hợp đồng thử việc theo quy định, sau khi được phê duyệt.' }); }
  // HĐ căn cứ: HĐ chính gần nhất trước phiếu này (QĐ chấm dứt thử việc → HĐ thử việc)
  const main = r.emp_id && await one(`SELECT * FROM hr_contract WHERE emp_id = $1 AND kind <> 'HD04' AND id <> $2 AND from_on <= $3 ${ent === 'decision' && r.kind === 'HD11' ? "AND kind = 'HD01'" : ent === 'decision' && r.kind === 'HD10' ? "AND kind <> 'HD01'" : ''} ORDER BY from_on DESC, id DESC LIMIT 1`, [r.emp_id, ent === 'contract' ? r.id : 0, r.from_on || C.today()]);
  if (main) Object.assign(v, { ref_no: main.no, ref_sign: dmy(main.sign_on || main.from_on) });
  if (ent === 'contract') {
    const p1 = r.salary ?? e.pay_p1, p2 = r.p2 ?? e.pay_p2; Object.assign(v, { p1: fm(p1), p2: fm(p2), support: fm(sumAl(r)), new_total: fm((+p1 || 0) + (+p2 || 0) + sumAl(r)) }); for (const k of AL) v[k] = fm(r[k]); v.al_lunch = fm(r.al_lunch ?? 25000);
    const prev = await one('SELECT * FROM hr_contract WHERE emp_id = $1 AND id <> $2 AND from_on <= $3 ORDER BY from_on DESC, id DESC LIMIT 1', [r.emp_id, r.id, r.from_on]);
    if (prev && x.pay !== false) Object.assign(v, { old_p1: fm(prev.salary), old_p2: fm(prev.p2), old_support: fm(sumAl(prev)), old_total: fm((+prev.salary || 0) + (+prev.p2 || 0) + sumAl(prev)) });
  }
  if (ent === 'decision') {
    const o1 = r.old_p1 ?? e.pay_p1, o2 = r.old_p2 ?? e.pay_p2, n1 = r.new_p1 ?? o1, n2 = r.new_p2 ?? o2;
    Object.assign(v, { old_p1: fm(o1), old_p2: fm(o2), old_total: fm((+o1 || 0) + (+o2 || 0)), new_p1: fm(n1), new_p2: fm(n2), new_total: fm((+n1 || 0) + (+n2 || 0)) });
  }
  return v;
}
const fill = (body, v) => body.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k]?.html ?? (v[k] != null && v[k] !== '' ? esc(v[k]) : '<span class="dot">..................</span>'));   // {html}: bảng dựng sẵn
const TCSS = `<style>#doc h2{text-align:center;font-size:15pt;margin:14px 0 8px}#doc p{margin:4px 0;text-align:justify;line-height:1.45}#doc .c{text-align:center}#doc .kv .lb{display:inline-block;min-width:170px}#doc .hd,#doc .sg{border:none}#doc .hd td,#doc .sg td{border:none!important}#doc .hd td{width:50%;text-align:center;vertical-align:top;font-size:12pt}
#doc .g{width:100%;border-collapse:collapse;margin:6px 0}#doc .g th,#doc .g td{border:1px solid #333;padding:4px 6px;font-size:11.5pt}#doc .g td.r{text-align:right}#doc .sg{width:100%;margin-top:14px}#doc .sg td{width:50%;text-align:center;vertical-align:top}#doc .sg.qd td:first-child{text-align:left;font-size:11pt}#doc .sg .sp{height:80px}#doc .dot{color:#555}#doc .dl{text-align:right}#doc .hd2{width:100%;border:none}#doc .hd2 td{border:none!important;font-size:11.5pt}#doc .sg3{width:100%;margin-top:10px;border:none}#doc .sg3 td{border:none!important;width:33%;text-align:center;vertical-align:top}#doc .sg3 .sp{height:70px;font-size:10.5pt;font-style:italic;color:#1a5d1a;padding-top:14px}
#doc .mau,.paper .mau{display:inline-block;border:1.5px solid #c00;color:#c00;font:700 10pt Arial,sans-serif;padding:0 5px;border-radius:3px;vertical-align:middle;letter-spacing:1px}</style>`;

﻿// ---------- mẫu in theo từng mục: mẫu gốc + mẫu HCNS thêm (hr_template.ent); in theo mẫu được chọn hoặc mẫu mặc định ----------
const FIXED = { BO53: 'Theo Bộ 53 biểu mẫu công ty (in đúng mẫu, không sửa mẫu)', CHUNG: 'Mẫu in chung của app' };
const builtinsOf = ent => Object.entries(TPL).filter(([k, v]) => v.ent === ent && !LETTER[k]).map(([k, v]) => ({ key: k, name: v.name, kinds: ['contract', 'decision'].includes(ent) ? v.kinds : null, src: v.src }));
async function templatesFor(ent, r) {
  const own = await q('SELECT key, name, kinds, is_default, updated_at FROM hr_template WHERE ent = $1 ORDER BY updated_at', [ent]);
  const fit = x => !r || !x.kinds?.length || x.kinds.includes(r.kind);
  const list = [...builtinsOf(ent).filter(fit), ...(T[ent] ? [{ key: 'BO53', name: FIXED.BO53, src: 'bo53', fixed: 1 }] : []), ...own.filter(fit).map(x => ({ key: x.key, name: x.name, kinds: x.kinds, src: 'hcns', is_default: x.is_default, at: x.updated_at }))];
  if (!list.length || (!T[ent] && !builtinsOf(ent).length)) list.splice(list.filter(x => x.src !== 'hcns').length, 0, { key: 'CHUNG', name: FIXED.CHUNG, src: 'chung', fixed: 1 });
  return list;
}
// mẫu được in khi không chọn: mẫu HCNS đặt mặc định → mẫu gốc theo loại → Bộ 53 → mẫu chung
async function defaultKey(ent, r) {
  const d = (await templatesFor(ent, r)).find(x => x.is_default); if (d) return d.key;
  const k = tplKey(ent, r); if (k && TPL[k]) return k;
  return T[ent] ? 'BO53' : 'CHUNG';
}
// khung mẫu mới cho mục chưa có mẫu sửa được: đầu trang + mọi trường của phiếu + bảng + ký
function skeleton(ent) {
  const e = C.E[ent], fs = e.fields.filter(f => !f.hide && !['code', 'json'].includes(f.t) && !f.grid && f.k !== 'status'), gs = e.fields.filter(f => f.grid);
  return `<table class="hd2"><tr><td>PHÁP NHÂN / CÔNG TY: <b>{{legal_upper}}</b></td><td style="text-align:right">MÃ: <b>${esc(e.code || '')}</b></td></tr></table>\n<h2>${esc(e.title.toUpperCase())}</h2>\n<p class="c"><i>Số: {{code}}</i></p>\n` +
    fs.map(f => `<p>${esc(f.l)}: <b>{{f_${f.k}}}</b></p>`).join('\n') + '\n' + gs.map(f => `<p><b>${esc(f.l)}:</b></p>\n{{grid_${f.k}}}`).join('\n') +
    '\n<p class="dl"><i>Bắc Ninh, ngày {{sign_d}} tháng {{sign_m}} năm {{sign_y}}</i></p>\n<table class="sg3"><tr><td><b>NGƯỜI LẬP</b><br><i>(Ký, ghi rõ họ tên)</i></td><td><b>TRƯỞNG BỘ PHẬN</b><br><i>(Ký, ghi rõ họ tên)</i></td><td><b>PHÒNG HCNS</b><br><i>(Ký, ghi rõ họ tên)</i></td></tr><tr><td class="sp"></td><td class="sp"></td><td class="sp">{{appr_note}}</td></tr><tr><td><b>{{full_name}}</b></td><td><b>{{dept_head}}</b></td><td><b>{{approver}}</b></td></tr></table>\n';
}
const gridHtml = (f, rows) => `<table class="g"><tr><th>STT</th>${f.grid.map(c => `<th>${esc(c.l)}</th>`).join('')}</tr>${(rows || []).map((l, i) => `<tr><td class="c">${i + 1}</td>${f.grid.map(c => `<td${c.n ? ' class="r"' : ''}>${esc(c.n && isFinite(l[c.k]) ? nu(l[c.k]) : l[c.k] ?? '')}</td>`).join('')}</tr>`).join('')}</table>`;

async function render(entKey, id, user, want) {
  const g = await C.get(entKey, id, user, { reveal: true }), r = g.row, st = C.E[entKey].fields.find(f => f.k === 'status');
  const list = await templatesFor(entKey, r), key = want && list.some(x => x.key === want) ? want : await defaultKey(entKey, r), title = `${C.E[entKey].code} ${r.code || r.no || id}`;
  if (key === 'CHUNG') return null;   // print.js dựng mẫu chung
  const x = await ctx(entKey, g); if (st) x.r.status__lbl = st.o?.find(o => o[0] === x.r.status)?.[1] || '';
  // hồ sơ NV trên bản in: che CCCD / lương như khi xem (vai trò không được xem thì không in ra được)
  if (x.emp) C.maskPii(C.E.employee, x.emp, user, true);
  x.pay = require('./meta').PAY_ROLES.includes(user.role) || (!!user.emp_id && r.emp_id === user.emp_id);
  if (key === 'BO53') return { title, body: CSS + await T[entKey](x) };
  const v = await tplVars(entKey, x); for (const f of C.E[entKey].fields.filter(f => f.grid)) v['grid_' + f.k] = { html: gridHtml(f, r[f.k]) };
  return { title, body: TCSS + fill(await tplBody(key), v) };
}
// thư mời / thư báo kết quả phỏng vấn: mỗi ứng viên một trang (kết quả: chỉ người đã có kết quả)
const RESULT_TEXT = { 'Đạt': 'Chúc mừng Anh/Chị đã trúng tuyển. Phòng Hành chính Nhân sự sẽ liên hệ để thống nhất ngày nhận việc và hồ sơ cần chuẩn bị.', 'Không đạt': 'Rất tiếc hồ sơ của Anh/Chị chưa phù hợp với vị trí lần này. Chúng tôi xin lưu hồ sơ và sẽ liên hệ khi có vị trí phù hợp hơn. Chân thành cảm ơn Anh/Chị.', 'Vắng': 'Anh/Chị đã vắng mặt tại buổi phỏng vấn. Nếu vẫn quan tâm vị trí, vui lòng liên hệ Phòng Hành chính Nhân sự để sắp xếp lịch khác.' };
// từng thư một: ứng viên (liên hệ để nền tảng gửi), nội dung HTML; dùng cho in và cho «Gửi lên app»
async function letterItems(id, user, kind, codes) {   // codes: chỉ các ứng viên này (tự gửi)
  const g = await C.get('interview', id, user, { reveal: true }), x = await ctx('interview', g), r = g.row, key = kind === 'kq' ? 'THU_KQ_PV' : 'THU_MOI_PV';
  const lines = (r.lines || []).filter(l => l.code && (kind !== 'kq' || l.result) && (!codes || codes.includes(l.code))); if (!lines.length) C.bad(kind === 'kq' ? 'Chưa có ứng viên nào có kết quả' : 'Lịch chưa có ứng viên');
  const base = await tplVars('interview', x), body = await tplBody(key), room = r.room_id__l, place = r.mode === 'online' ? r.link || 'Link Teams sẽ gửi sau' : [room, r.place].filter(Boolean).join(' – ');
  const out = [];
  for (const l of lines) {
    const c = await one('SELECT id, code, full_name, position, email, phone FROM hr_candidate WHERE code = $1', [l.code]);
    out.push({ cand: { code: l.code, name: c?.full_name || l.name, email: c?.email || null, phone: c?.phone || null, position: c?.position || null }, result: l.result || null,
      html: fill(body, { ...base, cand_name: c?.full_name || l.name, cand_position: c?.position, cand_time: l.start || (r.start_at ? vn(r.start_at).slice(11, 16) : ''), pv_place: place, cand_result: l.result, result_text: RESULT_TEXT[l.result] || '', sender: user.full_name }) });
  }
  return { r, items: out, title: kind === 'kq' ? 'Thư báo kết quả phỏng vấn' : 'Thư mời phỏng vấn' };
}
async function letters(id, user, kind, code) {   // code: in riêng một ứng viên
  const { r, items, title } = await letterItems(id, user, kind, code ? [String(code)] : undefined);
  return { title: `${title} ${r.code}`, body: TCSS + items.map(x => x.html).join('<div style="page-break-after:always"></div>') };
}
// bản chữ của thư (tin nhắn / email không đọc HTML): bỏ thẻ, ô trống, chữ MẪU
const letterText = html => html.replace(/<span class="mau">MẪU<\/span>/g, '').replace(/<span class="dot">\.+<\/span>/g, '…').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|h2|tr|table)>/gi, '\n').replace(/<\/td>/gi, '   ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const LETTER = { THU_MOI_PV: 'interview', THU_KQ_PV: 'interview' };
for (const k of Object.keys(TPL)) TPL[k].ent = LETTER[k] || entOfTpl(k);
VARS.push(['cand_name', 'Tên ứng viên'], ['cand_position', 'Vị trí ứng tuyển'], ['cand_time', 'Giờ phỏng vấn của ứng viên'], ['pv_place', 'Địa điểm / link phỏng vấn'], ['cand_result', 'Kết quả'], ['result_text', 'Lời báo theo kết quả'], ['sender', 'Người gửi (HCNS)']);
module.exports = { render, letters, letterItems, letterText, templatesFor, defaultKey, skeleton, FIXED, FORMS: [...Object.keys(T), 'contract', 'decision'], TPL, VARS, fieldVars, T_CODE: Object.keys(T) };
