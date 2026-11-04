// The sampler of property tracks: the keys between which a time falls, the mixing of the tracks
// that play together, the share of the base that a partly weighted clip leaves, and the clock that
// a sketch's own animation keeps.
import { describe, expect, test } from 'bun:test';
import { ANIMATION_MAX_BLEND, ANIMATION_NO_SOURCE } from '../generated/core';
import { PropertyPlayer } from './animation';
import {
	PROPERTY_LIGHT_COLOR,
	PROPERTY_ROTATION,
	PROPERTY_VISIBLE,
	PropertyAnimation,
	type PropertyBinding,
	type PropertyClipTracks,
	PropertySystem,
	type PropertyTrack,
	type SlotSource,
} from './property-animation';

/** A stand-in for the animation table's sample slots. */
class FakeSlots implements SlotSource {
	readonly sources = new Uint32Array(ANIMATION_MAX_BLEND).fill(ANIMATION_NO_SOURCE);
	readonly times = new Float32Array(ANIMATION_MAX_BLEND);
	readonly weights = new Float32Array(ANIMATION_MAX_BLEND);

	slotSources(): Uint32Array {
		return this.sources;
	}
	slotTimes(): Float32Array {
		return this.times;
	}
	slotWeights(): Float32Array {
		return this.weights;
	}

	/** Plays clip `clip` in slot `slot` at `time` with `weight`. */
	play(slot: number, clip: number, time: number, weight: number): void {
		this.sources[slot] = clip;
		this.times[slot] = time;
		this.weights[slot] = weight;
	}
}

/** A binding of `components` numbers, with the value that the file gave it. */
function bindingOf(what: number, components: number, base: number[] = []): PropertyBinding {
	return {
		what,
		name: '',
		components,
		base: Float32Array.from(base.length > 0 ? base : new Array<number>(components).fill(0)),
	};
}

/** A track of binding `binding` with the keys that `times` and `values` give. */
function trackOf(
	binding: number,
	times: number[],
	values: number[],
	interpolation: PropertyTrack['interpolation'] = 'linear',
): PropertyTrack {
	return {
		binding,
		interpolation,
		times: Float32Array.from(times),
		values: Float32Array.from(values),
	};
}

/** The value that the last write gave, and the weight that the write got. */
interface Written {
	value: number[];
	weight: number;
}

/** The object that a binding writes, as the player sees it. */
const TARGET = {};

/** Steps a player of `bindings`, and returns what its write gave, with the player itself. */
function run(
	slots: FakeSlots,
	bindings: readonly PropertyBinding[],
	clips: PropertyClipTracks,
	keys: readonly string[] = [],
): { written: Written; player: PropertyPlayer } {
	const written: Written = { value: [], weight: 0 };
	const player = new PropertyPlayer(
		slots,
		0,
		bindings,
		clips,
		bindings.map(() => TARGET),
		keys,
	);
	player.step((_target, binding, values, at, weight) => {
		written.value = [];
		for (let c = 0; c < binding.components; c++)
			written.value.push(
				(values[at + c] as number) * weight + (binding.base[c] as number) * (1 - weight),
			);
		written.weight = weight;
	});
	return { written, player };
}

/** The value that one clip, in the first slot at `time` and `weight`, gives a binding. */
function sampled(
	binding: PropertyBinding,
	clips: PropertyClipTracks,
	time: number,
	weight = 1,
): Written {
	const slots = new FakeSlots();
	slots.play(0, 0, time, weight);
	return run(slots, [binding], clips).written;
}

describe('property track sampling', () => {
	test('a linear track blends between the keys around the time', () => {
		const binding = bindingOf(PROPERTY_LIGHT_COLOR, 3);
		const clips = [[trackOf(0, [0, 2], [0, 0, 0, 1, 1, 1])]];
		expect(sampled(binding, clips, 0.5).value).toEqual([0.25, 0.25, 0.25]);
		expect(sampled(binding, clips, 1).value).toEqual([0.5, 0.5, 0.5]);
		expect(sampled(binding, clips, 2).value).toEqual([1, 1, 1]);
	});

	test('a time outside the keys holds the first or the last key', () => {
		const binding = bindingOf(PROPERTY_LIGHT_COLOR, 3);
		const clips = [[trackOf(0, [1, 3], [0.25, 0.5, 0.75, 1, 1, 1])]];
		expect(sampled(binding, clips, 0).value).toEqual([0.25, 0.5, 0.75]);
		expect(sampled(binding, clips, 9).value).toEqual([1, 1, 1]);
	});

	test('a step track holds its key until the next', () => {
		const binding = bindingOf(PROPERTY_VISIBLE, 1, [1]);
		const clips = [[trackOf(0, [0, 1, 2], [1, 0, 1], 'step')]];
		expect(sampled(binding, clips, 0.999).value).toEqual([1]);
		expect(sampled(binding, clips, 1).value).toEqual([0]);
		expect(sampled(binding, clips, 1.999).value).toEqual([0]);
		expect(sampled(binding, clips, 2).value).toEqual([1]);
	});

	test('a cubic track follows the spline, and a key holds its value between its tangents', () => {
		const binding = bindingOf(PROPERTY_LIGHT_COLOR, 3);
		// Two keys with zero tangents leave the smooth curve that halves the values at its middle.
		const values = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 0, 0, 0];
		const clips = [[trackOf(0, [0, 2], values, 'cubic')]];
		expect(sampled(binding, clips, 1).value).toEqual([1, 1, 1]);
		expect(sampled(binding, clips, 0).value).toEqual([0, 0, 0]);
		expect(sampled(binding, clips, 2).value).toEqual([2, 2, 2]);
	});

	test('a rotation turns along the shorter arc between its keys', () => {
		const binding = bindingOf(PROPERTY_ROTATION, 4, [0, 0, 0, 1]);
		const s = Math.SQRT1_2;
		const clips = [[trackOf(0, [0, 1], [0, 0, 0, 1, 0, s, 0, s])]];
		const half = sampled(binding, clips, 0.5).value;
		const angle = Math.PI / 4;
		expect(half[0] as number).toBeCloseTo(0, 6);
		expect(half[1] as number).toBeCloseTo(Math.sin(angle / 2), 6);
		expect(half[2] as number).toBeCloseTo(0, 6);
		expect(half[3] as number).toBeCloseTo(Math.cos(angle / 2), 6);
	});

	test('a clip at less than full weight leaves the rest of the value at the base', () => {
		const binding = bindingOf(PROPERTY_LIGHT_COLOR, 3, [0.2, 0.2, 0.2]);
		const clips = [[trackOf(0, [0, 1], [1, 1, 1, 1, 1, 1])]];
		const written = sampled(binding, clips, 1, 0.5);
		expect(written.weight).toBe(0.5);
		for (const value of written.value) expect(value).toBeCloseTo(0.6, 6);
	});

	test('two clips that play together mix by their weights', () => {
		const binding = bindingOf(PROPERTY_LIGHT_COLOR, 3);
		const clips: PropertyClipTracks = [
			[trackOf(0, [0, 1], [0, 0, 0, 0, 0, 0])],
			[trackOf(0, [0, 1], [1, 1, 1, 1, 1, 1])],
		];
		const slots = new FakeSlots();
		slots.play(0, 0, 1, 0.25);
		slots.play(1, 1, 1, 0.75);
		const { written } = run(slots, [binding], clips);
		expect(written.weight).toBe(1);
		for (const value of written.value) expect(value).toBeCloseTo(0.75, 6);
	});

	test('a property that no clip plays is not written', () => {
		const binding = bindingOf(PROPERTY_LIGHT_COLOR, 3, [0.2, 0.2, 0.2]);
		const slots = new FakeSlots();
		const player = new PropertyPlayer(
			slots,
			0,
			[binding],
			[[trackOf(0, [0, 1], [1, 1, 1, 1, 1, 1])]],
			[TARGET],
		);
		player.step(() => {
			throw new Error('a property that no clip plays must not be written');
		});
	});

	test('a binding reports the value that the last step wrote, by its key', () => {
		const binding = bindingOf(PROPERTY_LIGHT_COLOR, 3);
		const slots = new FakeSlots();
		slots.play(0, 0, 0.5, 1);
		const { player } = run(
			slots,
			[binding],
			[[trackOf(0, [0, 1], [0, 0, 0, 1, 1, 1])]],
			['the/property'],
		);
		const sample = player.sampleOf('the/property');
		expect(sample ? Array.from(sample) : undefined).toEqual([0.5, 0.5, 0.5]);
		expect(player.sampleOf('another/property')).toBeUndefined();
	});
});

describe('a sketch’s property animation', () => {
	/** An animation of one number, from 0 at 0 s to 10 at 2 s, whose writes `written` keeps. */
	function makeAnimation(keyframes: { loop?: boolean; time?: number; paused?: boolean }): {
		animation: PropertyAnimation;
		written: Written;
		system: PropertySystem;
	} {
		const written: Written = { value: [], weight: 0 };
		const system = new PropertySystem((_target, _binding, values, at, weight) => {
			written.value = [values[at] as number];
			written.weight = weight;
		});
		const track: PropertyTrack = {
			binding: 0,
			interpolation: 'linear',
			times: Float32Array.from([0, 2]),
			values: Float32Array.from([0, 10]),
		};
		const made = new PropertyAnimation(system, TARGET, bindingOf(PROPERTY_LIGHT_COLOR, 1), track, {
			times: [0, 2],
			values: [0, 10],
			...keyframes,
		});
		system.add(made);
		return { animation: made, written, system };
	}

	test('plays at its speed, repeats, and holds its last key when it stops repeating', () => {
		const { animation, written, system } = makeAnimation({});
		system.step(0.5);
		expect(written.value).toEqual([2.5]);
		// Past its end, a repeating animation starts again.
		system.step(2);
		expect(written.value[0] as number).toBeCloseTo(2.5, 6);
		animation.setLoop(false);
		system.step(5);
		expect(written.value).toEqual([10]);
	});

	test('setTime places it, and a paused animation writes the time that it holds', () => {
		const { animation, written, system } = makeAnimation({});
		animation.setTime(1);
		animation.setPaused(true);
		system.step(1);
		expect(written.value).toEqual([5]);
		expect(animation.time).toBe(1);
		expect(animation.playing).toBe(false);
	});

	test('a stopped animation writes nothing more', () => {
		const { animation, written, system } = makeAnimation({});
		system.step(0.2);
		animation.stop();
		written.value = [7];
		system.step(1);
		expect(written.value).toEqual([7]);
		expect(system.idle).toBe(true);
	});
});
