// The quality governor's stress test (lib/governor.ts): the shadow scene of the image tests, whose
// sun casts shadows in three cascades, at the test's shadow settings. A plane right in front of the
// camera runs a loop of `work` steps for each of its pixels, so the GPU's work follows the pixels
// that the scene draws. On the page's 'load' message the sketch spins its thread for `spinMs` in
// each frame and sets the plane's loop, showing the plane only with a loop. On 'governor' it turns
// the governor on or off. It registers a budget for a system of its own, which the governor
// scales too. It posts the governor's state at the start, and after each step: the render scale,
// the budget's scale, the steps past the render scale, the far cascades' interval and the shadow
// filter. ?min= sets the lowest render scale in percent.
import { defineSketch, type Material, type MeshGeometry } from '@null3d/engine';
import {
	SHADOW_CAMERA,
	SHADOW_MESHES,
	SHADOW_OBJECTS,
	SHADOW_SUN,
	type ShadowMeshName,
} from '../../../bench/scenes/shadows';
import { GOVERNOR } from '../lib/governor';

const params = new URL(import.meta.url).searchParams;
/** The lowest render scale, from the sketch module's ?min switch in percent: a dot in it would read as a file type. */
const MIN_SCALE = Number(params.get('min') ?? GOVERNOR.walkMinScale * 100) / 100;

/** A surface whose color takes a loop of `work` steps of noise, which the compiler cannot skip. */
const heavy = /* wgsl */ `
struct Uniforms {
    work: u32,
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    var v = input.uv.x + input.uv.y;
    for (var i = 0u; i < material.work; i++) {
        v = fract(sin(v * 12.9898 + f32(i) * 0.37) * 43758.5453);
    }
    s.baseColor = s.baseColor * (0.9 + 0.1 * v);
    return s;
}
`;

export default defineSketch(({ scene, materials, geometry, quality, page }) => {
	quality.set({
		minRenderScale: MIN_SCALE,
		maxRenderScale: 1,
		shadowFilter: GOVERNOR.shadowFilter as 3 | 5,
		farCascadeInterval: GOVERNOR.farCascadeInterval,
		governor: true,
	});
	scene.setBackground('#a8c0d8');
	const { fov, position, target, near, far } = SHADOW_CAMERA;
	scene.setActiveCamera(scene.createPerspectiveCamera({ fov, position, target, near, far }));
	const { direction, color, intensity, mapSize, distance } = SHADOW_SUN;
	scene.createDirectionalLight({
		direction,
		color,
		intensity,
		castShadows: true,
		shadow: { cascades: GOVERNOR.cascades, mapSize, distance },
	});
	scene.createAmbientLight({ intensity: 0.4 });
	const meshes = new Map<ShadowMeshName, MeshGeometry>();
	const looks = new Map<string, Material>();
	for (const object of SHADOW_OBJECTS) {
		const shape: { size?: readonly number[]; radius?: number } = SHADOW_MESHES[object.mesh];
		const [width, height, depth] = shape.size ?? [];
		const mesh =
			meshes.get(object.mesh) ??
			(shape.radius !== undefined
				? geometry.sphere({ radius: shape.radius })
				: geometry.box({ width, height, depth }));
		meshes.set(object.mesh, mesh);
		const key = `${object.color} ${object.lit}`;
		const look =
			looks.get(key) ??
			(object.lit
				? materials.standard({ color: object.color })
				: materials.unlit({ color: object.color }));
		looks.set(key, look);
		scene.createMesh({
			mesh,
			material: look,
			position: object.position,
			castShadows: object.cast,
			receiveShadows: object.receive,
		});
	}

	// The plane half a meter in front of the camera, turned to face it, far wider than the view.
	const view = [0, 1, 2].map((k) => (target[k] as number) - (position[k] as number));
	const length = Math.hypot(view[0] as number, view[1] as number, view[2] as number);
	const pitch = Math.asin((view[1] as number) / length);
	const load = materials.shader({ wgsl: heavy, color: '#d0d0d0', uniforms: { work: 0 } });
	const plane = scene.createMesh({
		mesh: geometry.box({ width: 4, height: 4, depth: 0.01 }),
		material: load,
		position: [0, 1, 2].map(
			(k) => (position[k] as number) + ((view[k] as number) / length) * 0.5,
		) as [number, number, number],
		rotation: [Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2)],
		castShadows: false,
		receiveShadows: false,
	});
	plane.setVisible(false);

	let spinMs = 0;
	page.onMessage((name, data) => {
		if (name === 'load') {
			const next = data as { spinMs: number; work: number };
			spinMs = next.spinMs;
			load.set({ work: next.work });
			plane.setVisible(next.work > 0);
			page.post('loaded', null);
		} else if (name === 'governor') quality.set({ governor: data as boolean });
	});

	let budgetScale = 1;
	const post = () => {
		const { governor } = quality;
		page.post('governor-state', [
			quality.renderScale,
			budgetScale,
			governor.steps,
			governor.farCascadeInterval,
			governor.shadowFilter,
		]);
	};
	let scale = quality.renderScale;
	quality.onChange(post);
	// The spin stays as it is at every scale of the budget, so the load still takes every step.
	quality.setBudget({
		name: 'walk',
		ms: 1,
		min: GOVERNOR.budgetMin,
		onScale: (next) => {
			budgetScale = next;
			post();
		},
	});
	let spins = 0;
	return {
		onUpdate() {
			if (quality.renderScale !== scale) {
				scale = quality.renderScale;
				post();
			}
			const end = performance.now() + spinMs;
			while (performance.now() < end) spins++;
		},
		onLateUpdate() {
			// Keeps the spin's count alive, so the loop cannot be dropped.
			if (spins < 0) post();
		},
	};
});
