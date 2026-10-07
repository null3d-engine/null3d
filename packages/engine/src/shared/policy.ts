// The Content-Security-Policy violations that this thread sees, so a failed download or worker can
// name the directive that blocked it. A browser reports a blocked request only through an event,
// never through the failure itself, and it may send the event a moment after the failure.

/** A request that the page's policy blocked. */
export interface Violation {
	/** The directive that blocked it, such as `worker-src` or `connect-src`. */
	directive: string;
	/** What it blocked: an address, its origin, or a scheme such as `blob`. */
	blocked: string;
}

/** The most violations that the thread keeps, newest last. */
const KEPT = 16;
/** How long a failure waits for the browser's report of a violation, in ms. */
const REPORT_WAIT_MS = 100;

const seen: Violation[] = [];
let watching = false;

/**
 * Starts recording the policy violations of this thread, once. Call it before a request whose
 * failure may need its violation.
 */
export function watchPolicy(): void {
	if (watching || typeof addEventListener !== 'function') return;
	watching = true;
	addEventListener('securitypolicyviolation', (event) => {
		const { effectiveDirective: directive, blockedURI: blocked } =
			event as SecurityPolicyViolationEvent;
		seen.push({ directive, blocked });
		if (seen.length > KEPT) seen.shift();
	});
}

/**
 * The violation that blocked a request to `target`: an address, whose origin the report may give
 * alone, or a scheme such as `blob`. It waits a moment for a report that the browser sends after
 * the failure. Undefined when no report came.
 */
export async function violationFor(target: URL | 'blob'): Promise<Violation | undefined> {
	const matches = ({ blocked }: Violation) =>
		target === 'blob'
			? blocked === 'blob' || blocked.startsWith('blob:')
			: blocked === target.origin || blocked.startsWith(`${target.origin}/`);
	const deadline = performance.now() + REPORT_WAIT_MS;
	for (;;) {
		const found = seen.findLast(matches);
		if (found || performance.now() >= deadline) return found;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

/** True when `url` has another origin than this thread's. A blob: address has its maker's origin. */
export function isCrossOrigin(url: URL): boolean {
	const own = globalThis.origin;
	return typeof own === 'string' && own !== 'null' && url.origin !== own;
}
