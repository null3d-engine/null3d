// Clear coats and sheens of the standard material, for their image tests, in the built-in room's
// light with a sun and a point light. The back row has a red car paint under coats of rising
// roughness, the middle row a dark cloth under sheens of rising roughness, and the front row
// draws their maps, made in code: a coat map with stripes of coat in red and of roughness in
// green, a coat normal map of ridges over a smooth base, and a sheen map with a color checker
// whose alpha holds the roughness. The last ball of the front row is a custom material whose
// surface function wets a stone: puddles of coat where a pattern dips, over a darker base.
// ?off gives every ball its layers turned off, a coat of 0 and a black sheen, and ?none leaves
// the layers out altogether: the layers spec checks that both draw the same image. ?custom draws
// the back and middle rows with a custom material whose surface function keeps the default
// surface, which must draw as the standard material does. ?noenv leaves the room out, for the test
// of the files that the first layered material downloads.
import { defineSketch, type StandardOptions } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;

/** Texels on each side of the maps. */
const SIZE = 32;

/** A wet stone: rough gray stone whose low places hold water, a clear coat over a darker base. */
const wetStone = /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let p = input.uv * vec2f(6.0, 3.0);
    let ripple = sin(p.x * 3.1 + sin(p.y * 2.3)) * sin(p.y * 2.9 + sin(p.x * 1.7));
    let wet = smoothstep(0.1, 0.5, ripple);
    s.baseColor *= mix(1.0, 0.45, wet);
    s.roughness = mix(s.roughness, 0.3, wet);
    s.clearcoat = wet;
    s.clearcoatRoughness = 0.04;
    return s;
}
`;

/** The default surface, unchanged, with the layers named so the material has their builds. */
const plain = /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.clearcoat = s.clearcoat;
    return s;
}
`;

/** Four numbers per texel of a map of `SIZE` texels on each side, from `texel(x, y)`. */
function texels(texel: (x: number, y: number) => readonly number[]): Uint8Array {
	const data = new Uint8Array(SIZE * SIZE * 4);
	for (let y = 0; y < SIZE; y++)
		for (let x = 0; x < SIZE; x++) data.set(texel(x, y), (y * SIZE + x) * 4);
	return data;
}

export default defineSketch(async ({ scene, materials, geometry, textures, assets }) => {
	scene.setBackground('#1b1e24');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 35,
			near: 0.1,
			far: 50,
			position: [0, 3.2, 11],
			target: [0, 0.4, 0],
		}),
	);
	if (!params.has('noenv')) scene.setEnvironment(await assets.builtinEnvironment('room'));
	scene.createDirectionalLight({ direction: [-0.4, -0.7, -0.6], color: '#fff4e6', intensity: 2 });
	scene.createPointLight({
		position: [3.5, 2.5, 3],
		color: '#9fc4ff',
		intensity: 30,
		range: 20,
	});

	const off = params.has('off');
	const none = params.has('none');
	const custom = params.has('custom');
	const layers = (options: StandardOptions): StandardOptions => {
		if (none) {
			const {
				clearcoat,
				clearcoatRoughness,
				clearcoatNormalScale,
				sheenColor,
				sheenRoughness,
				clearcoatMap,
				clearcoatRoughnessMap,
				clearcoatNormalMap,
				sheenColorMap,
				sheenRoughnessMap,
				...rest
			} = options;
			return rest;
		}
		return off ? { ...options, clearcoat: 0, sheenColor: '#000000' } : options;
	};
	const make = (options: StandardOptions) =>
		custom
			? materials.shader({ ...layers(options), wgsl: plain })
			: materials.standard(layers(options));

	const ball = geometry.sphere({ radius: 0.62, widthSegments: 48, heightSegments: 24 });
	const place = (k: number, row: number) =>
		[(k - 1.5) * 1.55, 0.62, -row * 1.6 + 1.4] as [number, number, number];

	// Car paint: a metallic red under coats from mirror to satin, and a half coat.
	const coats = [
		{ clearcoat: 1, clearcoatRoughness: 0 },
		{ clearcoat: 1, clearcoatRoughness: 0.25 },
		{ clearcoat: 1, clearcoatRoughness: 0.6 },
		{ clearcoat: 0.5, clearcoatRoughness: 0.05 },
	];
	coats.forEach((coat, k) => {
		const material = make({ color: '#a3131b', metalness: 0.5, roughness: 0.55, ...coat });
		scene.createMesh({ mesh: ball, material, position: place(k, 2) });
	});

	// Velvet: a dark cloth under sheens of rising roughness and two colors.
	const sheens = [
		{ sheenColor: '#ff9db0', sheenRoughness: 0.3 },
		{ sheenColor: '#ff9db0', sheenRoughness: 0.6 },
		{ sheenColor: '#ff9db0', sheenRoughness: 1 },
		{ sheenColor: '#8fd8ff', sheenRoughness: 0.5 },
	];
	sheens.forEach((sheen, k) => {
		const material = make({ color: '#3a0b19', metalness: 0, roughness: 0.9, ...sheen });
		scene.createMesh({ mesh: ball, material, position: place(k, 1) });
	});

	// The maps, which custom materials do not take.
	const options = { width: SIZE, height: SIZE, mipmaps: true, wrap: 'repeat' } as const;
	const coatTexels = texels((x, y) => [
		(x >> 3) % 2 === 0 ? 255 : 40,
		(y >> 3) % 2 === 0 ? 10 : 200,
		0,
		255,
	]);
	const ridges = texels((x) => {
		const slope = Math.cos(((x + 0.5) / SIZE) * Math.PI * 8) * 0.7;
		const length = Math.hypot(slope, 1);
		return [((slope / length) * 0.5 + 0.5) * 255, 128, ((1 / length) * 0.5 + 0.5) * 255, 255];
	});
	const sheenTexels = texels((x, y) =>
		((x >> 2) + (y >> 2)) % 2 === 0 ? [255, 210, 120, 80] : [120, 200, 255, 255],
	);
	const coatMap = textures.fromData({ ...options, data: coatTexels, colorSpace: 'linear' });
	const coatNormals = textures.fromData({ ...options, data: ridges, colorSpace: 'linear' });
	const sheenMap = textures.fromData({ ...options, data: sheenTexels, colorSpace: 'srgb' });
	const mapped: StandardOptions[] = [
		{
			color: '#1d4fbf',
			metalness: 0.6,
			roughness: 0.5,
			clearcoat: 1,
			clearcoatRoughness: 0.5,
			clearcoatMap: coatMap,
			clearcoatRoughnessMap: coatMap,
		},
		{
			color: '#d8d2c6',
			metalness: 0,
			roughness: 0.4,
			clearcoat: 1,
			clearcoatRoughness: 0.02,
			clearcoatNormalMap: coatNormals,
			clearcoatNormalScale: [1, 1],
		},
		{
			color: '#2a2440',
			metalness: 0,
			roughness: 0.9,
			sheenColor: '#ffffff',
			sheenRoughness: 1,
			sheenColorMap: sheenMap,
			sheenRoughnessMap: sheenMap,
		},
	];
	mapped.forEach((options, k) => {
		const material = materials.standard(layers(options));
		scene.createMesh({ mesh: ball, material, position: place(k, 0) });
	});
	const stone = materials.shader({
		color: '#8d8a84',
		metalness: 0,
		roughness: 0.85,
		wgsl: wetStone,
	});
	scene.createMesh({ mesh: ball, material: stone, position: place(3, 0) });

	scene.createMesh({
		mesh: geometry.box({ width: 9, height: 0.2, depth: 6 }),
		material: materials.standard({ color: '#5b5f66', roughness: 0.8 }),
		position: [0, -0.1, -0.2],
	});
	return {};
});
