/**
 * Asset Operations Module
 */

function toSafePropertyKeyPart(s) {
	return String(s || '')
		.trim()
		.replace(/[^A-Za-z0-9_-]/g, '_')
		.slice(0, 80);
}

// 掃描現有資料：找某 prefix+year 的最大主流水號（僅作計數器初始化 fallback）
function findMaxBaseSerialByPrefixYear(prefix, yearShort) {
	let max = 0;
	const pattern = new RegExp('^' + prefix + yearShort + '(\\d+)');
	const locs = getLocationKeysCached();
	locs.forEach(loc => {
		const rows = getAssetLocationSheet(loc).getDataRange().getValues();
		rows.slice(1).forEach(r => {
			String(r[1] || '').split(/[,，\s]+/).forEach(id => {
				const mainPart = String(id || '').trim().split('-')[0];
				const m = mainPart.match(pattern);
				if (m) max = Math.max(max, parseInt(m[1], 10));
			});
		});
	});
	return max;
}

// 掃描現有資料：找某 baseId 的最大尾碼（僅作計數器初始化 fallback）
function findMaxSuffixForBaseId(baseId) {
	let max = 0;
	const escapedBaseId = String(baseId || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const suffixPattern = new RegExp('^' + escapedBaseId + '-(\\d+)$');
	const locs = getLocationKeysCached();
	locs.forEach(loc => {
		const rows = getAssetLocationSheet(loc).getDataRange().getValues();
		rows.slice(1).forEach(r => {
			String(r[1] || '').split(/[,，\s]+/).forEach(id => {
				const m = String(id || '').trim().match(suffixPattern);
				if (m) max = Math.max(max, parseInt(m[1], 10));
			});
		});
	});
	return max;
}

// 取得並遞增流水號計數器：平常 O(1)；若首次無計數器，才 fallback 掃描一次
function allocateSerialRange(counterKey, amount, fallbackMaxFn) {
	const prop = PropertiesService.getScriptProperties();
	const n = Math.max(1, Number(amount) || 1);
	let current = Number(prop.getProperty(counterKey));

	if (!Number.isFinite(current) || current < 0) {
		current = Number(fallbackMaxFn ? fallbackMaxFn() : 0) || 0;
	}

	const start = current + 1;
	const end = current + n;
	prop.setProperty(counterKey, String(end));
	return { start: start, end: end };
}

// 從單一資產 ID 反推並推進計數器（用於自訂編號或人工修補後）
function bumpCountersFromAssetId(id) {
	const idStr = String(id || '').trim();
	if (!idStr) return;

	const prop = PropertiesService.getScriptProperties();
	const parts = idStr.split('-');
	const main = String(parts[0] || '').trim();
	const suffixPart = String(parts[1] || '').trim();

	const m = main.match(/^([A-Za-z]+)(\d{2})(\d+)$/);
	if (!m) return;

	const prefix = m[1];
	const yearShort = m[2];
	const serial = Number(m[3]) || 0;
	const baseCounterKey = 'asset_serial_' + toSafePropertyKeyPart(prefix) + '_' + toSafePropertyKeyPart(yearShort);
	const currentBase = Number(prop.getProperty(baseCounterKey)) || 0;
	if (serial > currentBase) {
		prop.setProperty(baseCounterKey, String(serial));
	}

	if (/^\d+$/.test(suffixPart)) {
		const suffix = Number(suffixPart) || 0;
		const suffixCounterKey = 'asset_suffix_' + toSafePropertyKeyPart(main);
		const currentSuffix = Number(prop.getProperty(suffixCounterKey)) || 0;
		if (suffix > currentSuffix) {
			prop.setProperty(suffixCounterKey, String(suffix));
		}
	}
}

/**
 * 手動同步計數器：當你人工改動/刪除 Google Sheet 資產編號後可執行一次
 * 作用：重建 asset_serial_* 與 asset_suffix_* 計數器，避免後續自動配號偏移
 */
function syncAssetSerialCounters() {
	const prop = PropertiesService.getScriptProperties();
	const baseMaxMap = {};
	const suffixMaxMap = {};

	const locs = getLocationKeysCached();
	locs.forEach(loc => {
		const sheet = getAssetLocationSheet(loc);
		const lastRow = sheet.getLastRow();
		if (lastRow <= 1) return;

		const values = sheet.getRange(2, 2, lastRow - 1, 1).getValues(); // B 欄：資產編號
		values.forEach(r => {
			const raw = String(r[0] || '');
			if (!raw) return;

			raw.split(/[,，\s]+/).forEach(token => {
				const id = String(token || '').trim();
				if (!id) return;

				const parts = id.split('-');
				const main = String(parts[0] || '').trim();
				const suffixPart = String(parts[1] || '').trim();
				const m = main.match(/^([A-Za-z]+)(\d{2})(\d+)$/);
				if (!m) return;

				const prefix = m[1];
				const yearShort = m[2];
				const serial = Number(m[3]) || 0;
				const baseCounterKey = 'asset_serial_' + toSafePropertyKeyPart(prefix) + '_' + toSafePropertyKeyPart(yearShort);
				baseMaxMap[baseCounterKey] = Math.max(baseMaxMap[baseCounterKey] || 0, serial);

				if (/^\d+$/.test(suffixPart)) {
					const suffix = Number(suffixPart) || 0;
					const suffixCounterKey = 'asset_suffix_' + toSafePropertyKeyPart(main);
					suffixMaxMap[suffixCounterKey] = Math.max(suffixMaxMap[suffixCounterKey] || 0, suffix);
				}
			});
		});
	});

	Object.keys(baseMaxMap).forEach(k => prop.setProperty(k, String(baseMaxMap[k])));
	Object.keys(suffixMaxMap).forEach(k => prop.setProperty(k, String(suffixMaxMap[k])));

	const msg = '同步完成：主號計數器 ' + Object.keys(baseMaxMap).length + ' 筆，尾碼計數器 ' + Object.keys(suffixMaxMap).length + ' 筆';
	console.log('✅ [syncAssetSerialCounters] ' + msg);
	return {
		success: true,
		message: msg,
		baseCounters: Object.keys(baseMaxMap).length,
		suffixCounters: Object.keys(suffixMaxMap).length
	};
}

/** 🚀 修改後的資產入庫函式：寫入對應位置表 */
function importAssetFast(p) {
	// 盤點鎖定檢查：禁止入庫
	const lockCheck = rejectIfStocktakeLocked('入庫');
	if (lockCheck) return lockCheck;

	const lock = LockService.getScriptLock();
	try {
		lock.waitLock(30000);
    
		const locationName = String(p.location || '').trim();
		if (!locationName) return { success: false, message: '必須指定存放位置' };
    
		const key = normalizeLocationKey(locationName);
		const targetKey = mapLocationKeyForWrite(key);
		const sheet = getAssetLocationSheet(targetKey);
    
		const category = autoCategory(p.itemName);
		const count = parseInt(p.assetQty, 10) || 1;
		let assetIds = [];

		 // 🟢 邏輯核心：決定主編號
		 let baseId = "";
		 let useBatchMode = (p.isBatch === true || p.isBatch === 'true'); 

		// 情況 A: 使用者有填寫「自訂編號」(補貨模式 / 指定編號)
		 if (p.customId && String(p.customId).trim() !== "") {
			 baseId = String(p.customId).trim();
			 // 自訂編號時順便推進計數器，避免未來自動編號倒退或撞號
			 bumpCountersFromAssetId(baseId);
			 useBatchMode = true; 
		} 
		// 情況 B: 自動產生新編號
		else {
			 const rawSettings = getCategorySettings();
			 const settings = parseSettings(rawSettings);
			 let prefix = 'OTT';
			 if (settings && settings.prefixMap) {
				 for (let k in settings.prefixMap) {
					 if (settings.prefixMap[k] === category) { prefix = k; break; }
				 }
			 }
			 const yearShort = Utilities.formatDate(new Date(), "GMT+8", "yy");
       
			 // 🚀 使用 ScriptProperties 計數器分配主號：避免每次都掃描全部工作表
			 const baseCounterKey = 'asset_serial_' + toSafePropertyKeyPart(prefix) + '_' + toSafePropertyKeyPart(yearShort);
			 const alloc = allocateSerialRange(
				 baseCounterKey,
				 useBatchMode ? 1 : count,
				 () => findMaxBaseSerialByPrefixYear(prefix, yearShort)
			 );

			 if (useBatchMode) {
				 // 批次模式：只需要一個主號
				 baseId = prefix + yearShort + String(alloc.start).padStart(4, '0');
			 } else {
				 // 獨立模式：一次拿 N 個主號
				 for (let s = alloc.start; s <= alloc.end; s++) {
					 assetIds.push(prefix + yearShort + String(s).padStart(4, '0'));
				 }
			 }
		}

		// 🔵 補貨邏輯 - 超商模式合併更新邏輯
		let wasMerged = false; // 追蹤是否執行了合併
		let updatedRowNum = -1; // 若合併更新，記錄被更新的實際行號
		let mergedSheetKey = null; // 記錄合併發生的 sheet key
    
		if (useBatchMode && baseId) {
			 // 超商模式：先用資產索引直查，找不到再 fallback 全表掃描
			 let foundAndUpdated = false;

			 const idx = getAssetIndex();
			 const hit = idx && idx[baseId];
			 if (hit && hit.sheet && hit.row) {
				 const s = getAssetLocationSheet(hit.sheet);
				 const rowVals = s.getRange(hit.row, 1, 1, 15).getValues()[0];
				 const rowIds = String(rowVals[1] || '').split(/[,，\s]+/).map(id => id.trim());
				 const rowName = String(rowVals[2] || '');
				 const rowStatus = String(rowVals[6] || '').trim();
				 if (rowIds.includes(baseId) && rowName === String(p.itemName) && rowStatus === '在庫') {
					 const currentCount = Number(rowVals[13]) || 0;
					 const newCount = currentCount + count;
					 s.getRange(hit.row, 14).setValue(newCount);
					 s.getRange(hit.row, 15).setValue(p.outRule || '僅借用');

					 const currentPhoto = String(rowVals[11] || '').trim();
					 if (p.photoUrl && p.photoUrl !== '' && (!currentPhoto || currentPhoto === '無照片' || currentPhoto.indexOf('⏳') > -1)) {
						 s.getRange(hit.row, 12).setValue("⏳ 圖片背景同步中...");
					 }

					 updatedRowNum = hit.row;
					 mergedSheetKey = hit.sheet;
					 foundAndUpdated = true;
					 assetIds = [baseId];
					 wasMerged = true;
				 }
			 }

			 if (!foundAndUpdated) {
				 const locations = getLocationKeysCached();
				 for (let loc of locations) {
					 const s = getAssetLocationSheet(loc);
					 const rows = s.getDataRange().getValues();
					 for (let i = 1; i < rows.length; i++) {
						 const rowIds = String(rows[i][1] || '').split(/[,，\s]+/).map(id => id.trim());
						 const rowName = String(rows[i][2]);
						 const rowStatus = String(rows[i][6]).trim();
						 if (rowIds.includes(baseId) && rowName === String(p.itemName) && rowStatus === '在庫') {
							 const currentCount = Number(rows[i][13]) || 0;
							 const newCount = currentCount + count;
							 s.getRange(i + 1, 14).setValue(newCount);
							 s.getRange(i + 1, 15).setValue(p.outRule || '僅借用');
							 const currentPhoto = String(rows[i][11] || '').trim();
							 if (p.photoUrl && p.photoUrl !== '' && (!currentPhoto || currentPhoto === '無照片' || currentPhoto.indexOf('⏳') > -1)) {
								 s.getRange(i + 1, 12).setValue("⏳ 圖片背景同步中...");
							 }
							 updatedRowNum = i + 1;
							 mergedSheetKey = loc;
							 foundAndUpdated = true;
							 assetIds = [baseId];
							 wasMerged = true;
							 break;
						 }
					 }
					 if (foundAndUpdated) break;
				 }
			 }
       
			 // 若找不到現有行，才新增新行
			 if (!foundAndUpdated) {
				 assetIds = [baseId];
			 }
		} else if (baseId) {
			 // 非超商模式：用 baseId 尾碼計數器分配，避免每次掃描所有位置表
			 const suffixCounterKey = 'asset_suffix_' + toSafePropertyKeyPart(baseId);
			 const suffixAlloc = allocateSerialRange(
				 suffixCounterKey,
				 count,
				 () => findMaxSuffixForBaseId(baseId)
			 );

			 for (let s = suffixAlloc.start; s <= suffixAlloc.end; s++) {
					const suffix = String(s).padStart(2, '0');
					assetIds.push(`${baseId}-${suffix}`);
			 }
		}

		const photoStatusText = (p.photoUrl && p.photoUrl !== "") ? "⏳ 圖片背景同步中..." : "無照片";
		const nextRow = sheet.getLastRow() + 1;

		// 🚀 只有在非合併情況下才 appendRow
		if (!wasMerged) {
			sheet.appendRow([
				new Date(),           
				assetIds.join(', '),  
				p.itemName,           
				p.color || '無',      
				p.sourceType,         
				p.spec || '',         
				'在庫',               
				p.keeper || '庫房',    
				'',                   
				p.note || '',         
				p.unit || '個',       
				photoStatusText,      
				key,                  
				count,                // 🚀 N欄：寫入初始數量
				p.outRule || '僅借用' // 🚀 O欄：出庫規則
			]);
		}

		const index = getAssetIndex();
		const finalRow = wasMerged && updatedRowNum > 0 ? updatedRowNum : nextRow;
		const finalSheetKey = wasMerged && mergedSheetKey ? mergedSheetKey : targetKey;
		upsertIndexEntries(index, assetIds, finalSheetKey, finalRow);
		saveAssetIndex(index);
		invalidateCachesByEvent('assetMutation');

		let returnIdDisplay = "";
		if (useBatchMode) {
			 if (assetIds.length > 0) {
					let lastId = assetIds[assetIds.length-1];
					returnIdDisplay = `${baseId} (新增 ${count} 件, 序號至 ${lastId.split('-').pop()})`;
			 } else {
					returnIdDisplay = baseId;
			 }
		} else {
			 returnIdDisplay = assetIds[0] + " ~ " + assetIds[assetIds.length-1];
		}

		return { success: true, id: returnIdDisplay, row: finalRow, sheet: finalSheetKey, category: category };

	} catch (err) { 
		return { success: false, message: err.toString() }; 
	} finally {
		lock.releaseLock();
	}
}

/** 🚀 背景更新資產圖片（此函數暫時不使用，待後續優化） */
function updateAssetPhotoInBackground(row, base64Data, itemName, spec, locationName) {
	try {
		const targetLoc = locationName ? mapLocationKeyForWrite(normalizeLocationKey(locationName)) : null;
		const locLabel = targetLoc || locationName || ""; // 檔名也帶上位置，方便辨識
		const sheet = targetLoc ? getAssetLocationSheet(targetLoc) : null;
		const driveUrl = uploadToDrive(base64Data, itemName, spec, true, locLabel);
		if (!(driveUrl && driveUrl.indexOf("http") > -1)) {
			if (sheet) {
				const currentPhoto = String(sheet.getRange(row, 12).getValue() || '').trim();
				if (!currentPhoto || currentPhoto.indexOf('⏳') > -1) {
					sheet.getRange(row, 12).setValue('無照片');
				}
			}
			invalidateCachesByEvent('assetMutation');
			return { success: false, error: String(driveUrl || '圖片上傳失敗') };
		}

		if (!sheet) {
			return { success: false, error: '找不到目標工作表，無法回填圖片網址' };
		}

		sheet.getRange(row, 12).setValue(driveUrl);
		invalidateCachesByEvent('assetMutation');
		return { success: true, url: driveUrl };
	} catch (e) {
		try {
			const targetLoc = locationName ? mapLocationKeyForWrite(normalizeLocationKey(locationName)) : null;
			const sheet = targetLoc ? getAssetLocationSheet(targetLoc) : null;
			if (sheet) {
				const currentPhoto = String(sheet.getRange(row, 12).getValue() || '').trim();
				if (!currentPhoto || currentPhoto.indexOf('⏳') > -1) {
					sheet.getRange(row, 12).setValue('無照片');
				}
			}
		} catch (rollbackErr) {}
		try { invalidateCachesByEvent('assetMutation'); } catch (cacheErr) {}
		return { success: false, error: e.toString() };
	}
}

function normalizeDateToYmdText(v) {
	if (!v) return '';
	try {
		if (v instanceof Date && !isNaN(v.getTime())) {
			return Utilities.formatDate(v, 'GMT+8', 'yyyy/MM/dd');
		}
		const s = String(v).trim();
		if (!s) return '';
		if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.replace(/-/g, '/');
		if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return s;
		const d = new Date(s);
		if (!isNaN(d.getTime())) return Utilities.formatDate(d, 'GMT+8', 'yyyy/MM/dd');
		return s;
	} catch (e) {
		return String(v || '');
	}
}

function appendCabinetToNote(noteText, cabinetText) {
	const note = String(noteText || '').trim();
	const cab = String(cabinetText || '').trim();
	if (!cab) return note;
	if (note.indexOf('櫃位:') > -1) return note;
	return note ? (note + ' | 櫃位:' + cab) : ('櫃位:' + cab);
}

function findMergeTargetRow(targetStatus, itemName, itemSpec, itemColor, displayLoc, locations, mergeTargetCache, keeperName) {
	const normalizedStatus = String(targetStatus || '在庫').trim() || '在庫';
	const normalizedLoc = String(displayLoc || '').trim();
	const normalizedKeeper = String(keeperName || '').trim();
	const scanLocations = Array.isArray(locations) && locations.length > 0 ? locations : getLocationKeysCached();
	const cacheObj = mergeTargetCache || {};
	const cacheKey = [normalizedStatus, String(itemName || ''), String(itemSpec || ''), String(itemColor || ''), normalizedLoc, normalizedKeeper].join('||');

	const validateCached = (cached) => {
		if (!cached || !cached.sheet || !cached.row) return null;
		try {
			const sheet = getAssetLocationSheet(cached.sheet);
			const row = sheet.getRange(cached.row, 1, 1, 17).getValues()[0];
			const rowStatus = String(row[6] || '').trim();
			const rowLoc = String(row[12] || cached.sheet).trim();
			const rowKeeper = String(row[7] || '').trim();
			if (rowStatus !== normalizedStatus) return null;
			if (String(row[2] || '') !== String(itemName || '')) return null;
			if (String(row[5] || '') !== String(itemSpec || '')) return null;
			if (String(row[3] || '') !== String(itemColor || '')) return null;
			if (rowLoc !== normalizedLoc) return null;
			if (normalizedKeeper && rowKeeper !== normalizedKeeper) return null;
			return { sheet: cached.sheet, row: cached.row, values: row };
		} catch (e) {
			return null;
		}
	};

	const cached = validateCached(cacheObj[cacheKey]);
	if (cached) return cached;

	for (let locX of scanLocations) {
		const sheet = getAssetLocationSheet(locX);
		const rows = sheet.getDataRange().getValues();
		for (let j = 1; j < rows.length; j++) {
			const rr = rows[j];
			const rrStatus = String(rr[6] || '').trim();
			const rrLoc = String(rr[12] || locX).trim();
			const rrKeeper = String(rr[7] || '').trim();
			if (rrStatus !== normalizedStatus) continue;
			if (String(rr[2] || '') !== String(itemName || '')) continue;
			if (String(rr[5] || '') !== String(itemSpec || '')) continue;
			if (String(rr[3] || '') !== String(itemColor || '')) continue;
			if (rrLoc !== normalizedLoc) continue;
			if (normalizedKeeper && rrKeeper !== normalizedKeeper) continue;

			const found = { sheet: locX, row: j + 1, values: rr };
			cacheObj[cacheKey] = { sheet: locX, row: j + 1 };
			return found;
		}
	}

	return null;
}

function locateBorrowedRow(targetId, locations, borrowedAssetIndex, assetIndex, indexRebuiltRef) {
	const scanLocations = Array.isArray(locations) && locations.length > 0 ? locations : getLocationKeysCached();
	let borrowedIdx = borrowedAssetIndex || getBorrowedAssetIndex();
	let assetIdx = assetIndex || getAssetIndex();
	let rebuilt = indexRebuiltRef && !!indexRebuiltRef.value;

	const tryFromIndex = () => {
		const locInfo = borrowedIdx[targetId];
		if (!locInfo || !locInfo.sheet || !locInfo.row) return null;
		try {
			const aSheet = getAssetLocationSheet(locInfo.sheet);
			const data = aSheet.getDataRange().getValues();
			const rowNum = Number(locInfo.row) || 0;
			if (rowNum < 2 || rowNum > data.length) return null;
			const rowValues = data[rowNum - 1];
			const rowIds = String(rowValues[1] || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
			const status = String(rowValues[6] || '').trim();
			if (!(rowIds.includes(targetId) && status === '借出中')) return null;
			return { loc: locInfo.sheet, aSheet: aSheet, data: data, rowIndex: rowNum - 1 };
		} catch (e) {
			return null;
		}
	};

	let found = tryFromIndex();
	if (found) return found;

	if (!rebuilt) {
		borrowedIdx = buildBorrowedAssetIndex();
		rebuilt = true;
		if (indexRebuiltRef) indexRebuiltRef.value = true;
		found = tryFromIndex();
		if (found) return found;
	}

	for (let loc of scanLocations) {
		const aSheet = getAssetLocationSheet(loc);
		const data = aSheet.getDataRange().getValues();
		for (let i = data.length - 1; i >= 1; i--) {
			const rowIds = String(data[i][1] || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
			const status = String(data[i][6] || '').trim();
			if (!(rowIds.includes(targetId) && status === '借出中')) continue;
			borrowedIdx[targetId] = { sheet: loc, row: i + 1 };
			upsertIndexEntries(assetIdx, [targetId], loc, i + 1);
			return { loc: loc, aSheet: aSheet, data: data, rowIndex: i };
		}
	}

	return null;
}

function withdrawItem(p) {
	// 盤點鎖定檢查：禁止借用/領用
	const lockCheck = rejectIfStocktakeLocked('借用/領用');
	if (lockCheck) return lockCheck;

	const lock = LockService.getScriptLock();
	const startTime = new Date().getTime();
	const timing = { consumeScanMs: 0, borrowScanMs: 0, writeTxMs: 0, notifyMs: 0, clearCacheMs: 0 };
	let debugLog = ['=== 借出/領用 執行報告 ==='];

	try {
		lock.waitLock(30000);

		const itemsToProcess = Array.isArray(p.items) ? p.items : [p];
		const tSheet = getSheet(TRANS_ASSETS_NAME);
		const cSheet = getSheet(TRANS_CONSUMABLES_NAME);
		const dSheet = getSheet(SHEET_NAME);

		let assetIndex = getAssetIndex();
		let allProcessedAssetsBorrow = [];
		let allProcessedAssetsConsume = [];
		let consumedZeroDeleteLogs = [];
		let successCount = 0;
		let assetRowsDeleted = false;
		let indexRebuilt = false;
		const idCellCache = {};

		function getCachedIdCell(sheetKey, rowNum) {
			const key = String(sheetKey || '') + '::' + String(rowNum || '');
			if (Object.prototype.hasOwnProperty.call(idCellCache, key)) return idCellCache[key];
			const sh = getAssetLocationSheet(sheetKey);
			const v = String(sh.getRange(rowNum, 2).getValue() || '');
			idCellCache[key] = v;
			return v;
		}

		function deleteIndexEntries(index, ids) {
			(ids || []).forEach(id => {
				if (Object.prototype.hasOwnProperty.call(index, id)) delete index[id];
			});
		}

		debugLog.push('收到請求: 共 ' + itemsToProcess.length + ' 個項目');

		for (let itemObj of itemsToProcess) {
			const targetName = String(itemObj.itemName).trim();
			const rawQty = itemObj.quantity;
			const qtyOmitted = (rawQty === undefined || rawQty === null || rawQty === '');
			const requestQty = qtyOmitted ? 1 : Math.abs(Number(rawQty));
			// 數量有明確填寫但無效（非數字、0、負數）時直接跳過這個項目，不要悄悄當成 1 件處理；
			// 沒填數量（qtyOmitted）才維持預設 1 件的既有行為。
			if (!qtyOmitted && (!Number.isFinite(requestQty) || requestQty <= 0)) continue;
			const isAssetMode = (itemObj.type === 'asset' || (itemObj.assetIds && itemObj.assetIds.length > 0));

			if (isAssetMode) {
				const opStart = new Date().getTime();
				const assetAction = String(itemObj.assetAction || p.assetAction || 'borrow').trim().toLowerCase();
				const targetIds = String(itemObj.assetIds).split(/[,，\s]+/).map(s => s.trim()).filter(s => s !== '');
				let currentItemProcessed = [];
				let leftToBorrow = requestQty;
				const supermarket = !!(itemObj.supermarket || itemObj.batchMode || itemObj.mode === 'supermarket');

				if (assetAction === 'consume') {
					let leftToConsume = requestQty;
					const touchedRows = {};

					// 處理單一候選列的領用邏輯，抽成共用函式讓「索引直查」與「品名回掃 fallback」共用同一份邏輯，
					// 避免像 MIGRATION.md 記錄過的「同一段邏輯複製兩份、只修一份」問題。
					function tryConsumeRow(sheetKey, row, rowValues, preferredId) {
						if (leftToConsume <= 0) return false;
						const rowKey = sheetKey + '::' + row;
						if (touchedRows[rowKey]) return false;

						const status = String(rowValues[6] || '').trim();
						if (status !== '在庫' && status !== '') return false;
						const outRule = String(rowValues[14] || '僅借用').trim() || '僅借用';
						if (outRule === '僅借用') return false;

						const rowIds = String(rowValues[1] || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
						if (!rowIds.length) return false;

						let id;
						if (preferredId) {
							if (!rowIds.includes(preferredId)) return false;
							id = preferredId;
						} else {
							id = rowIds[0];
						}

						const origInit = Number(rowValues[13]) || rowIds.length;
						if (origInit <= 0) return false;

						const takeQty = Math.min(leftToConsume, origInit);
						if (takeQty <= 0) return false;

						const sheet = getAssetLocationSheet(sheetKey);
						const isBatchRow = rowIds.length <= 1 && origInit > 1;
						const consumeIds = isBatchRow ? [id] : rowIds.slice(0, takeQty);
						const stayIds = isBatchRow ? rowIds : rowIds.slice(takeQty);
						const newInit = Math.max(0, origInit - takeQty);

						if (newInit <= 0) {
							const removedIds = isBatchRow ? [id] : consumeIds.slice();
							deleteIndexEntries(assetIndex, removedIds);
							consumedZeroDeleteLogs.push({
								name: rowValues[2],
								ids: removedIds,
								qty: takeQty,
								receiver: itemObj.receiver || p.receiver,
								handler: itemObj.handler || p.handler,
								note: itemObj.note || p.note,
								location: String(rowValues[12] || '').trim() || sheetKey,
								sourceSheetKey: sheetKey,
								sourceRowNum: Number(row) || 0
							});
							sheet.deleteRow(row);
							assetRowsDeleted = true;
							indexRebuilt = false;
							delete idCellCache[rowKey];
						} else {
							try { sheet.getRange(row, 14).setValue(newInit); } catch (e) {}
							if (!isBatchRow) {
								sheet.getRange(row, 2).setValue(stayIds.join(', '));
								upsertIndexEntries(assetIndex, stayIds, sheetKey, row);
							}

							const newRow = [...rowValues];
							newRow[1] = consumeIds.join(', ');
							newRow[6] = '已領用';
							newRow[8] = itemObj.receiver || p.receiver;
							newRow[13] = takeQty;
							sheet.appendRow(newRow);
							const newRowNum = sheet.getLastRow();
							upsertIndexEntries(assetIndex, consumeIds, sheetKey, newRowNum);
						}

						currentItemProcessed.push({
							id: consumeIds[0] || id,
							qty: takeQty,
							name: rowValues[2],
							spec: rowValues[5],
							color: rowValues[3],
							unit: rowValues[10],
							keeper: rowValues[7],
							location: String(rowValues[12] || '').trim() || sheetKey
						});

						allProcessedAssetsConsume.push({
							id: consumeIds[0] || id,
							qty: takeQty,
							name: rowValues[2],
							spec: rowValues[5],
							color: rowValues[3],
							unit: rowValues[10],
							keeper: rowValues[7],
							location: String(rowValues[12] || '').trim() || sheetKey
						});

						leftToConsume -= takeQty;
						touchedRows[rowKey] = true;
						return true;
					}

					for (let i = 0; i < targetIds.length; i++) {
						if (leftToConsume <= 0) break;

						const id = targetIds[i];
						let locInfo = assetIndex[id];
						let needRetry = false;

						if (!locInfo) {
							needRetry = true;
						} else {
							try {
								const checkIds = getCachedIdCell(locInfo.sheet, locInfo.row);
								if (!checkIds.includes(id)) needRetry = true;
							} catch (err) {
								needRetry = true;
							}
						}

						if (needRetry && !indexRebuilt) {
							assetIndex = buildAssetIndex();
							indexRebuilt = true;
							locInfo = assetIndex[id];
						}

						if (!locInfo) continue;

						const rowKey = locInfo.sheet + '::' + locInfo.row;
						if (touchedRows[rowKey]) continue;

						const sheet = getAssetLocationSheet(locInfo.sheet);
						const row = locInfo.row;
						const rowValues = sheet.getRange(row, 1, 1, 15).getValues()[0];
						tryConsumeRow(locInfo.sheet, row, rowValues, id);
					}

					// 保險機制：若送進來的 assetIds 與索引不一致、或索引指向的列庫存不夠，改用品名/位置回掃可領用列，
					// 避免整批領用被靜默漏領（跟借出分支第 780 行附近的 fallback 是同一種保險機制）。
					if (leftToConsume > 0) {
						const fallbackLocations = getLocationKeysCached();
						const targetLocation = String(itemObj.location || '').trim();
						for (let li = 0; li < fallbackLocations.length && leftToConsume > 0; li++) {
							const sheetKey = fallbackLocations[li];
							const sheet = getAssetLocationSheet(sheetKey);
							const rows = sheet.getDataRange().getValues();
							for (let r = rows.length - 1; r >= 1 && leftToConsume > 0; r--) {
								const rowValues = rows[r];
								const rowDisplayLoc = String(rowValues[12] || '').trim() || sheetKey;
								if (targetLocation && rowDisplayLoc !== targetLocation) continue;
								if (String(rowValues[2] || '').trim() !== targetName) continue;
								tryConsumeRow(sheetKey, r + 1, rowValues, null);
							}
						}
					}

					if (currentItemProcessed.length > 0) {
						const writeStart = new Date().getTime();
						const shortenedIds = condenseIdList(currentItemProcessed.map(a => a.id));
						const totalQty = currentItemProcessed.reduce((s, it) => s + (Number(it.qty) || 1), 0);
						const cabinetSet = Array.from(new Set(currentItemProcessed.map(a => String(a.location || '').trim()).filter(Boolean)));
						const txNote = appendCabinetToNote(itemObj.note || p.note, cabinetSet.join(', '));
						tSheet.appendRow([
							new Date(),
							'領用',
							targetName,
							shortenedIds,
							totalQty * -1,
							itemObj.receiver || p.receiver,
							'',
							'完成',
							itemObj.handler || p.handler,
							txNote
						]);
						timing.writeTxMs += (new Date().getTime() - writeStart);
						successCount += totalQty;
					}
					timing.consumeScanMs += (new Date().getTime() - opStart);

					continue;
				}

				if (supermarket) {
					const pendingByRow = {};

					for (let i = 0; i < targetIds.length; i++) {
						if (leftToBorrow <= 0) break;
						const id = targetIds[i];
						let locInfo = assetIndex[id];
						let needRetry = false;

						if (!locInfo) {
							needRetry = true;
						} else {
							try {
								const checkIds = getCachedIdCell(locInfo.sheet, locInfo.row);
								if (!checkIds.includes(id)) needRetry = true;
							} catch (err) { needRetry = true; }
						}

						if (needRetry && !indexRebuilt) {
							assetIndex = buildAssetIndex();
							indexRebuilt = true;
							locInfo = assetIndex[id];
						}
						if (!locInfo) continue;

						const sheetKey = locInfo.sheet;
						const rowNum = locInfo.row;
						const sheet = getAssetLocationSheet(sheetKey);
						const rowValues = sheet.getRange(rowNum, 1, 1, 15).getValues()[0];
						const rowIds = String(rowValues[1] || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
						const currentStatus = String(rowValues[6]).trim();
						const outRule = String(rowValues[14] || '僅借用').trim() || '僅借用';
						if (currentStatus !== '在庫' && currentStatus !== '') continue;
						if (outRule === '僅領用') continue;
						if (!rowIds.includes(id)) continue;

						const key = sheetKey + '::' + rowNum;
						if (!pendingByRow[key]) pendingByRow[key] = { sheetKey: sheetKey, row: rowNum, ids: [], borrowCount: 0 };

						if (requestQty > 1) {
							const availInit = Number(rowValues[13]) || rowIds.length;
							if (availInit > 1) {
								pendingByRow[key].borrowCount = Math.min(leftToBorrow, availInit);
								pendingByRow[key].ids = [id];
								leftToBorrow -= pendingByRow[key].borrowCount;
								break;
							} else {
								// 這一列可借量只剩 1（或更少），無法一次滿足 >1 的需求，跟單件需求一樣只算這一列貢獻 1 件，
								// 不要 break，讓迴圈繼續找別列補足其餘數量。
								pendingByRow[key].ids.push(id);
								leftToBorrow--;
							}
						} else {
							pendingByRow[key].ids.push(id);
							leftToBorrow--;
						}
					}

					// 防呆：清掉沒有實際湊到任何數量的空殼項目，避免下面寫入迴圈把它當成合法項目、
					// 在試算表留下一列編號空白、狀態借出中、數量 0 的垃圾資料。
					Object.keys(pendingByRow).forEach(k => {
						const entry = pendingByRow[k];
						const hasIds = entry && Array.isArray(entry.ids) && entry.ids.length > 0;
						const hasBorrowCount = entry && Number(entry.borrowCount) > 0;
						if (!hasIds && !hasBorrowCount) delete pendingByRow[k];
					});

					// 保險機制：若送進來的 assetIds 與索引不一致，改用品名/位置回掃可借列，避免整筆失敗
					if (Object.keys(pendingByRow).length === 0 && leftToBorrow > 0) {
						const fallbackLocations = getLocationKeysCached();
						const targetLocation = String(itemObj.location || '').trim();
						for (let li = 0; li < fallbackLocations.length && leftToBorrow > 0; li++) {
							const sheetKey = fallbackLocations[li];
							const sheet = getAssetLocationSheet(sheetKey);
							const rows = sheet.getDataRange().getValues();
							for (let r = rows.length - 1; r >= 1 && leftToBorrow > 0; r--) {
								const rowValues = rows[r];
								const currentStatus = String(rowValues[6] || '').trim();
								const outRule = String(rowValues[14] || '僅借用').trim() || '僅借用';
								if (currentStatus !== '在庫' && currentStatus !== '') continue;
								if (outRule === '僅領用') continue;
								if (String(rowValues[2] || '').trim() !== targetName) continue;
								const rowDisplayLoc = String(rowValues[12] || '').trim() || sheetKey;
								if (targetLocation && rowDisplayLoc !== targetLocation) continue;
								const rowIds = String(rowValues[1] || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
								if (!rowIds.length) continue;
								const availInit = Number(rowValues[13]) || rowIds.length;
								if (availInit <= 0) continue;

								const rowNum = r + 1;
								const key = sheetKey + '::' + rowNum;
								pendingByRow[key] = {
									sheetKey: sheetKey,
									row: rowNum,
									ids: [rowIds[0]],
									borrowCount: Math.min(leftToBorrow, availInit)
								};
								leftToBorrow -= pendingByRow[key].borrowCount;
							}
						}
					}

					for (const k in pendingByRow) {
						const entry = pendingByRow[k];
						const sheet = getAssetLocationSheet(entry.sheetKey);
						const row = entry.row;
						const rowValues = sheet.getRange(row, 1, 1, 14).getValues()[0];
						const rowIds = String(rowValues[1] || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);

						const borrowCount = entry.borrowCount && Number(entry.borrowCount) > 0 ? Number(entry.borrowCount) : entry.ids.length;
						const origInit = Number(rowValues[13]) || rowIds.length;

						if (borrowCount >= origInit) {
							sheet.getRange(row, 7).setValue('借出中');
							sheet.getRange(row, 9).setValue(itemObj.receiver || p.receiver);
						} else {
							const newInit = origInit - borrowCount;
							try { sheet.getRange(row, 14).setValue(newInit); } catch (e) {}

							const newRow = [...rowValues];
							newRow[1] = entry.ids.join(', ');
							newRow[6] = '借出中';
							newRow[8] = itemObj.receiver || p.receiver;
							newRow[13] = borrowCount;
							sheet.appendRow(newRow);
							const newRowNum = sheet.getLastRow();
							upsertIndexEntries(assetIndex, entry.ids, entry.sheetKey, newRowNum);
						}

						if (entry.borrowCount && entry.borrowCount > 0 && entry.ids.length === 1) {
							const obj = { id: entry.ids[0], qty: entry.borrowCount, name: rowValues[2], spec: rowValues[5], color: rowValues[3], unit: rowValues[10], keeper: rowValues[7], location: String(rowValues[12] || '').trim() || entry.sheetKey };
							currentItemProcessed.push(obj);
							allProcessedAssetsBorrow.push(obj);
						} else {
							entry.ids.forEach(id => {
								const obj = { id: id, qty: 1, name: rowValues[2], spec: rowValues[5], color: rowValues[3], unit: rowValues[10], keeper: rowValues[7], location: String(rowValues[12] || '').trim() || entry.sheetKey };
								currentItemProcessed.push(obj);
								allProcessedAssetsBorrow.push(obj);
							});
						}
					}
				} else {
					for (let i = 0; i < targetIds.length; i++) {
						if (leftToBorrow <= 0) break;

						let id = targetIds[i];
						let locInfo = assetIndex[id];
						let needRetry = false;

						if (!locInfo) {
							needRetry = true;
						} else {
							try {
								const checkIds = getCachedIdCell(locInfo.sheet, locInfo.row);
								if (!checkIds.includes(id)) needRetry = true;
							} catch (err) {
								needRetry = true;
							}
						}

						if (needRetry && !indexRebuilt) {
							assetIndex = buildAssetIndex();
							indexRebuilt = true;
							locInfo = assetIndex[id];
						}

						if (!locInfo) continue;

						const sheet = getAssetLocationSheet(locInfo.sheet);
						const row = locInfo.row;
						const rowValues = sheet.getRange(row, 1, 1, 15).getValues()[0];
						const rowIdsStr = String(rowValues[1]);
						const currentStatus = String(rowValues[6]).trim();
						const outRule = String(rowValues[14] || '僅借用').trim() || '僅借用';

						if (currentStatus !== '在庫' && currentStatus !== '') continue;
						if (outRule === '僅領用') continue;

						if (rowIdsStr.includes(id)) {
							const rowIds = rowIdsStr.split(/[,，\s]+/).map(s => s.trim());
							const assetInfo = {
								id: id,
								name: rowValues[2],
								spec: rowValues[5],
								color: rowValues[3],
								unit: rowValues[10],
								keeper: rowValues[7],
								location: String(rowValues[12] || '').trim() || locInfo.sheet
							};

							if (rowIds.length === 1) {
								sheet.getRange(row, 7).setValue('借出中');
								sheet.getRange(row, 9).setValue(itemObj.receiver || p.receiver);
							} else {
								const stay = rowIds.filter(x => x !== id);
								sheet.getRange(row, 2).setValue(stay.join(', '));
								idCellCache[locInfo.sheet + '::' + row] = stay.join(', ');
								upsertIndexEntries(assetIndex, stay, locInfo.sheet, row);

								try {
									const origInit = Number(rowValues[13]) || rowIds.length;
									const newInit = Math.max(0, origInit - 1);
									sheet.getRange(row, 14).setValue(newInit);
								} catch (e) {}

								const newRow = [...rowValues];
								newRow[1] = id;
								newRow[6] = '借出中';
								newRow[8] = itemObj.receiver || p.receiver;
								newRow[13] = 1;
								sheet.appendRow(newRow);

								const newRowNum = sheet.getLastRow();
								upsertIndexEntries(assetIndex, [id], locInfo.sheet, newRowNum);
							}

							assetInfo.qty = 1;
							currentItemProcessed.push(assetInfo);
							allProcessedAssetsBorrow.push(assetInfo);
							leftToBorrow--;
						}
					}
				}

				if (currentItemProcessed.length > 0) {
					const writeStart = new Date().getTime();
					const shortenedIds = condenseIdList(currentItemProcessed.map(a => a.id));
					const totalQty = currentItemProcessed.reduce((s, it) => s + (Number(it.qty) || 1), 0);
					const normalizedReturnDate = normalizeDateToYmdText(itemObj.returnDate || p.returnDate || '');
					const cabinetSet = Array.from(new Set(currentItemProcessed.map(a => String(a.location || '').trim()).filter(Boolean)));
					const txNote = appendCabinetToNote(itemObj.note || p.note, cabinetSet.join(', '));
					tSheet.appendRow([
						new Date(),
						'借出',
						targetName,
						shortenedIds,
						totalQty * -1,
						itemObj.receiver || p.receiver,
						normalizedReturnDate,
						'待歸還',
						itemObj.handler || p.handler,
						txNote
					]);
					timing.writeTxMs += (new Date().getTime() - writeStart);
					successCount += totalQty;
				}
				timing.borrowScanMs += (new Date().getTime() - opStart);
			} else {
				const opStart = new Date().getTime();
				const dData = dSheet.getDataRange().getValues();
				let left = requestQty;
				let consumedCount = 0;
				const consumeLocations = [];
				const targetLocation = String(itemObj.location || '').trim();
				const targetColor = String(itemObj.color || '').trim();
				const targetColorKey = (!targetColor || targetColor === '無') ? '' : targetColor;

				for (let i = 1; i < dData.length; i++) {
					if (left <= 0) break;
					if (String(dData[i][3]).trim() === targetName) {
						const rowLocation = String(dData[i][6] || '').trim();
						if (targetLocation && rowLocation !== targetLocation) continue;
						const rowColor = String(dData[i][11] || '').trim();
						const rowColorKey = (!rowColor || rowColor === '無') ? '' : rowColor;
						if (targetColorKey && rowColorKey !== targetColorKey) continue;
						const stock = Number(dData[i][5]);
						if (stock > 0) {
							const take = Math.min(stock, left);
							dSheet.getRange(i + 1, 6).setValue(stock - take);
							consumeLocations.push(rowLocation);
							left -= take;
							consumedCount += take;
						}
					}
				}

				if (consumedCount > 0) {
					const writeStart = new Date().getTime();
					const cabinets = Array.from(new Set(consumeLocations.filter(Boolean)));
					const txNote = appendCabinetToNote(itemObj.note || p.note, cabinets.join(', '));
					cSheet.appendRow([
						new Date(),
						'領用',
						targetName,
						consumedCount * -1,
						itemObj.receiver || p.receiver,
						'完成',
						itemObj.handler || p.handler,
						txNote
					]);
					timing.writeTxMs += (new Date().getTime() - writeStart);
					successCount += consumedCount;
				}
				timing.consumeScanMs += (new Date().getTime() - opStart);
			}
		}

		if (consumedZeroDeleteLogs.length > 0) {
			const writeStart = new Date().getTime();
			consumedZeroDeleteLogs.forEach(log => {
				const txNoteBase = appendCabinetToNote(log.note, log.location || '');
				const sourceTag = '[刪列來源:' + String(log.sourceSheetKey || '') + '#' + String(log.sourceRowNum || 0) + ']';
				const txNote = txNoteBase ? (txNoteBase + ' ' + sourceTag) : sourceTag;
				tSheet.appendRow([
					new Date(),
					'領用歸零刪列',
					log.name,
					condenseIdList(log.ids || []),
					(Number(log.qty) || 0) * -1,
					log.receiver || '',
					'',
					'已刪列',
					log.handler || '',
					txNote
				]);
			});
			timing.writeTxMs += (new Date().getTime() - writeStart);
		}

		if (allProcessedAssetsBorrow.length > 0) {
			const notifyStart = new Date().getTime();
			const notifyMap = {};
			allProcessedAssetsBorrow.forEach(a => {
				const key = a.id || (a.name + '|' + a.spec);
				if (!notifyMap[key]) notifyMap[key] = Object.assign({}, a, { qty: 0 });
				notifyMap[key].qty = (Number(notifyMap[key].qty) || 0) + (Number(a.qty) || 1);
			});
			const notifyList = Object.keys(notifyMap).map(k => notifyMap[k]);
			distributeNotifications('借出', notifyList, p.receiver || itemsToProcess[0].receiver, p.note, normalizeDateToYmdText(p.returnDate));
			timing.notifyMs += (new Date().getTime() - notifyStart);
		}

		if (allProcessedAssetsConsume.length > 0) {
			const notifyStart = new Date().getTime();
			const notifyMapConsume = {};
			allProcessedAssetsConsume.forEach(a => {
				const key = a.id || (a.name + '|' + a.spec);
				if (!notifyMapConsume[key]) notifyMapConsume[key] = Object.assign({}, a, { qty: 0 });
				notifyMapConsume[key].qty = (Number(notifyMapConsume[key].qty) || 0) + (Number(a.qty) || 1);
			});
			const notifyListConsume = Object.keys(notifyMapConsume).map(k => notifyMapConsume[k]);
			distributeNotifications('領用', notifyListConsume, p.receiver || itemsToProcess[0].receiver, p.note, null);
			timing.notifyMs += (new Date().getTime() - notifyStart);
		}

		if (assetRowsDeleted) {
			assetIndex = buildAssetIndex();
		} else if (allProcessedAssetsBorrow.length > 0 || allProcessedAssetsConsume.length > 0) {
			saveAssetIndex(assetIndex);
		}

		const clearStart = new Date().getTime();
		invalidateCachesByEvent('assetMutation');
		timing.clearCacheMs += (new Date().getTime() - clearStart);

		const elapsedMs = new Date().getTime() - startTime;
		if (successCount > 0) {
			return {
				success: true,
				processedCount: successCount,
				elapsedMs: elapsedMs,
				timing: timing,
				message: '已完成 ' + successCount + ' 筆異動'
			};
		}

		return {
			success: false,
			elapsedMs: elapsedMs,
			timing: timing,
			message: (p && p.debug) ? debugLog.join('\n') : '未找到可處理項目，請重新整理後再試'
		};
	} catch (e) {
		const elapsedMs = new Date().getTime() - startTime;
		return {
			success: false,
			elapsedMs: elapsedMs,
			timing: timing,
			message: (p && p.debug)
				? ('系統錯誤:\n' + e.toString() + '\n\n' + debugLog.join('\n'))
				: ('系統錯誤: ' + e.toString())
		};
	} finally {
		lock.releaseLock();
	}
}

function returnAsset(p) {
	// 盤點鎖定檢查：禁止歸還
	const lockCheck = rejectIfStocktakeLocked('歸還');
	if (lockCheck) return lockCheck;

	const lock = LockService.getScriptLock();
	const startTime = new Date().getTime();
	const timing = { locateMs: 0, mergeLookupMs: 0, writeTxMs: 0, notifyMs: 0, clearCacheMs: 0 };
	let postNotifyPayload = null;
	let shouldClearFastCache = false;
	let result = null;
	try {
		lock.waitLock(30000);
		const tSheet = getSheet(TRANS_ASSETS_NAME);
		const rawReq = Array.isArray(p.assetIds) ? p.assetIds : String(p.assetIds).split(/[,，\s]+/).map(s => s.trim()).filter(s => s !== '');
		// qty 沒填（undefined/null/空字串）才預設 1 件；明確填了 0 或負數則保留原值，交給下面的 filter 濾掉，
		// 不要用 `|| 1` 悄悄把顯式的 0 蓋成 1。
		const requests = rawReq
			.map(r => {
				if (typeof r === 'object' && r !== null) {
					const rawQty = r.qty;
					const qtyOmitted = (rawQty === undefined || rawQty === null || rawQty === '');
					return { id: String(r.id || '').trim(), qty: qtyOmitted ? 1 : Number(rawQty) };
				}
				return { id: String(r || '').trim(), qty: 1 };
			})
			.filter(r => r.id !== '' && Number.isFinite(r.qty) && r.qty > 0);

		let processedAssets = [];
		const locations = getLocationKeysCached();
		let assetIndex = getAssetIndex();
		let borrowedAssetIndex = getBorrowedAssetIndex();
		let indexRebuilt = false;
		const mergeTargetCache = {};
		const rowCache = {};
		const pendingRowWrites = {};
		const mergeSearchIndex = {};
		let borrowedScanCache = null;
		let mergeSearchPrepared = false;

		function toMergeKey(status, itemName, itemSpec, itemColor, displayLoc, itemKeeper) {
			return [
				String(status || '').trim(),
				String(itemName || ''),
				String(itemSpec || ''),
				String(itemColor || ''),
				String(displayLoc || '').trim(),
				String(itemKeeper || '').trim()
			].join('||');
		}

		function primeMergeSearchIndex() {
			if (mergeSearchPrepared) return;
			mergeSearchPrepared = true;
			for (let locX of locations) {
				const sheet = getAssetLocationSheet(locX);
				const rows = sheet.getDataRange().getValues();
				for (let j = 1; j < rows.length; j++) {
					const rr = rows[j];
					const rrStatus = String(rr[6] || '').trim();
					if (!rrStatus) continue;
					const rrLoc = String(rr[12] || locX).trim();
					const rrKeeper = String(rr[7] || '').trim();
					const idxKey = toMergeKey(rrStatus, rr[2], rr[5], rr[3], rrLoc, rrKeeper);
					if (!mergeSearchIndex[idxKey]) {
						mergeSearchIndex[idxKey] = { sheet: locX, row: j + 1 };
					}
				}
			}
		}

		function getRowValuesBySheetRow(sheetKey, rowNum) {
			const cacheKey = String(sheetKey || '') + '::' + String(rowNum || '');
			if (Object.prototype.hasOwnProperty.call(pendingRowWrites, cacheKey)) {
				return pendingRowWrites[cacheKey].values;
			}
			if (Object.prototype.hasOwnProperty.call(rowCache, cacheKey)) return rowCache[cacheKey];
			const sh = getAssetLocationSheet(sheetKey);
			const row = sh.getRange(rowNum, 1, 1, 14).getValues()[0];
			rowCache[cacheKey] = row;
			return row;
		}

		function stageRowColumns(sheetKey, rowNum, changes) {
			const cacheKey = String(sheetKey || '') + '::' + String(rowNum || '');
			let staged = pendingRowWrites[cacheKey];
			if (!staged) {
				const base = getRowValuesBySheetRow(sheetKey, rowNum);
				staged = {
					sheet: sheetKey,
					row: rowNum,
					values: (base || []).slice(0, 14)
				};
				pendingRowWrites[cacheKey] = staged;
			}
			Object.keys(changes || {}).forEach(k => {
				const idx = Number(k) - 1;
				if (idx >= 0 && idx < 14) staged.values[idx] = changes[k];
			});
			rowCache[cacheKey] = staged.values;
		}

		function commitPendingRowWrites() {
			const keys = Object.keys(pendingRowWrites);
			for (let i = 0; i < keys.length; i++) {
				const item = pendingRowWrites[keys[i]];
				if (!item || !item.sheet || !item.row) continue;
				try {
					getAssetLocationSheet(item.sheet).getRange(item.row, 1, 1, 14).setValues([item.values]);
				} catch (e) {}
			}
		}

		function findMergeTargetRowInner(targetStatus, itemName, itemSpec, itemColor, displayLoc, itemKeeper) {
			const normalizedStatus = String(targetStatus || '在庫').trim() || '在庫';
			const normalizedLoc = String(displayLoc || '').trim();
			const normalizedKeeper = String(itemKeeper || '').trim();
			const cacheKey = toMergeKey(normalizedStatus, itemName, itemSpec, itemColor, normalizedLoc, normalizedKeeper);

			const validateCached = (cached) => {
				if (!cached || !cached.sheet || !cached.row) return null;
				try {
					const row = getRowValuesBySheetRow(cached.sheet, cached.row);
					const rowStatus = String(row[6] || '').trim();
					const rowLoc = String(row[12] || cached.sheet).trim();
					const rowKeeper = String(row[7] || '').trim();
					if (rowStatus !== normalizedStatus) return null;
					if (String(row[2] || '') !== String(itemName || '')) return null;
					if (String(row[5] || '') !== String(itemSpec || '')) return null;
					if (String(row[3] || '') !== String(itemColor || '')) return null;
					if (rowLoc !== normalizedLoc) return null;
					if (normalizedKeeper && rowKeeper !== normalizedKeeper) return null;
					return { sheet: cached.sheet, row: cached.row, values: row };
				} catch (e) {
					return null;
				}
			};

			const cached = validateCached(mergeTargetCache[cacheKey]);
			if (cached) return cached;

			primeMergeSearchIndex();
			const indexed = mergeSearchIndex[cacheKey];
			if (indexed) {
				const validated = validateCached(indexed);
				if (validated) {
					mergeTargetCache[cacheKey] = { sheet: validated.sheet, row: validated.row };
					return validated;
				}
				delete mergeSearchIndex[cacheKey];
			}

			return null;
		}

		function buildBorrowedScanCache() {
			if (borrowedScanCache) return borrowedScanCache;
			borrowedScanCache = {};
			for (let loc of locations) {
				const aSheet = getAssetLocationSheet(loc);
				const data = aSheet.getDataRange().getValues();
				for (let i = data.length - 1; i >= 1; i--) {
					const row = data[i];
					const status = String(row[6] || '').trim();
					if (status !== '借出中') continue;
					const rowIds = String(row[1] || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
					if (!rowIds.length) continue;
					for (let idx = 0; idx < rowIds.length; idx++) {
						const id = rowIds[idx];
						if (!borrowedScanCache[id]) {
							borrowedScanCache[id] = { loc: loc, rowNum: i + 1, rowValues: row };
						}
					}
				}
			}
			return borrowedScanCache;
		}

		function locateBorrowedRowInner(targetId) {
			const tryFromIndex = () => {
				const locInfo = borrowedAssetIndex[targetId];
				if (!locInfo || !locInfo.sheet || !locInfo.row) return null;

				try {
					const aSheet = getAssetLocationSheet(locInfo.sheet);
					const rowNum = Number(locInfo.row) || 0;
					if (rowNum < 2) return null;

					const rowValues = getRowValuesBySheetRow(locInfo.sheet, rowNum);
					const rowIds = String(rowValues[1] || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
					const status = String(rowValues[6] || '').trim();
					if (!(rowIds.includes(targetId) && status === '借出中')) return null;

					return { loc: locInfo.sheet, aSheet: aSheet, rowNum: rowNum, rowValues: rowValues };
				} catch (e) {
					return null;
				}
			};

			let found = tryFromIndex();
			if (found) return found;

			if (!indexRebuilt) {
				borrowedAssetIndex = buildBorrowedAssetIndex();
				indexRebuilt = true;
				found = tryFromIndex();
				if (found) return found;
			}

			const scan = buildBorrowedScanCache();
			const hit = scan[targetId];
			if (hit && hit.loc && hit.rowNum) {
				borrowedAssetIndex[targetId] = { sheet: hit.loc, row: hit.rowNum };
				upsertIndexEntries(assetIndex, [targetId], hit.loc, hit.rowNum);
				return { loc: hit.loc, aSheet: getAssetLocationSheet(hit.loc), rowNum: hit.rowNum, rowValues: hit.rowValues };
			}

			return null;
		}

		requests.forEach(req => {
			const locateStart = new Date().getTime();
			const targetId = req.id;
			const reqQty = Number(req.qty) || 1;
			const found = locateBorrowedRowInner(targetId);
			timing.locateMs += (new Date().getTime() - locateStart);
			if (!found) return;

			const loc = found.loc;
			const aSheet = found.aSheet;
			let rowNum = Number(found.rowNum) || 0;
			const rowValues = found.rowValues || [];
			let rowIds = String(rowValues[1] || '').split(/[,，\s]+/).map(s => s.trim()).filter(s => s !== '');
			let status = String(rowValues[6] || '').trim();
			if (!(rowIds.includes(targetId) && status === '借出中')) return;

			const origBorrowQty = Number(rowValues[13]) || rowIds.length;
			const actualQty = Math.max(1, Math.min(reqQty, origBorrowQty));
			const targetStatusNormalized = String(p.targetStatus || '').trim() || '在庫';
			const canMergeBackToStock = (targetStatusNormalized === '在庫');

			processedAssets.push({
				id: targetId,
				name: rowValues[2],
				spec: rowValues[5],
				color: rowValues[3],
				unit: rowValues[10],
				keeper: rowValues[7],
				status: targetStatusNormalized,
				location: String(rowValues[12] || '').trim() || loc,
				qty: actualQty
			});

			if (origBorrowQty > 1) {
				if (reqQty >= origBorrowQty) {
					const displayLoc = rowValues[12] || loc;
					let merged = false;
					if (canMergeBackToStock) {
						const mergeStart = new Date().getTime();
						const mergeTarget = findMergeTargetRowInner('在庫', rowValues[2], rowValues[5], rowValues[3], displayLoc, rowValues[7]);
						timing.mergeLookupMs += (new Date().getTime() - mergeStart);
						if (mergeTarget) {
							const rr = mergeTarget.values;
							const origInit = Number(rr[13]) || 0;
							const newInit = origInit + actualQty;
							stageRowColumns(mergeTarget.sheet, mergeTarget.row, { 14: newInit, 9: '' });
							if ((!rr[11] || String(rr[11]).trim() === '' || String(rr[11]).trim() === '無照片') && rowValues[11]) {
								stageRowColumns(mergeTarget.sheet, mergeTarget.row, { 12: rowValues[11] });
							}
							merged = true;
						}
					}
					if (merged) {
						const oldKey = String(loc || '') + '::' + String(rowNum || '');
						delete pendingRowWrites[oldKey];
						delete rowCache[oldKey];
						aSheet.deleteRow(rowNum);
					} else {
						stageRowColumns(loc, rowNum, { 7: targetStatusNormalized, 9: '', 14: actualQty });
					}
				} else {
					const newBorrowQty = Math.max(0, origBorrowQty - actualQty);
					stageRowColumns(loc, rowNum, { 14: newBorrowQty });

					const displayLoc2 = rowValues[12] || loc;
					let merged2 = false;
					let mergedReturnRowNum = -1;
					let mergedReturnSheetKey = null;
					if (canMergeBackToStock) {
						const mergeStart = new Date().getTime();
						const mergeTarget2 = findMergeTargetRowInner('在庫', rowValues[2], rowValues[5], rowValues[3], displayLoc2, rowValues[7]);
						timing.mergeLookupMs += (new Date().getTime() - mergeStart);
						if (mergeTarget2) {
							const rr = mergeTarget2.values;
							const origInit = Number(rr[13]) || 0;
							const newInit = origInit + actualQty;
							stageRowColumns(mergeTarget2.sheet, mergeTarget2.row, { 14: newInit, 9: '' });
							merged2 = true;
							mergedReturnRowNum = mergeTarget2.row;
							mergedReturnSheetKey = mergeTarget2.sheet;
						}
					}

					if (merged2) {
						upsertIndexEntries(assetIndex, [targetId], mergedReturnSheetKey, mergedReturnRowNum);
					} else {
						const nr = [...rowValues];
						nr[1] = targetId;
						nr[6] = targetStatusNormalized;
						nr[8] = '';
						nr[13] = actualQty;
						aSheet.appendRow(nr);
						const newRowNum = aSheet.getLastRow();
						upsertIndexEntries(assetIndex, [targetId], loc, newRowNum);
						const newMergeKey = toMergeKey(nr[6], nr[2], nr[5], nr[3], nr[12] || loc, nr[7]);
						if (!mergeSearchIndex[newMergeKey]) mergeSearchIndex[newMergeKey] = { sheet: loc, row: newRowNum };
					}
				}
			} else {
				if (rowIds.length === 1) {
					stageRowColumns(loc, rowNum, { 7: targetStatusNormalized, 9: '' });
					upsertIndexEntries(assetIndex, [targetId], loc, rowNum);
				} else {
					const remainingIds = rowIds.filter(x => x !== targetId);
					stageRowColumns(loc, rowNum, { 2: remainingIds.join(', ') });
					upsertIndexEntries(assetIndex, remainingIds, loc, rowNum);
					const nr = [...rowValues];
					nr[1] = targetId;
					nr[6] = targetStatusNormalized;
					nr[8] = '';
					aSheet.appendRow(nr);
					const newRowNum = aSheet.getLastRow();
					upsertIndexEntries(assetIndex, [targetId], loc, newRowNum);
				}
			}
		});

		commitPendingRowWrites();

		if (processedAssets.length > 0) {
			const writeStart = new Date().getTime();
			const shortenedIds = condenseIdList(processedAssets.map(a => a.id));
			const totalQty = processedAssets.reduce((s, it) => s + (Number(it.qty) || 1), 0);
			const itemSummaryMap = {};
			processedAssets.forEach(a => {
				const itemKey = [String(a.name || ''), String(a.spec || ''), String(a.color || '')].join('|');
				if (!itemSummaryMap[itemKey]) itemSummaryMap[itemKey] = { name: a.name, spec: a.spec, color: a.color, qty: 0 };
				itemSummaryMap[itemKey].qty += Number(a.qty) || 1;
			});
			const itemSummary = Object.keys(itemSummaryMap).map(k => {
				const it = itemSummaryMap[k];
				const specPart = it.spec ? (' [' + it.spec + ']') : '';
				const colorPart = (it.color && it.color !== '無') ? (' (' + it.color + ')') : '';
				return String(it.name || '') + specPart + colorPart + ' x' + it.qty;
			}).join('；');
			const itemTitle = itemSummary ? ('批量歸還: ' + itemSummary) : ('批量歸還 (' + totalQty + ' 件)');
			const cabinetSet = Array.from(new Set(processedAssets.map(a => String(a.location || '').trim()).filter(Boolean)));
			const txNote = appendCabinetToNote(p.note, cabinetSet.join(', '));
			tSheet.appendRow([
				new Date(),
				'歸還',
				itemTitle,
				shortenedIds,
				totalQty,
				p.handler,
				'',
				String(p.targetStatus || '').trim() || '在庫',
				p.handler,
				txNote
			]);
			timing.writeTxMs += (new Date().getTime() - writeStart);

			postNotifyPayload = { type: '歸還', assets: processedAssets.slice(), person: p.handler, note: p.note || '', returnDate: null };
			shouldClearFastCache = true;
			// 批次借出可能只用代表 ID 記錄，直接刪除索引鍵會遺漏仍在借出的列；此處重建一次借出索引確保一致性。
			borrowedAssetIndex = buildBorrowedAssetIndex();
			saveAssetIndex(assetIndex);
			saveBorrowedAssetIndex(borrowedAssetIndex);
		}

		if (processedAssets.length === 0) {
			result = { success: false, count: 0, message: '未找到可歸還項目，請重新整理後再試' };
		} else {
			result = { success: true, count: processedAssets.length };
		}
	} catch (e) {
		result = { success: false, message: e.toString() };
	} finally {
		lock.releaseLock();
	}

	if (postNotifyPayload) {
		const notifyStart = new Date().getTime();
		try {
			distributeNotifications(postNotifyPayload.type, postNotifyPayload.assets, postNotifyPayload.person, postNotifyPayload.note, postNotifyPayload.returnDate);
		} catch (e) {}
		timing.notifyMs += (new Date().getTime() - notifyStart);
	}

	if (shouldClearFastCache) {
		const clearStart = new Date().getTime();
		try {
			// Event-scoped invalidation keeps consistency while avoiding unnecessary cold starts.
			invalidateCachesByEvent('returnAsset');
		} catch (e) {}
		timing.clearCacheMs += (new Date().getTime() - clearStart);
	}

	if (!result) result = { success: false, message: '系統錯誤：未取得執行結果' };
	result.elapsedMs = new Date().getTime() - startTime;
	result.timing = timing;
	return result;
}

function debugAssets() {
	const result = getAvailableAssetsFull();
	result.forEach(a => {
		console.log(`📦 ${a.name} | 規格:${a.spec} | 顏色:${a.color} | 位置:${a.location} | 狀態:${a.status} | Count:${a.count} | IDs:${Array.isArray(a.ids) ? a.ids.join(', ') : a.id}`);
	});
	return result;
}

function debugRowsForId(targetId) {
	const locations = getLocationKeysCached();
	const out = [];
	locations.forEach(loc => {
		const sheet = getAssetLocationSheet(loc);
		const rows = sheet.getDataRange().getValues();
		for (let i = 1; i < rows.length; i++) {
			const r = rows[i];
			const ids = String(r[1] || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
			if (ids.includes(String(targetId).trim())) {
				const info = {
					sheet: loc,
					row: i + 1,
					idCell: r[1],
					name: r[2],
					status: r[6],
					initQty: r[13],
					fullRow: r
				};
				console.log(JSON.stringify(info));
				out.push(info);
			}
		}
	});
	return out;
}

function fixDriveViewUrl(url) {
	if (!url) return '';
	try {
		const m = String(url).match(/\/d\/([a-zA-Z0-9_-]+)/);
		if (m && m[1]) return 'https://drive.google.com/uc?export=view&id=' + m[1];
	} catch (e) {}
	return String(url || '').trim();
}
