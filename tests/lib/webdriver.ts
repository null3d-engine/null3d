// A small client for the W3C WebDriver protocol over HTTP: the few commands that the device cloud
// driver needs to open a browser on a remote device, point it at a page, read the page, and end the
// session. Each request carries the headers it is given, such as a cloud's Basic authorization, and
// an error never quotes a request, so secrets in headers or capabilities stay out of logs.

/** An error that a WebDriver server answered with, such as `invalid session id`. */
export class WebDriverError extends Error {
	constructor(
		/** The protocol's error code, or `http <status>` when the answer named none. */
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}

/** The commands of a WebDriver session that the driver uses. */
export interface WebDriver {
	/** Starts a session with these W3C capabilities, and returns its ID. */
	newSession(capabilities: Record<string, unknown>): Promise<string>;
	/** Loads a page in the session's browser. */
	navigate(session: string, url: string): Promise<void>;
	/** Runs a script in the page, and returns what it returned. */
	execute(session: string, script: string, args?: readonly unknown[]): Promise<unknown>;
	/** The handle of the session's current window or tab. */
	windowHandle(session: string): Promise<string>;
	/** Switches to a window or tab, which a browser also brings to the front. */
	switchToWindow(session: string, handle: string): Promise<void>;
	/** Ends the session. */
	deleteSession(session: string): Promise<void>;
}

/** How long a command may take, apart from a new session, which waits for a device. */
const COMMAND_TIMEOUT_MS = 120_000;
/** How long a new session may wait for a device, as a cloud queues sessions over its limit. */
export const NEW_SESSION_TIMEOUT_MS = 600_000;

/**
 * A WebDriver client for the server at `hub`, such as `https://hub.example.com/wd/hub`, that sends
 * `headers` with each request. `redact` cleans each error's text before it leaves the client.
 */
export function webDriver(
	hub: string,
	headers: Readonly<Record<string, string>>,
	redact: (text: string) => string = (text) => text,
	fetchFn: typeof fetch = fetch,
): WebDriver {
	const call = async (
		method: 'GET' | 'POST' | 'DELETE',
		path: string,
		body?: unknown,
		timeoutMs = COMMAND_TIMEOUT_MS,
	): Promise<unknown> => {
		let response: Response;
		let text: string;
		// The time limit covers the whole answer, so reading its body can time out as well.
		try {
			response = await fetchFn(`${hub}${path}`, {
				method,
				headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
				...(body !== undefined && { body: JSON.stringify(body) }),
				signal: AbortSignal.timeout(timeoutMs),
			});
			text = await response.text();
		} catch (e) {
			throw new WebDriverError('no answer', redact(`${method} ${path}: ${(e as Error).message}`));
		}
		let value: unknown;
		try {
			value = (JSON.parse(text) as { value?: unknown }).value;
		} catch {
			value = undefined;
		}
		const failure = value as { error?: unknown; message?: unknown } | undefined;
		if (!response.ok || typeof failure?.error === 'string') {
			const code = typeof failure?.error === 'string' ? failure.error : `http ${response.status}`;
			const message = typeof failure?.message === 'string' ? failure.message : text.slice(0, 300);
			throw new WebDriverError(code, redact(`${method} ${path}: ${code}: ${message}`));
		}
		return value;
	};
	const sessionPath = (session: string) => `/session/${encodeURIComponent(session)}`;
	return {
		async newSession(capabilities) {
			const value = (await call(
				'POST',
				'/session',
				{ capabilities: { alwaysMatch: capabilities } },
				NEW_SESSION_TIMEOUT_MS,
			)) as { sessionId?: unknown } | undefined;
			if (typeof value?.sessionId !== 'string')
				throw new WebDriverError('no session', 'the new session answer named no session ID');
			return value.sessionId;
		},
		async navigate(session, url) {
			await call('POST', `${sessionPath(session)}/url`, { url });
		},
		execute(session, script, args = []) {
			return call('POST', `${sessionPath(session)}/execute/sync`, { script, args });
		},
		async windowHandle(session) {
			return String(await call('GET', `${sessionPath(session)}/window`));
		},
		async switchToWindow(session, handle) {
			await call('POST', `${sessionPath(session)}/window`, { handle });
		},
		async deleteSession(session) {
			await call('DELETE', sessionPath(session));
		},
	};
}
