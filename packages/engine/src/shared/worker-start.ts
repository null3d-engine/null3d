// Starts the engine's workers, from the page's origin or from another one, such as a CDN.
//
// A browser starts a dedicated worker only from a script of the page's own origin. When the
// engine's files come from another origin, each worker starts from a small module that the
// thread makes as a blob: address, which has the page's origin. That module imports the worker's
// real script from the other origin, holds the messages that arrive meanwhile, and hands them on
// once the script has run. When the import fails, it finds out why and reports it, so the engine
// can name the policy item or header that is missing (E1422, E1423).
//
// Bundlers find a worker's script only in the form `new Worker(new URL('<file>',
// import.meta.url), options)`, which every modern bundler reads. So the engine keeps that form, and
// `spawnWorker` runs it while the thread's `Worker` is a stand-in that adds the bootstrap where the
// script's origin needs it.

import type { EngineError } from '../errors/engine-error';
import { isCrossOrigin, type Violation, violationFor, watchPolicy } from './policy';
import type { WasmError } from './wasm';

/** What the bootstrap module reports to the thread that started it. */
interface BootstrapReport {
	started?: true;
	/** Why the import of the worker's script failed. */
	error?: string;
	/** The HTTP status of a second download of the script, or 0 when that download failed too. */
	status?: number;
	violation?: Violation;
}

/** The key of the bootstrap module's reports among a worker's messages. */
const REPORT = 'null3dBootstrap';

/**
 * The bootstrap module's source for the worker script at `script`. It keeps the messages that
 * arrive before the script has run, since the script sets its handler only when it runs.
 */
export function bootstrapSource(script: string): string {
	return `const s=${JSON.stringify(script)},h=[],k=e=>{e.stopImmediatePropagation();h.push(e)};let v;
addEventListener('message',k);
addEventListener('securitypolicyviolation',e=>{v??={directive:e.effectiveDirective,blocked:e.blockedURI}});
import(s).then(()=>{removeEventListener('message',k);postMessage({${REPORT}:{started:true}});for(const e of h)dispatchEvent(new MessageEvent('message',{data:e.data,ports:e.ports}))},async e=>{let t=0;try{t=(await fetch(s)).status}catch{}await new Promise(r=>setTimeout(r,100));postMessage({${REPORT}:{error:String(e?.message??e),status:t,violation:v}})})`;
}

/** The engine error for a worker whose script did not run, from its bootstrap's report. */
export function bootstrapError(
	what: string,
	script: URL,
	report: BootstrapReport,
	error: WasmError,
): EngineError {
	const { violation, status = 0 } = report;
	if (violation)
		return error(
			'E1422',
			`the page's Content-Security-Policy blocks ${what}: its ${violation.directive} does not allow ${violation.blocked}.`,
		);
	if (status === 0)
		return error(
			'E1423',
			`${what}'s script from ${script.origin} came without a CORS header, or did not download.`,
		);
	if (status >= 400)
		return error('E1406', `${what}'s script did not download from ${script.href}: HTTP ${status}.`);
	return error('E1405', `${what} did not start: ${report.error ?? 'its script failed'}.`);
}

/** The error of a worker that the browser refused to start from its bootstrap. */
async function refusedBootstrap(what: string, error: WasmError): Promise<EngineError> {
	const violation = await violationFor('blob');
	return violation
		? error(
				'E1422',
				`the page's Content-Security-Policy blocks ${what}: its ${violation.directive} does not allow blob:, which the engine starts its workers from when its files come from another origin.`,
			)
		: error('E1405', `${what} did not start from its blob: bootstrap.`);
}

/**
 * The engine error that a worker's error message holds when its bootstrap did not start it, made
 * again by `error` in the calling module's own copy of the error class. Undefined for any other
 * message.
 */
export function bootstrapFailure(message: string, error: WasmError): EngineError | undefined {
	const code = /^(E1405|E1406|E1422|E1423): /.exec(message)?.[1] as
		| Parameters<WasmError>[0]
		| undefined;
	if (!code) return undefined;
	const coded = error(code, '');
	coded.message = message;
	return coded;
}

/** What stands in for the thread's `Worker` while `spawnWorker` runs, once made. */
let bootstrapping: typeof Worker | undefined;
/** The error maker of the `spawnWorker` call that runs. */
let errorOfCall: WasmError | undefined;

/**
 * A stand-in for `Worker` that starts a script of another origin through the bootstrap module. It
 * is a plain constructor that returns the thread's own workers, not a subclass: a subclass's
 * prototype would stay for the page's life and count as a live worker wherever a page counts the
 * objects whose prototype is the worker's.
 */
function bootstrappingWorker(Native: typeof Worker): typeof Worker {
	// An arrow function cannot stand in for a class: `new` refuses it.
	function BootstrappedWorker(script: string | URL, options: WorkerOptions = {}): Worker {
		const url = new URL(String(script), globalThis.location?.href);
		if (!isCrossOrigin(url)) return new Native(script, options);
		watchPolicy();
		const address = URL.createObjectURL(
			new Blob([bootstrapSource(url.href)], { type: 'text/javascript' }),
		);
		const worker = new Native(address, { ...options, type: 'module' });
		// The constructor has read the address, so the worker no longer needs it.
		URL.revokeObjectURL(address);
		const error = errorOfCall as WasmError;
		const what = `the ${(options.name ?? 'engine').replace(/^null3d-/, '')} worker`;
		let started = false;
		const made = new WeakSet<Event>();
		const fail = (failure: EngineError) => {
			const event = new ErrorEvent('error', { message: failure.message, error: failure });
			made.add(event);
			worker.dispatchEvent(event);
		};
		worker.addEventListener('message', (event) => {
			const data = event.data as { [REPORT]?: BootstrapReport } | null;
			const report = typeof data === 'object' && data !== null ? data[REPORT] : undefined;
			if (!report) return;
			event.stopImmediatePropagation();
			if (report.started) started = true;
			else fail(bootstrapError(what, url, report, error));
		});
		worker.addEventListener('error', (event) => {
			if (started || made.has(event)) return;
			// The browser gives no reason for a refused bootstrap; the policy's report does.
			event.stopImmediatePropagation();
			event.preventDefault();
			void refusedBootstrap(what, error).then(fail);
		});
		return worker;
	}
	return BootstrappedWorker as unknown as typeof Worker;
}

/**
 * Starts an engine worker. `start` constructs it in the form that bundlers read, `new Worker(new
 * URL('<file>', import.meta.url), options)`, and runs while the thread's `Worker` starts a script
 * of another origin through the bootstrap module. A worker that the bootstrap cannot start gets an
 * error event whose message is the engine error that `error` makes, with its code. The caller hands
 * over its error maker, so this module imports no engine module that a start file would share.
 */
export function spawnWorker(start: () => Worker, error: WasmError): Worker {
	const Native = globalThis.Worker;
	bootstrapping ??= bootstrappingWorker(Native);
	globalThis.Worker = bootstrapping;
	errorOfCall = error;
	try {
		return start();
	} finally {
		globalThis.Worker = Native;
		errorOfCall = undefined;
	}
}
