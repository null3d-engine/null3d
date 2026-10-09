import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';
import { BUDGETS, SKY_ENVIRONMENT_BUDGETS, STATS_BUDGETS } from '../allocation.ts';
import {
	burstBytes,
	byPlace,
	type ProfileNode,
	type ProfileSample,
	profilePlaces,
	type Sample,
	steadyPlaces,
	totalSize,
} from './allocation';

let nextId = 1;
function node(functionName: string, url: string, selfSize: number, children: ProfileNode[] = []) {
	return { callFrame: { functionName, url }, id: nextId++, selfSize, children };
}

const ROOT = '(root)';
const LOOP = 'http://localhost/packages/engine/src/render/loop.ts';

/** Samples in sampling order, each at a node with a size. */
function samplesOf(entries: [ProfileNode, number][]): ProfileSample[] {
	return entries.map(([at, size], k) => ({ nodeId: at.id, size, ordinal: k + 1 }));
}

describe('allocation places', () => {
	test('sum each place across its call paths, and keep the callers of its largest path', () => {
		const head = node(ROOT, '', 0, [
			node('frame', LOOP, 0, [node('draw', LOOP, 300)]),
			node('onDone', LOOP, 0, [node('draw', LOOP, 100)]),
		]);
		const places = byPlace(head);
		expect(places.get('draw render/loop.ts')).toEqual({
			bytes: 400,
			burst: 0,
			callers: 'frame render/loop.ts < (root)',
			largest: 300,
		});
		expect(totalSize(head)).toBe(400);
	});

	test('judge each place by the sample where it allocated least', () => {
		const sample = (entries: [string, number][], frames: number): Sample => ({
			frames,
			places: new Map(
				entries.map(([name, bytes]) => [name, { bytes, burst: 0, callers: '', largest: bytes }]),
			),
		});
		const steady = steadyPlaces([
			sample(
				[
					['draw render/loop.ts', 3600],
					['frame render/loop.ts', 12_000],
				],
				100,
			),
			sample([['draw render/loop.ts', 4000]], 100),
		]);
		// Allocation in every frame shows in both samples; an event of one sample counts as none.
		expect(steady).toEqual([
			['draw render/loop.ts', { perFrame: 36, most: 40, callers: '' }],
			['frame render/loop.ts', { perFrame: 0, most: 120, callers: '' }],
		]);
	});
});

describe('bursts of installed code', () => {
	// A frame callback that allocates in every frame, and an empty timer callback that the browser
	// charges for the code it installs.
	const draw = node('draw', LOOP, 0);
	const wakeUp = node('wakeUp', LOOP, 0);
	const head = node(ROOT, '', 0, [draw, wakeUp]);

	test('set aside a short run that holds a large share of its place, and count long runs', () => {
		const frames: [ProfileNode, number][] = Array.from({ length: 40 }, () => [draw, 128]);
		const samples = samplesOf([
			...frames.slice(0, 20),
			[wakeUp, 1724],
			[wakeUp, 3744],
			[wakeUp, 7328],
			...frames.slice(20),
		]);
		draw.selfSize = 40 * 128;
		wakeUp.selfSize = 1724 + 3744 + 7328;
		const bursts = burstBytes({ head, samples });
		expect(bursts.get('wakeUp render/loop.ts')).toBe(1724 + 3744 + 7328);
		// Each half of the frame callback's objects is one run, too long to be a burst.
		expect(bursts.has('draw render/loop.ts')).toBe(false);
	});

	test('a place that allocates between other places has no burst', () => {
		const other = node('replay', LOOP, 0);
		const tree = node(ROOT, '', 0, [draw, other]);
		const entries: [ProfileNode, number][] = [];
		for (let k = 0; k < 40; k++) entries.push([draw, 128], [other, 132]);
		expect(burstBytes({ head: tree, samples: samplesOf(entries) }).size).toBe(0);
	});

	test('set aside one burst per place, and count the rest', () => {
		const other = node('replay', LOOP, 0);
		const tree = node(ROOT, '', 0, [wakeUp, other]);
		// Five equal runs, each a fifth of the place: the check sets one aside.
		const entries: [ProfileNode, number][] = [];
		for (let k = 0; k < 5; k++) entries.push([wakeUp, 4096], [other, 132]);
		const bursts = burstBytes({ head: tree, samples: samplesOf(entries) });
		expect(bursts.get('wakeUp render/loop.ts')).toBe(4096);
		wakeUp.selfSize = 5 * 4096;
		other.selfSize = 5 * 132;
		const places = profilePlaces({ head: tree, samples: samplesOf(entries) });
		const steady = steadyPlaces([{ places, frames: 100 }]);
		// Four of the five runs still count: 16 KB over 100 frames.
		expect(steady[0]).toEqual([
			'wakeUp render/loop.ts',
			{ perFrame: 163.84, most: 204.8, callers: '(root)' },
		]);
	});
});

describe('budgets', () => {
	const root = join(import.meta.dirname, '../..');
	const sources = ['packages/*/src/**/*.ts', 'bench/pages/**/*.ts'].flatMap((pattern) => [
		...new Glob(pattern).scanSync(root),
	]);

	/** Whether a source defines a function, method or arrow function of a name. */
	function defines(source: string, name: string): boolean {
		const modifiers =
			'(?:(?:export|async|static|private|public|protected|get|set|function|const|let)\\s+)*';
		return new RegExp(`^\\s*${modifiers}${name}\\s*[(<=:]`, 'm').test(source);
	}

	test('name a function that its file still defines, so a moved function keeps its budget', () => {
		const stale: string[] = [];
		for (const table of [BUDGETS, STATS_BUDGETS, SKY_ENVIRONMENT_BUDGETS]) {
			for (const places of Object.values(table)) {
				for (const place of Object.keys(places)) {
					const [name, file] = place.split(' ');
					if (!name || !file || file === '(built-in)') continue;
					const found = sources
						.filter((path) => path.endsWith(`/${file}`))
						.some(
							(path) =>
								name === '(anonymous)' || defines(readFileSync(join(root, path), 'utf8'), name),
						);
					if (!found) stale.push(place);
				}
			}
		}
		expect(stale).toEqual([]);
	});
});
