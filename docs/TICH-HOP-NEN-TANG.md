# Tích hợp nền tảng chung ↔ App HCNS

App HCNS là phần riêng của phòng HCNS. Nhân viên các phòng viết đơn và chấm công trên **nền tảng chung**. Nền tảng gửi dữ liệu về app HCNS qua API dưới đây, rồi đọc lại phép, công và phiếu lương để hiện cho nhân viên.

```
Nền tảng chung ──(đơn, chấm công)──▶ App HCNS  /api/v1/*
       ▲                                   │
       └────(webhook: đơn đã duyệt / từ chối)┘
```

- **Đơn xin nghỉ phép:** trưởng phòng duyệt ngay trên nền tảng. Nền tảng gửi kèm `approved`, đơn vào app ở trạng thái **Đã duyệt** và app tự ghi ký hiệu nghỉ vào bảng công.
- **Các đơn khác:** vào app ở trạng thái **Chờ duyệt**. App tự chuyển đến đúng chuyên viên HCNS theo pháp nhân của nhân viên và theo mục được giao. Khi HCNS duyệt hoặc từ chối, app gọi webhook báo lại cho nền tảng.
- **Không qua duyệt:** `mail` (gửi thư) vào thẳng trạng thái `cho_gui` (Chờ gửi); `meal_reg` (đăng ký suất ăn) ghi nhận ngay, không có trạng thái (`status`, `status_label` = `null`). Hai loại này không có webhook.

## Kết nối

| | |
|---|---|
| Địa chỉ | `http://<máy chủ HCNS>:3600/api/v1` |
| Xác thực | Header `X-Api-Key: <PLATFORM_KEY>`. Khóa nằm trong file `.env` của app HCNS; xin phòng HCNS hoặc IT. Sai hay thiếu khóa thì trả về `401`. |
| Định dạng | JSON UTF-8. Ngày dạng `YYYY-MM-DD`, tháng dạng `YYYY-MM`, thời điểm dạng ISO 8601 có múi giờ (`2026-11-12T08:02:00+07:00`). |
| Nhân viên | Xác định bằng **mã NV** (`emp_code`, ví dụ `NV044`), giống mã trên Bravo/BSC. |
| Lỗi | `400 { "error": "…" }` (dữ liệu sai), `401` (sai khóa), `404` (không có). |

Kiểm tra kết nối: `GET /api/v1/ping` trả về `{ "ok": true }`.

> **Bảo mật:** khóa API cho phép đọc phiếu lương của mọi nhân viên. Chỉ máy chủ nền tảng được giữ khóa này; không để khóa trong app điện thoại hay trình duyệt. Nền tảng phải tự kiểm tra người đang đăng nhập đúng là chủ của `emp_code` trước khi gọi các API đọc dữ liệu.

## 1. Danh mục: `GET /api/v1/catalog`

Trả về:
- danh mục để dựng form: loại nghỉ, phòng họp, xe, văn phòng phẩm, ngày lễ, điểm chấm công (tọa độ, bán kính);
- `types`: các loại đơn nhận được, kèm danh sách trường (`k`, `label`, `type`, `required`, `options`).

Nên gọi lúc khởi động và lưu đệm, vì danh mục do HCNS cập nhật.

## 2. Gửi đơn: `POST /api/v1/requests/{type}`

```json
{
  "ext_id": "NT-2026-000123",
  "emp_code": "NV068",
  "data": { "...các trường của loại đơn..." },
  "approved": { "by": "Nguyễn Văn An", "title": "Trưởng phòng kinh doanh", "at": "2026-11-10 09:00", "ok": true, "comment": "" }
}
```

- `ext_id`: mã đơn **duy nhất** trên nền tảng. Gửi lại cùng một `ext_id` thì app không tạo đơn mới, chỉ trả về đơn cũ kèm `"duplicate": true`. Vì vậy mất mạng cứ gửi lại.
- `approved`: **chỉ dùng cho `leave`**, khi trưởng phòng đã duyệt (`ok: true`) hoặc đã từ chối (`ok: false`) trên nền tảng.
- Pháp nhân, phòng ban lấy theo hồ sơ nhân viên. Mã phiếu và trạng thái do app tự cấp.

Trả về: `{ "id": 15, "code": "NP-2026-0015", "status": "cho_duyet", "status_label": "Chờ duyệt" }`.

| `type` | Đơn | Trường chính trong `data` (`*` = bắt buộc) |
|---|---|---|
| `leave` | Đơn xin nghỉ phép CC04 | `type_code*` (mã loại nghỉ trong `catalog.leave_types`, vd `P`, `O`, `K`), `from_on*`, `to_on*`, `days` (bỏ trống thì app tự tính số ngày làm việc), `reason`, `cover_code` (mã NV người làm thay) |
| `explain` | Phiếu giải trình công CC03 | `day*`, `kind*` (`quen_vao`, `quen_ra`, `sai_diem`, `loi_ht`, `khac`), `right_time` (vd `17:30`), `reason*`, `proof` |
| `ot` | Đơn xin tăng ca CC09 | `day*`, `from_t*` (`17:30`), `to_t*` (`19:30`), `day_kind` (`thuong`, `nghi`, `le`), `task*` |
| `trip` | Đơn công tác CC08 | `descr*`, `from_on*`, `to_on*` |
| `att_add` | Chấm công bổ sung CC10 | `day*`, `dir*` (`vao`, `ra`), `time*` (`08:00`), `next_day`, `reason*` |
| `resign` | Đơn xin nghỉ việc HD09 | `last_day*`, `reason*` |
| `vpp_req` | Đề xuất VPP VPP01 | `req_on`, `lines*`: `[{ "code": "VPP01", "qty": 3, "note": "" }]` |
| `room_book` | Đặt phòng họp PH01 | `room_code*`, `start_at*`, `end_at*`, `host`, `descr`, `service` |
| `car_book` | Mượn xe XC04 | `vehicle_code*`, `start_at*`, `end_at*`, `route*`, `riders`, `reason` |
| `mail` | Đề xuất gửi thư GT01 | `content*`, `to_name*`, `to_addr*`, `to_phone`, `send_on` |
| `meal_reg` | Đăng ký suất ăn tháng SA01 | `month*` (`2026-11`), `days` (mảng ngày trong tháng, vd `[2,3,4]`) |

Danh sách trường đầy đủ, kể cả tùy chọn, có trong `catalog.types`.

Hỏi trạng thái một đơn: `GET /api/v1/requests/{ext_id}`.

## 3. Chấm công từ app điện thoại: `POST /api/v1/punches`

```json
{ "punches": [
  { "emp_code": "NV068", "at": "2026-11-12T08:02:00+07:00", "kind": "in", "lat": 21.18, "lng": 106.07 },
  { "emp_code": "NV068", "at": "2026-11-12T17:36:00+07:00", "kind": "out" }
] }
```

- Gửi được nhiều lượt, nhiều người trong một lần. Gửi lại vẫn an toàn: app gộp theo người và ngày, lấy giờ vào sớm nhất và giờ ra muộn nhất.
- `emp_code` và `at` là bắt buộc; lượt thiếu hoặc sai được liệt kê trong `err`, các lượt khác vẫn ghi. `kind` (`in` / `out`) là tùy chọn. Bỏ trống thì lượt sớm nhất trong ngày là vào, muộn nhất là ra.
- Ký hiệu công: có cả vào lẫn ra → `HC`; chỉ có vào → `XO` (thiếu ra); chỉ có ra → `XI` (thiếu vào).
- Ngày nào đã có đơn được duyệt (nghỉ phép, công tác, giải trình…) hoặc HCNS đã sửa tay thì app **không ghi đè**.
- Kỳ công đã khóa thì không ghi được; app báo lỗi trong `err`.
- Có `lat`/`lng` mà nằm ngoài mọi điểm chấm công thì lượt đó vẫn được ghi, nhưng được liệt kê trong `outside` để HCNS kiểm tra.

Trả về: `{ "ok": 1, "skip": 0, "outside": [], "err": ["KHONG-CO: không có trong app HCNS"] }`.

## 4. Đọc dữ liệu của nhân viên

| API | Trả về |
|---|---|
| `GET /api/v1/employees/{emp_code}/leave?year=2026` | `opening`, `earned`, `adjust`, `used`, `left`: số ngày phép đầu kỳ, phát sinh, điều chỉnh, đã nghỉ, còn lại |
| `GET /api/v1/employees/{emp_code}/timesheet?month=2026-11` | Từng ngày: `day`, `mark` (ký hiệu công), `in_t`, `out_t`, `source`. Kèm tổng `work`, `paid_leave`, `unpaid`, `missing`, `locked` (kỳ đã khóa) |
| `GET /api/v1/employees/{emp_code}/payslips?month=2026-10` | Phiếu lương của các bảng lương **đã duyệt**: công, P1, P2, ăn ca, tăng ca, thưởng, tổng lương, BH, thuế, khấu trừ, `net` (thực lĩnh), `pay_to` |
| `GET /api/v1/employees/{emp_code}/requests` | Các đơn gửi từ nền tảng kèm trạng thái hiện tại |

## 5. Webhook báo trạng thái (app HCNS → nền tảng)

Đặt `PLATFORM_WEBHOOK=https://<nền tảng>/...` trong `.env` của app HCNS. Mỗi khi một đơn gửi từ nền tảng được duyệt, từ chối hoặc đổi trạng thái (đã cấp VPP, đã bàn giao xe, hủy lịch…), app gửi:

```http
POST <PLATFORM_WEBHOOK>
X-Api-Key: <PLATFORM_KEY>
Content-Type: application/json

{ "event": "request.status", "type": "explain", "ext_id": "NT-2026-000123", "id": 15, "code": "GT-CONG-2026-0015",
  "status": "da_duyet", "status_label": "Đã duyệt", "decided_by": "Trần Thị Bình", "comment": null, "at": "2026-11-12T03:15:00.000Z" }
```

- Nền tảng kiểm tra `X-Api-Key` để biết đúng là app HCNS gọi, rồi trả HTTP 2xx.
- Khuyến nghị: đặt `PLATFORM_HOOK_SECRET` (khóa riêng, chia cho nền tảng). Khi đó app **không** gửi `X-Api-Key` mà gửi `X-Timestamp: <giây>` và `X-Signature: sha256=<HMAC-SHA256(PLATFORM_HOOK_SECRET, "<X-Timestamp>.<thân JSON>")>` dạng hex; nền tảng tính lại để xác thực.
- Gọi không được thì app tự gửi lại mỗi phút, tối đa 20 lần; hết 20 lần thì TP HCNS và quản trị nhận thông báo trong app.
- Nền tảng nên xử lý trùng theo `ext_id` + `status`, vì cùng một trạng thái có thể đến hơn một lần.
- Chưa dựng xong webhook thì dùng `GET /api/v1/requests/{ext_id}` để hỏi trạng thái.
- `decided_by`, `comment` lấy theo lần duyệt / từ chối gần nhất của đơn (khi đổi trạng thái sau duyệt như đã cấp VPP, bàn giao xe… vẫn là người đã duyệt).
- Trạng thái của phiếu gửi thư (`dang_chuyen`, `da_giao`…) do HCNS cập nhật tay, không gửi webhook — hỏi bằng `GET /api/v1/requests/{ext_id}`.

**Trạng thái thường gặp:** `nhap` (nháp), `cho_duyet` (chờ duyệt), `da_duyet` (đã duyệt), `tu_choi` (từ chối). Riêng từng loại đơn còn có: `da_cap` (VPP đã cấp), `dang_di` / `da_tra` (xe), `hoan_thanh` (phòng họp đã đóng), `huy` (hủy lịch), `cho_gui` / `dang_chuyen` / `da_giao` / `that_lac` (gửi thư).

## 6. Tin HCNS gửi người dùng: `event = "hr.message"` (app HCNS → nền tảng)

Cùng địa chỉ `PLATFORM_WEBHOOK`, cùng khóa, cùng cơ chế gửi lại như mục 5. Mỗi ứng viên là một tin. App HCNS **tự gửi**, HCNS không phải bấm:

- `interview.invite`: khi lưu lịch phỏng vấn (TD03) có ứng viên mới, hoặc đổi ngày, giờ, hình thức, phòng, link Teams → gửi cho ứng viên bị ảnh hưởng (lịch đã qua ngày thì không gửi).
- `interview.result`: khi ghi hoặc đổi kết quả (Đạt / Không đạt / Vắng) của ứng viên.
- Sửa nội dung khác (ghi chú, hội đồng…) không gửi lại. HCNS vẫn có nút «Gửi lại thư mời PV», «Gửi lại thư báo kết quả» trên lịch.

```json
{ "event": "hr.message", "kind": "interview.invite",
  "ref": { "type": "interview", "id": 4, "code": "PV2026-0004" },
  "to": [ { "type": "ung_vien", "code": "UV012", "name": "Nguyễn Văn A", "email": "a@example.com", "phone": "09xxxxxxxx" },
          { "type": "nhan_vien", "emp_code": "NV013", "name": "Lê Văn Cường", "role": "truong_bp", "copy": true } ],
  "subject": "Thư mời phỏng vấn — Nhân viên kinh doanh — Nguyễn Văn A",
  "result": null,
  "text": "THƯ MỜI PHỎNG VẤN\nKính gửi: Anh/Chị Nguyễn Văn A …",
  "html": "<table class=\"hd2\">…</table><h2>THƯ MỜI PHỎNG VẤN</h2>…",
  "sender": "Phạm Thị Dung", "at": "2026-11-05T02:10:00.000Z" }
```

| Trường | Ý nghĩa |
|---|---|
| `kind` | `interview.invite` (thư mời phỏng vấn), `interview.result` (thư báo kết quả) |
| `to[].type = "nhan_vien"` | Gửi vào **tài khoản nhân viên** trên nền tảng theo `emp_code` (mã NV của app HCNS). `copy: true` = bản để biết (trưởng bộ phận tuyển) |
| `to[].type = "ung_vien"` | Ứng viên chưa có tài khoản: nền tảng gửi theo `email` / `phone` (email, SMS, Zalo… tùy nền tảng). Nếu ứng viên đã có tài khoản thì gửi vào tài khoản |
| `result` | Thư kết quả: `Đạt`, `Không đạt`, `Vắng`; thư mời: `null` |
| `text` | Nội dung dạng chữ (đã bỏ thẻ HTML) cho SMS, thông báo đẩy |
| `html` | Nội dung đầy đủ theo mẫu thư HCNS sửa trong «Kho biểu mẫu» (dùng cho email, màn xem thư) |

- Có dữ liệu cá nhân của ứng viên (email, SĐT): nền tảng chỉ dùng để gửi tin, không lưu sang chỗ khác.
- Nền tảng xử lý trùng theo `ref.code` + `kind` + `to[0].code`: HCNS có thể bấm gửi lại sau khi sửa lịch.
- Chưa đặt `PLATFORM_WEBHOOK` thì tin nằm trong hàng đợi của app HCNS, khi có địa chỉ sẽ tự gửi.
