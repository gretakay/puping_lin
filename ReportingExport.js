/**
 * Reporting and export APIs split from code.gs
 */

function sendWeeklyDonationSummary() {
	const ss = SpreadsheetApp.getActiveSpreadsheet();
	const staffSheet = ss.getSheetByName('Staff');
	const staffData = staffSheet.getDataRange().getValues();
	let adminEmails = [];
	for (let i = 1; i < staffData.length; i++) {
		const email = staffData[i][1];
		const isAdmin = staffData[i][5];
		if (email && (isAdmin === '是' || isAdmin === true)) adminEmails.push(email);
	}

	if (adminEmails.length === 0) return;

	const donationSheet = ss.getSheetByName('Donations');
	const data = donationSheet.getDataRange().getValues();
	const today = new Date();
	const sevenDaysAgo = new Date();
	sevenDaysAgo.setDate(today.getDate() - 7);

	let weeklyData = data.slice(1).filter(row => {
		const donationDate = new Date(row[1]);
		return donationDate >= sevenDaysAgo && donationDate <= today;
	});
	if (weeklyData.length === 0) return;

	weeklyData.sort((a, b) => new Date(b[1]) - new Date(a[1]));

	let tableHtml = `<h2 style="color: #1a365d;">本周捐贈物資彙整周報</h2>
		<p>統計區間：${Utilities.formatDate(sevenDaysAgo, 'GMT+8', 'yyyy/MM/dd')} ~ ${Utilities.formatDate(today, 'GMT+8', 'yyyy/MM/dd')}</p>
		<table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%; font-family: sans-serif; font-size: 14px;">
			<tr style="background-color: #f1f5f9;">
				<th>日期</th><th>捐贈者</th><th>物品名稱</th><th>數量</th><th>有效期限</th><th>存放位置</th>
			</tr>`;

	let csvContent = '日期,捐贈者,物品名稱,數量,單位,有效期限,存放位置,經辦人,分類\n';
	weeklyData.forEach(row => {
		const dateStr = Utilities.formatDate(new Date(row[1]), 'GMT+8', 'MM/dd');
		const fullDateStr = Utilities.formatDate(new Date(row[1]), 'GMT+8', 'yyyy/MM/dd');
		let expiryDate = row[8];
		let expiryStr = (expiryDate instanceof Date) ? Utilities.formatDate(expiryDate, 'GMT+8', 'yyyy/MM/dd') : (expiryDate || '無');
		tableHtml += `<tr>
			<td style="text-align: center;">${dateStr}</td>
			<td style="font-weight: bold;">${row[2]}</td>
			<td>${row[3]}</td>
			<td style="text-align: center;">${row[5]} ${row[4]}</td>
			<td style="text-align: center; color: #dc2626;">${expiryStr}</td>
			<td>${row[6]}</td>
		</tr>`;
		csvContent += `"${fullDateStr}","${row[2]}","${row[3]}","${row[5]}","${row[4]}","${expiryStr}","${row[6]}","${row[7]}","${row[10]}"\n`;
	});
	tableHtml += '</table><br><p style="color: #64748b; font-size: 12px;">※ 隨信附上本周資料 Excel 檔 (.csv)，供下載管理。</p>';

	const blob = Utilities.newBlob('\ufeff' + csvContent, 'text/csv', `Weekly_Report_${Utilities.formatDate(today, 'GMT+8', 'yyyyMMdd')}.csv`);
	GmailApp.sendEmail(adminEmails.join(','), '【系統通知】本周物資捐贈周報 (含 Excel 附件)', '請查看 HTML 內文或附件', {
		htmlBody: tableHtml,
		attachments: [blob]
	});
}

function exportInventoryToHtml(type, keyword, filter, categoryFilter) {
	const rawKeyword = String(keyword || '').trim().toLowerCase();
	const kw = rawKeyword.length >= 2 ? rawKeyword : '';
	const catF = (categoryFilter || '全部');
	const nowStr = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd HH:mm');
	const assetOnlyFilters = ['borrowed', 'consumed', 'repair', 'scrap'];

	const excelScript = `
		<script src="https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js"></script>
		<script>
			function exportTableToExcel(filename) {
				var tableSelect = document.getElementById('reportTable');
				if(!tableSelect) { alert('⚠️ 無資料可匯出'); return; }

				var baseName = (filename || '庫存報表').replace(/\.(xlsx|xls)$/i, '');
				var cloneTableNoImg = tableSelect.cloneNode(true);
				var imgs = cloneTableNoImg.getElementsByTagName('img');
				while (imgs.length > 0) {
					var img = imgs[0];
					if (img && img.parentNode) img.parentNode.textContent = '無照片';
				}

				if (typeof XLSX !== 'undefined' && XLSX.utils && XLSX.writeFile) {
					var workbook = XLSX.utils.table_to_book(cloneTableNoImg, { sheet: '庫存資產報表' });
					XLSX.writeFile(workbook, baseName + '.xlsx', { compression: true });
					return;
				}

				// Fallback: 若外部庫載入失敗，仍保留舊版 .xls 相容匯出
				var tableHTML = cloneTableNoImg.outerHTML;
				var fullHTML = '\uFEFF' +
										 '<meta http-equiv="content-type" content="application/vnd.ms-excel; charset=UTF-8">' +
										 '<style>table{border-collapse:collapse;} td,th{border:1px solid #000; text-align:left; vertical-align:middle;}</style>' +
										 tableHTML;
				var blob = new Blob([fullHTML], { type: 'application/vnd.ms-excel' });
				var link = document.createElement('a');
				link.href = URL.createObjectURL(blob);
				link.download = baseName + '.xls';
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				alert('⚠️ 目前無法輸出真實 .xlsx，已改用相容 .xls。建議另存為 .xlsx 後再回填。');
			}

			function printWithImages() {
				var imgs = Array.prototype.slice.call(document.querySelectorAll('img.report-img'));
				if (!imgs.length) {
					window.print();
					return;
				}

				var pending = 0;
				var done = false;

				function finish() {
					if (done) return;
					done = true;
					window.print();
				}

				imgs.forEach(function(img) {
					if (img.complete && img.naturalWidth > 0) return;
					pending++;
					img.addEventListener('load', function onLoad() {
						img.removeEventListener('load', onLoad);
						img.removeEventListener('error', onError);
						pending--;
						if (pending <= 0) finish();
					});
					function onError() {
						img.removeEventListener('load', onLoad);
						img.removeEventListener('error', onError);
						pending--;
						if (pending <= 0) finish();
					}
					img.addEventListener('error', onError);
				});

				if (pending <= 0) {
					finish();
					return;
				}

				setTimeout(finish, 3000);
			}
		</script>
	`;

	let html = `
	${excelScript}
	<style>
		body{font-family: 'Microsoft JhengHei', sans-serif; padding:20px; color:#333;}
		table{width:100%; border-collapse:collapse; margin-bottom:30px; table-layout:fixed;}
		th,td{border:1px solid #000; padding:8px; text-align:left; vertical-align:middle; word-wrap:break-word;}
		th{background:#e2e8f0; color:#000; font-weight:bold;}
		img.report-img { width: 70px; height: 70px; object-fit: cover; border-radius: 4px; border: 1px solid #ccc; display: block; margin: 0 auto;}
		.no-print { display: inline-block; margin-right:10px; }
		.btn-excel { background: #166534; color: white; padding: 10px 20px; border-radius: 6px; cursor: pointer; border: none; font-weight: bold; margin-bottom: 20px; }
		.btn-print { background: #1e293b; color: white; padding: 10px 20px; border-radius: 6px; cursor: pointer; border: none; font-weight: bold; margin-bottom: 20px; }
		@media print { .no-print { display: none !important; } }
	</style>

	<div class='no-print'>
		<button class='btn-excel' onclick="exportTableToExcel('庫存資產報表_${nowStr}')">📊 下載 Excel .xlsx (可回填)</button>
		<button class='btn-print' onclick='printWithImages()'>🖨️ 列印 / 轉存 PDF (含圖片)</button>
	</div>

	<h2>📊 庫存資產智控報表 (${nowStr})</h2>
	<div id='report-content'>`;

	const formatImg = (url) => {
		if (!url || url === '' || url === '無照片' || url.indexOf('⏳') > -1) return '無照片';
		return `<img src="${url}" class="report-img" alt="圖片">`;
	};

	const normalizeAssetIdsForDisplay = (raw) => {
		const src = Array.isArray(raw) ? raw : [raw];
		const out = [];
		src.forEach(v => {
			String(v || '')
				.split(/[,，\s]+/)
				.map(x => String(x || '').trim())
				.filter(Boolean)
				.forEach(x => out.push(x));
		});
		return out;
	};

	// 報表顯示用：將連號壓成完整區間，例如 STN26182~STN26198
	const condenseIdListFull = (idArray) => {
		if (!Array.isArray(idArray) || idArray.length === 0) return '';
		const ids = idArray
			.map(x => String(x || '').trim())
			.filter(Boolean)
			.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

		if (ids.length === 0) return '';

		const canContinue = (a, b) => {
			const am = String(a || '').match(/^(.*?)(\d+)$/);
			const bm = String(b || '').match(/^(.*?)(\d+)$/);
			if (!am || !bm) return false;
			if (am[1] !== bm[1]) return false;
			return parseInt(bm[2], 10) === parseInt(am[2], 10) + 1;
		};

		const out = [];
		let start = ids[0];
		let prev = ids[0];

		const flush = () => {
			if (start === prev) out.push(start);
			else out.push(start + '~' + prev);
		};

		for (let i = 1; i < ids.length; i++) {
			const cur = ids[i];
			if (canContinue(prev, cur)) {
				prev = cur;
				continue;
			}
			flush();
			start = cur;
			prev = cur;
		}
		flush();

		return out.join(', ');
	};

	let tableContent = '';
	if ((type === 'all' || type === 'inventory') && !assetOnlyFilters.includes(filter)) {
		const invRes = getInventorySummary(true);
		let f = invRes.data.filter(i => {
			const cat = i.category || '一般';
			const haystack = `${i.name || ''} ${i.location || ''} ${cat}`.toLowerCase();
			return haystack.includes(kw);
		});
		if (catF !== '全部') f = f.filter(i => i.category === catF);
		if (filter === 'sangha') f = f.filter(i => i.isSangha);
		if (filter === 'expiry') {
			const expiryItems = (getNearExpiry(7).data || []);
			const expiryNameSet = new Set(expiryItems.map(e => String(e.itemName || '')));
			f = f.filter(i => expiryNameSet.has(String(i.name || '')));
		}

		if (f.length > 0) {
			if (type === 'inventory') {
				tableContent += `<tr><td colspan="8" style="background:#dbeafe; font-weight:bold; font-size:16px; text-align:center;">📦 十方供養物彙整</td></tr>
					<tr>
						<th style="width:80px;">照片</th>
						<th style="width:90px;">來源</th>
						<th style="width:170px;">識別鍵</th>
						<th>品名規格</th>
						<th style="width:90px;">分類</th>
						<th style="width:120px;">有效期限</th>
						<th style="width:90px;">帳面數</th>
						<th style="width:140px;">位置</th>
					</tr>`;
				f.forEach(i => {
					const expiry = i.expiryDate || '---';
					const itemName = String(i.name || '').trim();
					const location = String(i.location || '').trim();
					const identifier = `${itemName}||${location}`;
					const bookQty = Number(i.qty) || 0;
					tableContent += `<tr>
						<td align="center">${formatImg(i.photoUrl)}</td>
						<td>十方供養物</td>
						<td>${identifier}</td>
						<td><b>${itemName}</b></td>
						<td>${i.category || ''}</td>
						<td>${expiry}</td>
						<td>${bookQty}</td>
						<td>${location}</td>
					</tr>`;
				});
			} else {
				tableContent += `<tr><td colspan="6" style="background:#dbeafe; font-weight:bold; font-size:16px; text-align:center;">📦 十方供養物彙整</td></tr>
					<tr><th style="width:80px;">照片</th><th>品名規格</th><th>分類</th><th style="width:120px;">有效期限</th><th>庫存</th><th>位置</th></tr>`;
				f.forEach(i => {
					const expiry = i.expiryDate || '---';
					tableContent += `<tr><td align="center">${formatImg(i.photoUrl)}</td><td><b>${i.name}</b></td><td>${i.category}</td><td>${expiry}</td><td>${i.qty} ${i.unit}</td><td>${i.location}</td></tr>`;
				});
			}
		}
	}

	if (type === 'all' || type === 'asset') {
		const assetList = getAvailableAssetsFull();
		let f = assetList.filter(a => {
			const cat = a.category || '一般';
			const ids = normalizeAssetIdsForDisplay(Array.isArray(a.ids) && a.ids.length ? a.ids : (a.id || ''));
			const haystack = `${a.name || ''} ${ids.map(x => String(x)).join(' ')} ${a.location || ''} ${a.keeper || ''} ${a.spec || ''} ${a.color || ''} ${cat}`.toLowerCase();
			return haystack.includes(kw);
		});
		if (catF !== '全部') f = f.filter(a => (a.category || '一般') === catF);
		if (filter === 'borrowed') f = f.filter(a => a.status === '借出中');
		if (filter === 'consumed') f = f.filter(a => a.status === '已領用');
		if (filter === 'repair') f = f.filter(a => a.status === '待維修');
		if (filter === 'scrap') f = f.filter(a => a.status.indexOf('損') > -1 || a.status.indexOf('遺失') > -1);
		if (filter === 'sangha' || filter === 'expiry') f = [];

		if (f.length > 0) {
			if (type === 'asset') {
				tableContent += `<tr><td colspan="9" style="background:#dbeafe; font-weight:bold; font-size:16px; text-align:center;">🛠️ 固定資產清冊</td></tr>
					<tr>
						<th style="width:80px;">照片</th>
						<th style="width:90px;">來源</th>
						<th style="width:220px;">識別鍵</th>
						<th>品名</th>
						<th style="width:140px;">規格 / 顏色</th>
						<th style="width:90px;">帳面數</th>
						<th style="width:120px;">位置</th>
						<th style="width:110px;">狀態</th>
						<th style="width:120px;">保管人</th>
					</tr>`;
				f.forEach(a => {
					const ids = normalizeAssetIdsForDisplay(Array.isArray(a.ids) && a.ids.length ? a.ids : (a.id || ''));
					const identifier = condenseIdListFull(ids);
					const displayQty = Number(a.count) || ids.length || 1;
					tableContent += `<tr>
						<td align="center">${formatImg(a.photoUrl)}</td>
						<td>固定資產</td>
						<td style="mso-number-format:'@'">${identifier}</td>
						<td><b>${a.name}</b></td>
						<td>${a.spec || ''} / ${a.color || ''}</td>
						<td>${displayQty}</td>
						<td>${a.location || ''}</td>
						<td>${a.status || ''}</td>
						<td>${a.keeper || '庫房'}</td>
					</tr>`;
				});
			} else {
				tableContent += `<tr><td colspan="9" style="background:#dbeafe; font-weight:bold; font-size:16px; text-align:center;">🛠️ 固定資產清冊</td></tr>
					<tr><th style="width:80px;">照片</th><th style="width:160px;">編號範圍</th><th>品名</th><th>規格 / 顏色</th><th style="width:80px;">數量</th><th style="width:70px;">單位</th><th style="width:120px;">保管人</th><th style="width:110px;">狀態</th><th>位置</th></tr>`;
				f.forEach(a => {
					const ids = normalizeAssetIdsForDisplay(Array.isArray(a.ids) && a.ids.length ? a.ids : (a.id || ''));
					const displayQty = Number(a.count) || ids.length || 1;
					tableContent += `<tr><td align="center">${formatImg(a.photoUrl)}</td>
						<td style="mso-number-format:'@'">${condenseIdListFull(ids)}</td>
						<td><b>${a.name}</b></td>
						<td>${a.spec || ''} / ${a.color || ''}</td>
						<td align="right">${displayQty}</td>
						<td>${a.unit || '件'}</td>
						<td>${a.keeper || '庫房'}</td>
						<td>${a.status}</td>
						<td>${a.location}</td></tr>`;
				});
			}
		}
	}

	if (tableContent) html += `<table id='reportTable' border='1' cellspacing='0' cellpadding='5'>${tableContent}</table>`;
	else html += `<p style='color:red; font-size:18px;'>📭 查無符合資料 (請檢查搜尋條件)</p>`;

	html += '</div>';
	return html;
}

function exportTableToExcel(filename) {
	return { success: false, message: 'This function is client-side in exported HTML only.', filename: filename || '' };
}

function exportTransactionHistoryByRange(startDateStr, endDateStr) {
	function parseMaybeDate(v) {
		if (!v) return null;
		if (v instanceof Date && !isNaN(v.getTime())) return v;
		const s = String(v || '').trim();
		if (!s) return null;
		const d = new Date(s);
		if (!isNaN(d.getTime())) return d;
		return null;
	}

	function toDateText(v) {
		const d = parseMaybeDate(v);
		return d ? Utilities.formatDate(d, 'GMT+8', 'yyyy/MM/dd') : '';
	}

	function calcOverdueDays(dueDate, now) {
		if (!dueDate) return 0;
		const dueEnd = new Date(dueDate.getTime());
		dueEnd.setHours(23, 59, 59, 999);
		const ms = now.getTime() - dueEnd.getTime();
		if (ms <= 0) return 0;
		return Math.floor(ms / 86400000) + 1;
	}

	function normalizeAssetIdToken(v) {
		return String(v == null ? '' : v)
			.replace(/[\u200B-\u200D\uFEFF]/g, '')
			.replace(/[，]/g, ',')
			.trim()
			.toUpperCase();
	}

	function expandAssetIds(rawValue) {
		const tokens = String(rawValue || '')
			.split(/[,，\s]+/)
			.map(s => normalizeAssetIdToken(s))
			.filter(Boolean);

		const out = [];
		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i];
			if (token.indexOf('~') === -1) {
				out.push(token);
				continue;
			}

			const parts = token.split('~');
			if (parts.length !== 2) {
				out.push(token);
				continue;
			}

			const left = normalizeAssetIdToken(parts[0]);
			const right = normalizeAssetIdToken(parts[1]);
			const leftMatch = left.match(/^(.*?)(\d+)$/);
			if (!leftMatch) {
				out.push(token);
				continue;
			}

			const prefix = leftMatch[1];
			const startDigits = leftMatch[2];
			const startNum = parseInt(startDigits, 10);
			if (isNaN(startNum)) {
				out.push(token);
				continue;
			}

			let endNum = NaN;
			const rightFull = right.match(/^(.*?)(\d+)$/);
			if (rightFull && rightFull[1] === prefix) {
				endNum = parseInt(rightFull[2], 10);
			} else if (/^\d+$/.test(right)) {
				if (right.length >= startDigits.length) {
					endNum = parseInt(right, 10);
				} else {
					const stitched = startDigits.slice(0, startDigits.length - right.length) + right;
					endNum = parseInt(stitched, 10);
				}
			}

			if (isNaN(endNum) || endNum < startNum || (endNum - startNum) > 5000) {
				out.push(token);
				continue;
			}

			for (let n = startNum; n <= endNum; n++) {
				out.push(prefix + String(n));
			}
		}

		return out;
	}

	function allocateQtyAcrossIds(idList, qtyAbs) {
		const ids = Array.isArray(idList) ? idList.map(x => normalizeAssetIdToken(x)).filter(Boolean) : [];
		const qty = Math.max(0, Number(qtyAbs) || 0);
		if (!ids.length || qty <= 0) return [];

		if (ids.length === 1) {
			return [{ id: ids[0], qty: qty }];
		}

		const out = [];
		const base = Math.floor(qty / ids.length);
		const remainder = qty % ids.length;
		for (let i = 0; i < ids.length; i++) {
			const take = base + (i < remainder ? 1 : 0);
			if (take > 0) out.push({ id: ids[i], qty: take });
		}
		return out;
	}

	const startDate = new Date(String(startDateStr || '').trim());
	const endDate = new Date(String(endDateStr || '').trim());
	if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
		throw new Error('日期格式錯誤，請重新選擇起訖日');
	}
	startDate.setHours(0, 0, 0, 0);
	endDate.setHours(23, 59, 59, 999);
	if (startDate.getTime() > endDate.getTime()) {
		throw new Error('起日不可晚於迄日');
	}

	const safeStartKey = Utilities.formatDate(startDate, 'GMT+8', 'yyyyMMdd');
	const safeEndKey = Utilities.formatDate(endDate, 'GMT+8', 'yyyyMMdd');
	const cacheKey = 'tx_range_html_v2_' + safeStartKey + '_' + safeEndKey;
	const cacheVerKey = cacheKey + '_ver';
	const currentVer = getDataVersion();
	const cachedVer = loadFromBigCache(cacheVerKey);
	const cachedHtml = loadFromBigCache(cacheKey);
	if (cachedHtml && typeof cachedHtml === 'string' && cachedVer === currentVer) {
		return cachedHtml;
	}

	const txFilterSet = { '領用': true, '借出': true, '歸還': true };
	const rows = [];
	const now = new Date();
	const assetRows = [];
	const assetFlowRows = [];
	const borrowQueuesById = {};
	const borrowPendingByRow = {};

	const tConsumables = getSheet(TRANS_CONSUMABLES_NAME).getDataRange().getValues();
	for (let i = 1; i < tConsumables.length; i++) {
		const r = tConsumables[i];
		const txDate = new Date(r[0]);
		if (isNaN(txDate.getTime())) continue;
		if (txDate < startDate || txDate > endDate) continue;
		const txType = String(r[1] || '').trim();
		if (!txFilterSet[txType]) continue;
		rows.push({
			date: txDate,
			type: txType,
			item: String(r[2] || ''),
			idOrRange: '',
			qty: Number(r[3]) || 0,
			person: String(r[4] || ''),
			handler: String(r[6] || ''),
			status: String(r[5] || ''),
			note: String(r[7] || ''),
			source: '十方供養物',
			dueDateText: '',
			returnState: '',
			overdueDays: 0
		});
	}

	const tAssets = getSheet(TRANS_ASSETS_NAME).getDataRange().getValues();
	for (let j = 1; j < tAssets.length; j++) {
		const r = tAssets[j];
		const rowKey = String(j + 1);
		const rowNum = j + 1;
		const txTypeRaw = String(r[1] || '').trim();
		const txKey = String(r[3] || '').trim();
		const txQtyAbs = Math.abs(Number(r[4]) || 0);
		const txIds = expandAssetIds(txKey);
		const txDate = new Date(r[0]);

		if (txQtyAbs > 0 && txIds.length > 0 && !isNaN(txDate.getTime())) {
			assetFlowRows.push({
				rowKey: rowKey,
				rowNum: rowNum,
				dateMs: txDate.getTime(),
				type: txTypeRaw,
				ids: txIds,
				qtyAbs: txQtyAbs
			});
		}
		if (isNaN(txDate.getTime())) continue;
		if (txDate < startDate || txDate > endDate) continue;
		const txType = txTypeRaw;
		if (!txFilterSet[txType]) continue;

		const dueDate = parseMaybeDate(r[6]);
		const dueDateText = toDateText(r[6]);

		assetRows.push({
			rowKey: rowKey,
			date: txDate,
			type: txType,
			item: String(r[2] || ''),
			idOrRange: txKey,
			qty: Number(r[4]) || 0,
			person: String(r[5] || ''),
			handler: String(r[8] || r[7] || ''),
			status: String(r[7] || ''),
			note: String(r[9] || ''),
			source: '固定資產',
			dueDateText: dueDateText,
			returnState: '',
			overdueDays: 0
		});
	}

	assetFlowRows.sort((a, b) => {
		if (a.dateMs !== b.dateMs) return a.dateMs - b.dateMs;
		return a.rowNum - b.rowNum;
	});

	assetFlowRows.forEach(f => {
		if (f.type === '借出') {
			const alloc = allocateQtyAcrossIds(f.ids, f.qtyAbs);
			alloc.forEach(a => {
				if (!borrowQueuesById[a.id]) borrowQueuesById[a.id] = [];
				borrowQueuesById[a.id].push({ rowKey: f.rowKey, remaining: a.qty });
				borrowPendingByRow[f.rowKey] = (Number(borrowPendingByRow[f.rowKey]) || 0) + a.qty;
			});
			return;
		}

		if (f.type === '歸還') {
			const consumeForId = (id, want) => {
				let leftLocal = Math.max(0, Number(want) || 0);
				if (leftLocal <= 0) return 0;
				const queue = borrowQueuesById[id] || [];
				let consumed = 0;
				while (leftLocal > 0 && queue.length > 0) {
					// Same ID can be borrowed multiple times; close the latest open lot first.
					const lot = queue[queue.length - 1];
					const take = Math.min(Number(lot.remaining) || 0, leftLocal);
					if (take <= 0) {
						queue.pop();
						continue;
					}
					lot.remaining -= take;
					borrowPendingByRow[lot.rowKey] = Math.max(0, (Number(borrowPendingByRow[lot.rowKey]) || 0) - take);
					leftLocal -= take;
					consumed += take;
					if (lot.remaining <= 0) queue.pop();
				}
				return consumed;
			};

			let left = f.qtyAbs;
			const ids = (f.ids || []).map(x => normalizeAssetIdToken(x)).filter(Boolean);

			if (ids.length <= 1) {
				if (ids.length === 1) left -= consumeForId(ids[0], left);
				return;
			}

			// Multi-ID aggregate returns do not carry per-ID quantities;
			// consume in round-robin to avoid starving later IDs.
			let progressed = true;
			while (left > 0 && progressed) {
				progressed = false;
				for (let idIdx = 0; idIdx < ids.length; idIdx++) {
					if (left <= 0) break;
					const taken = consumeForId(ids[idIdx], 1);
					if (taken > 0) {
						left -= taken;
						progressed = true;
					}
				}
			}
		}
	});

	assetRows.forEach(r => {
		if (r.type !== '借出') {
			rows.push(r);
			return;
		}

		const pendingQty = Number(borrowPendingByRow[r.rowKey]) || 0;
		const borrowQty = Math.abs(Number(r.qty) || 0);
		if (pendingQty <= 0) {
			r.returnState = '已歸還';
			r.overdueDays = 0;
		} else {
			const dueDate = parseMaybeDate(r.dueDateText);
			r.overdueDays = calcOverdueDays(dueDate, now);
			const remainText = '剩 ' + pendingQty + (borrowQty > 0 ? (' / ' + borrowQty) : '') + ' 件';
			r.returnState = r.overdueDays > 0 ? ('逾期未歸還 (' + remainText + '，' + r.overdueDays + ' 天)') : ('待歸還 (' + remainText + ')');
		}
		rows.push(r);
	});

	rows.sort((a, b) => b.date.getTime() - a.date.getTime());

	const nowStr = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd HH:mm');
	const periodStr = Utilities.formatDate(startDate, 'GMT+8', 'yyyy/MM/dd') + ' ~ ' + Utilities.formatDate(endDate, 'GMT+8', 'yyyy/MM/dd');
	const excelScript = `
		<script src="https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js"></script>
		<script>
			function exportTableToExcel(filename) {
				var tableSelect = document.getElementById('reportTable');
				if(!tableSelect) { alert('⚠️ 無資料可匯出'); return; }

				var baseName = (filename || '交易紀錄').replace(/\.(xlsx|xls)$/i, '');

				if (typeof XLSX !== 'undefined' && XLSX.utils && XLSX.writeFile) {
					var workbook = XLSX.utils.table_to_book(tableSelect, { sheet: '交易紀錄' });
					XLSX.writeFile(workbook, baseName + '.xlsx', { compression: true });
					return;
				}

				// Fallback: 外部套件載入失敗時，退回舊式 .xls 匯出
				var tableHTML = tableSelect.outerHTML;
				var fullHTML = '\uFEFF' +
					'<meta http-equiv="content-type" content="application/vnd.ms-excel; charset=UTF-8">' +
					'<style>table{border-collapse:collapse;} td,th{border:1px solid #000; text-align:left; vertical-align:middle;}</style>' +
					tableHTML;
				var blob = new Blob([fullHTML], { type: 'application/vnd.ms-excel' });
				var link = document.createElement('a');
				link.href = URL.createObjectURL(blob);
				link.download = baseName + '.xls';
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				alert('⚠️ 目前無法輸出真實 .xlsx，已改用相容 .xls。請稍後再試。');
			}
		</script>
	`;

	let html = `
	${excelScript}
	<style>
		body{font-family:'Microsoft JhengHei',sans-serif;padding:20px;color:#333;}
		table{width:100%;border-collapse:collapse;margin-bottom:20px;table-layout:fixed;}
		th,td{border:1px solid #000;padding:8px;text-align:left;vertical-align:middle;word-wrap:break-word;}
		th{background:#e2e8f0;font-weight:bold;}
		.overdue-row{background:#fff1f2;}
		.overdue-cell{color:#b91c1c;font-weight:900;}
		.pending-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-weight:900;font-size:12px;}
		.pending-badge.ok{background:#dcfce7;color:#166534;}
		.pending-badge.overdue{background:#fee2e2;color:#b91c1c;}
		.no-print{display:inline-block;margin-right:10px;}
		.btn{background:#166534;color:white;padding:10px 20px;border-radius:6px;cursor:pointer;border:none;font-weight:bold;margin-bottom:20px;}
		.btn-print{background:#1e293b;}
		@media print {.no-print { display:none !important; }}
	</style>
	<div class='no-print'>
		<button class='btn' onclick="exportTableToExcel('交易紀錄_${Utilities.formatDate(new Date(), 'GMT+8', 'yyyyMMdd_HHmm')}')">📊 下載 Excel</button>
		<button class='btn btn-print' onclick='window.print()'>🖨️ 列印 / 轉存 PDF</button>
	</div>
	<h2>📄 領用 / 借用 / 歸還 區間紀錄</h2>
	<p>區間：${periodStr} ｜ 產出時間：${nowStr} ｜ 筆數：${rows.length}</p>
	`;

	if (!rows.length) {
		html += `<p style='color:#b91c1c; font-size:16px;'>此區間查無交易紀錄。</p>`;
		return html;
	}

	html += `<table id='reportTable'><thead><tr>
		<th style='width:140px;'>時間</th>
		<th style='width:70px;'>類型</th>
		<th style='width:90px;'>來源</th>
		<th>品項</th>
		<th style='width:160px;'>編號/範圍</th>
		<th style='width:80px;'>數量</th>
		<th style='width:120px;'>人員</th>
		<th style='width:120px;'>經手人</th>
		<th style='width:110px;'>預計歸還日</th>
		<th style='width:120px;'>歸還狀態</th>
		<th style='width:90px;'>狀態</th>
		<th>備註</th>
	</tr></thead><tbody>`;

	rows.forEach(r => {
		const d = Utilities.formatDate(r.date, 'GMT+8', 'yyyy/MM/dd HH:mm');
		const isOverdueRow = r.type === '借出' && String(r.returnState || '').indexOf('逾期未歸還') === 0;
		const returnState = r.type === '借出' ? (r.returnState || '待歸還') : '';
		const dueDateText = r.type === '借出' ? (r.dueDateText || '') : '';
		let statusText = r.status || '';
		if (r.type === '借出') {
			if (String(returnState || '').indexOf('已歸還') === 0) statusText = '已歸還';
			else if (String(returnState || '').indexOf('逾期未歸還') === 0) statusText = '待歸還(逾期)';
			else if (String(returnState || '').indexOf('待歸還') === 0) statusText = '待歸還';
		}
		html += `<tr>
			<td>${d}</td>
			<td>${r.type}</td>
			<td>${r.source}</td>
			<td>${r.item}</td>
			<td style="mso-number-format:'@'">${r.idOrRange || ''}</td>
			<td>${r.qty}</td>
			<td>${r.person || ''}</td>
			<td>${r.handler || ''}</td>
			<td>${dueDateText}</td>
			<td class='${isOverdueRow ? 'overdue-cell' : ''}'>${returnState}</td>
			<td>${statusText}</td>
			<td>${r.note || ''}</td>
		</tr>`;
	});

	html += '</tbody></table>';
	try {
		saveToBigCache(cacheKey, html, 300);
		saveToBigCache(cacheVerKey, currentVer, 300);
	} catch (e) {}
	return html;
}
