// Animated characters for the allocation check: generated characters that play clips through the
// engine's animator, with a masked layer, an additive layer and event handlers. Each frame, the
// sketch moves one layer's weight of every character, and now and then a character cross-fades to
// another clip, as a game's code does. Each character is a skinned mesh, a small box on each joint,
// so the check covers the upload of the skinning matrices and the skinned draws on both GPU paths.
// The engine cannot load animated models yet, so the characters come from the engine's internal
// rig call.
import type { Animator, SketchContext } from '@null3d/engine';
import { animateObject, createAnimationRig, skinObject } from '@null3d/engine/internal';
import { crowdCharacter } from '../../../tests/pages/lib/animation';
import { CROWD_CLIPS, crowdRig } from '../../../tests/pages/lib/crowd-rig';

/** Joints per character, as S5's characters have 30 to 60. */
const JOINTS = 40;
/** Frames between two cross-fades of one character. */
const FADE_EVERY = 120;
/** Half the side of the box on each joint, in meters. */
const BOX = 0.05;
/** Characters per row of the crowd, and the space between two characters, in meters. */
const ROW = 8;
const SPACING = 1.5;

/**
 * A character's mesh: a box on each joint, at the joint's height at rest, which that joint alone
 * moves.
 */
function crowdMesh(joints: number) {
	const { inverseBind } = crowdCharacter(joints);
	const positions: number[] = [];
	const normals: number[] = [];
	const jointIds: number[] = [];
	const indices: number[] = [];
	for (let j = 0; j < joints; j++) {
		const y = -(inverseBind[j * 12 + 7] ?? 0);
		// Each face: its normal axis and sign, with four corners around it.
		for (const [axis, sign] of [0, 1, 2].flatMap((a) => [[a, 1] as const, [a, -1] as const])) {
			const first = positions.length / 3;
			const [u, v] = [(axis + 1) % 3, (axis + 2) % 3];
			for (const [du, dv] of [
				[-1, -1],
				[1, -1],
				[1, 1],
				[-1, 1],
			] as const) {
				const p = [0, 0, 0];
				p[axis] = sign * BOX;
				p[u] = du * BOX;
				p[v] = dv * sign * BOX;
				positions.push(p[0] ?? 0, (p[1] ?? 0) + y, p[2] ?? 0);
				normals.push(...[0, 1, 2].map((k) => (k === axis ? sign : 0)));
				jointIds.push(j, 0, 0, 0);
			}
			indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
		}
	}
	const vertices = positions.length / 3;
	const weights = new Float32Array(vertices * 4);
	for (let k = 0; k < vertices; k++) weights[k * 4] = 1;
	return {
		positions: new Float32Array(positions),
		normals: new Float32Array(normals),
		joints: new Uint8Array(jointIds),
		weights,
		indices: new Uint16Array(indices),
	};
}

/** Reads the animated character count from the sketch module's address, or 0 for none. */
export function readAnimated(moduleUrl: string): number {
	return Number(new URL(moduleUrl).searchParams.get('animated') ?? '0');
}

/**
 * Adds `count` animated characters, and returns the code that moves them in each frame at sketch
 * time `t`.
 */
export function createAnimatedCrowd(
	{ scene, geometry, materials }: SketchContext,
	count: number,
): (t: number) => void {
	if (count === 0) return () => {};
	const rig = createAnimationRig(scene, crowdRig(JOINTS));
	const mesh = geometry.fromArrays(crowdMesh(JOINTS));
	const material = materials.standard({ color: '#d9a066' });
	const animators: Animator[] = [];
	// The handler does nothing, so the sample counts only what the engine allocates to call it.
	const hear = () => {};
	for (let k = 0; k < count; k++) {
		const dancer = scene.createMesh({
			name: `dancer${k}`,
			mesh,
			material,
			position: [((k % ROW) - (ROW - 1) / 2) * SPACING, 0, -Math.floor(k / ROW) * SPACING],
		});
		const animator = animateObject(dancer, rig);
		skinObject(dancer, animator);
		animator.play('walk');
		animator.play('run', { layer: 1 });
		animator.setLayerMask(1, 'joint1');
		animator.play('walk', { layer: 2, additive: true, speed: 0.5 });
		animator.setTimeScale(1 + (k % 4) * 0.25);
		animator.onEvent('left', hear);
		animator.onEvent('loop', hear);
		animators.push(animator);
	}
	let frame = 0;
	return (t) => {
		frame++;
		for (let k = 0; k < animators.length; k++) {
			const animator = animators[k] as Animator;
			animator.setLayerWeight(1, 0.5 + 0.5 * Math.sin(t + k));
			if ((frame + k) % FADE_EVERY === 0) {
				const clip = CROWD_CLIPS[((frame + k) / FADE_EVERY) % 2] as string;
				animator.crossFade(clip, 0.3);
			}
		}
	};
}
