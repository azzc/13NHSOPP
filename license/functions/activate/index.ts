// supabase/functions/activate/index.ts
// Activate license + register machine + return features
//
// Deploy via Dashboard: Functions → New function → "activate" → paste this code
// Verify JWT: ON (uses anon key)
//
// Call:
//   POST https://<ref>.supabase.co/functions/v1/activate
//   Headers: Authorization: Bearer <ANON_KEY>
//            apikey: <ANON_KEY>
//            Content-Type: application/json
//   Body: { license_key, hcode, machine_id, machine_name?, app_version? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...cors },
  })
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors })
  if (req.method !== "POST")   return json({ error: "method not allowed" }, 405)

  let body: any
  try { body = await req.json() } catch { return json({ error: "invalid json" }, 400) }

  const { license_key, hcode, machine_id, machine_name, app_version, os_name } = body || {}
  if (!license_key || !hcode || !machine_id)
    return json({ error: "missing license_key/hcode/machine_id" }, 400)

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  // ── lookup license ──
  const { data: license, error: lerr } = await supabase
    .from("licenses")
    .select("*")
    .eq("license_key", license_key)
    .eq("hcode", hcode)
    .maybeSingle()

  if (lerr)      return json({ error: "db error", detail: lerr.message }, 500)
  if (!license)  return json({ error: "license not found (or hcode mismatch)" }, 404)
  if (license.status !== "active")
    return json({ error: `license is ${license.status}` }, 403)
  if (license.expires_at && new Date(license.expires_at) < new Date())
    return json({ error: "license expired", expires_at: license.expires_at }, 403)

  // ── machine count check ──
  const max = license.max_machines || 3
  const { data: actAll } = await supabase
    .from("activations")
    .select("machine_id")
    .eq("license_id", license.id)
  const existing = actAll?.find((a: any) => a.machine_id === machine_id)
  if (!existing && (actAll?.length ?? 0) >= max)
    return json({ error: `machine limit reached (${max})`, current: actAll?.length }, 403)

  // ── upsert activation ──
  const nowIso = new Date().toISOString()
  await supabase.from("activations").upsert({
    license_id:   license.id,
    machine_id,
    machine_name: machine_name || null,
    os_name:      os_name      || null,
    app_version:  app_version  || null,
    activated_at: existing ? undefined : nowIso,
    last_seen:    nowIso,
  }, { onConflict: "license_id,machine_id" })

  // ── update heartbeat ──
  await supabase.from("licenses")
    .update({ last_heartbeat: nowIso })
    .eq("id", license.id)

  // ── audit ──
  await supabase.from("audit_log").insert({
    license_id: license.id,
    hcode,
    machine_id,
    action: "activate",
    ip:         req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for"),
    user_agent: req.headers.get("user-agent"),
    payload:    { machine_name, app_version, os_name },
  })

  // ── return token (cached license info for client) ──
  // MVP: token = JSON payload (no signing) — relies on heartbeat re-check
  const nextHeartbeat = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
  return json({
    ok: true,
    license_id:     license.id,
    hcode:          license.hcode,
    plan:           license.plan,
    features:       license.features || {},
    expires_at:     license.expires_at,
    issued_at:      nowIso,
    next_heartbeat: nextHeartbeat,
    machines_used:  existing ? actAll?.length : (actAll?.length ?? 0) + 1,
    machines_max:   max,
  })
})
