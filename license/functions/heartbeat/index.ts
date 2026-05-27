// supabase/functions/heartbeat/index.ts
// Re-validate license + bump last_seen — เรียกทุก 7 วันจาก client
//
// Call:
//   POST https://<ref>.supabase.co/functions/v1/heartbeat
//   Body: { license_key, hcode, machine_id, app_version? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}
function json(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), {
    status: s, headers: { "content-type": "application/json", ...cors },
  })
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors })
  if (req.method !== "POST")   return json({ error: "method not allowed" }, 405)

  const body = await req.json().catch(() => ({}))
  const { license_key, hcode, machine_id, app_version } = body
  if (!license_key || !hcode || !machine_id)
    return json({ error: "missing license_key/hcode/machine_id" }, 400)

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  const { data: license } = await supabase
    .from("licenses").select("*")
    .eq("license_key", license_key).eq("hcode", hcode)
    .maybeSingle()
  if (!license)
    return json({ ok: false, error: "license not found", action: "deactivate" }, 404)
  if (license.status !== "active")
    return json({ ok: false, error: `license is ${license.status}`, action: "deactivate" }, 403)
  if (license.expires_at && new Date(license.expires_at) < new Date())
    return json({ ok: false, error: "expired", action: "deactivate", expires_at: license.expires_at }, 403)

  // ตรวจว่า machine_id ยังลงทะเบียนอยู่
  const { data: act } = await supabase
    .from("activations").select("*")
    .eq("license_id", license.id).eq("machine_id", machine_id)
    .maybeSingle()
  if (!act)
    return json({ ok: false, error: "machine not activated", action: "re-activate" }, 403)

  const nowIso = new Date().toISOString()
  await supabase.from("activations")
    .update({ last_seen: nowIso, app_version: app_version || act.app_version })
    .eq("id", act.id)
  await supabase.from("licenses")
    .update({ last_heartbeat: nowIso }).eq("id", license.id)
  await supabase.from("audit_log").insert({
    license_id: license.id, hcode, machine_id, action: "heartbeat",
    payload: { app_version },
  })

  const nextHeartbeat = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
  return json({
    ok: true,
    plan: license.plan,
    features: license.features || {},
    expires_at: license.expires_at,
    issued_at: nowIso,
    next_heartbeat: nextHeartbeat,
  })
})
