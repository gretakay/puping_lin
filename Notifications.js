/**
 * Notification Module
 */

function isLineNotifyEnabled() {
	const props = PropertiesService.getScriptProperties();
	return String(props.getProperty('ENABLE_LINE_NOTIFY') || '').trim().toLowerCase() === 'true';
}

function sendLineNotify(message) {
	if (!isLineNotifyEnabled()) return false;
	const props = PropertiesService.getScriptProperties();
	const token = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN') || "uCnd83wv/2XWv5hc7fPcAKVXjsU+SivZomvuBwAu1ZrbLHs2NxoWhw/LNvtpTN6J5Bv64xli26hUzVI2vkD1LFdgo3f7ipyxvsd9pli6BGzJzeJQ1Bt5Qqu3ua5tZKhcV5gams0/K0cx0WSv1R/MeAdB04t89/1O/w1cDnyilFU=";
	const groupId = props.getProperty('LINE_GROUP_ID') || "C528825acccee56994c32f04316958563";
	const url = "https://api.line.me/v2/bot/message/push";
	const text = String(message == null ? '' : message).trim();
	if (!text) throw new Error('LINE 訊息內容不可為空');

	const payload = { to: groupId, messages: [{ type: 'text', text: text.slice(0, 5000) }] };
	const options = {
		method: 'post',
		contentType: 'application/json',
		headers: { Authorization: 'Bearer ' + token },
		payload: JSON.stringify(payload),
		muteHttpExceptions: true
	};

	const response = UrlFetchApp.fetch(url, options);
	const code = response.getResponseCode();
	const body = response.getContentText();
	if (code < 200 || code >= 300) throw new Error('LINE API 錯誤: HTTP ' + code + ' / ' + body);
	return true;
}

function normalizeDisplayDateText(v) {
	if (!v) return '';
	try {
		if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, 'GMT+8', 'yyyy/MM/dd');
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

function sendEmailAndLine(subject, body, recipients, htmlBody) {
	const uniqueRecipients = Array.from(new Set((Array.isArray(recipients) ? recipients : [recipients]).map(x => String(x || '').trim()).filter(Boolean)));
	const result = { emailSent: false, lineSent: false, emailError: '', lineError: '' };
	const safeSubject = String(subject == null ? '' : subject).trim();
	const safeBody = String(body == null ? '' : body).trim();

	try {
		if (uniqueRecipients.length > 0) {
			const primaryTo = uniqueRecipients[0];
			const bccList = uniqueRecipients.slice(1).join(',');
			const mailOptions = {};
			if (htmlBody) mailOptions.htmlBody = htmlBody;
			if (bccList) mailOptions.bcc = bccList;
			GmailApp.sendEmail(primaryTo, safeSubject || '(無主旨)', safeBody || ' ', mailOptions);
		}
		result.emailSent = true;
	} catch (err) {
		result.emailError = err.toString();
	}

	try {
		const lineMessage = [safeSubject, safeBody].filter(Boolean).join('\n\n').trim();
		if (!isLineNotifyEnabled()) {
			result.lineError = 'LINE 推播已停用（ENABLE_LINE_NOTIFY 不是 true）';
		} else if (lineMessage) {
			sendLineNotify(lineMessage);
			result.lineSent = true;
		} else {
			result.lineError = 'LINE 訊息為空，已略過';
		}
	} catch (err) {
		result.lineError = err.toString();
	}

	return result;
}

function sendAssetNotification(type, assetList, person, keeperFullName, note, returnDate) {
	try {
		const assets = Array.isArray(assetList) ? assetList : [assetList];
		const keeperSet = new Set();
		assets.forEach(item => {
			const k = String((item && item.keeper) || '').trim();
			if (k) keeperSet.add(k);
		});
		if (keeperSet.size === 0 && String(keeperFullName || '').trim()) keeperSet.add(String(keeperFullName || '').trim());

		const staffData = getSheet(STAFF_SHEET_NAME).getDataRange().getValues();
		let recipients = [];
		for (let i = 1; i < staffData.length; i++) {
			const row = staffData[i];
			const fullName = String(row[0] || '').trim();
			const isTransAlert = String(row[3] || '') === '是';
			const isAdmin = String(row[5] || '') === '是';
			if (row[1] && (isAdmin || (isTransAlert && keeperSet.has(fullName)))) {
				recipients.push(row[1]);
			}
		}
		if (recipients.length === 0) return { success: true, sent: false, reason: 'no_recipients' };

		const keeperGrouped = new Map();
		assets.forEach(item => {
			const keeper = String((item && item.keeper) || '').trim() || '庫房';
			if (!keeperGrouped.has(keeper)) keeperGrouped.set(keeper, []);
			keeperGrouped.get(keeper).push(item);
		});

		let details = '';
		keeperGrouped.forEach((keeperAssets, keeperName) => {
			const groupedMap = new Map();
			keeperAssets.forEach(item => {
			let statusTag = '';
			if (type === '歸還' && item.status) statusTag = item.status === '在庫' ? ' 【✔️已入庫】' : ` 【⚠️${item.status}】`;
			const loc = String(item.location || '').trim() || '未標註';
			const key = `${item.name}${item.spec ? ' [' + item.spec + ']' : ''}${item.color && item.color !== '無' ? ' (' + item.color + ')' : ''}${statusTag}`;
			if (!groupedMap.has(key)) groupedMap.set(key, { count: 0, ids: [], unit: item.unit || '件', locations: new Set() });
			const g = groupedMap.get(key);
			const qty = Number(item.qty) || Number(item.count) || (Array.isArray(item.ids) ? item.ids.length : (item.id ? 1 : 0));
			g.count += qty;
			g.locations.add(loc);
			if (Array.isArray(item.ids)) g.ids = g.ids.concat(item.ids);
			else if (item.id) g.ids.push(item.id);
			});

			details += `○ 保管人：${keeperName}\n`;
			groupedMap.forEach((info, title) => {
				const cabinetText = Array.from(info.locations || []).filter(Boolean).join(', ');
				details += `   ● ${title} (共 ${info.count} ${info.unit})\n      └ 編號：${condenseIdList(info.ids)}\n      └ 櫃位：${cabinetText || '未標註'}\n`;
			});
		});

		const totalCount = assets.reduce((s, it) => s + (Number(it.qty) || Number(it.count) || (Array.isArray(it.ids) ? it.ids.length : 1)), 0);
		const subject = `【系統通知】資產${type}彙整：共 ${totalCount} 件`;
		const label = type === '歸還' ? '歸還人員' : (type === '領用' ? '領用人員' : '借用人員');
		const now = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy/MM/dd HH:mm');
		const normalizedReturnDate = normalizeDisplayDateText(returnDate);
		const keeperSummary = Array.from(keeperSet).filter(Boolean);
		const keeperText = keeperSummary.length <= 1 ? (keeperSummary[0] || String(keeperFullName || '庫房')) : `多位 (${keeperSummary.join('、')})`;
		const body = `您好，資產異動紀錄如下：\n--------------------------------------\n● 異動時間：${now}\n● 類型：${type}\n● ${label}：${person}\n● 原保管人：${keeperText}\n● 本次${type}數量：${totalCount}\n● 異動清單：\n${details}${note ? `● 備註：${note}\n` : ''}${normalizedReturnDate ? `● 預計歸還日：${normalizedReturnDate}\n` : ''}--------------------------------------`;
		sendEmailAndLine(subject, body, [...new Set(recipients)]);
		return { success: true, sent: true };
	} catch (err) {
		throw err;
	}
}

function ensureNotificationQueueSheet() { return getSheet(NOTIFICATION_QUEUE_NAME); }

function isTransientStorageError(err) {
	const msg = String(err && err.message ? err.message : err || '');
	return /server error occurred|reading from storage|FAILED_PRECONDITION|INTERNAL|RESOURCE_EXHAUSTED/i.test(msg);
}

function runWithStorageRetry(taskFn, maxAttempts, baseWaitMs) {
	const attempts = Math.max(1, Number(maxAttempts) || 4);
	const waitMs = Math.max(100, Number(baseWaitMs) || 300);
	let lastErr = null;

	for (let i = 0; i < attempts; i++) {
		try {
			return taskFn();
		} catch (err) {
			lastErr = err;
			if (!isTransientStorageError(err) || i === attempts - 1) throw err;
			Utilities.sleep(waitMs * (i + 1));
		}
	}
	throw lastErr || new Error('storage retry failed');
}

function enqueueNotificationBatch(type, assets, person, note, returnDate) {
	try {
		if (!Array.isArray(assets) || assets.length === 0) return { success: true, queued: 0 };
		try { setupNotificationWorkerTrigger(); } catch (e) {}
		const queueSheet = ensureNotificationQueueSheet();
		const keeperList = Array.from(new Set((assets || []).map(a => String((a && a.keeper) || '').trim()).filter(Boolean)));
		const keeperSummary = keeperList.length > 0 ? keeperList.join('、') : '庫房';
		const now = new Date();
		const rows = [[
			now,
			'pending',
			String(type || ''),
			keeperSummary,
			String(person || ''),
			String(note || ''),
			normalizeDisplayDateText(returnDate),
			JSON.stringify(assets || []),
			0,
			'',
			now
		]];
		if (rows.length > 0) {
			runWithStorageRetry(() => {
				queueSheet.getRange(queueSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
				return true;
			}, 4, 250);
		}
		return { success: true, queued: rows.length };
	} catch (e) {
		return { success: false, message: e.toString(), queued: 0 };
	}
}

function processNotificationQueue(limit) {
	const lock = LockService.getScriptLock();
	try {
		lock.waitLock(5000);
		const maxCount = Math.max(1, Number(limit) || 30);
		const queueSheet = runWithStorageRetry(() => ensureNotificationQueueSheet(), 4, 250);
		const lastRow = runWithStorageRetry(() => queueSheet.getLastRow(), 4, 250);
		if (lastRow <= 1) return { success: true, processed: 0, sent: 0, failed: 0 };
		const data = runWithStorageRetry(() => queueSheet.getRange(2, 1, lastRow - 1, 11).getValues(), 4, 250);
		let processed = 0, sent = 0, failed = 0;
		for (let i = 0; i < data.length && processed < maxCount; i++) {
			const rowNum = i + 2;
			const row = data[i];
			const status = String(row[1] || '').toLowerCase();
			const retries = Number(row[8]) || 0;
			if (!(status === 'pending' || status === 'retry')) continue;
			if (retries >= 5) continue;
			const type = String(row[2] || '');
			const keeper = String(row[3] || '庫房');
			const person = String(row[4] || '');
			const note = String(row[5] || '');
			const returnDate = String(row[6] || '');
			let assets = [];
			try {
				assets = JSON.parse(String(row[7] || '[]'));
				if (!Array.isArray(assets)) assets = [];
				sendAssetNotification(type, assets, person, keeper, note, returnDate || null);
				runWithStorageRetry(() => {
					queueSheet.getRange(rowNum, 2, 1, 10).setValues([['sent', type, keeper, person, note, returnDate, row[7], retries, '', new Date()]]);
					return true;
				}, 4, 250);
				sent++;
			} catch (err) {
				const nextRetry = retries + 1;
				const nextStatus = nextRetry >= 5 ? 'failed' : 'retry';
				const errMsg = String(err && err.message ? err.message : err).slice(0, 500);
				runWithStorageRetry(() => {
					queueSheet.getRange(rowNum, 2, 1, 10).setValues([[nextStatus, type, keeper, person, note, returnDate, row[7], nextRetry, errMsg, new Date()]]);
					return true;
				}, 4, 250);
				failed++;
			}
			processed++;
		}
		return { success: true, processed: processed, sent: sent, failed: failed };
	} catch (e) {
		return { success: false, message: e.toString(), processed: 0, sent: 0, failed: 0 };
	} finally {
		try { lock.releaseLock(); } catch (e) {}
	}
}

function setupNotificationWorkerTrigger() {
	const fnName = 'processNotificationQueue';
	const existing = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === fnName);
	if (existing) return { success: true, message: '通知背景觸發器已存在' };
	ScriptApp.newTrigger(fnName).timeBased().everyMinutes(1).create();
	return { success: true, message: '通知背景觸發器已建立（每分鐘執行）' };
}

function distributeNotifications(type, assets, person, note, returnDate) {
	return enqueueNotificationBatch(type, assets, person, note, returnDate);
}

function getAdminRecipientEmails() {
	try {
		const staffData = getSheet(STAFF_SHEET_NAME).getDataRange().getValues();
		const emails = [];
		for (let i = 1; i < staffData.length; i++) {
			const row = staffData[i] || [];
			const email = String(row[1] || '').trim();
			const isAdmin = String(row[5] || '').trim() === '是' || row[5] === true;
			if (email && isAdmin) emails.push(email);
		}
		return Array.from(new Set(emails));
	} catch (e) {
		return [];
	}
}

function getStaffRecipientDirectory() {
	try {
		const staffData = getSheet(STAFF_SHEET_NAME).getDataRange().getValues();
		const adminEmails = [];
		const nameToEmail = {};
		for (let i = 1; i < staffData.length; i++) {
			const row = staffData[i] || [];
			const fullName = String(row[0] || '').trim();
			const email = String(row[1] || '').trim();
			const isAdmin = String(row[5] || '').trim() === '是' || row[5] === true;
			if (email && isAdmin) adminEmails.push(email);
			if (fullName && email) nameToEmail[fullName] = email;
		}
		return {
			adminEmails: Array.from(new Set(adminEmails)),
			nameToEmail: nameToEmail
		};
	} catch (e) {
		return { adminEmails: [], nameToEmail: {} };
	}
}

function checkAndNotifyLowStockAssets() {
	const lock = LockService.getScriptLock();
	try {
		lock.waitLock(5000);

		const directory = getStaffRecipientDirectory();

		const props = PropertiesService.getScriptProperties();
		const stateKey = 'LOW_STOCK_ALERT_STATE_V1';
		let state = {};
		try { state = JSON.parse(String(props.getProperty(stateKey) || '{}')) || {}; } catch (e) { state = {}; }

		const seenKeys = {};
		const alertRows = [];
		const locations = getLocationKeysCached();
		locations.forEach(loc => {
			const sheet = getAssetLocationSheet(loc);
			const lastRow = sheet.getLastRow();
			if (lastRow <= 1) return;

			const rows = sheet.getRange(2, 1, lastRow - 1, 16).getValues();
			for (let i = 0; i < rows.length; i++) {
				const r = rows[i];
				const status = String(r[6] || '').trim();
				if (status !== '在庫') continue;

				const ids = String(r[1] || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
				if (!ids.length) continue;
				const primaryId = String(ids[0] || '').trim();
				const threshold = Number(r[15]);
				if (!Number.isFinite(threshold) || threshold <= 0) continue;

				const qtyRaw = Number(r[13]);
				const qty = qtyRaw > 0 ? qtyRaw : ids.length;
				const locationName = String(r[12] || loc || '').trim();
				const key = [primaryId, locationName, String(r[2] || '').trim()].join('||');
				seenKeys[key] = true;

				if (qty > threshold) {
					if (Object.prototype.hasOwnProperty.call(state, key)) delete state[key];
					continue;
				}

				const signature = String(qty) + '|' + String(threshold);
				if (state[key] === signature) continue;

				state[key] = signature;
				alertRows.push({
					id: primaryId,
					name: String(r[2] || '').trim(),
					location: locationName,
					qty: qty,
					threshold: threshold,
					unit: String(r[10] || '件').trim() || '件',
					keeper: String(r[7] || '').trim()
				});
			}
		});

		Object.keys(state).forEach(k => {
			if (!seenKeys[k]) delete state[k];
		});
		props.setProperty(stateKey, JSON.stringify(state));

		if (!alertRows.length) return { success: true, alerted: 0 };

		const recipients = Array.from(new Set(
			directory.adminEmails.concat(
				alertRows
					.map(r => String(r.keeper || '').trim())
					.filter(Boolean)
					.map(name => directory.nameToEmail[name])
					.filter(Boolean)
			)
		));
		if (!recipients.length) return { success: true, alerted: 0, message: 'no_recipients' };

		const now = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy/MM/dd HH:mm:ss');
		const subject = '【低庫存警示】固定資產低於臨界值 ' + alertRows.length + ' 筆';
		const body = [
			'系統偵測到以下固定資產庫存低於臨界值：',
			'',
			alertRows.map((r, idx) => (idx + 1) + '. ' + r.name + ' (' + r.id + ')｜位置：' + r.location + '｜保管人：' + (r.keeper || '未設定') + '｜目前 ' + r.qty + r.unit + '｜臨界值 ' + r.threshold).join('\n'),
			'',
			'偵測時間：' + now
		].join('\n');

		const primaryTo = recipients[0];
		const bcc = recipients.slice(1).join(',');
		const options = {};
		if (bcc) options.bcc = bcc;
		GmailApp.sendEmail(primaryTo, subject, body, options);

		return { success: true, alerted: alertRows.length };
	} catch (e) {
		return { success: false, message: e.toString(), alerted: 0 };
	} finally {
		lock.releaseLock();
	}
}
