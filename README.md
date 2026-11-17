# LedgerPulse — Personal AI Finance & Spending Tracker

**LedgerPulse** is a local-first **Windows Desktop Application** for personal financial tracking and spending intelligence. It stores 100% of your financial ledger locally on your Windows PC and automatically pulls, deduplicates, categorizes, and audits transactions from Apple Pay / card webhook notifications, a local watched receipt & statement folder (`data/inbox/`), uploaded CSV/PDF statements, receipt images, and manual cash logs—without requiring cloud database storage or Google Cloud OAuth.

---

## Core Capabilities & Features

### 1. Multi-Source Transaction Collection & Multimodal Receipt OCR
- **Multi-Channel Ingestion**: Consolidates financial activity from **Gmail** (receipts, bills, subscription notices), **Bank & Credit Card Statements**, **Apple Pay** notifications, **Uploaded Statements**, and **Cash / Manual** entries.
- **Drag-and-Drop Receipt Image & PDF OCR**: Drop or paste PNG, JPG, WEBP, HEIC receipt photos or multi-page PDF invoices directly into the **Collect & Reconcile** modal. Multimodal Vision OCR transcribes line items, tax, tip, merchant details, payment tender, and exact total charged—complete with a one-click sample thermal receipt generator for instant testing.
- **Quick Add Floating Speed-Dial**: Log physical cash purchases or one-off income payouts from anywhere on the dashboard in seconds, automatically routing records and deduplicating against existing ledger entries.

### 2. Cross-Source Deduplication & Accounting Integrity
- **Zero Double-Counting**: Detects when the same real-world purchase appears across multiple channels (e.g., Gmail order receipt + Apple Pay tap notification + posted credit card statement) and merges them into a single verified ledger entry with an expandable **Cross-Source Provenance Audit** drawer.
- **Strict Record Separation**: Distinguishes **Posted** vs. **Pending** authorizations, tracks **Refunds** separately to offset gross purchase spend, records **Income** deposits, and excludes internal **Account Transfers** from spending totals.
- **Verbatim Amounts Only**: Uses exact transaction amounts rather than estimates and never fabricates missing records.

### 3. Automated 16-Category Classification & Uncertain Queue
- **16 Standardized Categories**:
  - `Food & Restaurants` · `Coffee & Drinks` · `Groceries` · `Shopping & Retail`
  - `Transportation / Uber / Taxi` · `Gas & Parking` · `Bills & Utilities` · `Rent & Housing`
  - `Travel & Hotels` · `Entertainment` · `Health & Fitness` · `Subscriptions`
  - `Personal Care` · `Shopping Online` · `Education` · `Other / Uncategorized`
- **Uncertain Classification Queue**: Ambiguous merchant descriptors (such as multi-department retailers or generic payment processor tags) are surfaced for one-click user confirmation instead of guessing silently.

### 4. Unified Transaction Ledger & Automated Merchant Logos
- **Automated Merchant Favicon & Logo Service**: Resolves company domains from merchant names and raw descriptors (stripping POS prefixes like `SQ *`, `TST*`, and `APL*`), fetching and caching company icons via `/api/merchant-logo` with clean monogram and semantic icon fallbacks.
- **Fast Search & Multi-Facet Filtering**: Filter transactions instantaneously by merchant/descriptor search query, date window (Today, Last 7 Days, Full Month, Custom Date Range), spending category, payment method, and record classification.

### 5. Monthly Category Budgets & Utilization Tracking
- **Per-Category Spending Limits**: Configure custom monthly budgets across all 16 categories inline or via batch editing, persisted locally in `localStorage`.
- **Visual Threshold Alerts**: Progress bars with an 80% warning marker automatically highlight categories **Approaching Limit (80%–99%)** in amber and **Exceeded (100%+)** in rose.

### 6. Subscriptions Tracker & Automated Vigilance Alerts
- **Recurring Commitments**: Tracks monthly subscriptions, annual memberships, and recurring utility bills with normalized monthly and estimated annual costs.
- **Automated Price-Hike & Inactivity Alerts**: Flags recurring subscriptions whose billing amount increased compared to prior cycles as well as subscriptions inactive for more than 3 months (90+ days), with direct actions to acknowledge or mark for cancellation.

### 7. Personal Savings Goals & Cash Allocation
- **High-Yield Vault Tracking**: Create and manage savings goals with target amounts, target dates, priority tiers, destination accounts, quick deposit logging (`+$100` / `+$250`), and live calculation of unallocated monthly net cash flow surplus.

### 8. Daily, Weekly & Monthly Financial Reports + Cash Flow Forecast
- **Daily Report**: Itemized transaction log and exact daily purchase total for any selected date.
- **Weekly Report**: 7-day spending totals, category share breakdown, biggest purchases, and unusual/high-variance transactions.
- **Monthly Statement & Projected Cash Flow Chart**: Full executive cash flow summary (gross spend, refunds, net spend, verified income, net cash flow, recurring expenses, Top 10 merchants, month-over-month comparison, and savings opportunities) paired with an interactive SVG **Projected Monthly Cash Flow & End-of-Month Balance Forecast** chart supporting trend scenarios and simulated unused-subscription cancellation.

### 9. AI Spending Insights & Dual Light / Dark Theme
- **Diagnostic Pillars & Live Audit**: Highlights top spend categories, unusual purchases, increasing MoM patterns, duplicate authorizations, forgotten subscriptions, and interactive natural-language ledger audits.
- **Light & Dark Mode**: Persistent dual-theme interface synced with `localStorage`, iOS status bar `theme-color`, and OS `prefers-color-scheme` with zero initial paint flash.

### 10. Windows Desktop Application, 100% Local PC Storage & Automated Data Pull
- **One-Click Windows Desktop Launcher**: Double-click `start-windows-app.bat` on Windows 10/11 to launch the local engine and open LedgerPulse in a dedicated chromeless desktop window (`--app` mode), or install directly to your Windows Start Menu & Taskbar.
- **Three-Tier Local PC Storage**:
  1. **Native Windows File System Linking (`Ctrl+S` / `Ctrl+O`)**: Link any `.json` file on your PC (e.g., `Documents\LedgerPulse\my-ledger.json`) via the File System Access API so every edit auto-writes directly to your chosen file.
  2. **Automatic Local Disk Vault (`data/local-ledger-vault.json`)**: Every transaction, category confirmation, budget update, subscription change, and savings deposit is automatically persisted on disk by the local server (`GET` / `POST /api/local-vault`).
  3. **Browser Local Cache**: Instantaneous offline fallback in `localStorage`.
- **Automated Background Data Pull (Zero Cloud OAuth Required)**:
  - **Apple Pay & Card Notification Webhook (`/api/apple-pay/webhook`)**: Receives automated transaction payloads and queues them locally in `data/apple-pay-queue.json`.
  - **Local Watched Drop-Folder (`data/inbox/`)**: Drop `.eml` email receipts, `.csv` bank exports, `.pdf` statements, or receipt images into `data/inbox/`—background auto-pull extracts exact amounts, **auto-posts high-confidence matches** (deduplicating against existing entries), **flags uncertain items** for review, and archives processed files to `data/inbox/processed/`.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide Icons, Vite
- **Backend**: Node.js, Express (`server.ts`), TypeScript (`tsx`)
- **AI & Multimodal OCR**: `@google/genai` SDK (structured JSON schema extraction for receipt Vision OCR, statement parsing, and financial audit insights)

---

## Project Structure

```text
├── start-windows-app.bat               # One-click Windows 10/11 desktop app launcher
├── index.html                          # App entry HTML + pre-paint theme initialization
├── server.ts                           # Express API + local disk vault + watched inbox & webhook engine
├── package.json                        # Scripts and dependencies
├── .env.example                        # Required environment variable template
├── data/                               # Git-ignored local PC storage directory (created automatically)
│   ├── local-ledger-vault.json         # Automatic local disk ledger database
│   ├── apple-pay-queue.json            # Queued incoming Apple Pay / card webhook notifications
│   └── inbox/                          # Watched folder for .eml receipts, CSVs, PDFs & images
└── src/
    ├── App.tsx                         # Main Windows desktop workspace, local vault sync & navigation
    ├── index.css                       # Typography, Tailwind CSS v4 setup & custom dark variant
    ├── types/finance.ts                # Core TypeScript models & 16 spending categories
    ├── data/sampleFinanceData.ts       # Multi-source sample ledger, subscriptions, budgets & goals
    ├── utils/
    │   ├── financeMetrics.ts           # Net spend, MoM delta, subscription alerts & ranking calculations
    │   └── merchantLogo.ts             # Merchant brand normalization & domain inference
    └── components/
        ├── WindowsVaultAndSyncPanel.tsx # Local PC file linking (Ctrl+S/O), Windows install & Auto-Pull bar
        ├── RunningSummaryGrid.tsx      # 8-metric executive running summary strip
        ├── UncertainQueuePanel.tsx     # Interactive category confirmation banner
        ├── SubscriptionAlertsPanel.tsx # Price increase & 3+ month inactivity alert banner
        ├── CategoryBudgetDistribution.tsx # Category spend & budget utilization progress bars
        ├── TransactionLedgerTable.tsx  # Searchable, filterable ledger with provenance drawer
        ├── SubscriptionsTracker.tsx    # Recurring bills, memberships & annual cost table
        ├── SavingsGoalsSection.tsx     # Savings vaults & monthly surplus allocation
        ├── FinancialReportsSection.tsx # Daily, Weekly & Monthly financial statements
        ├── ProjectedCashFlowChart.tsx  # Interactive SVG end-of-month cash flow forecast chart
        ├── SpendingInsightsView.tsx    # 6 diagnostic insight pillars & live AI ledger audit
        ├── IngestSourceModal.tsx       # Drag-and-drop Receipt/PDF OCR & manual entry modal
        ├── QuickAddFloatingMenu.tsx    # Floating quick-add menu for cash & one-off income
        └── MerchantLogo.tsx            # Resilient company favicon/logo avatar with fallback
```

---

## How to Run Locally

### Prerequisites
- **Node.js** `v20+` (Node `v22.6+` recommended if running `npm start` directly)
- **npm** (or `bun` / `pnpm`)
- A **Gemini API Key** (required for live Receipt/PDF Vision OCR and live AI Audit queries; all dashboard analytics, filtering, budgets, cash flow forecasting, and merchant favicons work out of the box)

### 1. Clone the Repository
```bash
git clone <YOUR_GITHUB_REPO_URL>
cd ledgerpulse-personal-finance-tracker
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Copy `.env.example` to `.env` and add your API key:
```bash
cp .env.example .env
```

Edit `.env`:
```env
GEMINI_API_KEY="your_actual_api_key_here"
APP_URL="http://localhost:3000"
```

### 4. Launch on Windows 10 / 11
- **Option A (One-Click Windows App Window)**: Double-click **`start-windows-app.bat`** in Windows Explorer. It automatically creates `data\inbox\`, starts the local server, and opens LedgerPulse in a standalone native Windows app window.
- **Option B (Terminal)**:
```bash
npm run dev
```
Open **`http://localhost:3000`** in Microsoft Edge or Chrome (click **Install Windows App** in the top bar or the address bar install icon to pin LedgerPulse to your Windows Start Menu and Taskbar).

### 5. Typecheck & Build for Production
```bash
# Run TypeScript static type validation
npm run lint

# Build optimized production client assets into dist/
npm run build

# Run the production server (serve dist/ + Express API on port 3000)
NODE_ENV=production npm run dev
```

---

## Server API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/local-vault` | Reads the user's persisted local ledger vault (`data/local-ledger-vault.json`) from disk |
| `POST` | `/api/local-vault` | Writes updated transactions, budgets, subscriptions, and savings goals to local PC disk |
| `GET` | `/api/auto-pull/status` | Returns pending counts for queued Apple Pay notifications and `data/inbox/` files |
| `POST` | `/api/auto-pull/sync` | Drains Apple Pay webhook queue + `data/inbox/` receipts/CSVs/PDFs, deduplicates, and archives processed files |
| `POST` | `/api/apple-pay/webhook` | Local webhook endpoint for incoming Apple Pay / card transaction alerts |
| `POST` | `/api/apple-pay/simulate` | Queues a sample Apple Pay alert locally to test end-to-end automated ingestion |
| `POST` | `/api/local-inbox/drop-sample` | Writes a sample `.eml` receipt into `data/inbox/` to test watched-folder ingestion |
| `POST` | `/api/finance/parse-source` | Multimodal Vision OCR & raw text parser for receipt images, PDFs, alerts, and CSV statements |
| `POST` | `/api/finance/audit-insights` | Grounded spending audit and natural-language Q&A over verified ledger figures |
| `GET` | `/api/merchant-logo?domain=...` | Cached merchant favicon/logo resolver with multi-provider fallback |
