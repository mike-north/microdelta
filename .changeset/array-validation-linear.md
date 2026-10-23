---
'@microdelta/value': patch
'@microdelta/history': patch
---

Value now owns a detached prepared snapshot for repeated exact observations, so History builds selected addresses without rescanning each ancestor array. Existing Value rejection rules and exact selected facts remain intact.
