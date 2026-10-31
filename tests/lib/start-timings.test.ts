import { describe, expect, it } from 'bun:test';
import {
	Counter,
	createMetricsBuffer,
	FrameRecorder,
	MetricsReader,
	Role,
} from '../../packages/engine/src/shared/metrics';
import { type Contention, calibrate, timingsLine } from '../pages/lib/start-timings';

/** A start whose figures none of its threads has written yet. */
function freshStart() {
	const buffer = createMetricsBuffer(false, 0);
	return {
		sketch: new FrameRecorder(buffer, Role.Sketch),
		render: new FrameRecorder(buffer, Role.Render),
		reader: new MetricsReader(buffer),
	};
}

/** A machine whose fixed arithmetic took `startMs` at the page's start and `worstMs` later. */
const machine = (startMs: number, worstMs: number | null = null): Contention => ({
	startMs,
	worstMs,
});

describe('the start timings line', () => {
	it('says that nothing has started before the first figure arrives', () => {
		const { reader } = freshStart();
		expect(timingsLine(reader, 1000, machine(0.5))).toBe(
			'grew nothing yet, built no pipelines yet, first frame not drawn, calibration 0.5 ms at the start, up to 1.0x slower later',
		);
	});

	it('follows a scene that is still growing, with the time so far', () => {
		const { sketch, reader } = freshStart();
		sketch.markSetupStart();
		// The writer stamps its start with the current time, so a reader a second later has 1000 ms.
		expect(timingsLine(reader, reader.setupStart + 1000, machine(0.5))).toBe(
			'growing for 1000 ms, built no pipelines yet, first frame not drawn, calibration 0.5 ms at the start, up to 1.0x slower later',
		);
	});

	it('follows the first frame’s pipeline build, with the time so far', () => {
		const { sketch, render, reader } = freshStart();
		sketch.markSetupDone(120);
		render.markWarmUp(true);
		expect(timingsLine(reader, reader.warmUpStart + 4300, machine(0.5))).toBe(
			'grew 120 ms, building pipelines for 4300 ms, first frame not drawn, calibration 0.5 ms at the start, up to 1.0x slower later',
		);
	});

	it('gives the three numbers once the first frame has drawn', () => {
		const { sketch, render, reader } = freshStart();
		sketch.markSetupDone(1200);
		render.markWarmUp(true);
		render.markWarmUp(false);
		render.begin(1);
		render.count(Counter.Pipelines, 9);
		render.markFirstFrame(2100);
		render.commit(2100);
		expect(timingsLine(reader, 0, machine(0.5))).toMatch(
			/^grew 1200 ms, built 9 pipelines in \d+ ms, first frame 2100 ms, calibration 0.5 ms at the start, up to 1.0x slower later$/,
		);
	});

	it('names the slowdown of a machine whose arithmetic became slower', () => {
		const { reader } = freshStart();
		expect(timingsLine(reader, 0, machine(0.5, 1.5))).toEndWith(
			'calibration 0.5 ms at the start, up to 3.0x slower later',
		);
	});

	it('reads the page’s own speed as a positive number', () => {
		const ms = calibrate();
		expect(Number.isFinite(ms)).toBe(true);
		expect(ms).toBeGreaterThanOrEqual(0);
	});
});
