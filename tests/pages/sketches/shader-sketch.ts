// Holds WGSL in both forms that the null3D Vite plugin compiles: a `.wgsl` file that the sketch
// imports, and a template literal that a `wgsl` comment tags. When the page asks, the sketch posts
// both as it holds them, so the page can check that they arrive compiled, on the dev server and in
// a production build.
import { defineSketch } from '@null3d/engine';
import tint from './shaders/tint.wgsl';

/** A shader in the sketch's code: WebGL2 gets a darker color through the `WEBGL2` shader def. */
const glow = /* wgsl */ `
#import null3d::color

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
    let corner = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
    return vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs_glow() -> @location(0) vec4f {
#ifdef WEBGL2
    return vec4f(null3d::color::linear_to_srgb(vec3f(0.25)), 1.0);
#else
    return vec4f(null3d::color::linear_to_srgb(vec3f(0.5)), 1.0);
#endif
}
`;

export default defineSketch(({ page }) => {
	page.onMessage((name) => {
		if (name === 'shaders') page.post('shaders', { tint, glow });
	});
	return {};
});
