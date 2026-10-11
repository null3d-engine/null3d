// The visual checks of the benchmark scenes: how still their shadows stay while the camera moves,
// and how far their shadow edges stray from a reference with the largest shadow map. The visual
// test page (tests/pages/visual.ts) draws every frame in hold mode, so the figures do not depend on
// how fast a device draws. The device runner's bench plan measures them beside its timings, and
// `bun run test:bench` checks them in CI. tests/pages/lib/shadow-check.ts says what each figure
// measures. In S5, the crowd's skinned knights cast the shadows, so its figures check skinned
// shadows: they hold one pose, so that only the camera that places the cascades moves.

import { S5_DEFAULT_COUNT } from '../scenes/s5';
import { S6_FULL_COUNT } from '../scenes/s6';
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
	s5: S5_DEFAULT_COUNT,
	s6: S6_FULL_COUNT,
};

/** The path of a benchmark scene's null3D sketch module from the server's root, at `count` objects. */
export function sceneSketchPath(scene: BenchScene, count = SCENE_COUNTS[scene]): string {
	return `/bench/pages/null3d/${scene}-sketch.ts?n=${count}`;
}

/**
 * Switches that a scene's sketch takes on its visual page. The stability check compares frames at
 * successive times, and an animation that plays would change pixels between them, which the check
 * could not tell from cascades that shimmer. So S5's knights stand still in their first pose, which
 * the GPU still skins, and the frames differ only by the camera's motion.
 */
const VISUAL_SKETCH_SWITCHES: Partial<Record<BenchScene, string>> = { s5: 'still=1' };

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
	const switches = VISUAL_SKETCH_SWITCHES[scene];
	const query = new URLSearchParams({
		gpu,
		scene: `${sceneSketchPath(scene, n)}${switches ? `&${switches}` : ''}`,
		size: `${PARITY_CANVAS.width}x${PARITY_CANVAS.height}`,
	});
	if (shadows !== undefined) query.set('shadows', String(shadows));
	return `/tests/pages/visual.html?${query}${images ? '&images' : ''}`;
}

/**
 * The benchmark scenes whose sun casts shadows, which the visual checks of CI measure, with the
 * switches of each. CI's software GPU draws S5 with as many knights as its image test does
 * (D-88), as each of the visual page's twelve starts of the scene would take tens of seconds at
 * its full count.
 */
export const SHADOW_SCENES: readonly { scene: BenchScene; shadows?: number; n?: number }[] = [
	{ scene: 's2', shadows: 3 },
	{ scene: 's4' },
	{ scene: 's5', n: 100 },
];
