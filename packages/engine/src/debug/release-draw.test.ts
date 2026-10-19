// Release builds drop the debug views and their shaders: the Vite plugin defines the development
// constant as false in production builds, so the renderer with its GPU backends defines no
// template for the debug views' lines. This builds the renderer both ways and compares them.
import { describe, expect, it } from 'bun:test';
import { bundleOne, holds, sizeOf } from '../../../../tests/lib/release-build.ts';

/** Text that only the lines' shader holds: its color input in WGSL and in GLSL. */
const LINES_SHADER = /srgb: vec4<f32>|vec4 srgb;/;
/** Text that only the debug views' shader holds: the function of the depth view's gray. */
const VIEWS_SHADER = 'depth_gray';

describe('the release build of the renderer', () => {
	it('holds none of the debug views or their shaders', async () => {
		const release = await bundleOne('render/draw.ts', 'production');
		const development = await bundleOne('render/draw.ts', 'development');
		expect(holds(development, LINES_SHADER)).toBe(true);
		expect(holds(development, VIEWS_SHADER)).toBe(true);
		expect(holds(release, LINES_SHADER)).toBe(false);
		expect(holds(release, VIEWS_SHADER)).toBe(false);
		console.log(
			`renderer, minified: ${sizeOf(development)} bytes with debug views, ${sizeOf(release)} without`,
		);
	}, 120_000);
});
