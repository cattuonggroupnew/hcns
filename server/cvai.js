// Đọc CV ứng viên bằng Claude: PDF / ảnh gửi thẳng, Word (.docx) lấy chữ → trả các trường của phiếu «Quản lý ứng viên» (TD02)
// Cần ANTHROPIC_API_KEY trong .env
const path = require('path');
const SDK = require('@anthropic-ai/sdk');
const { docxText } = require('./xlsx');
const { bad, HttpError } = require('./core');

const Anthropic = SDK.default || SDK;
let client;
const FIELDS = {
  full_name: 'Họ và tên', id_no: 'Số CMT/CCCD', dob: 'Ngày sinh, dạng YYYY-MM-DD', gender: 'Giới tính: "Nam" hoặc "Nữ"', phone: 'Số điện thoại', email: 'Email', address: 'Địa chỉ',
  edu: 'Trình độ văn hóa (vd 12/12)', degree: 'Trình độ chuyên môn (Đại học, Cao đẳng…)', skill: 'Bậc trình độ nghề', school: 'Trường / đơn vị đào tạo', major: 'Ngành đào tạo',
  position: 'Vị trí ứng tuyển', exp: 'Kinh nghiệm làm việc, tóm tắt từng nơi: thời gian · công ty · chức danh',
};
// quá trình công tác trước: mỗi nơi làm một dòng (điền bảng «Quá trình công tác trước» → lịch sử làm việc HD13)
const JOB = { type: 'object', properties: { from: { type: 'string', description: 'Từ tháng/năm, dạng MM/YYYY (chỉ có năm thì YYYY)' }, to: { type: 'string', description: 'Đến tháng/năm, dạng MM/YYYY; đang làm thì ghi "nay"' }, company: { type: 'string', description: 'Tên công ty / đơn vị' }, title: { type: 'string', description: 'Chức danh / công việc' } }, required: ['from', 'to', 'company', 'title'], additionalProperties: false };
const SCHEMA = { type: 'object', properties: { ...Object.fromEntries(Object.entries(FIELDS).map(([k, d]) => [k, { type: 'string', description: d }])), jobs: { type: 'array', description: 'Quá trình công tác, mới nhất trước', items: JOB } }, required: [...Object.keys(FIELDS), 'jobs'], additionalProperties: false };
const IMG = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

async function parseCv(file) {
  if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(503, 'Chưa cấu hình AI: thêm ANTHROPIC_API_KEY vào file .env rồi khởi động lại app');
  const ext = path.extname(file.name || '').toLowerCase();
  const src = ext === '.pdf' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.buffer.toString('base64') } }
    : IMG[ext] ? { type: 'image', source: { type: 'base64', media_type: IMG[ext], data: file.buffer.toString('base64') } }
    : ext === '.docx' ? { type: 'text', text: 'Nội dung CV:\n' + docxText(file.buffer) }
    : bad('Chỉ đọc được CV dạng PDF, Word (.docx) hoặc ảnh (JPG, PNG)');
  client ||= new Anthropic();
  const r = await client.beta.messages.create({
    model: 'claude-opus-5-5', max_tokens: 16000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: 'Bạn trích thông tin từ CV ứng viên cho phòng nhân sự. Chỉ ghi điều CV nêu rõ; mục nào CV không có thì để chuỗi rỗng, không suy đoán. Giữ nguyên tiếng Việt có dấu.',
    messages: [{ role: 'user', content: [src, { type: 'text', text: 'Trích thông tin ứng viên từ CV này.' }] }],
  }).catch(er => {
    if (er instanceof Anthropic.AuthenticationError) throw new HttpError(503, 'Khóa AI (ANTHROPIC_API_KEY) không đúng');
    if (er instanceof Anthropic.RateLimitError) throw new HttpError(503, 'AI đang quá tải — thử lại sau ít phút');
    if (er instanceof Anthropic.APIError) throw new HttpError(502, `Lỗi khi gọi AI (${er.status || 'mạng'}) — thử lại hoặc nhập tay`);
    throw er;
  });
  if (r.stop_reason === 'refusal') bad('AI không đọc được CV này — nhập tay giúp');
  const t = r.content.find(b => b.type === 'text'); if (!t) bad('AI không trả kết quả — thử lại');
  const o = JSON.parse(t.text);
  if (o.dob && !/^\d{4}-\d{2}-\d{2}$/.test(o.dob)) o.dob = '';
  if (!['Nam', 'Nữ'].includes(o.gender)) o.gender = '';
  o.jobs = (Array.isArray(o.jobs) ? o.jobs : []).filter(j => j && (j.company || '').trim());
  if (!o.jobs.length) delete o.jobs;
  return Object.fromEntries(Object.entries(o).filter(([, v]) => Array.isArray(v) ? v.length : v && String(v).trim()));
}

module.exports = { parseCv };
