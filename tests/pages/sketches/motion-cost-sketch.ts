// The motion vectors' cost scene (decision record D-140): what the motion pass draws in a busy
// frame. A camera drifts over a field of 4,096 grass blades that a custom material sways, 1,024
// boxes of a dynamic batch that circle, 1,024 still boxes, and 16 skinned characters that the
// skinning pass skins on WebGPU. On the page's 'motion' message the sketch shows the motion debug
// view, waits a second for its pipelines, and posts 'settled'. 'motion-off' shows the lit view.
// The cost is the motion pass with its culling and copies, plus the debug view's full-screen step.
//
// ?scale= draws at that render scale, with the governor off.
import { defineSketch } from '@null3d/engine';
import { animateObject, createAnimationRig, skinObject } from '@null3d/engine/internal';
import {
	CHAIN,
	CLIP,
	characterMesh,
	KEY_TIMES,
	rotationKeys,
} from '../../../bench/scenes/skinning';

const params = new URL(import.meta.url).searchParams;
const SCALE = Number(params.get('scale') ?? 1);

/** Blades that sway out of step, from each row's own phase. */
const SWAYING = /* wgsl */ `
fn vertexOffset(input: VertexInput) -> vec3f {
    let h = input.uv.y;
    let bend = sin(frame.time * 2.5 + object.values.x) * 0.2 * h * h;
    return vec3f(bend, 0.0, 0.4 * bend);
}
`;

const GRASS_SIDE = 64;
const MOVERS = 1024;
const STILL_SIDE = 32;
const CHARACTERS = 16;

export default defineSketch(({ scene, materials, geometry, quality, time, page, debug }) => {
	quality.set({ minRenderScale: SCALE, maxRenderScale: SCALE, governor: false });
	scene.setBackground('#8fb3d9');
	scene.createDirectionalLight({ direction: [-0.5, -1, -0.4], intensity: 2.5 });
	scene.createAmbientLight({ intensity: 0.4 });
	const camera = scene.createPerspectiveCamera({
		fov: 55,
		near: 0.1,
		far: 120,
		position: [0, 6, 22],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createMesh({
		mesh: geometry.box({ width: 80, height: 0.1, depth: 80 }),
		material: materials.standard({ color: '#6f7d5c' }),
		position: [0, -0.05, 0],
	});

	const blade = geometry.plane({ width: 0.08, height: 0.9, heightSegments: 4 });
	const grass = scene.createInstances(blade, GRASS_SIDE * GRASS_SIDE, {
		material: materials.shader({ wgsl: SWAYING, color: '#4f9a3c', doubleSided: true }),
		values: true,
	});
	const values = grass.values;
	if (!values) throw new Error('a batch with values has values');
	for (let row = 0; row < GRASS_SIDE * GRASS_SIDE; row++) {
		const x = (row % GRASS_SIDE) * 0.25 - 8;
		const z = Math.floor(row / GRASS_SIDE) * 0.25 - 8;
		grass.positions.set([x, 0.45, z], row * 3);
		values.set([row * 0.37, 0, 0, 0], row * 4);
	}
	grass.markDirty();

	const box = geometry.box({ width: 0.4, height: 0.4, depth: 0.4 });
	const movers = scene.createInstances(box, MOVERS, {
		material: materials.standard({ color: '#d0603c' }),
		dynamic: true,
	});
	const still = scene.createInstances(box, STILL_SIDE * STILL_SIDE, {
		material: materials.standard({ color: '#9aa0a8' }),
	});
	for (let row = 0; row < STILL_SIDE * STILL_SIDE; row++)
		still.positions.set(
			[(row % STILL_SIDE) * 1.2 - 19, 0.2, -12 - Math.floor(row / STILL_SIDE) * 1.2],
			row * 3,
		);
	still.markDirty();

	const rig = createAnimationRig(scene, {
		joints: CHAIN.map((joint, j) => ({
			name: `joint${j}`,
			parent: joint.parent,
			translation: [...joint.translation],
			rotation: [0, 0, 0, 1],
			scale: [1, 1, 1],
			inverseBind: [...joint.inverseBind],
		})),
		clips: [
			{
				name: CLIP,
				tracks: CHAIN.map((_, j) => ({
					joint: j,
					channel: 'rotation' as const,
					interpolation: 'linear' as const,
					times: KEY_TIMES,
					values: rotationKeys(j),
				})),
			},
		],
	});
	const character = geometry.fromArrays(characterMesh());
	const skin = materials.standard({ color: '#f2c14e' });
	for (let k = 0; k < CHARACTERS; k++) {
		const object = scene.createMesh({
			mesh: character,
			material: skin,
			position: [(k % 8) * 2.2 - 7.7, 0, 9 + Math.floor(k / 8) * 2.5],
		});
		const animator = animateObject(object, rig);
		skinObject(object, animator);
		animator.play(CLIP, { speed: 1 + k * 0.05 });
	}

	let settleAt = -1;
	page.onMessage((message) => {
		if (message === 'motion-off') debug.view('lit');
		if (message !== 'motion') return;
		debug.view('motion');
		settleAt = time.now + 1;
	});
	return {
		onUpdate() {
			const t = time.now;
			camera.setPosition(Math.sin(t * 0.3) * 4, 6, 22);
			for (let row = 0; row < MOVERS; row++) {
				const a = (row / MOVERS) * Math.PI * 2 + t * 0.8;
				const r = 4 + (row % 8) * 0.6;
				movers.positions.set([Math.cos(a) * r, 0.2 + (row % 4) * 0.5, Math.sin(a) * r], row * 3);
			}
			if (settleAt >= 0 && t >= settleAt) {
				settleAt = -1;
				page.post('settled', null);
			}
		},
	};
});
