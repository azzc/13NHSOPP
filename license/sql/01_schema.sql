-- NhsoSender13 License System — Schema
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- ──────────────────────────────────────────────────────────────────

-- 1. โรงพยาบาล / รพ.สต.
CREATE TABLE IF NOT EXISTS hospitals (
  hcode          TEXT PRIMARY KEY,             -- '05097'
  name           TEXT,
  province       TEXT,
  contact_phone  TEXT,
  contact_email  TEXT,
  line_user_id   TEXT,                         -- link กับ LINE OA (Phase O1)
  note           TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- 2. License keys
CREATE TABLE IF NOT EXISTS licenses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hcode          TEXT REFERENCES hospitals(hcode) ON DELETE RESTRICT,
  license_key    TEXT UNIQUE NOT NULL,         -- 'PP-XXXX-XXXX-XXXX-XXXX'
  plan           TEXT NOT NULL,                -- 'free','trial','pro','enterprise'
  features       JSONB NOT NULL DEFAULT '{}'::jsonb,
                                               -- {"validator_full":true,"reimburse":true,...}
  status         TEXT NOT NULL DEFAULT 'active',
                                               -- 'active','expired','revoked','pending'
  trial          BOOLEAN DEFAULT false,
  max_machines   INT DEFAULT 3,
  activated_at   TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ,
  last_heartbeat TIMESTAMPTZ,
  note           TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_licenses_hcode   ON licenses(hcode);
CREATE INDEX IF NOT EXISTS idx_licenses_status  ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_licenses_expires ON licenses(expires_at);

-- 3. เครื่องที่ activate (2-3 workstation/license)
CREATE TABLE IF NOT EXISTS activations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id     UUID REFERENCES licenses(id) ON DELETE CASCADE,
  machine_id     TEXT NOT NULL,                -- SHA256(MAC + computer_name)
  machine_name   TEXT,
  os_name        TEXT,
  app_version    TEXT,
  activated_at   TIMESTAMPTZ DEFAULT now(),
  last_seen      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (license_id, machine_id)
);

CREATE INDEX IF NOT EXISTS idx_activations_license ON activations(license_id);

-- 4. การชำระเงิน
CREATE TABLE IF NOT EXISTS payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id     UUID REFERENCES licenses(id) ON DELETE SET NULL,
  hcode          TEXT,
  amount         NUMERIC(10,2),
  currency       TEXT DEFAULT 'THB',
  method         TEXT,                         -- 'promptpay','bank_transfer','stripe'
  ref_no         TEXT,                         -- เลขอ้างอิงธนาคาร/promptpay
  paid_at        TIMESTAMPTZ,
  status         TEXT DEFAULT 'pending',       -- 'pending','paid','refunded','cancelled'
  raw_meta       JSONB,
  note           TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_license ON payments(license_id);
CREATE INDEX IF NOT EXISTS idx_payments_hcode   ON payments(hcode);

-- 5. Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id             BIGSERIAL PRIMARY KEY,
  license_id     UUID REFERENCES licenses(id) ON DELETE SET NULL,
  hcode          TEXT,
  action         TEXT NOT NULL,                -- 'activate','heartbeat','expired','revoked','feature_used'
  machine_id     TEXT,
  ip             TEXT,
  user_agent     TEXT,
  payload        JSONB,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_license ON audit_log(license_id);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

-- 6. Feature catalog (สำหรับ admin reference)
CREATE TABLE IF NOT EXISTS feature_catalog (
  key            TEXT PRIMARY KEY,             -- 'reimburse_analyzer','line_oa',...
  name           TEXT,
  description    TEXT,
  category       TEXT,
  default_free   BOOLEAN DEFAULT false,
  default_pro    BOOLEAN DEFAULT true
);

INSERT INTO feature_catalog (key, name, description, category, default_free, default_pro) VALUES
  ('validator_basic',     'Validator พื้นฐาน',    '5 rules หลัก',                              'validation', true,  true),
  ('validator_full',      'Validator แบบเต็ม',    '50+ rules + custom',                        'validation', false, true),
  ('reimburse_analyzer',  'วิเคราะห์ค่าชดเชย',     'คาดได้ ต่อ visit',                          'analysis',   false, true),
  ('fix_issues_dialog',   'แก้ไขข้อมูล + Undo',    'แก้ field โดยตรง',                          'edit',       false, true),
  ('drug_catalog_import', 'นำเข้า DrugCatalog',   'Import xlsx ผ่าน UI',                       'data',       false, true),
  ('online_updates',      'อัพเดทออนไลน์',         'manifest + error_codes + fee_schedule',     'system',     true,  true),
  ('line_notifications',  'LINE OA แจ้งเตือน',     'reject alerts, license reminders',         'support',    false, true),
  ('multi_workstation',   'หลาย workstation',     'sync state ระหว่างเครื่อง',                  'system',     false, true),
  ('audit_log',           'ประวัติการแก้ไข',       'log ครบทุก action',                         'compliance', false, true)
ON CONFLICT (key) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────
-- Row Level Security (RLS) — กัน anon เห็นข้อมูลของรพ.อื่น
-- ──────────────────────────────────────────────────────────────────

ALTER TABLE hospitals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE licenses     ENABLE ROW LEVEL SECURITY;
ALTER TABLE activations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log    ENABLE ROW LEVEL SECURITY;

-- policy: anon role ไม่มีสิทธิ์ direct query ใดๆ
-- ทุก operation ผ่าน Edge Functions (service_role) เท่านั้น
-- (ไม่ต้องสร้าง policy → default deny all)

-- feature_catalog อ่านได้สาธารณะ (สำหรับโชว์ pricing page)
ALTER TABLE feature_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY feature_catalog_read ON feature_catalog FOR SELECT USING (true);

-- ──────────────────────────────────────────────────────────────────
-- Trigger: updated_at auto
-- ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trigger_set_timestamp() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_timestamp_hospitals  BEFORE UPDATE ON hospitals  FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER set_timestamp_licenses   BEFORE UPDATE ON licenses   FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

-- ──────────────────────────────────────────────────────────────────
-- Sample data (DEV only — ลบใน production)
-- ──────────────────────────────────────────────────────────────────

-- เพิ่ม รพ.สต. ทดสอบ
INSERT INTO hospitals (hcode, name, province) VALUES
  ('05097', 'รพ.สต.บ้านดงมัน ตำบลสิงห์โคก', 'ร้อยเอ็ด')
ON CONFLICT (hcode) DO NOTHING;

-- Trial license สำหรับ 05097 (30 วัน)
INSERT INTO licenses (hcode, license_key, plan, trial, features, status, activated_at, expires_at)
VALUES (
  '05097',
  'TR-TEST-2025-DEV1-NHSO',
  'trial',
  true,
  '{"validator_full":true,"reimburse_analyzer":true,"fix_issues_dialog":true,
    "drug_catalog_import":true,"online_updates":true,"line_notifications":true,
    "multi_workstation":true,"audit_log":true}'::jsonb,
  'active',
  now(),
  now() + interval '30 days'
)
ON CONFLICT (license_key) DO NOTHING;
