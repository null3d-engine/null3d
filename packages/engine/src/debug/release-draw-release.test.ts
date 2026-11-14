// Release builds drop the debug views and their shaders: the Vite plugin defines the development
// constant as false in production builds, so the renderer with its GPU backends defines no
// template for the debug views' lines. This builds the renderer for production, alone in its own
// process so that the bundle holds the memory that it needs.
import { describe, expect, it } from 'bun:test';
import { bundleOne, holds } from '../../../../tests/lib/release-build.ts';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';

/** Text that only the lines' shader holds: its color input in WGSL and in GLSL. */
const LINES_SHADER = /srgb: vec4<f32>|vec4 srgb;/;
/** Text that only the debug views' shader holds: the function of the depth view's gray. */
const VIEWS_SHADER = 'depth_gray';

describe('the release build of the renderer', () => {
	it(
		'holds none of the debug views or their shaders',
		async () => {
			const release = await bundleOne('render/draw.ts', 'production');
			expect(holds(release, LINES_SHADER)).toBe(false);
			expect(holds(release, VIEWS_SHADER)).toBe(false);
		},
		scaledBudget(120_000),
	);
});
