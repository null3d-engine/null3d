// The visual checks' results and limits, shared by the browser tests, the benchmark tests and the
// device runner.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StabilityFigures, StairSteps } from '../pages/lib/shadow-check.ts';

/** What the visual page publishes. */
export interface VisualResult {
	error?: string;
	tier: string;
	scene: string;
	width: number;
	height: number;
	stability: StabilityFigures;
	edges: { offsetPixels: number; steps?: StairSteps; referenceSteps?: StairSteps };
	/** PNG files in base64, by name. */
	images?: Record<string, string>;
}

/** The most that each figure of a scene may reach before it counts as a regression. */
export interface VisualLimits {
	/** The share of pixels, in percent, whose shadow may change between two frames. */
	changedPercent: number;
	/** How far shadow edges may stray from the reference's, in pixels. */
	edgeOffsetPixels: number;
	/** The stair steps of the scene's long edge, in pixels, where it has one. */
	stairStepPixels?: number;
}

/**
 * The limits of each scene that the checks measure, on both GPU paths, with Chrome on the Mac's GPU
 * and with SwiftShader in CI. Each sits between the figures of the engine as it is and the figures
 * of two faults put back on purpose on 3 October 2026, which .dev/image-tests.md lists. Stable
 * cascades change at most 0.007% of the pixels from frame to frame; cascades that no longer snap
 * to whole texels change 0.14% to 1.9%. The edge figures depend on each scene's edges, so each
 * scene has its own: the split that leaned 80% toward the logarithmic spread, before #211, raised
 * the long edge's stair steps from 0.29 px to 0.53 px and S4's edge offset from 0.095 px to 0.14 px.
 */
export const VISUAL_LIMITS: Readonly<Record<string, VisualLimits>> = {
	'shadow-scene': { changedPercent: 0.05, edgeOffsetPixels: 0.15, stairStepPixels: 0.4 },
	s2: { changedPercent: 0.05, edgeOffsetPixels: 0.1 },
	s4: { changedPercent: 0.05, edgeOffsetPixels: 0.12 },
};

/**
 * Writes a visual page's figures into `folder` as `figures.json`, and each PNG file it captured as
 * `<name>.png`, so people can look at the frames that the figures come from.
 */
export function saveVisualResult(folder: string, result: VisualResult): void {
	mkdirSync(folder, { recursive: true });
	for (const [name, png] of Object.entries(result.images ?? {}))
		writeFileSync(join(folder, `${name}.png`), Buffer.from(png, 'base64'));
	const { stability, edges } = result;
	writeFileSync(join(folder, 'figures.json'), JSON.stringify({ stability, edges }, null, '\t'));
}

/** What is wrong with a visual page's figures for `scene`; empty when nothing is. */
export function visualProblems(scene: string, result: VisualResult): string[] {
	const limits = VISUAL_LIMITS[scene];
	if (!limits) return [];
	const { stability, edges } = result;
	const problems: string[] = [];
	if (stability.shadowedPercent < 1) problems.push('the frame shows almost no shadow');
	if (stability.changedPercent > limits.changedPercent)
		problems.push(
			`${stability.changedPercent.toFixed(3)}% of the pixels changed their shadow between frames, over the limit of ${limits.changedPercent}%`,
		);
	if (edges.offsetPixels > limits.edgeOffsetPixels)
		problems.push(
			`shadow edges stray ${edges.offsetPixels.toFixed(3)} px from the reference's, over the limit of ${limits.edgeOffsetPixels} px`,
		);
	const steps = edges.steps?.rmsPixels;
	if (limits.stairStepPixels !== undefined && steps !== undefined && steps > limits.stairStepPixels)
		problems.push(
			`the long edge's stair steps measure ${steps.toFixed(3)} px, over the limit of ${limits.stairStepPixels} px`,
		);
	return problems;
}
