/**
 * Cache and Version Module
 */

function _cacheMetricsKey() {
	return '__cache_metrics_v1';
}

function _recordCacheMetric(metricName) {
	try {
		const cache = CacheService.getScriptCache();
		const key = _cacheMetricsKey();
		const raw = cache.get(key);
		let metrics = {};
		if (raw) {
			try { metrics = JSON.parse(raw) || {}; } catch (e) { metrics = {}; }
		}
		const mKey = String(metricName || 'unknown').trim() || 'unknown';
		metrics[mKey] = Number(metrics[mKey] || 0) + 1;
		metrics._updatedAt = new Date().toISOString();
		cache.put(key, JSON.stringify(metrics), 21600);
	} catch (e) {}
}

function getCacheMetricsSnapshot() {
	try {
		const raw = CacheService.getScriptCache().get(_cacheMetricsKey());
		if (!raw) return { success: true, metrics: {}, updatedAt: null };
		const parsed = JSON.parse(raw) || {};
		return {
			success: true,
			metrics: parsed,
			updatedAt: parsed._updatedAt || null
		};
	} catch (e) {
		return { success: false, message: e.toString(), metrics: {} };
	}
}

function getPerformanceDiagnostics() {
	try {
		const props = PropertiesService.getScriptProperties();
		const metrics = getCacheMetricsSnapshot();
		return {
			success: true,
			dataVersion: getDataVersion(),
			indexNeedsUpdate: String(props.getProperty('index_needs_update') || ''),
			indexLastRunTimestamp: Number(props.getProperty('index_last_run_timestamp') || 0),
			cacheMetrics: metrics && metrics.metrics ? metrics.metrics : {},
			cacheMetricsUpdatedAt: metrics && metrics.updatedAt ? metrics.updatedAt : null,
			timestamp: new Date().toISOString()
		};
	} catch (e) {
		return { success: false, message: e.toString(), timestamp: new Date().toISOString() };
	}
}

function saveToBigCache(key, data, timeInSeconds) {
	const cache = CacheService.getScriptCache();
	const jsonString = JSON.stringify(data);
	const chunkSize = 90000; // 保險起見設為 90KB (上限 100KB)
	const chunks = [];
  
	// 切割字串
	for (let i = 0; i < jsonString.length; i += chunkSize) {
		chunks.push(jsonString.substring(i, i + chunkSize));
	}
  
	// 寫入每一塊
	chunks.forEach((chunk, index) => {
		cache.put(key + "_" + index, chunk, timeInSeconds);
	});
  
	// 記錄總塊數
	cache.put(key + "_count", String(chunks.length), timeInSeconds);
	_recordCacheMetric('write');
	console.log(`✅ 數據已寫入快取，共切成 ${chunks.length} 塊`);
}

/** 📂 讀取大型快取 (自動組裝) */
function loadFromBigCache(key) {
	const cache = CacheService.getScriptCache();
	const countStr = cache.get(key + "_count");
  
	if (!countStr) {
		_recordCacheMetric('miss');
		return null;
	}
  
	const count = parseInt(countStr, 10);
	const chunkKeys = [];
	for (let i = 0; i < count; i++) {
		chunkKeys.push(key + "_" + i);
	}
  
	// 一次讀取所有塊
	const chunks = cache.getAll(chunkKeys);
	let fullString = "";
  
	// 依序組裝
	for (let i = 0; i < count; i++) {
		const chunk = chunks[key + "_" + i];
		if (!chunk) {
			_recordCacheMetric('chunk_miss');
			return null; // 如果缺某一塊，視為快取失效
		}
		fullString += chunk;
	}

	try {
		_recordCacheMetric('hit');
		return JSON.parse(fullString);
	} catch (e) {
		_recordCacheMetric('parse_error');
		console.error('loadFromBigCache parse error for ' + key + ': ' + e);
		return null;
	}
}

function _removeBigCacheKeys(keys) {
	(keys || []).forEach(k => removeBigCache(k));
}

function invalidateCachesByEvent(eventType) {
	const type = String(eventType || '').trim();
	if (!type) return;

	const commonKeys = [
		'summary_data_full_v2',
		'summary_data_normal_v2',
		'assets_full_v2',
		'assets_full_version_v2',
		'assets_full_v1',
		'assets_full_version_v1',
		'recent_activity_v1',
		'recent_activity_v1_ver',
		'inventory_details_v1_0',
		'inventory_details_v1_1',
		'inventory_details_v1_0_ver',
		'inventory_details_v1_1_ver'
	];

	if (type === 'returnAsset') {
		_removeBigCacheKeys(commonKeys.concat([
			'borrowed_assets_v1',
			'borrowed_assets_version_v1',
			'borrowed_map_lookup_v1',
			'borrowed_map_lookup_v1_ver',
			'borrow_date_map_v1',
			'borrow_date_map_v1_ver',
			'withdraw_inv_v1_0',
			'withdraw_inv_v1_0_ver',
			'withdraw_inv_v1_1',
			'withdraw_inv_v1_1_ver',
			'withdraw_assets_v1',
			'withdraw_assets_v1_ver',
			'withdraw_assets_v2',
			'withdraw_assets_v2_ver',
			'location_data_v1',
			'location_data_v1_ver',
			'restock_search_index_v1'
		]));
		bumpDataVersion();
		try { PropertiesService.getScriptProperties().setProperty('index_needs_update', 'true'); } catch (e) {}
		try { if (typeof checkAndNotifyLowStockAssets === 'function') checkAndNotifyLowStockAssets(); } catch (e) {}
		return;
	}

	if (type === 'assetMutation') {
		_removeBigCacheKeys(commonKeys.concat([
			'borrowed_assets_v1',
			'borrowed_assets_version_v1',
			'borrowed_map_lookup_v1',
			'borrowed_map_lookup_v1_ver',
			'borrow_date_map_v1',
			'borrow_date_map_v1_ver',
			'withdraw_inv_v1_0',
			'withdraw_inv_v1_0_ver',
			'withdraw_inv_v1_1',
			'withdraw_inv_v1_1_ver',
			'withdraw_assets_v1',
			'withdraw_assets_v1_ver',
			'withdraw_assets_v2',
			'withdraw_assets_v2_ver',
			'location_data_v1',
			'location_data_v1_ver',
			'restock_search_index_v1'
		]));
		try { CacheService.getScriptCache().remove(BORROWED_ASSET_INDEX_KEY); } catch (e) {}
		try { PropertiesService.getScriptProperties().deleteProperty(BORROWED_ASSET_INDEX_KEY); } catch (e) {}
		bumpDataVersion();
		try { PropertiesService.getScriptProperties().setProperty('index_needs_update', 'true'); } catch (e) {}
		try { if (typeof checkAndNotifyLowStockAssets === 'function') checkAndNotifyLowStockAssets(); } catch (e) {}
		return;
	}

	if (type === 'light') {
		_removeBigCacheKeys(['summary_data_full_v2', 'summary_data_normal_v2', 'recent_activity_v1', 'recent_activity_v1_ver']);
		bumpDataVersion();
		return;
	}

	clearFastCachesOnly();
}

function removeBigCache(key) {
	const cache = CacheService.getScriptCache();
	const countStr = cache.get(key + "_count");
	if (countStr) {
		const count = parseInt(countStr, 10);
		for (let i = 0; i < count; i++) {
			cache.remove(key + "_" + i);
		}
		cache.remove(key + "_count");
	}
}

// 輕量資料版本：用於前端輪詢判斷是否需要重新載入
function bumpDataVersion() {
	try {
		PropertiesService.getScriptProperties().setProperty('data_version', String(Date.now()));
	} catch (e) {
		console.warn('bumpDataVersion failed: ' + e.toString());
	}
}

function getDataVersion() {
	const manualVer = PropertiesService.getScriptProperties().getProperty('data_version') || '0';
	// 手動在後台改試算表時，不會觸發 bumpDataVersion，這裡併入檔案最後更新時間避免前端吃舊快取
	let sheetVer = '0';
	try {
		const ss = SpreadsheetApp.getActiveSpreadsheet();
		sheetVer = String(DriveApp.getFileById(ss.getId()).getLastUpdated().getTime());
	} catch (e) {
		// 讀不到 Drive metadata 時，退回 manualVer
	}
	return manualVer + '_' + sheetVer;
}

function clearFastCachesOnly() {
	const cache = CacheService.getScriptCache();
	removeBigCache('summary_data_full_v2');
	removeBigCache('summary_data_normal_v2');
	removeBigCache('assets_full_v2');
	removeBigCache('assets_full_version_v2');
	removeBigCache('borrowed_assets_v1');
	removeBigCache('borrowed_assets_version_v1');
	removeBigCache('borrowed_map_lookup_v1');
	removeBigCache('borrowed_map_lookup_v1_ver');
	removeBigCache('borrow_date_map_v1');
	removeBigCache('borrow_date_map_v1_ver');
	removeBigCache('location_data_v1');
	removeBigCache('location_data_v1_ver');
	removeBigCache('restock_search_index_v1');
	removeBigCache('withdraw_assets_v2');
	removeBigCache('withdraw_assets_v2_ver');
	removeBigCache('inventory_details_v1_0');
	removeBigCache('inventory_details_v1_1');
	removeBigCache('inventory_details_v1_0_ver');
	removeBigCache('inventory_details_v1_1_ver');
	removeBigCache('recent_activity_v1');
	removeBigCache('recent_activity_v1_ver');
	bumpDataVersion();
	try { PropertiesService.getScriptProperties().setProperty('index_needs_update', 'true'); } catch (e) {}
	console.log("⚡ 快速清快存完成，索引會由排程接下來更新");
}

function clearAllCaches() {
	const cache = CacheService.getScriptCache();
	removeBigCache('summary_data_full_v2');
	removeBigCache('summary_data_normal_v2');
	removeBigCache('assets_full_v2');
	removeBigCache('assets_full_version_v2');
	removeBigCache('borrowed_assets_v1');
	removeBigCache('borrowed_assets_version_v1');
	removeBigCache('borrowed_map_lookup_v1');
	removeBigCache('borrowed_map_lookup_v1_ver');
	removeBigCache('borrow_date_map_v1');
	removeBigCache('borrow_date_map_v1_ver');
	removeBigCache('location_data_v1');
	removeBigCache('location_data_v1_ver');
	removeBigCache('restock_search_index_v1');
	removeBigCache('withdraw_inv_v1_0');
	removeBigCache('withdraw_inv_v1_0_ver');
	removeBigCache('withdraw_inv_v1_1');
	removeBigCache('withdraw_inv_v1_1_ver');
	removeBigCache('withdraw_assets_v1');
	removeBigCache('withdraw_assets_v1_ver');
	removeBigCache('withdraw_assets_v2');
	removeBigCache('withdraw_assets_v2_ver');
	removeBigCache('assets_full_v1');
	removeBigCache('assets_full_version_v1');
	removeBigCache('inventory_details_v1_0');
	removeBigCache('inventory_details_v1_1');
	removeBigCache('inventory_details_v1_0_ver');
	removeBigCache('inventory_details_v1_1_ver');
	removeBigCache('recent_activity_v1');
	removeBigCache('recent_activity_v1_ver');
	cache.remove(BORROWED_ASSET_INDEX_KEY);
	try { PropertiesService.getScriptProperties().deleteProperty(BORROWED_ASSET_INDEX_KEY); } catch (e) {}
	bumpDataVersion();
	try { PropertiesService.getScriptProperties().setProperty('index_needs_update', 'true'); } catch (e) {}
	console.log("🧹 快取已清除，索引會由排程接下來更新");
}

function warmUpSummaryCache() {
	try {
		const startTime = new Date().getTime();
		const result = getSummaryData(true, true);
		const elapsed = new Date().getTime() - startTime;
		return {
			success: !!(result && result.success),
			message: (result && result.success) ? 'warmup ok' : (result && result.message ? result.message : 'warmup failed'),
			elapsedMs: elapsed
		};
	} catch (e) {
		return { success: false, message: e.toString() };
	}
}

function hardRefreshAllCachesAndIndexes() {
	const start = new Date().getTime();
	const report = {
		cleared: false,
		indexUpdated: false,
		warmed: {
			inventory: false,
			assets: false,
			activity: false,
			borrowed: false,
			location: false
		},
		warnings: []
	};

	try {
		clearAllCaches();
		report.cleared = true;
	} catch (e) {
		report.warnings.push('clearAllCaches 失敗: ' + e);
	}

	try { CacheService.getScriptCache().remove('loc_keys'); } catch (e) { report.warnings.push('清除 loc_keys 失敗: ' + e); }
	try { CacheService.getScriptCache().remove('category_rules'); } catch (e) { report.warnings.push('清除 category_rules 失敗: ' + e); }

	try {
		const idx = updateAssetLocationIndex();
		report.indexUpdated = !!(idx && idx.success);
		if (!report.indexUpdated) report.warnings.push('updateAssetLocationIndex 未成功');
	} catch (e) {
		report.warnings.push('updateAssetLocationIndex 失敗: ' + e);
	}

	try { getInventoryDetails(true, true); report.warmed.inventory = true; } catch (e) { report.warnings.push('預熱 inventory 失敗: ' + e); }
	try { getAssetsDetails(1, 180, true); report.warmed.assets = true; } catch (e) { report.warnings.push('預熱 assets 失敗: ' + e); }
	try { getRecentActivity(); report.warmed.activity = true; } catch (e) { report.warnings.push('預熱 activity 失敗: ' + e); }
	try { getBorrowedAssets(); report.warmed.borrowed = true; } catch (e) { report.warnings.push('預熱 borrowed 失敗: ' + e); }
	try { getLocationData(); report.warmed.location = true; } catch (e) { report.warnings.push('預熱 location 失敗: ' + e); }

	try { bumpDataVersion(); } catch (e) { report.warnings.push('bumpDataVersion 失敗: ' + e); }

	return {
		success: true,
		message: 'hard refresh done',
		elapsedMs: new Date().getTime() - start,
		report: report,
		dataVersion: getDataVersion()
	};
}

function testGetSummaryData() {
	Logger.log("=== 開始診斷測試 ===");
  
	try {
		var result = getSummaryData(true, false);
		Logger.log("✅ getSummaryData 執行成功！");
		Logger.log("結果類型：" + typeof result);
		Logger.log("success: " + result.success);
		Logger.log("inventory 數量: " + (result.inventory ? result.inventory.length : "null"));
		Logger.log("assets 數量: " + (result.assets ? result.assets.length : "null"));
		Logger.log("完整結果：" + JSON.stringify(result));
		return result;
	} catch (e) {
		Logger.log("❌ getSummaryData 執行失敗：" + e);
		Logger.log("錯誤堆疊：" + e.stack);
		throw e;
	}
}
