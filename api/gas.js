/**
 * Vercel serverless proxy in front of the Apps Script JSON API.
 * Keeps GAS_EXEC_URL and API_SECRET server-side only, and turns the
 * browser -> backend call into a same-origin request so there is no
 * CORS handling to reason about. See MIGRATION.md.
 * Requires Node 18+ (global fetch) — Vercel's default runtime already is.
 */
module.exports = async function handler(req, res) {
	if (req.method !== 'POST') {
		res.status(405).json({ error: 'Method not allowed' });
		return;
	}

	const gasExecUrl = process.env.GAS_EXEC_URL;
	const apiSecret = process.env.API_SECRET;
	if (!gasExecUrl || !apiSecret) {
		res.status(500).json({ error: '伺服器未設定 GAS_EXEC_URL 或 API_SECRET 環境變數' });
		return;
	}

	let body = req.body;
	if (typeof body === 'string') {
		try {
			body = JSON.parse(body);
		} catch (err) {
			res.status(400).json({ error: '無效的請求內容' });
			return;
		}
	}
	if (!body || typeof body !== 'object' || typeof body.fn !== 'string') {
		res.status(400).json({ error: '缺少 fn 參數' });
		return;
	}

	try {
		const gasResponse = await fetch(gasExecUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			redirect: 'follow',
			body: JSON.stringify({ secret: apiSecret, fn: body.fn, args: body.args || [] })
		});

		const text = await gasResponse.text();
		let data;
		try {
			data = JSON.parse(text);
		} catch (err) {
			res.status(502).json({ error: 'Apps Script 回傳非 JSON 內容', raw: text.slice(0, 500) });
			return;
		}

		res.status(200).json(data);
	} catch (err) {
		res.status(502).json({ error: '轉發到 Apps Script 失敗：' + err.message });
	}
};
