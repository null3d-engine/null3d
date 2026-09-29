import { describe, expect, it } from 'bun:test';
import { type CpuProfile, ownerOf, selfTimes, splitEntry } from './profile';

const ENGINE = '/packages/engine/src/';
const frame = (functionName: string, url = '') => ({ functionName, url });

/**
 * The render worker waits, then replays one frame: the replay's own code, a texture upload and a
 * draw call that the replay makes through one of its helpers, and a garbage collection inside it.
 */
const PROFILE: CpuProfile = {
	nodes: [
		{ id: 1, callFrame: frame('(root)'), children: [2, 3, 4] },
		{ id: 2, callFrame: frame('(program)') },
		{ id: 3, callFrame: frame('(idle)') },
		{ id: 4, callFrame: frame('drawFrame', `${ENGINE}render/scene-renderer.ts`), children: [5] },
		{ id: 5, callFrame: frame('replay', `${ENGINE}gpu/webgl2/backend.ts`), children: [6, 7, 8] },
		{ id: 6, callFrame: frame('texSubImage2D') },
		{ id: 7, callFrame: frame('prepareDraw', `${ENGINE}gpu/webgl2/backend.ts`), children: [9] },
		{ id: 8, callFrame: frame('(garbage collector)') },
		{ id: 9, callFrame: frame('drawElementsInstanced') },
	],
	startTime: 1000,
	endTime: 2000,
	// Samples at 1000, 1100, ... 1900; each one lasts 100 microseconds.
	samples: [3, 3, 3, 4, 5, 6, 6, 7, 9, 8],
	timeDeltas: [0, 100, 100, 100, 100, 100, 100, 100, 100, 100],
};

describe('selfTimes', () => {
	it('gives each sample the time until the next one, and the last one the time until the end', () => {
		const times = selfTimes({ ...PROFILE, endTime: 2050 });
		expect(times.get(3)).toBe(300);
		expect(times.get(6)).toBe(200);
		expect(times.get(8)).toBe(150);
	});
});

describe('ownerOf', () => {
	it("tells the engine's code, browser functions and the rest apart", () => {
		expect(ownerOf(frame('replay', `http://localhost:5173${ENGINE}gpu/x.ts`), ENGINE)).toBe(
			'engine',
		);
		expect(ownerOf(frame('bufferSubData'), ENGINE)).toBe('browser');
		expect(ownerOf(frame('(garbage collector)'), ENGINE)).toBe('other');
		expect(ownerOf(frame('(program)'), ENGINE)).toBe('other');
		expect(ownerOf(frame('tick', 'http://localhost:5173/bench/pages/x.ts'), ENGINE)).toBe('other');
	});
});

describe('splitEntry', () => {
	const isReplay = (f: { functionName: string; url: string }) =>
		f.functionName === 'replay' && f.url.includes('/gpu/');

	it("splits the time under the entry into the engine's code, browser calls and the rest", () => {
		const split = splitEntry(PROFILE, isReplay, ENGINE);
		expect(split.profileMs).toBe(1);
		expect(split.busyMs).toBe(0.7);
		expect(split.entryMs).toBe(0.6);
		expect(split.engineMs).toBe(0.2);
		expect(split.browserMs).toBe(0.3);
		expect(split.otherMs).toBe(0.1);
		expect(split.browserCalls).toEqual([
			{ name: 'texSubImage2D (built-in)', ms: 0.2 },
			{ name: 'drawElementsInstanced (built-in)', ms: 0.1 },
		]);
		expect(split.engineCalls).toEqual([
			{ name: 'replay webgl2/backend.ts', ms: 0.1 },
			{ name: 'prepareDraw webgl2/backend.ts', ms: 0.1 },
		]);
	});

	it('counts a call of the entry inside another one once', () => {
		const nested: CpuProfile = {
			nodes: [
				{ id: 1, callFrame: frame('replay', `${ENGINE}gpu/a.ts`), children: [2] },
				{ id: 2, callFrame: frame('replay', `${ENGINE}gpu/a.ts`), children: [3] },
				{ id: 3, callFrame: frame('drawArrays') },
			],
			startTime: 0,
			endTime: 300,
			samples: [1, 2, 3],
			timeDeltas: [0, 100, 100],
		};
		const split = splitEntry(nested, isReplay, ENGINE);
		expect([split.entryMs, split.engineMs, split.browserMs]).toEqual([0.3, 0.2, 0.1]);
	});

	it('finds nothing under an entry the profile never reached', () => {
		const split = splitEntry(PROFILE, (f) => f.functionName === 'absent', ENGINE);
		expect([split.entryMs, split.browserCalls.length]).toEqual([0, 0]);
	});
});
