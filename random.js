/** 🚀 自動隱藏超過 7 天的捐贈紀錄 */
function autoHideOldDonations() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Donations"); // 👈 請確保名稱與您的分頁一致
  const data = sheet.getDataRange().getValues();
  
  const today = new Date();
  today.setHours(0, 0, 0, 0); // 正規化時間為今日凌晨
  
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(today.getDate() - 7); // 計算出 7 天前的日期
  
  // 從第 2 列開始跑（跳過標題列）
  for (let i = 1; i < data.length; i++) {
    const donationDate = new Date(data[i][1]); // 👈 假設日期在 B 欄 (Index 1)
    
    // 如果日期格式有效，且早於 7 天前
    if (donationDate instanceof Date && !isNaN(donationDate)) {
      if (donationDate < oneWeekAgo) {
        // 隱藏該行 (i+1 是因為陣列從 0 開始，Excel 從 1 開始)
        sheet.hideRows(i + 1);
      } else {
        // 🚀 重要：如果是 7 天內的，確保它是「顯示」狀態
        // 避免之前被誤隱藏的資料看不見
        sheet.showRows(i + 1);
      }
    }
  }
  console.log("✅ 超過 7 天的舊資料已自動隱藏");
}

/** 🚀 自動歸檔維護系統 (保留 3 個月資料) */
function autoArchiveMaintenance() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();
  
  // 設定基準日：3個月前
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - 3);

  // --- A. 處理固定資產異動紀錄 (Transactions_Assets) ---
  const assetTransSheet = ss.getSheetByName(TRANS_ASSETS_NAME);
  if (assetTransSheet) {
    const data = assetTransSheet.getDataRange().getValues();
    if (data.length > 1) {
      const headers = data.shift();
      const toKeep = [headers];
      const toArchive = [];

      data.forEach(row => {
        const transDate = new Date(row[0]); // 第一欄(A)：日期
        const status = String(row[3]);      // 第四欄(D)：狀態 (借出/歸還)
        
        /**
         * 搬移條件：
         * 1. 紀錄日期超過 3 個月
         * 2. 且 狀態不是「借出中」(確保尚未歸還的資產紀錄留在主表)
         */
        if (transDate < cutoffDate && status !== "借出中") {
          toArchive.push(row);
        } else {
          toKeep.push(row);
        }
      });

      if (toArchive.length > 0) {
        appendArchiveData("Archive_Assets_History", headers, toArchive);
        assetTransSheet.clearContents();
        assetTransSheet.getRange(1, 1, toKeep.length, toKeep[0].length).setValues(toKeep);
      }
    }
  }

  // --- B. 處理十方供養物入庫與存量 (Donations) ---
  const donationSheet = ss.getSheetByName(SHEET_NAME);
  if (donationSheet) {
    const data = donationSheet.getDataRange().getValues();
    if (data.length > 1) {
      const headers = data.shift();
      const toKeep = [headers];
      const toArchive = [];

      data.forEach(row => {
        const entryDate = new Date(row[0]);  // 第一欄(A)：入庫時間戳記
        const quantity = Number(row[2]);     // 第三欄(C)：剩餘數量
        const expiryDate = new Date(row[3]); // 第四欄(D)：保存期限
        
        /**
         * 搬移條件：
         * 1. 入庫時間超過 3 個月
         * 2. 且 (數量已經用完為 0 OR 效期已經過期)
         */
        const isOldEnough = entryDate < cutoffDate;
        const isFinishedOrExpired = (quantity <= 0 || expiryDate < now);

        if (isOldEnough && isFinishedOrExpired) {
          toArchive.push(row);
        } else {
          toKeep.push(row);
        }
      });

      if (toArchive.length > 0) {
        appendArchiveData("Archive_Donations_History", headers, toArchive);
        donationSheet.clearContents();
        donationSheet.getRange(1, 1, toKeep.length, toKeep[0].length).setValues(toKeep);
      }
    }
  }
}

/** 輔助工具：批次寫入歸檔分頁 */
function appendArchiveData(sheetName, headers, rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let archiveSheet = ss.getSheetByName(sheetName);
  
  if (!archiveSheet) {
    archiveSheet = ss.insertSheet(sheetName);
    archiveSheet.appendRow(headers);
    archiveSheet.setFrozenRows(1);
    archiveSheet.getRange(1, 1, 1, headers.length).setBackground("#f3f3f3").setFontWeight("bold");
  }
  
  // 使用 setValues 提高寫入效能
  archiveSheet.getRange(archiveSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}
