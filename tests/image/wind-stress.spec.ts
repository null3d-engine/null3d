// Drives the frame-budget governor with the stress page at one preset: no cards, then every card
// until the governor steps, then none again. It prints what the governor did to the wind at each
// phase, and fails plainly when a preset could not be driven. It runs only with
// NULL3D_WIND_STRESS_COST set, in a quiet window, on a computer with a GPU of its own:
// NULL3D_WIND_STRESS_COST=1 bun run test:browser -- wind-stress.spec.ts.
// NULL3D_WIND_GPU names the paths, NULL3D_WIND_PRESETS the presets, and NULL3D_WIND_CARDS the load.
import { expect, test } from '@playwright/test';
import { costTimeout, loadNow, waitForQuiet } from '../lib/effect-cost.ts';
import { pageResult } from '../lib/page-result.ts';
import { TIMING_BROWSER } from '../lib/timing-browser.ts';

test.use(TIMING_BROWSER);

/** The sketch's reading of the governor and the wind's resolved settings. */
interface StressState {
	/** The engine governor's steps past the render scale. */
	steps: number;
	/** The wind's share of its own budget, from its floor to 1. */
	budgetScale: number;
	budgetMs: number;
	allowedMs: number;
	renderScale: number;
	preset: string;
	layer: number;
	settings: Readonly<Record<string, number | string>>;
}

interface Phase {
	state: StressState | null;
	frame: { interval: number; cpu: number; gpu: number | null };
}

interface StressResult {
	error?: string;
	tier: string;
	/** The preset that the page asked for. */
	requested: string;
	/** The preset the engine chose, which the path's cap may lower. */
	preset: string;
	cards: number;
	maxInstances: number;
	light: Phase;
	heavy: Phase;
	/** The governor's state at the end of the heavy phase, after its frames queued. */
	bottom: StressState | null;
	/** The settings beside the motion reading, with the light load in place. */
	stepping: StressState | null;
	settle: Phase;
	moved: number;
	/** Why the device could not capture two frames, where it could not. */
	captureError?: string;
	failures: string[];
}

const gpus = (process.env.NULL3D_WIND_GPU ?? 'webgpu').split(',');
const presets = (process.env.NULL3D_WIND_PRESETS ?? 'low,medium,high,ultra').split(',');
const cards = process.env.NULL3D_WIND_CARDS ?? '400000';

const ms = (value: number | null | undefined) =>
	value === null || value === undefined ? 'none' : value.toFixed(2);
const setting = (phase: Phase, name: string) => phase.state?.settings[name];

/** One phase, in one line. */
function phaseLine(name: string, phase: Phase): string {
	return [
		`  ${name}: governor steps ${phase.state?.steps ?? 'none'}, budget share ${ms(phase.state?.budgetScale)}`,
		`windStepMs ${String(setting(phase, 'windStepMs') ?? 'none')}`,
		`budget ${ms(phase.state?.allowedMs)} of ${ms(phase.state?.budgetMs)} ms`,
		`pressure ${String(setting(phase, 'windPressureSteps') ?? 'none')}`,
		`springs ${String(setting(phase, 'windSpringTrees') ?? 'none')}`,
		`grid ${String(setting(phase, 'windGrid') ?? 'none')}`,
		`interval ${ms(phase.frame.interval)} ms`,
		`CPU ${ms(phase.frame.cpu)} ms`,
		`GPU ${ms(phase.frame.gpu)} ms`,
	].join(', ');
}

for (const gpu of gpus) {
	for (const preset of presets) {
		test(`the wind governor under load on ${gpu} at ${preset}`, async ({ page }) => {
			test.skip(
				!process.env.NULL3D_WIND_STRESS_COST,
				'set NULL3D_WIND_STRESS_COST to drive the governor',
			);
			test.setTimeout(costTimeout(120_000));
			const loadBefore = await waitForQuiet();
			await page.setViewportSize({ width: 640, height: 400 });
			await page.goto(`wind-stress.html?gpu=${gpu}&preset=${preset}&cards=${cards}`);
			const result = await pageResult<StressResult>(page, 90_000);
			const load = loadNow();
			console.log(
				[
					`${result.tier} ${result.requested} (chosen ${result.preset}), ${result.cards} cards of ${result.maxInstances}, load ${loadBefore} before and ${load} after`,
					phaseLine('light', result.light),
					phaseLine('heavy', result.heavy),
					phaseLine('bottom', { state: result.bottom, frame: result.heavy.frame }),
					phaseLine('settle', result.settle),
					`  pixels moved while the governor was stepped: ${(result.moved * 100).toFixed(2)} percent`,
					`  failures: ${result.failures.join('; ') || 'none'}`,
				].join('\n'),
			);
			expect(result.error).toBeUndefined();
			expect(result.failures).toEqual([]);
			// WebGL2 and compatibility mode cap the preset at Medium, so a higher preset has no
			// higher settings to drive there.
			if (result.preset !== result.requested) {
				console.log(
					`  ${result.requested} is capped to ${result.preset} on ${result.tier}, so there is no higher preset to drive`,
				);
				return;
			}
			const light = result.light;
			const heavy = result.heavy;
			const settle = result.settle;
			// Low keeps no field, so its wind settings are zero at every phase. The governor still
			// steps the scene, and the page reports that.
			const hasField = Number(setting(light, 'windPressureSteps') ?? 0) > 0;
			if (!hasField) {
				console.log(`  ${result.preset} keeps no field, so there is no wind setting to drive`);
				return;
			}
			// The field still moves under the load. This holds whether or not the governor had to step.
			expect(result.captureError, `the capture failed: ${result.captureError}`).toBeUndefined();
			expect(result.moved).toBeGreaterThan(0);
			// The frame that the governor defends is the one that the light phase kept. The load is
			// over it when the heavy frames take longer, or when their GPU work alone passes it.
			const lightInterval = light.frame.interval;
			const heavyInterval = heavy.frame.interval;
			const heavyGpu = heavy.frame.gpu ?? 0;
			const overBudget = heavyInterval > lightInterval * 1.1 + 1 || heavyGpu > lightInterval;
			if (!overBudget) {
				// The device held the frame under the load, so the governor kept the field's full
				// settings. That is the budget's goal, and no step can be asked of it.
				console.log(
					`  the load stayed inside the frame (${ms(heavyInterval)} ms, GPU ${ms(heavyGpu)} ms of ${ms(lightInterval)} ms), so the governor kept the field's settings`,
				);
				return;
			}
			const driven =
				Number(setting(heavy, 'windStepMs')) > Number(setting(light, 'windStepMs')) ||
				Number(setting(heavy, 'windPressureSteps')) < Number(setting(light, 'windPressureSteps')) ||
				(heavy.state?.budgetScale ?? 1) < (light.state?.budgetScale ?? 1);
			expect(
				driven,
				`${result.preset} on ${result.tier} could not be driven: the light phase was at ${String(setting(light, 'windStepMs'))} ms, ${String(setting(light, 'windPressureSteps'))} pressure steps and budget share ${ms(light.state?.budgetScale)}, and the heavy phase reached ${String(setting(heavy, 'windStepMs'))} ms, ${String(setting(heavy, 'windPressureSteps'))} pressure steps and budget share ${ms(heavy.state?.budgetScale)}`,
			).toBe(true);
			// The governor lightens the field: a longer step, fewer pressure iterations, fewer
			// spring trees.
			expect(Number(setting(heavy, 'windStepMs'))).toBeGreaterThanOrEqual(
				Number(setting(light, 'windStepMs')),
			);
			expect(Number(setting(heavy, 'windPressureSteps'))).toBeLessThanOrEqual(
				Number(setting(light, 'windPressureSteps')),
			);
			expect(Number(setting(heavy, 'windSpringTrees'))).toBeLessThanOrEqual(
				Number(setting(light, 'windSpringTrees')),
			);
			// The governor comes back up when the load goes: the wind's share of its budget rises or
			// the field's settings do, from the deepest state that the heavy phase reached.
			const bottom = result.bottom ?? heavy.state;
			const cameBack =
				(settle.state?.budgetScale ?? 0) > (bottom?.budgetScale ?? 1) ||
				Number(setting(settle, 'windPressureSteps')) >
					Number(bottom?.settings.windPressureSteps ?? 0) ||
				Number(setting(settle, 'windStepMs')) < Number(bottom?.settings.windStepMs ?? 0);
			expect(
				cameBack,
				`${result.preset} on ${result.tier} did not come back: the bottom was ${String(bottom?.settings.windStepMs)} ms, ${String(bottom?.settings.windPressureSteps)} pressure steps and budget share ${ms(bottom?.budgetScale)}, and the settle phase reached ${String(setting(settle, 'windStepMs'))} ms, ${String(setting(settle, 'windPressureSteps'))} pressure steps and budget share ${ms(settle.state?.budgetScale)}`,
			).toBe(true);
			// The frame comes back inside the budget: with the load gone, the interval returns to the
			// light phase's, which is the display's own rate. The margin leaves room for the governor's
			// probation and for a device that runs a frame long now and then.
			const settleInterval = settle.frame.interval;
			expect(
				settleInterval,
				`${result.preset} on ${result.tier} did not return the frame: the light phase ran at ${ms(lightInterval)} ms and the heavy at ${ms(heavy.frame.interval)} ms, and the settle phase read ${ms(settleInterval)} ms`,
			).toBeLessThanOrEqual(lightInterval * 1.1 + 2);
		});
	}
}
