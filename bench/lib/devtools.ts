// A minimal client for Chrome's debugging protocol, for the tools that sample the engine's workers:
// it connects to a browser, attaches to a page and to its workers, and evaluates expressions in the
// page. The browser is a Chrome that Playwright started on this computer, or Chrome on a phone whose
// debugging socket adb forwards to a local port.

export interface TargetInfo {
	targetId: string;
	type: string;
	url: string;
}

/** A function in a profile: its name, and the script it comes from, empty for a built-in one. */
export interface CallFrame {
	functionName: string;
	url: string;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long a browser that is starting may take to open its debugging port. */
const CONNECT_TIMEOUT_MS = 20_000;

export class DevTools {
	private next = 1;
	private readonly pending = new Map<
		number,
		{ method: string; resolve: (result: unknown) => void; reject: (error: Error) => void }
	>();
	private readonly listeners = new Map<string, ((params: unknown, sessionId?: string) => void)[]>();

	private constructor(private readonly socket: WebSocket) {
		socket.onmessage = (event) => {
			const message = JSON.parse(String(event.data)) as {
				id?: number;
				method?: string;
				params?: unknown;
				sessionId?: string;
				result?: unknown;
				error?: { message: string };
			};
			if (message.id === undefined) {
				for (const listener of this.listeners.get(message.method ?? '') ?? [])
					listener(message.params, message.sessionId);
				return;
			}
			const call = this.pending.get(message.id);
			this.pending.delete(message.id);
			if (message.error) call?.reject(new Error(`${call?.method}: ${message.error.message}`));
			else call?.resolve(message.result);
		};
	}

	/**
	 * Connects to the browser that listens on a local debugging port, waiting while a browser that
	 * is still starting opens it. A phone's Chrome reports an address without the forwarded port, so
	 * only the path of the address it reports is used.
	 */
	static async connect(port: number, timeoutMs = CONNECT_TIMEOUT_MS): Promise<DevTools> {
		const deadline = Date.now() + timeoutMs;
		let version: { webSocketDebuggerUrl: string } | undefined;
		while (!version) {
			try {
				version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as {
					webSocketDebuggerUrl: string;
				};
			} catch (e) {
				if (Date.now() > deadline)
					throw new Error(`no browser answered on debugging port ${port}: ${(e as Error).message}`);
				await sleep(250);
			}
		}
		const path = new URL(version.webSocketDebuggerUrl).pathname;
		const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
		await new Promise((resolve, reject) => {
			socket.onopen = resolve;
			socket.onerror = reject;
		});
		return new DevTools(socket);
	}

	send<T>(method: string, params: object = {}, sessionId?: string): Promise<T> {
		const id = this.next++;
		this.socket.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
		return new Promise((resolve, reject) =>
			this.pending.set(id, { method, resolve: resolve as (result: unknown) => void, reject }),
		);
	}

	on(method: string, listener: (params: unknown, sessionId?: string) => void): void {
		this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]);
	}

	close(): void {
		this.socket.close();
	}
}

/**
 * A place in the code, by function and file. A named function with no file is one of the browser's
 * built-in functions, such as a promise's then or a WebGL call.
 */
export function placeName({ functionName, url }: CallFrame): string {
	const name = functionName || '(anonymous)';
	if (!url) return name.startsWith('(') ? name : `${name} (built-in)`;
	return `${name} ${url.split('/').slice(-2).join('/').replace(/\?.*$/, '')}`;
}

/** The debugging sessions of a page and of its named workers. */
export interface Attached {
	/** The debugging session of the page. */
	page: string;
	/** The debugging session of each named worker. */
	workers: Map<string, string>;
}

/** The pages whose address holds the path of `url`. */
export async function pagesAt(devtools: DevTools, url: string): Promise<TargetInfo[]> {
	const path = new URL(url).pathname;
	const { targetInfos } = await devtools.send<{ targetInfos: TargetInfo[] }>('Target.getTargets');
	return targetInfos.filter((t) => t.type === 'page' && t.url.includes(path));
}

/**
 * Attaches to a page and then to its workers, which Chrome reports only to a session that asks to
 * attach to a page's related targets. A worker is named by a part of its script's address.
 */
export async function attachWorkers(
	devtools: DevTools,
	targetId: string,
	names: readonly string[],
): Promise<Attached> {
	const { sessionId } = await devtools.send<{ sessionId: string }>('Target.attachToTarget', {
		targetId,
		flatten: true,
	});
	const workers = new Map<string, string>();
	devtools.on('Target.attachedToTarget', (params, parent) => {
		const { sessionId: worker, targetInfo } = params as {
			sessionId: string;
			targetInfo: TargetInfo;
		};
		const name = names.find((w) => targetInfo.type === 'worker' && targetInfo.url.includes(w));
		if (parent === sessionId && name) workers.set(name, worker);
	});
	await devtools.send(
		'Target.setAutoAttach',
		{ autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
		sessionId,
	);
	for (let tries = 0; tries < 300 && workers.size < names.length; tries++) await sleep(100);
	const missing = names.filter((w) => !workers.has(w));
	if (missing.length > 0) throw new Error(`no worker target appeared for ${missing.join(', ')}`);
	return { page: sessionId, workers };
}

/** Evaluates an expression in a page or worker and returns its value, copied out as JSON. */
export async function evaluate<T>(
	devtools: DevTools,
	sessionId: string,
	expression: string,
): Promise<T> {
	const { result, exceptionDetails } = await devtools.send<{
		result: { value?: T };
		exceptionDetails?: { text: string };
	}>('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
	if (exceptionDetails) throw new Error(`${expression}: ${exceptionDetails.text}`);
	return result.value as T;
}
