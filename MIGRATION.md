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

### 執行結果（已完成）

- GitHub：https://github.com/gretakay/puping_lin
- Vercel：https://puping-lin.vercel.app
- 實測 `/api/gas` 全路徑打通（Vercel → Apps Script `doPost` → 白名單 → 真實函式 → 回傳資料），白名單阻擋機制也驗證有效
- 後端專用檔案（`ApiRouter.js`、`appsscript.json`、`.clasp.json` 等）在 Vercel 上都是 404，沒有被公開發布

---

## 踩過的雷與注意事項（下次做類似專案直接看這段）

這次「前端搬 Vercel、後端留 Apps Script、混合放在同一個 repo」的過程中，實際踩到幾個坑，記下來下次可以直接避開，不用重新踩一次。

### 1. `clasp push` 會把整個資料夾都當成 Apps Script 專案的一部分推上去

只要資料夾裡有 `.js` 檔案，`clasp push` 預設就會推上去，**不會自動分辨這是不是 GAS 程式碼**。這次 `api/gas.js`（Vercel 的 Node serverless function，裡面用了 `module.exports`）就這樣被一起推上 Apps Script，因為 GAS 環境沒有 `module` 這個東西，直接讓**整個專案掛掉**——不是只有新加的 API 壞掉，連原本好好的 `doGet`（開頁功能）都一起噴 `ReferenceError`。

原因是 Apps Script 專案裡所有檔案共用同一個全域作用域，只要有一個檔案在頂層（不是函式裡面，是檔案最外層）丟出錯誤，整個專案都執行不了。

**下次怎麼做：** 混合 repo（前端 Vercel + 後端 GAS 放同一個資料夾）**一開始寫程式碼之前**就先建好 `.claspignore`，把不屬於 GAS 的東西（Node serverless functions、純前端 JS、`.md` 文件等）排除掉，不要等出事才補。跟 `.vercelignore` 剛好是相反的兩份清單，新增檔案時要想清楚它該不該被排除在某一邊。

### 2. 改了 `.claspignore` 之後，`clasp push` 可能顯示「已經是最新」但其實沒有真的清掉舊檔案

第一次沒有 `.claspignore` 就 push 過一次之後，就算後來補上 `.claspignore` 把某些檔案排除，直接再下一次 `clasp push` 有可能顯示 `Script is already up to date`，完全沒有動作——遠端那個壞掉的檔案還在，不會因為本機不再追蹤它就自動被清掉。

**下次怎麼做：** 改了 ignore 規則之後，順手在某一個「還會被追蹤」的檔案裡加一行小改動（哪怕只是一行註解），逼 `clasp push` 偵測到真正的內容差異、觸發一次完整推送，才能讓被排除的檔案真的從遠端消失。之後可以再把那行小改動拿掉或留著都沒差。

### 3. Apps Script 的「部署」是釘住版本號的，`clasp push` 不會自動讓已發布的部署更新

`clasp push` 只會更新專案的 HEAD（最新程式碼），但正在給別人用的那個「部署」（Deployment）是釘住某個版本號的快照，不會自動跟著更新。這次線上在用的部署明明 HEAD 都修好了，網址還是照樣噴同一個錯誤，因為那個部署還停在舊版本。

**下次怎麼做：** 改完後端程式碼要生效，兩步都要做：
```
clasp push                          # 更新 HEAD 程式碼
clasp deploy -i <deploymentId>      # 把「正在使用中」的那個部署更新到新版本
```
`<deploymentId>` 用 `clasp deployments` 查，**不要用猜的**去組 `/exec` 網址——`clasp deployments` 列出的項目不一定每個都是「網頁應用程式」類型，猜錯會得到很難懂的 Google Drive 錯誤頁面，反而更難判斷問題出在哪。最準的做法是直接到 Apps Script 編輯器「管理部署作業」頁面複製官方顯示的網址。

### 4. 剛部署完馬上測試，可能還會看到舊的錯誤（邊緣快取延遲）

`clasp deploy` 完馬上用 curl／瀏覽器打 exec 網址，有時候還是會看到修改前的結果，等個幾十秒到一分鐘左右重試就正常了。看到「怎麼還是壞的」不用急著懷疑是不是哪個步驟做錯，先等一下再測一次。

### 5. 測試 `doPost` 不要用 `curl -L --post302 --post303` 硬保留 POST

Apps Script Web App 對 POST 請求的實際運作方式是：先在 `/exec` 執行完 `doPost`、把結果算好，然後用 302 轉址到 `script.googleusercontent.com/macros/echo?...` 這個網址，而**這個轉址目標只接受 GET**，用意是去把「已經算好的結果」取回來，不是要你把同一個 POST 再打一次。

如果手動用 curl 測試，用預設轉址行為就好（POST 打第一段、轉址時讓它自動變成 GET），不要加 `--post302`/`--post303` 硬要保留 POST 方法，否則會拿到 `405`、`411` 之類看起來莫名其妙的錯誤，浪費時間排查。如果是透過瀏覽器 `fetch` 或 Node 內建 `fetch`（`redirect: 'follow'`），這件事完全不用自己處理，兩者都是照 WHATWG fetch 規範自動做對的，這也是為什麼最後改成直接測真正會用到的 `/api/gas` 反而一次就成功。

### 6. GAS 其實本來就會自動加 CORS 標頭

debug 過程中意外發現，就連 `doPost` 的 302 轉址回應都帶了 `Access-Control-Allow-Origin: *`。這印證了「瀏覽器直接連 Apps Script」技術上其實可行，這次選 Vercel Proxy 主要是為了把密鑰藏起來、不依賴這個平台細節，而不是因為直連完全行不通。

### 7. 用文字搜尋工具盤點呼叫點時，留意某些檔案可能被誤判成二進位檔而跳過

第一輪找 `google.script.run` 呼叫點時，`stocktake-correction.html` 因為檔案裡有某個特殊字元，被 ripgrep 判定成二進位檔，整個檔案的搜尋結果直接消失，害第一輪盤點漏了一整個檔案（9 個頁面漏成 8 個）。後來是刻意重新用強制文字模式（`grep -a`）全部檔案重新掃一次、並寫程式交叉比對「白名單函式 ⟷ 實際呼叫」兩個方向都要對上，才抓出這個遺漏。

**下次怎麼做：** 盤點呼叫點這種「一個都不能漏」的工作，不要只信任單一次搜尋結果——用兩種方式（例如一般搜尋 + 強制文字模式搜尋）互相對照，或事後寫個小腳本雙向交叉比對數量，才保險。

### 8. 部署設定檢查清單（下次可以直接照著走）

1. `clasp push` 前先確認 `.claspignore` 排除了所有非 GAS 檔案（`clasp status` 看 Tracked files 對不對，不該出現前端/Node 專用檔）
2. `clasp deployments` 確認「正在使用中」的部署 ID
3. `clasp push` → `clasp deploy -i <id>`
4. 先用瀏覽器手動開 exec 網址，確認 `doGet` 沒有噴錯（最快的整體健康檢查，比直接測 `doPost` 更快抓到「整個專案掛掉」這種問題）
5. 再測 `doPost`，但要透過真正會用到的呼叫路徑（例如 Vercel proxy 或瀏覽器 fetch），不要自己用 curl 硬組轉址邏輯
6. Vercel 環境變數（`GAS_EXEC_URL`、`API_SECRET`）跟 Apps Script Script Properties 的 `API_SECRET` 要完全一致
7. 確認 `.vercelignore` 有把後端檔案排除（用 curl 打 Vercel 網址 + 後端檔名，應該回 404）

### 9. 資產數量欄位有個共通病根：「一個編號＝一件」的假設，在批次品項上會踩雷（2026-08 抓蟲記錄）

資產位置表的第 14 欄（初始數量）在系統裡其實有兩種完全不同的用法，但很多地方沒意識到這件事：

- **一般序號品項**：一列一個編號，代表 1 件，第 14 欄理論上等於 1
- **批次/超商模式品項**：一列一個編號，但代表一批數量（例如同一種紙膠帶 10 卷共用一個編號），第 14 欄是真正的數量來源，不能用「這列有幾個編號」去推算

問題出在：只要有程式碼假設「這列的編號數量＝這列的實際數量」（例如硬把第 14 欄設成 0、用陣列切片 `ids.slice(0, qty)` 去分編號、或加總時對某個狀態不做 fallback），只要遇到批次品項就會算錯，而且往往要等使用者回報「數字對不起來」才會發現。這次一口氣在四個地方抓到同一個病根：

1. `AssetOps.js` 的 `withdrawItem`：借出單一編號的列時把第 14 欄直接寫死成 0，不管原本數量是多少
2. `InventoryQuery.js` 的 `getAvailableAssetsFull`：「借出中」狀態的加總沒有像其他狀態一樣做 fallback，數量一旦是 0 就直接消失在統計裡
3. `WorkflowPages.js` 的 `executeAssetTransfer`：部分數量移轉時用陣列切片分編號，批次品項切完編號會被清空但數量沒清空，庫存變成「摸不到」
4. `withdraw.html` 前端：判斷「這是不是批次品項」用了購物車扣減後的剩餘量，同一批次分兩次加入、加到剩 1 件時會被誤判成非批次

**下次怎麼做：** 之後只要改到「借用/歸還/移轉/入庫」這幾支檔案裡任何一段會動到資產數量或編號的邏輯，先確認清楚是不是在假設「一個編號＝一件」——特別是看到 `ids.length`、`ids.slice(...)`、或是把第 14 欄直接寫成固定值的地方，都要想一下「如果這是批次品項會怎樣」。

### 10. 同一段邏輯複製了兩份，只修了一份——`returnAsset` 的合併回庫存邏輯

`AssetOps.js` 裡「歸還時合併回同品項同位置的在庫列」這段邏輯，其實有兩份幾乎一樣的實作：一份是給移轉、入庫等功能共用的 `findMergeTargetRow`（有比對固定保管人），另一份是 `returnAsset` 自己另外寫的 `findMergeTargetRowInner`（原本沒有比對保管人）。因為是兩份獨立的程式碼，共用版本修過的邏輯不會自動套用到 `returnAsset` 自己那份，這也是這次「歸還合併沒比對保管人」那個 bug 的直接成因。

**下次怎麼做：** 看到某段邏輯（尤其是像「找合併目標列」這種帶多個比對條件的查詢）在專案裡出現第二份幾乎一樣的實作時，優先考慮改成呼叫同一份共用函式，而不是各自維護——不然任何一邊修正、加條件、改行為，都要記得回頭同步另一邊，非常容易漏掉。

### 11. 已知但還沒處理：LINE 金鑰寫死在程式碼裡

`Notifications.js` 的 `sendLineNotify` 裡，`LINE_CHANNEL_ACCESS_TOKEN` 和 `LINE_GROUP_ID` 目前有寫死在程式碼裡當備用值，等於這組金鑰已經進了 git 歷史紀錄。之後找時間應該要：把這段硬編碼拿掉、只留 Script Properties 讀取，並到 LINE Developers 把舊 token 撤銷重發，避免外洩風險。
