// supabase/functions/gen-license/index.ts
// สร้าง license key ใหม่ (admin) — service_role อยู่ฝั่ง server เท่านั้น
//
// จุดประสงค์: ให้ออก license จากมือถือได้ โดย "ไม่ต้อง" แปะ service_role key
// ลงในหน้าเว็บ (ของเดิม license-gen.html ทำแบบนั้น = อันตรายบนมือถือ).
// แทนที่ด้วย ADMIN_TOKEN สั้น ๆ ที่ตั้งเป็น secret ฝั่ง Edge Function.
//
// Deploy (Dashboard): Functions → New function → "gen-license" → paste โค้ดนี้
//   ตั้ง Verify JWT: OFF  (เราตรวจสิทธิ์เองด้วย x-admin-token)
//   ตั้ง secret:  ADMIN_TOKEN = <สุ่มยาว ๆ>   (Functions → Secrets / Settings)
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY มีให้อัตโนมัติใน runtime อยู่แล้ว
//
// Call:
//   POST https://<ref>.supabase.co/functions/v1/gen-license
//   Headers: x-admin-token: <ADMIN_TOKEN> ; content-type: application/json
//   Body: { hcode, plan?, days?, machines?, name?, province?, custom_key?, features?, force? }
//   → { ok, license_key, hcode, plan, expires_at, max_machines, features }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-admin-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...cors },
  })
}

// ── Plan presets (ตรงกับ tools/gen_license.js) ──
const PLAN_FEATURES: Record<string, Record<string, boolean>> = {
  free: {
    validator_basic: true,
    online_updates: true,
    fetch_ep_pp: true,
    transfer_cancel: true,
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
}

// PP-XXXX-XXXX-XXXX-XXXX (16 hex, 4 กลุ่ม) — เหมือน gen_license.js
function genKey(prefix = "PP"): string {
  const buf = new Uint8Array(8)
  crypto.getRandomValues(buf)
  const hex = Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase()
  return `${prefix}-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors })
  if (req.method !== "POST")   return json({ error: "method not allowed" }, 405)

  // ── admin auth ──
  const adminToken = Deno.env.get("ADMIN_TOKEN")
  if (!adminToken) return json({ error: "server misconfigured: ADMIN_TOKEN not set" }, 500)
  if (req.headers.get("x-admin-token") !== adminToken)
    return json({ error: "unauthorized" }, 401)

  let body: any
  try { body = await req.json() } catch { return json({ error: "invalid json" }, 400) }

  const hcode = String(body?.hcode || "").trim()
  if (!/^\d{5}$/.test(hcode)) return json({ error: "hcode ต้องเป็นเลข 5 หลัก" }, 400)

  const plan     = String(body?.plan || "free")
  if (!PLAN_FEATURES[plan]) return json({ error: `plan ไม่ถูกต้อง: ${plan}` }, 400)
  const days     = body?.days != null ? parseInt(String(body.days), 10) : (plan === "pro" || plan === "enterprise" ? 365 : 30)
  const machines = body?.machines != null ? parseInt(String(body.machines), 10) : 3
  const name     = body?.name ? String(body.name).trim() : null
  const province = body?.province ? String(body.province).trim() : null
  const force    = body?.force === true || body?.force === "true"
  const features = body?.features && typeof body.features === "object"
    ? body.features
    : PLAN_FEATURES[plan]

  // custom key (อนุญาต) หรือสุ่มตาม prefix ของ plan
  const prefix = plan === "trial" ? "TR" : (plan === "enterprise" ? "EN" : (plan === "free" ? "FR" : "PP"))
  let licenseKey = body?.custom_key ? String(body.custom_key).trim().toUpperCase() : genKey(prefix)
  if (!licenseKey) licenseKey = genKey(prefix)

  // expires_at: days <= 0 = ไม่หมดอายุ
  const expiresAt = days > 0 ? new Date(Date.now() + days * 86400 * 1000).toISOString() : null

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  // ── 0. กัน 1 active free license ต่อ hcode (เหมือน gen_license.js) ──
  if (plan === "free" && !force) {
    const { data: existing, error: ee } = await supabase
      .from("licenses")
      .select("license_key, expires_at, status")
      .eq("hcode", hcode).eq("plan", "free").eq("status", "active")
    if (ee) return json({ error: "ตรวจ license เดิมล้มเหลว", detail: ee.message }, 500)
    const stillValid = existing?.find((l: any) => !l.expires_at || new Date(l.expires_at) > new Date())
    if (stillValid)
      return json({
        error: `hcode ${hcode} มี free license ที่ยังใช้ได้อยู่`,
        existing_key: stillValid.license_key,
        expires_at: stillValid.expires_at,
        hint: "1 key ต่อ 1 hcode — ส่ง force=true เพื่อออกซ้ำ",
      }, 409)
  }

  // ── 1. upsert hospital (FK: licenses.hcode → hospitals.hcode) ──
  const { error: he } = await supabase.from("hospitals").upsert(
    { hcode, name: name || hcode, province },
    { onConflict: "hcode" },
  )
  if (he) return json({ error: "บันทึกข้อมูลโรงพยาบาลล้มเหลว", detail: he.message }, 500)

  // ── 2. insert license ──
  const { data, error } = await supabase.from("licenses").insert({
    hcode, license_key: licenseKey, plan,
    features, status: "active",
    trial: plan === "trial",
    max_machines: machines,
    expires_at: expiresAt,
  }).select("license_key, hcode, plan, expires_at, max_machines, features").single()

  if (error) {
    // 23505 = unique_violation (key ซ้ำ)
    const dup = (error as any).code === "23505" || /duplicate|unique/i.test(error.message)
    return json({ error: dup ? "license_key ซ้ำ — ลองใหม่อีกครั้ง" : "สร้าง license ล้มเหลว", detail: error.message }, dup ? 409 : 500)
  }

  // ── 3. audit ──
  await supabase.from("audit_log").insert({
    hcode,
    action: "license_created",
    ip:         req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for"),
    user_agent: req.headers.get("user-agent"),
    payload:    { license_key: licenseKey, plan, days, machines, via: "gen-license" },
  })

  return json({
    ok: true,
    license_key:  data.license_key,
    hcode:        data.hcode,
    plan:         data.plan,
    expires_at:   data.expires_at,
    max_machines: data.max_machines,
    features:     Object.keys(data.features || {}).filter(k => (data.features as any)[k]),
  })
})
