
/**
 * 🚀 一鍵匯出所有資料到 JSON (用於遷移到 Supabase)
 * 
 * 使用方法：
 * 1. 複製這段程式碼到你的 Google Apps Script 專案
 * 2. 執行 exportAllDataForSupabase()
 * 3. 查看執行記錄 (Ctrl+Enter) → 複製輸出的 JSON
 * 4. 儲存成 migration-data.json 檔案
 */

function exportAllDataForSupabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const exportData = {};
  
  // 1. 匯出 Staff
  Logger.log('📦 匯出 Staff...');
  const staffSheet = ss.getSheetByName('Staff');
  if (staffSheet) {
    exportData.staff = sheetToJSON(staffSheet);
    Logger.log(`✅ Staff: ${exportData.staff.length} 筆`);
  }
  
  // 2. 匯出 LocationSettings
  Logger.log('📦 匯出 LocationSettings...');
  const locSheet = ss.getSheetByName('LocationSettings');
  if (locSheet) {
    exportData.location_settings = sheetToJSON(locSheet);
    Logger.log(`✅ LocationSettings: ${exportData.location_settings.length} 筆`);
  }
  
  // 3. 匯出 CategoryRules
  Logger.log('📦 匯出 CategoryRules...');
  const catSheet = ss.getSheetByName('CategoryRules');
  if (catSheet) {
    exportData.category_rules = sheetToJSON(catSheet);
    Logger.log(`✅ CategoryRules: ${exportData.category_rules.length} 筆`);
  }
  
  // 4. 匯出 Donations
  Logger.log('📦 匯出 Donations...');
  const donSheet = ss.getSheetByName('Donations');
  if (donSheet) {
    exportData.donations = sheetToJSON(donSheet);
    Logger.log(`✅ Donations: ${exportData.donations.length} 筆`);
  }
  
  // 5. 匯出 Transactions_Consumables
  Logger.log('📦 匯出 Transactions_Consumables...');
  const tcSheet = ss.getSheetByName('Transactions_Consumables');
  if (tcSheet) {
    exportData.transactions_consumables = sheetToJSON(tcSheet);
    Logger.log(`✅ Transactions_Consumables: ${exportData.transactions_consumables.length} 筆`);
  }
  
  // 6. 匯出 Transactions_Assets
  Logger.log('📦 匯出 Transactions_Assets...');
  const taSheet = ss.getSheetByName('Transactions_Assets');
  if (taSheet) {
    exportData.transactions_assets = sheetToJSON(taSheet);
    Logger.log(`✅ Transactions_Assets: ${exportData.transactions_assets.length} 筆`);
  }
  
  // 7. 匯出 Transactions_Scrap
  Logger.log('📦 匯出 Transactions_Scrap...');
  const tsSheet = ss.getSheetByName('Transactions_Scrap');
  if (tsSheet) {
    exportData.transactions_scrap = sheetToJSON(tsSheet);
    Logger.log(`✅ Transactions_Scrap: ${exportData.transactions_scrap.length} 筆`);
  }
  
  // 8. 匯出所有 Asset_xxx sheets (合併成一個陣列)
  Logger.log('📦 匯出所有 Asset 位置...');
  const allSheets = ss.getSheets();
  const assetSheets = allSheets.filter(s => s.getName().startsWith('Asset_'));
  exportData.asset_locations = [];
  
  assetSheets.forEach(sheet => {
    const locationName = sheet.getName().replace('Asset_', '');
    const data = sheetToJSON(sheet);
    // 每筆資料加上 location_name 欄位
    data.forEach(row => {
      row.location_name = locationName;
    });
    exportData.asset_locations = exportData.asset_locations.concat(data);
  });
  Logger.log(`✅ Asset Locations: ${exportData.asset_locations.length} 筆 (來自 ${assetSheets.length} 個工作表)`);
  
  // 統計資訊
  Logger.log('\n📊 匯出統計：');
  Logger.log(`- Staff: ${exportData.staff?.length || 0} 筆`);
  Logger.log(`- LocationSettings: ${exportData.location_settings?.length || 0} 筆`);
  Logger.log(`- CategoryRules: ${exportData.category_rules?.length || 0} 筆`);
  Logger.log(`- Donations: ${exportData.donations?.length || 0} 筆`);
  Logger.log(`- Transactions_Consumables: ${exportData.transactions_consumables?.length || 0} 筆`);
  Logger.log(`- Transactions_Assets: ${exportData.transactions_assets?.length || 0} 筆`);
  Logger.log(`- Transactions_Scrap: ${exportData.transactions_scrap?.length || 0} 筆`);
  Logger.log(`- Asset_Locations: ${exportData.asset_locations?.length || 0} 筆`);
  
  // 方法 1: 輸出到執行記錄 (適合小量資料)
  Logger.log('\n\n========== 📋 複製以下 JSON 內容 ==========\n');
  Logger.log(JSON.stringify(exportData, null, 2));
  Logger.log('\n========== 📋 以上是完整 JSON ==========\n');
  
  // 方法 2: 建立可下載的文字檔 (適合大量資料)
  const jsonString = JSON.stringify(exportData, null, 2);
  const blob = Utilities.newBlob(jsonString, 'application/json', 'migration-data.json');
  const file = DriveApp.createFile(blob);
  
  Logger.log('\n\n🎉 已建立可下載檔案！');
  Logger.log('📁 檔案名稱: migration-data.json');
  Logger.log('🔗 下載連結: ' + file.getUrl());
  Logger.log('\n👉 點選上方連結 → 下載檔案 → 放到 c:\\Users\\greta.yen\\Desktop\\web\\ 資料夾');
  
  Logger.log('\n✅ 匯出完成！');
  
  return exportData;
}

/**
 * 將 Sheet 轉成 JSON 陣列 (第一列是 header)
 */
function sheetToJSON(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return []; // 只有 header 或空白
  
  const headers = data[0];
  const rows = data.slice(1);
  
  return rows.map(row => {
    const obj = {};
    headers.forEach((header, i) => {
      const value = row[i];
      
      // 處理日期格式
      if (value instanceof Date) {
        obj[header] = value.toISOString();
      } 
      // 處理空值
      else if (value === '' || value === null || value === undefined) {
        obj[header] = null;
      }
      // 一般值
      else {
        obj[header] = value;
      }
    });
    return obj;
  }).filter(obj => {
    // 過濾完全空白的列
    return Object.values(obj).some(v => v !== null && v !== '');
  });
}

/**
 * 🔧 測試用：只匯出前 5 筆資料 (檢查格式用)
 */
function testExportSample() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 只匯出 Donations 的前 5 筆當範例
  const donSheet = ss.getSheetByName('Donations');
  if (donSheet) {
    const sample = sheetToJSON(donSheet).slice(0, 5);
    Logger.log('📋 Donations 前 5 筆範例：');
    Logger.log(JSON.stringify(sample, null, 2));
  }
}

/**
 * 🔧 進階：直接產生 SQL INSERT 語句 (可選)
 */
function generateSQLInserts() {
  const exportData = exportAllDataForSupabase();
  
  Logger.log('\n\n========== 📋 SQL INSERT 語句 ==========\n');
  
  // 產生 Donations 的 INSERT 語句範例
  if (exportData.donations && exportData.donations.length > 0) {
    Logger.log('-- Donations INSERT 語句：\n');
    exportData.donations.forEach(row => {
      const values = [
        sqlEscape(row.Timestamp),
        sqlEscape(row.DonationDate),
        sqlEscape(row.DonorName),
        sqlEscape(row.ItemName),
        sqlEscape(row.Unit),
        row.StandardQuantity || 0,
        sqlEscape(row.Location),
        sqlEscape(row.Handler),
        sqlEscape(row.ExpiryDate),
        sqlEscape(row.PhotoUrl),
        sqlEscape(row.Category),
        sqlEscape(row.Color),
        sqlEscape(row.StockStatus),
        sqlEscape(row.AssignedGroup)
      ];
      
      Logger.log(`INSERT INTO donations (timestamp, donation_date, donor_name, item_name, unit, standard_quantity, location, handler, expiry_date, photo_url, category, color, stock_status, assigned_group) VALUES (${values.join(', ')});`);
    });
  }
  
  Logger.log('\n========== 📋 以上是 SQL ==========\n');
}

/**
 * SQL 字串跳脫
 */
function sqlEscape(val) {
  if (val === null || val === undefined || val === '') {
    return 'NULL';
  }
  if (val instanceof Date) {
    return `'${val.toISOString()}'`;
  }
  return `'${String(val).replace(/'/g, "''")}'`;
}

/**
 * ==========================
 * 資產編號計數器查詢工具
 * ==========================
 * 注意：依賴 Code.js 的 toSafePropertyKeyPart(s)
 */

/**
 * 查詢目前主號計數器使用到哪（例如 prefix=OTT, yearShort=26）
 */
function getAssetSerialUsage(prefix, yearShort) {
  const p = String(prefix || 'OTT').trim().toUpperCase();
  const y = String(yearShort || Utilities.formatDate(new Date(), 'GMT+8', 'yy')).trim();
  const key = 'asset_serial_' + toSafePropertyKeyPart(p) + '_' + toSafePropertyKeyPart(y);
  const current = Number(PropertiesService.getScriptProperties().getProperty(key)) || 0;

  return {
    success: true,
    key: key,
    prefix: p,
    yearShort: y,
    currentSerial: current,
    nextBaseId: p + y + String(current + 1).padStart(4, '0')
  };
}

/**
 * 查詢某主號的尾碼目前用到哪（例如 baseId=OTT260123）
 */
function getAssetSuffixUsage(baseId) {
  const main = String(baseId || '').trim();
  if (!main) {
    return { success: false, message: '請提供 baseId，例如 OTT260123' };
  }

  const key = 'asset_suffix_' + toSafePropertyKeyPart(main);
  const current = Number(PropertiesService.getScriptProperties().getProperty(key)) || 0;

  return {
    success: true,
    key: key,
    baseId: main,
    currentSuffix: current,
    nextAssetId: main + '-' + String(current + 1).padStart(2, '0')
  };
}

/**
 * 列出目前全部號碼計數器（主號/尾碼）供管理員檢視
 */
function listAssetCounterUsage() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const serial = [];
  const suffix = [];

  Object.keys(props).forEach(function (k) {
    const v = Number(props[k]) || 0;
    if (k.indexOf('asset_serial_') === 0) {
      serial.push({ key: k, currentSerial: v });
    } else if (k.indexOf('asset_suffix_') === 0) {
      suffix.push({ key: k, currentSuffix: v });
    }
  });

  serial.sort(function (a, b) { return a.key.localeCompare(b.key); });
  suffix.sort(function (a, b) { return a.key.localeCompare(b.key); });

  return {
    success: true,
    serialCount: serial.length,
    suffixCount: suffix.length,
    serial: serial,
    suffix: suffix
  };
}

/**
 * 直接執行：顯示主號/尾碼目前使用狀況（寫到執行記錄）
 */
function showAssetCounterUsageNow() {
  const serialInfo = getAssetSerialUsage('OTT');
  const allInfo = listAssetCounterUsage();

  const msg = {
    serialInfo: serialInfo,
    allInfo: allInfo
  };

  Logger.log(JSON.stringify(msg, null, 2));
  console.log(JSON.stringify(msg, null, 2));
  return msg;
}

/**
 * 直接執行：查指定主號尾碼目前用到哪（預設示例可自行改）
 */
function showAssetSuffixUsageNow() {
  const info = getAssetSuffixUsage('OTT260001');
  Logger.log(JSON.stringify(info, null, 2));
  console.log(JSON.stringify(info, null, 2));
  return info;
}
