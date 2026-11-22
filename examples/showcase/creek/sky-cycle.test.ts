// The route's sky shots must show the sun and the moon where the scene's sky puts them: one shot
// looks where the sun rises, one where it sets, and one high where the moon stands at night and the
// sun at midday. The sky turns with the scene's heading, so the test reads the same table the stage
// aims by.
import { expect, test } from 'bun:test';
import { timeOfDay } from '@null3d/engine';
import { HEADING } from './look';
import { SHOTS } from './route';

/** The vertical field of view of the scene's camera, in degrees. */
const FOV = 45;

/** The direction a shot looks along, from its place toward its point. */
function look(shot: (typeof SHOTS)[number]): [number, number, number] {
	const [px, py, pz] = shot.position;
	const [tx, ty, tz] = shot.target;
	const length = Math.hypot(tx - px, ty - py, tz - pz);
	return [(tx - px) / length, (ty - py) / length, (tz - pz) / length];
}

/** The sky's direction toward the sun or the moon at an hour, in the scene's own frame. */
function body(hours: number, which: 'sun' | 'moon'): [number, number, number] {
	const day = timeOfDay(hours, { heading: HEADING, model: 'physical' });
	const at = which === 'sun' ? day.atmosphere.sunPosition : day.atmosphere.moonPosition;
	return [at[0] as number, at[1] as number, at[2] as number];
}

/** How far apart two directions are, in degrees. */
function apart(a: readonly number[], b: readonly number[]): number {
	const dot =
		(a[0] as number) * (b[0] as number) +
		(a[1] as number) * (b[1] as number) +
		(a[2] as number) * (b[2] as number);
	return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
}

/** The shots that hold still on the sky, in the order they play. */
const SKY_SHOTS = SHOTS.filter((shot) => shot.move === 'hold' && shot.seconds >= 5);

test('a held shot frames the sun rising, the sun setting, and the moon at night', () => {
	expect(SKY_SHOTS.length).toBeGreaterThanOrEqual(3);
	const [dawn, high, golden] = SKY_SHOTS as [
		(typeof SHOTS)[number],
		(typeof SHOTS)[number],
		(typeof SHOTS)[number],
	];
	// Each body stands inside the frame, with room to cross it as the day moves.
	expect(apart(look(dawn), body(6.2, 'sun')), 'the sun at dawn').toBeLessThan(FOV / 2);
	expect(apart(look(golden), body(17.6, 'sun')), 'the sun at golden hour').toBeLessThan(FOV / 2);
	expect(apart(look(high), body(23, 'moon')), 'the moon at night').toBeLessThan(FOV / 2);
	// The same high shot carries the midday sun, a few degrees away from the night moon's place.
	expect(apart(look(high), body(12, 'sun')), 'the sun at midday').toBeLessThan(FOV / 2);
});
