import { afterEach, describe, expect, it } from 'bun:test';

/**
 * Safari runs a module worker's entry file again when another file imports it (WebKit bug 324459).
 * In a production build, the renderer's file that the sketch worker loads in low-latency mode
 * imports the sketch worker's entry file. Bun loads a path with a query as another module, which
 * runs the entry file a second time in this thread, as Safari does.
 */
const ENTRIES = ['sketch-worker', 'render-worker', 'job-worker'] as const;

/** The messages a worker's entry file posts to the page while it runs. */
let posted: { type?: string; step?: string }[] = [];
const scope = globalThis as unknown as {
	postMessage: (message: unknown) => void;
	onmessage: unknown;
};
const original = { postMessage: scope.postMessage, onmessage: scope.onmessage };

afterEach(() => {
	scope.postMessage = original.postMessage;
	scope.onmessage = original.onmessage;
	posted = [];
});

describe('a worker entry file that runs twice in its thread', () => {
	for (const entry of ENTRIES)
		it(`starts the ${entry} once, and a second run keeps its message handler`, async () => {
			scope.postMessage = (message) => posted.push(message as { type?: string; step?: string });
			await import(`${import.meta.dirname}/${entry}.ts?first-run`);
			const handler = scope.onmessage;
			expect(typeof handler).toBe('function');
			await import(`${import.meta.dirname}/${entry}.ts?second-run`);
			expect(scope.onmessage).toBe(handler);
			const loaded = posted.filter(({ type, step }) => type === 'progress' && step === 'loaded');
			expect(loaded).toHaveLength(1);
		});
});
