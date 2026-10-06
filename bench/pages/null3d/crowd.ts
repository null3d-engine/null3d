// Animated characters for the allocation check: generated characters that play clips through the
// engine's animator, with a masked layer, an additive layer and event handlers. A third of them
// play one clip on their base layer, a third a phase-synced blend of the walk and the run, and a
// third the walk and the run side by side by clip weights, from start times of their own. Each
// frame, the sketch moves one layer's weight of every character, and the blend value or the run's
// clip weight. Now and then a character cross-fades to another clip, plays its blend again with
// other points, or fades its clips to new weights, as a game's code does. Each character is a
// skinned mesh, a box at each joint, in a row in front of S1's boxes, which both GPU paths skin
// each frame. The engine cannot load animated models yet, so the characters come from the
// engine's internal rig and skin calls.
import type { Animator, SketchContext } from '@null3d/engine';
import { animateObject, createAnimationRig, skinObject } from '@null3d/engine/internal';
import { CROWD_CLIPS, crowdMesh, crowdRig } from '../../../tests/pages/lib/crowd-rig';

/** Joints per character, as S5's characters have 30 to 60. */
const JOINTS = 40;
/** Frames between two cross-fades of one character. */
const FADE_EVERY = 120;
/**
 * The blend of the walk and the run, the same blend with the points swapped, and the options of
 * the calls that switch clips. Game code keeps them in frozen constants, as here: a switch then
 * builds no object, and the animator reads each object once, so a switch allocates nothing.
 */
const BLEND = Object.freeze({ walk: 0, run: 0.8 });
const REVERSED = Object.freeze({ walk: 0.8, run: 0 });
const FADE = Object.freeze({ fade: 0.3 });
const FADE_TO_WEIGHT = [
	Object.freeze({ fade: 0.3, weight: 0.25 }),
	Object.freeze({ fade: 0.3, weight: 0.75 }),
];

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
	const material = materials.standard({ color: '#e8554e' });
	const animators: Animator[] = [];
	// The handler does nothing, so the sample counts only what the engine allocates to call it.
	const hear = () => {};
	for (let k = 0; k < count; k++) {
		const position: [number, number, number] = [(k % 16) - 7.5, 0, 6 + Math.floor(k / 16)];
		const dancer = scene.createMesh({ mesh, material, position, name: `dancer${k}` });
		const animator = animateObject(dancer, rig);
		skinObject(dancer, animator);
		if (k % 3 === 1) animator.playBlend(BLEND, { phase: k / count });
		else if (k % 3 === 2) {
			animator.play('walk', { time: k * 0.1, weight: 0.5 });
			animator.play('run', { time: k * 0.1, weight: 0.5 });
		} else animator.play('walk');
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
			const kind = k % 3;
			animator.setLayerWeight(1, 0.5 + 0.5 * Math.sin(t + k));
			if (kind === 1) animator.setBlend(0.4 + 0.4 * Math.sin(t + k));
			else if (kind === 2) animator.setWeight('run', 0.5 + 0.5 * Math.cos(t + k));
			if ((frame + k) % FADE_EVERY !== 0) continue;
			const turn = ((frame + k) / FADE_EVERY) % 2;
			if (kind === 1) animator.playBlend(turn === 0 ? BLEND : REVERSED, FADE);
			else if (kind === 2) animator.play('walk', FADE_TO_WEIGHT[turn]);
			else animator.crossFade(CROWD_CLIPS[turn] as string, 0.3);
		}
	};
}
