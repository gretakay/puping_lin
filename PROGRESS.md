# 開發進度總覽

快速掌握「現在做到哪裡、還缺什麼、修過哪些 bug」。架構決策與踩雷細節在 [MIGRATION.md](./MIGRATION.md)，這裡只放結論。

最後更新：2026-08-26（對應 commit `7be8295`）

## 目前狀態：已上線

- GitHub：https://github.com/gretakay/puping_lin
- Vercel：https://puping-lin.vercel.app
- 架構：前端 9 個 html 頁面 + `gas-polyfill.js` 全部部署在 Vercel；後端維持 Apps Script，透過 `/api/gas`（Vercel serverless proxy）以 JSON API 呼叫，白名單 31 個函式，密鑰放伺服器端環境變數，不暴露給瀏覽器。
- `/api/gas` 全路徑打通並實測過：白名單阻擋、密鑰驗證都有效；後端專用檔案在 Vercel 上是 404，沒被公開發布。

## 已完成

- [x] Step 1：後端加 `ApiRouter.js`（`doPost` + 白名單 + 密鑰驗證），不改動任何既有後端函式邏輯
- [x] Step 2：9 個 html 頁面接上 `gas-polyfill.js`，導覽列改用相對檔名而非 `getScriptUrl()`
- [x] Step 3：git repo 建立、GitHub 連 Vercel 自動部署（push 即部署，PR 自動出預覽網址）
- [x] `.claspignore` / `.vercelignore` 雙向排除設定完成，前後端檔案互不干擾
- [x] 資產數量「批次品項」相關的一連串 bug 修復（見下）

## 待處理

- [ ] **安全性**：`Notifications.js` 的 `sendLineNotify` 裡 LINE 金鑰目前有寫死在程式碼當備用值，已進 git 歷史。需要拿掉硬編碼、只留 Script Properties 讀取，並到 LINE Developers 撤銷重發舊 token。（[MIGRATION.md #11](./MIGRATION.md#11-已知但還沒處理line-金鑰寫死在程式碼裡)）
- [ ] 跨平台實機測試尚未全面覆蓋（桌機 Chrome/Edge/Safari、手機 Chrome(Android)/Safari(iOS)、LINE 內建瀏覽器）

## 修了什麼 bug

### 1. 部署階段：Node serverless function 把整個 Apps Script 專案弄掛（commit `a2422cb`）
`api/gas.js` 用了 `module.exports`，被 `clasp push` 一起推上 Apps Script 後，因為 GAS 沒有 `module` 這個東西，導致**整個專案**（包含原本正常的 `doGet` 開頁功能）噴 `ReferenceError`。修法：新增 `.claspignore`，只讓真正的 GAS 程式碼被 push。

### 2. 資產數量「一個編號＝一件」假設在批次品項上算錯（commit `8f932d1`，2026-08 抓蟲）
一般序號品項一列代表 1 件，但批次/超商模式品項一列代表一批數量，兩者共用同一個欄位（資產位置表第 14 欄）卻常被程式碼誤當同一種東西處理，一次抓到 4 處：

- `AssetOps.js` `withdrawItem`：借出時把第 14 欄直接寫死成 0，批次品項的數量因此消失
- `InventoryQuery.js` `getAvailableAssetsFull`：「借出中」狀態加總沒做 fallback，數量是 0 時直接從統計中消失
- `WorkflowPages.js` `executeAssetTransfer`：部分數量移轉用陣列切片分編號，批次品項切完後數量沒清空，變成「庫存摸不到」
- `withdraw.html`：判斷是否為批次品項用了購物車扣減後的剩餘量，同批次分兩次加入、加到剩 1 件時會被誤判成非批次

### 3. 歸還合併回庫存邏輯，共用版本改過但沒同步到另一份複製（commit `8f932d1`）
`AssetOps.js` 裡「找合併目標列」的邏輯有兩份：`findMergeTargetRow`（比對保管人，給移轉/入庫共用）和 `returnAsset` 自己另外寫的 `findMergeTargetRowInner`（原本沒比對保管人）。結果是歸還時合併回庫存沒有比對保管人，跟其他功能的行為不一致。已修正同步。

---
詳細架構、環境變數設定、驗證清單、完整踩雷記錄請看 [MIGRATION.md](./MIGRATION.md)。
