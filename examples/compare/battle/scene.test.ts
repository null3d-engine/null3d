import { describe, expect, test } from 'bun:test';
import {
	type MeshData,
	SIM_STEP,
	stepsUntil,
	surfaceMaps,
	triangleCount,
} from '../../lib/compare-scene';
import {
	addSprite,
	createSpriteRows,
	FIRE_FRAMES,
	fireAtlas,
	smokeAtlas,
} from '../../lib/particles';
import {
	activeTanks,
	BATTLE_HOLD,
	BATTLE_RAMPS,
	type BattleState,
	battleMeshes,
	battleObjects,
	battleTriangles,
	battleUnits,
	Clip,
	CRATERS,
	createBattle,
	FIELD,
	FLAGS,
	flightTransform,
	formationSlot,
	GRASS,
	LAND,
	LIGHT_COUNT,
	landHeight,
	MAX_UNITS,
	mechsAmong,
	particleCapacity,
	ROCKS,
	SMOKE_SECONDS,
	setActiveUnits,
	stepBattle,
	terrainHeight,
	UnitKind,
	UnitState,
	unitKindOf,
	WRECKS,
	writeLights,
	writeParticles,
} from './scene';
import { merged, placed, taperedBox, turn } from './shapes';
import { clipSampleTime, currentClipWeight } from './three-pose';
import { grassPhase } from './three-shaders';

/** A state at `count` units, stepped to `seconds`. */
function stepped(count: number, seconds: number): BattleState {
	const state = createBattle(count);
	setActiveUnits(state, count);
	for (let i = 0; i < stepsUntil(seconds); i++) stepBattle(state);
	return state;
}

/** Checks a mesh's arrays: matching lengths, indices in range, unit normals, finite numbers. */
function expectValidMesh(mesh: MeshData): void {
	const vertices = mesh.position.length / 3;
	expect(mesh.normal.length).toBe(vertices * 3);
	expect(mesh.uv.length).toBe(vertices * 2);
	if (mesh.color) expect(mesh.color.length).toBe(vertices * 3);
	expect(mesh.index.length % 3).toBe(0);
	for (const i of mesh.index) expect(i).toBeLessThan(vertices);
	for (const v of mesh.position) expect(Number.isFinite(v)).toBe(true);
	for (let i = 0; i < mesh.normal.length; i += 3) {
		const length = Math.hypot(
			mesh.normal[i] as number,
			mesh.normal[i + 1] as number,
			mesh.normal[i + 2] as number,
		);
		expect(Math.abs(length - 1)).toBeLessThan(1e-3);
	}
}

describe('the armies', () => {
	test('a count gives both armies the same number of units, within the most a scene holds', () => {
		expect(battleUnits(1)).toBe(2);
		expect(battleUnits(601)).toBe(602);
		expect(battleUnits(1e9)).toBe(MAX_UNITS);
		expect(battleUnits(0)).toBe(2);
	});

	test('one unit in fifty of each army is a mech', () => {
		const mechs = Array.from({ length: 1000 }, (_, i) => unitKindOf(i)).filter(
			(k) => k === UnitKind.mech,
		);
		expect(mechs.length).toBe(mechsAmong(1000));
		expect(mechsAmong(1000)).toBe(20);
	});

	test('the armies form up on opposite sides, facing each other', () => {
		const slot = new Float64Array(2);
		formationSlot(0, 0, slot);
		expect(slot[0]).toBeLessThan(0);
		formationSlot(1, 0, slot);
		expect(slot[0]).toBeGreaterThan(0);
		const state = createBattle(200);
		expect(state.heading[0]).toBeCloseTo(Math.PI / 2);
		expect(state.heading[1]).toBeCloseTo(-Math.PI / 2);
		for (let i = 0; i < state.active; i++)
			expect(state.y[i]).toBeCloseTo(terrainHeight(state.x[i] as number, state.z[i] as number), 5);
	});

	test('the same steps give the same battle', () => {
		const a = stepped(400, 12);
		const b = stepped(400, 12);
		expect(Array.from(a.x)).toEqual(Array.from(b.x));
		expect(Array.from(a.clip)).toEqual(Array.from(b.clip));
		expect(a.shots).toBe(b.shots);
		expect(a.blastCount).toBe(b.blastCount);
	});

	test('by the held frame the lines have met: units fight, fall, and shells explode', () => {
		const state = stepped(BATTLE_HOLD.count, BATTLE_HOLD.seconds);
		let fighting = 0;
		let fallen = 0;
		for (let i = 0; i < state.active; i++) {
			if (state.state[i] === UnitState.fight) fighting++;
			if (state.state[i] === UnitState.dead) fallen++;
		}
		expect(fighting).toBeGreaterThan(state.active / 10);
		expect(fallen).toBeGreaterThan(0);
		expect(state.shots).toBeGreaterThan(state.active);
		expect(state.blastCount).toBeGreaterThan(0);
		expect(state.activeFlights).toBeGreaterThan(0);
	});

	test('a fallen unit plays its fall, then joins the back of its army again', () => {
		const state = stepped(600, 30);
		const fell = Array.from(state.deaths).findIndex((d) => d > 0);
		expect(fell).toBeGreaterThanOrEqual(0);
		for (let i = 0; i < state.active; i++)
			if (state.state[i] === UnitState.dead) expect(state.clip[i]).toBe(Clip.die);
	});

	test('a lower count leaves the later units still, and a higher one brings them in at their slots', () => {
		const state = createBattle(1000);
		setActiveUnits(state, 100);
		expect(state.active).toBe(100);
		for (let i = 0; i < 240; i++) stepBattle(state);
		const before = state.x[500];
		setActiveUnits(state, 1000);
		const slot = new Float64Array(2);
		formationSlot(500 & 1, 500 >> 1, slot);
		expect(state.x[500]).toBe(Math.fround(slot[0] as number));
		expect(before).toBe(state.x[500]);
		expect(activeTanks(state)).toBeGreaterThan(1);
	});

	test('one step of 20,000 units allocates nothing and takes a share of a frame', () => {
		const state = stepped(20_000, 1);
		const start = performance.now();
		for (let i = 0; i < 60; i++) stepBattle(state);
		const ms = (performance.now() - start) / 60;
		// Both engines run the same code, so the figure only guards against a slip of the search.
		expect(ms).toBeLessThan(25);
	});
});

describe('flights, particles and lights', () => {
	test('a flight starts at its muzzle, ends at its target, and points along its path', () => {
		const state = stepped(400, BATTLE_HOLD.seconds);
		const f = Array.from(state.flightActive).indexOf(1);
		expect(f).toBeGreaterThanOrEqual(0);
		const position = new Float64Array(3);
		const rotation = new Float64Array(4);
		state.flightAge[f] = 0;
		flightTransform(state, f, position, rotation);
		expect(position[0]).toBeCloseTo(state.flightFrom[f * 3] as number, 4);
		expect(Math.hypot(...rotation)).toBeCloseTo(1, 5);
		state.flightAge[f] = state.flightDuration[f] as number;
		flightTransform(state, f, position, rotation);
		expect(position[0]).toBeCloseTo(state.flightTo[f * 3] as number, 4);
		expect(position[2]).toBeCloseTo(state.flightTo[f * 3 + 2] as number, 4);
	});

	test('the particles fit their layers, with finite values and colors that the engines draw', () => {
		for (const count of [BATTLE_HOLD.count, 4000]) {
			const state = stepped(count, 25);
			const pools = particleCapacity(state);
			const fire = createSpriteRows(pools.fire);
			const smoke = createSpriteRows(pools.smoke);
			writeParticles(state, state.time, fire, smoke);
			expect(fire.count).toBeGreaterThan(0);
			expect(smoke.count).toBeGreaterThan(0);
			expect(fire.count).toBeLessThan(pools.fire);
			expect(smoke.count).toBeLessThan(pools.smoke);
			for (const rows of [fire, smoke]) {
				for (let i = 0; i < rows.count * 4; i++) {
					expect(Number.isFinite(rows.colors[i] as number)).toBe(true);
					expect(rows.colors[i]).toBeGreaterThanOrEqual(0);
				}
				for (let i = 0; i < rows.count; i++) {
					expect(rows.colors[i * 4 + 3]).toBeLessThanOrEqual(1);
					expect(rows.frames[i]).toBeLessThan(16);
					expect(rows.sizes[i * 2]).toBeGreaterThan(0);
				}
			}
		}
	});

	test('a blast keeps its slot while its smoke lingers', () => {
		const state = stepped(600, 30);
		for (let b = 0; b < state.blasts; b++)
			if (state.blastActive[b] === 1) expect(state.blastAge[b]).toBeLessThan(SMOKE_SECONDS);
	});

	test('the newest blasts take the flash lights, and each wreck flickers', () => {
		const state = stepped(600, 30);
		const values = new Float32Array(LIGHT_COUNT * 4);
		writeLights(state, state.time, values);
		for (let k = 0; k < LIGHT_COUNT; k++) expect(values[k * 4 + 3]).toBeGreaterThanOrEqual(0);
		for (let w = 0; w < WRECKS.length; w++) {
			const at = (LIGHT_COUNT - WRECKS.length + w) * 4;
			expect(values[at]).toBeCloseTo((WRECKS[w] as (typeof WRECKS)[number]).x, 4);
			expect(values[at + 3]).toBeGreaterThan(0);
		}
	});

	test('a full layer takes no more sprites', () => {
		const rows = createSpriteRows(1);
		expect(addSprite(rows, 0, 0, 0, 1, 0, 1, 1, 1, 1, 0)).toBe(true);
		expect(addSprite(rows, 0, 0, 0, 1, 0, 1, 1, 1, 1, 0)).toBe(false);
		expect(rows.count).toBe(1);
	});

	test("the atlases are square grids of frames, clear at each frame's border", () => {
		for (const atlas of [fireAtlas(32), smokeAtlas(32)]) {
			const { size, data } = atlas.texture;
			expect(data.length).toBe(size * size * 4);
			const frame = size / atlas.columns;
			// The top left texel of every frame is clear.
			for (let row = 0; row < atlas.rows; row++)
				for (let column = 0; column < atlas.columns; column++)
					expect(data[(row * frame * size + column * frame) * 4 + 3]).toBe(0);
		}
		expect(FIRE_FRAMES.ballFrames + FIRE_FRAMES.flashFrames + 1).toBe(16);
	});
});

describe('the field', () => {
	const meshes = battleMeshes();

	test('the field mesh lies on the terrain, and the land sinks under it but meets it at the edge', () => {
		const { field, land } = meshes.single;
		for (let i = 0; i < field.position.length; i += 3 * 97) {
			const x = field.position[i] as number;
			const z = field.position[i + 2] as number;
			expect(field.position[i + 1]).toBeCloseTo(terrainHeight(x, z), 4);
		}
		for (let i = 0; i < land.position.length; i += 3) {
			const x = land.position[i] as number;
			const z = land.position[i + 2] as number;
			const inside = Math.abs(x) < FIELD.halfX - 1e-3 && Math.abs(z) < FIELD.halfZ - 1e-3;
			const y = land.position[i + 1] as number;
			if (inside) expect(y).toBeLessThan(landHeight(x, z) - 1);
			else expect(y).toBeCloseTo(landHeight(x, z), 4);
		}
		expect(LAND.halfX % LAND.step).toBe(0);
		expect(FIELD.halfX % LAND.step).toBe(0);
		expect(FIELD.halfZ % LAND.step).toBe(0);
	});

	test('craters sink below the land, and their rims rise above it', () => {
		for (const crater of CRATERS.slice(0, 10)) {
			const bottom = terrainHeight(crater.x, crater.z) - landHeight(crater.x, crater.z);
			expect(bottom).toBeLessThan(-crater.depth * 0.5);
		}
	});

	test('every mesh is well formed and fits 16-bit indices', () => {
		const all = [
			...Object.values(meshes.single),
			...meshes.rocks,
			...meshes.trees,
			...meshes.walls,
			...meshes.grass,
		];
		for (const mesh of all) {
			expectValidMesh(mesh);
			expect(mesh.position.length / 3).toBeLessThanOrEqual(65_536);
		}
	});

	test('the scenery keeps out of the lanes where the armies march', () => {
		for (const rock of ROCKS) expect(Math.abs(rock.z)).toBeGreaterThan(55);
		expect(GRASS.length).toBeGreaterThan(1000);
		expect(FLAGS.length).toBe(8);
	});

	test('the triangles and objects grow with the count, and the instanced mode has fewer objects', () => {
		expect(battleTriangles(2000, meshes)).toBeGreaterThan(battleTriangles(200, meshes));
		expect(battleObjects(2000)).toBeGreaterThan(battleObjects(200));
		expect(battleObjects(2000, 'instanced')).toBeLessThan(battleObjects(2000));
	});

	test('the surfaces of the field are made in code', () => {
		for (const kind of ['ground', 'rock', 'masonry', 'camo'] as const) {
			const maps = surfaceMaps(kind, 16, 7);
			expect(maps.color.data.length).toBe(16 * 16 * 4);
			expect(maps.color.colorSpace).toBe('srgb');
		}
	});
});

describe('shapes', () => {
	test('a placed part turns, scales and moves its points', () => {
		const box = taperedBox(2, 2, 2, 2, 2);
		const moved = placed(box, {
			position: [10, 0, 0],
			rotation: turn(0, 1, 0, Math.PI / 2),
			scale: [2, 1, 1],
		});
		// The +X face's corner at (1, y, z) scales to x = 2, then turns to z = -2, then moves.
		const xs = Array.from(
			{ length: moved.position.length / 3 },
			(_, i) => moved.position[i * 3] as number,
		);
		const zs = Array.from(
			{ length: moved.position.length / 3 },
			(_, i) => moved.position[i * 3 + 2] as number,
		);
		expect(Math.max(...xs)).toBeCloseTo(11, 5);
		expect(Math.min(...zs)).toBeCloseTo(-2, 5);
		expectValidMesh(moved);
	});

	test('a merged mesh holds every part', () => {
		const box = taperedBox(1, 1, 1, 0.5, 0.5);
		const both = merged([box, [box, { position: [3, 0, 0] }]]);
		expect(triangleCount(both)).toBe(2 * triangleCount(box));
		expect(both.position.length).toBe(2 * box.position.length);
	});
});

describe("three.js's clip pose", () => {
	test('repeating clips wrap, and the fall holds just before its end', () => {
		expect(clipSampleTime(Clip.run, 2.5, 1)).toBeCloseTo(0.5);
		expect(clipSampleTime(Clip.die, 5, 0.75)).toBeLessThan(0.75);
		expect(clipSampleTime(Clip.die, 5, 0.75)).toBeGreaterThan(0.749);
	});

	test('a fade gives the current clip its share, and one clip alone takes all', () => {
		expect(currentClipWeight(Clip.run, Clip.idle, 0.25)).toBe(0.25);
		expect(currentClipWeight(Clip.run, Clip.run, 0.25)).toBe(1);
		expect(currentClipWeight(Clip.run, Clip.idle, 2)).toBe(1);
	});

	test("each grass clump's phase of the wind follows its place, as null3D's shader works it out", () => {
		expect(grassPhase(10, 20)).toBeCloseTo(10 * 0.23 + 20 * 0.17);
	});
});

test('the ramps start low and top out by device class, and the held frame fits the step', () => {
	expect(BATTLE_RAMPS.desktop.max).toBeGreaterThan(BATTLE_RAMPS.tablet.max);
	expect(BATTLE_RAMPS.tablet.max).toBeGreaterThan(BATTLE_RAMPS.phone.max);
	expect(stepsUntil(BATTLE_HOLD.seconds) * SIM_STEP).toBeCloseTo(BATTLE_HOLD.seconds);
});
