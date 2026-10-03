import { describe, expect, it } from 'bun:test';
import {
	ANIMATION,
	type AnimationResult,
	animationProblems,
	crowdCharacter,
	stepTimes,
} from '../pages/lib/animation.ts';
import { animationPlan, animationSummary, judge, NONE_MISSING, PLANS } from './plans.ts';
import type { ItemResult } from './runs.ts';

describe('the animation crowd', () => {
	const character = crowdCharacter(ANIMATION.joints);

	it('lists joints parents first, with inverse bind matrices that undo the rest pose', () => {
		const { parents, rest, inverseBind } = character;
		expect(parents).toHaveLength(ANIMATION.joints);
		expect(parents.every((p, j) => p === 0xffffffff || p < j)).toBe(true);
		// Each joint's height at rest is its parent's plus its own offset; the bind matrix moves it back.
		const height = (j: number): number => {
			const parent = parents[j] ?? 0xffffffff;
			return (rest[j * 10 + 1] ?? 0) + (parent === 0xffffffff ? 0 : height(parent));
		};
		for (let j = 0; j < ANIMATION.joints; j++)
			expect(inverseBind[j * 12 + 7]).toBeCloseTo(-height(j), 6);
	});

	it('has two clips that move the root and turn every joint with unit quaternions', () => {
		expect(character.clips).toHaveLength(2);
		for (const tracks of character.clips) {
			expect(tracks).toHaveLength(ANIMATION.joints + 1);
			for (const track of tracks) {
				const size = track.channel === 1 ? 4 : 3;
				expect(track.values).toHaveLength(track.times.length * size);
				if (track.channel !== 1) continue;
				for (let k = 0; k < track.values.length; k += 4) {
					const q = track.values.slice(k, k + 4);
					expect(Math.hypot(...q)).toBeCloseTo(1, 6);
				}
			}
		}
		expect(character.clips[1]?.[0]?.times.at(-1)).toBeCloseTo(0.75, 9);
	});
});

const result = (overrides: Partial<AnimationResult> = {}): ItemResult & AnimationResult => ({
	ok: true,
	characters: 100,
	joints: 48,
	jobWorkers: 6,
	frames: 240,
	step: { medianMs: 0.5, p90Ms: 0.75, meanMs: 0.55 },
	jobMsPerFrame: 1.2,
	finite: true,
	moved: true,
	...overrides,
});

describe('the animation plan', () => {
	const items = animationPlan();

	it('runs the animation page for a crowd of 100 and one of 500', () => {
		expect(PLANS.animation).toBe(animationPlan);
		expect(items.map((item) => item.path)).toEqual([
			'/tests/pages/animation.html?characters=100',
			'/tests/pages/animation.html?characters=500',
		]);
		expect(items[1]?.check).toEqual({ kind: 'animation', characters: 500 });
	});

	it('fails a page that timed nothing, or whose matrices are not finite or all equal', () => {
		const check = items[0]!.check;
		expect(judge(check, result(), NONE_MISSING)).toEqual([]);
		expect(animationProblems(result({ frames: 0, finite: false, moved: false }))).toEqual([
			'no frame step was timed',
			'a skinning matrix holds a number that is not finite',
			'the characters all got the same pose',
		]);
	});

	it('tables the step times and the job workers time of each crowd', () => {
		const table = animationSummary(items, (id) => (id === 'animation-100' ? result() : undefined));
		expect(table?.split('\n').slice(2)).toEqual([
			'| Characters | Joints | Job workers | Step median | Step p90 | Step mean | Job workers |',
			'| --- | --- | --- | --- | --- | --- | --- |',
			'| 100 | 48 | 6 | 0.50 | 0.75 | 0.55 | 1.20 |',
			'| 500 | no result; the runner stopped before this page | | | | | |',
		]);
		expect(animationSummary(PLANS.checks!(), () => undefined)).toBeUndefined();
	});

	it('takes the median, the 90th percentile and the mean of the step times', () => {
		const times = Array.from({ length: 10 }, (_, k) => k + 1);
		expect(stepTimes(times)).toEqual({ medianMs: 6, p90Ms: 10, meanMs: 5.5 });
		expect(stepTimes([])).toEqual({ medianMs: 0, p90Ms: 0, meanMs: 0 });
	});
});
