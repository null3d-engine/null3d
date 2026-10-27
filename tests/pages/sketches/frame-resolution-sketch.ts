// A plane that covers the view, whose custom material paints its own place on the render target:
// the part beyond half the place across and the part beyond half the place down draw bright, and
// the rest draws dark. The place is `input.fragCoord.xy / frame.resolution`, so the two changes sit
// at the middle of the image only while the size the shader reads is the size the scene drew at.
// With ?vignette the plane draws one bright color instead, and the vignette darkens it, so the
// page can read where the vignette's center lies. The page fixes a render scale in each frame, one
// at a time, and posts back the scale that the engine drew it at.
import { defineSketch } from '@null3d/engine';

const VIGNETTE = new URL(import.meta.url).searchParams.has('vignette');

const halves = /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let place = input.fragCoord.xy / frame.resolution;
    // Two values far apart, so the change stays visible through any tone curve and exposure.
    s.baseColor = vec3f(0.0);
    s.emissive = vec3f(select(0.02, 1.0, place.x > 0.5 || place.y > 0.5));
    return s;
}
`;

const plain = /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor = vec3f(0.0);
    s.emissive = vec3f(1.0);
    return s;
}
`;

export default defineSketch(({ scene, materials, geometry, quality, post, page }) => {
	// The vignette darkens the plain plane toward the edges of its center, which the page measures.
	if (VIGNETTE) post.set({ vignette: { intensity: 1, size: 1 } });
	scene.setBackground('#000000');
	scene.setActiveCamera(
		scene.createOrthographicCamera({
			height: 2,
			near: 0.1,
			far: 10,
			position: [0, 0, 2],
			target: [0, 0, 0],
		}),
	);
	const material = materials.shader({ wgsl: VIGNETTE ? plain : halves });
	scene.createMesh({ mesh: geometry.plane({ width: 4, height: 4 }), material });

	let next: number | undefined;
	page.onMessage((name, data) => {
		if (name === 'scale') next = data as number;
	});
	return {
		onUpdate() {
			if (next === undefined) return;
			// A new range applies to the frame being drawn.
			quality.set({ minRenderScale: next, maxRenderScale: next });
			next = undefined;
			page.post('drawn', quality.renderScale);
		},
	};
});
