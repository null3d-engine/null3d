// The decals demo's walker: a jointed figure built from capsules, a box and a sphere, whose hips,
// knees, shoulders and elbows swing in a walk cycle. Every part sits on the layers it is given, so
// the demo can keep decals off the whole figure.
import type { Group, Object3D, SketchContext } from '@null3d/engine';

/** How far the figure moves along its path per stride, which sets the cycle's pace. */
const STRIDE = 1.4;

/** A walker that `update` moves to a point on the ground, facing along its heading. */
export interface Walker {
	update(x: number, z: number): void;
}

/** Builds the walker on `layers`, standing at the origin. */
export function createWalker(
	{ scene, geometry, materials }: SketchContext,
	layers: number,
): Walker {
	const look = { layers, dynamic: true, castShadows: true, receiveShadows: true };
	const coat = materials.standard({ color: '#2f5d8f', roughness: 0.7 });
	const trousers = materials.standard({ color: '#2b2b31', roughness: 0.8 });
	const skin = materials.standard({ color: '#d9a882', roughness: 0.6 });
	const boots = materials.standard({ color: '#3a2618', roughness: 0.5 });
	const root = scene.createGroup({ dynamic: true, layers });
	const joint = (parent: Object3D, position: [number, number, number]): Group =>
		scene.createGroup({ parent, position, dynamic: true, layers });
	/** A limb segment that hangs from its joint: a capsule of `length` with its top at the joint. */
	const segment = (parent: Group, length: number, radius: number, material = trousers) =>
		scene.createMesh({
			...look,
			parent,
			mesh: geometry.capsule({ radius, height: length - 2 * radius }),
			material,
			position: [0, -length / 2, 0],
		});

	const hips = joint(root, [0, 0.95, 0]);
	scene.createMesh({
		...look,
		parent: hips,
		mesh: geometry.box({ width: 0.42, height: 0.6, depth: 0.24 }),
		material: coat,
		position: [0, 0.33, 0],
	});
	scene.createMesh({
		...look,
		parent: hips,
		mesh: geometry.sphere({ radius: 0.13 }),
		material: skin,
		position: [0, 0.8, 0],
	});
	const legs = [-1, 1].map((side) => {
		const hip = joint(hips, [side * 0.11, 0, 0]);
		segment(hip, 0.48, 0.08);
		const knee = joint(hip, [0, -0.46, 0]);
		segment(knee, 0.46, 0.07);
		scene.createMesh({
			...look,
			parent: knee,
			mesh: geometry.box({ width: 0.12, height: 0.08, depth: 0.24 }),
			material: boots,
			position: [0, -0.46, 0.05],
		});
		return { hip, knee };
	});
	const arms = [-1, 1].map((side) => {
		const shoulder = joint(hips, [side * 0.27, 0.58, 0]);
		segment(shoulder, 0.32, 0.06, coat);
		const elbow = joint(shoulder, [0, -0.3, 0]);
		segment(elbow, 0.3, 0.05, skin);
		return { shoulder, elbow };
	});

	let phase = 0;
	let lastX = 0;
	let lastZ = 0;
	return {
		update(x, z) {
			const moved = Math.hypot(x - lastX, z - lastZ);
			if (moved > 1e-5) root.setRotationEuler(0, Math.atan2(x - lastX, z - lastZ), 0);
			phase += (moved / STRIDE) * Math.PI * 2;
			lastX = x;
			lastZ = z;
			// The hips bob twice per stride, at the top of each step.
			root.setPosition(x, Math.abs(Math.cos(phase)) * 0.04 - 0.02, z);
			for (let k = 0; k < 2; k++) {
				const step = phase + k * Math.PI;
				const { hip, knee } = legs[k] as (typeof legs)[number];
				const { shoulder, elbow } = arms[k] as (typeof arms)[number];
				hip.setRotationEuler(Math.sin(step) * 0.45, 0, 0);
				// The knee bends while its leg swings forward.
				knee.setRotationEuler(Math.max(0, -Math.cos(step)) * 0.7, 0, 0);
				shoulder.setRotationEuler(-Math.sin(step) * 0.4, 0, 0);
				elbow.setRotationEuler(-0.3, 0, 0);
			}
		},
	};
}
