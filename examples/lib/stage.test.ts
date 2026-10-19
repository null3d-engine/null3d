// The stage writes the sky, the fog and the environment light every frame, so a part that the HUD
// turns off must stay off in every later frame and mood, and come back when it turns on again.
import { expect, test } from 'bun:test';
import { createMoods, lampShare, type Mood, nearestMood, type StagePart } from './stage';

const SKY = { name: 'sky' };
const ROOM = { name: 'room' };
const BACKDROP = [0.02, 0.025, 0.04] as const;

/** A stage on a scene that keeps the last value of each setter. */
function staged() {
	const last: {
		background?: unknown;
		environment?: unknown;
		fog?: { color: readonly number[]; density: number; sunGlow: number } | null;
		dir?: readonly number[];
		exposure?: number;
	} = {};
	const scene = {
		setBackground: (background: unknown) => {
			last.background = background;
		},
		setEnvironment: (environment: unknown) => {
			last.environment = environment;
		},
		setFog: (fog: { color: readonly number[]; density: number; sunGlow: number } | null) => {
			last.fog = fog;
		},
	};
	const sun = {
		setDirection(x: number, y: number, z: number) {
			last.dir = [x, y, z];
		},
		setColor() {},
		setIntensity() {},
	};
	const context = {
		scene,
		post: {
			set(settings: { exposure?: number }) {
				last.exposure = settings.exposure;
			},
		},
		time: { now: 0 },
	};
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

test('leaving the studio takes the whole look back to the hour', () => {
	const { stage, last, frames } = staged();
	// Let the hour settle first, so the stage stops writing it, then go to the studio and back.
	stage.set('Midday');
	frames(240);
	expect(last.environment).toBe(SKY);
	const middayDensity = last.fog?.density as number;
	stage.set('Studio');
	expect(last.background).toBe(ROOM);
	expect(last.environment).toBe(ROOM);
	expect(last.fog?.density).not.toBeCloseTo(middayDensity, 5);
	// The studio holds, then a fixed mood returns: every part must be the hour's again, not the
	// studio's, and the fog of the hour must be back.
	stage.set('Midday');
	frames(240);
	expect(last.background).not.toBe(ROOM);
	expect(last.environment).toBe(SKY);
	expect(last.fog?.density).toBeCloseTo(middayDensity, 5);
});

test('the light travels downward from above through every fixed mood', () => {
	const { stage, last, frames } = staged();
	// The engine gives a light's direction as the path its light takes, so a sun above the scene
	// points down. A sign flip lights the scene from below and leaves it dark.
	for (const mood of ['Dawn', 'Morning', 'Midday', 'Afternoon', 'Golden', 'Dusk', 'Night']) {
		stage.set(mood as Mood);
		frames(240);
		expect(last.dir?.[1]).toBeLessThan(0);
	}
	stage.set('Midday');
	frames(240);
	expect(last.dir?.[1]).toBeLessThan(-0.5);
});

test("a town's own lights follow the sun", () => {
	// The sun's height is the sine of its elevation: 0 is the horizon, and 1 is overhead.
	expect(lampShare(0.9)).toBe(0);
	expect(lampShare(0)).toBeCloseTo(0.32, 2);
	expect(lampShare(-0.9)).toBe(1);
	// The lamps warm up as the sun sinks and stand down as it climbs.
	expect(lampShare(0.1)).toBeGreaterThan(0);
	expect(lampShare(0.1)).toBeLessThan(0.32);
	expect(lampShare(-0.2)).toBeGreaterThan(0.32);
	expect(lampShare(-0.2)).toBeLessThan(1);
});

test("the stage's lamps are out at midday, full at night, and full in the studio", () => {
	const { stage, frames } = staged();
	stage.set('Midday');
	frames(240);
	expect(stage.lamps).toBeCloseTo(0, 3);
	stage.set('Night');
	frames(240);
	expect(stage.lamps).toBeCloseTo(1, 3);
	stage.set('Studio');
	expect(stage.lamps).toBe(1);
});

test('the daylight hours hold midday’s exposure, and a low sun opens it up', () => {
	const { stage, last, frames } = staged();
	stage.set('Midday');
	frames(240);
	const midday = last.exposure as number;
	// Morning and afternoon hold the same exposure, so the sun's own height sets how bright each
	// hour reads. The exposure must not even them out, or every hour reads as bright as the next.
	for (const mood of ['Morning', 'Afternoon'] as const) {
		stage.set(mood);
		frames(240);
		expect(last.exposure).toBeCloseTo(midday, 4);
	}
	// A camera opens up for a low sun, at dawn and at golden hour.
	for (const mood of ['Dawn', 'Golden'] as const) {
		stage.set(mood);
		frames(240);
		expect(last.exposure as number).toBeGreaterThan(midday);
	}
	// Night takes the physical model's own exposure, which lights the moonlit scene.
	stage.set('Night');
	frames(240);
	expect(last.exposure as number).toBeGreaterThan(midday);
});

test('the slider holds any hour, and Auto moves it again', () => {
	const { stage, frames } = staged();
	stage.setHour(18.4);
	frames(240);
	expect(stage.hours).toBeCloseTo(18.4, 3);
	expect(stage.auto).toBe(false);
	stage.set('Auto');
	frames(60);
	expect(stage.auto).toBe(true);
	expect(stage.hours).not.toBeCloseTo(18.4, 3);
});

test('the fixed mood nearest an hour carries the look of the moment', () => {
	expect(nearestMood(6.2)).toBe('Dawn');
	expect(nearestMood(12)).toBe('Midday');
	expect(nearestMood(17.6)).toBe('Golden');
	// Around the clock: an hour after midnight is nearest to the night, not to the dawn.
	expect(nearestMood(23.5)).toBe('Night');
	expect(nearestMood(0.5)).toBe('Night');
	expect(nearestMood(8)).toBe('Morning');
});
