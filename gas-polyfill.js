/**
 * Drop-in replacement for google.script.run when the frontend is hosted
 * outside Apps Script (e.g. on Vercel). Keeps the existing chained syntax
 * (.withSuccessHandler().withFailureHandler().someFunction(args)) working
 * unchanged; calls are routed through the same-origin /api/gas proxy.
 * See MIGRATION.md.
 */
(function () {
	const API_ENDPOINT = '/api/gas';

	function callApi(fn, args, onSuccess, onFailure) {
		fetch(API_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ fn: fn, args: args })
		})
			.then(function (res) { return res.json(); })
			.then(function (data) {
				if (data && data.error) {
					if (onFailure) onFailure(new Error(data.error));
					else console.error('[gas-polyfill] ' + fn + ' 失敗：', data.error);
					return;
				}
				if (onSuccess) onSuccess(data ? data.result : undefined);
			})
			.catch(function (err) {
				if (onFailure) onFailure(err);
				else console.error('[gas-polyfill] ' + fn + ' 呼叫失敗：', err);
			});
	}

	function buildRunner(state) {
		return new Proxy(function () {}, {
			get: function (target, prop) {
				if (prop === 'withSuccessHandler') {
					return function (cb) {
						return buildRunner(Object.assign({}, state, { onSuccess: cb }));
					};
				}
				if (prop === 'withFailureHandler') {
					return function (cb) {
						return buildRunner(Object.assign({}, state, { onFailure: cb }));
					};
				}
				if (prop === 'withUserObject') {
					return function () { return buildRunner(state); };
				}
				return function () {
					callApi(prop, Array.prototype.slice.call(arguments), state.onSuccess, state.onFailure);
				};
			}
		});
	}

	window.google = window.google || {};
	window.google.script = window.google.script || {};
	window.google.script.run = buildRunner({});
})();
