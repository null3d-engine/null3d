// Light far brighter than a 16-bit float holds, for the HDR limit's image tests. A small emissive
// sphere gives off more than 65,504, the largest 16-bit float, and a smooth metal floor mirrors the
// sun toward the camera, where the highlight's center passes it too. Some GPUs store such a value
// as infinity, which the tone mapping turns into black, and bloom then spreads it. Both must draw
// white, and with ?bloom the sphere must glow, as tests/image/hdr-limit.spec.ts checks. With ?nan a
// plate beside the sphere writes a NaN in every channel: it must draw black and, with bloom, must
// not spread through the blur.
import { defineSketch } from '@null3d/engine';

const BLOOM = new URL(import.meta.url).searchParams.has('bloom');
const NAN = new URL(import.meta.url).searchParams.has('nan');

/** The sphere's emissive intensity: a white emissive this bright passes the largest 16-bit float. */
const GLOW = 100_000;
/** The sun's intensity: the highlight's center reflects tens of thousands of times as much. */
const SUN = 30;

/**
 * A surface whose base color and emissive light are NaN in every channel. The NaN comes from the
 * vertex color's bits, as WGSL refuses a NaN in a constant: white's alpha of 1 with the quiet NaN's
 * bits set is that NaN.
 */
const nan = /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let nan = vec3f(bitcast<f32>(bitcast<u32>(input.vertexColor.a) | 0x7fc00000u));
    s.baseColor = nan;
    s.emissive = nan;
    return s;
}
`;

export default defineSketch(({ scene, materials, geometry, post }) => {
	if (BLOOM) post.set({ bloom: { intensity: 0.02, threshold: 1, blend: 'add' } });
	scene.setBackground('#000000');
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		near: 0.1,
		far: 100,
		position: [0, 2, 4],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	if (!BLOOM)
		scene.createDirectionalLight({ direction: [0, -1, 2], color: '#ffffff', intensity: SUN });
	scene.createMesh({
		mesh: geometry.box({ width: 20, height: 0.2, depth: 20 }),
		material: materials.standard({ color: '#ffffff', roughness: 0, metalness: 1 }),
		position: [0, -0.1, 0],
	});
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.05, widthSegments: 16, heightSegments: 8 }),
		material: materials.standard({
			color: '#000000',
			emissive: '#ffffff',
			emissiveIntensity: GLOW,
		}),
		position: [-1.2, 1, 0],
	});
	// With ?nan, a small plate beside the sphere writes a NaN in every channel. It must draw black,
	// and with bloom it must not poison the blur: the sphere must still glow.
	if (NAN)
		scene.createMesh({
			mesh: geometry.box({ width: 0.6, height: 0.6, depth: 0.02 }),
			material: materials.shader({ wgsl: nan }),
			position: [1.2, 1, 0],
		});
});
