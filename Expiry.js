/**
 * Expiry Module
 */

function getExpirySecret() {
	const prop = PropertiesService.getScriptProperties();
	let secret = prop.getProperty('EXPIRY_SECRET');
	if (!secret) {
		secret = Utilities.getUuid().replace(/-/g, '');
		prop.setProperty('EXPIRY_SECRET', secret);
	}
	return secret;
}

function hmacHex(payload) {
	const sig = Utilities.computeHmacSha256Signature(payload, getExpirySecret());
	return sig.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function createExpiryToken(rowIndex, expiryStr, action, targetEmail) {
	const payload = [rowIndex, expiryStr, action, targetEmail || ''].join('|');
	const sigHex = hmacHex(payload);
	return Utilities.base64EncodeWebSafe(payload + '|' + sigHex);
}

function verifyExpiryToken(token, expectedAction) {
	try {
		const decoded = Utilities.newBlob(Utilities.base64DecodeWebSafe(token)).getDataAsString();
		const parts = decoded.split('|');
		if (parts.length !== 5) return null;
		const [rowStr, expiryStr, action, email, sigHex] = parts;
		if (expectedAction && action !== expectedAction) return null;
		const payload = [rowStr, expiryStr, action, email].join('|');
		if (hmacHex(payload) !== sigHex) return null;

		const expiryDate = new Date(expiryStr);
		if (!(expiryDate instanceof Date) || isNaN(expiryDate)) return null;

		const today = new Date(); today.setHours(0, 0, 0, 0);
		const pastLimit = new Date(today); pastLimit.setDate(today.getDate() - 3);
		if (expiryDate < pastLimit) return null;
		return { rowIndex: rowStr, expiryStr, action, email };
	} catch (e) {
		return null;
	}
}

function dailyExpiryCheck() {
	const days = 7;
	const rows = getSheet(SHEET_NAME).getDataRange().getValues();
	const today = new Date(); today.setHours(0, 0, 0, 0);
	const limitDate = new Date(); limitDate.setDate(today.getDate() + days);

	const expiryItems = [];
	for (let i = 1; i < rows.length; i++) {
		const exp = rows[i][8];
		const qty = Number(rows[i][5]);
		if ((exp instanceof Date) && exp >= today && exp <= limitDate && qty > 0) {
			expiryItems.push({
				rowIndex: i + 1,
				itemName: rows[i][3],
				unit: rows[i][4],
				quantity: qty,
				location: rows[i][6],
				expiryStr: Utilities.formatDate(exp, 'GMT+8', 'yyyy-MM-dd')
			});
		}
	}
	if (expiryItems.length === 0) return;

	const staffData = getSheet(STAFF_SHEET_NAME).getDataRange().getValues();
	const recipients = staffData.filter(s => String(s[4]) === '是' || String(s[5]) === '是').map(s => s[1]).filter(Boolean);
	if (recipients.length === 0) return;

	const baseUrl = getScriptUrl();
	const subject = '【系統警示】物資即將到期提醒';

	recipients.forEach(email => {
		const batchRows = expiryItems.map(i => i.rowIndex).join(',');
		const batchToken = createExpiryToken(batchRows, Utilities.formatDate(today, 'GMT+8', 'yyyy-MM-dd'), 'consumeSome', email);
		const batchUrl = `${baseUrl}?action=expiry&act=consumeSome&token=${encodeURIComponent(batchToken)}`;

		let html = `<p>下列物資將於一週內到期，您可直接點擊按鈕完成處理：</p><p><a href="${batchUrl}" style="font-weight:bold;">批次勾選領用（可挑選部分）</a></p><ul>`;
		expiryItems.forEach(item => {
			const tokenConsume = createExpiryToken(item.rowIndex, item.expiryStr, 'consume', email);
			const tokenDiscard = createExpiryToken(item.rowIndex, item.expiryStr, 'discard', email);
			const consumeUrl = `${baseUrl}?action=expiry&act=consume&token=${encodeURIComponent(tokenConsume)}`;
			const discardUrl = `${baseUrl}?action=expiry&act=discard&token=${encodeURIComponent(tokenDiscard)}`;
			html += `<li>● ${item.itemName} (${item.quantity} ${item.unit}) 到期:${item.expiryStr} 存於:${item.location || '未填'}<br><a href="${consumeUrl}">標記已領用</a> ｜ <a href="${discardUrl}">標記報廢</a></li>`;
		});
		html += '</ul><p style="color:#666;font-size:12px;">此連結僅限收件者本人（需登入公司帳號）使用，以避免被轉寄誤觸。</p>';

		const plainText = '下列物資將於一週內到期：\n' + expiryItems.map(it => `● ${it.itemName} (${it.quantity}${it.unit}) 到期:${it.expiryStr} 存於:${it.location || '未填'}`).join('\n') + '\n\n請以公司帳號登入後點擊郵件內按鈕完成處理。';
		GmailApp.sendEmail(email, subject, plainText, { htmlBody: html });
	});
}

function handleExpiryAction(e) {
	const act = e && e.parameter && e.parameter.act;
	const token = e && e.parameter && e.parameter.token;
	const reason = e && e.parameter && e.parameter.reason;
	const selected = e && e.parameter && e.parameter.rows;
	if (!act || !token) return HtmlService.createHtmlOutput('缺少必要參數');

	const verification = verifyExpiryToken(token, act);
	if (!verification || !verification.rowIndex) return HtmlService.createHtmlOutput('連結無效或已過期');

	if (checkStocktakeLocked()) {
		return HtmlService.createHtmlOutput('盤點進行中，暫時禁止領用操作。請等盤點結束後再處理。');
	}

	const sessionEmail = (Session.getActiveUser() && Session.getActiveUser().getEmail()) || '';
	const operatorEmail = sessionEmail || verification.email || 'unknown@unknown';
	const renderAutoClose = (msg) => HtmlService.createHtmlOutput(`<p>${msg}</p><p style="color:#666;font-size:12px;">此頁將自動關閉，若未關閉請手動關閉頁籤。</p><script>setTimeout(function(){try{window.open('','_self');window.close();}catch(e){}},1000);</script>`);
	const lock = LockService.getScriptLock();
	try {
		lock.waitLock(10000);
		const sheet = getSheet(SHEET_NAME);
		const tSheet = getSheet(TRANS_CONSUMABLES_NAME);
		const now = new Date();

		if (act === 'consume') {
			const row = parseInt(verification.rowIndex, 10);
			const rowData = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
			const qty = Number(rowData[5]);
			const itemName = rowData[3];
			const unit = rowData[4];
			if (qty <= 0) return renderAutoClose('此品項已處理完畢');
			sheet.getRange(row, 6).setValue(0);
			tSheet.appendRow([now, '領用', itemName, qty * -1, operatorEmail, '完成', operatorEmail, 'Email 一鍵領用']);
			return renderAutoClose(`已將「${itemName}」標記為已領用 (${qty} ${unit})，操作人：${operatorEmail}`);
		}

		if (act === 'consumeSome') {
			const rowsStr = selected || verification.rowIndex;
			const rows = String(rowsStr).split(',').map(s => parseInt(s, 10)).filter(n => n > 0);
			if (!selected) {
				let listHtml = '<form method="GET"><input type="hidden" name="action" value="expiry"><input type="hidden" name="act" value="consumeSome"><input type="hidden" name="token" value="'+encodeURIComponent(token)+'">';
				listHtml += '<p>請勾選要標記已領用的品項：</p><div><button type="button" onclick="toggleAll(true)">全選</button> <button type="button" onclick="toggleAll(false)">全不選</button></div><ul id="itemList">';
				rows.forEach(rn => {
					const rd = sheet.getRange(rn, 1, 1, sheet.getLastColumn()).getValues()[0];
					const qty = Number(rd[5]);
					if (qty <= 0) return;
					const label = `${rd[3]} (${qty} ${rd[4]}) 到期:${Utilities.formatDate(rd[8], 'GMT+8', 'yyyy-MM-dd')} 存於:${rd[6]}`;
					listHtml += `<li><label><input type="checkbox" name="rows" value="${rn}" checked> ${label}</label></li>`;
				});
				listHtml += '</ul><button type="submit">標記已領用</button></form><script>function toggleAll(state){document.querySelectorAll("input[name=\\"rows\\"]").forEach(function(b){b.checked=state;});}</script>';
				return HtmlService.createHtmlOutput(listHtml);
			}

			let processed = 0;
			rows.forEach(rn => {
				const rd = sheet.getRange(rn, 1, 1, sheet.getLastColumn()).getValues()[0];
				const qty = Number(rd[5]);
				if (qty > 0) {
					sheet.getRange(rn, 6).setValue(0);
					tSheet.appendRow([now, '領用', rd[3], qty * -1, operatorEmail, '完成', operatorEmail, 'Email 勾選批次領用']);
					processed++;
				}
			});
			return renderAutoClose(processed > 0 ? `已完成領用 ${processed} 筆，操作人：${operatorEmail}` : '無可處理的品項（可能已為 0）');
		}

		return HtmlService.createHtmlOutput('未知操作類型');
	} catch (err) {
		return HtmlService.createHtmlOutput('處理失敗：' + err.toString());
	} finally {
		lock.releaseLock();
	}
}
