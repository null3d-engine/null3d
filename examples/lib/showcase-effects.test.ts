// The controls that both showcase scenes share: each effect the HUD offers reaches the part of the
// scene that owns it, the page's buttons reach the scene's own answers, and the groups show the ids
// that the scene supports.
import { describe, expect, it } from 'bun:test';
import type { SketchContext } from '@null3d/engine';
import { createShowcaseEffects } from './showcase-effects';

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
function stub(options: { dslr?: boolean; start?: Record<string, boolean> } = {}) {
	const seen: string[] = [];
	const posts: unknown[] = [];
	const shown: string[] = [];
	const quality = {
		preset: 'high' as string,
		setPreset: (preset: string) => {
			quality.preset = preset;
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
		show: (part: string, on: boolean) => shown.push(`${part} ${on}`),
		preset: 'high',
	};
	const sun = { setCastShadows: (on: boolean) => seen.push(`shadows ${on}`) };
	const camera = {
		setFocalLength: (length: number) => seen.push(`focal ${length}`),
		setFov: (fov: number) => seen.push(`fov ${fov}`),
	};
	const effects = createShowcaseEffects(scene.context, {
		camera: camera as never,
		sun: sun as never,
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
		mood: (mood) => seen.push(`mood ${mood}`),
		film: () => film,
		fov: 45,
		focalLength: 50,
		focus: [0, 1, 0],
		...(options.dslr !== undefined && { dslr: options.dslr }),
	});
	return { effects, seen, posts, shown, calls, scene, camera, quality };
}

describe('createShowcaseEffects', () => {
	it('turns a part off at the start when the scene starts with it off', () => {
		const { shown } = stub({ start: { sky: true, fog: false, shadows: true } });
		expect(shown).toEqual(['fog false']);
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
			'mood',
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
		expect(seen).toEqual(['mood Dawn', 'sky false', 'focal 50', 'preset medium']);
	});
});
