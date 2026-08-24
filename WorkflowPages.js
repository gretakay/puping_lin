function normalizeWorkflowKeyword(value) {
	return String(value || '').trim().toLowerCase();
}

function getTransferLocationList() {
	try {
		return getLocationList();
	} catch (e) {
		return [];
	}
}

function searchTransferCandidates(keyword, limit) {
	try {
		const kw = normalizeWorkflowKeyword(keyword);
		const maxCount = Math.max(1, Number(limit) || 20);
		const assets = getAvailableAssetsFull(true) || [];

		const items = assets
			.filter(item => {
				if (String(item.status || '').trim() !== '在庫') return false;
				if (!kw) return true;
				const searchText = [item.id, item.name, item.spec, item.color, item.location, item.keeper, item.unit, item.category]
					.map(v => String(v || '').trim())
					.join(' ')
					.toLowerCase();
				return searchText.indexOf(kw) > -1;
			})
			.slice(0, maxCount)
			.map(item => ({
				assetId: String(item.id || ''),
				itemName: String(item.name || ''),
				fromLocation: String(item.location || ''),
				availableQty: Number(item.count) || (Array.isArray(item.ids) ? item.ids.length : 1),
				status: String(item.status || '在庫'),
				keeper: String(item.keeper || ''),
				unit: String(item.unit || '件'),
				photoUrl: String(item.photoUrl || '')
			}));

		return { success: true, items: items };
	} catch (err) {
		return { success: false, message: err.toString(), items: [] };
	}
}

function normalizeTransferLocationName(value) {
	return String(value || '').trim();
}

function getTransferActorEmail() {
	return String((Session.getActiveUser() && Session.getActiveUser().getEmail()) || (Session.getEffectiveUser() && Session.getEffectiveUser().getEmail()) || 'unknown@unknown').trim();
}

function getTransferTokenConfig() {
	const props = PropertiesService.getScriptProperties();
	return String(props.getProperty('TRANSFER_SHARED_TOKEN') || '').trim();
}

function verifyTransferAccessToken(token) {
	const configured = getTransferTokenConfig();
	if (!configured) {
		// 未設定 TRANSFER_SHARED_TOKEN，跳過驗證
		return { success: true, tokenId: 'no-token' };
	}
	const raw = String(token || '').trim();
	if (!raw) {
		return { success: false, code: 'E_AUTH_TOKEN_INVALID', message: '此系統已設定移轉授權碼，請填寫後再送出。' };
	}
	if (raw !== configured) {
		return { success: false, code: 'E_AUTH_TOKEN_INVALID', message: '移轉授權碼不正確。' };
	}
	return { success: true, tokenId: 'shared-token' };
}

function generateTransferNo() {
	return 'TR-' + Utilities.formatDate(new Date(), 'GMT+8', 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 9000 + 1000);
}

function findTransferRequestRecord(sheet, requestId) {
	const reqId = String(requestId || '').trim();
	if (!reqId) return null;
	const lastRow = sheet.getLastRow();
	if (lastRow <= 1) return null;
	const values = sheet.getRange(2, 1, lastRow - 1, 16).getValues();
	for (let i = values.length - 1; i >= 0; i--) {
		if (String(values[i][2] || '').trim() !== reqId) continue;
		return {
			row: i + 2,
			values: values[i],
			status: String(values[i][12] || '').trim(),
			transferNo: String(values[i][1] || '').trim(),
			message: String(values[i][14] || '').trim(),
			errorCode: String(values[i][13] || '').trim()
		};
	}
	return null;
}

function appendTransferRequestLog(sheet, row) {
	sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

function executeAssetTransfer(payload) {
	const lockCheck = rejectIfStocktakeLocked('移轉');
	if (lockCheck) return lockCheck;

	const requestId = String(payload && payload.requestId || '').trim();
	const token = String(payload && payload.token || '').trim();
	const assetId = String(payload && payload.assetId || '').trim();
	const fromLocation = normalizeTransferLocationName(payload && payload.fromLocation);
	const toLocationInput = normalizeTransferLocationName(payload && payload.toLocation);
	const toKeeperInput = String(payload && payload.toKeeper || '').trim();
	const reason = String(payload && payload.reason || '').trim();
	const operator = String(payload && payload.operator || '').trim();
	const transferQty = Math.floor(Number(payload && payload.transferQty));
	const authEmail = getTransferActorEmail();

	if (!requestId || !assetId || !fromLocation || !toLocationInput || !reason || !operator || !Number.isFinite(transferQty) || transferQty <= 0) {
		return { success: false, code: 'E_INPUT_INVALID', message: '移轉資料不完整，請確認資產、位置、數量、原因與經手人。' };
	}
	if (fromLocation === toLocationInput) {
		return { success: false, code: 'E_INPUT_INVALID', message: '新位置不可與舊位置相同。' };
	}

	const tokenCheck = verifyTransferAccessToken(token);
	if (!tokenCheck.success) return tokenCheck;

	const lock = LockService.getScriptLock();
	try {
		lock.waitLock(30000);

		const requestSheet = getSheet(TRANSFER_REQUESTS_NAME);
		const existing = findTransferRequestRecord(requestSheet, requestId);
		if (existing) {
			if (existing.status === '已完成') {
				return {
					success: true,
					transferNo: existing.transferNo,
					status: existing.status,
					message: existing.message || '此 requestId 已完成，不重複執行。',
					idempotent: true
				};
			}
			return {
				success: false,
				code: existing.errorCode || 'E_REQ_DUPLICATE',
				message: existing.message || '此 requestId 已處理過，且前次失敗。',
				idempotent: true
			};
		}

		const validLocations = new Set((getLocationList() || []).map(x => String(x || '').trim()).filter(Boolean));
		const mappedToLocation = mapLocationKeyForWrite(toLocationInput);
		const toLocation = validLocations.has(toLocationInput) ? toLocationInput : (validLocations.has(mappedToLocation) ? mappedToLocation : '');
		if (!toLocation) {
			const failMessage = '找不到目的位置，請從位置清單中重新選擇。';
			appendTransferRequestLog(requestSheet, [new Date(), '', requestId, tokenCheck.tokenId || '', assetId, String(payload && payload.itemName || '').trim(), fromLocation, toLocationInput, transferQty, reason, operator, authEmail, '失敗', 'E_LOCATION_NOT_FOUND', failMessage, '']);
			return { success: false, code: 'E_LOCATION_NOT_FOUND', message: failMessage };
		}

		let assetIndex = getAssetIndex() || {};
		const hit = assetIndex[assetId];
		if (!hit || !hit.sheet || !hit.row) {
			const failMessage = '找不到資產索引，請重新查詢後再試。';
			appendTransferRequestLog(requestSheet, [new Date(), '', requestId, tokenCheck.tokenId || '', assetId, String(payload && payload.itemName || '').trim(), fromLocation, toLocation, transferQty, reason, operator, authEmail, '失敗', 'E_ASSET_NOT_FOUND', failMessage, '']);
			return { success: false, code: 'E_ASSET_NOT_FOUND', message: failMessage };
		}

		const sourceSheetKey = String(hit.sheet || '').trim();
		const sourceSheet = getAssetLocationSheet(sourceSheetKey);
		const sourceRowNum = Number(hit.row) || 0;
		if (sourceRowNum <= 1) {
			const failMessage = '來源列位置無效，請重新查詢後再試。';
			appendTransferRequestLog(requestSheet, [new Date(), '', requestId, tokenCheck.tokenId || '', assetId, String(payload && payload.itemName || '').trim(), fromLocation, toLocation, transferQty, reason, operator, authEmail, '失敗', 'E_ASSET_NOT_FOUND', failMessage, '']);
			return { success: false, code: 'E_ASSET_NOT_FOUND', message: failMessage };
		}

		const sourceRow = sourceSheet.getRange(sourceRowNum, 1, 1, 17).getValues()[0];
		const sourceIds = String(sourceRow[1] || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
		const sourceStatus = String(sourceRow[6] || '').trim() || '在庫';
		const sourceKeeper = String(sourceRow[7] || '').trim() || '庫房';
		const sourceLocation = String(sourceRow[12] || sourceSheetKey).trim() || sourceSheetKey;
		const sourceQty = Number(sourceRow[13]) || 0;
		const availableQty = sourceQty > 0 ? sourceQty : sourceIds.length;
		const targetKeeper = toKeeperInput || sourceKeeper;

		// 使用 sourceLocation 作為實際來源（無論前端傳入的 fromLocation 為何）
		const effectiveFromLocation = sourceLocation;

		if (sourceStatus !== '在庫') {
			const failMessage = '此資產目前不是在庫狀態，無法移轉。';
			appendTransferRequestLog(requestSheet, [new Date(), '', requestId, tokenCheck.tokenId || '', assetId, String(sourceRow[2] || '').trim(), fromLocation, toLocation, transferQty, reason, operator, authEmail, '失敗', 'E_ASSET_STATUS_INVALID', failMessage, '']);
			return { success: false, code: 'E_ASSET_STATUS_INVALID', message: failMessage };
		}
		if (sourceIds.indexOf(assetId) === -1) {
			const failMessage = '資產索引與來源資料不一致，請重新查詢後再試。';
			appendTransferRequestLog(requestSheet, [new Date(), '', requestId, tokenCheck.tokenId || '', assetId, String(sourceRow[2] || '').trim(), effectiveFromLocation, toLocation, transferQty, reason, operator, authEmail, '失敗', 'E_ASSET_NOT_FOUND', failMessage, '']);
			return { success: false, code: 'E_ASSET_NOT_FOUND', message: failMessage };
		}
		if (transferQty > availableQty) {
			const failMessage = '移轉數量（' + transferQty + '）超過目前可移轉量（' + availableQty + '）。';
			appendTransferRequestLog(requestSheet, [new Date(), '', requestId, tokenCheck.tokenId || '', assetId, String(sourceRow[2] || '').trim(), effectiveFromLocation, toLocation, transferQty, reason, operator, authEmail, '失敗', 'E_QTY_EXCEED_AVAILABLE', failMessage, '']);
			return { success: false, code: 'E_QTY_EXCEED_AVAILABLE', message: failMessage };
		}

		// 一個編號代表整批數量的列（例如超商模式建檔），編號跟件數不是一對一，
		// 部分數量移轉時不能用陣列切片分編號，兩邊都要保留同一個編號，只有全部移轉光才清空來源編號。
		const isBatchStyleRow = sourceIds.length === 1 && availableQty > 1;
		const nextSourceQty = availableQty - transferQty;
		const movedIds = isBatchStyleRow ? sourceIds.slice() : sourceIds.slice(0, transferQty);
		const remainingIds = isBatchStyleRow
			? (nextSourceQty > 0 ? sourceIds.slice() : [])
			: sourceIds.slice(transferQty);
		const stamp = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd HH:mm:ss');
		const toDisplayLocation = toLocation;
		const toSheetKey = mapLocationKeyForWrite(toDisplayLocation);
		const sourceOldTransferLog = String(sourceRow[16] || '').trim();
		const transferNote = '[位置移轉 ' + stamp + ' ' + authEmail + '] ' + effectiveFromLocation + ' -> ' + toDisplayLocation + '，保管人=' + sourceKeeper + ' -> ' + targetKeeper + '，數量=' + transferQty + '，經手人=' + operator + '，原因=' + reason;
		sourceRow[1] = remainingIds.join(', ');
		sourceRow[6] = nextSourceQty > 0 ? '在庫' : '已使用完';
		sourceRow[16] = sourceOldTransferLog ? (sourceOldTransferLog + ' | ' + transferNote) : transferNote;
		sourceRow[13] = nextSourceQty;
		sourceSheet.getRange(sourceRowNum, 1, 1, 17).setValues([sourceRow]);

		const destinationHit = findMergeTargetRow('在庫', String(sourceRow[2] || '').trim(), String(sourceRow[5] || '').trim(), String(sourceRow[3] || '').trim(), toDisplayLocation, [toSheetKey], {}, targetKeeper);
		let destinationSheet = getAssetLocationSheet(toSheetKey);
		let destinationRowNum = 0;
		if (destinationHit && destinationHit.sheet && destinationHit.row) {
			destinationSheet = getAssetLocationSheet(destinationHit.sheet);
			destinationRowNum = Number(destinationHit.row) || 0;
			const destinationRow = destinationHit.values || destinationSheet.getRange(destinationRowNum, 1, 1, 17).getValues()[0];
			const destinationIds = String(destinationRow[1] || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
			const destinationQty = Number(destinationRow[13]) || 0;
			const destinationOldTransferLog = String(destinationRow[16] || '').trim();
			destinationRow[1] = destinationIds.concat(movedIds).join(', ');
			destinationRow[6] = '在庫';
			destinationRow[7] = targetKeeper;
			destinationRow[16] = destinationOldTransferLog ? (destinationOldTransferLog + ' | ' + transferNote) : transferNote;
			destinationRow[12] = toDisplayLocation;
			destinationRow[13] = (destinationQty > 0 ? destinationQty : destinationIds.length) + transferQty;
			destinationSheet.getRange(destinationRowNum, 1, 1, 17).setValues([destinationRow]);
		} else {
			const newRow = sourceRow.slice();
			newRow[0] = new Date();
			newRow[1] = movedIds.join(', ');
			newRow[6] = '在庫';
			newRow[7] = targetKeeper;
			newRow[8] = '';
			newRow[12] = toDisplayLocation;
			newRow[13] = transferQty;
			newRow[16] = transferNote;
			destinationSheet.appendRow(newRow);
			destinationRowNum = destinationSheet.getLastRow();
		}

		removeIndexEntries(assetIndex, movedIds);
		if (remainingIds.length > 0) {
			upsertIndexEntries(assetIndex, remainingIds, sourceSheetKey, sourceRowNum);
		}
		upsertIndexEntries(assetIndex, movedIds, toSheetKey, destinationRowNum);
		saveAssetIndex(assetIndex);

		const transferNo = generateTransferNo();
		getSheet(TRANS_ASSETS_NAME).appendRow([
			new Date(),
			'移轉',
			String(sourceRow[2] || '').trim(),
			movedIds.join(', '),
			transferQty,
			effectiveFromLocation + ' -> ' + toDisplayLocation,
			'在庫',
			operator,
			'在庫'
		]);
		appendTransferRequestLog(requestSheet, [new Date(), transferNo, requestId, tokenCheck.tokenId || '', assetId, String(sourceRow[2] || '').trim(), effectiveFromLocation, toDisplayLocation, transferQty, reason, operator, authEmail, '已完成', '', '移轉完成', new Date()]);
		invalidateCachesByEvent('assetMutation');

		return {
			success: true,
			transferNo: transferNo,
			status: '已完成',
			message: '資產已成功移轉到「' + toDisplayLocation + '」。',
			movedIds: movedIds,
			idempotent: false
		};
	} catch (err) {
		const message = String(err || '系統錯誤');
		if (message.indexOf('Service invoked too many times') > -1 || message.indexOf('Lock') > -1) {
			return { success: false, code: 'E_LOCK_TIMEOUT', message: '系統忙碌中，請稍後再試。' };
		}
		return { success: false, code: 'E_INTERNAL', message: message };
	} finally {
		lock.releaseLock();
	}
}

function getStocktakeLockState() {
	const props = PropertiesService.getScriptProperties();
	return {
		locked: String(props.getProperty('STOCKTAKE_LOCKED') || '').toLowerCase() === 'true',
		note: String(props.getProperty('STOCKTAKE_LOCK_NOTE') || ''),
		updatedAt: String(props.getProperty('STOCKTAKE_LOCK_UPDATED') || '')
	};
}

function setStocktakeLock(locked, note) {
	const props = PropertiesService.getScriptProperties();
	const isLocked = !!locked;
	props.setProperty('STOCKTAKE_LOCKED', isLocked ? 'true' : 'false');
	props.setProperty('STOCKTAKE_LOCK_NOTE', String(note || '').trim());
	props.setProperty('STOCKTAKE_LOCK_UPDATED', new Date().toISOString());
	return { success: true, locked: isLocked, note: String(note || '').trim() };
}

function setNineGridTarget(locationName) {
	try {
		const cleanName = String(locationName || '').trim();
		if (!cleanName) {
			return { success: false, message: 'empty location' };
		}

		const props = PropertiesService.getUserProperties();
		props.setProperty('NINE_GRID_TARGET_LOC', cleanName);
		props.setProperty('NINE_GRID_TARGET_AT', String(Date.now()));

		return {
			success: true,
			location: cleanName,
			updatedAt: Number(props.getProperty('NINE_GRID_TARGET_AT') || Date.now())
		};
	} catch (err) {
		return { success: false, message: String(err || 'unknown error') };
	}
}

function getInventoryCorrectionData(includeSangha) {
	try {
		// 盤點回寫是逐「位置表列」更新，這裡也必須逐列取數，避免聚合後帳面數與實際回寫列不一致。
		const rawSettings = getCategorySettings();
		const prefixMap = rawSettings && rawSettings.prefixMap ? rawSettings.prefixMap : {};
		const locations = getLocationKeysCached();
		const items = [];

		locations.forEach(loc => {
			const sheet = getAssetLocationSheet(loc);
			const lastRow = sheet.getLastRow();
			if (lastRow <= 1) return;

			const rows = sheet.getDataRange().getValues();
			for (let i = 1; i < rows.length; i++) {
				const r = rows[i];
				const status = String(r[6] || '').trim();
				if (status !== '在庫') continue;

				const ids = String(r[1] || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
				const primaryId = ids[0] || '';
				if (!primaryId) continue;

				const initQty = Number(r[13]) || 0;
				const bookQty = initQty > 0 ? initQty : ids.length;
				const prefixMatch = primaryId.match(/^([A-Z]+)/);
				const prefix = prefixMatch ? prefixMatch[1] : '';
				const locationName = String(r[12] || loc || '').trim();

				items.push({
					primaryId: primaryId,
					name: String(r[2] || ''),
					location: locationName,
					bookQty: bookQty,
					unit: String(r[10] || '件'),
					category: String(prefixMap[prefix] || '未分類'),
					color: String(r[3] || '無'),
					photoUrl: String(r[11] || ''),
					keeper: String(r[7] || '庫房'),
					spec: String(r[5] || ''),
					actualQty: '',
					diffQty: 0,
					adjustStatus: '待校正'
				});
			}
		});

		items.sort((a, b) => {
			const byName = String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
			if (byName !== 0) return byName;
			return String(a.location || '').localeCompare(String(b.location || ''), 'zh-Hant');
		});

		return {
			success: true,
			items: items,
			locked: getStocktakeLockState().locked,
			lockInfo: getStocktakeLockState()
		};
	} catch (err) {
		return { success: false, message: err.toString(), items: [], locked: false, lockInfo: getStocktakeLockState() };
	}
}

function checkStocktakeLocked() {
	const lockState = getStocktakeLockState();
	return !!lockState.locked;
}

function rejectIfStocktakeLocked(operation) {
	if (checkStocktakeLocked()) {
		return {
			success: false,
			message: `盤點進行中，暫時禁止「${operation}」操作。請等盤點結束後再進行。`,
			code: 'E_STOCKTAKE_LOCKED'
		};
	}
	return null;
}

function applyStocktakeCorrections(payload) {
	if (!checkStocktakeLocked()) {
		return {
			success: false,
			message: '請先開啟盤點鎖定，再執行盤點校正回寫。',
			code: 'E_STOCKTAKE_UNLOCKED'
		};
	}

	const reqRows = payload && Array.isArray(payload.rows) ? payload.rows : [];
	if (reqRows.length === 0) {
		return { success: false, message: '沒有可回寫的差異資料。', code: 'E_NO_ROWS' };
	}

	const operator = String((Session.getActiveUser() && Session.getActiveUser().getEmail()) || (Session.getEffectiveUser() && Session.getEffectiveUser().getEmail()) || 'unknown@unknown').trim();
	const commonReason = String(payload && payload.reason || '').trim();
	const lock = LockService.getScriptLock();
	const now = new Date();
	const sanitizeReasonText = (v) => String(v == null ? '' : v)
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	const normalizeAssetToken = (v) => String(v == null ? '' : v).trim().toUpperCase();
	const tokenContainsAssetId = (token, targetId) => {
		const t = normalizeAssetToken(token);
		const id = normalizeAssetToken(targetId);
		if (!t || !id) return false;
		if (t === id) return true;
		if (t.indexOf('~') === -1) return false;

		const parts = t.split('~');
		if (parts.length !== 2) return false;
		const left = normalizeAssetToken(parts[0]);
		const right = normalizeAssetToken(parts[1]);

		const lm = left.match(/^([A-Z]*)(\d+)$/);
		const im = id.match(/^([A-Z]*)(\d+)$/);
		if (!lm || !im) return false;

		const leftPrefix = lm[1] || '';
		const leftNumStr = lm[2];
		const leftNum = Number(leftNumStr);
		if (!Number.isFinite(leftNum) || im[1] !== leftPrefix) return false;

		let rightNum = NaN;
		const rm = right.match(/^([A-Z]*)(\d+)$/);
		if (rm) {
			if ((rm[1] || leftPrefix) !== leftPrefix) return false;
			rightNum = Number(rm[2]);
		} else if (/^\d+$/.test(right)) {
			const width = leftNumStr.length;
			if (right.length > width) return false;
			rightNum = Number(leftNumStr.slice(0, width - right.length) + right);
		}
		if (!Number.isFinite(rightNum)) return false;

		const lo = Math.min(leftNum, rightNum);
		const hi = Math.max(leftNum, rightNum);
		const n = Number(im[2]);
		return Number.isFinite(n) && n >= lo && n <= hi;
	};
	const findStocktakeTargetRow = (assetId, expectedLocation) => {
		const targetLoc = String(expectedLocation || '').trim();
		const locations = getLocationKeysCached();
		let firstHit = null;
		for (let i = 0; i < locations.length; i++) {
			const loc = locations[i];
			const sheet = getAssetLocationSheet(loc);
			const lastRow = sheet.getLastRow();
			if (lastRow <= 1) continue;
			const rows = sheet.getDataRange().getValues();
			for (let r = 1; r < rows.length; r++) {
				const rowValues = rows[r];
				const status = String(rowValues[6] || '').trim();
				if (status !== '在庫') continue;
				const ids = String(rowValues[1] || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
				const hasId = ids.some(idToken => tokenContainsAssetId(idToken, assetId));
				if (!hasId) continue;
				const rowLocation = String(rowValues[12] || loc || '').trim();
				const hit = { sheetKey: loc, rowNum: r + 1, rowValues: rowValues };
				if (targetLoc && rowLocation === targetLoc) return hit;
				if (!firstHit) firstHit = hit;
			}
		}
		if (targetLoc) return null;
		return firstHit;
	};

	try {
		lock.waitLock(30000);

		let assetIndex = getAssetIndex() || {};
		const txRows = [];
		const failures = [];
		let updated = 0;
		let retriedIndex = false;

			reqRows.forEach((entry, idx) => {
			const primaryId = String(entry && entry.primaryId || '').trim();
			const actualQtyRaw = Number(entry && entry.actualQty);
			if (!primaryId) {
				failures.push({ index: idx, reason: '缺少資產編號' });
				return;
			}
			if (!Number.isFinite(actualQtyRaw) || actualQtyRaw < 0) {
				failures.push({ index: idx, assetId: primaryId, reason: '實盤數量格式錯誤' });
				return;
			}

			let hit = assetIndex[primaryId];
			if ((!hit || !hit.sheet || !hit.row) && !retriedIndex) {
				assetIndex = buildAssetIndex() || {};
				retriedIndex = true;
				hit = assetIndex[primaryId];
			}

			let sheet = null;
			let rowNum = 0;
			let rowValues = null;
			if (hit && hit.sheet && hit.row) {
				sheet = getAssetLocationSheet(hit.sheet);
				rowNum = Number(hit.row);
				if (Number.isFinite(rowNum) && rowNum > 1) {
					rowValues = sheet.getRange(rowNum, 1, 1, 15).getValues()[0];
				}
			}

			const expectedLocation = String(entry && entry.location || '').trim();
			const hitLocation = rowValues ? String(rowValues[12] || hit.sheet || '').trim() : '';
			if (!rowValues || (expectedLocation && hitLocation && expectedLocation !== hitLocation)) {
				const fallback = findStocktakeTargetRow(primaryId, expectedLocation);
				if (fallback) {
					hit = { sheet: fallback.sheetKey, row: fallback.rowNum };
					sheet = getAssetLocationSheet(fallback.sheetKey);
					rowNum = Number(fallback.rowNum);
					rowValues = fallback.rowValues;
					assetIndex[primaryId] = { sheet: fallback.sheetKey, row: fallback.rowNum };
				}
			}

			const resolvedLocation = rowValues ? String(rowValues[12] || hit.sheet || '').trim() : '';
			if (expectedLocation && resolvedLocation && expectedLocation !== resolvedLocation) {
				failures.push({ index: idx, assetId: primaryId, reason: '回寫目標位置不一致（預期 ' + expectedLocation + '，實際 ' + resolvedLocation + '）' });
				return;
			}

			if (!rowValues || !sheet || !Number.isFinite(rowNum) || rowNum <= 1) {
				failures.push({ index: idx, assetId: primaryId, reason: '找不到可回寫的在庫列（可能位置或索引不一致）' });
				return;
			}

			const originalIds = String(rowValues[1] || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
			const oldStatus = String(rowValues[6] || '').trim() || '在庫';
			const oldQty = Number(rowValues[13]) || 0;
			const currentQty = oldQty > 0 ? oldQty : originalIds.length;
			const nextQty = Math.floor(actualQtyRaw);
			const diff = nextQty - currentQty;
			if (diff === 0) return;

			const hasPrimaryId = originalIds.some(idToken => tokenContainsAssetId(idToken, primaryId));
			if (originalIds.length > 0 && !hasPrimaryId) {
				failures.push({ index: idx, assetId: primaryId, reason: '索引與資料不一致，請重整後再試' });
				return;
			}

			let nextIds = originalIds.slice();
			if (nextQty === 0) {
				nextIds = [];
			} else if (nextIds.length > nextQty) {
				nextIds = nextIds.slice(0, nextQty);
			}

			const rowReason = sanitizeReasonText(entry && entry.reason || '');
			const finalReason = rowReason || commonReason || '盤點校正';
			const nextStatus = nextQty === 0 ? '已使用完' : '在庫';

			rowValues[1] = nextIds.join(', ');
			rowValues[6] = nextStatus;
			rowValues[13] = nextQty;
			sheet.getRange(rowNum, 1, 1, 15).setValues([rowValues.slice(0, 15)]);

			const removedIds = originalIds.filter(id => nextIds.indexOf(id) === -1);
			removeIndexEntries(assetIndex, removedIds);
			if (nextIds.length > 0) {
				upsertIndexEntries(assetIndex, nextIds, hit.sheet, rowNum);
			}

			txRows.push([
				now,
				'盤點校正',
				String(rowValues[2] || entry.name || ''),
				primaryId,
				diff,
				operator,
				oldStatus,
				operator,
				nextStatus
			]);
			updated++;
		});

		if (txRows.length > 0) {
			const txSheet = getSheet(TRANS_ASSETS_NAME);
			txSheet.getRange(txSheet.getLastRow() + 1, 1, txRows.length, txRows[0].length).setValues(txRows);

			const logSheet = getSheet(STOCKTAKE_LOG_NAME);
			const logRows = txRows.map(r => [
				r[0],                // 校正時間
				r[3],                // 資產編號 (primaryId)
				r[2],                // 物品名稱
				'',                  // 位置（在 txRows 未存，留空）
				'',                  // 帳面量 placeholder
				'',                  // 實盤量 placeholder
				Number(r[4]) || 0,   // 差異量 (diff)
				commonReason,        // 原因
				operator,            // 操作者
				r[6],                // 校正前狀態
				r[8]                 // 校正後狀態
			]);
			// 補帳面量/實盤量：從 reqRows 反查
			logRows.forEach((logRow, i) => {
				const match = reqRows.find(e => String(e && e.primaryId || '').trim() === String(logRow[1] || '').trim());
				if (match) {
					const bookQty = Number(match.bookQty) || 0;
					const actualQty = Number(match.actualQty) || 0;
					logRow[3] = String(match.location || '').trim();
					logRow[4] = bookQty;
					logRow[5] = actualQty;
					logRow[6] = actualQty - bookQty;
					logRow[7] = sanitizeReasonText(match.reason || commonReason || '盤點校正');
				}
			});
			try {
				logSheet.getRange(logSheet.getLastRow() + 1, 1, logRows.length, logRows[0].length).setValues(logRows);
			} catch (logErr) {
				Logger.log('applyStocktakeCorrections: stocktake log write failed: ' + logErr);
			}

			saveAssetIndex(assetIndex);
			invalidateCachesByEvent('assetMutation');
		}

		if (txRows.length === 0 && failures.length > 0) {
			const topReasons = failures.slice(0, 3).map(f => {
				const key = String(f && f.assetId || '').trim() || ('第' + (Number(f && f.index) + 1) + '筆');
				return key + '：' + String((f && f.reason) || '未知原因');
			}).join('；');
			return {
				success: false,
				message: '沒有成功回寫。失敗 ' + failures.length + ' 筆。' + (topReasons ? ('（' + topReasons + '）') : ''),
				updatedCount: 0,
				failedCount: failures.length,
				failures: failures
			};
		}

		return {
			success: txRows.length > 0,
			message: txRows.length > 0 ? ('盤點校正已回寫 ' + txRows.length + ' 筆') : '沒有可回寫的差異',
			updatedCount: updated,
			failedCount: failures.length,
			failures: failures
		};
	} catch (err) {
		return { success: false, message: err.toString(), updatedCount: 0, failedCount: 0, failures: [] };
	} finally {
		lock.releaseLock();
	}
}