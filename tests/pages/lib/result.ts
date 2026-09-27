// Publishes a test page's result twice: on window, where Playwright reads it, and to the dev
// server's report collector, for browsers that Playwright cannot drive.

declare global {
	interface Window {
		__sokko3dResult?: unknown;
	}
}

/** Encodes bytes as base64 in chunks, so large pixel buffers do not overflow the call stack. */
export function toBase64(bytes: Uint8Array): string {
	let binary = '';
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk)
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	return btoa(binary);
}

export async function publish(name: string, result: Record<string, unknown>): Promise<void> {
	const report = { page: name, userAgent: navigator.userAgent, url: location.href, ...result };
	window.__sokko3dResult = report;
	const status = document.getElementById('status');
	if (status) status.textContent = JSON.stringify({ ...report, pixels: undefined }, null, 2);
	try {
		await fetch(`/__sokko3d/report?name=${name}`, { method: 'POST', body: JSON.stringify(report) });
	} catch {
		// The collector is optional; Playwright reads the result from window.
	}
}

export async function run(
	name: string,
	body: () => Promise<Record<string, unknown>>,
): Promise<void> {
	try {
		await publish(name, { ok: true, ...(await body()) });
	} catch (e) {
		await publish(name, { ok: false, error: (e as Error).message });
	}
}
