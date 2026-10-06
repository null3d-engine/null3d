import { describe, expect, it } from 'bun:test';
import { canvasHold, endParkedWorkers, Holder, parkWorker, takeParkedWorker } from './ownership';

/** A drawing worker that a stopped engine left, with that engine's handlers still set. */
function stoppedEngineWorker() {
	const worker = {
		terminated: false,
		onmessage: (() => {}) as unknown,
		onerror: (() => {}) as unknown,
		terminate() {
			this.terminated = true;
		},
	};
	return worker;
}

/** A canvas in the document, as far as the parked worker's checks read it. */
const canvasInPage = () => ({ isConnected: true }) as HTMLCanvasElement;

describe('a parked drawing worker', () => {
	it("drops the stopped engine's handlers, which reach that engine's memory", () => {
		const canvas = canvasInPage();
		const worker = stoppedEngineWorker();
		parkWorker(canvas, canvasHold(canvas), worker as unknown as Worker, 'render');
		expect(worker.onmessage).toBeNull();
		expect(worker.onerror).toBeNull();
		expect(takeParkedWorker(canvas, canvasHold(canvas))).toBe(worker as unknown as Worker);
		expect(worker.terminated).toBe(false);
	});

	it('ends when the browser refuses memory, unless an engine is starting on its canvas', () => {
		const idle = canvasInPage();
		const starting = canvasInPage();
		const idleWorker = stoppedEngineWorker();
		const startingWorker = stoppedEngineWorker();
		parkWorker(idle, canvasHold(idle), idleWorker as unknown as Worker, 'render');
		parkWorker(starting, canvasHold(starting), startingWorker as unknown as Worker, 'sketch');
		canvasHold(starting).holder = new Holder();
		endParkedWorkers('when the browser refused memory');
		expect(idleWorker.terminated).toBe(true);
		expect(canvasHold(idle).dead).toBe('its render worker stopped when the browser refused memory');
		expect(takeParkedWorker(idle, canvasHold(idle))).toBeUndefined();
		expect(startingWorker.terminated).toBe(false);
		expect(takeParkedWorker(starting, canvasHold(starting))).toBe(
			startingWorker as unknown as Worker,
		);
	});

	it('ends when the page goes away', () => {
		const canvas = canvasInPage();
		const worker = stoppedEngineWorker();
		parkWorker(canvas, canvasHold(canvas), worker as unknown as Worker, 'render');
		globalThis.dispatchEvent(new Event('pagehide'));
		expect(worker.terminated).toBe(true);
		expect(canvasHold(canvas).dead).toBe('its render worker stopped when the page went away');
	});
});
