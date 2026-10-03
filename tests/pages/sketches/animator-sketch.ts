// Animates three generated characters through the animator and reports what their handlers heard.
// The hero walks, with footstep events, then cross-fades to a run. The guard runs once and
// finishes. The dancer walks with an additive run on a masked layer at twice the speed, and is
// destroyed after a second. The sketch also makes the calls that must fail. The engine cannot load
// animated models yet, so the rig comes from the engine's internal loader call.
import { type AnimationEvent, defineSketch, EngineError } from '@null3d/engine';
import { animateObject, createAnimationRig } from '@null3d/engine/internal';
import type { AnimatorReport, HeardEvent } from '../lib/animator-report';
import { crowdRig } from '../lib/crowd-rig';

/** Joints of the generated character: a root and five chains. */
const JOINTS = 16;

/** The code of the error that `call` throws, or 'none'. */
function codeOf(call: () => unknown): string {
	try {
		call();
	} catch (error) {
		return error instanceof EngineError ? error.code : String(error);
	}
	return 'none';
}

export default defineSketch(({ scene, time, page }) => {
	const rig = createAnimationRig(scene, crowdRig(JOINTS));
	const heard: HeardEvent[] = [];
	const listen = (who: string) => (e: AnimationEvent) =>
		heard.push({ who, name: e.name, clip: e.clip, layer: e.layer, time: time.now });
	const actor = (name: string) => {
		const object = scene.createGroup({ name });
		animateObject(object, rig);
		const animator = object.animator();
		for (const event of ['left', 'right', 'loop', 'finished'])
			animator.onEvent(event, listen(name));
		return { object, animator };
	};
	const hero = actor('hero');
	const guard = actor('guard');
	const dancer = actor('dancer');
	hero.animator.play('walk');
	guard.animator.play('run', { loop: false });
	dancer.animator.play('walk');
	dancer.animator.play('run', { layer: 1, additive: true });
	dancer.animator.setLayerMask(1, 'joint1');
	dancer.animator.setLayerWeight(1, 0.5);
	dancer.animator.setTimeScale(2);
	const plain = scene.createGroup({ name: 'plain' });
	const errors: Record<string, string> = {
		unknownClip: codeOf(() => hero.animator.play('swim')),
		badLayer: codeOf(() => hero.animator.play('walk', { layer: 7 })),
		noClips: codeOf(() => plain.animator()),
	};
	let destroyedAt = -1;
	let crossFaded = false;
	let reported = false;
	return {
		onUpdate() {
			if (!crossFaded && time.now >= 1.2) {
				crossFaded = true;
				hero.animator.crossFade('run', 0.3);
			}
			if (destroyedAt < 0 && time.now >= 1) {
				dancer.object.destroy();
				destroyedAt = time.now;
				errors.afterDestroy = codeOf(() => dancer.animator.play('walk'));
			}
			if (!reported && time.now >= 2.6) {
				reported = true;
				const report: AnimatorReport = { heard, destroyedAt, errors, clips: hero.animator.clips };
				page.post('report', report);
			}
		},
	};
});
