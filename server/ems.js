// Tra cứu vận đơn EMS Việt Nam (API đối tác: docws.ems.com.vn — «Chi tiết bưu gửi») → cập nhật trạng thái phiếu gửi thư GT01
// Cần EMS_API + EMS_TOKEN trong .env. Chưa cài: việc nền bỏ qua, nút «Tra cứu EMS» báo chưa cài.
const { q, one } = require('./db');
const C = require('./core');

// Địa chỉ API do EMS cấp cho tài khoản doanh nghiệp: EMS_API trong .env, có {code} = chỗ mã bưu gửi, {token} = chỗ khóa (không có {token} → gửi kèm ?merchant_token=).
// Tài liệu công khai (11/2026): bản v1 http://ws.ems.com.vn/api/v1/orders/tracking/{code} (có hành trình), bản v2 https://api.my.ems.com.vn/shipments/detail?code={code} (chỉ trạng thái)
// — cả hai tên miền đều không còn phân giải được → phải hỏi EMS địa chỉ đang dùng.
const configured = () => !!(process.env.EMS_TOKEN && process.env.EMS_API);
const urlOf = code => { const t = process.env.EMS_TOKEN, b = process.env.EMS_API.replace('{code}', encodeURIComponent(String(code).trim())); return b.includes('{token}') ? b.replace('{token}', encodeURIComponent(t)) : b + (b.includes('?') ? '&' : '?') + 'merchant_token=' + encodeURIComponent(t); };
const isEms = r => !!r?.bill_no && /ems/i.test(r.carrier || '');
// EMS trả hành trình kèm mô tả chữ; tài liệu chưa công bố bảng mã trạng thái → đối chiếu theo mô tả chặng mới nhất
const map = d => /phát thành công|giao thành công|đã phát(?! không)/i.test(d) ? 'da_giao' : /hoàn|thất lạc|mất/i.test(d) ? 'that_lac' : /tạo đơn|chờ duyệt|chờ lấy/i.test(d) ? 'cho_gui' : 'dang_chuyen';

async function track(code) {
  if (!configured()) C.bad('Chưa cài kết nối EMS — cần EMS_API (địa chỉ API EMS cấp) và EMS_TOKEN (khóa API) trong file .env, rồi khởi động lại app');
  let r; try { r = await fetch(urlOf(code), { headers: { merchant_token: process.env.EMS_TOKEN, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }); }
  catch { C.bad('Không kết nối được máy chủ EMS — kiểm tra EMS_API hoặc thử lại sau'); }
  const j = await r.json().catch(() => null), d = j?.data && typeof j.data === 'object' ? j.data : j;
  if (!r.ok || !d || j?.code === 'error') C.bad(`EMS chưa trả được vận đơn ${code}${j?.message ? ' — ' + j.message : ''}`);
  // bản v1: hành trình __get_status (mô tả + thời gian); bản v2: chỉ «state» hiện tại
  const ev = [...(d.__get_status || [])].sort((a, b) => String(b.tracedate).localeCompare(String(a.tracedate))), last = ev[0] || (d.state ? { description: String(d.state), tracedate: null } : null);
  const st = !last ? 'cho_gui' : ev.length ? map(last.description || '') : /deliver|success|complete/i.test(d.state) ? 'da_giao' : /return|cancel|lost/i.test(d.state) ? 'that_lac' : /wait|new|init|pick/i.test(d.state) ? 'cho_gui' : 'dang_chuyen';
  const fee = d.__get_fee ? (+d.__get_fee.fee || 0) + (+d.__get_fee.remote_fee || 0) + (+d.__get_fee.total_vas || 0) : +d.total_fee || null;
  return { last, events: ev, status: st, fee };
}
// phần cập nhật cho phiếu: trạng thái, ngày giao (khi phát thành công), dòng hành trình mới nhất
function patchOf(r, t) {
  const p = { track_status: t.last ? `${t.last.description}${t.last.address ? ' · ' + t.last.address : ''}` : 'Chưa có hành trình', track_at: new Date().toISOString(), track_log: t.events.slice(0, 30) };
  if (t.status !== 'cho_gui' || r.status === 'cho_gui') p.status = t.status;
  if (t.status === 'da_giao' && t.last?.tracedate) p.done_on = String(t.last.tracedate).slice(0, 10);
  if (t.fee && !r.fee) p.fee = t.fee;
  return p;
}
async function save(id, p) {
  const keys = Object.keys(p); await q(`UPDATE hr_mail SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1}`, [...keys.map(k => k === 'track_log' ? JSON.stringify(p[k]) : p[k]), id]);
}
// việc nền: tra lại thư EMS chưa giao xong (tối đa 50 phiếu / lần, phiếu vừa tra trong 25 phút bỏ qua)
async function checkAll() {
  if (!configured()) return 0;
  const rs = await q("SELECT * FROM hr_mail WHERE bill_no IS NOT NULL AND bill_no <> '' AND carrier ILIKE '%ems%' AND status IN ('cho_gui','dang_chuyen') AND (track_at IS NULL OR track_at < now() - interval '25 minutes') ORDER BY send_on DESC LIMIT 50");
  let n = 0;
  // dòng hành trình ghi thẳng (không làm đầy nhật ký mỗi 30 phút); đổi trạng thái thì ghi qua nghiệp vụ → nhật ký + báo người gửi trên app
  for (const r of rs) try {
    const { status, done_on, fee, ...p } = patchOf(r, await track(r.bill_no)); await save(r.id, p);
    if (status && status !== r.status) { n++; await C.sys(undefined, 'mail', r.id, { status, ...(done_on ? { done_on } : {}), ...(fee ? { fee } : {}) }, C.SYS, 'tu_dong', `EMS: ${p.track_status}`); }
  } catch (e) { console.error('Tra EMS', r.bill_no, e.message); }
  return n;
}
module.exports = { isEms, track, patchOf, save, checkAll };
