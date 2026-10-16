// Animated characters for the allocation check: generated characters that play clips through the
// engine's animator, with a masked layer, an additive layer and event handlers. A third of them
// play one clip on their base layer, a third a phase-synced blend of the walk and the run, and a
// third the walk and the run side by side by clip weights, from start times of their own. Each
// frame, the sketch moves one layer's weight of every character, and the blend value or the run's
// clip weight. Now and then a character cross-fades to another clip, plays its blend again with
// other points, or fades its clips to new weights, as a game's code does. With inertial
// transitions, the characters that play one clip switch to the next with an inertial transition
// instead of a cross-fade, so the animator carries the pose they leave into the new clip. Every
// fourth character
// turns two joints on top of its clips, with a set and an added rotation, and the next ones aim a
// chain of three joints at a point that moves, at a weight that moves. Each character is a
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
const INERTIAL = Object.freeze({ fade: 0.3, transition: 'inertial' as const });
/** The aim of the characters that look at a point: a limb of three joints from the root. */
const AIM = Object.freeze({ joints: ['joint1', 'joint6', 'joint11'], limit: 0.8 });
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
 * time `t`. With `inertial`, the characters that play one clip switch clips by inertial transitions.
 */
export function createAnimatedCrowd(
	{ scene, geometry, materials }: SketchContext,
	count: number,
	inertial = false,
): (t: number) => void {
	if (count === 0) return () => {};
	const rig = createAnimationRig(scene, crowdRig(JOINTS));
	const mesh = geometry.fromArrays(crowdMesh(JOINTS));
	const material = materials.standard({ color: '#e8554e' });
	const animators: Animator[] = [];
	// The handler does nothing, so the sample counts only what the engine allocates to call it.
	const hear = () => {};
	// The rotation and the point that the joint overrides take, which each frame changes in place,
	// and the frame's time, which the joint step reads.
	const bend = [0, 0, 0, 1];
	const target = new Float64Array(3);
	const now = new Float64Array(1);
	// The joint calls run in a step of their own that takes no fractions. The frame step is too
	// large for the browser to inline every call into it, and a fraction passed to a call that it
	// does not inline is boxed.
	const turnJoints = (animator: Animator, k: number) => {
		const t = now[0] as number;
		if (k % 4 === 1) {
			animator.setJointRotation(7, bend, 0.5 + 0.5 * Math.sin(t + k));
			animator.addJointRotation(12, bend);
		} else if (k % 4 === 3) animator.lookAt(target, undefined, 0.5 + 0.5 * Math.cos(t + k));
	};
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
		if (k % 4 === 3) animator.lookAt(target, AIM);
		animators.push(animator);
	}
	let frame = 0;
	return (t) => {
		frame++;
		bend[1] = Math.sin(0.5 * t);
		bend[3] = Math.cos(0.5 * t);
		target[0] = 3 * Math.cos(t);
		target[1] = 1.5;
		target[2] = 6 + 3 * Math.sin(t);
		now[0] = t;
		for (let k = 0; k < animators.length; k++) {
			const animator = animators[k] as Animator;
			const kind = k % 3;
			animator.setLayerWeight(1, 0.5 + 0.5 * Math.sin(t + k));
			turnJoints(animator, k);
			if (kind === 1) animator.setBlend(0.4 + 0.4 * Math.sin(t + k));
			else if (kind === 2) animator.setWeight('run', 0.5 + 0.5 * Math.cos(t + k));
			if ((frame + k) % FADE_EVERY !== 0) continue;
			const turn = ((frame + k) / FADE_EVERY) % 2;
			if (kind === 1) animator.playBlend(turn === 0 ? BLEND : REVERSED, FADE);
			else if (kind === 2) animator.play('walk', FADE_TO_WEIGHT[turn]);
			else if (inertial) animator.play(CROWD_CLIPS[turn] as string, INERTIAL);
			else animator.crossFade(CROWD_CLIPS[turn] as string, 0.3);
		}
	};
}
