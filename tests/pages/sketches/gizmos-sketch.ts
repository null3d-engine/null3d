// The sketch of the gizmo tests: one block, lit plainly, with translate, rotate and scale handles
// attached to it. The page asks it for the block's pose and for where each handle shows on the
// canvas, and it sets a mode or a space on request, so that a test drags the handles where they
// really are.
import { createTransformControls, type GizmoMode, type GizmoSpace } from '@null3d/controls';
import { defineSketch, mat4, type Object3D, quat, type RaycastHit, vec3 } from '@null3d/engine';

/** A point on a turn ring's tube, at a diagonal, in the ring's own space: only that ring holds it. */
const RING_REACH = 0.55 * Math.SQRT1_2;
/** The same point on the outer ring, which stands further out than the three axis rings. */
const OUTER_REACH = 0.7 * Math.SQRT1_2;
/** A point along an axis handle's arm, in the handle's own space, clear of the planes at the centre. */
const ARM_REACH = 0.4;
/** The layer that the handles answer a raycast on, which the test sketch probes itself. */
const PICK_LAYERS = 1 << 20;

/** The handles of each mode, which the page can ask about. */
const AXES: Record<GizmoMode, string[]> = {
	translate: ['X', 'Y', 'Z', 'XY', 'YZ', 'XZ', 'XYZ'],
	rotate: ['X', 'Y', 'Z', 'E'],
	scale: ['X', 'Y', 'Z', 'XYZ'],
};

export default defineSketch((ctx) => {
	const { scene, geometry, materials, page, time } = ctx;
	scene.setBackground('#10141a');
	scene.createAmbientLight({ intensity: 0.7 });
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 1.4 });
	const camera = scene.createPerspectiveCamera({ fov: 50, position: [0, 2.2, 6] });
	camera.lookAt(0, 0.6, 0);
	scene.setActiveCamera(camera);
	const block = scene.createMesh({
		name: 'block',
		mesh: geometry.box({ width: 0.8, height: 0.8, depth: 0.8 }),
		material: materials.standard({ color: '#8a94a6' }),
		position: [0, 0.6, 0],
		dynamic: true,
	});
	const gizmo = createTransformControls(ctx, camera, { pickLayers: PICK_LAYERS });
	gizmo.attach(block);

	/** Scratch arrays: made once, used in every answer. */
	const position = vec3.create();
	const rotation = quat.create();
	const scale = vec3.create();
	const matrix = mat4.create();
	const point = vec3.create();
	const screen = vec3.create();
	const ray = { origin: vec3.create(), direction: vec3.create() };
	const hit: RaycastHit = {
		object: null,
		instance: -1,
		point: vec3.create(),
		normal: vec3.create(),
		distance: 0,
		triangle: -1,
	};
	const pickOptions = { layers: PICK_LAYERS };

	const report = () => {
		block.getPosition(position);
		block.getRotation(rotation);
		// The block is a root object, so its world scale is its own scale.
		block.getWorldMatrix(matrix);
		mat4.decompose(point, rotation, scale, matrix);
		page.post('pose', {
			position: [...position],
			rotation: [...rotation],
			scale: [...scale],
			mode: gizmo.mode,
			axis: gizmo.axis,
			dragging: gizmo.dragging,
			time: time.now,
		});
	};

	const handles = () => {
		// Where each handle shows, and what a press there would take hold of.
		const points: Record<string, number[]> = {};
		const takes: Record<string, string> = {};
		for (const axis of AXES[gizmo.mode]) {
			const handle = scene.find(`${gizmo.mode} ${axis}`);
			if (!handle) continue;
			handle.getWorldMatrix(matrix);
			// A single axis handle reaches out along its own Y axis, past the planes at the centre.
			const local =
				gizmo.mode === 'rotate'
					? [axis === 'E' ? OUTER_REACH : RING_REACH, axis === 'E' ? OUTER_REACH : RING_REACH, 0]
					: axis.length === 1
						? [0, ARM_REACH, 0]
						: [0, 0, 0];
			vec3.transformMat4(point, local, matrix);
			camera.worldToScreen(point, screen);
			points[axis] = [screen[0] as number, screen[1] as number];
			camera.screenToRay(screen[0] as number, screen[1] as number, ray);
			const met = scene.raycast(ray.origin, ray.direction, pickOptions, hit);
			// The pickers are meshes, so a hit on a batch names no handle.
			const taken = met ? (hit.object as Object3D | null) : null;
			takes[axis] = taken?.name ?? '';
		}
		page.post('handles', { points, takes });
	};

	page.onMessage((type, data) => {
		if (type === 'pose') report();
		else if (type === 'handles') handles();
		else if (type === 'mode') {
			gizmo.setMode(data as GizmoMode);
			page.post('mode', gizmo.mode);
		} else if (type === 'space') {
			gizmo.setSpace(data as GizmoSpace);
			page.post('space', gizmo.space);
		}
	});

	return {
		onUpdate(dt) {
			gizmo.update(dt);
		},
	};
});
