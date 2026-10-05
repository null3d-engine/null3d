// The preset check on a fake thread that draws: frames come at 60 per second, and the page can be
// hidden for a while in the middle of a round, which the first frame after it carries as its
// interval.
import { expect, test } from 'bun:test';
import { createMetricsBuffer, FrameRecorder, Role } from '../shared/metrics';
import { type CheckHost, checkPreset } from './preset-check';

const FRAME_MS = 1000 / 60;

/** A host whose frames hold 60 per second, and whose page is hidden once for `hiddenMs`. */
function host(hiddenMs: number): CheckHost & { lowered: number } {
	const metrics = createMetricsBuffer(false, 0);
	const presented = new FrameRecorder(metrics, Role.Render);
	const completed = new FrameRecorder(metrics, Role.Completion);
	presented.setRefreshHz(60);
	let frame = 0;
	let resumes = 0;
	let hidden = hiddenMs > 0;
	let started = 0;
	const check: CheckHost & { lowered: number } = {
		metrics,
		preset: 'high',
		lowered: 0,
		lower: async () => {
			check.lowered++;
		},
		async drawFrame() {
			await new Promise((resolve) => setTimeout(resolve, 4));
			started ||= performance.now();
			// Hidden once, part way into the first round's measured window.
			const interval = hidden && performance.now() - started > 400 ? hiddenMs : FRAME_MS;
			if (interval !== FRAME_MS) {
				hidden = false;
				resumes++;
			}
			frame++;
			for (const recorder of [presented, completed]) {
				recorder.begin(frame);
				recorder.interval(interval);
				recorder.commit(1);
			}
			return true;
		},
		uploading: () => false,
		maxFps: undefined,
		resumes: () => resumes,
	};
	return check;
}

test('a page that holds its frame rate keeps its preset', async () => {
	const check = host(0);
	const result = await checkPreset(check, performance.now());
	expect(result?.rounds).toHaveLength(1);
	expect(check.lowered).toBe(0);
});

test('a round during which the page was hidden measures again, and keeps the preset', async () => {
	const check = host(10_000);
	const result = await checkPreset(check, performance.now());
	expect(check.lowered).toBe(0);
	expect(result?.rounds).toHaveLength(1);
	expect(result?.rounds[0]?.presentedFps).toBeGreaterThan(50);
});
