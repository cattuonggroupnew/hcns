// Tạo / cập nhật cấu trúc CSDL từ meta.js. Chạy mỗi lần khởi động, chạy lại bao nhiêu lần cũng được:
// bảng thiếu thì tạo, cột thiếu thì thêm. Không bao giờ xóa cột hay bảng đang có dữ liệu.
const { E, ROLES, SETTINGS, ASSIGN } = require('./meta');
const SQLT = { text: 'text', long: 'text', sel: 'text', month: 'text', time: 'text', tags: 'text', code: 'text', int: 'integer', num: 'numeric', money: 'numeric(18,0)',
  date: 'date', dt: 'timestamptz', ref: 'integer', user: 'integer', bool: 'boolean', json: 'jsonb', days: 'jsonb', multi: 'jsonb' };
const lit = v => `'${String(v).replace(/'/g, "''")}'`;
const BASE = `
CREATE TABLE IF NOT EXISTS hr_user (
  id serial PRIMARY KEY, username text NOT NULL, full_name text NOT NULL,
  role text NOT NULL CHECK (role IN (${ROLES.map(r => lit(r[0])).join(',')})),
  emp_id integer, dept_id integer, legal_ids integer[], title text, active boolean NOT NULL DEFAULT true,
  pw_hash text, must_change boolean NOT NULL DEFAULT true, last_login timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS hr_user_username ON hr_user (lower(username));
CREATE TABLE IF NOT EXISTS hr_session (sid text PRIMARY KEY, user_id integer NOT NULL REFERENCES hr_user(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS hr_setting (key text PRIMARY KEY, value jsonb, updated_at timestamptz DEFAULT now(), updated_by integer);
CREATE TABLE IF NOT EXISTS hr_counter (prefix text PRIMARY KEY, n integer NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS hr_file (id serial PRIMARY KEY, ent text NOT NULL, rec_id integer NOT NULL, kind text, name text NOT NULL, mime text, size integer, path text NOT NULL, version integer NOT NULL DEFAULT 1,
  uploaded_by integer REFERENCES hr_user(id), uploaded_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz, deleted_by integer, is_demo boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS hr_file_rec ON hr_file (ent, rec_id);
CREATE TABLE IF NOT EXISTS hr_note (id serial PRIMARY KEY, ent text NOT NULL, rec_id integer NOT NULL, body text NOT NULL, by integer REFERENCES hr_user(id), at timestamptz NOT NULL DEFAULT now(), is_demo boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS hr_audit (id bigserial PRIMARY KEY, ent text NOT NULL, rec_id integer, action text NOT NULL, before jsonb, after jsonb, user_id integer REFERENCES hr_user(id), at timestamptz NOT NULL DEFAULT now(), note text, is_demo boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS hr_audit_rec ON hr_audit (ent, rec_id);
CREATE INDEX IF NOT EXISTS hr_audit_at ON hr_audit (at DESC);
CREATE TABLE IF NOT EXISTS hr_approval (id serial PRIMARY KEY, ent text NOT NULL, rec_id integer NOT NULL, title text, roles text[] NOT NULL, approver_id integer REFERENCES hr_user(id),
  status text NOT NULL DEFAULT 'cho_duyet' CHECK (status IN ('cho_duyet','da_duyet','tu_choi','huy')), requested_by integer REFERENCES hr_user(id), requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by integer REFERENCES hr_user(id), decided_at timestamptz, comment text, is_demo boolean NOT NULL DEFAULT false);
CREATE UNIQUE INDEX IF NOT EXISTS hr_approval_one_open ON hr_approval (ent, rec_id) WHERE status = 'cho_duyet';
CREATE TABLE IF NOT EXISTS hr_alert_state (key text PRIMARY KEY, state text NOT NULL, note text, by integer REFERENCES hr_user(id), at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS hr_snapshot (id serial PRIMARY KEY, code text NOT NULL, period text NOT NULL, filters jsonb, data jsonb NOT NULL, version integer NOT NULL, closed_by integer REFERENCES hr_user(id), closed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS hr_issue (id serial PRIMARY KEY, src text NOT NULL, severity text NOT NULL, title text NOT NULL, detail text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS hr_notice (id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES hr_user(id) ON DELETE CASCADE, title text NOT NULL, body text, link text, at timestamptz NOT NULL DEFAULT now(), read_at timestamptz);
CREATE INDEX IF NOT EXISTS hr_notice_user ON hr_notice (user_id, read_at);
CREATE TABLE IF NOT EXISTS hr_template (key text PRIMARY KEY, body text NOT NULL, updated_by integer REFERENCES hr_user(id), updated_at timestamptz NOT NULL DEFAULT now());
-- mẫu HCNS tự thêm cho từng mục (ent); is_default = mẫu in mặc định của mục (kinds: chỉ áp cho loại HĐ / QĐ đó)
ALTER TABLE hr_template ADD COLUMN IF NOT EXISTS ent text, ADD COLUMN IF NOT EXISTS name text, ADD COLUMN IF NOT EXISTS kinds text[], ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS hr_job (id serial PRIMARY KEY, name text NOT NULL, period text NOT NULL, result text, at timestamptz NOT NULL DEFAULT now(), UNIQUE (name, period));
`;
async function migrate(db) {
  await db.q(BASE);
  const cols = new Map();
  for (const r of await db.q("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name LIKE 'hr\\_%'"))
    (cols.get(r.table_name) || cols.set(r.table_name, new Set()).get(r.table_name)).add(r.column_name);
  for (const e of Object.values(E)) {
    const t = e.table, have = cols.get(t);
    const defs = e.fields.map(f => `${f.k} ${SQLT[f.t]}${f.t === 'bool' ? ` DEFAULT ${f.def === true}` : ''}`);
    if (!have) await db.q(`CREATE TABLE ${t} (id serial PRIMARY KEY, ${defs.join(', ')}, is_demo boolean NOT NULL DEFAULT false, created_by integer, created_at timestamptz NOT NULL DEFAULT now(), updated_by integer, updated_at timestamptz)`);
    else for (const f of e.fields) if (!have.has(f.k)) await db.q(`ALTER TABLE ${t} ADD COLUMN ${f.k} ${SQLT[f.t]}`);
  }
  for (const e of Object.values(E)) {
    const t = e.table;
    for (const c of await db.q(`SELECT conname FROM pg_constraint WHERE conrelid = $1::regclass AND conname LIKE 'fk\\_%'`, [t])) await db.q(`ALTER TABLE ${t} DROP CONSTRAINT ${c.conname}`);
    const add = e.fields.filter(f => f.t === 'ref').map(f => `ADD CONSTRAINT fk_${t}_${f.k} FOREIGN KEY (${f.k}) REFERENCES ${E[f.ref].table}(id) ON DELETE RESTRICT`);
    // dữ liệu cũ lệch (liên kết mồ côi, trùng mã): ghi log và chạy tiếp, không làm app không khởi động được
    const safe = async (sql, alt) => { try { await db.q(sql); } catch (er) { console.error(`Cấu trúc ${t}: ${er.message}`); if (alt) try { await db.q(alt); } catch { /* bỏ qua */ } } };
    if (add.length) await safe(`ALTER TABLE ${t} ${add.join(', ')}`, `ALTER TABLE ${t} ${add.map(a => a + ' NOT VALID').join(', ')}`);   // NOT VALID: vẫn kiểm dòng mới
    for (const f of e.fields.filter(f => f.uniq || f.t === 'code')) await safe(`CREATE UNIQUE INDEX IF NOT EXISTS ${t}_${f.k}_uq ON ${t} (${f.k})`);
    for (const u of e.uniq || []) await safe(`CREATE UNIQUE INDEX IF NOT EXISTS ${t}_${u.join('_')}_uq ON ${t} (${u.join(', ')})`);
    for (const f of e.fields.filter(f => f.t === 'ref' || f.k === 'status')) await db.q(`CREATE INDEX IF NOT EXISTS ${t}_${f.k}_ix ON ${t} (${f.k})`);
  }
  for (const [k, v] of Object.entries(SETTINGS)) await db.q('INSERT INTO hr_setting (key, value) VALUES ($1,$2) ON CONFLICT DO NOTHING', [k, JSON.stringify(v)]);
  // ký hiệu công bổ sung theo góp ý: H = nghỉ hiếu hỉ (hưởng lương)
  await db.q("INSERT INTO hr_att_type (code, name, days, hours, grp, unpaid) SELECT 'H', 'Nghỉ hiếu hỉ (hưởng lương)', 1, 8, 'Nghỉ việc riêng có hưởng lương', false WHERE NOT EXISTS (SELECT 1 FROM hr_att_type WHERE code = 'H')");
  // cấu hình đã lưu từ bản cũ: bổ sung khóa mới, giữ nguyên giá trị HCNS đã sửa
  for (const [k, v] of Object.entries(SETTINGS)) await db.q('UPDATE hr_setting SET value = $2::jsonb || value WHERE key = $1', [k, JSON.stringify(v)]);
  // mục menu được giao; lần đầu thêm cột thì áp phân công theo sheet «Menu» của DMCV
  if (!cols.get('hr_user')?.has('items')) { await db.q('ALTER TABLE hr_user ADD COLUMN IF NOT EXISTS items text[]'); await applyAssign(db); }
  await syncMenu(db);
}
// menu đổi (thêm mục, chuyển mục sang chức năng khác, bỏ mục) → phân quyền tự theo, mỗi lần khởi động:
//   bỏ mục không còn trên menu; mục MỚI xuất hiện → giao cho người đang được giao mục khác cùng chức năng (vd. thêm «Theo dõi con dấu» vào «Theo dõi ấn phẩm» → ai làm ấn phẩm có luôn);
//   thêm phần còn thiếu theo bảng phân công (ASSIGN). Mục người quản trị đã gỡ tay thì không giao lại (chỉ mục mới mới được giao).
async function syncMenu(db) {
  const { MENU } = require('./meta'), fns = MENU.flatMap(([, fs]) => fs.map(([, , x]) => Array.isArray(x) ? x : [x])), all = new Set(fns.flat());
  const prev = (await db.one("SELECT value FROM hr_setting WHERE key = 'menu_items'"))?.value;
  const users = await db.q('SELECT id, username, items FROM hr_user WHERE items IS NOT NULL');
  const seen = new Set(prev || users.flatMap(u => u.items)), fresh = [...all].filter(i => !seen.has(i));
  for (const u of users) {
    const had = new Set(u.items), next = new Set(u.items.filter(i => all.has(i)));
    for (const i of fresh) if (fns.some(f => f.includes(i) && f.some(x => x !== i && had.has(x)))) next.add(i);
    for (const i of ASSIGN[u.username]?.items || []) if (fresh.includes(i) && all.has(i)) next.add(i);
    const out = [...next].sort(), before = [...u.items].sort();
    if (JSON.stringify(out) !== JSON.stringify(before)) await db.q('UPDATE hr_user SET items = $1 WHERE id = $2', [out, u.id]);
  }
  await db.q("INSERT INTO hr_setting (key, value) VALUES ('menu_items', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()", [JSON.stringify([...all])]);
}
// 5 người phòng HCNS: vai trò, pháp nhân, mục được giao; mọi tài khoản khác khóa lại
async function applyAssign(db) {
  if (!(await db.one('SELECT count(*) n FROM hr_user')).n) return;
  for (const [u, a] of Object.entries(ASSIGN)) await db.q(`UPDATE hr_user SET active = true, role = $2, items = $3, legal_ids = CASE WHEN $4::text[] IS NULL THEN NULL ELSE (SELECT array_agg(id ORDER BY id) FROM hr_legal WHERE code = ANY($4)) END WHERE username = $1`,
    [u, a.role, a.items || null, a.legals || null]);
  await db.q('UPDATE hr_user SET active = false WHERE NOT (username = ANY($1))', [Object.keys(ASSIGN)]);
}
module.exports = { migrate, applyAssign };
