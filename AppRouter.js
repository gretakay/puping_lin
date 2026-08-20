/**
 * Web App router entrypoint for .js-only deployments.
 */
function doGet(e) {
	// 一鍵效期處理連結：優先攔截 action=expiry
	if (e && e.parameter && e.parameter.action === 'expiry') {
		return handleExpiryAction(e);
	}

	const page = (e && e.parameter && e.parameter.page) || 'index';
	try {
		return HtmlService.createTemplateFromFile(page).evaluate()
			.setTitle('普平資糧功德海暨資產管理系統')
			.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
			.addMetaTag('viewport', 'width=device-width, initial-scale=1');
	} catch (err) {
		return HtmlService.createHtmlOutput('頁面不存在：' + page);
	}
}

function include(filename) {
	return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getScriptUrl() {
	return ScriptApp.getService().getUrl();
}

const SHEET_NAME = 'Donations';
const TRANS_CONSUMABLES_NAME = 'Transactions_Consumables';
const TRANS_ASSETS_NAME = 'Transactions_Assets';
const TRANS_SCRAP_NAME = 'Transactions_Scrap';
const TRANSFER_REQUESTS_NAME = 'TransferRequests';
const STOCKTAKE_LOG_NAME = 'StocktakeLog';
const STAFF_SHEET_NAME = 'Staff';
const LOC_SHEET_NAME = 'LocationSettings';
const NOTIFICATION_QUEUE_NAME = 'NotificationQueue';
const ASSET_PREFIX = 'Asset_Location_';
const ASSET_INDEX_KEY = 'asset_index_v1';
const BORROWED_ASSET_INDEX_KEY = 'borrowed_asset_index_v1';
const ASSET_LOCATION_INDEX_NAME = 'AssetLocationIndex';
const MAIN_ROOT_FOLDER_ID = '1S4dzBSJQpkKHcg6jQ5Kg1JY8DJrmIIls';

let _assetLocationSheets = {};

function normalizeLocationKey(name) {
	return String(name || '').replace(/^Asset_Location_/i, '').trim();
}

function getSheet(name) {
	const ss = SpreadsheetApp.getActiveSpreadsheet();
	let sheet = ss.getSheetByName(name);
	if (!sheet) {
		sheet = ss.insertSheet(name);
		initializeSheetHeaders(sheet, name);
	}
	return sheet;
}

function initializeSheetHeaders(sheet, name) {
	let headers = [];
	let bgColor = '#3b82f6';

	switch (name) {
		case TRANS_SCRAP_NAME:
			headers = ['日期', '類型', '品名', '編號', '數量', '經手人', '說明', '位置', '參考行'];
			bgColor = '#ef4444';
			break;
			case TRANSFER_REQUESTS_NAME:
				headers = ['紀錄時間', '移轉單號', 'Request ID', 'Token ID', '資產編號', '品名', '舊位置', '新位置', '移轉數量', '原因', '操作人', '驗證帳號', '狀態', '錯誤碼', '錯誤訊息', '完成時間'];
				bgColor = '#0f766e';
				break;			case STOCKTAKE_LOG_NAME:
				headers = ['校正時間', '資產編號', '物品名稱', '位置', '帳面量', '實盤量', '差異量', '原因', '操作者', '校正前狀態', '校正後狀態'];
				bgColor = '#7c3aed';
				break;		case SHEET_NAME:
			headers = ['Timestamp', 'DonationDate', 'DonorName', 'ItemName', 'Unit', 'StandardQuantity', 'Location', 'Handler', 'ExpiryDate', 'PhotoUrl', 'Category', 'Color', 'StockStatus'];
			bgColor = '#10b981';
			break;
		case TRANS_CONSUMABLES_NAME:
			headers = ['紀錄時間', '異動類型', '物品名稱', '數量', '領用人', '狀態', '經手人', '備註'];
			bgColor = '#f59e0b';
			break;
		case TRANS_ASSETS_NAME:
			headers = ['日期', '交易類型', '品名', '編號', '數量', '借用/歸還者', '物品狀態A', '受理人', '物品狀態B'];
			bgColor = '#8b5cf6';
			break;
		case STAFF_SHEET_NAME:
			headers = ['FullName(姓名/法名)', 'Email', 'Role(角色/職稱)', 'ReceiveTransAlert(接收異動通知)', 'ReceiveOverdueAlert(接收逾期警示)', 'IsAdmin(是否為系統管理員)', 'Note(備註)'];
			bgColor = '#06b6d4';
			break;
		case LOC_SHEET_NAME:
			headers = ['位置名稱', '樓層', 'GitHub圖片連結 (Raw)', 'X', 'Y', 'W', 'H'];
			bgColor = '#84cc16';
			break;
		case NOTIFICATION_QUEUE_NAME:
			headers = ['建立時間', '狀態', '類型', '保管人', '人員', '備註', '預計歸還日', '資產JSON', '重試次數', '最後錯誤', '更新時間'];
			bgColor = '#0ea5e9';
			break;
		case 'CategoryRules':
			headers = ['分類名稱', '關鍵字正則 (包含)', '編號前綴', '智慧結尾 (字尾符合)'];
			bgColor = '#f97316';
			break;
		case ASSET_LOCATION_INDEX_NAME:
			headers = ['位置名稱', '在庫', '借出中', '待維修', '毀損報廢', '遺失扣除', '已使用完', '最後更新時間'];
			bgColor = '#06b6d4';
			break;
	}

	if (headers.length > 0) {
		sheet.appendRow(headers);
		sheet.setFrozenRows(1);
		sheet.getRange(1, 1, 1, headers.length)
			.setBackground(bgColor)
			.setFontColor('white')
			.setFontWeight('bold')
			.setHorizontalAlignment('center');
	}
}

function getAssetLocationSheet(locationName) {
	const key = normalizeLocationKey(locationName || '未命名');
	if (_assetLocationSheets[key]) {
		ensureAssetLocationSheetHeaders(_assetLocationSheets[key]);
		return _assetLocationSheets[key];
	}

	const ss = SpreadsheetApp.getActiveSpreadsheet();
	const sheetName = ASSET_PREFIX + key;
	let sheet = ss.getSheetByName(sheetName);

	if (!sheet) {
		sheet = ss.insertSheet(sheetName);
		sheet.appendRow(['建檔日期', '資產編號', '物品名稱', '顏色規格', '來源類別', '型號規格', '目前狀態', '固定保管人', '目前借用人', '備註', '單位', '照片網址', '位置名稱', '初始數量', '出庫規則', '臨界值', '位置移轉紀錄']);
		sheet.setFrozenRows(1);
		CacheService.getScriptCache().remove('loc_keys');
	}
	ensureAssetLocationSheetHeaders(sheet);

	_assetLocationSheets[key] = sheet;
	return sheet;
}

function ensureAssetLocationSheetHeaders(sheet) {
	if (!sheet) return;
	const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
	if (header.length < 14) {
		sheet.getRange(1, 14).setValue('初始數量');
	}
	if (header.length < 15) {
		sheet.getRange(1, 15).setValue('出庫規則');
	}
	if (header.length < 16) {
		sheet.getRange(1, 16).setValue('臨界值');
	}
	if (header.length < 17) {
		sheet.getRange(1, 17).setValue('位置移轉紀錄');
	}
}

function backfillAssetLocationHeaders() {
	const keys = getLocationKeysCached();
	keys.forEach(loc => {
		const sheet = getAssetLocationSheet(loc);
		ensureAssetLocationSheetHeaders(sheet);
	});
	return { success: true, count: keys.length, message: '已檢查並補齊資產位置表欄位' };
}

function mapLocationKeyForWrite(key) {
	const k = String(key || '').trim();
	const m = k.match(/^([A-Z0-9]+-[A-Z])/i);
	if (m) {
		return m[1].toUpperCase() + '區';
	}
	return k;
}

function getAllAssetLocationSheets() {
	const ss = SpreadsheetApp.getActiveSpreadsheet();
	const sheets = ss.getSheets();
	return sheets
		.filter(s => s.getName().startsWith(ASSET_PREFIX))
		.map(s => normalizeLocationKey(s.getName()));
}

function getLocationKeysCached() {
	const cache = CacheService.getScriptCache();
	const cached = cache.get('loc_keys');
	if (cached) return JSON.parse(cached);
	const keys = getAllAssetLocationSheets();
	cache.put('loc_keys', JSON.stringify(keys), 300);
	return keys;
}

function ensureAssetLocationIndex() {
	return getSheet(ASSET_LOCATION_INDEX_NAME);
}

function updateAssetLocationIndex() {
	const lock = LockService.getScriptLock();
	try {
		lock.waitLock(15000);

		const indexSheet = ensureAssetLocationIndex();
		const locations = getLocationKeysCached();
		const indexData = {};

		locations.forEach(loc => {
			const sheet = getAssetLocationSheet(loc);
			const lastRow = sheet.getLastRow();

			if (lastRow <= 1) {
				indexData[loc] = { 在庫: 0, 借出中: 0, 待維修: 0, 毀損報廢: 0, 遺失扣除: 0, 已使用完: 0 };
				return;
			}

			const data = sheet.getRange(2, 2, lastRow - 1, 15).getValues();
			const counts = { 在庫: 0, 借出中: 0, 待維修: 0, 毀損報廢: 0, 遺失扣除: 0, 已使用完: 0 };

			data.forEach(row => {
				const id = String(row[0] || '').trim();
				const qty = Number(row[12]) || 0;
				if (!id) return;
				const ids = id.split(/[,，\s]+/).filter(Boolean);
				const count = qty > 0 ? qty : ids.length;
				const statusRaw = String(row[5] || '').trim();
				const status = (statusRaw === '消耗' || statusRaw === '已領用') ? '已使用完' : statusRaw;
				if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += count;
			});

			indexData[loc] = counts;
		});

		const newRows = [];
		const timestamp = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd HH:mm:ss');
		Object.keys(indexData).forEach(loc => {
			const counts = indexData[loc];
			newRows.push([loc, counts.在庫, counts.借出中, counts.待維修, counts.毀損報廢, counts.遺失扣除, counts.已使用完, timestamp]);
		});

		const currentLastRow = indexSheet.getLastRow();
		if (currentLastRow > 1) {
			indexSheet.getRange(2, 1, currentLastRow - 1, 8).clearContent();
		}

		if (newRows.length > 0) {
			indexSheet.getRange(2, 1, newRows.length, 8).setValues(newRows);
		}

		try { PropertiesService.getScriptProperties().deleteProperty('index_needs_update'); } catch (e) {}
		return { success: true, message: '索引表已更新' };
	} catch (e) {
		return { success: false, message: e.toString() };
	} finally {
		lock.releaseLock();
	}
}

function buildAssetIndex() {
	const index = {};
	const keys = getLocationKeysCached();

	keys.forEach(k => {
		const sheet = getAssetLocationSheet(k);
		const lastRow = sheet.getLastRow();
		if (lastRow <= 1) return;

		const data = sheet.getRange(2, 2, lastRow - 1, 6).getValues();
		for (let i = 0; i < data.length; i++) {
			const rawIds = String(data[i][0] || '');
			if (!rawIds) continue;
			const ids = rawIds.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
			const status = String(data[i][5] || '').trim();
			const actualRow = i + 2;
			ids.forEach(id => {
				if (status === '在庫') index[id] = { sheet: k, row: actualRow };
				else if (!index[id]) index[id] = { sheet: k, row: actualRow };
			});
		}
	});

	saveAssetIndex(index);
	return index;
}

function saveAssetIndex(index) {
	try {
		const json = JSON.stringify(index || {});
		CacheService.getScriptCache().put(ASSET_INDEX_KEY, json, 600);
		PropertiesService.getScriptProperties().setProperty(ASSET_INDEX_KEY, json);
	} catch (e) {}
}

function getAssetIndex() {
	const cache = CacheService.getScriptCache();
	let raw = cache.get(ASSET_INDEX_KEY);
	if (!raw) raw = PropertiesService.getScriptProperties().getProperty(ASSET_INDEX_KEY);
	if (raw) {
		try { return JSON.parse(raw); } catch (e) {}
	}
	return buildAssetIndex();
}

function upsertIndexEntries(index, ids, sheetKey, rowNum) {
	(ids || []).forEach(id => { index[id] = { sheet: sheetKey, row: rowNum }; });
}

function removeIndexEntries(index, ids) {
	(ids || []).forEach(id => {
		const key = String(id || '').trim();
		if (!key) return;
		try { delete index[key]; } catch (e) {}
	});
}

function buildBorrowedAssetIndex() {
	const index = {};
	const keys = getLocationKeysCached();

	keys.forEach(k => {
		const sheet = getAssetLocationSheet(k);
		const lastRow = sheet.getLastRow();
		if (lastRow <= 1) return;

		const data = sheet.getRange(2, 2, lastRow - 1, 6).getValues();
		for (let i = 0; i < data.length; i++) {
			const rawIds = String(data[i][0] || '');
			if (!rawIds) continue;
			const status = String(data[i][5] || '').trim();
			if (status !== '借出中') continue;
			const ids = rawIds.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
			const actualRow = i + 2;
			ids.forEach(id => { index[id] = { sheet: k, row: actualRow }; });
		}
	});

	saveBorrowedAssetIndex(index);
	return index;
}

function saveBorrowedAssetIndex(index) {
	try {
		const json = JSON.stringify(index || {});
		CacheService.getScriptCache().put(BORROWED_ASSET_INDEX_KEY, json, 600);
		PropertiesService.getScriptProperties().setProperty(BORROWED_ASSET_INDEX_KEY, json);
	} catch (e) {}
}

function getBorrowedAssetIndex() {
	const cache = CacheService.getScriptCache();
	let raw = cache.get(BORROWED_ASSET_INDEX_KEY);
	if (!raw) raw = PropertiesService.getScriptProperties().getProperty(BORROWED_ASSET_INDEX_KEY);
	if (raw) {
		try { return JSON.parse(raw); } catch (e) {}
	}
	return buildBorrowedAssetIndex();
}

function scheduleAssetIndexUpdate() {
	const prop = PropertiesService.getScriptProperties();
	const startTime = Date.now();
	const lastRunTime = Number(prop.getProperty('index_last_run_timestamp')) || 0;
	const timeSinceLastRun = startTime - lastRunTime;
	const minInterval = 5 * 60 * 1000;
	const isFirstRun = lastRunTime === 0;
	const isIntervalSatisfied = timeSinceLastRun >= minInterval;
	const needsUpdate = prop.getProperty('index_needs_update') === 'true';

	let shouldExecute = false;
	if (isFirstRun) shouldExecute = true;
	else if (!isIntervalSatisfied) shouldExecute = false;
	else if (!needsUpdate) shouldExecute = false;
	else shouldExecute = true;

	if (!shouldExecute) {
		return { success: true, skipped: true, diagnostic: { isFirstRun: isFirstRun, isIntervalSatisfied: isIntervalSatisfied, needsUpdate: needsUpdate } };
	}

	prop.setProperty('index_last_run_timestamp', String(startTime));
	try { prop.deleteProperty('index_needs_update'); } catch (e) {}
	return updateAssetLocationIndex();
}

function syncAssetSheetLocationsAndCaches() {
	const lock = LockService.getScriptLock();
	const startTime = Date.now();
	try {
		lock.waitLock(30000);

		const locations = getLocationKeysCached();
		let changedRows = 0;
		let touchedSheets = 0;

		locations.forEach(loc => {
			// 前後端一致以櫃號為主：同步流程不再改寫第 13 欄位置值。
			// 這裡僅確保工作表可被掃描，實際資料以原欄位為準。
			getAssetLocationSheet(loc);
		});

		buildAssetIndex();
		buildBorrowedAssetIndex();
		invalidateCachesByEvent('assetMutation');
		const indexResult = updateAssetLocationIndex();

		return {
			success: true,
			changedRows: changedRows,
			touchedSheets: touchedSheets,
			indexUpdated: !!(indexResult && indexResult.success),
			elapsedMs: Date.now() - startTime,
			message: changedRows > 0 ? ('已同步 ' + changedRows + ' 筆資產櫃位資料') : '未發現需要同步的資產櫃位資料'
		};
	} catch (e) {
		return { success: false, message: e.toString(), elapsedMs: Date.now() - startTime };
	} finally {
		lock.releaseLock();
	}
}

function handleAssetSheetManualEdit(e) {
	try {
		const range = e && e.range;
		if (!range) return;
		const sheet = range.getSheet();
		if (!sheet) return;
		const sheetName = String(sheet.getName() || '');
		if (sheetName.indexOf(ASSET_PREFIX) !== 0) return;
		if (range.getRow() === 1) return;
		return syncAssetSheetLocationsAndCaches();
	} catch (err) {
		console.error('handleAssetSheetManualEdit failed: ' + err);
		return { success: false, message: err.toString() };
	}
}

function setupAssetSheetSyncTrigger() {
	const fnName = 'handleAssetSheetManualEdit';
	const existing = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === fnName);
	if (existing) return { success: true, message: '資產分頁同步觸發器已存在' };
	ScriptApp.newTrigger(fnName).forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
	return { success: true, message: '資產分頁同步觸發器已建立（手動剪貼後自動同步）' };
}

function getCategorySettings() {
	const cache = CacheService.getScriptCache();
	const prop = PropertiesService.getScriptProperties();
	let cachedData = cache.get('category_rules') || prop.getProperty('category_rules');
	if (!cachedData) return syncRulesFromSheet();
	try {
		const parsed = JSON.parse(cachedData);
		if (parsed && typeof parsed === 'object' && Array.isArray(parsed.rules)) return parsed;
	} catch (e) {}
	return syncRulesFromSheet();
}

function parseSettings(settings) {
	if (!settings || !settings.rules) return settings;
	const newSettings = JSON.parse(JSON.stringify(settings));
	newSettings.rules = newSettings.rules.map(r => ({ cat: r.cat, regex: new RegExp(r.regexStr) }));
	return newSettings;
}

function autoCategory(name) {
	if (!name) return '其他';
	const rawSettings = getCategorySettings();
	if (!rawSettings || typeof rawSettings !== 'object' || !Array.isArray(rawSettings.rules)) return '其他';
	const settings = parseSettings(rawSettings);
	if (!settings || !Array.isArray(settings.rules)) return '其他';
	const found = settings.rules.find(r => r.regex.test(name));
	if (found) return found.cat;
	if (settings.suffixMap) {
		for (let i = 0; i < settings.suffixMap.length; i++) {
			const rule = settings.suffixMap[i];
			if (rule.suffixes.some(s => String(name).endsWith(String(s).trim()))) return rule.cat;
		}
	}
	return '其他';
}

function getCategoryByAssetId(id) {
	if (!id) return '未分類';
	const rawSettings = getCategorySettings();
	if (!rawSettings || !rawSettings.prefixMap) return '讀取規則失敗';
	const match = String(id).trim().match(/^([A-Z]+)/);
	if (!match) return '編號格式錯誤';
	const prefix = match[1];
	const catName = rawSettings.prefixMap[prefix];
	if (catName) return catName;
	return '未分類(' + prefix + ')';
}

function syncRulesFromSheet() {
	const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CategoryRules');
	if (!sheet) {
		return null;
	}

	const data = sheet.getDataRange().getValues();
	const settings = { rules: [], prefixMap: {}, suffixMap: [] };
	for (let i = 1; i < data.length; i++) {
		const cat = String(data[i][0] || '').trim();
		const regexStr = String(data[i][1] || '').trim();
		const prefix = String(data[i][2] || '').trim().toUpperCase();
		const suffixStr = String(data[i][3] || '').trim();
		if (!cat) continue;
		if (regexStr) settings.rules.push({ cat: cat, regexStr: regexStr });
		if (prefix) settings.prefixMap[prefix] = cat;
		if (suffixStr) settings.suffixMap.push({ cat: cat, suffixes: suffixStr.split(',') });
	}

	const jsonStr = JSON.stringify(settings);
	PropertiesService.getScriptProperties().setProperty('category_rules', jsonStr);
	CacheService.getScriptCache().put('category_rules', jsonStr, 21600);
	return settings;
}

function initCategoryRulesSheet() {
	return getSheet('CategoryRules');
}

function addDonationFast(p) {
	// 盤點鎖定檢查：禁止捐贈
	const lockCheck = rejectIfStocktakeLocked('捐贈');
	if (lockCheck) return lockCheck;

	const lock = LockService.getScriptLock();
	try {
		lock.waitLock(10000);
		const sheet = getSheet(SHEET_NAME);
		const category = autoCategory(p.itemName);
		const qty = Number(p.quantity) || 0;
		const ratio = Number(p.unitRatio) || 1;
		const standardizedQty = qty * ratio;
		const rowData = [
			new Date(),
			p.donationDate ? new Date(p.donationDate) : new Date(),
			p.donorName,
			p.itemName,
			p.unit || '個',
			standardizedQty,
			p.location,
			p.handler,
			p.expiryDate ? new Date(p.expiryDate) : '',
			'⏳ 圖片處理中...',
			category,
			p.color || '無',
			p.itemStatus
		];

		sheet.appendRow(rowData);
		const nextRow = sheet.getLastRow();
		if (!p.photoUrl || p.photoUrl === '') {
			sheet.getRange(nextRow, 10).setValue('無照片');
		}
		clearFastCachesOnly();
		return { success: true, row: nextRow, category: category };
	} catch (err) {
		return { success: false, message: err.toString() };
	} finally {
		lock.releaseLock();
	}
}

function updatePhotoInBackground(row, base64Data, itemName, spec, locationName) {
	try {
		const driveUrl = uploadToDrive(base64Data, itemName, spec, false, locationName || '');
		const sheet = getSheet(SHEET_NAME);
		if (!(driveUrl && driveUrl.indexOf('http') > -1)) {
			sheet.getRange(row, 10).setValue('無照片');
			clearFastCachesOnly();
			return { success: false, error: String(driveUrl || '圖片上傳失敗') };
		}
		sheet.getRange(row, 10).setValue(driveUrl);
		clearFastCachesOnly();
		return { success: true, url: driveUrl };
	} catch (e) {
		try {
			const sheet = getSheet(SHEET_NAME);
			sheet.getRange(row, 10).setValue('無照片');
		} catch (rollbackErr) {}
		try { clearFastCachesOnly(); } catch (cacheErr) {}
		return { success: false, error: e.toString() };
	}
}

function getOrCreateSubFolder(parent, name) {
	const it = parent.getFoldersByName(name);
	return it.hasNext() ? it.next() : parent.createFolder(name);
}

function uploadToDrive(base64Data, itemName, spec, isAsset, locationName) {
	if (!base64Data) return '無圖片資料';
	if (base64Data.indexOf('base64,') === -1) return '格式錯誤';

	try {
		const root = DriveApp.getFolderById(MAIN_ROOT_FOLDER_ID);
		let targetFolder = root;
		if (typeof isAsset !== 'undefined') {
			const typeFolder = getOrCreateSubFolder(root, isAsset ? 'Assets' : 'Consumables');
			const ymFolder = getOrCreateSubFolder(typeFolder, Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM'));
			const dayFolder = getOrCreateSubFolder(ymFolder, Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd'));
			targetFolder = dayFolder;
		}

		const parts = base64Data.split('base64,');
		const contentType = parts[0].split(':')[1].split(';')[0];
		const bytes = Utilities.base64Decode(parts[1]);

		const clean = (s) => String(s || '').trim().replace(/[\\/:*?"<>|]/g, '_');
		const timeStamp = Utilities.formatDate(new Date(), 'GMT+8', 'yyyyMMdd_HHmm');
		const segments = [clean(itemName) || 'item'];
		if (spec) segments.push(clean(spec));
		if (locationName) segments.push(clean(locationName));
		segments.push(timeStamp);
		const fileName = segments.join('_') + '.jpg';

		const blob = Utilities.newBlob(bytes, contentType, fileName);
		const file = targetFolder.createFile(blob);
		try {
			file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
		} catch (sharingError) {}

		return 'https://lh3.googleusercontent.com/d/' + file.getId();
	} catch (e) {
		if (e.toString().indexOf('quota') > -1 || e.toString().indexOf('Quota') > -1) {
			return '上傳失敗：Drive 配額已用盡，請稍後再試或聯繫管理員';
		}
		if (e.toString().indexOf('permission') > -1 || e.toString().indexOf('Permission') > -1) {
			return '上傳失敗：權限不足，請檢查 Drive 資料夾設定';
		}
		if (e.toString().indexOf('not found') > -1 || e.toString().indexOf('Not found') > -1) {
			return '上傳失敗：找不到目標資料夾（ID 可能無效）';
		}
		return '上傳失敗：' + e.toString();
	}
}

function condenseIdList(idArray) {
	if (!idArray || idArray.length === 0) return '';
	const sortedIds = [].concat(idArray).sort();
	let results = [];
	let startIdx = 0;
	for (let i = 0; i < sortedIds.length; i++) {
		let curr = sortedIds[i], next = sortedIds[i + 1], isCont = false;
		if (next) {
			const cM = curr.match(/^(.*?)(\d+)$/), nM = next.match(/^(.*?)(\d+)$/);
			if (cM && nM && cM[1] === nM[1] && parseInt(nM[2], 10) === parseInt(cM[2], 10) + 1) isCont = true;
		}
		if (!isCont) {
			if (startIdx === i) {
				results.push(sortedIds[startIdx]);
			} else {
				const endNumStr = sortedIds[i].match(/\d+$/)[0];
				const shortEnd = (endNumStr.length > 2) ? endNumStr.slice(-2) : endNumStr;
				results.push(sortedIds[startIdx] + '~' + shortEnd);
			}
			startIdx = i + 1;
		}
	}
	return results.join(', ');
}

function searchAssetForRestock(keyword, forceRefresh) {
	if (!keyword) return [];
	const kw = keyword.toLowerCase().trim();

	if (forceRefresh) {
		try { removeBigCache('restock_search_index_v1'); } catch (e) {}
		try { removeBigCache('assets_full_v1'); } catch (e) {}
		try { removeBigCache('assets_full_version_v1'); } catch (e) {}
		try { CacheService.getScriptCache().remove('loc_keys'); } catch (e) {}
	}

	let allAssets = [];
	if (!forceRefresh) {
		const cachedIndex = loadFromBigCache('restock_search_index_v1');
		if (cachedIndex && Array.isArray(cachedIndex) && cachedIndex.length > 0) {
			allAssets = cachedIndex;
		} else {
			const cachedData = loadFromBigCache('summary_data_full_v2');
			if (cachedData && cachedData.assets) {
				allAssets = cachedData.assets;
				try { saveToBigCache('restock_search_index_v1', allAssets, 600); } catch (e) {}
			}
		}
	}

	if (allAssets.length === 0) {
		allAssets = getAvailableAssetsFull(!!forceRefresh);
		if (!forceRefresh) {
			try { saveToBigCache('restock_search_index_v1', allAssets, 600); } catch (e) {}
		}
	}

	const resultMap = {};
	allAssets.forEach(item => {
		const status = String(item.status || '').trim();
		if (status !== '在庫' && status !== '') return;

		const searchStr = (item.id + item.name + (item.spec || '') + item.location + (item.keeper || '')).toLowerCase();
		if (!searchStr.includes(kw)) return;

		let baseId = item.id;
		if (baseId.includes('-')) {
			const parts = baseId.split('-');
			if (/^\d+$/.test(parts[parts.length - 1])) {
				parts.pop();
				baseId = parts.join('-');
			}
		}

		const key = [baseId, item.name, item.location || '', item.keeper || '', item.unit || ''].join('|');
		let count = 1;
		if (item.count && Number(item.count) > 0) count = Number(item.count);
		else if (Array.isArray(item.ids)) count = item.ids.length;

		if (!resultMap[key]) {
			let detailedLoc = item.location || '未知';
			if (item.keeper && item.keeper !== '庫房') detailedLoc += ' (' + item.keeper + ')';
			resultMap[key] = {
				baseId: baseId,
				name: item.name,
				spec: item.spec || '',
				color: item.color || '',
				unit: item.unit || '',
				outRule: item.outRule || '僅借用',
				keeper: item.keeper || '',
				location: item.location || '',
				displayLoc: detailedLoc,
				photoUrl: item.photoUrl || '',
				count: 0
			};
		}
		resultMap[key].count += count;
	});

	return Object.values(resultMap).sort((a, b) => {
		const nameCmp = String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
		if (nameCmp !== 0) return nameCmp;
		return String(a.displayLoc || a.location || '').localeCompare(String(b.displayLoc || b.location || ''), 'zh-Hant');
	});
}

function findAssetRowsById(targetId) {
	try {
		if (!targetId) return { success: false, message: '請提供 id' };
		const locations = getLocationKeysCached();
		const out = [];
		locations.forEach(loc => {
			const sheet = getAssetLocationSheet(loc);
			const rows = sheet.getDataRange().getValues();
			for (let i = 1; i < rows.length; i++) {
				const r = rows[i];
				const ids = String(r[1] || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
				if (ids.includes(String(targetId).trim())) {
					out.push({ sheet: loc, row: i + 1, idCell: r[1], name: r[2], status: r[6], initQty: Number(r[13]) || 0, fullRow: r });
				}
			}
		});
		return { success: true, rows: out };
	} catch (e) {
		return { success: false, message: e.toString() };
	}
}

function ensureScrapSheet() {
	return getSheet(TRANS_SCRAP_NAME);
}

function initializeLocationSheets() {
	try {
		const locSheet = getSheet(LOC_SHEET_NAME);
		const locData = locSheet.getDataRange().getValues();
		const createdKeys = new Set();

		for (let i = 1; i < locData.length; i++) {
			const locationName = String(locData[i][0]).trim();
			if (!locationName) continue;
			const mappedKey = mapLocationKeyForWrite(normalizeLocationKey(locationName));
			if (createdKeys.has(mappedKey)) continue;
			getAssetLocationSheet(mappedKey);
			createdKeys.add(mappedKey);
		}
		return { success: true, message: '位置表已初始化' };
	} catch (e) {
		return { success: false, message: e.toString() };
	}
}

function initializeSystemOnPageLoad() {
	try {
		const staticSheets = [
			SHEET_NAME,
			TRANS_SCRAP_NAME,
			TRANS_CONSUMABLES_NAME,
			TRANS_ASSETS_NAME,
			STAFF_SHEET_NAME,
			LOC_SHEET_NAME,
			NOTIFICATION_QUEUE_NAME,
			'CategoryRules'
		];

		staticSheets.forEach(name => getSheet(name));
		initializeLocationSheets();
		ensureAssetLocationIndex();
		try { updateAssetLocationIndex(); } catch (e) {}
		return { success: true, message: '✅ 系統已準備就緒' };
	} catch (e) {
		return { success: false, message: '初始化錯誤: ' + e.toString() };
	}
}

function runDebugForBT26001() {
	try {
		if (typeof debugRowsForId !== 'function') {
			return { success: false, message: 'debugRowsForId 未定義' };
		}
		const rows = debugRowsForId('BT26001');
		Logger.log(JSON.stringify(rows));
		return rows;
	} catch (e) {
		return { success: false, message: e.toString() };
	}
}

function getScrapForBT26001() {
	try {
		const all = getScrapTotals(10000);
		if (!all || !all.recent) return [];
		return all.recent.filter(r => String(r.id).trim() === 'BT26001');
	} catch (e) {
		return { success: false, message: e.toString() };
	}
}

function runDebugTool() {
	const targetId = 'BT26001';
	if (typeof debugRowsForId !== 'function') {
		console.log('❌ debugRowsForId 未定義');
		return;
	}
	const result = debugRowsForId(targetId);
	if (!result || result.length === 0) {
		console.log('❌ 找不到！這個編號在任何位置表都沒出現。');
	} else {
		console.log('✅ 找到了！共發現 ' + result.length + ' 筆資料：');
		console.log(JSON.stringify(result, null, 2));
	}
}

function debugForceWrite() {
	const ss = SpreadsheetApp.getActiveSpreadsheet();
	const targetSheetName = 'Transactions_Assets';
	const sheet = ss.getSheetByName(targetSheetName);
	if (!sheet) {
		throw new Error('❌ 嚴重錯誤：找不到名為「' + targetSheetName + '」的工作表！請檢查分頁名稱。');
	}

	sheet.appendRow([
		new Date(),
		'測試寫入',
		'測試物品',
		'Test-001',
		-1,
		'測試人',
		'2026-12-31',
		'測試中',
		'管理員',
		'這是一筆測試資料，確認寫入功能是否正常'
	]);
	return '寫入成功';
}

function testLineOnly() {
	sendLineNotify('LINE 測試成功');
}

function testEmailAndLine() {
	sendEmailAndLine('[TEST] Email + LINE', 'This is a test message.', 'monica24685@gmail.com');
}

