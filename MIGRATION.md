# 前端搬遷 Vercel / 後端 JSON API 化 — 改法紀錄

本文件記錄「前端搬到 Vercel、後端留在 Apps Script 並改成 JSON API」這件事的架構決策與實際改動，供後續維護與繼續往下（Step 3：git repo + Vercel 部署）參考。

## 為什麼選這個架構

前端要呼叫後端有兩種常見做法：

1. **瀏覽器直接呼叫 Apps Script exec URL**：做法最簡單，但瀏覽器對 POST + JSON 會觸發 CORS 預檢（preflight），而 Apps Script Web App 沒有 `doOptions`，官方也沒有正式保證這件事的行為；雖然「用 `text/plain` 繞過預檢」是社群常見技巧，但仍是非官方行為，且金鑰只能放在前端原始碼裡（等於公開）。
2. **Vercel Serverless Proxy（採用此方案）**：瀏覽器只打自己網域下的 `/api/gas`，是 same-origin 請求，完全不會有 CORS 問題；真正呼叫 Apps Script 的動作發生在 Vercel 的伺服器端函式裡，金鑰可以放在伺服器環境變數，不會暴露給瀏覽器。跨平台（桌機/手機瀏覽器、LINE 內建瀏覽器）的行為因此不再依賴任何瀏覽器特定的 CORS 細節。

## 架構圖

```
瀏覽器（Vercel 靜態頁，9 個 html）
   │ google.script.run.withSuccessHandler(...).withFailureHandler(...).fn(args)
   │   ↑ 由 gas-polyfill.js 攔截，實際發出：
   │ fetch('/api/gas', { method: 'POST', body: JSON.stringify({ fn, args }) })
   ▼
Vercel Serverless Function  /api/gas.js（Node，same-origin，無 CORS）
   │ 帶密鑰做 server-to-server fetch
   ▼
Apps Script doPost(e)  ← ApiRouter.js
   │ 驗證密鑰 + 白名單 → globalThis[fn].apply(null, args)
   ▼
既有後端函式（InventoryQuery.js / AssetOps.js / WorkflowPages.js / Notifications.js / ...，完全不變）
```

## 新增 / 修改的檔案

| 檔案 | 狀態 | 說明 |
|---|---|---|
| `ApiRouter.js` | 新增 | Apps Script 端，`doPost(e)` + 31 個函式白名單 + 密鑰驗證 |
| `gas-polyfill.js` | 新增 | 前端相容層，模擬 `google.script.run` 語法，內部改打 `/api/gas` |
| `api/gas.js` | 新增 | Vercel Serverless Function，轉發請求到 Apps Script，密鑰藏在伺服器端 |
| `index.html` / `asset_entry.html` / `recent.html` / `near-expiry.html` / `transfer.html` / `withdraw.html` / `asset_return.html` / `inventory.html` / `stocktake-correction.html` | 修改 | 加入 `<script src="./gas-polyfill.js">`；導覽（TopNav）不再透過 `getScriptUrl()` 取部署網址，改用相對檔名（如 `inventory.html`） |
| `AppRouter.js` | 未動 | `doGet` 頁面路由維持原樣，Apps Script 直接開頁功能不受影響 |

**沒有改動任何一個既有後端函式的邏輯**——`ApiRouter.js` 只是在外面加一層 JSON 派發，實際執行的還是 `InventoryQuery.js`、`AssetOps.js`、`WorkflowPages.js`、`Notifications.js` 等既有函式。

## 呼叫點盤點（全部 9 個 html、49 處呼叫，一個不漏）

第一輪只找到 8 個檔案（`stocktake-correction.html` 因檔案裡有特殊字元被搜尋工具誤判為二進位檔而漏掉），第二輪用強制文字模式重新掃描後補上，現在已用程式交叉比對確認：**白名單裡的 31 個函式，每一個都至少被一處呼叫；9 個 html 檔案裡的每一處 `google.script.run` 呼叫，也都能對應到白名單裡的函式**，沒有遺漏也沒有多餘項目。

| 函式 | 呼叫的頁面 |
|---|---|
| `warmUpSummaryCache` | index.html |
| `addDonationFast` | index.html |
| `updatePhotoInBackground` | index.html |
| `getLocationList` | asset_entry.html |
| `searchAssetForRestock` | asset_entry.html |
| `updateAssetPhotoInBackground` | asset_entry.html |
| `importAssetFast` | asset_entry.html |
| `getRecentDonationsLite` | recent.html |
| `getNearExpiryLite` | near-expiry.html |
| `searchTransferCandidates` | transfer.html |
| `executeAssetTransfer` | transfer.html |
| `getTransferLocationList` | transfer.html |
| `getLocationData` | withdraw.html, asset_return.html |
| `setNineGridTarget` | withdraw.html |
| `getWithdrawInventory` | withdraw.html, asset_return.html |
| `getWithdrawAssets` | withdraw.html |
| `getDataVersion` | withdraw.html, inventory.html |
| `withdrawItem` | withdraw.html |
| `getBorrowedAssets` | withdraw.html, asset_return.html |
| `returnAsset` | asset_return.html |
| `getScrapDetails` | inventory.html |
| `syncAssetSheetLocationsAndCaches` | inventory.html |
| `hardRefreshAllCachesAndIndexes` | inventory.html |
| `getInventoryDetails` | inventory.html |
| `getRecentActivity` | inventory.html |
| `getAssetsDetails` | inventory.html |
| `exportInventoryToHtml` | inventory.html |
| `exportTransactionHistoryByRange` | inventory.html |
| `getInventoryCorrectionData` | stocktake-correction.html |
| `setStocktakeLock` | stocktake-correction.html |
| `applyStocktakeCorrections` | stocktake-correction.html（呼叫 2 次：手動回寫、匯入回寫） |

另外原本有 **10 處**呼叫 `getScriptUrl()`（每個頁面的導覽列各 1 處，`asset_return.html` 因為多了一個沒被用到的 `safeRedirect()` helper 所以是 2 處），全部移除——這件事在 Vercel 上不需要 API：Apps Script 的 `?page=xxx` 是靠 `doGet` 動態出圖，Vercel 上每個頁面是獨立的靜態檔案，導覽列直接改成相對檔名連結（如 `href="inventory.html"`）即可，不用多打一次 API。`getScriptUrl` 因此**沒有**被放進白名單。

## 密鑰與環境變數

兩邊要填同一組密鑰，密鑰本身**不會**寫進程式碼或 git：

- **Apps Script 端**：在 Apps Script 專案「Script Properties」設定 `API_SECRET`
- **Vercel 端**：專案環境變數設定 `GAS_EXEC_URL`（部署後的 Web App exec 網址）與 `API_SECRET`（跟上面同一組值）

這兩組設定會在 Step 3（git repo + Vercel 部署）實際動手時一起處理。

## 已知行為差異

- 原本 `google.script.run` 若省略 `.withFailureHandler(...)`，失敗時 Apps Script 會跳系統警示框；`gas-polyfill.js` 省略時改成 `console.error` 記錄，不會跳警示框。目前程式碼裡大部分呼叫都有接 `withFailureHandler`，只有 `near-expiry.html` 的 `getNearExpiryLite` 這一處沒接，行為上差異很小（原本也只是提示載入失敗）。
- 導覽列連結從 `?page=xxx`（同一個網址切換 query string）改成 `xxx.html`（切換到不同靜態檔案），使用者體感上沒有差異，但技術上是真的換頁而不是同一頁面重新渲染。

## 驗證清單

**已經做過、不需要真的部署就能確認的：**
- ✅ 白名單 31 個函式，跟 9 個 html 實際呼叫的函式做過雙向交叉比對，互相對應、沒有遺漏
- ✅ 白名單 31 個函式，每一個在 `.js` 後端檔案裡都有對應的 `function` 宣告
- ✅ `api/gas.js` 用 Node 搭配假的 `fetch` 做過測試：環境變數缺失會回 500、正常請求會正確帶密鑰轉發並設定 `redirect: 'follow'`、非 POST 方法回 405、缺 `fn` 參數回 400

**需要實際部署後才能做的（沒有 Apps Script / Vercel 帳號權限，無法代勞）：**
1. `clasp push` 把 `ApiRouter.js` 部署上去，並在 Script Properties 設定 `API_SECRET`，取得 Web App exec URL
2. 在 Vercel 專案設定 `GAS_EXEC_URL`、`API_SECRET` 環境變數（或本機 `vercel dev` + `.env.local`）
3. 實際點過 9 個頁面的每一個功能，不只看 network tab 回 200，要核對資料真的正確寫回 Sheet、有收到 LINE／Email 通知
4. 跨平台檢查（same-origin fetch 理論上各平台一致，但建議至少過一次）：桌機 Chrome/Edge/Safari、手機 Chrome(Android)/Safari(iOS)、LINE App 內建瀏覽器
5. 部署完成、有測試網址後，可以請我用 `curl` 幫忙驗證 `/api/gas` 的白名單阻擋、密鑰驗證等後端行為是否符合預期

## Step 3：git repo + Vercel 部署

### 已完成

- 本機 `git init`，已建立第一個 commit（`4ee9bac`），內容是這次搬遷的全部改動
- 新增 `.gitignore`（排除 `node_modules/`、`.vercel/`、`.env*`）
- 新增 `.vercelignore`：排除 Apps Script 後端專用檔案（9 支 `.js` 後端邏輯、`appsscript.json`、`.clasp.json`、`MIGRATION.md`），避免這些檔案被 Vercel 當成公開靜態檔案發布出去。後端還是完全走 `clasp push` 部署，跟 Vercel 無關。

### 選定方式：GitHub + Vercel 自動部署

決定用「push 到 GitHub → Vercel 連接該 repo 自動部署」的方式，之後每次 `git push` 都會自動重新部署，PR 也會自動產生預覽網址。

### 接下來需要使用者操作的部分（沒有 GitHub/Vercel 帳號權限，無法代勞）

1. 到 GitHub 建立一個新的**空**repository（不要勾選自動產生 README/`.gitignore`/LICENSE，因為本機已經有內容了）
2. 把新 repo 的網址（例如 `https://github.com/<your-account>/<repo-name>.git`）告訴我，或自行執行：
   ```
   git remote add origin https://github.com/<your-account>/<repo-name>.git
   git push -u origin master
   ```
3. 到 [vercel.com](https://vercel.com) 用同一組 GitHub 帳號登入，選「Add New Project」→ 選剛剛那個 repo → Framework Preset 選「Other」（純靜態 + `/api` serverless function，不需要建置指令）
4. 在 Vercel 專案的 Environment Variables 設定：
   - `GAS_EXEC_URL`：Apps Script Web App 部署後的 exec 網址
   - `API_SECRET`：跟 Apps Script Script Properties 裡同一組密鑰
5. Deploy，拿到 Vercel 給的網址後即可實際測試（見上方「驗證清單」）
