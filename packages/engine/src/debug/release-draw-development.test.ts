// The debug views and their shaders must reach a development build, or the release build's check
// would pass for the wrong reason: a marker that no build holds proves nothing when it is absent.
// This builds the renderer for development, alone in its own process so that the bundle holds the
// memory that it needs.
import { describe, expect, it } from 'bun:test';
import { bundleOne, holds, sizeOf } from '../../../../tests/lib/release-build.ts';

/** Text that only the lines' shader holds: its color input in WGSL and in GLSL. */
const LINES_SHADER = /srgb: vec4<f32>|vec4 srgb;/;
/** Text that only the debug views' shader holds: the function of the depth view's gray. */
const VIEWS_SHADER = 'depth_gray';

describe('the development build of the renderer', () => {
	it('holds the debug views and their shaders', async () => {
		const development = await bundleOne('render/draw.ts', 'development');
		expect(holds(development, LINES_SHADER)).toBe(true);
		expect(holds(development, VIEWS_SHADER)).toBe(true);
		console.log(`renderer, minified: ${sizeOf(development)} bytes with debug views`);
	}, 120_000);
});
