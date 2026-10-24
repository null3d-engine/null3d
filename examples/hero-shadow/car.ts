// The car on the pad: a body, a glass cabin, a roof and four wheels, which cast and receive
// shadows together. The body is the hero that the sun fits its own shadow tile to. A light names an
// object that carries bounds, and a group carries none, so the body's sphere is widened to hold the
// whole car, since the tile's box reaches from it.
import type { Group, Mesh, MeshOptions, SketchContext } from '@null3d/engine';

/** Where each wheel stands, in the car's own space. */
const WHEELS = [
	[-0.86, 1.3],
	[0.86, 1.3],
	[-0.86, -1.35],
	[0.86, -1.35],
] as const;

/**
 * Builds the car, and returns the body that the sun's hero shadow fits. A caller that gives
 * `parent` moves the whole car by moving that group.
 */
export function car(
	ctx: SketchContext,
	parent: Group = ctx.scene.createGroup({ position: [0, 0, 0] }),
): Mesh {
	const { scene, geometry, materials } = ctx;
	const paint = materials.standard({ color: '#c8452f', roughness: 0.35, metalness: 0.4 });
	const on = (options: MeshOptions) =>
		scene.createMesh({
			...options,
			parent,
			castShadows: true,
			receiveShadows: true,
		});
	const body = on({
		mesh: geometry.box({ width: 1.8, height: 0.55, depth: 4.1 }),
		material: paint,
		position: [0, 0.62, 0],
	});
	body.setBounds([0, 0.75, 0], 2.2);
	on({
		mesh: geometry.box({ width: 1.5, height: 0.5, depth: 2.1 }),
		material: materials.standard({ color: '#20262e', roughness: 0.1, metalness: 0.6 }),
		position: [0, 1.15, -0.25],
	});
	on({
		mesh: geometry.box({ width: 1.62, height: 0.1, depth: 2.0 }),
		material: paint,
		position: [0, 1.42, -0.3],
	});
	const rubber = materials.standard({ color: '#1b1b1d', roughness: 0.8 });
	for (const [x, z] of WHEELS) {
		const wheel = on({
			mesh: geometry.cylinder({
				radiusTop: 0.34,
				radiusBottom: 0.34,
				height: 0.24,
				radialSegments: 24,
			}),
			material: rubber,
			position: [x, 0.34, z],
		});
		// The cylinder stands on its Y axis, so a quarter turn lays it on its side.
		wheel.setRotationEuler(0, 0, Math.PI / 2);
	}
	return body;
}
