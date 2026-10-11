import { describe, expect, test } from 'bun:test';
import { timeOfDay } from '@null3d/engine';
import { mergeMeshes, placed, triangleCount } from '../../lib/compare-scene';
import { glowTexture, type ParticleRows, puffTexture, rainTexture } from '../../lib/particles';
import {
	BLOCK_PITCH,
	BLOCK_SIZE,
	buildingDesigns,
	buildingHeight,
	CARS_PER_BLOCK,
	carPose,
	createNightTown,
	EXHAUST_PER_CAR,
	FLICKER_LOW,
	facadeMaps,
	facadeMesh,
	GLOWS_PER_BLOCK,
	LIGHTS_PER_BLOCK,
	LOOP_HALF,
	LOOP_LENGTH,
	LOT_SIZE,
	LOTS_PER_BLOCK,
	lampLight,
	loopPose,
	lotOf,
	lotPlace,
	MAX_BLOCKS,
	NIGHT_HOLD,
	NIGHT_LOOK,
	NIGHT_RAMPS,
	nightBlocks,
	nightMeshes,
	nightObjects,
	nightTriangles,
	PARKED_PER_BLOCK,
	parkedPose,
	RAIN_BOX,
	RAIN_DROPS,
	SIGNS_PER_BLOCK,
	STEAM_PER_BLOCK,
	signFlicker,
	signLight,
	signPlace,
	streetMaps,
	townHash,
	trimMesh,
	writeExhaust,
	writeGlows,
	writeRain,
	writeSteam,
} from './scene';

/** Rows for `count` particles. */
function rows(count: number): ParticleRows {
	return {
		positions: new Float32Array(count * 3),
		sizes: new Float32Array(count * 2),
		colors: new Float32Array(count * 4),
	};
}

describe('Night town', () => {
	test('the count is lights, and the town grows by whole blocks of them', () => {
		expect(LIGHTS_PER_BLOCK).toBe(12);
		expect(nightBlocks(1)).toBe(1);
		expect(nightBlocks(12)).toBe(1);
		expect(nightBlocks(13)).toBe(2);
		expect(nightBlocks(1_020)).toBe(85);
		expect(nightBlocks(1e9)).toBe(MAX_BLOCKS);
		expect(nightObjects(120, 'scene-graph')).toBeGreaterThan(nightObjects(12, 'scene-graph'));
		expect(nightObjects(120, 'instanced')).toBeLessThan(nightObjects(120, 'scene-graph'));
	});

	test('the ramps stay under the 1,024 lights that both engines list at once, and the hold fits', () => {
		for (const plan of Object.values(NIGHT_RAMPS)) {
			expect(plan.max).toBeLessThanOrEqual(1_024);
			expect(plan.start).toBeLessThan(plan.max);
		}
		expect(NIGHT_HOLD.count % LIGHTS_PER_BLOCK).toBe(0);
	});

	test('the look is the night of timeOfDay, with the moon low in the north-west', () => {
		const night = timeOfDay(NIGHT_LOOK.time.hours, {
			heading: NIGHT_LOOK.time.heading,
			noonElevation: NIGHT_LOOK.time.noonElevation,
		});
		expect(night.sky.sunPosition).toEqual([...NIGHT_LOOK.sky.sunPosition]);
		expect(night.sky.turbidity).toBe(NIGHT_LOOK.sky.turbidity);
		expect(night.sky.rayleigh).toBe(NIGHT_LOOK.sky.rayleigh);
		expect(night.skyIntensity).toBeCloseTo(NIGHT_LOOK.skyIntensity, 12);
		expect(night.light.direction).toEqual([...NIGHT_LOOK.moon.direction]);
		expect(night.light.color).toEqual([...NIGHT_LOOK.moon.color]);
		expect(night.light.intensity).toBe(NIGHT_LOOK.moon.intensity);
		expect(night.exposure).toBe(NIGHT_LOOK.exposure);
		// Low enough to show in the wide shot, toward -X and -Z.
		const [x, y, z] = NIGHT_LOOK.sky.sunPosition;
		expect(Math.asin(y) * (180 / Math.PI)).toBeLessThan(30);
		expect(x).toBeLessThan(0);
		expect(z).toBeLessThan(0);
	});

	test("the hash matches the shaders' integer math and spreads its values", () => {
		// Values the WGSL and GLSL give for the same inputs, worked out by hand from the same steps.
		expect(townHash(0, 0, 0)).toBe(0);
		const values = Array.from({ length: 4096 }, (_, i) => townHash(i, i * 7 - 2048, -i));
		const mean = values.reduce((a, b) => a + b, 0) / values.length;
		expect(mean).toBeGreaterThan(0.45);
		expect(mean).toBeLessThan(0.55);
		for (const v of values) {
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
	});

	test('every point of a building gives its lot, and the lots of a block differ', () => {
		const town = createNightTown(25);
		const lot = new Int32Array(2);
		const place = new Float64Array(3);
		const seen = new Set<string>();
		for (let b = 0; b < 25; b++)
			for (let l = 0; l < LOTS_PER_BLOCK; l++) {
				lotPlace(town, b, l, place);
				const design = town.designs[town.lotDesign[b * LOTS_PER_BLOCK + l] as number];
				const reach = Math.max(design?.width ?? 0, design?.depth ?? 0) / 2;
				expect(reach).toBeLessThan(LOT_SIZE / 2);
				const keys = new Set<string>();
				for (const [dx, dz] of [
					[-reach, -reach],
					[reach, reach],
					[0, 0],
				] as const) {
					lotOf((place[0] as number) + dx, (place[1] as number) + dz, lot);
					keys.add(`${lot[0]},${lot[1]}`);
				}
				expect(keys.size).toBe(1);
				const key = [...keys][0] as string;
				expect(seen.has(key)).toBe(false);
				seen.add(key);
			}
	});

	test("a sign's light flickers with its tubes' lot, and mostly stays on", () => {
		const town = createNightTown(4);
		const lot = new Int32Array(2);
		const place = new Float64Array(3);
		const tubes = new Int32Array(2);
		signPlace(town, 2, 1, place, lot);
		// The tubes' shader takes the lot of the board's origin, just outside the wall.
		lotOf(place[0] as number, place[1] as number, tubes);
		expect([...tubes]).toEqual([...lot]);
		let low = 0;
		for (let step = 0; step < 6000; step++)
			if (signFlicker(step / 15, lot[0] as number, lot[1] as number) === FLICKER_LOW) low++;
		expect(low / 6000).toBeGreaterThan(0.01);
		expect(low / 6000).toBeLessThan(0.07);
	});

	test("the cars' loop is closed, smooth and stays in its lane", () => {
		const a = new Float64Array(3);
		const b = new Float64Array(3);
		loopPose(0, a);
		loopPose(LOOP_LENGTH, b);
		expect(b[0]).toBeCloseTo(a[0] as number, 6);
		expect(b[1]).toBeCloseTo(a[1] as number, 6);
		for (let s = 0; s < LOOP_LENGTH; s += 0.25) {
			loopPose(s, a);
			loopPose(s + 0.01, b);
			// Each step moves along the heading, and never leaves the lane's square.
			const heading = a[2] as number;
			const dx = (b[0] as number) - (a[0] as number);
			const dz = (b[1] as number) - (a[1] as number);
			expect(Math.hypot(dx, dz)).toBeCloseTo(0.01, 4);
			expect(dx * Math.sin(heading) + dz * Math.cos(heading)).toBeGreaterThan(0.0099);
			expect(Math.max(Math.abs(a[0] as number), Math.abs(a[1] as number))).toBeLessThanOrEqual(
				LOOP_HALF + 1e-9,
			);
			expect(Math.max(Math.abs(a[0] as number), Math.abs(a[1] as number))).toBeGreaterThan(
				BLOCK_SIZE / 2 + 1,
			);
		}
	});

	test('moving cars never touch parked cars or each other', () => {
		const town = createNightTown(9);
		const car = new Float64Array(3);
		const other = new Float64Array(3);
		for (let t = 0; t < 20; t += 0.1)
			for (let b = 0; b < 9; b++)
				for (let c = 0; c < CARS_PER_BLOCK; c++) {
					carPose(town, b, c, t, car);
					for (let p = 0; p < PARKED_PER_BLOCK; p++) {
						parkedPose(town, b, p, other);
						expect(
							Math.hypot(
								(car[0] as number) - (other[0] as number),
								(car[1] as number) - (other[1] as number),
							),
						).toBeGreaterThan(1.9);
					}
					for (let d = c + 1; d < CARS_PER_BLOCK; d++) {
						carPose(town, b, d, t, other);
						expect(
							Math.hypot(
								(car[0] as number) - (other[0] as number),
								(car[1] as number) - (other[1] as number),
							),
						).toBeGreaterThan(5);
					}
				}
	});

	test('lamps and signs light the street from over the sidewalk, and blocks sit on their grid', () => {
		const town = createNightTown(9);
		const at = new Float64Array(3);
		const lot = new Int32Array(2);
		for (let b = 0; b < 9; b++) {
			const cx = town.center[b * 2] as number;
			const cz = town.center[b * 2 + 1] as number;
			expect(Math.abs(cx % BLOCK_PITCH)).toBe(0);
			expect(Math.abs(cz % BLOCK_PITCH)).toBe(0);
			lampLight(town, b, 0, at);
			expect(at[1]).toBeGreaterThan(5);
			for (let s = 0; s < SIGNS_PER_BLOCK; s++) {
				signLight(town, b, s, at, lot);
				expect(at[1]).toBeGreaterThan(4);
				expect(Math.abs((at[2] as number) - cz)).toBeLessThan(BLOCK_SIZE / 2);
			}
		}
	});

	test('the meshes merge within the 16-bit index, and the triangle count grows with the town', () => {
		const designs = buildingDesigns();
		for (const [d, design] of designs.entries()) {
			const facade = facadeMesh(design);
			const trim = trimMesh(design, d);
			expect(facade.position.length / 3).toBeLessThan(65_536);
			expect(trim.position.length / 3).toBeLessThan(65_536);
			// The roof lies at the building's height.
			let top = 0;
			for (let i = 1; i < facade.position.length; i += 3)
				top = Math.max(top, facade.position[i] as number);
			expect(top).toBeCloseTo(buildingHeight(design), 4);
		}
		const town = createNightTown(25);
		const meshes = nightMeshes(25, town.designs);
		expect(nightTriangles(town, 300, meshes)).toBeGreaterThan(nightTriangles(town, 12, meshes));
		const merged = mergeMeshes([meshes.carBody, placed(meshes.carCabin, Math.PI, 1, 0, 0)]);
		expect(triangleCount(merged)).toBe(
			triangleCount(meshes.carBody) + triangleCount(meshes.carCabin),
		);
	});

	test('the textures are made at their sizes, with windows in the facade map', () => {
		const brick = facadeMaps('brick');
		let glass = 0;
		for (let i = 3; i < brick.color.data.length; i += 4) if (brick.color.data[i] === 255) glass++;
		const share = glass / (brick.color.size * brick.color.size);
		expect(share).toBeGreaterThan(0.1);
		expect(share).toBeLessThan(0.6);
		const street = streetMaps();
		expect(street.puddles.data.length).toBe(street.puddles.size ** 2 * 4);
		for (const t of [rainTexture(), puffTexture(), glowTexture()])
			expect(t.data.length).toBe(t.size ** 2 * 4);
	});

	test('the particle writers fill their rows from the time alone', () => {
		const town = createNightTown(9);
		const steam = rows(9 * STEAM_PER_BLOCK);
		const exhaust = rows(9 * CARS_PER_BLOCK * EXHAUST_PER_CAR);
		const glows = rows(9 * GLOWS_PER_BLOCK);
		const rain = rows(RAIN_DROPS);
		expect(writeSteam(town, 4, steam)).toBe(9 * STEAM_PER_BLOCK);
		expect(writeExhaust(town, 4, exhaust)).toBe(9 * CARS_PER_BLOCK * EXHAUST_PER_CAR);
		expect(writeGlows(town, 4, glows)).toBe(9 * GLOWS_PER_BLOCK);
		const camera = [10, 2, -5];
		expect(writeRain(4, camera, rain)).toBe(RAIN_DROPS);
		for (let i = 0; i < RAIN_DROPS; i++) {
			expect(Math.abs((rain.positions[i * 3] as number) - 10)).toBeLessThanOrEqual(
				RAIN_BOX.half + 1e-4,
			);
			expect(Math.abs((rain.positions[i * 3 + 2] as number) + 5)).toBeLessThanOrEqual(
				RAIN_BOX.half + 1e-4,
			);
		}
		// The same time writes the same rows.
		const again = rows(9 * STEAM_PER_BLOCK);
		writeSteam(town, 4, again);
		expect(again.positions).toEqual(steam.positions);
		for (let i = 3; i < steam.colors.length; i += 4)
			expect(steam.colors[i]).toBeGreaterThanOrEqual(0);
	});
});
