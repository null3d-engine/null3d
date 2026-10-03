// Animated characters for the allocation check: generated characters that play clips through the
// engine's animator, with a masked layer, an additive layer and event handlers. Each frame, the
// sketch moves one layer's weight of every character, and now and then a character cross-fades to
// another clip, as a game's code does. Each character is a skinned mesh, a box at each joint, in a
// row in front of S1's boxes, which both GPU paths skin each frame. The engine cannot load animated
// models yet, so the characters come from the engine's internal rig and skin calls.
import type { Animator, SketchContext } from '@null3d/engine';
import { animateObject, createAnimationRig, skinObject } from '@null3d/engine/internal';
import { CROWD_CLIPS, crowdMesh, crowdRig } from '../../../tests/pages/lib/crowd-rig';

/** Joints per character, as S5's characters have 30 to 60. */
const JOINTS = 40;
/** Frames between two cross-fades of one character. */
const FADE_EVERY = 120;

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
