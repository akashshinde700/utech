# U-Tech ERP: beginner ke liye guide

Yeh guide un logon ke liye hai jinhone pehle ERP use nahi kiya. Isme **store/inventory, purchase, production, dispatch aur invoice** ka seedha workflow diya hai. Pehle temporary demo par practice karein; live company data par experiment na karein.

> **Sabse important:** Invoice banane se stock nahi ghatta. Physical maal bhejne ke liye alag **Delivery Challan / Dispatch** banana padta hai. Customer ka diya hua material, company ke apne stock se alag rakha jata hai.

## 1. ERP aur zaroori shabd

ERP ek jagah par items, parties (customers/vendors), stock, orders aur bills ka record rakhta hai.

| Screen / shabd | Seedha matlab |
| --- | --- |
| **Item** | Company ka maal/raw material/finished product, jaise steel rod ya bracket. |
| **Party** | Customer (maal kharidne wala) ya vendor (maal dene/kaam karne wala). Ek party dono ho sakti hai. |
| **UOM** | Quantity ki unit: PCS, KG, MTR, etc. |
| **Opening stock** | System use shuru karte waqt physically available company stock. |
| **PO** | Purchase Order: vendor ko maal mangwane ka order. PO banne se stock nahi badhta. |
| **GRN** | Goods Receipt Note: aaya hua maal record karta hai. Sirf **accepted** quantity company stock me badhti hai. |
| **Stock ledger** | Har movement ki history: kitna aaya, gaya aur uske baad balance kya tha. |
| **BOM** | Bill of Materials: product banane me lagne wale materials ki list aur planned quantities. |
| **Jobwork** | Maal vendor ko process karne bhejna aur wapas aane ka record. |
| **Dispatch / Delivery Challan** | Physical company goods customer ko bhejne ka record; stock ghatta hai. |
| **Invoice** | Billing/GST ka document; apne aap physical stock nahi ghatata. |
| **Customer material lot** | Customer ki ownership wala maal jo aapke paas kaam ke liye aaya hai; company item stock se alag ledger. |

## 2. Login aur screen samajhna

1. Administrator se app ka URL aur apna user account lein; sign in karein. Demo ke liye neeche alag instructions hain.
2. Left sidebar me **Dashboard**, **Masters**, **Company Inventory**, **Customer Inventory**, **Stock Management**, **Sales** aur baaki sections hain. Section ke naam par click karke links kholein. Mobile par upar ka menu button use karein.
3. List me row par click karne se aksar uska detail page khulta hai. **New…** button se record banta hai. Form me `*` wale fields zaroori hain; galat field par message dekhein aur phir save karein.
4. Item/customer/vendor dropdown kholkar naam ya code type kar sakte hain. Bade catalog me kuch lists ko load hone me thoda samay lag sakta hai.
5. Agar koi link ya action na dikhe, ho sakta hai aapke role ke paas permission na ho. Admin se zaroori **read/create/update/delete** permission maangein. Browser me URL likhne se bhi backend permission check bypass nahi hota.

**Kaun kya kare?** Admin masters/permissions set kare; store team physical receipt/dispatch aur reconciliation kare; production team actual consumption de; accounts team invoice aur payments verify kare. Ek hi user sab kuch kar sakta hai, lekin real company me duty separation rakhna behtar hai.

## 3. Shuru karne se pehle master data

1. **Masters → Customers → New customer** ya **Masters → Vendors → New vendor**: party ka naam aur relevant type select karein. GST billing ke liye GSTIN, state aur contact details dhyan se bharein. Save karein.
2. **Company Inventory → Items → New item**: item name, UOM, category/type, minimum stock, purchase/sale rate, HSN aur GST rate zaroorat ke hisaab se bharein. `0%` GST valid hai; sirf sahi tax rate hi daalein.
3. **Opening Stock** me sirf go-live ke samay physically counted company quantity daalein. Item save karne par positive opening balance ka `OPENING` ledger entry banta hai. Naye maal ke liye baad me GRN use karein; baar-baar opening stock nahi badlein.
4. Jahan UOM/category pehle se na ho, admin se required reference data configure karwayein. **Min Stock** alert threshold hai, order karne ki automatic guarantee nahi.

Company stock aur ledger ki quantities maximum **3 decimal places** tak rakhein, jaise `2.125 KG`. Invoice payments paise tak, yani **2 decimal places** tak rakhein.

## 4. Stock dekhna aur correction karna

1. **Company Inventory → Items** par item ka current stock aur minimum dekhein.
2. **Stock Management → Stock Overview & Ledger** par summary aur **Stock Movement Ledger** dekhein. Owner, item search aur document-date filters se relevant history nikaalein. Latest 500 movements dikhaye jaate hain; bade/old histories ke liye filters use karein.
3. Ledger me `In` addition, `Out` deduction aur `Balance` us posting ke baad ki quantity hai. `Posted` timestamp posting order dikhata hai; filter document date par lagta hai. Backdated document ka document date aur posted time alag ho sakta hai.
4. Physical count me mismatch mile to usi page par **Manual Adjustment** form me item choose karein, signed adjustment quantity daalein (`+5` jaisa positive = badhao, `-3` = ghatao), reason/notes likhein, confirm karein. Ledger me `ADJUSTMENT` check karein. Insufficient stock par normal deduction reject hoti hai.
5. GRN ya dispatch ko adjustment se replace na karein: original business document banana traceability ke liye zaroori hai.

### Kaunsa action stock badalta hai?

| Action | Company item stock par effect |
| --- | --- |
| Positive opening stock | Badhta hai; opening entry banti hai. |
| Positive / negative stock adjustment | Utna badhta / ghatta hai. |
| PO banana ya approve karna | Koi change nahi. |
| GRN save | Catalog item ki **accepted** quantity badhti hai; rejected quantity nahi. Vendor-made free-text line ka catalog item stock nahi hota. |
| GRN cancel | Accepted quantity reverse hoti hai, linked PO ki received quantity bhi reverse hoti hai. Agar utna stock ab available nahi hai to cancellation **refuse** ho jata hai (kaun-kaun item short hai, wo message me dikhta hai). Sirf `stock.adjust` permission wala user explicitly "Reverse anyway" karke negative balance bana sakta hai — wo ledger me forced reversal ke roop me likha jata hai. |
| Company material jobwork issue | Bheji hui quantity ghat-ti hai; received aur physically returned rejected quantity wapas badhti hai. |
| Production batch complete | Saved actual raw-material consumption ghatta hai aur produced output item badhta hai. Planning alone stock nahi badalti. |
| Delivery Challan create | Challan quantity ghat-ti hai; eligible cancelled challan par wapas badhti hai. |
| Invoice create/payment | Company stock par koi change nahi; yeh billing/party ledger ke liye hai. |
| Purchase return process | Company stock ghat sakta hai; return document process hone par effect hota hai. |
| Sales return process | Sirf tab stock badhta hai jab **Physical Receipt** record ho chuka ho — return challan number + received date (+ optional dispatch challan). Iske bina process 400 dega. Dispatch challan link karne par quantity usi challan ki shipped quantity tak limited rehti hai. |
| Customer Material inward/consume/dispatch/return | **Customer lot ledger** badalta hai, company item stock nahi. |

## 5. Maal kharidna: PO se GRN tak

1. Vendor aur catalog item pehle banayein.
2. **Company Inventory → Purchase Orders → New PO** kholein; date, vendor aur item lines me quantity, rate aur GST check karke save karein. PO document stock increase nahi karta.
3. PO detail me authorized user **Approve** kare. Approval permissions aur maker-checker rule lagu hote hain; zaroorat par doosre authorized user se approve karayein.
4. PO detail se **Create GRN** use karein, ya **Company Inventory → GRN (Stock In) → New GRN** me PO choose karein. Linked vendor/PO items usi order se aate hain.
5. Physically arrived quantity aur rejected quantity fill karein. Accepted quantity ka calculation check karein: `received 8 − rejected 2 = accepted 6`. Lines aur vendor verify karke **Save** karein. Sirf accepted 6 stock me add honge. PO me partial receipts aur remaining quantity track hoti hai; PO quantity se zyada accepted receipt allowed nahi.
6. Items aur ledger me naya balance/`GRN` row verify karein. Agar receipt galat hai, GRN detail kholkar permission ke saath **Cancel GRN** aur reason use kar sakte hain. Agar received material already use/dispatch ho chuka hai to cancellation pehle **refuse** hoga (message me short items dikhte hain) — pehle stock adjustment karein, ya stock administrator se forced reversal karayein. Processed/dependent documents cancellation ko block kar sakte hain.

## 6. Maal bhejna aur bill banana alag steps hain

### A. Physical dispatch

1. Customer party aur company item available hon; item stock check karein.
2. **Sales → Dispatch → New dispatch** kholein. Customer, date, item, quantity aur zaroori transport details bharein. Vendor-only party dispatch customer nahi ho sakti.
3. Save karte hi dispatch quantity stock se ghat-ti hai. Ledger me `DISPATCH` aur list me status check karein. Sirf status **Delivered** karna alag se stock nahi ghatata.
4. Agar undelivered challan galat ban gaya, dispatch list me authorized user **Cancel dispatch** action use kare. Cancellation stock wapas karti hai (`DISPATCH_CANCEL`). Delivered challan ko is button se cancel nahi kar sakte; physical returns ke liye accounts/store procedure follow karein.

### B. Invoice aur payment

1. **Sales → Invoices → New Invoice** kholein. Customer, invoice/due date, item/description, quantity, rate, GST aur discount fill karein. Preview me taxable amount, tax, round-off aur total verify karein; phir **Save** karein.
2. Example: `2 × ₹100`, discount `₹0`, GST `18%` aur same-state supply par subtotal `₹200`, CGST `₹18`, SGST `₹18`, total `₹236`. Inter-state ke liye IGST `₹36` hoga. Application total nearest rupee round karti hai. Company state configuration aur customer/supply state tax ke liye sahi hone chahiye; tax advisor se actual GST treatment verify karein.
3. Invoice detail se **PDF** download/preview kar sakte hain. Payment milne par **Record Payment** me amount, date aur mode daalein. Payment amount outstanding se zyada ya 2 decimal se zyada na ho. Balance aur status verify karein.
4. Payment ya active return ke baad invoice edit/cancel par restrictions hain; accounts admin se correction/credit-note procedure follow karein.
5. Sirf invoice banane se dispatch record ya stock deduction nahi hota. Invoice aur dispatch ko operationally reconcile karna team ki zimmedari hai; system invoice line ko physical dispatch ka proof nahi maanta.

## 7. Production aur customer material

### Production batch

1. Zaroorat ho to **Company Inventory → Shifts** me shift configure karein; **Company Inventory → BOMs** me output product aur uske planned material quantities banayein. Job card/machine bhi relevant workflow ke hisaab se bana sakte hain.
2. **Company Inventory → Production Batches → New Batch** me date, shift, output item, planned quantity aur relevant BOM select karein. BOM consumption ko proposed planned quantities ki tarah check karein: **quantity ko output ke hisaab se automatic scale hua maan kar na chalein**.
3. Batch open karke **Start** karein. Actual material usage enter karein; unused material ke liye explicit `0` de sakte hain. Actual entries ko pehle **Save Changes** karein.
4. Good output ki produced quantity aur rejected quantity dhyan se enter karein, phir **Complete Batch**. System produced quantity ko stock me add karta hai aur saved actual consumption company stock se ghatata hai; rejected quantity output se automatic minus nahi hoti. Ledger dono taraf verify karein. Completed batch ki consumption edit nahi hoti.

### Customer ke maal ka inward aur jobwork

1. **Customer Inventory → Customer Material → New inward** me customer, material description, inward date, quantity, unit/location aur relevant item/job card fill karke save karein.
2. Lot detail me available quantity dekhein. **Consume**, **Dispatch** ya **Return** action tabhi karein jab woh physical action ho chuka ho. Har action customer lot ledger ghatata hai; company stock number change nahi hota.
3. Vendor ko process ke liye bhejna ho to **Customer Inventory → Vendor Dispatch (Jobwork) → New jobwork** me correct owner **Customer** aur sahi customer lot select karein. Company material ke liye owner **Company** choose karein. Vendor aur lines fill karke save karein.
4. Vendor se maal wapas aane par jobwork list me challan ke saamne **Receive** karein. Received aur rejected-but-physically-returned quantities relevant owner ke stock/lot me wapas aati hain. Partial receipt possible hai; total sent se zyada receive/reject nahi kar sakte. Physical count aur quality status alag se check karein.

## 8. Demo par ek poora practice example

Temporary demo me ek naya test item aur test customer/vendor bana kar yeh karein:

| Step | Action | Expected company stock |
| --- | --- | ---: |
| 1 | Item opening stock 10 | 10 |
| 2 | Adjustment +5, phir −3 | 12 |
| 3 | GRN received 8, rejected 2, accepted 6 | 18 |
| 4 | Dispatch 4 | 14 |
| 5 | Alag invoice banayein | 14 — invoice se stock change nahi |
| 6 | Undelivered dispatch cancel | 18 |
| 7 | GRN cancel, agar koi dependent document/return nahi hai | 12 |

Har step ke baad item aur `OPENING`, `ADJUSTMENT`, `GRN`, `DISPATCH`, `DISPATCH_CANCEL` aur reversal ledger rows check karein. Duplicate cancellation try karne par doosri baar stock change nahi hona chahiye. Demo me hi practice karein.

## 9. Technical setup: sirf developer/admin ke liye

### Temporary demo (data restart par mit jayega)

Node.js 20+ aur npm install hone chahiye. Repository ke `utech-repo` folder se do terminals kholein:

```bash
# Terminal 1: demo API, volatile in-memory data
cd backend
npm ci
USE_IN_MEMORY_DB=1 NODE_ENV=development COMPANY_STATE_CODE=27 npm start
```

```bash
# Terminal 2: web UI
cd frontend
npm ci
npm run dev -- --host 0.0.0.0
```

Vite jo URL print kare woh kholein. **Demo-only login:** `admin@utech.local` / `Admin@123`. Environment-variable syntax upar macOS/Linux ke liye hai; Windows PowerShell me `$env:USE_IN_MEMORY_DB='1'` etc. set karein. Ye temporary demo credentials/data real production me kabhi use na karein. API process restart se data reset hoga; sample invoices/party histories production-quality reconciliation data nahi hain.

### Real deployment

Real use ke liye MySQL database, safe secrets, backups, HTTPS, least-privilege users, configured company state/GST details aur migrations chahiye. Backend `.env.example` aur project setup instructions ko admin review kare. `USE_IN_MEMORY_DB=1` production ke liye nahi hai aur production mode me blocked hai. Seed script me sample/demo users aur records ho sakte hain: existing database par seed chalane se pehle script review karein. Roles/users aur live opening balances controlled process se provision karein; demo passwords replace karein.

### Automated checks

```bash
cd backend && npm run lint && npm test
# doosre terminal / repo root se:
cd frontend && npm run lint && npm test && npm run build
npm run test:e2e
```

Playwright E2E command isolated temporary in-memory API/UI start karta hai aur test data create karta hai. External server par E2E chalana destructive ho sakta hai: sirf **disposable** environment ko explicit `E2E_CONFIRM_DISPOSABLE=1` ke saath use karein; production par kabhi nahi.

## 10. Important limitations aur troubleshooting

- **Demo ≠ production proof:** automated browser checks temporary in-memory database par chale hain; real MySQL persistence, isolation aur simultaneous users ki race conditions verify nahi hui hain. Go-live se pehle real database par backup/restore, security, concurrency aur stock/account reconciliation test karayein.
- GRN cancel consumed stock ko reverse karke negative balance nahi banata — shortage par system refuse karta hai aur sirf explicit, audited override se negative ja sakta hai. Sales return process karne se pehle **Physical Receipt** (return challan number + received date) lazmi record karein; dispatch challan link karein to returned quantity shipped quantity se zyada nahi ja sakti.
- Other modules/selectors aur exceptional workflows ka end-to-end coverage complete nahi hai. Dashboard daily document counts me cancelled records bhi ho sakte hain; financial/physical reconciliation ke liye source documents dekhein.
- Dependency audit 2026-10-27 ko execute hua: backend aur frontend dono me **0 open advisories** (pehle 16 aur 21 the). `xlsx` hata kar `exceljs`, aur zod 4 / vitest 5 / vite 8 / axios / react-router 7 par upgrade kiya gaya hai. CI me `npm audit --audit-level=moderate` chalate rahein.
- **Button/link missing:** role permission aur document status check karein. **Insufficient stock:** company vs customer ownership, UOM, prior postings aur quantity check karein. **Dropdown me item nahi:** naam/code search karein; inactive records aur permissions check karein. **Login issue:** admin se account/password reset karayein.
- GST, invoicing, returns aur statutory compliance ka final review qualified accounts/tax professional kare; is guide ko legal/tax advice na maanein.
