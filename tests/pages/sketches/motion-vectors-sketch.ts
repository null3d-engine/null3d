// Motion vectors (decision record D-140), drawn by the motion debug view: each pixel's motion since
// the last frame as a color, its direction as the hue and its length as the brightness, full at 16
// pixels. Hold mode draws the frame before the held one too, so the held frame has a last frame one
// step of 1/60 s before it.
//
// Without a switch, the image test's scene: a camera that drifts sideways over a still ground, a
// box that slides, a box that spins, a dynamic batch of balls on a circle, a patch of grass whose
// custom material sways it with a vertex offset, a skinned tube that bends, a sphere whose morph
// weights change, and a masked pane with holes, which slides up.
//
// ?case= draws one exact case for the motion spec, from an orthographic camera that sees 20 pixels
// per meter on the image test's 320 x 180 pixels, looking down -z, with a still wall behind.
// tests/pages/lib/motion-vectors.ts holds the figures that the spec turns into pixels per frame:
//
// - slide: box A moves 24 m/s to the right (8 pixels a frame), box B 12 m/s down (4 pixels), and
//   box C stays still. With ?follow the camera moves with box A.
// - rows: the rows of a dynamic batch move 24 m/s to the right.
// - sway: a quad whose custom material's vertex offset moves it 6 m/s to the right with the frame's
//   time (2 pixels a frame), while the object itself stays still.
// - masked: a masked quad with a checker of holes moves 24 m/s to the right: its holes show the
//   still wall.
// - skin: a skinned tube bends to its left, its tip faster than its base, which stays still.
// - morph: a sphere whose lifting morph target grows fast: its top rises, and its lower half,
//   which the target leaves alone, stays still.
import { defineSketch } from '@null3d/engine';
import { animateObject, createAnimationRig, skinObject } from '@null3d/engine/internal';
import { morphMesh } from '../../../bench/scenes/morph';
import { CHAIN, characterMesh } from '../../../bench/scenes/skinning';
import { FAST, MOTION_HOLD, SLOW, SWAY, VIEW_HEIGHT } from '../lib/motion-vectors';

const params = new URL(import.meta.url).searchParams;
const CASE = params.get('case');
const FOLLOW = params.has('follow');

/**
 * A vertex offset that moves the mesh along x with the frame's time, from its rest at the held time.
 * The Vite plugin compiles tagged WGSL at build time, so the WGSL holds the hold time and the speed
 * as literals, and the check below keeps them equal to the figures that the spec reads.
 */
const SLIDING = /* wgsl */ `
fn vertexOffset(input: VertexInput) -> vec3f {
    return vec3f((frame.time - 0.5) * 6.0, 0.0, 0.0);
}
`;
if (MOTION_HOLD !== 0.5 || SWAY !== 6)
	throw new Error(
		'the sliding vertex offset holds the hold time and the speed as literals: update it',
	);

/** Grass that sways out of step, from each row's own phase. */
const SWAYING = /* wgsl */ `
fn vertexOffset(input: VertexInput) -> vec3f {
    let h = input.uv.y;
    let bend = sin(frame.time * 3.0 + object.values.x) * 0.25 * h * h;
    return vec3f(bend, 0.0, 0.3 * bend);
}
`;

/** A rig whose clip bends the tube to its left in one second, every joint turning at a steady speed. */
function bendRig(scene: Parameters<typeof createAnimationRig>[0]) {
	const times = [0, 1];
	return createAnimationRig(scene, {
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
				name: 'bend',
				tracks: CHAIN.map((_, j) => {
					const angle = j === 0 ? 0 : 0.6;
					const s = Math.sin(angle / 2);
					return {
						joint: j,
						channel: 'rotation' as const,
						interpolation: 'linear' as const,
						times,
						values: [0, 0, 0, 1, 0, 0, s, Math.cos(angle / 2)],
					};
				}),
			},
		],
	});
}

export default defineSketch(({ scene, materials, geometry, textures, debug, time }) => {
	debug.view('motion');
	scene.setBackground('#202020');
	scene.createDirectionalLight({ direction: [-0.4, -1, -0.6], intensity: 2.5 });
	scene.createAmbientLight({ intensity: 0.4 });
	const box = geometry.box({ width: 1, height: 1, depth: 1 });
	const plain = materials.standard({ color: '#c06040' });
	const checker = textures.fromData({
		width: 2,
		height: 2,
		data: Uint8Array.of(255, 255, 255, 255, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 255),
		filter: 'nearest',
		wrap: 'repeat',
	});
	const masked = materials.standard({ color: '#60a0e0', map: checker, alphaMode: 'mask' });
	// Where a dynamic object stands at the time `t`: its place at the held time, plus its velocity
	// times the time since.
	const at = (rest: readonly number[], velocity: readonly number[], t: number) =>
		rest.map((v, k) => v + (velocity[k] ?? 0) * (t - MOTION_HOLD)) as [number, number, number];
	const movers: {
		object: { setPosition(x: number, y: number, z: number): void };
		rest: number[];
		velocity: number[];
	}[] = [];
	const mover = (object: (typeof movers)[number]['object'], rest: number[], velocity: number[]) => {
		movers.push({ object, rest, velocity });
		object.setPosition(...at(rest, velocity, 0));
	};

	if (CASE !== null) {
		const camera = scene.createOrthographicCamera({
			height: VIEW_HEIGHT,
			near: 0.1,
			far: 50,
			position: [0, 0, 10],
			target: [0, 0, 0],
		});
		scene.setActiveCamera(camera);
		if (FOLLOW) mover(camera, [0, 0, 10], [FAST, 0, 0]);
		const still = materials.standard({ color: '#808080' });
		// A still wall behind every case, which shows the camera's motion.
		scene.createMesh({
			mesh: geometry.box({ width: 40, height: 20, depth: 0.1 }),
			material: still,
			position: [0, 0, -5],
		});
		if (CASE === 'slide') {
			mover(
				scene.createMesh({ mesh: box, material: plain, dynamic: true }),
				[-4, 2, 0],
				[FAST, 0, 0],
			);
			mover(
				scene.createMesh({ mesh: box, material: plain, dynamic: true }),
				[0, 2, 0],
				[0, -SLOW, 0],
			);
			scene.createMesh({ mesh: box, material: plain, position: [4, 2, 0] });
		} else if (CASE === 'rows') {
			const rows = scene.createInstances(box, 3, { material: plain, dynamic: true });
			return {
				onUpdate() {
					for (let row = 0; row < 3; row++)
						rows.positions.set(at([-4 + 3 * row, 0, 0], [FAST, 0, 0], time.now), row * 3);
				},
			};
		} else if (CASE === 'sway') {
			scene.createMesh({
				mesh: geometry.plane({ width: 2, height: 2 }),
				material: materials.shader({ wgsl: SLIDING, color: '#40c060', doubleSided: true }),
				position: [0, 0, 0],
			});
		} else if (CASE === 'masked') {
			const pane = scene.createMesh({
				mesh: geometry.plane({ width: 4, height: 4 }),
				material: masked,
				dynamic: true,
			});
			mover(pane, [0, 0, 0], [FAST, 0, 0]);
		} else if (CASE === 'skin') {
			const tube = scene.createMesh({
				mesh: geometry.fromArrays(characterMesh()),
				material: plain,
				position: [0, -4.4, 0],
				scale: [3, 3, 3],
			});
			const animator = animateObject(tube, bendRig(scene));
			skinObject(tube, animator);
			animator.play('bend');
		} else if (CASE === 'morph') {
			const { positions, normals, indices, positionDeltas, normalDeltas } = morphMesh();
			const sphere = scene.createMesh({
				mesh: geometry.fromArrays({
					positions,
					normals,
					indices,
					morphTargets: { positions: positionDeltas, normals: normalDeltas },
				}),
				material: plain,
				scale: [2, 2, 2],
			});
			return {
				onUpdate() {
					sphere.setMorphWeight(0, 0.5 + 8 * (time.now - MOTION_HOLD));
				},
			};
		}
		return {
			onUpdate() {
				for (const { object, rest, velocity } of movers)
					object.setPosition(...at(rest, velocity, time.now));
			},
		};
	}

	// The image test's scene.
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		near: 0.1,
		far: 60,
		position: [0, 3, 9],
		target: [0, 0.8, 0],
	});
	scene.setActiveCamera(camera);
	scene.createMesh({
		mesh: geometry.box({ width: 30, height: 0.1, depth: 30 }),
		material: materials.standard({ color: '#707880' }),
		position: [0, -0.05, 0],
	});
	mover(scene.createMesh({ mesh: box, material: plain, dynamic: true }), [-3.2, 0.5, 1], [4, 0, 0]);
	const spinner = scene.createMesh({
		mesh: box,
		material: plain,
		position: [-1.2, 0.6, -1],
		dynamic: true,
	});
	const balls = scene.createInstances(geometry.sphere({ radius: 0.2 }), 8, {
		material: materials.standard({ color: '#e0c040' }),
		dynamic: true,
	});
	const blade = geometry.plane({ width: 0.06, height: 0.7, heightSegments: 4 });
	const grass = scene.createInstances(blade, 120, {
		material: materials.shader({ wgsl: SWAYING, color: '#50a040', doubleSided: true }),
		values: true,
	});
	const values = grass.values;
	if (!values) throw new Error('a batch with values has values');
	for (let row = 0; row < 120; row++) {
		grass.positions.set(
			[2.2 + (row % 12) * 0.12, 0.35, -1.6 + Math.floor(row / 12) * 0.12],
			row * 3,
		);
		values.set([row * 0.7, 0, 0, 0], row * 4);
	}
	grass.markDirty();
	const tube = scene.createMesh({
		mesh: geometry.fromArrays(characterMesh()),
		material: materials.standard({ color: '#f2c14e' }),
		position: [0.6, 0, -0.5],
		scale: [0.6, 0.6, 0.6],
	});
	const animator = animateObject(tube, bendRig(scene));
	skinObject(tube, animator);
	animator.play('bend');
	const { positions, normals, indices, positionDeltas, normalDeltas } = morphMesh();
	const sphere = scene.createMesh({
		mesh: geometry.fromArrays({
			positions,
			normals,
			indices,
			morphTargets: { positions: positionDeltas, normals: normalDeltas },
		}),
		material: materials.standard({ color: '#4a8cff' }),
		position: [-2.6, 0.9, -2],
		scale: [0.6, 0.6, 0.6],
	});
	const pane = scene.createMesh({
		mesh: geometry.plane({ width: 1.2, height: 1.2 }),
		material: masked,
		dynamic: true,
	});
	mover(pane, [3, 1.4, 0.5], [0, 1.5, 0]);
	mover(camera, [0, 3, 9], [0.8, 0, 0]);
	return {
		onUpdate() {
			const t = time.now;
			for (const { object, rest, velocity } of movers) object.setPosition(...at(rest, velocity, t));
			spinner.setRotationEuler(0, t * 2, 0);
			for (let row = 0; row < 8; row++) {
				const a = (row / 8) * Math.PI * 2 + t * 1.5;
				balls.positions.set([0.8 + Math.cos(a) * 1.2, 0.3, 1.8 + Math.sin(a) * 0.6], row * 3);
			}
			sphere.setMorphWeight(0, 0.5 + 0.5 * Math.sin(t * 3));
		},
	};
});
