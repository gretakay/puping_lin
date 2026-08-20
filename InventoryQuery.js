/**
 * Inventory and query APIs split from code.gs
 */

function getSummaryData(includeSangha, forceRefresh) {
	try {
		Logger.log('getSummaryData 開始執行');

		var invData = [];
		try {
			var invResult = getInventorySummary(includeSangha);
			if (invResult && invResult.success && invResult.data) {
				invData = invResult.data;
			}
		} catch (e1) {
			Logger.log('十方供養物讀取失敗：' + e1);
		}

		var astData = [];
		try {
			astData = getAvailableAssetsFull();
			if (!astData) astData = [];
		} catch (e2) {
			Logger.log('資產讀取失敗：' + e2);
		}

		var recentData = [];
		var expiryData = [];
		var scrapTxTotal = 0;
		var scrapByStatus = {};
		var scrapRecent = [];

		try {
			var recentResult = getRecentDonations(20);
			if (recentResult && recentResult.data) recentData = recentResult.data;
		} catch (e3) {
			Logger.log('最近捐贈讀取失敗：' + e3);
		}

		try {
			var expiryResult = getNearExpiry(7);
			if (expiryResult && expiryResult.data) expiryData = expiryResult.data;
		} catch (e4) {
			Logger.log('即期品讀取失敗：' + e4);
		}

		try {
			var scrapInfo = getScrapTotals(10000);
			if (scrapInfo) {
				scrapTxTotal = scrapInfo.total || 0;
				scrapByStatus = scrapInfo.byStatus || {};
				scrapRecent = scrapInfo.recent || [];
			}
		} catch (e5) {
			Logger.log('報廢統計讀取失敗：' + e5);
		}

		return {
			success: true,
			inventory: invData,
			assets: astData,
			recent: recentData,
			expiry: expiryData,
			scrapTxTotal: scrapTxTotal,
			scrapByStatus: scrapByStatus,
			scrapRecent: scrapRecent,
			dataVersion: String(Date.now()),
			timestamp: new Date().toISOString()
		};
	} catch (err) {
		return {
			success: false,
			message: err.toString(),
			inventory: [],
			assets: [],
			recent: [],
			expiry: [],
			scrapTxTotal: 0,
			scrapByStatus: {},
			scrapRecent: [],
			dataVersion: String(Date.now())
		};
	}
}

function getSummaryStats(includeSangha) {
	try {
		var invResult = getInventorySummary(includeSangha);
		var invCount = (invResult && invResult.success && invResult.data) ? invResult.data.length : 0;

		var astData = getAvailableAssetsFull() || [];
		var assetIn = 0;
		var assetOut = 0;
		for (var i = 0; i < astData.length; i++) {
			if (astData[i].status === '在庫') assetIn++;
			else assetOut++;
		}

		var scrapInfo = getScrapTotals(10000);
		var scrapTotal = scrapInfo ? (scrapInfo.total || 0) : 0;
		var scrapByStatus = scrapInfo ? (scrapInfo.byStatus || {}) : {};

		return {
			success: true,
			inventoryCount: invCount,
			assetInCount: assetIn,
			assetOutCount: assetOut,
			scrapTotal: scrapTotal,
			scrapByStatus: scrapByStatus,
			dataVersion: String(Date.now())
		};
	} catch (e) {
		return { success: false, message: e.toString() };
	}
}

function getInventoryDetails(includeSangha, forceRefresh) {
	try {
		var cacheKey = 'inventory_details_v1_' + (includeSangha ? '1' : '0');
		var currentVer = getDataVersion();
		if (!forceRefresh) {
			var cachedVer = loadFromBigCache(cacheKey + '_ver');
			var cached = loadFromBigCache(cacheKey);
			if (cached && cached.success && Array.isArray(cached.inventory) && cachedVer === currentVer) {
				return cached;
			}
		}

		var invResult = getInventorySummary(includeSangha);
		var invData = (invResult && invResult.success && invResult.data) ? invResult.data : [];

		var expiryResult = getNearExpiry(7);
		var expiryData = (expiryResult && expiryResult.data) ? expiryResult.data : [];

		var result = {
			success: true,
			inventory: invData,
			expiry: expiryData,
			dataVersion: String(Date.now())
		};

		try {
			saveToBigCache(cacheKey, result, 300);
			saveToBigCache(cacheKey + '_ver', currentVer, 300);
		} catch (e) {}
		return result;
	} catch (e) {
		return { success: false, message: e.toString(), inventory: [], expiry: [] };
	}
}

function getAssetsDetails(page, pageSize, forceRefresh) {
	try {
		try { ensureAssetLocationIndex(); } catch (e) {}

		page = Number(page) || 1;
		pageSize = Number(pageSize) || 80;

		var bypassCache = !!forceRefresh && page === 1;
		var allAssets = getAvailableAssetsFull(bypassCache) || [];
		var totalCount = allAssets.length;
		var totalPages = Math.ceil(totalCount / pageSize);
		var startIdx = (page - 1) * pageSize;
		var endIdx = Math.min(startIdx + pageSize, totalCount);

		return {
			success: true,
			assets: allAssets.slice(startIdx, endIdx),
			currentPage: page,
			totalPages: totalPages,
			totalCount: totalCount,
			hasMore: page < totalPages,
			dataVersion: String(Date.now())
		};
	} catch (e) {
		return {
			success: false,
			message: e.toString(),
			assets: [],
			currentPage: 1,
			totalPages: 0,
			hasMore: false
		};
	}
}

function getRecentActivity() {
	try {
		const currentVer = getDataVersion();
		const cacheKey = 'recent_activity_v1';
		const cacheVerKey = cacheKey + '_ver';
		const cachedVer = loadFromBigCache(cacheVerKey);
		const cached = loadFromBigCache(cacheKey);
		if (cached && cached.success && cachedVer === currentVer) return cached;

		var scrapInfo = getScrapTotals(10000);
		const result = {
			success: true,
			scrapTxTotal: scrapInfo ? (scrapInfo.total || 0) : 0,
			scrapByStatus: scrapInfo ? (scrapInfo.byStatus || {}) : {},
			dataVersion: String(Date.now())
		};
		try {
			saveToBigCache(cacheKey, result, 300);
			saveToBigCache(cacheVerKey, currentVer, 300);
		} catch (e) {}
		return result;
	} catch (e) {
		return { success: false, message: e.toString(), scrapTxTotal: 0, scrapByStatus: {} };
	}
}

function getScrapDetails() {
	try {
		var scrapInfo = getScrapTotals(5000);
		if (!scrapInfo || !scrapInfo.success) {
			return { success: false, message: (scrapInfo && scrapInfo.message) || 'getScrapTotals failed', scrapRecent: [] };
		}

		var simplified = (scrapInfo.recent || []).map(function(item) {
			var dateStr = '';
			if (item.date) {
				try {
					dateStr = item.date instanceof Date ? Utilities.formatDate(item.date, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(item.date);
				} catch (e) {
					dateStr = String(item.date || '');
				}
			}

			return {
				id: String(item.id || ''),
				name: String(item.name || ''),
				status: String(item.status || ''),
				qty: Number(item.qty) || 0,
				date: dateStr,
				location: String(item.location || '')
			};
		});

		return { success: true, scrapRecent: simplified, dataVersion: String(Date.now()) };
	} catch (e) {
		return { success: false, message: e.toString(), scrapRecent: [] };
	}
}

function getWithdrawData(includeSangha) {
	try {
		const invResult = getInventorySummary(!!includeSangha);
		const invData = (invResult && invResult.success) ? (invResult.data || []) : [];
		const astData = getAvailableAssetsFull() || [];
		return { success: true, inventory: invData, assets: astData };
	} catch (e) {
		return { success: false, message: e.toString(), inventory: [], assets: [] };
	}
}

function getWithdrawInventory(includeSangha) {
	try {
		try { ensureAssetLocationIndex(); } catch (e) {}

		const cacheKey = 'withdraw_inv_v1_' + (includeSangha ? '1' : '0');
		const currentVer = getDataVersion();
		const cachedVer = loadFromBigCache(cacheKey + '_ver');
		const cached = loadFromBigCache(cacheKey);
		if (cached && cached.success && Array.isArray(cached.inventory) && cachedVer === currentVer) {
			return cached;
		}

		const invResult = getInventorySummary(!!includeSangha);
		const invData = (invResult && invResult.success) ? (invResult.data || []) : [];
		const result = { success: true, inventory: invData };
		try {
			saveToBigCache(cacheKey, result, 900);
			saveToBigCache(cacheKey + '_ver', currentVer, 900);
		} catch (e) {}
		return result;
	} catch (e) {
		return { success: false, message: e.toString(), inventory: [] };
	}
}

function getWithdrawAssets() {
	try {
		const cacheKey = 'withdraw_assets_v2';
		const currentVer = getDataVersion();
		const cachedVer = loadFromBigCache(cacheKey + '_ver');
		const cached = loadFromBigCache(cacheKey);
		if (cached && cached.success && Array.isArray(cached.assets) && cached.assets.length > 0 && cachedVer === currentVer) {
			return cached;
		}

		const sharedCached = loadFromBigCache('assets_full_v2');
		if (Array.isArray(sharedCached) && sharedCached.length > 0) {
			const resultFromShared = { success: true, assets: sharedCached };
			try {
				saveToBigCache(cacheKey, resultFromShared, 900);
				saveToBigCache(cacheKey + '_ver', currentVer, 900);
			} catch (e) {}
			return resultFromShared;
		}

		const astData = getAvailableAssetsFull() || [];
		const result = { success: true, assets: astData };
		if (astData.length > 0) {
			try {
				saveToBigCache(cacheKey, result, 900);
				saveToBigCache(cacheKey + '_ver', currentVer, 900);
			} catch (e) {}
		} else {
			try { removeBigCache(cacheKey); } catch (e) {}
		}
		return result;
	} catch (e) {
		return { success: false, message: e.toString(), assets: [] };
	}
}

function getAvailableAssetsFull(forceRefresh) {
	let res = [];
	try {
		const dataVersion = getDataVersion();
		const versionCacheKey = 'assets_full_version_v2';
		if (!forceRefresh) {
			const cachedAssets = loadFromBigCache('assets_full_v2');
			const cachedVersion = loadFromBigCache(versionCacheKey);
			if (Array.isArray(cachedAssets) && String(cachedVersion || '') === String(dataVersion)) {
				return cachedAssets;
			}
		}

		const rawSettings = getCategorySettings();
		const prefixMap = rawSettings ? rawSettings.prefixMap : {};
		const locations = getLocationKeysCached();
		const groupMap = {};
		const photoLookup = {};

		for (let index = 0; index < locations.length; index++) {
			const loc = locations[index];
			try {
				const sheet = getAssetLocationSheet(loc);
				const lastRow = sheet.getLastRow();
				if (lastRow <= 1) continue;

				const data = sheet.getDataRange().getValues();
				data.slice(1).forEach(r => {
					if (!r[1]) return;
					const status = String(r[6]).trim();
					const ids = String(r[1]).split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
					const initQty = Number(r[13]) || 0;
					const count = initQty > 0 ? initQty : ids.length;
					const outRule = String(r[14] || '僅借用').trim() || '僅借用';
					const firstId = ids[0] ? ids[0].trim() : '';
					const match = firstId.match(/^([A-Z]+)/);
					const prefix = match ? match[1] : '';
					const keeperName = String(r[7] || '庫房').trim() || '庫房';
					const unitName = String(r[10] || '件').trim() || '件';
					const locName = r[12] || loc;

					const keyNoStatus = [r[2], r[5], r[3], locName, keeperName, unitName].join('|');
					if ((!photoLookup[keyNoStatus] || photoLookup[keyNoStatus] === '') && r[11]) photoLookup[keyNoStatus] = r[11];
					const key = [keyNoStatus, status, outRule].join('|');

					if (!groupMap[key]) {
						groupMap[key] = {
							id: firstId,
							ids: [],
							name: r[2],
							color: r[3] || '無',
							spec: r[5] || '',
							note: String(r[9] || '').trim(),
							location: locName,
							status: status,
							keeper: keeperName,
							receiver: r[8] || '',
							unit: unitName,
							photoUrl: photoLookup[keyNoStatus] || (r[11] || ''),
							category: prefixMap[prefix] || '未分類',
							outRule: outRule,
							count: 0
						};
					}

					if (status === '借出中') groupMap[key].count += (initQty > 0 ? initQty : 0);
					else groupMap[key].count += count;
					if (!groupMap[key].note) {
						groupMap[key].note = String(r[9] || '').trim();
					}
					groupMap[key].ids = groupMap[key].ids.concat(ids);
				});
			} catch (locError) {
				console.error('讀取位置表錯誤：' + locError.toString());
			}
		}

		res = Object.values(groupMap).map(function(item) {
			return { ...item, ids: item.ids };
		});

		try {
			saveToBigCache('assets_full_v2', res, 900);
			saveToBigCache(versionCacheKey, String(dataVersion), 900);
		} catch (cacheErr) {
			console.warn('assets full cache write failed: ' + cacheErr);
		}
	} catch (e) {
		console.error('getAvailableAssetsFull 錯誤：' + e.toString());
	}
	return res;
}

function getLocationMapUrlLookupCached(currentVer) {
	const cacheKey = 'borrowed_map_lookup_v1';
	const verKey = cacheKey + '_ver';
	try {
		const cachedVer = loadFromBigCache(verKey);
		const cached = loadFromBigCache(cacheKey);
		if (cached && typeof cached === 'object' && !Array.isArray(cached) && cachedVer === currentVer) {
			return cached;
		}
	} catch (e) {}

	const locSheet = getSheet(LOC_SHEET_NAME);
	const locData = locSheet.getDataRange().getValues();
	const mapUrlLookup = {};

	locData.slice(1).forEach(row => {
		if (!row[0]) return;
		const name = String(row[0]).trim();
		const rawUrl = String(row[2] || '').trim();
		if (name && rawUrl) mapUrlLookup[name] = fixDriveViewUrl(rawUrl);
	});

	try {
		saveToBigCache(cacheKey, mapUrlLookup, 900);
		saveToBigCache(verKey, currentVer, 900);
	} catch (e) {}

	return mapUrlLookup;
}

function getBorrowDateMapCached(currentVer) {
	const cacheKey = 'borrow_date_map_v1';
	const verKey = cacheKey + '_ver';
	try {
		const cachedVer = loadFromBigCache(verKey);
		const cached = loadFromBigCache(cacheKey);
		if (cached && typeof cached === 'object' && !Array.isArray(cached) && cachedVer === currentVer) {
			return cached;
		}
	} catch (e) {}

	const tData = getSheet(TRANS_ASSETS_NAME).getDataRange().getValues();
	const borrowDateMap = {};
	tData.forEach(r => {
		if (String(r[1]).trim() !== '借出') return;
		const dateStr = r[0] instanceof Date ? Utilities.formatDate(r[0], 'GMT+8', 'yyyy-MM-dd') : '';
		const rawIds = String(r[3] || '');
		const segments = rawIds.split(/[,，]/);
		segments.forEach(seg => {
			const s = String(seg || '').trim();
			if (!s) return;
			if (s.includes('~')) {
				const prefixMatch = s.match(/^(.*?)(\d+)$/);
				if (prefixMatch && prefixMatch[1]) borrowDateMap[prefixMatch[1]] = dateStr;
			} else {
				borrowDateMap[s] = dateStr;
			}
		});
	});

	try {
		saveToBigCache(cacheKey, borrowDateMap, 900);
		saveToBigCache(verKey, currentVer, 900);
	} catch (e) {}

	return borrowDateMap;
}

function getBorrowedAssets() {
	try {
		const currentVer = getDataVersion();
		const cachedVer = loadFromBigCache('borrowed_assets_version_v1');
		const cached = loadFromBigCache('borrowed_assets_v1');
		if (cached && Array.isArray(cached) && cachedVer === currentVer) return cached;

		const mapUrlLookup = getLocationMapUrlLookupCached(currentVer);
		const borrowDateMap = getBorrowDateMapCached(currentVer);

		function resolveMapUrl(displayLoc, locKey) {
			let finalMapUrl = mapUrlLookup[displayLoc];
			if (!finalMapUrl) {
				const broadMatch = String(displayLoc || '').match(/^([A-Z0-9]+-[A-Z])/i);
				if (broadMatch) finalMapUrl = mapUrlLookup[broadMatch[1] + '區'];
			}
			if (!finalMapUrl) finalMapUrl = mapUrlLookup[locKey] || '';
			return finalMapUrl;
		}

		function resolveBorrowDate(idValue) {
			const id = String(idValue || '').trim();
			if (!id) return '查無紀錄';
			let bDate = borrowDateMap[id];
			if (!bDate) {
				const pre = id.match(/^([A-Z]+)/);
				if (pre) bDate = borrowDateMap[pre[1]];
			}
			return bDate || '查無紀錄';
		}

		function fullScanFallback() {
			const out = [];
			const locations = getLocationKeysCached();
			locations.forEach(loc => {
				const sheet = getAssetLocationSheet(loc);
				const data = sheet.getDataRange().getValues();
				data.slice(1).forEach(r => {
					if (String(r[6]).trim() !== '借出中') return;
					const rowIds = String(r[1] || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
					const displayLoc = r[12] ? String(r[12]).trim() : loc;
					const finalMapUrl = resolveMapUrl(displayLoc, loc);
					const initQty = Number(r[13]) || 0;
					if (initQty > 0) {
						const idRepresentative = rowIds.length > 0 ? rowIds[0] : '';
						out.push({
							id: idRepresentative,
							name: r[2],
							receiver: r[8],
							location: displayLoc,
							photoUrl: r[11],
							borrowDate: resolveBorrowDate(idRepresentative),
							mapUrl: finalMapUrl,
							count: initQty
						});
					} else {
						rowIds.forEach(id => {
							out.push({
								id: id,
								name: r[2],
								receiver: r[8],
								location: displayLoc,
								photoUrl: r[11],
								borrowDate: resolveBorrowDate(id),
								mapUrl: finalMapUrl,
								count: 1
							});
						});
					}
				});
			});
			return out;
		}

		let res = [];
		let needFallback = false;
		const borrowedIndex = getBorrowedAssetIndex();
		const borrowedIds = Object.keys(borrowedIndex || {});

		if (borrowedIds.length > 0) {
			const rowsBySheet = {};
			const sheetDataCache = {};
			const seenBatchRows = {};

			for (let i = 0; i < borrowedIds.length; i++) {
				const id = borrowedIds[i];
				const info = borrowedIndex[id] || {};
				if (!info || !info.sheet || !info.row) {
					needFallback = true;
					continue;
				}
				const sheetKey = String(info.sheet);
				if (!rowsBySheet[sheetKey]) rowsBySheet[sheetKey] = [];
				rowsBySheet[sheetKey].push({
					id: id,
					row: Number(info.row) || 0,
					sheet: sheetKey
				});
			}

			const sheetNames = Object.keys(rowsBySheet);
			for (let i = 0; i < sheetNames.length; i++) {
				const sheetName = sheetNames[i];
				const entries = rowsBySheet[sheetName] || [];
				if (!entries.length) continue;

				if (!sheetDataCache[sheetName]) {
					try {
						const sheet = getAssetLocationSheet(sheetName);
						const lastRow = sheet.getLastRow();
						if (lastRow <= 1) {
							needFallback = true;
							sheetDataCache[sheetName] = [];
						} else {
							sheetDataCache[sheetName] = sheet.getRange(1, 1, lastRow, 14).getValues();
						}
					} catch (e) {
						needFallback = true;
						sheetDataCache[sheetName] = [];
					}
				}

				const sheetRows = sheetDataCache[sheetName] || [];
				for (let j = 0; j < entries.length; j++) {
					const entry = entries[j];
					const rowIdx = Number(entry.row) - 1;
					const rowValues = (rowIdx >= 1 && rowIdx < sheetRows.length) ? sheetRows[rowIdx] : null;
					if (!rowValues) {
						needFallback = true;
						continue;
					}

					if (String(rowValues[6] || '').trim() !== '借出中') {
						needFallback = true;
						continue;
					}

					const rowIds = String(rowValues[1] || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
					if (!rowIds.length) continue;
					const displayLoc = rowValues[12] ? String(rowValues[12]).trim() : sheetName;
					const finalMapUrl = resolveMapUrl(displayLoc, sheetName);
					const initQty = Number(rowValues[13]) || 0;

					if (initQty > 0) {
						const rowKey = sheetName + '::' + String(entry.row);
						if (seenBatchRows[rowKey]) continue;
						seenBatchRows[rowKey] = true;
						const idRepresentative = rowIds[0] || String(entry.id || '');
						res.push({
							id: idRepresentative,
							name: rowValues[2],
							receiver: rowValues[8],
							location: displayLoc,
							photoUrl: rowValues[11],
							borrowDate: resolveBorrowDate(idRepresentative),
							mapUrl: finalMapUrl,
							count: initQty
						});
						continue;
					}

					res.push({
						id: String(entry.id),
						name: rowValues[2],
						receiver: rowValues[8],
						location: displayLoc,
						photoUrl: rowValues[11],
						borrowDate: resolveBorrowDate(entry.id),
						mapUrl: finalMapUrl,
						count: 1
					});
				}
			}
		} else {
			needFallback = true;
		}

		if (needFallback) {
			res = fullScanFallback();
			try { saveBorrowedAssetIndex(buildBorrowedAssetIndex()); } catch (e) {}
		}

		try {
			saveToBigCache('borrowed_assets_v1', res, 900);
			saveToBigCache('borrowed_assets_version_v1', currentVer, 900);
		} catch (e) {}
		return res;
	} catch (e) {
		return [];
	}
}

function getInventorySummary(includeSangha) {
	if (typeof includeSangha === 'undefined') includeSangha = false;
	try {
		function normalizeColorKey(colorText) {
			const c = String(colorText || '').trim();
			if (!c || c === '無') return '';
			return c;
		}

		function buildConsumableKey(name, location, colorKey) {
			return [
				String(name || '').trim(),
				String(location || '').trim(),
				normalizeColorKey(colorKey)
			].join('||');
		}

		const map = {};
		const dRows = getSheet(SHEET_NAME).getDataRange().getValues();

		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const cutOffDate = new Date();
		cutOffDate.setDate(today.getDate() - 2);

		for (let i = 1; i < dRows.length; i++) {
			if (!includeSangha && dRows[i][12] === '供僧') continue;
			let rawDate = dRows[i][8];
			if (rawDate instanceof Date && rawDate < cutOffDate) continue;
			const itemName = String(dRows[i][3] || '').trim();
			if (!itemName) continue;
			const colorRaw = String(dRows[i][11] || '').trim();
			const location = String(dRows[i][6] || '').trim();
			const key = buildConsumableKey(itemName, location, colorRaw);

			if (!map[key]) {
				let fDate = '---';
				if (rawDate instanceof Date) fDate = Utilities.formatDate(rawDate, 'GMT+8', 'yyyy/MM/dd');
				else if (rawDate && String(rawDate).trim() !== '') fDate = String(rawDate);

				map[key] = {
					name: itemName,
					color: colorRaw || '無',
					qty: 0,
					unit: dRows[i][4],
					category: dRows[i][10],
					photoUrl: dRows[i][9] || '',
					location: location,
					expiryDate: fDate,
					isSangha: (dRows[i][12] === '供僧')
				};
			}
			map[key].qty += Number(dRows[i][5]);
		}

		return { success: true, data: Object.values(map).filter(x => x.qty > 0) };
	} catch (err) {
		return { success: false, data: [], message: err.toString() };
	}
}

function getAggregatedAssets() {
	try {
		const indexSheet = ensureAssetLocationIndex();
		let indexData = indexSheet.getDataRange().getValues();

		if (indexData.length <= 1) {
			const refreshed = updateAssetLocationIndex();
			if (!refreshed || !refreshed.success) return [];
			indexData = indexSheet.getDataRange().getValues();
			if (indexData.length <= 1) return [];
		}

		const result = [];
		indexData.slice(1).forEach(row => {
			const inStock = Number(row[1]) || 0;
			const borrowed = Number(row[2]) || 0;
			const underMaintenance = Number(row[3]) || 0;
			const damaged = Number(row[4]) || 0;
			const lost = Number(row[5]) || 0;
			const consumed = Number(row[6]) || 0;
			result.push({
				location: row[0],
				total: inStock + borrowed + underMaintenance + damaged + lost + consumed,
				inStock: inStock,
				borrowed: borrowed,
				underMaintenance: underMaintenance,
				damaged: damaged,
				lost: lost,
				consumed: consumed,
				status: '在庫:' + inStock + '/借出:' + borrowed + '/維修:' + underMaintenance,
				lastUpdated: row[7]
			});
		});
		return result;
	} catch (e) {
		return [];
	}
}

function getLocationData() {
	const cacheKey = 'location_data_v1';
	const cacheVerKey = 'location_data_v1_ver';
	const currentVer = getDataVersion();
	const cachedVer = loadFromBigCache(cacheVerKey);
	const cached = loadFromBigCache(cacheKey);
	if (cached && cached.roomData && cachedVer === currentVer) return cached;

	const data = getSheet(LOC_SHEET_NAME).getDataRange().getValues();
	const room = {};
	const floorMaps = {};

	data.slice(1).forEach(r => {
		if (!r[0]) return;
		const name = String(r[0]).trim();
		const floor = String(r[1] || '').trim();
		const specificUrl = String(r[2] || '').trim();
		room[name] = {
			floor: floor,
			specificUrl: specificUrl,
			x: Number(r[3]),
			y: Number(r[4]),
			w: Number(r[5]),
			h: Number(r[6])
		};
		if (floor && specificUrl && !floorMaps[floor]) floorMaps[floor] = specificUrl;
	});

	const result = { roomData: room, floorMaps: floorMaps };
	try {
		saveToBigCache(cacheKey, result, 1800);
		saveToBigCache(cacheVerKey, currentVer, 1800);
	} catch (e) {}
	return result;
}

function getLocationList() {
	try {
		return getSheet(LOC_SHEET_NAME).getDataRange().getValues().slice(1).map(r => String(r[0]).trim()).filter(r => r !== '');
	} catch (e) {
		return [];
	}
}

function getNearExpiry(days) {
	try {
		const rows = getSheet(SHEET_NAME).getDataRange().getValues();
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const limitDate = new Date();
		limitDate.setDate(today.getDate() + Number(days || 7));

		const expiryList = rows.slice(1).filter(r => {
			const exp = r[8];
			const qty = Number(r[5]);
			return (exp instanceof Date) && exp >= today && exp <= limitDate && qty > 0;
		}).map(r => ({
			itemName: r[3],
			unit: r[4],
			quantity: r[5],
			location: r[6],
			expiryDate: Utilities.formatDate(r[8], 'GMT+8', 'yyyy-MM-dd'),
			photoUrl: r[9],
			category: r[10],
			color: r[11],
			stockStatus: r[12]
		}));

		return { success: true, data: expiryList };
	} catch (e) {
		return { success: false, data: [], message: e.toString() };
	}
}

function getNearExpiryLite(days) {
	try {
		const cacheKey = 'near_expiry_v1_' + String(days || 7);
		const cached = loadFromBigCache(cacheKey);
		if (cached && cached.success && Array.isArray(cached.expiry)) return cached;
		const result = { success: true, expiry: getNearExpiry(days).data || [] };
		try { saveToBigCache(cacheKey, result, 300); } catch (e) {}
		return result;
	} catch (e) {
		return { success: false, message: e.toString(), expiry: [] };
	}
}

function getRecentDonations(limit) {
	try {
		const sheet = getSheet(SHEET_NAME);
		const lastRow = sheet.getLastRow();
		if (lastRow <= 1) return { success: true, data: [] };

		const numRows = Math.min(Number(limit) || 20, lastRow - 1);
		const startRow = lastRow - numRows + 1;
		const rows = sheet.getRange(startRow, 1, numRows, sheet.getLastColumn()).getValues();

		const data = rows.reverse().map(r => ({
			donationDate: Utilities.formatDate(r[1] instanceof Date ? r[1] : new Date(), 'GMT+8', 'yyyy-MM-dd'),
			donorName: r[2],
			itemName: r[3],
			unit: r[4],
			quantity: r[5],
			location: r[6],
			category: r[10],
			color: r[11],
			photoUrl: r[9],
			stockStatus: r[12]
		}));

		return { success: true, data: data };
	} catch (e) {
		return { success: false, message: e.toString(), data: [] };
	}
}

function getRecentDonationsLite(limit) {
	try {
		const cacheKey = 'recent_donations_v1_' + String(limit || 20);
		const cached = loadFromBigCache(cacheKey);
		if (cached && cached.success && Array.isArray(cached.recent) && Array.isArray(cached.inventory)) return cached;
		const result = {
			success: true,
			recent: getRecentDonations(limit).data || [],
			inventory: getInventorySummary(true).data || []
		};
		try { saveToBigCache(cacheKey, result, 300); } catch (e) {}
		return result;
	} catch (e) {
		return { success: false, message: e.toString(), recent: [], inventory: [] };
	}
}

function getFridgeFeed(limit) {
	try {
		const safeLimit = Math.max(1, Math.min(Number(limit) || 30, 100));
		const cacheKey = 'fridge_feed_v1_' + String(safeLimit);
		const cached = loadFromBigCache(cacheKey);
		if (cached && cached.success && Array.isArray(cached.data)) return cached;

		const sheet = getSheet(SHEET_NAME);
		const lastRow = sheet.getLastRow();
		if (lastRow <= 1) {
			const empty = { success: true, data: [], updatedAt: new Date().toISOString() };
			try { saveToBigCache(cacheKey, empty, 5); } catch (e) {}
			return empty;
		}

		const numRows = Math.min(safeLimit, lastRow - 1);
		const startRow = lastRow - numRows + 1;
		const rows = sheet.getRange(startRow, 1, numRows, sheet.getLastColumn()).getValues();

		const data = rows.reverse().map(r => {
			const donationDate = (r[1] instanceof Date)
				? Utilities.formatDate(r[1], 'GMT+8', 'yyyy-MM-dd')
				: '';
			const expiryDate = (r[8] instanceof Date)
				? Utilities.formatDate(r[8], 'GMT+8', 'yyyy-MM-dd')
				: '';

			return {
				donationDate: donationDate,
				donorName: String(r[2] || ''),
				itemName: String(r[3] || ''),
				unit: String(r[4] || ''),
				quantity: Number(r[5]) || 0,
				location: String(r[6] || ''),
				expiryDate: expiryDate,
				photoUrl: String(r[9] || ''),
				category: String(r[10] || ''),
				color: String(r[11] || ''),
				stockStatus: String(r[12] || '')
			};
		});

		const result = { success: true, data: data, updatedAt: new Date().toISOString() };
		try { saveToBigCache(cacheKey, result, 5); } catch (e) {}
		return result;
	} catch (e) {
		return { success: false, message: e.toString(), data: [] };
	}
}

function getScrapTotals(limit) {
	try {
		limit = Number(limit) || 50;
		const ss = SpreadsheetApp.getActiveSpreadsheet();
		const sheet = ss.getSheetByName(TRANS_SCRAP_NAME);
		if (!sheet) return { success: true, total: 0, byStatus: {}, recent: [] };
		const rows = sheet.getDataRange().getValues();
		const data = rows.slice(1).map(r => ({
			date: r[0],
			status: String(r[1] || ''),
			name: r[2],
			id: r[3],
			qty: Number(r[4]) || 0,
			handler: r[5],
			note: r[6],
			location: r[7],
			ref: r[8]
		}));
		const recent = data.slice(-limit).reverse();
		let total = 0;
		const byStatus = {};
		data.forEach(d => {
			total += Number(d.qty) || 0;
			const s = d.status || '未知';
			byStatus[s] = (byStatus[s] || 0) + (Number(d.qty) || 0);
		});
		return { success: true, total: total, byStatus: byStatus, recent: recent };
	} catch (e) {
		return { success: false, message: e.toString() };
	}
}
