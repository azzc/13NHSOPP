#!/usr/bin/env node
/**
 * gen_license.js — สร้าง license key ใหม่ + INSERT เข้า Supabase
 *
 * ต้องใช้ SERVICE_ROLE_KEY (ห้าม commit) — ใส่ใน .env หรือ env var:
 *   SUPABASE_URL=https://fzlzmrwkueonabpwuhma.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *
 * usage:
 *   node gen_license.js --hcode 05097 --plan pro --days 365 --name "รพ.สต.บ้านดงมัน"
 *   node gen_license.js --hcode 05097 --plan trial --days 30
 *
 * options:
 *   --hcode       รหัสสถานพยาบาล 5 หลัก (required)
 *   --plan        free | trial | pro | enterprise  (default: pro)
 *   --days        จำนวนวันถึงหมดอายุ (default: 365)
 *   --name        ชื่อ รพ. (จะ upsert ลง hospitals)
 *   --province    จังหวัด
 *   --machines    max machines (default: 3)
 *   --features    JSON string override (default: ตาม plan)
 */
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fzlzmrwkueonabpwuhma.supabase.co';
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SVC_KEY) {
  console.error('❌ ตั้ง env SUPABASE_SERVICE_ROLE_KEY ก่อน');
  console.error('   PowerShell: $env:SUPABASE_SERVICE_ROLE_KEY = "eyJ..."');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SVC_KEY);

const hcode = args.hcode;
if (!hcode || !/^\d{5}$/.test(hcode)) {
  console.error('❌ --hcode ต้องเป็น 5 หลัก');
  process.exit(1);
}

const plan     = args.plan || 'pro';
const days     = parseInt(args.days || (plan === 'trial' ? '30' : '365'), 10);
const machines = parseInt(args.machines || '3', 10);
const name     = args.name;
const province = args.province;

// Plan presets
const PLAN_FEATURES = {
  free: {
    validator_basic: true, online_updates: true,
  },
  trial: {
    validator_basic: true, validator_full: true, reimburse_analyzer: true,
    fix_issues_dialog: true, drug_catalog_import: true,
    online_updates: true, line_notifications: true,
    multi_workstation: true, audit_log: true,
  },
  pro: {
    validator_basic: true, validator_full: true, reimburse_analyzer: true,
    fix_issues_dialog: true, drug_catalog_import: true,
    online_updates: true, line_notifications: true,
    multi_workstation: true, audit_log: true,
  },
  enterprise: {
    validator_basic: true, validator_full: true, reimburse_analyzer: true,
    fix_issues_dialog: true, drug_catalog_import: true,
    online_updates: true, line_notifications: true,
    multi_workstation: true, audit_log: true,
  },
};
const features = args.features ? JSON.parse(args.features) : (PLAN_FEATURES[plan] || PLAN_FEATURES.pro);

// Generate key: PP-XXXX-XXXX-XXXX-XXXX (16 hex chars in 4 groups)
function genKey(prefix = 'PP') {
  const buf = crypto.randomBytes(8); // 16 hex chars
  const hex = buf.toString('hex').toUpperCase();
  return `${prefix}-${hex.slice(0,4)}-${hex.slice(4,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}`;
}
const prefix = plan === 'trial' ? 'TR' : (plan === 'enterprise' ? 'EN' : 'PP');
const licenseKey = genKey(prefix);

const expiresAt = new Date(Date.now() + days * 86400 * 1000).toISOString();

(async () => {
  // 1. Upsert hospital
  if (name || province) {
    const { error: he } = await supabase.from('hospitals').upsert({
      hcode, name, province,
    }, { onConflict: 'hcode' });
    if (he) { console.error('❌ upsert hospital:', he.message); process.exit(1); }
    console.log('✅ upsert hospital:', hcode, name || '');
  }

  // 2. Insert license
  const { data, error } = await supabase.from('licenses').insert({
    hcode, license_key: licenseKey, plan,
    features, status: 'active',
    trial: plan === 'trial',
    max_machines: machines,
    expires_at: expiresAt,
  }).select('id, license_key, plan, expires_at, max_machines, features').single();

  if (error) { console.error('❌ insert license:', error.message); process.exit(1); }

  console.log('\n🎉 License created\n');
  console.log('  hcode:        ', hcode);
  console.log('  license_key:  ', data.license_key);
  console.log('  plan:         ', data.plan);
  console.log('  expires_at:   ', data.expires_at);
  console.log('  max_machines: ', data.max_machines);
  console.log('  features:     ', Object.keys(data.features).filter(k => data.features[k]).join(', '));
  console.log('\nส่งให้ user: license_key + hcode');
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
