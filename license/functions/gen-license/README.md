# gen-license — ออก License Key จากมือถือ

Edge Function สำหรับออก license โดย **ไม่ต้องเปิดเผย `service_role` key** บนอุปกรณ์
(ของเดิม `license-gen.html` ต้องแปะ service_role ลงหน้าเว็บ → เสี่ยงถ้าใช้บนมือถือ).
แทนที่ด้วย `ADMIN_TOKEN` สั้น ๆ ที่เก็บเป็น secret ฝั่ง server.

## Deploy (ครั้งเดียว)

1. **สร้าง secret `ADMIN_TOKEN`**
   - สุ่มค่ายาว ๆ เช่น (PowerShell):
     ```powershell
     -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | % {[char]$_})
     ```
   - Supabase Dashboard → **Edge Functions → Secrets** (หรือ `supabase secrets set ADMIN_TOKEN=...`)
   - `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` มีให้อัตโนมัติใน runtime — ไม่ต้องตั้งเอง

2. **สร้าง function**
   - Dashboard → Functions → **New function** → ชื่อ `gen-license` → วางโค้ดจาก `index.ts`
   - **Verify JWT: OFF** (เราตรวจสิทธิ์เองด้วย header `x-admin-token`)
   - หรือ CLI: `supabase functions deploy gen-license --no-verify-jwt`

## เรียกใช้ (มือถือ)

เปิด `https://<github-pages>/gen-mobile.html` → ตั้งค่า URL + Admin Token ครั้งแรก → กรอก HCODE → สร้าง.

หรือยิงตรง:
```bash
curl -X POST https://fzlzmrwkueonabpwuhma.supabase.co/functions/v1/gen-license \
  -H "content-type: application/json" \
  -H "x-admin-token: <ADMIN_TOKEN>" \
  -d '{"hcode":"05097","plan":"free","days":30}'
```

## Request body

| field | required | default | หมายเหตุ |
|---|---|---|---|
| `hcode` | ✅ | — | เลข 5 หลัก |
| `plan` | | `free` | `free` / `trial` / `pro` / `enterprise` |
| `days` | | free/trial 30, pro/ent 365 | `0` = ไม่หมดอายุ |
| `machines` | | `3` | จำนวนเครื่อง |
| `name` | | = hcode | ชื่อ รพ.สต. (upsert ลง hospitals) |
| `province` | | — | จังหวัด |
| `custom_key` | | สุ่ม | กำหนด key เอง |
| `force` | | `false` | ออก free ซ้ำทั้งที่มี active อยู่ |

## Response

```json
{ "ok": true, "license_key": "FR-1A2B-3C4D-5E6F-7890",
  "hcode": "05097", "plan": "free",
  "expires_at": "2026-07-10T...", "max_machines": 3,
  "features": ["validator_basic","online_updates","fetch_ep_pp","transfer_cancel"] }
```

- `401 unauthorized` — `x-admin-token` ไม่ตรง
- `409` — free license เดิมยังใช้ได้ (มี `existing_key`); ส่ง `force:true` เพื่อออกซ้ำ
- ตรรกะ key/plan/feature ตรงกับ `license/tools/gen_license.js` (CLI เดิมยังใช้ได้)
