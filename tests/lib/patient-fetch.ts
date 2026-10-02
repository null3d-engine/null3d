// Requests from the runner page to the dev server. Safari can lose a request that a page sends just
// as a frame it removed closes its connections: the request never reaches the server and never
// fails, so a page that awaits it waits forever. Here each attempt has a time limit, and a request
// that passes it goes out again. Only requests that the server can take twice use this, such as a
// page's result, which the server stores under the page's name. The runner page in the browser and
// the unit tests share it, so it uses no API of Node.

/** How long one attempt waits for the server's answer. */
export const ATTEMPT_MS = 20_000;
/** How many times a request goes out before it fails. */
export const ATTEMPTS = 3;

export interface PatientFetchOptions {
	attemptMs?: number;
	attempts?: number;
	/** The fetch to use, which a test can replace. */
	get?: (url: string, init: RequestInit) => Promise<Response>;
}

/**
 * Fetches `url`, and sends the request again when no answer comes within the time limit. A
 * request that fails for another reason fails at once, as fetch does. The time limit covers the
 * wait for the answer's headers and body, and the body comes back read as text.
 */
export async function patientFetch(
	url: string,
	init: RequestInit = {},
	{ attemptMs = ATTEMPT_MS, attempts = ATTEMPTS, get = fetch }: PatientFetchOptions = {},
): Promise<{ status: number; ok: boolean; text: string }> {
	for (let attempt = 1; ; attempt++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), attemptMs);
		try {
			const response = await get(url, { ...init, signal: controller.signal });
			return { status: response.status, ok: response.ok, text: await response.text() };
		} catch (e) {
			if (!controller.signal.aborted) throw e;
			if (attempt >= attempts)
				throw new Error(
					`no answer to ${url} within ${attemptMs / 1000} s, after ${attempts} attempts`,
				);
		} finally {
			clearTimeout(timer);
		}
	}
}
