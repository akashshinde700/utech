# Metal Calculator — APK se ERP tak (Hinglish)

Ye document batata hai:

1. `metalcalculator` repo / APK se kya-kya reverse engineer hua,
2. ERP me kya add kiya gaya (backend + frontend + API),
3. kya abhi bhi baaki hai (jo APK me hai par ERP me consciously nahi daala),
4. aur standard-profile table ke known data issues.

Source APK: **Metal Calculator v11.2** — package `com.pixelsdo.metalweightcalculator`
(versionName `11.2 GDPR`, versionCode `13`, minSdk 22 / targetSdk 33).
Reference web port: `akashshinde700/metalcalculator` (Next.js, `src/lib/calc.ts`, `data/standard_profiles.json`).

---

## 1. APK me kya mila (evidence ke saath)

### 1.1 Screens / activities

`androguard` se manifest nikala — har shape ka apna activity hai:

| Activity | Matlab | ERP shape id |
|---|---|---|
| `DoluMil` | solid round bar | `roundbar` |
| `Boru` | round tube / pipe | `pipe` |
| `Kare` | square bar | `squarebar` |
| `Kareprofil` | square tube | `squaretube` |
| `Lama` | flat bar | `flatbar` |
| `altikose` | hexagon | `hexagon` |
| `Sheet` | sheet / plate | `sheet` |
| `Lprofil` (+ `_eu/_in/_jp_kr/_ru/_usa`) | angle | `angle` |
| `Hprofil` (+ 6 regional) | beam (H/I) | `beam` |
| `Uprofil` (+ 6 regional) | channel (U) | `channel` |
| `Tprofil` | T profile | `tprofile` |
| `DisplayActivity`, `db_RecordsActivity`, `Whatsinpro` | result screen, saved records, pro list | — |

`MainActivity` ke alawa koi network business logic nahi — sirf Ads/Firebase/GMS
permissions hain, isliye calculation poora offline/device par hota hai.

### 1.2 Metals + densities (exact match)

`resources.arsc` ke `metaltypes` / `metalden` arrays (custom ARSC parser se nikale,
kyunki androguard ka high-level API is APK par `None` return karta hai):

Steel 7.85 · Aluminum 2.73 · Brass 8.55 · Copper 8.93 · Bronze 8.88 · Zinc 7.20 ·
Chromium 7.10 · Lead 11.37 · Iron 7.86 · Gold 19.36 · Magnesium 1.70 · Nickel 8.85 ·
Titanium 4.50 · Tin 7.26 · Teflon 2.20 · Silver 10.5 · Platinum 21.45 ·
SS 304/310 7.92 · SS 316/321 7.94 · SS 410/430 7.71 · Zirconium 6.51 · Molybdenum 10.28

Ye 22 hi entries ERP ke catalogue me hain (`backend/src/services/metalCalculator.js`).

### 1.3 Units

| Array | Values |
|---|---|
| `metric_uzunluk` | `mm`, `cm`, `meter` |
| `imperial_uzunluk` | `in`, `ft`, `yd` |
| `metricskenar` | `mm`, `cm`, `in`, `ft` |

Smali se mile conversion doubles: `2.54` (cm per inch), `30.48` (cm per foot),
`2.204622` (lb per kg), `0.1`, `100.0`.

### 1.4 Formula constants (smali `const-wide` → double)

| Class | Constant | Kahan |
|---|---|---|
| `DoluMil$c` (round bar) | `3.14` (by weight), `3.1416`, `0.7854` (by length) | `onClick` |
| `Boru$a` (pipe) | `3.1416` | `a()` |
| `altikose$c` (hexagon) | `0.866` (exact, 5 jagah) | `onClick` |
| `Kare`, `Kareprofil`, `Lama`, `Sheet`, `Lprofil`, `Tprofil`, `Uprofil`, `Hprofil` | koi π constant nahi — pure multiply/subtract chains | `onClick` |

Round bar ka asli expression:

```
weight = 3.14 × D² × L × 0.25 × Q² × R × U × S
```

(`Q` = unit factor for D, `R` = length factor, `U` = density × 1e-6, `S` = pieces)

Pipe: `3.1416 × D × D ... − ...` (bore subtract hota hai), beam/channel me
`sub-double` se `H − 2·tf` / `H − tf` nikalta hai — matlab section-area formulas
wahi hain jo `src/lib/calc.ts` me the.

### 1.5 UI strings (features)

`resources.arsc` se: `by Weight` / `by Length`, `Pieces`, `Kg Price` / `Lb Price`,
`Total Weight`, `Piece Weight`, `Total Length`, `Density`, `Input Your Density`,
`ADD METAL`, `gr/cm³`, `Calculate`, `Calculation Saved`, `Save image`,
`Are you sure, You want to delete all records?`.

### 1.6 Standard profile tables

70 resource arrays (`ipe_types`, `ub`, `uc`, `ubp`, `ismb`, `ismc`, `angle_eu_equal`,
`angle_in_equal`, `ghost_beam_26020`, `jis_h_94_08`, `upn_types`, `upe_types`, …).
Designation list resources me hai, **kg/m values smali me hard-coded hain** — jaise
`Hprofil_eu$j` me branch-wise `53.9`, `44.9`, `85.1`, `222.9` etc.

Web port ne ye 97 families / **2925 profiles** JSON me collect kiye hain; wahi file
ERP me `backend/src/data/standardProfiles.json` ke roop me hai.

---

## 2. ERP me kya add hua

### 2.1 Backend (single source of truth)

| File | Kaam |
|---|---|
| `backend/src/services/metalCalculator.js` | 22 metals, 11 shapes, units, `calculate()`, `profiles()`, `catalog()` |
| `backend/src/validators/metalCalculator.schema.js` | zod wire-format validation |
| `backend/src/controllers/metalCalculator.controller.js` | thin handlers |
| `backend/src/routes/metalCalculator.routes.js` | `requireAuth` + 3 endpoints |
| `backend/src/data/standardProfiles.json` | 97 families / 2925 profiles (APK ke numbers) |
| `backend/server.js` | `/api/metal-calculator` mount |

**API** (sab authenticated, koi business permission key nahi — ye read-only tool hai):

```
GET  /api/metal-calculator/catalog        → metals, shapes, units, constants, profile meta
GET  /api/metal-calculator/profiles       → ?shape=beam|channel|angle&region=&family=&search=
POST /api/metal-calculator/calculate
```

`POST /calculate` body:

```jsonc
{
  "mode": "weight",              // "weight" | "length"
  "shape": "roundbar",           // 11 ids
  "unit": "mm",                  // mm|cm|m|in|ft|yd
  "weightUnit": "kg",            // kg|lb
  "metal": "Steel",              // ya density custom
  "density": 7.85,
  "values": { "d": 100, "L": 1000 },
  "pieces": 2,
  "rate": 70,                    // ₹ per weightUnit (optional)
  "standardProfile": { "name": "IPE 200", "kgm": 22.4 }   // optional
}
```

Response me: `areaMm2`, `kgPerMeter`, `lbPerFoot`, `pieceWeightKg`, `totalWeightKg`,
`pieceWeight`/`totalWeight` (selected unit), `length`/`totalLength`, `totalPrice`,
`notes[]` aur `shape.formula`.

### 2.2 Formulas (ERP engine)

Sab dimensions pehle mm me convert hote hain, phir:

```
kg = volume(mm³) × density(g/cm³) × 1e-6
kg/m = area(mm²) × density × 1e-3
```

| Shape | Volume / section |
|---|---|
| round bar | π/4 · D² · L |
| pipe | π/4 · (D² − (D−2t)²) · L |
| square bar | A² · L |
| square tube | (A² − (A−2t)²) · L |
| flat bar | A · B · L |
| hexagon | 0.866 · A² · L |
| sheet/plate | A · B · t (koi alag length nahi) |
| angle | t · (A + B − t) · L |
| beam | [2·B·tf + (H−2·tf)·tw] · L |
| channel | [2·B·tf + (H−tf)·tw] · L |
| T profile | [B·tf + (H−tf)·tw] · L |

Standard profile select karne par section dimensions skip hote hain aur
`pieceKg = kgm × L(m)` use hota hai (app ke jaisa hi).

### 2.3 Frontend

* `frontend/src/pages/calculator/MetalCalculatorPage.jsx` — full screen:
  shape grid, by-weight/by-length, metric/imperial, metal + custom density,
  standard-profile picker + manual kg/m override, pieces, ₹/kg ya ₹/lb rate,
  result card, copy, per-browser history.
* Route: `/metal-calculator` (`App.jsx`), nav: **Masters → Metal Calculator**
  (sirf normal users ko dikhta hai; restricted operator/dept nav me nahi).
* History localStorage me hai (`utech.metalCalc.history`) — koi DB write nahi.

### 2.4 Tests

```bash
cd backend && npx vitest run tests/unit/metalCalculator.test.js tests/api/metalCalculator.api.test.js
```

22 unit + 7 API tests: har shape ka fixed vector, unit conversion, lb pricing,
profile table, weight→length, aur saare rejection cases (missing dimension,
plate par length mode, bar par profile, unknown metal/density/rate).

---

## 3. APK vs ERP: jaan-boojh kar kiya gaya deviation

| Point | APK | ERP | Kyun |
|---|---|---|---|
| π | `3.14` (round bar by weight), `3.1416` (pipe), `0.7854` (round bar by length) | exact `Math.PI` | APK ke apne do screens 0.05% different answer dete hain; ERP me weighing error nahi chahiye |
| Sheet | A × B × t | A × B × t | purane web port (`calc.ts`) me sheet ka last field length samajh liya jaata tha → `NaN`; yahan fix hai |
| Money | `DecimalFormat` display string | `decimal.js`, 2 dp half-up | invoice/quote ke saath consistent |
| Rounding | 2–3 dp strings | weights 3 dp, area 2 dp, money 2 dp | ERP ke `Decimal(14,3)` convention ke saath |
| Length mode | har screen par | sirf jin shapes ka length axis hai (sheet par nahi) | plate ka "length" ambiguous hai |

---

## 4. Kya bacha hai? (jo APK me hai, ERP me nahi)

Priority order me:

1. **Standard-profile values ki independent verification** — neeche section 5.
   Sabse zaroori kaam: 460 cross-region conflicts mile hain.
2. **Saved calculations ka server-side history** — APK `db_RecordsActivity` +
   delete-all SQLite me rakhta hai. ERP me abhi browser-localStorage hai
   (deliberate: koi migration/DB risk nahi). Chahiye to
   `MetalCalculation` Prisma model + `/api/metal-calculator/history` add karna
   easy hai.
3. **"ADD METAL" (custom metal list save karna)** — abhi per-calculation custom
   density daal sakte hain, list me save nahi hoti. Iske liye ek chhota master
   table chahiye.
4. **Share image / PDF** — APK result ka image share karta hai; ERP me clipboard
   copy hai. PDF chahiye to existing `pdfkit`/quotation template infra use kar
   sakte hain.
5. **Ads / Pro / rate-app / Crashlytics** — business feature nahi, port nahi kiya.
6. **`Whatsinpro` / `genel` (Arbitrary)** — custom/free-form shape screen ka
   pura behaviour smali me bikhra hua hai; hamare 11 shapes + manual kg/m se
   practical use cover ho jaata hai.

---

## 5. Standard-profile data: known limitation (important)

`standardProfiles.json` APK ke **apne** numbers hain, kisi independent standard
se verify kiye hue nahi. Quick audit:

* 97 region+family groups, 2925 profiles.
* 18 resource arrays ek se zyada region me reuse hote hain → **460 conflicts**:
  same designation, different kg/m. Example:
  * `EU / EN + BS 4` → IPE 80 = **6.0 kg/m** (sahi, EN 10365)
  * `Russia / GOST` → IPE 80 = **16.7 kg/m** (us activity ka table off-by-family hai)
* Kuch families me duplicate/truncated names hain (`ISMB 150` do baar,
  `ISHB 150*`, `M25*` type entries).
* Jo families internally sahi lagti hain (EU IPE/IPN/HEA/HEB, India ISMB/ISLB/ISWB)
  unke numbers standard tables se match karte hain; **par humne poora dataset
  verified nahi kiya**.

Isliye UI me:

* picker ke saath **manual "kg/m from your steel table"** field hamesha available
  hai (manual value table value ko override karti hai),
* result par `table <kg/m>` badge + note dikhta hai,
* nayee quotation/invoice me number daalne se pehle apne standard se cross-check
  karna hai.

Agla step (recommended): har family ko IS 808 / EN 10365 / ASTM A6 / JIS G3192 ke
published mass se compare karke `verified: true/false` flag add karna, aur
unverified families ko default me hide karna. Ye ek alag data-cleanup task hai;
tab tak manual kg/m hi safe raasta hai.

---

## 6. Reverse-engineering notes (dobara kaise karein)

```bash
# APK unpack + resources
python3 -c "import zipfile; zipfile.ZipFile('Metal Calculator (2).apk').extractall('apkout')"

# package / activities / manifest
pip install --break-system-packages androguard
python3 - <<'PY'
from androguard.core.apk import APK
a = APK('Metal Calculator (2).apk')
print(a.get_package(), a.get_androidversion_name(), a.get_activities())
PY

# arrays + strings (resources.arsc) — custom parser, androguard ka API is APK par fail karta hai
#   ResStringPool → ResTable → package → type chunks → entries
#   array entry = ResTable_map_entry: name(4) size(2) res0(1) type(1) data(4), type 0x03 = string index

# formulas: DEX me `const-wide` (decimal) ko double me convert karo
python3 -c "import struct; print(struct.unpack('<d', struct.pack('<Q', 4614256673094690983))[0])"  # 3.1416
```

DAD decompiler (`androguard.decompiler.DecompilerDAD`) se `onCreate`/`onClick`
padhna sabse fast hai; constants `const-wide vX, <decimal>` me aate hain —
`int(text, 16)` galat hai, base-10 hi hai.

`morluto/rea` aur `zhaoxuya520/reverse-skill` methodology/tooling repos hain —
inme APK-specific kuch nahi tha, isliye androguard + custom ARSC parser use kiya.

---

## 7. Run / verify

```bash
# backend
cd backend && npm ci
USE_IN_MEMORY_DB=1 NODE_ENV=development npm start     # :4000

# frontend
cd frontend && npm ci && npm run dev -- --host 0.0.0.0

# login: admin@utech.local / Admin@123 → Masters → Metal Calculator
```

API smoke test:

```bash
TOKEN=$(curl -s localhost:4000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@utech.local","password":"Admin@123"}' | jq -r .token)

curl -s localhost:4000/api/metal-calculator/calculate \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"shape":"roundbar","metal":"Steel","values":{"d":100,"L":1000},"pieces":2,"rate":70}'
```
