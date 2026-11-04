// Custom materials that sample a texture array, for their image test. One texture of six layers,
// made in code, with a colour per layer. From left to right: a plane whose six bands sample a
// layer each, picked per pixel from the texture coordinates; a sphere that loads two layers in one
// surface function and blends them by its height; and a plane that samples the array with a bias,
// picking its layer by the height too.
import { defineSketch } from '@null3d/engine';

/** Texels on each side of every layer. */
const SIZE = 8;
/** The colours of the six layers, from the first to the last. */
const LAYERS = [
	[232, 64, 48],
	[224, 160, 32],
	[216, 208, 64],
	[64, 176, 96],
	[48, 112, 208],
	[160, 80, 192],
];

const bands = /* wgsl */ `
var facades: texture_2d_array<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let layer = clamp(i32(input.uv.x * 6.0), 0, 5);
    s.baseColor = textureSampleLevel(facades, facadesSampler, input.uv, layer, 0.0).rgb;
    s.roughness = 1.0;
    s.metalness = 0.0;
    return s;
}
`;

const mixed = /* wgsl */ `
var facades: texture_2d_array<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let low = textureLoad(facades, vec2i(0), 1, 0);
    let high = textureLoad(facades, vec2i(0), 4, 0);
    s.baseColor = mix(low.rgb, high.rgb, smoothstep(0.35, 0.65, input.uv.y));
    s.roughness = 1.0;
    s.metalness = 0.0;
    return s;
}
`;

const biased = /* wgsl */ `
var facades: texture_2d_array<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let layer = clamp(i32(input.uv.y * 6.0), 0, 5);
    s.baseColor = textureSampleBias(facades, facadesSampler, input.uv, layer, 1.0).rgb;
    s.roughness = 1.0;
    s.metalness = 0.0;
    return s;
}
`;

/** One texel of every layer, in turn, with `rgba` from `LAYERS`. */
function texels(): Uint8Array {
	const data = new Uint8Array(SIZE * SIZE * 4 * LAYERS.length);
	LAYERS.forEach((color, layer) => {
		for (let k = 0; k < SIZE * SIZE; k++) data.set([...color, 255], (layer * SIZE * SIZE + k) * 4);
	});
	return data;
}

export default defineSketch(({ scene, materials, geometry, textures }) => {
	scene.setBackground('#1c2026');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 35,
			near: 0.1,
			far: 50,
			position: [0, 1.8, 10],
			target: [0, 0, 0],
		}),
	);
	scene.createDirectionalLight({ direction: [-0.5, -0.8, -1], color: '#ffffff', intensity: 3 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.4 });

	const facades = textures.fromData({
		width: SIZE,
		height: SIZE,
		depth: LAYERS.length,
		data: texels(),
		colorSpace: 'srgb',
		filter: 'nearest',
	});

	const plane = geometry.plane({ width: 2.2, height: 2.2 });
	const sphere = geometry.sphere({ radius: 0.9, widthSegments: 32, heightSegments: 16 });
	const objects = [
		{ mesh: plane, wgsl: bands },
		{ mesh: sphere, wgsl: mixed },
		{ mesh: plane, wgsl: biased },
	];
	objects.forEach(({ mesh, wgsl }, k) => {
		const material = materials.shader({ wgsl, textures: { facades }, doubleSided: true });
		scene.createMesh({ mesh, material, position: [-2.6 + k * 2.6, 0, 0] });
	});
});
