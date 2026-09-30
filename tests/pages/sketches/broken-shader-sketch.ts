// A sketch whose tagged WGSL does not compile: a value follows another with nothing between them.
// The shader error test loads it from a dev server, where the plugin's error must reach Vite's
// overlay on the page with this file's line and column.
import { defineSketch } from '@null3d/engine';

const broken = /* wgsl */ `
@vertex
fn vs_main() -> @builtin(position) vec4f {
    return vec4f(0.0);
}

@fragment
fn fs_main() -> @location(0) vec4f {
    return vec4f(1.0) 2.0;
}
`;

export default defineSketch(({ page }) => {
	page.post('shader', broken);
	return {};
});
