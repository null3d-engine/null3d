import { describe, expect, test } from 'bun:test';
import { byPlace, type ProfileNode, type Sample, steadyPlaces, totalSize } from './allocation';

function node(functionName: string, url: string, selfSize: number, children: ProfileNode[] = []) {
	return { callFrame: { functionName, url }, selfSize, children };
}

const ROOT = '(root)';
const LOOP = 'http://localhost/packages/engine/src/render/loop.ts';

describe('allocation places', () => {
	test('sum each place across its call paths, and keep the callers of its largest path', () => {
		const head = node(ROOT, '', 0, [
			node('frame', LOOP, 0, [node('draw', LOOP, 300)]),
			node('onDone', LOOP, 0, [node('draw', LOOP, 100)]),
		]);
		const places = byPlace(head);
		expect(places.get('draw render/loop.ts')).toEqual({
			bytes: 400,
			callers: 'frame render/loop.ts < (root)',
			largest: 300,
		});
		expect(totalSize(head)).toBe(400);
	});

	test('judge each place by the sample where it allocated least', () => {
		const sample = (entries: [string, number][], frames: number): Sample => ({
			frames,
			places: new Map(
				entries.map(([name, bytes]) => [name, { bytes, callers: '', largest: bytes }]),
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
