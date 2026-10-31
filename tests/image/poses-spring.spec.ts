// A branch pose keeps a spring: when the air stops, the branch turns on past its rest and settles
// back. The sketch stops a steady wind a second in and reads one branch's turn from the pose pass
// until it settles. The figures below show that the branch moved under the wind, kept moving after
// the air stopped, passed its rest to the other side, and came back near it.
import { expect, test } from '@playwright/test';
import { pageResult, watchPageProblems } from '../lib/page-result.ts';

interface Sample {
	t: number;
	angle: number;
}

interface Spring {
	stop: number;
	samples: Sample[];
}

test('poses-spring: a branch springs back after the air stops', async ({ page }) => {
	test.setTimeout(180_000);
	const problems = watchPageProblems(page);
	await page.goto('/tests/pages/poses-spring.html');
	const spring = await pageResult<Spring>(page, 120_000).catch((error: unknown) => {
		throw new Error(`the page gave no series: ${String(error)}\n${problems.join('\n')}`);
	});
	const before = spring.samples.filter((sample) => sample.t < spring.stop);
	const after = spring.samples.filter((sample) => sample.t > spring.stop + 0.15);
	expect(before.length).toBeGreaterThan(1);
	expect(after.length).toBeGreaterThan(3);
	const windward = Math.max(...before.map((sample) => Math.abs(sample.angle)));
	expect(windward).toBeGreaterThan(0.001);
	// The mean side of the turn under the wind, which the spring passes through after the stop.
	const side = Math.sign(
		before.reduce((sum, sample) => sum + sample.angle, 0) / Math.max(before.length, 1),
	);
	// The branch kept turning after the air stopped: a sample reads past a tenth of the turn it
	// held under the wind, which no method without state can show.
	const kept = after.some((sample) => Math.abs(sample.angle) > windward * 0.1);
	expect(kept).toBe(true);
	// It went past its rest to the other side: the spring overshoots rather than easing to zero.
	const overshot = after.some(
		(sample) => Math.sign(sample.angle) === -side && Math.abs(sample.angle) > windward * 0.02,
	);
	expect(overshot).toBe(true);
	// And it came back near its rest.
	const last = spring.samples[spring.samples.length - 1];
	expect(last).toBeDefined();
	expect(Math.abs(last?.angle ?? windward)).toBeLessThan(windward * 0.25);
});
