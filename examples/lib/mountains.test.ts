// The ring of mountains around each showcase scene keeps the plain background out of view
// ([D-170](../../.dev/decisions/D-170-showcase-camera.md), owner, 20 October 2026). Every bearing's
// crest stands above the highest that the Manual camera can climb, the ring lies under the land
// where the two meet, so they never overlap, and it lies past the farthest the camera can reach.
import { describe, expect, it } from 'bun:test';
import * as creekLand from '../showcase/creek/land';
import * as creek from '../showcase/creek/sketch';
import * as townLand from '../showcase/night-town/land';
import * as town from '../showcase/night-town/sketch';
import { type MountainRingOptions, mountainRing } from './mountains';

/** How far the lowest crest must stand above the camera's highest reach, in meters. */
const CREST_MARGIN = 10;
/** How far under the land's edge the ring must lie where it passes under it, in meters. */
const UNDER = 0.1;

const SCENES = [
	{ name: 'night town', settings: townLand.mountainSettings, bounds: town.BOUNDS },
	{ name: 'creek', settings: creekLand.mountainSettings, bounds: creek.BOUNDS },
];
/** The bearings and rows of the ring at each quality preset, the fewest and the most. */
const DETAILS = [
	[160, 32],
	[320, 56],
] as const;

/** The highest point of each bearing of the ring's mesh, with its distance from the middle. */
function crests(options: MountainRingOptions, positions: Float32Array) {
	const { segments, rows } = options;
	return Array.from({ length: segments }, (_, c) => {
		let top = Number.NEGATIVE_INFINITY;
		let radius = 0;
		for (let k = 0; k <= rows; k++) {
			const i = (k * segments + c) * 3;
			if ((positions[i + 1] as number) > top) {
				top = positions[i + 1] as number;
				radius = Math.hypot(positions[i] as number, positions[i + 2] as number);
			}
		}
		return { top, radius };
	});
}

for (const { name, settings, bounds } of SCENES) {
	describe(`the ${name}'s mountains`, () => {
		const reach = Math.hypot(...bounds.center) + bounds.focus + bounds.distance;
		const highest = bounds.focusHeight[1] + bounds.distance;

		it('stand higher than the Manual camera can climb, except where a gorge runs into haze', () => {
			for (const [segments, rows] of DETAILS) {
				const options = settings(segments, rows);
				expect(options.heights[0]).toBeGreaterThan(highest + CREST_MARGIN);
				const ring = mountainRing(options);
				const positions = ring.arrays.positions;
				for (let c = 0; c < segments; c++) {
					// Each bearing ends high, past its crest, or runs on to a gorge's end, which the
					// scene hides in haze.
					const last = (rows * segments + c) * 3;
					const [x, y, z] = [positions[last], positions[last + 1], positions[last + 2]] as number[];
					const end = Math.hypot(x as number, z as number);
					const hazed = (options.gorges ?? []).some((g) => end >= g.end - 1);
					if (!hazed) expect(y).toBeGreaterThanOrEqual(options.heights[0] - 1e-3);
				}
				// The crest that the ring reports never dips under the lowest, between bearings too.
				for (let k = 0; k < 3600; k++)
					expect(ring.crestAt((k / 3600) * 2 * Math.PI)).toBeGreaterThanOrEqual(options.heights[0]);
			}
		});

		it('stand past the farthest that the Manual camera can reach', () => {
			for (const [segments, rows] of DETAILS) {
				const options = settings(segments, rows);
				const ring = mountainRing(options);
				for (const { top, radius } of crests(options, ring.arrays.positions))
					if (top >= options.heights[0]) expect(radius).toBeGreaterThan(reach);
			}
		});

		it('carry the valley’s own floor through each gorge, out to its end', () => {
			const options = settings(160, 32);
			const ring = mountainRing(options);
			for (const g of options.gorges ?? []) {
				for (let r = options.half + 5; r < g.end; r += 7) {
					const x = r * Math.cos(g.bearing);
					const z = r * Math.sin(g.bearing);
					expect(ring.cutAt(x, z)).toBe(1);
					expect(ring.heightAt(x, z)).toBeCloseTo(g.floor(x, z), 6);
				}
			}
		});

		it('pass under the land where the two meet, so they never overlap', () => {
			for (const [segments, rows] of DETAILS) {
				const options = settings(segments, rows);
				const positions = mountainRing(options).arrays.positions;
				for (let c = 0; c < segments; c++) {
					// The first row lies inside the land's edge and the second outside it: where the
					// edge cuts the strip between them, the ring stands under the land.
					const a = c * 3;
					const b = (segments + c) * 3;
					const [ax, ay, az] = [positions[a], positions[a + 1], positions[a + 2]] as number[];
					const [bx, by, bz] = [positions[b], positions[b + 1], positions[b + 2]] as number[];
					const bearing = Math.atan2(az as number, ax as number);
					const edge =
						options.half / Math.max(Math.abs(Math.cos(bearing)), Math.abs(Math.sin(bearing)));
					const ra = Math.hypot(ax as number, az as number);
					const rb = Math.hypot(bx as number, bz as number);
					expect(ra).toBeLessThan(edge);
					expect(rb).toBeGreaterThan(edge);
					const y = (ay as number) + ((by as number) - (ay as number)) * ((edge - ra) / (rb - ra));
					const land = options.land(edge * Math.cos(bearing), edge * Math.sin(bearing));
					expect(y).toBeLessThan(land - UNDER);
				}
			}
		});

		it('build two triangles per bearing and row, with every value a number', () => {
			for (const [segments, rows] of DETAILS) {
				const { arrays } = mountainRing(settings(segments, rows));
				expect(arrays.indices.length).toBe(segments * rows * 6);
				for (const value of arrays.positions) expect(Number.isFinite(value)).toBe(true);
				for (const value of arrays.colors) {
					expect(value).toBeGreaterThanOrEqual(0);
					expect(value).toBeLessThanOrEqual(1);
				}
			}
		});

		it('report no height inside the land, and their own height past its edge', () => {
			const options = settings(160, 32);
			const ring = mountainRing(options);
			expect(ring.heightAt(0, 0)).toBe(Number.NEGATIVE_INFINITY);
			expect(ring.heightAt(options.half - 1, 0)).toBe(Number.NEGATIVE_INFINITY);
			// At the crest, the ring stands as high as its crest.
			const bearing = 0.7;
			const top = ring.crestAt(bearing);
			let highestSeen = Number.NEGATIVE_INFINITY;
			for (let r = options.half; r < options.crest[1] + 200; r += 0.1)
				highestSeen = Math.max(
					highestSeen,
					ring.heightAt(r * Math.cos(bearing), r * Math.sin(bearing)),
				);
			expect(highestSeen).toBeCloseTo(top, 0);
		});
	});
}
