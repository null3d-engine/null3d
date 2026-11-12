// The envelope as a volume: radii by height and azimuth, the variant's turn, the room to the
// outline, solids, and the side views that measure how a plant fills it.
import { describe, expect, it } from 'bun:test';
import type { RadialEnvelope } from '../core/record';
import {
	envelopeSilhouette,
	envelopeVolume,
	flooredVolume,
	insetVolume,
	silhouetteFrame,
	silhouetteIoU,
	smoothedVolume,
} from './envelope';

const source = { method: 'hand', from: 'a test' } as const;

describe('the envelope', () => {
	it('reads radii between its heights and its azimuths, turned by the variant', () => {
		const envelope: RadialEnvelope = {
			kind: 'radial',
			heights: [0.2, 0.6, 1],
			radii: [0.1, [0.4, 0.2, 0.4, 0.2, 0.4, 0.2, 0.4, 0.2], 0],
			source,
		};
		const volume = envelopeVolume(envelope, 10, 0);
		expect(volume.base).toBeCloseTo(2, 9);
		expect(volume.top).toBeCloseTo(10, 9);
		expect(volume.reach).toBeCloseTo(4, 9);
		expect(volume.radius(6, 0)).toBeCloseTo(4, 6);
		expect(volume.radius(6, Math.PI / 4)).toBeCloseTo(2, 6);
		expect(volume.radius(4, 0)).toBeCloseTo(2.5, 6);
		expect(volume.radius(1, 0)).toBe(0);
		expect(volume.radius(11, 0)).toBe(0);
		const turned = envelopeVolume(envelope, 10, Math.PI / 4);
		expect(turned.radius(6, Math.PI / 4)).toBeCloseTo(4, 6);
	});

	it('gives room inside and none outside, and an inset keeps a margin from the outline', () => {
		const envelope: RadialEnvelope = {
			kind: 'radial',
			heights: [0.1, 1],
			radii: [0.5, 0.5],
			source,
		};
		const volume = envelopeVolume(envelope, 10, 0);
		expect(volume.room(1, 5, 0)).toBeCloseTo(4, 6);
		expect(volume.room(6, 5, 0)).toBeLessThan(0);
		expect(volume.room(0, 0.5, 0)).toBeLessThan(0);
		const inset = insetVolume(volume, 1);
		expect(inset.room(1, 5, 0)).toBeCloseTo(3, 6);
		expect(inset.room(0, 9.5, 0)).toBeLessThan(0);
		expect(inset.radius(5, 0)).toBeCloseTo(4, 6);
	});

	it('holds no room under a floor and its own room above it', () => {
		const envelope: RadialEnvelope = {
			kind: 'radial',
			heights: [0.1, 0.3, 1],
			radii: [0.4, 0.5, 0.2],
			source,
		};
		const volume = envelopeVolume(envelope, 10, 0);
		const floored = flooredVolume(volume, 2.5);
		expect(floored.base).toBeCloseTo(2.5, 9);
		expect(floored.top).toBe(volume.top);
		expect(floored.radius(2, 0)).toBe(0);
		expect(floored.radius(2.5, 0)).toBeCloseTo(volume.radius(2.5, 0), 9);
		expect(floored.radius(6, 1)).toBeCloseTo(volume.radius(6, 1), 9);
		// Below the floor a point is outside by its height under it, at least.
		expect(floored.room(0, 1.5, 0)).toBeLessThanOrEqual(-1);
		expect(floored.room(1, 6, 0)).toBeCloseTo(volume.room(1, 6, 0), 9);
		// A floor at or under the base leaves the volume as it is.
		expect(flooredVolume(volume, 1)).toBe(volume);
		expect(flooredVolume(volume, 0)).toBe(volume);
	});

	it('rounds an irregular outline toward its mean by a share, keeping the mean radius', () => {
		const envelope: RadialEnvelope = {
			kind: 'radial',
			heights: [0.5, 1],
			radii: [
				[2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
				[2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
			],
			source,
		};
		const volume = envelopeVolume(envelope, 10, 0);
		const mean = (v: typeof volume): number => {
			let total = 0;
			for (let k = 0; k < 16; k++) total += v.radius(7, (k / 16) * Math.PI * 2);
			return total / 16;
		};
		const before = mean(volume);
		const rounded = smoothedVolume(volume, 0.5);
		expect(rounded.radius(7, 0)).toBeLessThan(volume.radius(7, 0));
		expect(rounded.radius(7, Math.PI)).toBeGreaterThan(volume.radius(7, Math.PI));
		// The mean is the fixed point of the blend, so it keeps its figure.
		expect(mean(rounded)).toBeCloseTo(before, 10);
		// A share of 0 leaves the outline as it is.
		expect(smoothedVolume(volume, 0)).toBe(volume);
	});

	it('measures solids standing on the ground', () => {
		const cylinder = envelopeVolume(
			{ kind: 'shape', shape: { cylinder: { radius: 2, height: 3 } } },
			3,
			0,
		);
		expect(cylinder.radius(1.5, 1)).toBeCloseTo(2, 4);
		expect(cylinder.room(0, 4, 0)).toBeLessThan(0);
		const cone = envelopeVolume({ kind: 'shape', shape: { cone: { radius: 2, height: 4 } } }, 4, 0);
		expect(cone.radius(2, 0)).toBeCloseTo(1, 4);
		const ball = envelopeVolume({ kind: 'shape', shape: { ellipsoid: [2, 1, 2] } }, 2, 0);
		expect(ball.radius(1, 0)).toBeCloseTo(2, 4);
		expect(ball.room(0, 1, 0)).toBeGreaterThan(0);
		const union = envelopeVolume(
			{
				kind: 'shape',
				shape: {
					union: [
						{ box: [2, 1, 2], round: 0 },
						{ box: [1, 1, 1], round: 0, at: [0, 1, 0] },
					],
				},
			},
			2,
			0,
		);
		expect(union.radius(0.5, 0)).toBeCloseTo(1, 4);
		expect(union.radius(1.5, 0)).toBeCloseTo(0.5, 4);
	});

	it('draws a round envelope the same from every side, and the same mask has an IoU of 1', () => {
		const envelope: RadialEnvelope = {
			kind: 'radial',
			heights: [0.2, 1],
			radii: [0.3, 0.3],
			source,
		};
		const volume = envelopeVolume(envelope, 10, 0);
		const frame = silhouetteFrame(volume, 10, 40);
		const front = envelopeSilhouette(volume, 0, frame, 0.2);
		const side = envelopeSilhouette(volume, Math.PI / 2, frame, 0.2);
		expect(silhouetteIoU(front, side)).toBeGreaterThan(0.97);
		expect(silhouetteIoU(front, front)).toBe(1);
		let covered = 0;
		for (const cell of front) covered += cell;
		// A 6 m wide, 8 m tall crown on a 0.4 m wide, 2 m stem, in 0.25 m cells.
		expect(covered * 0.25 * 0.25).toBeCloseTo(6 * 8 + 0.4 * 2, -1);
	});
});
