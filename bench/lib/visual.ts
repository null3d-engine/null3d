// The visual checks of the benchmark scenes: how still their shadows stay while the camera moves,
// and how far their shadow edges stray from a reference with the largest shadow map. The visual
// test page (tests/pages/visual.ts) draws every frame in hold mode, so the figures do not depend on
// how fast a device draws. The device runner's bench plan measures them beside its timings, and
// `bun run test:bench` checks them in CI. tests/pages/lib/shadow-check.ts says what each figure
// measures.

import {
	createS4,
	PARITY_CANVAS,
	S1_DEFAULT_COUNT,
	S2_NODE_COUNT,
	S3_DEFAULT_COUNT,
} from '../scenes/spec';
import type { BenchScene } from './parity';

/** Each benchmark scene's object count on its page, unless the page asks for another. */
export const SCENE_COUNTS: Readonly<Record<BenchScene, number>> = {
	s1: S1_DEFAULT_COUNT,
	's1-static': S1_DEFAULT_COUNT,
	's1-cells': S1_DEFAULT_COUNT,
	s2: S2_NODE_COUNT,
	s3: S3_DEFAULT_COUNT,
	s4: createS4().count,
};

/** The path of a benchmark scene's null3D sketch module from the server's root, at `count` objects. */
export function sceneSketchPath(scene: BenchScene, count = SCENE_COUNTS[scene]): string {
	return `/bench/pages/null3d/${scene}-sketch.ts?n=${count}`;
}

/** Switches of the visual page of a benchmark scene, each left out when undefined. */
export interface VisualSwitches {
	/** The object count, or undefined for the scene's own. */
	n?: number;
	/** The sun's shadow cascades, for S2, whose sun casts none unless the page asks. */
	shadows?: number;
	/** Capture the frames as PNG files too. */
	images?: boolean;
}

/**
 * The path of the visual page that measures a benchmark scene on one GPU path, on the dev server:
 * the shadow checks need the debug views, which only development builds draw. The canvas has the
 * hold frames' size.
 */
export function visualPagePath(
	scene: BenchScene,
	gpu: 'webgpu' | 'webgl2',
	{ n, shadows, images }: VisualSwitches = {},
): string {
	const query = new URLSearchParams({
		gpu,
		scene: sceneSketchPath(scene, n),
		size: `${PARITY_CANVAS.width}x${PARITY_CANVAS.height}`,
	});
	if (shadows !== undefined) query.set('shadows', String(shadows));
	return `/tests/pages/visual.html?${query}${images ? '&images' : ''}`;
}

/** The benchmark scenes whose sun casts shadows, which the visual checks of CI measure. */
export const SHADOW_SCENES: readonly { scene: BenchScene; shadows?: number }[] = [
	{ scene: 's2', shadows: 3 },
	{ scene: 's4' },
];
