// Drives the frame-budget governor with the stress page at one preset: no cards, then every card
// until the governor steps, then none again. It prints what the governor did to the wind at each
// phase, and fails plainly when a preset could not be driven. It runs only with
// NULL3D_WIND_STRESS set, in a quiet window, on a computer with a GPU of its own:
// NULL3D_WIND_STRESS=1 bun run test:browser -- wind-stress.spec.ts.
// NULL3D_WIND_GPU names the paths, NULL3D_WIND_PRESETS the presets, and NULL3D_WIND_CARDS the load.
import { expect, test } from '@playwright/test';
import { costTimeout, loadNow, waitForQuiet } from '../lib/effect-cost.ts';
import { pageResult } from '../lib/page-result.ts';
import { TIMING_BROWSER } from '../lib/timing-browser.ts';

test.use(TIMING_BROWSER);

/** The sketch's reading of the governor and the wind's resolved settings. */
interface StressState {
	steps: number;
	scale: number;
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
	settle: Phase;
	moved: number;
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
		`  ${name}: governor steps ${phase.state?.steps ?? 'none'}, scale ${ms(phase.state?.scale)}`,
		`windStepMs ${String(setting(phase, 'windStepMs') ?? 'none')}`,
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
			test.skip(!process.env.NULL3D_WIND_STRESS, 'set NULL3D_WIND_STRESS to drive the governor');
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
					`  pixels moved in the heavy phase: ${(result.moved * 100).toFixed(2)} percent`,
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
			const driven =
				Number(setting(heavy, 'windStepMs')) > Number(setting(light, 'windStepMs')) ||
				Number(setting(heavy, 'windPressureSteps')) < Number(setting(light, 'windPressureSteps')) ||
				(heavy.state?.scale ?? 1) < (light.state?.scale ?? 1);
			expect(
				driven,
				`${result.preset} on ${result.tier} could not be driven: the light phase was at ${String(setting(light, 'windStepMs'))} ms, ${String(setting(light, 'windPressureSteps'))} pressure steps and scale ${ms(light.state?.scale)}, and the heavy phase reached ${String(setting(heavy, 'windStepMs'))} ms, ${String(setting(heavy, 'windPressureSteps'))} pressure steps and scale ${ms(heavy.state?.scale)}`,
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
			// The field still moves at the governor's lowest step.
			expect(result.moved).toBeGreaterThan(0);
			// The governor comes back up when the load goes: the render scale rises or the field's
			// settings do, from the deepest state that the heavy phase reached.
			const bottom = result.bottom ?? heavy.state;
			const cameBack =
				(settle.state?.scale ?? 0) > (bottom?.scale ?? 1) ||
				Number(setting(settle, 'windPressureSteps')) >
					Number(bottom?.settings.windPressureSteps ?? 0) ||
				Number(setting(settle, 'windStepMs')) < Number(bottom?.settings.windStepMs ?? 0);
			expect(
				cameBack,
				`${result.preset} on ${result.tier} did not come back: the bottom was ${String(bottom?.settings.windStepMs)} ms, ${String(bottom?.settings.windPressureSteps)} pressure steps and scale ${ms(bottom?.scale)}, and the settle phase reached ${String(setting(settle, 'windStepMs'))} ms, ${String(setting(settle, 'windPressureSteps'))} pressure steps and scale ${ms(settle.state?.scale)}`,
			).toBe(true);
		});
	}
}
