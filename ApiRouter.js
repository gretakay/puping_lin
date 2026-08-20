/**
 * JSON API entrypoint for the Vercel frontend migration.
 * Called by the Vercel serverless proxy (api/gas.js), never directly by browsers.
 * See MIGRATION.md for the full architecture and call-site inventory.
 * (touched to force a full clasp push after fixing .claspignore)
 */

const API_WHITELIST = new Set([
	'warmUpSummaryCache',
	'addDonationFast',
	'updatePhotoInBackground',
	'getLocationList',
	'searchAssetForRestock',
	'updateAssetPhotoInBackground',
	'importAssetFast',
	'getRecentDonationsLite',
	'getNearExpiryLite',
	'searchTransferCandidates',
	'executeAssetTransfer',
	'getTransferLocationList',
	'getLocationData',
	'setNineGridTarget',
	'getWithdrawInventory',
	'getWithdrawAssets',
	'getDataVersion',
	'withdrawItem',
	'getBorrowedAssets',
	'returnAsset',
	'getScrapDetails',
	'syncAssetSheetLocationsAndCaches',
	'hardRefreshAllCachesAndIndexes',
	'getInventoryDetails',
	'getRecentActivity',
	'getAssetsDetails',
	'exportInventoryToHtml',
	'exportTransactionHistoryByRange',
	'getInventoryCorrectionData',
	'setStocktakeLock',
	'applyStocktakeCorrections'
]);

function apiJsonOut(obj) {
	return ContentService.createTextOutput(JSON.stringify(obj))
		.setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
	let body;
	try {
		body = JSON.parse(e && e.postData && e.postData.contents || '{}');
	} catch (err) {
		return apiJsonOut({ error: '無效的 JSON 內容' });
	}

	const expectedSecret = PropertiesService.getScriptProperties().getProperty('API_SECRET');
	if (!expectedSecret || body.secret !== expectedSecret) {
		return apiJsonOut({ error: '密鑰驗證失敗' });
	}

	const fn = body.fn;
	if (!API_WHITELIST.has(fn)) {
		return apiJsonOut({ error: '不允許呼叫此函式：' + fn });
	}

	try {
		const result = globalThis[fn].apply(null, body.args || []);
		return apiJsonOut({ result: result });
	} catch (err) {
		return apiJsonOut({ error: err.toString() });
	}
}
