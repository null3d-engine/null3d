// The animator in a running engine, in each thread mode: clips play, fade and finish on the job
// workers (or inline without them), and the sketch's handlers hear each clip's events in order.
// The sketch's characters and their timeline are in `pages/sketches/animator-sketch.ts`.
import { expect, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';
import type { AnimatorReport, HeardEvent } from '../pages/lib/animator-report.ts';

/** The sketch time at which the hero starts its cross-fade to the run, and how long it takes. */
const CROSS_FADE_AT = 1.2;
const CROSS_FADE = 0.3;

for (const mode of ENGINE_MODES)
	test(`the animator plays, fades and reports events, ${mode.name}`, async ({ page }) => {
		await page.goto(`animator.html?${mode.query}`);
		const result = await pageResult<AnimatorReport & { error?: string }>(page, 60_000);
		expect(result.error).toBeUndefined();
		expect(result.clips).toEqual(['walk', 'run']);
		expect(result.errors).toEqual({
			unknownClip: 'E1218',
			badLayer: 'E1218',
			noClips: 'E1218',
			afterDestroy: 'E1101',
		});
		const of = (who: string) => result.heard.filter((e) => e.who === who);
		const names = (events: HeardEvent[]) => events.map((e) => `${e.name} ${e.clip} ${e.layer}`);

		// The guard's run plays once: it finishes once and never loops.
		expect(names(of('guard'))).toEqual(['finished run 0']);

		// The hero's footsteps alternate, a loop of the walk comes between them, and they stop once
		// the walk has faded out. The run then loops.
		const hero = of('hero');
		const steps = hero.filter((e) => e.name === 'left' || e.name === 'right');
		expect(steps.length).toBeGreaterThanOrEqual(2);
		steps.forEach((e, k) => {
			expect(e.name).toBe(k % 2 === 0 ? 'left' : 'right');
			expect(e.time).toBeLessThanOrEqual(CROSS_FADE_AT + CROSS_FADE + 0.1);
		});
		expect(names(hero)).toContain('loop walk 0');
		expect(names(hero)).toContain('loop run 0');

		// The dancer's walk and its additive run on layer 1 both loop at twice the speed, and its
		// handlers hear nothing after it is destroyed.
		const dancer = of('dancer');
		expect(names(dancer)).toContain('loop walk 0');
		expect(names(dancer)).toContain('loop run 1');
		expect(dancer.every((e) => e.time <= result.destroyedAt)).toBe(true);
	});
