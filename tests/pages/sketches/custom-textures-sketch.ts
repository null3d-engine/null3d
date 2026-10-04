// Custom materials with textures, for their image test. Two textures made in code: a color
// checker in sRGB, and a linear texture of rings whose red channel is a height and whose green
// channel is a mask. From left to right: a surface function that multiplies the base color by the
// checker and makes the rings glow; the same WGSL without its textures, which samples white; a
// vertex offset that lifts a plane by the rings' height, read in the vertex stage, and colors it by
// the checker; and the first material through a nearest filter and twice the tiling, as uniforms
// and the texture's own options give it.
import { defineSketch } from '@null3d/engine';

/** Texels on each side of both textures. */
const SIZE = 16;

const glow = /* wgsl */ `
struct Uniforms { tiles: f32, glow: vec3f }

var checker: texture_2d<f32>;
var rings: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let uv = input.uv * max(material.tiles, 1.0);
    s.baseColor *= textureSample(checker, checkerSampler, uv).rgb;
    let mask = textureSample(rings, ringsSampler, input.uv).g;
    s.emissive += material.glow * mask;
    s.roughness = mix(s.roughness, 0.2, mask);
    return s;
}
`;

const lifted = /* wgsl */ `
var heights: texture_2d<f32>;
var colors: texture_2d<f32>;

fn vertexOffset(input: VertexInput) -> vec3f {
    let height = textureSampleLevel(heights, heightsSampler, input.uv, 0.0).r;
    return input.normal * height * 0.6;
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let size = vec2i(textureDimensions(colors));
    let texel = min(vec2i(input.uv * vec2f(size)), size - 1);
    s.baseColor *= textureLoad(colors, texel, 0).rgb;
    return s;
}
`;

/** Four numbers per texel of a texture of `SIZE` texels on each side, from `texel(x, y)`. */
function texels(texel: (x: number, y: number) => readonly number[]): Uint8Array {
	const data = new Uint8Array(SIZE * SIZE * 4);
	for (let y = 0; y < SIZE; y++)
		for (let x = 0; x < SIZE; x++) data.set(texel(x, y), (y * SIZE + x) * 4);
	return data;
}

export default defineSketch(({ scene, materials, geometry, textures }) => {
	scene.setBackground('#1c2026');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 35,
			near: 0.1,
			far: 50,
			position: [0, 2.2, 11],
			target: [0, 0, 0],
		}),
	);
	scene.createDirectionalLight({ direction: [-0.5, -0.8, -1], color: '#ffffff', intensity: 3 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.4 });

	const checkerTexels = texels((x, y) =>
		(x >> 2) % 2 === (y >> 2) % 2 ? [240, 180, 60, 255] : [40, 110, 220, 255],
	);
	const ringTexels = texels((x, y) => {
		const d = Math.hypot(x + 0.5 - SIZE / 2, y + 0.5 - SIZE / 2);
		const height = Math.max(0, 1 - d / (SIZE / 2));
		return [Math.round(height * 255), Math.floor(d) % 3 === 0 ? 255 : 0, 0, 255];
	});
	const options = { width: SIZE, height: SIZE, mipmaps: true, wrap: 'repeat' } as const;
	const checker = textures.fromData({ ...options, data: checkerTexels, colorSpace: 'srgb' });
	const rings = textures.fromData({ ...options, data: ringTexels, colorSpace: 'linear' });
	const sharp = textures.fromData({
		...options,
		data: checkerTexels,
		colorSpace: 'srgb',
		filter: 'nearest',
	});

	const sphere = geometry.sphere({ radius: 0.8, widthSegments: 32, heightSegments: 16 });
	const plane = geometry.plane({ width: 1.8, height: 1.8, widthSegments: 32, heightSegments: 32 });
	const uniforms = { tiles: 2, glow: [0.9, 0.3, 0.1] as [number, number, number] };
	const objects = [
		{
			mesh: sphere,
			material: materials.shader({ wgsl: glow, uniforms, textures: { checker, rings } }),
		},
		{ mesh: sphere, material: materials.shader({ wgsl: glow, uniforms, color: '#a0a8b0' }) },
		{
			mesh: plane,
			material: materials.shader({
				wgsl: lifted,
				textures: { heights: rings, colors: checker },
				doubleSided: true,
			}),
			turn: -1.1,
		},
		{
			mesh: sphere,
			material: materials.shader({
				wgsl: glow,
				uniforms: { ...uniforms, tiles: 4 },
				textures: { checker: sharp, rings },
			}),
		},
	];
	objects.forEach(({ mesh, material, turn }, k) => {
		const object = scene.createMesh({ mesh, material, position: [-3.3 + k * 2.2, 0, 0] });
		if (turn) object.setRotationEuler(turn, 0, 0);
	});
});
