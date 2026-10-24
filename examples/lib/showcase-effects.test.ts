// The controls that both showcase scenes share: each effect the HUD offers reaches the part of the
// scene that owns it, the page's buttons reach the scene's own answers, and the groups show the ids
// that the scene supports.
import { describe, expect, it } from 'bun:test';
import type { SketchContext } from '@null3d/engine';
import { type HudGroup, TIME_NAMES, TIME_SKY } from './controls';
import { createShowcaseEffects, shadowStep } from './showcase-effects';

/** A cinematic that records how the page's camera picks reach it. */
function stubFilm() {
	const calls: string[] = [];
	return {
		calls,
		film: {
			select: (id: string) => calls.push(`select ${id}`),
			refresh: () => calls.push('refresh'),
		} as never,
	};
}

/** A scene whose every part records what the controls write to it. */
function stub(
	options: {
		dslr?: boolean;
		start?: Record<string, boolean>;
		own?: readonly string[];
		extra?: () => readonly HudGroup[];
	} = {},
) {
	const seen: string[] = [];
	const posts: unknown[] = [];
	const shown: string[] = [];
	const quality = {
		preset: 'high' as string,
		settings: { lodThreshold: 0 },
		set: (settings: { lodThreshold?: number }) => {
			if (settings.lodThreshold !== undefined) {
				quality.settings.lodThreshold = settings.lodThreshold;
				seen.push(`lodThreshold ${settings.lodThreshold}`);
			}
			return Promise.resolve();
		},
		// A preset gives every setting its own value, as the engine's presets do: a threshold of
		// 2 pixels on Low and 1 above it.
		setPreset: (preset: string) => {
			quality.preset = preset;
			quality.settings.lodThreshold = preset === 'low' ? 2 : 1;
			seen.push(`preset ${preset}`);
		},
	};
	const { calls, film } = stubFilm();
	const scene = {
		context: {
			page: {
				onMessage: (handler: (name: string, value: unknown) => void) => {
					scene.handler = handler;
					return () => {};
				},
			},
			post: { set: (settings: unknown) => posts.push(settings) },
			quality,
		},
		handler: undefined as undefined | ((name: string, value: unknown) => void),
	} as unknown as {
		context: SketchContext;
		handler?: (name: string, value: unknown) => void;
	};
	const stage = {
		mood: 'Night',
		auto: false,
		hours: 23,
		show: (part: string, on: boolean) => shown.push(`${part} ${on}`),
		preset: 'high',
	};
	const ranges: number[] = [];
	const sun = {
		setCastShadows: (on: boolean) => seen.push(`shadows ${on}`),
		setShadow: (shadow: { distance: number }) => ranges.push(shadow.distance),
	};
	// The camera looks down -z from `place`, which a test moves.
	const place = [0, 5, 20];
	const camera = {
		setFocalLength: (length: number) => seen.push(`focal ${length}`),
		setFov: (fov: number) => seen.push(`fov ${fov}`),
		getPosition: (out: number[]) => {
			out[0] = place[0] as number;
			out[1] = place[1] as number;
			out[2] = place[2] as number;
		},
		getRotation: (out: number[]) => {
			out[0] = 0;
			out[1] = 0;
			out[2] = 0;
			out[3] = 1;
		},
	};
	const effects = createShowcaseEffects(scene.context, {
		camera: camera as never,
		sun: sun as never,
		shadowReach: { distance: 70, center: [0, 5, 0], radius: 30 },
		stage: stage as never,
		start: options.start ?? {
			sky: true,
			fog: true,
			shadows: true,
			ao: true,
			dof: false,
			exposure: false,
		},
		supported: {
			atmosphere: ['sky', 'fog'],
			lighting: ['shadows', 'ao'],
			post: ['dof', 'exposure'],
		},
		apply: (id, on) => seen.push(`${id} ${on}`),
		...(options.own !== undefined && { own: options.own }),
		...(options.extra !== undefined && { extra: options.extra }),
		mood: (mood) => seen.push(`mood ${mood}`),
		hour: (hours) => seen.push(`hour ${hours}`),
		film: () => film,
		fov: 45,
		focalLength: 50,
		focus: [0, 1, 0],
		...(options.dslr !== undefined && { dslr: options.dslr }),
	});
	return { effects, seen, posts, shown, calls, scene, camera, quality, ranges, place, stage };
}

describe('createShowcaseEffects', () => {
	it('turns a part off at the start when the scene starts with it off', () => {
		const { shown } = stub({ start: { sky: true, fog: false, shadows: true } });
		expect(shown).toEqual(['fog false']);
	});

	it('offers the time of day as a slider on the stage’s hour', () => {
		const { effects } = stub();
		const time = effects.groups().find((group) => group.name === 'hour');
		expect(time?.slider?.value).toBe(23);
		expect(time?.slider?.min).toBe(0);
		expect(time?.slider?.max).toBe(24);
		expect(time?.slider?.live).toBe(false);
		expect(time?.buttons.map((button) => button.id)).toEqual(['Auto', 'Studio']);
		expect(time?.buttons.map((button) => button.name)).toEqual(['mood', 'mood']);
	});

	it('draws the hour as a dial in the sky’s colors, which names the studio while it is on', () => {
		const { effects, stage } = stub();
		const dial = () => effects.groups().find((group) => group.name === 'hour')?.slider?.dial;
		expect(dial()?.colors).toBe(TIME_SKY);
		expect(dial()?.names).toBe(TIME_NAMES);
		expect(dial()?.off).toBeUndefined();
		stage.mood = 'Studio';
		expect(dial()?.off).toBe('Studio');
	});

	it('names midnight, and every hour of the day, on the dial', () => {
		const nameOf = (hour: number) =>
			TIME_NAMES.filter(([, from, to]) =>
				from < to ? hour >= from && hour < to : hour >= from || hour < to,
			).map(([name]) => name);
		// Every hour falls in exactly one span, and the half hour either side of midnight is its own.
		for (let hour = 0; hour < 24; hour += 0.05) expect(nameOf(hour)).toHaveLength(1);
		expect(nameOf(0)).toEqual(['Midnight']);
		expect(nameOf(23.75)).toEqual(['Midnight']);
		expect(nameOf(2)).toEqual(['Night']);
		expect(nameOf(6.2)).toEqual(['Dawn']);
	});

	it('turns Auto off with a second press, holding the hour it reached', () => {
		const { scene, seen, stage } = stub();
		scene.handler?.('mood', 'Auto');
		expect(seen.at(-1)).toBe('mood Auto');
		stage.auto = true;
		stage.hours = 14.5;
		scene.handler?.('mood', 'Auto');
		expect(seen.at(-1)).toBe('hour 14.5');
	});

	it('turns the studio off with a second press, back to the hour it took the place of', () => {
		const { scene, seen, stage } = stub();
		stage.hours = 9.25;
		scene.handler?.('mood', 'Studio');
		expect(seen.at(-1)).toBe('mood Studio');
		stage.mood = 'Studio';
		stage.hours = 12;
		scene.handler?.('mood', 'Studio');
		expect(seen.at(-1)).toBe('hour 9.25');
	});

	it('turns the level of detail off by default, and on and off under Quality', () => {
		const { effects, scene, seen } = stub();
		const quality = effects.groups().find((group) => group.name === 'quality');
		expect(quality?.extras?.map((button) => button.id)).toEqual(['lod']);
		expect(quality?.extras?.[0]?.active).toBe(false);
		scene.handler?.('quality', 'lod');
		expect(seen).toContain('lodThreshold 1');
	});

	it('keeps the level of detail off when a preset is picked', () => {
		const { effects, scene, seen, quality } = stub();
		scene.handler?.('quality', 'medium');
		expect(quality.settings.lodThreshold).toBe(0);
		expect(seen).toEqual(['preset medium', 'lodThreshold 0']);
		const group = effects.groups().find((entry) => entry.name === 'quality');
		expect(group?.extras?.[0]?.active).toBe(false);
	});

	it("turns the level of detail on at the preset's threshold", () => {
		const { scene, quality } = stub();
		scene.handler?.('quality', 'low');
		scene.handler?.('quality', 'lod');
		expect(quality.settings.lodThreshold).toBe(2);
		scene.handler?.('quality', 'lod');
		expect(quality.settings.lodThreshold).toBe(0);
		// A preset picked while it is on keeps it on, at that preset's threshold.
		scene.handler?.('quality', 'lod');
		scene.handler?.('quality', 'ultra');
		expect(quality.settings.lodThreshold).toBe(1);
		scene.handler?.('quality', 'lod');
		scene.handler?.('quality', 'lod');
		expect(quality.settings.lodThreshold).toBe(1);
	});

	it('sends a slider hour to the scene', () => {
		const { scene, seen } = stub();
		scene.handler?.('hour', '18.4');
		expect(seen).toContain('hour 18.4');
	});

	it('sends each shared switch to the part that owns it', () => {
		const { effects, shown, seen } = stub();
		effects.set('sky', false);
		effects.set('fog', false);
		effects.set('shadows', false);
		expect(shown).toEqual(['sky false', 'fog false']);
		// A scene may tie its own haze to the fog switch, so it sees the fog and sky picks too.
		expect(seen).toEqual(['sky false', 'fog false', 'shadows false']);
	});

	it('turns the lens on and off through the camera and the post pass', () => {
		const { effects, seen, posts } = stub();
		effects.set('dof', true);
		expect(seen).toEqual(['focal 50']);
		expect(posts[0]).toEqual({ dof: { aperture: 1.8, maxBlur: 0.025, focusPoint: [0, 1, 0] } });
		expect(effects.lens()).not.toBeNull();
		effects.set('dof', false);
		expect(seen).toEqual(['focal 50', 'fov 45']);
		expect(posts[1]).toEqual({ dof: false });
		expect(effects.lens()).toBeNull();
	});

	it('starts with the lens on when the address asks for it', () => {
		const { effects, seen } = stub({ dslr: true });
		expect(seen).toEqual(['focal 50']);
		expect(effects.on.dof).toBe(true);
	});

	it("sends an effect of the scene's own to the scene", () => {
		const { effects, seen } = stub();
		effects.set('ao', false);
		expect(seen).toEqual(['ao false']);
	});

	it('shows the ids the scene supports, with the state of each', () => {
		const { effects } = stub();
		const groups = effects.groups();
		expect(groups.map((group) => group.name)).toEqual([
			'hour',
			'atmosphere',
			'lighting',
			'post',
			'quality',
		]);
		expect(groups[1]?.buttons.map((button) => button.id)).toEqual(['sky', 'fog']);
		expect(groups[1]?.buttons.every((button) => button.active)).toBe(true);
		expect(groups[3]?.buttons.map((button) => button.active)).toEqual([false, false]);
	});

	it("routes the page's picks to the scene, its effects and its route", () => {
		const { scene, seen, calls, effects, quality } = stub();
		const send = (name: string, value: string) => scene.handler?.(name, value);
		send('camera', 'Manual');
		expect(calls).toEqual(['select Manual']);
		send('mood', 'Dawn');
		expect(seen).toEqual(['mood Dawn']);
		expect(calls).toEqual(['select Manual', 'refresh']);
		// A toggle posts its id: the router flips the state the scene holds.
		send('atmosphere', 'sky');
		expect(seen).toEqual(['mood Dawn', 'sky false']);
		expect(effects.on.sky).toBe(false);
		expect(calls).toEqual(['select Manual', 'refresh', 'refresh']);
		send('post', 'dof');
		expect(effects.on.dof).toBe(true);
		send('quality', 'medium');
		expect(quality.preset).toBe('medium');
		expect(calls).toEqual(['select Manual', 'refresh', 'refresh', 'refresh', 'refresh']);
		// A mood that the scene does not know changes nothing.
		send('mood', 'Noon');
		expect(seen).toEqual(['mood Dawn', 'sky false', 'focal 50', 'preset medium', 'lodThreshold 0']);
	});
});

describe('the shadow range', () => {
	it('rises at once to the step that reaches the need', () => {
		expect(shadowStep(60, 70, 70)).toBe(70);
		expect(shadowStep(71, 70, 70)).toBeCloseTo(87.5, 6);
		expect(shadowStep(100, 70, 70)).toBeCloseTo(109.375, 6);
	});

	it('holds while the need hovers at a step, and falls once it is a whole step lower', () => {
		let held = shadowStep(90, 70, 70);
		expect(held).toBeCloseTo(109.375, 6);
		// The need crosses the step under the held range back and forth: the range holds still.
		for (let k = 0; k < 100; k++) {
			held = shadowStep(k % 2 === 0 ? 87 : 88, held, 70);
			expect(held).toBeCloseTo(109.375, 6);
		}
		// A need a whole step under the held range lets it fall, to the step that reaches the need.
		held = shadowStep(69, held, 70);
		expect(held).toBe(70);
	});

	it('follows the camera as it draws back from the core and comes in again', () => {
		const { effects, ranges, place } = stub();
		expect(ranges).toEqual([70]);
		// The core's far side lies the camera's distance from its middle plus its radius away.
		for (const back of [20, 60, 120, 240]) {
			place[2] = back;
			effects.update(0);
			expect(ranges.at(-1) as number).toBeGreaterThanOrEqual(back + 30);
		}
		place[2] = 20;
		effects.update(0);
		expect(ranges.at(-1)).toBe(70);
		// A range that does not change is not written again.
		const writes = ranges.length;
		effects.update(0);
		expect(ranges.length).toBe(writes);
	});
});

describe('a scene’s own effects', () => {
	it('lets the scene answer a switch that a shared case would take', () => {
		const { effects, seen, posts } = stub({ own: ['vignette'] });
		effects.set('vignette', true);
		// The scene's own answer runs, and the shared vignette case writes nothing.
		expect(seen).toEqual(['vignette true']);
		expect(posts).toEqual([]);
	});

	it('shows the scene’s own groups before Quality', () => {
		const { effects } = stub({
			extra: () => [{ name: 'traffic', title: 'Traffic', radio: true, buttons: [] }],
		});
		expect(effects.groups().map((group) => group.name)).toEqual([
			'hour',
			'atmosphere',
			'lighting',
			'post',
			'traffic',
			'quality',
		]);
	});
});
