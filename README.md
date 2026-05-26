# 13NHSOPP — Data files for NhsoSender13

Public data files for [NhsoSender13](https://github.com/azzc/NhsoSender13) (private repo).

App fetches `manifest.json` on startup → diff vs LocalDb → download newer data files → verify SHA256 → apply.

## Files

| File | Content |
|---|---|
| `manifest.json` | Index of all data files + versions + SHA256 |
| `error-codes.json` | NHSO error codes (L104/L203/R118/SV001/SV002 …) → solution Thai |
| (future) `fee-schedule-NNNN.json` | PP Fee Schedule per year (from สปสช. PDF) |
| (future) `validation-rules.json` | Override rules for Validator |

## Update workflow

```bash
# 1. แก้ไฟล์ data
vim error-codes.json   # เพิ่ม code หรือแก้ solution

# 2. คำนวณ SHA256 ใหม่
sha256sum error-codes.json

# 3. อัพเดต manifest.json
#    - bump version (1.0.0 → 1.0.1)
#    - update sha256

# 4. commit + push
git add . && git commit -m "fix: ..." && git push
```

ผู้ใช้คนต่อไปเปิด NhsoSender13 → auto-download silent ภายใน 24 ชม.
