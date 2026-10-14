// Animates five generated characters through the animator and reports what their handlers heard.
// The hero walks, with footstep events, then cross-fades to a run. The guard runs once and
// finishes. The dancer walks with an additive run on a masked layer at twice the speed, and is
// destroyed after a second. The pair walks from halfway through its walk beside a run, and the
// sketch moves their weights each frame. The strider plays a blend of the walk and the run, whose
// value the sketch moves each frame. The sketch also makes the calls that must fail. The rig
// comes from the engine's internal loader call.
import { type AnimationEvent, defineSketch, EngineError } from '@null3d/engine';
import { animateObject, createAnimationRig } from '@null3d/engine/internal';
import type { AnimatorReport, HeardEvent } from '../lib/animator-report';
import { crowdRig } from '../lib/crowd-rig';

/** Joints of the generated character: a root and five chains. */
const JOINTS = 16;

/** The time in seconds at which the pair starts its walk, between the walk's two footsteps. */
const PAIR_START = 0.5;

/** `?transition=inertial` switches the hero with an inertial transition; anything else cross-fades. */
const TRANSITION = new URL(import.meta.url).searchParams.get('transition') ?? 'blend';
/** Frozen options for the hero's inertial switch, so the switch allocates nothing. */
const INERTIAL_RUN = Object.freeze({ fade: 0.3, transition: 'inertial' as const });

/** The point that the soldier aims at, and its chain: a limb of three joints from the root. */
const TARGET = [1, 1.5, -2] as const;
const AIM = Object.freeze({ joints: ['joint1', 'joint6', 'joint11'], limit: 1.2 });

/** The angle between two directions, in radians. */
function angle(a: readonly number[], b: readonly number[]): number {
	const dot = a.reduce((sum, v, k) => sum + v * (b[k] as number), 0);
	const length = Math.hypot(...a) * Math.hypot(...b);
	return Math.acos(Math.min(1, Math.max(-1, dot / length)));
}

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
	const pair = actor('pair');
	const strider = actor('strider');
	hero.animator.play('walk');
	guard.animator.play('run', { loop: false });
	dancer.animator.play('walk');
	dancer.animator.play('run', { layer: 1, additive: true });
	dancer.animator.setLayerMask(1, 'joint1');
	dancer.animator.setLayerWeight(1, 0.5);
	dancer.animator.setTimeScale(2);
	pair.animator.play('walk', { time: PAIR_START, weight: 0.5 });
	pair.animator.play('run', { weight: 0.5 });
	strider.animator.playBlend({ walk: 0, run: 1 }, { value: 0.5 });
	// The soldier walks and turns every frame, and aims one of its chains at the target. Its twin
	// walks beside it in the same place without aiming, to show how far the aim turned.
	const soldier = actor('soldier');
	const twin = actor('twin');
	for (const { animator } of [soldier, twin]) animator.play('walk');
	soldier.animator.lookAt(TARGET, AIM);
	const plain = scene.createGroup({ name: 'plain' });
	const errors: Record<string, string> = {
		unknownClip: codeOf(() => hero.animator.play('swim')),
		badLayer: codeOf(() => hero.animator.play('walk', { layer: 7 })),
		noClips: codeOf(() => plain.animator()),
		weightOfIdleClip: codeOf(() => guard.animator.setWeight('walk', 0.5)),
		emptyBlend: codeOf(() => strider.animator.playBlend({})),
		unknownJoint: codeOf(() => hero.animator.joint('tail')),
		brokenChain: codeOf(() => hero.animator.lookAt(TARGET, { joints: ['joint6', 'joint1'] })),
		lookWithoutChain: codeOf(() => guard.animator.lookAt(TARGET)),
	};
	// The soldier's place and heading in the frame whose step the next frame reads back.
	let [x, z, heading] = [0, 0, 0];
	let [aimError, aimFrames, aimTurn] = [0, 0, 0];
	/** Checks the aim of the last frame step, from the soldier's place in that frame. */
	const checkAim = () => {
		const end = AIM.joints.length - 1;
		const joint = Number(AIM.joints[end]?.slice(5));
		const [aim, from] = aimOf(soldier.animator.matrices(), joint, x, z, heading);
		const wanted = TARGET.map((v, k) => v - (from[k] as number));
		aimError = Math.max(aimError, angle(aim, wanted));
		aimTurn = angle(aim, aimOf(twin.animator.matrices(), joint, x, z, heading)[0]);
		aimFrames++;
	};
	/** The forward direction of a joint and its place in the world, from its skinning matrix. */
	const aimOf = (skin: Float32Array, j: number, x: number, z: number, heading: number) => {
		const m = (r: number, c: number) => skin[j * 12 + r * 4 + c] as number;
		// The joint's place at bind time, which its skinning matrix carries to its place in the pose.
		const [bx, by, bz] = rig.bindPlaces.subarray(j * 3, j * 3 + 3);
		const local = [0, 1, 2].map(
			(r) =>
				m(r, 0) * (bx as number) + m(r, 1) * (by as number) + m(r, 2) * (bz as number) + m(r, 3),
		);
		// The aim at bind time is +Z in the object's space, so the matrix's third column carries it.
		const forward = [m(0, 2), m(1, 2), m(2, 2)];
		const [s, c] = [Math.sin(heading), Math.cos(heading)];
		const turn = (v: number[]) => [
			c * (v[0] as number) + s * (v[2] as number),
			v[1] as number,
			-s * (v[0] as number) + c * (v[2] as number),
		];
		const place = turn(local);
		return [
			turn(forward),
			[(place[0] as number) + x, place[1] as number, (place[2] as number) + z],
		] as const;
	};
	let destroyedAt = -1;
	let crossFaded = false;
	let reported = false;
	return {
		onUpdate() {
			if (time.now > 0.2) checkAim();
			// The soldier walks a circle around the target and sways its heading about the way to
			// it, so an aim from its place in the frame before would miss.
			const t = time.now;
			[x, z] = [TARGET[0] + 4 * Math.cos(t), TARGET[2] + 4 * Math.sin(t)];
			heading = Math.atan2(TARGET[0] - x, TARGET[2] - z) + 0.5 * Math.sin(3 * t);
			for (const { object } of [soldier, twin]) {
				object.setPosition(x, 0, z);
				object.setRotationEuler(0, heading, 0);
			}
			pair.animator.setWeight('run', 0.5 + 0.5 * Math.sin(time.now));
			strider.animator.setBlend(0.5 + 0.5 * Math.sin(2 * time.now));
			if (!crossFaded && time.now >= 1.2) {
				crossFaded = true;
				// `?transition=inertial` switches the hero with an inertial transition instead of the
				// cross-fade, so the same page draws both for comparison.
				if (TRANSITION === 'inertial') hero.animator.play('run', INERTIAL_RUN);
				else hero.animator.crossFade('run', 0.3);
			}
			if (destroyedAt < 0 && time.now >= 1) {
				dancer.object.destroy();
				destroyedAt = time.now;
				errors.afterDestroy = codeOf(() => dancer.animator.play('walk'));
			}
			if (!reported && time.now >= 2.6) {
				reported = true;
				const report: AnimatorReport = {
					heard,
					destroyedAt,
					errors,
					clips: hero.animator.clips,
					aimError,
					aimFrames,
					aimTurn,
				};
				page.post('report', report);
			}
		},
	};
});
