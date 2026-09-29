import { describe, expect, it } from 'bun:test';
import { judgeSoak, type SoakSample, soakTable } from './soak';

const MB = 1024 * 1024;
const rules = { warmupSeconds: 60, heapAllowanceBytes: 256 * 1024, judged: ['render worker'] };
/** A heap or a memory that stays at one size for the whole run. */
const flat = (bytes: number) => () => bytes;

/** Samples every 30 seconds from 0 to 300: the render worker's heap and the memory at each time. */
function run(
	renderHeap: (atSeconds: number) => number | null,
	wasmBytes: (atSeconds: number) => number = flat(64 * MB),
): SoakSample[] {
	const samples: SoakSample[] = [];
	for (let at = 0; at <= 300; at += 30)
		samples.push({
			atSeconds: at,
			heaps: { 'render worker': renderHeap(at), page: 3 * MB },
			wasmBytes: wasmBytes(at),
		});
	return samples;
}

const judge = (samples: SoakSample[], framesAtEnd = 300, pageErrors: string[] = []) =>
	judgeSoak({ samples, framesAtEnd, pageErrors }, rules);

describe('judgeSoak', () => {
	it('passes a flat run, and ignores growth during the warm-up', () => {
		const verdict = judge(run((at) => (at < 60 ? at * 0.1 * MB : 4 * MB)));
		expect(verdict.problems).toEqual([]);
		expect(verdict.heapGrowth).toEqual({ 'render worker': 0 });
		expect(verdict.wasmGrowth).toBe(0);
	});

	it('fails a heap that keeps growing after the warm-up', () => {
		const verdict = judge(run((at) => 4 * MB + at * 4096));
		// The medians of the samples at 60 to 120 s and at 240 to 300 s are 180 s apart.
		expect(verdict.heapGrowth['render worker']).toBe(180 * 4096);
		expect(verdict.problems).toEqual([
			"the render worker's heap grew 720 KB after the warm-up, more than its allowance of 256 KB",
		]);
	});

	it('lets one high sample at either end pass, as the medians leave it out', () => {
		const verdict = judge(run((at) => (at === 60 || at === 300 ? 6 * MB : 4 * MB)));
		expect(verdict.problems).toEqual([]);
	});

	it('fails a WebAssembly memory that grows after the warm-up, but not during it', () => {
		const settling = (at: number) => (at < 60 ? 32 * MB : 64 * MB);
		expect(judge(run(flat(4 * MB), settling)).problems).toEqual([]);
		const verdict = judge(run(flat(4 * MB), (at) => (at < 200 ? 64 * MB : 65 * MB)));
		expect(verdict.wasmGrowth).toBe(MB);
		expect(verdict.problems).toEqual(['the WebAssembly memory grew 1.00 MB after the warm-up']);
	});

	it('fails a run whose engine stopped drawing, or whose page reported an error', () => {
		const samples = run(flat(4 * MB));
		expect(judge(samples, 0).problems).toEqual(['the engine drew no frames at the end of the run']);
		expect(judge(samples, 300, ['E1404: the render worker failed']).problems).toEqual([
			'the page reported an error: E1404: the render worker failed',
		]);
	});

	it('fails a judged thread that missed a sample it compares, and a run too short to judge', () => {
		expect(judge(run((at) => (at === 270 ? null : 4 * MB))).problems).toEqual([
			'the render worker did not report its heap in every sample',
		]);
		const short = run(flat(4 * MB)).filter((s) => s.atSeconds <= 180);
		expect(judge(short).problems).toEqual([
			'the run is too short to judge: it needs 6 samples after the 60-second warm-up, and it has 5',
		]);
	});
});

describe('soakTable', () => {
	it('prints a row per sample, marks the warm-up and shows a missing sample as a dash', () => {
		const samples = run((at) => (at === 30 ? null : 4 * MB)).slice(0, 3);
		expect(soakTable(samples, ['page', 'render worker'], 60)).toEqual([
			'| Time, s | Page heap, MB | Render worker heap, MB | WebAssembly memory, MB |',
			'| --- | --- | --- | --- |',
			'| 0, warm-up | 3.00 | 4.00 | 64.00 |',
			'| 30, warm-up | 3.00 | - | 64.00 |',
			'| 60 | 3.00 | 4.00 | 64.00 |',
		]);
	});
});
