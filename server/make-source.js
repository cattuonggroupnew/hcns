// Đọc các file Excel của phòng HCNS → data/seed/source.json (dữ liệu thật, không đưa lên git), rồi chạy: node server/seed.js --demo
//   node server/make-source.js "<thư mục chứa file>"
//   Cần: DS CBNV*.xlsx, DS văn phòng phẩm.xlsx, Quản lý VPP.xlsx, Trích nộp BHXH*.xlsx, Trích nộp KPCĐ*.xlsx
const fs = require('fs');
const path = require('path');
const { readXlsx } = require('./xlsx');

const dir = process.argv[2] || bad('Thiếu thư mục chứa file Excel');
function bad(m) { console.error(m); process.exit(1); }
const files = fs.readdirSync(dir).map(f => f.normalize('NFC'));
const book = re => { const f = files.find(x => re.test(x) && x.endsWith('.xlsx')) || bad(`Không thấy file khớp ${re}`); return readXlsx(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(x => x.normalize('NFC') === f)))); };
const sheet = (b, re) => b.find(s => re.test(s.name)) || b[0];
const s = v => v == null || v === '' ? null : String(v).replace(/\s+/g, ' ').trim() || null;
const pad = n => String(n).padStart(2, '0');
// ngày: số Excel hoặc chuỗi; cột ghi «mm/dd/yyyy» thì đọc tháng trước (trừ khi số đầu > 12)
function date(v, mdy) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5); return d.toISOString().slice(0, 10); }
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(String(v).trim()); if (!m) return null;
  let [day, mon] = mdy ? [+m[2], +m[1]] : [+m[1], +m[2]];
  if (mon > 12) [day, mon] = [mon, day];
  return `${m[3]}-${pad(mon)}-${pad(day)}`;
}
const month = v => { if (v === '' || v == null) return null; if (typeof v === 'number') return date(v)?.slice(0, 7); const m = /^(\d{1,2})[/.-](\d{4})$/.exec(String(v).trim()); return m ? `${m[2]}-${pad(m[1])}` : null; };
const num = v => v === '' || v == null || v === '-' ? null : typeof v === 'number' ? v : +String(v).replace(/[.,\s]/g, '') || null;

// ---- DS CBNV: sheet NS (dòng tiêu đề có «Mã NV»), Đào tạo-kinh nghiệm, NPT ----
const cb = book(/^DS CBNV/i), ns = sheet(cb, /^NS$/).rows, hi = ns.findIndex(r => /Mã NV/.test(String(r?.[0] || '')));
const train = Object.fromEntries((sheet(cb, /Đào tạo/).rows.slice(1)).filter(r => r?.[0]).map(r => [s(r[0]), { school: s(r[1]), cert: s(r[2]), exp: s(r[3]), exp_ct: s(r[4]) }]));
const emps = ns.slice(hi + 1).filter(r => r?.[0] && r?.[1]).map(r => {
  const name = s(r[1]), t = train[name] || {};
  return { code: s(r[0]), name, gender: s(r[2]), dob: date(r[3]), cccd: s(r[4]), cccd_date: date(r[5]), cccd_place: s(r[6]), phone: s(r[7]), address: s(r[8]), legal: s(r[9]), dept: s(r[10]), title: s(r[11]), level: s(r[12]), mgr: s(r[13]),
    join: date(r[14]), labor: s(r[15]), status: s(r[16]), ins_no: s(r[17]), tax: s(r[18]), union: s(r[19]), bank: s(r[20]), acct: s(r[21]), cond: s(r[22]) || 'Bình thường', note: s(r[23]), ctype: s(r[24]), cno: s(r[25]),
    csign: date(r[26], 1), cfrom: date(r[27], 1), cto: date(r[28], 1), trial_pct: num(r[31]) && (num(r[31]) > 1 ? num(r[31]) / 100 : num(r[31])), ctitle: s(r[32]), npt: num(r[33]), ...t };
});
const np = sheet(cb, /NPT/).rows, nh = np.findIndex(r => /Mã NV/.test(String(r?.[0] || '')));
const npt = np.slice(nh + 1).filter(r => r?.[0] && r?.[2]).map(r => ({ code: s(r[0]), emp: s(r[1]), name: s(r[2]), rel: s(r[3]), dob: date(r[4]), id_no: s(r[5]), from_m: month(r[6]), to_m: month(r[7]), note: s(r[8]) }));

// ---- VPP: danh mục + nhập xuất tồn T9, T10 ----
const vc = sheet(book(/^DS văn phòng phẩm/i), /VPP05/).rows, ch = vc.findIndex(r => r?.some(c => /MÃ SP/i.test(String(c))));
const cat = vc.slice(ch + 1).filter(r => r?.[1] && r?.[2]).map(r => ({ code: s(r[1]), name: s(r[2]), unit: s(r[3]) }));
const ql = book(/^Quản lý VPP/i), nxt = re => sheet(ql, re).rows.slice(2).filter(r => r?.[2]).map(r => ({ name: s(r[2]), unit: s(r[3]), open: num(r[4]) || 0, inq: num(r[5]) || 0, outq: num(r[6]) || 0, close: num(r[7]) || 0 }));

// ---- Trích nộp BHXH, KPCĐ (sheet tháng mới nhất) ----
const bh = book(/Trích nộp BHXH/i)[0].rows, bs = bh.findIndex(r => /^Họ và tên/.test(String(r?.[2] || '')));
const ins = bh.slice(bs + 1).filter(r => r?.[2] && !/TỔNG/i.test(String(r[2])) && num(r[5]) != null && typeof r[3] !== 'undefined').filter(r => s(r[2]) && !/^(BHXH|Doanh)/.test(s(r[2])))
  .map(r => ({ name: s(r[2]), ins_no: s(r[3]), title: s(r[4]), salary: num(r[5]) || 0, note: s(r[21]) }));
const kp = book(/Trích nộp KPCĐ/i)[0].rows, ks = kp.findIndex(r => /Tên nhân viên/.test(String(r?.[2] || '')));
const cd = kp.slice(ks + 1).filter(r => s(r?.[2]) && !/TỔNG/i.test(String(r[1] || '')) && num(r[3]) != null).map(r => ({ name: s(r[2]), salary: num(r[3]) || 0, note: s(r[12]) }));

const out = path.join(__dirname, '..', 'data', 'seed', 'source.json');
fs.writeFileSync(out, JSON.stringify({ emps, npt, cat, t9: nxt(/^T9$/), t10: nxt(/^T10$/), ins, cd }));
console.log(`${emps.length} nhân sự, ${npt.length} người phụ thuộc, ${cat.length} mã VPP, BH ${ins.length} người (${ins.reduce((a, x) => a + x.salary, 0).toLocaleString('vi-VN')} đ), CĐ ${cd.length} người → ${path.relative(process.cwd(), out)}`);
