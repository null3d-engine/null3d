// The stage writes the sky, the fog and the environment light every frame, so a part that the HUD
// turns off must stay off in every later frame and mood, and come back when it turns on again.
import { expect, test } from 'bun:test';
import { createMoods, type Mood, type StagePart } from './stage';

const SKY = { name: 'sky' };
const ROOM = { name: 'room' };
const BACKDROP = [0.02, 0.025, 0.04] as const;

/** A stage on a scene that keeps the last value of each setter. */
function staged() {
	const last: { background?: unknown; environment?: unknown; fog?: unknown } = {};
	const scene = {
		setBackground: (background: unknown) => {
			last.background = background;
		},
		setEnvironment: (environment: unknown) => {
			last.environment = environment;
		},
		setFog: (fog: unknown) => {
			last.fog = fog;
		},
	};
	const sun = { setDirection() {}, setColor() {}, setIntensity() {} };
	const context = { scene, post: { set() {} }, time: { now: 0 } };
	const stage = createMoods(context as never, sun as never, SKY as never, ROOM as never, {
		heading: 0,
		fogDensity: 0.01,
		cloudCoverage: 0.3,
		backdrop: BACKDROP,
	});
	stage.set('Night');
	const frames = (count: number) => {
		for (let k = 0; k < count; k++) stage.update(1 / 60);
	};
	return { stage, last, frames };
}

const MOODS: readonly Mood[] = ['Night', 'Auto', 'Midday', 'Studio', 'Dawn'];

test('a part that is off stays off through later frames and every mood', () => {
	for (const part of ['sky', 'fog', 'environment'] as const satisfies readonly StagePart[]) {
		const { stage, last, frames } = staged();
		stage.show(part, false);
		for (const mood of MOODS) {
			stage.set(mood);
			frames(3);
			if (part === 'sky') {
				expect(last.background).toBe(BACKDROP);
				expect(last.environment).toBeNull();
			}
			if (part === 'environment') {
				expect(last.background).not.toBe(BACKDROP);
				expect(last.environment).toBeNull();
			}
			if (part === 'fog') expect(last.fog).toBeNull();
		}
	}
});

test('a part that turns on again comes back at once, in the mood of the moment', () => {
	const { stage, last, frames } = staged();
	for (const part of ['sky', 'fog', 'environment'] as const) stage.show(part, false);
	frames(2);
	stage.show('sky', true);
	expect(last.background).not.toBe(BACKDROP);
	// The environment is still off, so the sky draws but does not light the scene.
	expect(last.environment).toBeNull();
	stage.show('environment', true);
	expect(last.environment).toBe(SKY);
	stage.show('fog', true);
	expect(last.fog).not.toBeNull();
	stage.set('Studio');
	expect(last.background).toBe(ROOM);
	expect(last.environment).toBe(ROOM);
});
