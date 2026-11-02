// The garden's stone lantern, built from the engine's shapes rather than from splats. A lantern is
// an architectural object, so a mesh keeps its edges and its warm firebox at every preset, while the
// cloud around it keeps the soft detail that a scan carries. The splats fade where they meet it,
// through the add-on's depth mix, so the two read as one scene. Its maps are made in code from
// seeded noise, and a small lamp light warms the moss that the mesh ground wears below it.
import type { MeshGeometry, Object3D, SketchContext } from '@null3d/engine';
import { Noise, textureSet } from '../../lib/procedural';
import { gardenHeight, LANTERN, LANTERN_SCALE } from './cloud';

/** The lantern's parts, in meters, scaled to the garden's lantern. */
const S = LANTERN_SCALE;
/** The base's height at the lantern's place. */
const BASE = gardenHeight(LANTERN.x, LANTERN.z);

/** Weathers the stone: grain, pores and patches of paler lichen. */
function stoneMaps(ctx: SketchContext) {
	const noise = new Noise(23);
	return textureSet(ctx.textures, 128, (u, v, out) => {
		const grain = noise.fbm2(u * 9, v * 9, 3);
		const pores = noise.fbm2(u * 31 + 5, v * 31 - 2, 2);
		const lichen = Math.max(0, noise.fbm2(u * 3.4 - 7, v * 3.4 + 3, 2));
		const shade = 0.34 + grain * 0.14 + (pores > 0.32 ? -0.09 : 0) + lichen * 0.12;
		out.r = shade * 1.02;
		out.g = shade * 0.98;
		out.b = shade * 0.9;
		out.height = grain * 0.5 + pores * 0.5;
		out.roughness = 0.78 + pores * 0.16;
		out.occlusion = 0.82 + grain * 0.18;
	});
}

/** Adds one part of the lantern, at a height above its base, turned by `yaw`. */
function part(
	ctx: SketchContext,
	mesh: MeshGeometry,
	rock: ReturnType<SketchContext['materials']['standard']>,
	y: number,
	yaw = 0,
): Object3D {
	return ctx.scene.createMesh({
		mesh,
		material: rock,
		position: [LANTERN.x, BASE + y, LANTERN.z],
		rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
		castShadows: false,
		receiveShadows: false,
	});
}

/**
 * Builds the lantern at the garden's lantern place, and returns the finial that a label hangs from.
 */
export function createLantern(ctx: SketchContext): Object3D {
	const { geometry, materials, scene } = ctx;
	const maps = stoneMaps(ctx);
	const rock = materials.standard({ ...maps, roughness: 1 });
	const glow = materials.standard({
		color: '#2a1608',
		emissive: '#ff9a3c',
		emissiveIntensity: 2.4,
		roughness: 1,
	});
	part(ctx, geometry.box({ width: 0.7 * S, height: 0.16 * S, depth: 0.7 * S }), rock, 0.08 * S);
	part(ctx, geometry.box({ width: 0.52 * S, height: 0.08 * S, depth: 0.52 * S }), rock, 0.2 * S);
	part(
		ctx,
		geometry.cylinder({
			radiusTop: 0.09 * S,
			radiusBottom: 0.11 * S,
			height: 0.5 * S,
			radialSegments: 24,
		}),
		rock,
		0.5 * S,
	);
	part(ctx, geometry.box({ width: 0.5 * S, height: 0.08 * S, depth: 0.5 * S }), rock, 0.79 * S);
	part(ctx, geometry.box({ width: 0.5 * S, height: 0.06 * S, depth: 0.5 * S }), rock, 0.86 * S);
	part(ctx, geometry.box({ width: 0.54 * S, height: 0.06 * S, depth: 0.54 * S }), rock, 1.25 * S);
	// The firebox stands on four posts, so its light shows from every side.
	const corners: readonly (readonly [number, number])[] = [
		[0.215, 0.215],
		[0.215, -0.215],
		[-0.215, 0.215],
		[-0.215, -0.215],
	];
	for (const [x, z] of corners)
		scene.createMesh({
			mesh: geometry.box({ width: 0.07 * S, height: 0.36 * S, depth: 0.07 * S }),
			material: rock,
			position: [LANTERN.x + x * S, BASE + 1.055 * S, LANTERN.z + z * S],
			castShadows: false,
			receiveShadows: false,
		});
	part(
		ctx,
		geometry.sphere({ radius: 0.1 * S, widthSegments: 14, heightSegments: 8 }),
		glow,
		1.055 * S,
	);
	part(
		ctx,
		geometry.cylinder({
			radiusTop: 0.12 * S,
			radiusBottom: 0.74 * S,
			height: 0.3 * S,
			radialSegments: 4,
		}),
		rock,
		1.42 * S,
		Math.PI / 4,
	);
	// The lamp's own light, which falls on the stone and the moss around the base.
	scene.createPointLight({
		position: [LANTERN.x, BASE + 1.05 * S, LANTERN.z],
		color: '#ffb066',
		intensity: 2.5,
		range: 4,
	});
	return part(
		ctx,
		geometry.sphere({ radius: 0.1 * S, widthSegments: 16, heightSegments: 10 }),
		rock,
		1.62 * S,
	);
}
