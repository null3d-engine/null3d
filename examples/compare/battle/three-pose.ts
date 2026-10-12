// Poses a unit's bones in three.js from the shared simulation: an AnimationMixer with one action per
// clip, whose two clips in play take their times and weights from the unit's state, then
// `mixer.update(0)`. The mixer then samples and blends the clips into the bones, the same work as
// `mixer.update(delta)` with a cross-fade, and a held frame shows the state's exact pose. The scene
// graph mode runs it on each unit's own mixer, and the crowd of the instanced mode on one mixer per
// model, unit after unit, as three.js's crowd example does.

import type * as ThreeModule from 'three';
import { type BattleState, Clip } from './scene';

/** A mixer's actions, one per clip, and the two clips that hold weight now. */
export interface ClipPoser {
	actions: ThreeModule.AnimationAction[];
	durations: number[];
	/** The clips that the last pose weighted, or -1. */
	weighted: [number, number];
}

/** The actions of a model's clips on a mixer, in the order of `names`, all at weight 0. */
export function unitActions(
	mixer: ThreeModule.AnimationMixer,
	clips: readonly ThreeModule.AnimationClip[],
	names: readonly string[],
): ClipPoser {
	const actions = names.map((name) => {
		const clip = clips.find((c) => c.name === name);
		if (!clip) throw new Error(`The model has no clip "${name}".`);
		const action = mixer.clipAction(clip);
		action.play();
		action.setEffectiveWeight(0);
		return action;
	});
	return { actions, durations: actions.map((a) => a.getClip().duration), weighted: [-1, -1] };
}

/**
 * The time to sample a clip at: idle, run and shoot repeat; the fall plays once and holds a moment
 * before its end, which the mixer keeps as a time it never wraps.
 */
export function clipSampleTime(clip: number, time: number, duration: number): number {
	if (clip === Clip.die) return Math.min(Math.max(time, 0), duration - 1e-4);
	const wrapped = time % duration;
	return wrapped < 0 ? wrapped + duration : wrapped;
}

/** The current clip's weight while a unit fades from its previous clip: 1 once the fade ends. */
export function currentClipWeight(clip: number, previousClip: number, fade: number): number {
	if (clip === previousClip) return 1;
	return Math.min(Math.max(fade, 0), 1);
}

/** Poses unit `i`'s bones on `mixer` from the state. Allocates nothing. */
export function poseUnitMixer(
	s: BattleState,
	i: number,
	mixer: ThreeModule.AnimationMixer,
	poser: ClipPoser,
): void {
	const clip = s.clip[i] as number;
	const previous = s.previousClip[i] as number;
	const current = currentClipWeight(clip, previous, s.fade[i] as number);
	const { actions, durations, weighted } = poser;
	// Only the clips that held weight in the last pose need clearing.
	for (const k of weighted)
		if (k >= 0 && k !== clip && k !== previous)
			(actions[k] as ThreeModule.AnimationAction).setEffectiveWeight(0);
	const now = actions[clip] as ThreeModule.AnimationAction;
	now.time = clipSampleTime(clip, s.clipTime[i] as number, durations[clip] as number);
	now.setEffectiveWeight(current);
	weighted[0] = clip;
	weighted[1] = -1;
	if (current < 1) {
		const before = actions[previous] as ThreeModule.AnimationAction;
		before.time = clipSampleTime(
			previous,
			s.previousTime[i] as number,
			durations[previous] as number,
		);
		before.setEffectiveWeight(1 - current);
		weighted[1] = previous;
	} else if (previous !== clip) {
		(actions[previous] as ThreeModule.AnimationAction).setEffectiveWeight(0);
	}
	mixer.update(0);
}
