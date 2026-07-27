# Contract Management PRD — CLAUDE.md

## Project goal
Convert the Streamlit contract management app into a proper web app:
- **Backend**: FastAPI (Python) — handles Azure AD auth + OneLake/Delta Lake read/write
- **Frontend**: React (Vite) — same Aurora mesh gradient theme as Streamlit version

## Stack
- **Backend**: FastAPI + uvicorn, `deltalake`, `pandas`, `pytz`, `python-dotenv`
- **Frontend**: React 19 + Vite 6, Tailwind CSS v3, TypeScript (tsx), framer-motion, clsx, tailwind-merge
- **UI components**: `src/components/ui/` — BackgroundGradientAnimation, MagneticButton, GradientBackground
- **Storage**: Microsoft Fabric OneLake via Delta Lake
- **Auth**: Azure AD client credentials → bearer token, cached 3000s

## Status: COMPLETE
All components built and tested end-to-end. Full flow works: load → fill form → save → row flash → OneLake write.

## Project structure
```
02.contract_management_streamlit_prd/
├── backend/
│   ├── main.py              # FastAPI app — COMPLETE
│   ├── requirements.txt     # Python deps
│   ├── .env                 # Azure AD secrets (gitignored)
│   ├── .env.example         # Template (TENANT_ID, CLIENT_ID, CLIENT_SECRET)
│   ├── .gitignore
│   └── .venv/               # Python virtual env
├── frontend/
│   ├── public/
│   │   └── loading_wizard.png   # (kept but unused — replaced by CSS spinner)
│   ├── src/
│   │   ├── index.css            # Global styles — Tailwind directives + Sora font
│   │   ├── main.jsx             # React entry point
│   │   ├── App.jsx              # Main app — BackgroundGradientAnimation wrapper
│   │   ├── App.module.css       # Layout, toast, error screen styles
│   │   ├── lib/
│   │   │   └── utils.ts         # cn() = clsx + tailwind-merge
│   │   ├── services/
│   │   │   └── api.js           # Axios calls to FastAPI — all 6 endpoints
│   │   └── components/
│   │       ├── ui/
│   │       │   ├── background-gradient-animation.tsx  # Mouse-interactive mesh gradient bg
│   │       │   ├── magnetic-button.tsx                # framer-motion magnetic effect
│   │       │   └── gradient-background.tsx            # Animated gradient background
│   │       ├── LoadingOverlay.jsx        # Pure CSS spinner overlay
│   │       ├── LoadingOverlay.module.css
│   │       ├── ContractForm.jsx          # Form — MagneticButton on Save
│   │       ├── ContractForm.module.css
│   │       ├── ContractTable.jsx         # Table — filters, resize, Export CSV
│   │       └── ContractTable.module.css
│   ├── tailwind.config.js   # Tailwind v3 + animation keyframes
│   ├── postcss.config.js    # PostCSS for Tailwind
│   ├── tsconfig.json        # TypeScript config (supports .tsx alongside .jsx)
│   ├── index.html           # Sora font imported here
│   └── package.json
├── icon/
│   └── loading_wizard.png   # Source snowman wizard PNG
├── skill/
│   └── skill_weekly_update.md   # Weekly update skill definition
├── setup/
│   └── create_weekly_update.py  # SharePoint sync script (msal + openpyxl)
├── weekly update/
│   └── Purchase Dashboard_Project summary.xlsx  # Local copy of SP weekly update file
├── app.py                   # Old Streamlit app (reference only)
└── requirements.txt         # Old Streamlit deps (reference only)
```

## How to run

### Backend
```bash
cd backend
.venv/Scripts/activate   # Windows
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm run dev   # starts at http://localhost:5173
```

---

## Backend — FastAPI

### Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status-options` | Returns 7 purchaser status strings |
| GET | `/api/contracts` | Loads `gold_contract_management` (5 min cache) |
| GET | `/api/doc-numbers` | Loads `purchasing_doc_no` from `silver_sap_tct_header` (5 min cache) |
| GET | `/api/status` | Returns `_status_df` in-memory cache (loaded once, never expires) |
| GET | `/api/status/refresh` | Force-reloads `gold_manual_contract_status` from OneLake, updates cache |
| POST | `/api/status` | Updates cache immediately → writes OneLake in background thread |

### CORS
Allows `http://localhost:5173`, `http://localhost:5174`, `http://localhost:3000`

### In-memory caching architecture
Four independent caches, each with a `threading.Lock`:
- `_token_cache` — Azure AD bearer token, 3000s TTL
- `_contracts_cache` — gold_contract_management data, 5 min TTL
- `_docnums_cache` — silver_sap_tct_header doc numbers, 5 min TTL
- `_status_df` — gold_manual_contract_status as a pandas DataFrame, never auto-expires; updated on every POST and force-reloaded by `/api/status/refresh`

### Save flow (read-before-write queue — since 2026-07-27, replaces Option A)
1. Acquire `_status_lock`; update `_status_df` optimistically (prepend new row, drop old row for same `purchasing_doc_no`); return `{"ok": True, "update_at": now_str}` immediately (~490ms)
2. Enqueue ONLY the new row onto `_write_queue`; a single FIFO daemon worker processes jobs in order
3. Worker per job: **re-reads the CURRENT table from OneLake** → drops only that doc's row → appends the new row → `write_deltalake(mode="overwrite")` → replaces `_status_df` with the merged result (cache converges to table)
4. `_status_df` also has a 5-min TTL (like `_contracts_cache`) so GET /api/status picks up rows written by other writers (email-button function) without manual refresh

**Why (incident 2026-07-22, Delta v191):** the old flow dumped the whole in-memory cache over the table; a save from a stale cache wiped 2 rows the email-button function had written (docs 3110000188/3110000193, restored from v190). Never write the whole cache — always merge against a fresh read.

**Why full overwrite, not MERGE**: Delta MERGE requires multiple OneLake round-trips over HTTPS and proved ~14s on this unpartitioned small table — slower than full overwrite at ~8s.

### Critical: timestamp_ntz schema
`update_at` column in `gold_manual_contract_status` is `timestamp_ntz` (timezone-naive).
Must use `datetime.now(bkk).replace(tzinfo=None)` — a Python `datetime` object, not a string.
After `pd.concat`, always cast: `df["update_at"] = pd.to_datetime(df["update_at"])`.
All string columns: `fillna("").astype(str)` before writing.

### OneLake tables
| Table | Usage |
|-------|-------|
| `gold_contract_management` | Master contract list — read only |
| `gold_manual_contract_status` | Purchaser status entries — read/write |
| `silver_sap_tct_header` | Source of `purchasing_doc_no` list — read only |

### Columns in gold_manual_contract_status
- `purchasing_doc_no` — primary key (string)
- `user_status` — from email alerts, never overwritten by the form
- `purchaser_status` — 7-option dropdown
- `comment` — free text
- `new_purchasing_doc_no` — เลขสัญญาใหม่ (digits only)
- `update_at` — `timestamp_ntz`, Bangkok time, stored as timezone-naive datetime

---

## Frontend — React

### Theme — Aurora Mesh Gradient
- Background: `BackgroundGradientAnimation` component — 5 animated blobs, mouse-interactive, dark dim veil overlay
- Font: **Sora** (loaded in `index.html`)
- Panels: purple-navy glass `rgba(30,27,60,0.82)` + `backdrop-filter: blur(24px)` + subtle inset highlight
- Inputs/Select: dark fill `rgba(15,12,35,0.6)` + slate border
- Input text: `#e2e8f0` (slate-200) — easy on eyes
- Labels: sky blue `#7dd3fc`
- Button Save + Export CSV: gradient cyan `#06b6d4` → purple `#a855f7` + **MagneticButton** (framer-motion)
- Title gradient: white → cyan → purple (shimmer, 2.2rem)
- Section headers: 1.25rem gradient; column headers: 0.75rem sky blue `#7dd3fc`

### App.jsx — progressive loading strategy
- Show UI after fast endpoints respond (status + options, ~1-2s); spinner disappears then
- Heavy data (contracts, doc numbers from OneLake) loads in background after UI is shown
- `docNumbersLoading` prop to `ContractForm` shows a skeleton while doc list loads
- On save: update `statuses` state immediately (optimistic); API writes concurrently
- Flash: `flashedDocNo` + `flashTick` passed to `ContractTable`; incrementing `flashTick` on each save remounts the flashed `<tr>` key → CSS animation restarts
- Toast: 3.5s auto-dismiss, `clearTimeout` prevents stacking

### LoadingOverlay
Pure CSS spinner (no image dependency):
- Dual-color `border` ring: `border-top-color: #06b6d4` (cyan), `border-right-color: #a855f7` (purple)
- `will-change: transform` for GPU compositing
- 0.75s linear spin

### ContractForm
- **DocSearch** sub-component: searchable combobox backed by `docNumbers` string array from `silver_sap_tct_header`
- Filters on substring match; shows up to 50 results + "+N more" hint
- Dropdown closes on outside click (mousedown listener)
- On doc selection: pre-fills form from `existingStatuses` or defaults `purchaserStatus` to `options[0]` (matches Streamlit `index=0`)
- `user_status` from existing row is preserved on save — never overwritten by the form

### ContractTable
- Custom `<table>`, no library
- Columns: Doc No | Contract Name | User Status | Purchaser Status | Comment | เลขสัญญาใหม่ | Updated At
- `findNameCol()` auto-detects contract name column by keywords: `['name', 'contract', 'desc', 'short', 'text']`
- Date format: `String(val).substring(0, 16)` — shows `YYYY-MM-DD HH:MM`, strips seconds
- Row flash: `.flashRow` CSS animation `#FFE3E1 → transparent` over 6s; key includes `flashTick` to remount on each save
- Empty state: centered message when no statuses loaded
- "↺ Refresh data" button calls `onRefresh` → `refreshStatus()` → force OneLake reload via `/api/status/refresh`
- **Resizable columns**: drag handle on right edge of each `<th>`; min width 60px; stored in `colWidths` state
- **Column filters**: second sticky `<thead>` row — text input (substring) for Doc No/Name/Comment/etc; dropdown (exact) for User Status/Purchaser Status; active filter count badge + clear-all pill
- **Vertical scroll**: `max-height: 60vh`, both headers rows sticky (`position: sticky`)
- **Export CSV button**: `MagneticButton` with same gradient as Save; exports `filteredRows` with BOM (Thai-safe in Excel); filename `contract_status_YYYY-MM-DD.csv`

### API service (`src/services/api.js`)
```js
getContracts()          // GET /api/contracts         → contract[]
getDocNumbers()         // GET /api/doc-numbers        → string[]
getStatus()             // GET /api/status             → status[] (from cache)
refreshStatus()         // GET /api/status/refresh     → status[] (force OneLake reload)
getOptions()            // GET /api/status-options     → string[]
saveStatus(entry)       // POST /api/status            → { ok, update_at }
```

---

## Production Deployment — Azure Container Apps

### Live URL
`https://cman-contract-app.bravegrass-bdff920e.southeastasia.azurecontainerapps.io`

### Azure Resources
| Resource | Name | Notes |
|----------|------|-------|
| Subscription | `CMAN Azure Subscription` | |
| Resource Group | `CMAN-CONTRACT-MNGT-WEB-RG` | Region: Southeast Asia |
| Container Registry | `cmancontractregistry` | Basic tier, `cmancontractregistry.azurecr.io` |
| Container App | `cman-contract-app` | 0.5 CPU, 1Gi memory, Consumption plan |
| Container App Environment | `cman-contract-env` | |
| Docker image | `cmancontractregistry.azurecr.io/cman-contract-app:latest` | |

### Architecture — single container
- **Stage 1** (Dockerfile): Node 20 builds React → `dist/`
- **Stage 2** (Dockerfile): Python 3.12 runs FastAPI + serves React `dist/` as static files from `backend/static/`
- Single port `8000` serves both API (`/api/*`) and frontend (`/`)
- `VITE_API_URL` is empty in production → frontend calls same origin, no CORS needed

### Environment variables set in Container App
- `TENANT_ID` — Azure AD tenant
- `CLIENT_ID` — Azure AD app client ID
- `CLIENT_SECRET` — Azure AD app client secret

### CI/CD — GitHub Actions
File: `.github/workflows/deploy.yml`
- Triggers on every push to `main`
- Logs into ACR using GitHub secrets `ACR_USERNAME` + `ACR_PASSWORD`
- Builds Docker image → pushes `cman-contract-app:latest` to ACR
- Container App must be manually restarted or set to pull latest on revision (see below)

### GitHub Secrets required
| Secret | Value |
|--------|-------|
| `ACR_USERNAME` | `cmancontractregistry` |
| `ACR_PASSWORD` | ACR admin password (stored in OneLake) |

### Redeploy after GitHub push
After GitHub Actions pushes a new image, force the Container App to pick it up:
- Azure Portal → `cman-contract-app` → **Revision management** → **Create new revision** → Save
- Or: Portal → Container → Edit container → change image tag to force restart

### Authentication — @chememan.com only (DONE 6-May-26)
Azure AD Easy Auth configured on the Container App:
- Identity provider: Microsoft (Workforce / Single tenant)
- App registration: `cman-contract-app` in `chememan.com` Azure AD
- Restrict access: Require authentication
- Unauthenticated: HTTP 302 redirect to Microsoft login
- **Status**: Admin consent granted ✓ (adminnc, arthids, ittipolu, pratool)

### .gitignore additions for deployment
- `frontend/node_modules/`, `frontend/dist/` — never committed
- `backend/.env` — secrets stay local / in OneLake
- `.dockerignore` excludes `.venv/`, `node_modules/`, `.env` from Docker build context

---

## Dev → Production Deploy Checklist

1. **แก้ code + ทดสอบ local** — `localhost:5173` (frontend) + `localhost:8000` (backend)
2. **Push to GitHub**
   ```bash
   git add .
   git commit -m "your message"
   git push origin main
   ```
3. **GitHub Actions builds automatically** — รอ ~5-10 min, ดูที่ GitHub → Actions tab → ต้องเห็น ✅
4. **Force redeploy on Azure** — Portal → `cman-contract-app` → Revision management → **Create new revision** → Create
5. **Test production URL** — `https://cman-contract-app.bravegrass-bdff920e.southeastasia.azurecontainerapps.io`

---

## Data Architecture Decision — Web → OneLake

### Current pattern (keep this)
```
Web → FastAPI → OneLake (Delta Lake) directly
```

### Why direct to OneLake is correct for this app
- Data is written one record at a time (not concurrent bulk writes)
- Already using Microsoft Fabric / Power BI — no extra pipeline needed
- Simple = easy to maintain, low cost

### When to switch to Azure SQL first
- >20 concurrent users saving at the same time
- Need ACID transactions (rollback on failure)
- Complex real-time JOINs across multiple tables
- Full audit log required on every change

### Standard Microsoft Fabric stack (for larger systems)
```
Azure SQL (operational DB) → Fabric Pipeline (sync hourly) → OneLake Gold → Power BI
```
Not needed for internal tools at this scale.

---

## Known gotchas

### React blank page on prop mismatch
If App.jsx passes a prop to a component but the component doesn't destructure it, the variable is `undefined` in JSX → `ReferenceError` → React unmounts entire tree → blank page.
Always verify destructured props match what the parent passes.

### Delta MERGE vs overwrite
MERGE is slower than overwrite for small unpartitioned tables over HTTPS OneLake. Do not switch back to MERGE.

### CORS port mismatch
Vite may pick port 5174 if 5173 is taken. `main.py` CORS list includes both. If adding a new dev port, add it to `allow_origins`.

### Cold start save latency
POST responds fast always (~490ms); on a cold-start save the just-saved row may take ~1-8s to appear for OTHER viewers (background worker read+write), and the saver's own UI shows it instantly (optimistic state). This is expected.

### Dual writers on gold_manual_contract_status (residual race — accepted)
TWO systems write this table: this backend (queue worker, read-merge-write) and the email-confirm Azure Function (`c:\02.contract_management_email_button`, direct read-merge-write per click). Each re-reads before writing, but a simultaneous write pair within the same few-second window is still last-writer-wins for the whole table (one row can revert). Accepted at current scale; recoverable via Delta time travel (see incident 2026-07-22, v190/v191). Long-term fix if it ever bites again: make the function call `POST /api/status`-style endpoint on the web backend so the queue worker is the SOLE writer. Never reintroduce full-cache dumps.

---

## Purchaser Status options
```
Not Start
RFQ - Request for Quotation
Compared
RL - Recommend Letter
OA Created
Cancel OA
Completed
```

---

## Weekly Update — SharePoint Sync

### Script
`setup/create_weekly_update.py` — run anytime to sync task status to SharePoint.

```bash
backend\.venv\Scripts\python.exe setup\create_weekly_update.py
```

### How it works (same pattern as 04.budget_management_web)
1. Download current SharePoint file → read existing rows (incl. colleague tasks)
2. Upsert local `ROWS` by Action name — local wins on conflict, colleague-only rows preserved
3. Rebuild fresh Excel with formatting (alternating rows, color-coded types, frozen header)
4. Save locally to `weekly update/Purchase Dashboard_Project summary.xlsx`
5. Upload to SharePoint via Microsoft Graph API (MSAL client credentials)

### SharePoint target
- Site: `chememan.sharepoint.com/teams/CMANDigitalTechnology`
- Folder: `General/05 Data Analytics/03 Project/2.Purchase/02_Contract Management`
- File: `Purchase Dashboard_Project summary.xlsx`

### Auth
Uses same `TENANT_ID` / `CLIENT_ID` / `CLIENT_SECRET` from `backend/.env`.
App needs `Sites.ReadWrite.All` permission in Azure AD (already granted).

### Skill trigger
Say "update weekly update" / "push weekly update" / "sync weekly update" →
Claude updates ROWS in the script then runs it.

### Current task list (as of 6-May-26)
| Action type | Action | Status | Cut-off |
|---|---|---|---|
| Development | FastAPI Backend | Done | 6-May-26 |
| Development | React Frontend | Done | 6-May-26 |
| Development | Azure Container Apps Deployment | Done | 6-May-26 |
| Development | GitHub Actions CI/CD | Done | 6-May-26 |
| Development | Export Data - Download Button on Web | In Progress | 15-Jun-26 |
| Project Settings | Azure AD Easy Auth | Done | 6-May-26 |
| Project Settings | Weekly Update Skill | Done | 6-May-26 |

---

## Planned features

### Export Data — Download Button on Web
- User clicks Export CSV button in ContractTable header to download filtered rows
- Status: **Done**, deployed 9-May-26
- Implemented client-side in `ContractTable.jsx` — no new API endpoint needed
- BOM prefix ensures Thai characters display correctly in Excel
- Exports only filtered rows; filename includes date `contract_status_YYYY-MM-DD.csv`
