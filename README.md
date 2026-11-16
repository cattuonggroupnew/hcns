# Module HCNS — Hành chính Nhân sự

| | |
|---|---|
| Mã module | `HCNS` |
| Schema | `hcns` (đọc / ghi thêm `hr`, đọc `core`, `auth`; thông báo `wf.notification`; tệp `doc.file`) |
| Vai trò CSDL | `hcns_app` (NOLOGIN) |
| Mã nguồn | `modules/hcns/` — Node.js, giao diện HTML/JS |
| Phụ trách | nhánh `nghiem` |
| Trạng thái | Đang chuyển sang CSDL chung — xem `docs/thiet-ke-tich-hop-CSDL.md` |

## Phạm vi

Phòng Hành chính Nhân sự Khối Home:
- **Hành chính:** VPP, tài sản, xe, chuyển phát, suất ăn, sự kiện, phòng họp.
- **Nhân sự:** tuyển dụng, đào tạo, hồ sơ, hợp đồng, quyết định, thuyên chuyển.
- **Chấm công, lương:** chấm công, phép, lương, BH, công đoàn.
- **Báo cáo lao động** và **mẫu in** (tự điền, sửa được).
- **Cổng nhân viên:** chấm công, đơn từ, tích hợp nền tảng chung.

## Chạy thử (bản hiện tại — còn CSDL riêng `ctg_hcns`)

- Chép `.env.example` → `.env`, điền `DATABASE_URL`; `npm install`; `node server/server.js` → http://localhost:3600 (hoặc «Mở App HCNS.bat»).
- Cấu trúc bảng tự tạo từ `server/meta.js` khi khởi động. `node server/seed.js --demo` nạp dữ liệu mẫu (`data/seed/source.sample.json`, toàn số giả).
- `npm test` chạy luồng nghiệp vụ (cần server đang chạy, `NO_LOGIN=1`).
- Dữ liệu cá nhân (`data/seed/source.json`, `data/files/`) và `.env` không đưa lên git.

Cấu trúc: `meta.js` (biểu mẫu, quyền) · `core.js` (lõi ghi/đọc/duyệt) · `biz.js` (tự động theo sự kiện, công thức lương) · `jobs.js` (việc định kỳ) · `reports.js` (báo cáo, dashboard) · `print.js`, `forms.js` (bản in, mẫu) · `public/` (giao diện).

## Tài liệu

- `docs/thiet-ke-tich-hop-CSDL.md` — đối chiếu dữ liệu nền, schema `hcns`, số migration, việc cần quyết.
- `docs/TICH-HOP-NEN-TANG.md` — API cho nền tảng chung (đơn từ, chấm công app, phép/công/phiếu lương).
