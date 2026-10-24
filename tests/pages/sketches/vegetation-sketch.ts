// One vegetation species' variants, in hold mode: each variant is grown from the add-on's species
// record and a fixed seed, then drawn with a plain bark material and a plain leaf material. The
// cards carry no leaf atlas yet, so the crown's shape, its branches and its card placement are what
// the picture shows. The camera and the seed are fixed, so every GPU path draws the same frame.
import { defineSketch } from '@null3d/engine';
import { ALL_SPECIES, builtInSpecies, generateVariantSet } from '@null3d/vegetation';

const params = new URL(import.meta.url).searchParams;
const SPECIES = builtInSpecies(params.get('species') ?? 'broadleaf') ?? ALL_SPECIES[0];
const VARIANTS = Math.max(1, Math.min(6, Number(params.get('variants') ?? 3)));

/** The quaternion that lays a plane, which faces +Z, flat on the ground. */
const FLAT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;

export default defineSketch((ctx) => {
	if (!SPECIES) return {};
	const { scene } = ctx;
	scene.setBackground('#9fc0dd');
	scene.createDirectionalLight({ direction: [-0.45, -1, -0.3], intensity: 2.8 });
	scene.createAmbientLight({ intensity: 0.45 });

	const variantAssets = generateVariantSet(SPECIES, { seed: 12, variants: VARIANTS });
	const widest = Math.max(
		...variantAssets.map((asset) => Math.max(asset.crown.max[0] - asset.crown.min[0], 1)),
	);
	const tallest = Math.max(...variantAssets.map((asset) => asset.crown.max[1]));
	const spacing = widest * 1.5 + 0.5;
	const across = spacing * (VARIANTS - 1);

	const bark = ctx.materials.standard({
		color: SPECIES.color.bark as [number, number, number],
		roughness: 0.9,
		metalness: 0,
	});
	const leaves = ctx.materials.standard({
		color: SPECIES.color.leaf as [number, number, number],
		roughness: 0.75,
		metalness: 0,
		doubleSided: true,
	});

	const ground = ctx.materials.standard({ color: '#4a5137', roughness: 1, metalness: 0 });
	scene.createMesh({
		mesh: ctx.geometry.plane({ width: Math.max(60, across * 4), height: Math.max(60, across * 4) }),
		material: ground,
		rotation: FLAT as unknown as [number, number, number, number],
		receiveShadows: false,
	});

	variantAssets.forEach((asset, index) => {
		const x = index * spacing - across / 2;
		for (const part of asset.levels[0]?.parts ?? []) {
			scene.createMesh({
				mesh: ctx.geometry.fromArrays(part.arrays),
				material: part.name === 'wood' ? bark : leaves,
				position: [x, 0, 0],
			});
		}
	});

	const distance = Math.max(across * 1.15, tallest * 1.8) + 2;
	const camera = scene.createPerspectiveCamera({
		fov: 42,
		near: 0.1,
		far: 400,
		position: [distance * 0.62, tallest * 0.85, distance],
		target: [0, tallest * 0.42, 0],
	});
	scene.setActiveCamera(camera);
	return {};
});
