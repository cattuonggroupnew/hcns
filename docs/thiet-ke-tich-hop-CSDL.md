# HCNS — thiết kế đưa module vào CSDL chung `duan-noxh-ct`

Phiên bản 0.1 · 03/11/2026 · nhánh `nghiem` · trạng thái: **dự thảo, chờ anh Đạt duyệt mục 8**

## 1. Hiện trạng

| | App HCNS hiện tại | Sau khi tích hợp |
|---|---|---|
| CSDL | Riêng `ctg_hcns` (PostgreSQL 17), 69 bảng `public.hr_*` | Chung `duan-noxh-ct` (PostgreSQL 18), schema `hcns` |
| Khóa | `serial` (số nguyên) | `uuid` (quy ước chung §4) |
| Đổi cấu trúc | `server/schema.js` tự thêm cột khi khởi động | Chỉ bằng migration `V202…` trong `db/` |
| Dữ liệu nền | Tự lưu pháp nhân, phòng ban, chức danh, nhân sự, người dùng, duyệt, thông báo, tệp, nhật ký | Dùng bảng chung (mục 2) |
| Xóa | Xóa cứng | Xóa mềm (`deleted_at`), trigger chung chặn xóa cứng |
| Nhật ký | `hr_audit` riêng | `audit` chung qua `core.fn_apply_std` |

Mã nguồn: Node.js, máy chủ HTTP tự viết, giao diện HTML/JS thuần, 53 thực thể khai báo trong `server/meta.js`.

## 2. Đối chiếu dữ liệu nền

| HCNS hiện tại | Dùng bảng chung | Phần riêng HCNS (schema `hcns`) |
|---|---|---|
| `hr_legal` (pháp nhân) | `core.legal_entity` (đã có `PN-CATTUONG`, `PN-DHP`; thiếu Thống Nhất, Tiến Đạt…) | `hcns.legal_setting`: tên ngắn, ngân hàng chi lương, đã có công đoàn cơ sở |
| `hr_dept` (phòng ban) | `core.org_unit` + `core.org_unit_mdm` (cây đơn vị) | — |
| `hr_position` (chức danh) | `hr.position` | — |
| `hr_employee` (hồ sơ) | `hr.staff`: mã NS, họ tên, đơn vị, chức danh, khối, trạng thái, ngày vào/nghỉ; `legacy_staff_code` = mã NVxxx | `hcns.staff_profile` (1–1 với `hr.staff`): giới tính, quản lý, cấp bậc, điều kiện LĐ, hồ sơ đã nộp, kinh nghiệm, chứng chỉ, ATLĐ… · `hcns.staff_private` (mục 4): CCCD, ngày sinh, địa chỉ, SĐT, email, ngân hàng, STK, BHXH, MST, lương P1/P2, mức đóng BH, liên hệ khẩn cấp, người phụ thuộc |
| `hr_contract` (HĐLĐ) | `hr.employment_contract`: pháp nhân ký, số, loại, từ–đến, chức danh, trạng thái | `hcns.contract_term`: lương P1/P2, phụ cấp, % thử việc, mẫu in |
| `hr_user` (tài khoản) | `auth.app_user` (đăng nhập, phiên chung) | `hcns.user_access`: mục được giao (`items`), pháp nhân phụ trách |
| vai trò `tp_hcns`, `cv_hcns`, `cv_hc`, `nld`… | `auth.role` thêm vai trò mới `HCNS_TP`, `HCNS_CV`, `HC_CV`, `HCNS_NLD` (không dùng lại mã QLDA) | — |
| `hr_notice` (thông báo trong app) | `wf.notification` | — |
| `hr_file` (tệp) | `doc.file` (`owner_table` = `hcns.<bảng>`) | — |
| `hr_audit` (nhật ký) | `audit` (tự ghi qua trigger chuẩn) | — |
| `hr_approval` (duyệt) | Giai đoạn 2: `wf.approval_record`, `wf.approval_action` (mục 5) | Giai đoạn 1: `hcns.approval` |

## 3. Schema `hcns` — bảng nghiệp vụ

Mỗi bảng: khóa `id uuid`, bộ cột chuẩn hồ sơ **C** (`core.fn_apply_std(..., 'C', ...)`), chú thích tiếng Việt mọi bảng, cột. Tham chiếu người → `hr.staff.id`, pháp nhân → `core.legal_entity.id`, đơn vị → `core.org_unit.id`.

| Nhóm | Bảng (tên app hiện tại → `hcns.`) |
|---|---|
| Hành chính | `vpp_item`, `vpp_norm`, `vpp_req`, `vpp_issue`, `vpp_in`, `asset`, `asset_in`, `asset_move`, `asset_out`, `asset_count`, `vehicle`, `car_book`, `car_return`, `mail`, `meal_reg`, `meal_day`, `meal_in`, `meal_out`, `event`, `event_cost`, `room`, `room_book` |
| Nhân sự | `headcount`, `training`, `rec_plan`, `candidate`, `interview`, `decision`, `transfer`, `resign` |
| Chấm công | `site`, `shift`, `att_type`, `holiday`, `explain`, `leave`, `leave_bal`, `trip`, `ot`, `att_add`, `att_auto`, `attendance`, `att_period` |
| Lương, BH, CĐ, báo cáo | `payroll`, `ins_sheet`, `cd_sheet`, `gov_report` |
| Mẫu in, kho mẫu | `doc_tpl`, `template` |
| Kỹ thuật | `setting`, `counter`, `snapshot`, `job`, `alert_state`, `issue`, `note`, `ext` (mã ngoài nền tảng chung), `outbox` (webhook) |

Bảng `candidate` (ứng viên) có CCCD, ngày sinh, SĐT: chưa phải nhân sự, để trong `hcns.candidate`, cột nhạy cảm theo quy tắc mục 4.

## 4. Dữ liệu cá nhân và lương

`hr.staff` cố ý không lưu dữ liệu cá nhân (NĐ 13/2023). Nhưng HCNS là đơn vị chủ quản dữ liệu này, bắt buộc phải lưu.

Đề xuất (chỉ **thêm**, không đổi schema chung):

- Bảng `hcns.staff_private`, `hcns.contract_term`, `hcns.payroll` chỉ cấp cho `hcns_app`. **Không** cấp `duan_app`, `duan_readonly`, `duan_ai`.
- Máy chủ HCNS che CCCD, lương theo vai trò như hiện nay (chỉ TP HCNS, chuyên viên được giao thấy).
- Mỗi lần xem số định danh đầy đủ ghi `audit` (đang có nút «Xem định danh»).

Phương án khác: đặt vào schema `pii` và đọc qua `pii.fn_access`. Kho `pii` hiện thiết kế cho hộ dân GPMB, nên cần anh Đạt quyết (mục 8, câu 1).

## 5. Luồng duyệt

`wf` chung bắt buộc đổi trạng thái qua `INSERT wf.approval_action`, cần khai báo `wf.record_type`, bước duyệt, vai trò cho từng loại đơn.

- **Giai đoạn 1 (làm ngay):** giữ luồng duyệt của HCNS trong `hcns.approval`. Bao gồm: trưởng bộ phận duyệt rồi HCNS, đơn nghỉ đã duyệt trên nền tảng chung, hộp «Việc chờ tôi duyệt». Thông báo ghi vào `wf.notification` để hiện cùng hộp thông báo chung.
- **Giai đoạn 2:** khai báo `wf.record_type` cho 15 loại đơn có duyệt (seed `S…`), chuyển sang `wf.approval_record` khi luồng của nền tảng chung chốt.

## 6. Vai trò CSDL

`hcns_app` (NOLOGIN), cấp tường minh trong migration (QĐ-112):

| Đối tượng | Quyền |
|---|---|
| schema `hcns` (mọi bảng, hàm) | USAGE; SELECT, INSERT, UPDATE; EXECUTE hàm |
| `hr.staff`, `hr.employment_contract` | SELECT, INSERT, UPDATE (HCNS là chủ quản dữ liệu nhân sự) |
| `core.legal_entity`, `core.org_unit`, `core.org_unit_mdm`, `hr.position`, `md.*` cần dùng | SELECT |
| `auth.app_user` (cột không nhạy cảm), `auth.role`, `auth.role_assignment` | SELECT |
| `wf.notification` | SELECT, INSERT, UPDATE (đánh dấu đã đọc) |
| `doc.file` | SELECT, INSERT |
| `duan_readonly`, `duan_ai` | Không cấp gì trên `hcns` (thu hồi tường minh) |

Tài khoản LOGIN của máy chủ HCNS do quản trị tạo khi triển khai, không có trong migration.

## 7. Số migration, seed và các bước

Số mới nhất khi lập: `V201`, `S104` → HCNS dùng **V202…**, **S105…**. Lấy lại số lớn nhất ngay trước khi gộp.

| Bước | Tệp / việc | Nội dung | Trạng thái |
|---|---|---|---|
| 0 | Môi trường | PostgreSQL 18.6 cổng 5433, CSDL `duan-noxh-ct`, áp 251 tệp bằng `ap_migration.py` | Xong 03/11 |
| 1 | `V202__hcns_khoi_tao_schema.sql` | Schema `hcns`, vai trò `hcns_app`, bảng nhân sự riêng (`staff_profile`, `staff_private`, `contract_term`, `legal_setting`, `user_access`) | Chưa |
| 2 | `V203__hcns_bang_nghiep_vu.sql` | Bảng nghiệp vụ mục 3 (sinh từ `meta.js`, rồi rà tay) | Chưa |
| 3 | `V204__hcns_phan_quyen.sql` | Cấp quyền mục 6 | Chưa |
| 4 | `S105__hcns_danh_muc.sql` | Ký hiệu công CC06, ca, ngày lễ, cấu hình tỷ lệ BH/CĐ/thuế, mẫu in gốc | Chưa |
| 5 | `S106__hcns_vai_tro_chuc_nang.sql` | `auth.role` HCNS, `auth.function_group` `HCNS.*`, ma trận quyền | Chưa |
| 6 | Mã nguồn | Chuyển `modules/hcns/` sang CSDL chung (mục 7a) | Chưa |
| 7 | Công cụ nạp | `modules/hcns/tools/nap_du_lieu`: nạp nhân sự, HĐ, phép, công từ tệp HCNS **ngoài repo** vào máy dev | Chưa |
| 8 | Kiểm thử | Áp toàn bộ V/S trên CSDL trống không lỗi; kiểm thử HCNS 31 ca; `kiem-thu_G2-BE-01_chi-doc.sql` 100% | Chưa |

### 7a. Thay đổi mã nguồn

- Kết nối `duan-noxh-ct` bằng tài khoản thuộc `hcns_app`. Mỗi giao dịch `set_config('app.user_id', …)` để trigger chung ghi người sửa, nhật ký.
- Tên bảng `hr_<x>` → `hcns.<x>`; khóa số nguyên → `uuid` (API, đường dẫn, giao diện).
- Bỏ tự đổi cấu trúc (`schema.js`). Khi khởi động chỉ kiểm phiên bản migration đã áp trong `core.schema_migration`.
- Xóa → xóa mềm. Lọc `deleted_at IS NULL` ở mọi truy vấn.
- Hồ sơ nhân sự đọc/ghi qua `hr.staff` + `hcns.staff_profile` + `hcns.staff_private`.
- Đăng nhập dùng `auth.app_user` và phiên chung. Chế độ không đăng nhập chỉ còn ở máy dev.

## 8. Cần anh Đạt quyết

1. Dữ liệu cá nhân và lương: đặt ở `hcns` có giới hạn quyền (mục 4, đề xuất) hay đưa vào `pii`?
2. HCNS được **ghi** `hr.staff`, `hr.employment_contract` (HCNS là chủ quản dữ liệu nhân sự) không, hay chỉ đọc và đề nghị thay đổi master data qua luồng `CM.MD.DOI`?
3. Bổ sung pháp nhân nội bộ còn thiếu (Thống Nhất, Tiến Đạt…) và cây phòng ban HCNS vào `core.legal_entity`, `core.org_unit_mdm`: bằng seed chung hay qua đề nghị thay đổi master data?
4. Đồng ý luồng duyệt giai đoạn 1 để trong `hcns.approval` (mục 5) không?
5. Mã vai trò mới `HCNS_TP`, `HCNS_CV`, `HC_CV`, `HCNS_NLD` có hợp quy ước `auth.role` không?
