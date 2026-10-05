import { beforeEach, describe, expect, test } from 'bun:test';
import {
	Quaternion,
	DirectionalLight as ThreeDirectional,
	PointLight as ThreePoint,
	SpotLight as ThreeSpot,
	Vector3,
} from 'three';
import { type EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import * as C from '../generated/core';
import { fromHex } from '../math/color';
import type { CoreGlue } from '../shared/core';
import { CoreMemory } from './memory';
import { type Light, Scene } from './scene';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/** Scene slots of the fake core, and records of its command ring. */
const CAPACITY = 31;
const RING = 256;
/** Where the fake core keeps its arrays in memory: each scene field, then the ring. */
const AT = { fields: 0, records: 8192, write: 12288, read: 12292 };
/** The frame that the fake scene says it runs. */
const FRAME = 3;

/** A core that hands out slots and light rows, keeps the command ring, and records light calls. */
function fakeCore() {
	const memory = new WebAssembly.Memory({ initial: 1 });
	let slot = 0;
	let row = 0;
	/** Each light row's kind, object, colors by code and numbers by code. */
	const rows = new Map<
		number,
		{
			kind: number;
			handle: number;
			colors: number[][];
			values: (number | undefined)[];
			live: boolean;
		}
	>();
	const glue = {
		sceneCapacity: () => CAPACITY,
		sceneArrays: (field: number) => AT.fields + field * 512,
		commandRing: (field: number) => [AT.records, RING, AT.write, AT.read][field] as number,
		reserveObject: () => ++slot,
		createLight: (handle: number, kind: number) => {
			rows.set(++row, { kind, handle, colors: [], values: [], live: true });
			return row;
		},
		destroyLight: (light: number) => {
			(rows.get(light) as { live: boolean }).live = false;
			return 0;
		},
		setLightColor: (light: number, which: number, r: number, g: number, b: number) => {
			(rows.get(light) as { colors: number[][] }).colors[which] = [r, g, b];
			return 0;
		},
		setLightValue: (light: number, which: number, value: number) => {
			(rows.get(light) as { values: (number | undefined)[] }).values[which] = value;
			return 0;
		},
		lastErrorCode: () => 0,
		lastErrorDetail: () => 0,
	};
	const core = new CoreMemory(glue as unknown as CoreGlue, memory);
	const scene = new Scene(core, { frame: FRAME }, false);
	/** The command records the scene queued, as [operation, handle, a, b]. */
	const commands = () => {
		const words = new Uint32Array(memory.buffer, AT.records, RING * C.COMMAND_WORDS);
		const written = new Uint32Array(memory.buffer, AT.write, 1)[0] as number;
		return Array.from({ length: written }, (_, k) => [...words.subarray(k * 4, k * 4 + 4)]);
	};
	/** A light's row in the fake light table. */
	const tableRow = (light: Light) => rows.get(light.id) as NonNullable<ReturnType<typeof rows.get>>;
	/** An object's rotation quaternion, as the scene wrote it. */
	const rotation = (light: Light) => [
		...new Float32Array(
			memory.buffer,
			AT.fields + C.SCENE_FIELD_ROTATIONS * 512 + light.slot * 16,
			4,
		),
	];
	/** The direction of an object's -Z axis after its rotation. */
	const pointing = (light: Light) => {
		const [x, y, z, w] = rotation(light) as [number, number, number, number];
		return new Vector3(0, 0, -1).applyQuaternion(new Quaternion(x, y, z, w)).toArray();
	};
	return { scene, commands, tableRow, rotation, pointing };
}

/** The error that `call` throws. */
function thrown(call: () => void): EngineError {
	try {
		call();
	} catch (error) {
		return error as EngineError;
	}
	throw new Error('the call did not throw');
}

/** Expects two lists of numbers to match to about the precision of a 32-bit float. */
function expectClose(actual: ArrayLike<number>, expected: ArrayLike<number>): void {
	expect(actual.length).toBe(expected.length);
	for (let k = 0; k < expected.length; k++)
		expect(actual[k] as number).toBeCloseTo(expected[k] as number, 6);
}

/** A hex color in linear RGB, as the engine lights with it. */
const linear = (hex: number) => fromHex([0, 0, 0], hex);

describe('creating lights', () => {
	test('each create call makes an object and a light row of its kind', () => {
		const { scene, commands, tableRow } = fakeCore();
		const lights = [
			scene.createDirectionalLight(),
			scene.createPointLight({ range: 5 }),
			scene.createSpotLight({ range: 5 }),
			scene.createHemisphereLight(),
			scene.createAmbientLight(),
		];
		const kinds = [
			C.LIGHT_KIND_DIRECTIONAL,
			C.LIGHT_KIND_POINT,
			C.LIGHT_KIND_SPOT,
			C.LIGHT_KIND_HEMISPHERE,
			C.LIGHT_KIND_AMBIENT,
		];
		expect(lights.map((light) => tableRow(light).kind)).toEqual(kinds);
		expect(lights.map((light) => tableRow(light).handle)).toEqual(lights.map((l) => l.handle));
		const creates = commands().filter(([op]) => ((op as number) & 0xff) === C.COMMAND_CREATE);
		expect(creates.map(([op, handle, parent, mesh]) => [op, handle, parent, mesh])).toEqual(
			lights.map((light) => [
				C.COMMAND_CREATE | (C.FLAG_VISIBLE << 8),
				light.handle,
				0,
				C.CORE_NO_MESH,
			]),
		);
	});

	test('lights keep the defaults of the light table, and write only the options given', () => {
		const { scene, tableRow } = fakeCore();
		const sun = scene.createDirectionalLight();
		expect(tableRow(sun).colors).toEqual([]);
		expect(tableRow(sun).values).toEqual([]);
		// A point light's range has no default, so it is always written.
		const lamp = scene.createPointLight({ range: 4 });
		expect(tableRow(lamp).values).toEqual([undefined, 4]);
	});

	test('the options land in their fields, colors in linear RGB', () => {
		const { scene, tableRow } = fakeCore();
		const spot = scene.createSpotLight({
			color: 0xff8800,
			intensity: 30,
			range: 12,
			decay: 1.5,
			angle: 0.4,
			penumbra: 0.25,
		});
		expectClose(tableRow(spot).colors[C.LIGHT_COLOR_MAIN] as number[], linear(0xff8800));
		const values = tableRow(spot).values;
		expect(values[C.LIGHT_VALUE_INTENSITY]).toBe(30);
		expect(values[C.LIGHT_VALUE_RANGE]).toBe(12);
		expect(values[C.LIGHT_VALUE_DECAY]).toBe(1.5);
		expect(values[C.LIGHT_VALUE_ANGLE]).toBe(0.4);
		expect(values[C.LIGHT_VALUE_PENUMBRA]).toBe(0.25);

		const sky = scene.createHemisphereLight({
			skyColor: '#dfe8ff',
			groundColor: '#404040',
			intensity: 0.6,
		});
		expectClose(tableRow(sky).colors[C.LIGHT_COLOR_MAIN] as number[], linear(0xdfe8ff));
		expectClose(tableRow(sky).colors[C.LIGHT_COLOR_GROUND] as number[], linear(0x404040));
		expect(tableRow(sky).values[C.LIGHT_VALUE_INTENSITY]).toBe(0.6);
	});

	test("lights in lumens take three.js's candela for the same power, at create and in setIntensity", () => {
		const { scene, tableRow } = fakeCore();
		const intensity = (light: Light) => tableRow(light).values[C.LIGHT_VALUE_INTENSITY];
		const bulb = scene.createPointLight({ range: 5, intensity: 800, intensityUnit: 'lumen' });
		const threeBulb = new ThreePoint();
		threeBulb.power = 800;
		expect(intensity(bulb)).toBeCloseTo(threeBulb.intensity, 12);
		bulb.setIntensity(1600);
		threeBulb.power = 1600;
		expect(intensity(bulb)).toBeCloseTo(threeBulb.intensity, 12);
		// A spot light's lumens do not depend on its cone, as in three.js and Filament's SPOT.
		for (const angle of [0.2, 1]) {
			const spot = scene.createSpotLight({
				range: 5,
				angle,
				intensity: 800,
				intensityUnit: 'lumen',
			});
			const threeSpot = new ThreeSpot(0xffffff, 1, 5, angle);
			threeSpot.power = 800;
			expect(intensity(spot)).toBeCloseTo(threeSpot.intensity, 12);
			expect(intensity(spot)).toBeCloseTo(800 / Math.PI, 12);
		}
		// Without an intensity, a light in lumens gives 1 lumen.
		const dim = scene.createPointLight({ range: 5, intensityUnit: 'lumen' });
		expect(intensity(dim)).toBeCloseTo(1 / (4 * Math.PI), 12);
		// Without a unit, the intensity is three.js's candela.
		const plain = scene.createPointLight({ range: 5, intensity: 800 });
		expect(intensity(plain)).toBe(800);
		plain.setIntensity(30);
		expect(intensity(plain)).toBe(30);
	});

	test("lights in lux keep the intensity, as three.js's units are lux already", () => {
		const { scene, tableRow } = fakeCore();
		const intensity = (light: Light) => tableRow(light).values[C.LIGHT_VALUE_INTENSITY];
		const sun = scene.createDirectionalLight({ intensity: 100_000, intensityUnit: 'lux' });
		expect(intensity(sun)).toBe(new ThreeDirectional(0xffffff, 100_000).intensity);
		sun.setIntensity(50_000);
		expect(intensity(sun)).toBe(50_000);
		const sky = scene.createHemisphereLight({ intensity: 2_000, intensityUnit: 'lux' });
		expect(intensity(sky)).toBe(2_000);
		const fill = scene.createAmbientLight({ intensity: 300, intensityUnit: 'lux' });
		expect(intensity(fill)).toBe(300);
		// Lux without an intensity leaves the core's default.
		expect(intensity(scene.createAmbientLight({ intensityUnit: 'lux' }))).toBeUndefined();
	});

	test('a unit that the kind of light does not take throws E1213', () => {
		const { scene } = fakeCore();
		const units = [
			() => scene.createPointLight({ range: 5, intensityUnit: 'lux' as 'lumen' }),
			() => scene.createSpotLight({ range: 5, intensityUnit: 'candela' as 'lumen' }),
			() => scene.createDirectionalLight({ intensityUnit: 'lumen' as 'lux' }),
			() => scene.createAmbientLight({ intensityUnit: 'lumen' as 'lux' }),
			() => scene.createHemisphereLight({ intensityUnit: 'lumen' as 'lux' }),
		];
		for (const create of units) {
			const error = thrown(create);
			expect(error.code).toBe('E1213');
			expect(error.message).toContain('intensity unit');
		}
	});

	test("a directional light's shadow options land in the light table, and setShadow changes only those it names", () => {
		const { scene, tableRow } = fakeCore();
		const sun = scene.createDirectionalLight({
			castShadows: true,
			shadow: { cascades: 2, mapSize: 1024, bias: 1.5, normalBias: 0.5, distance: 80 },
		});
		const values = tableRow(sun).values;
		expect(values[C.LIGHT_VALUE_SHADOW_CASCADES]).toBe(2);
		expect(values[C.LIGHT_VALUE_SHADOW_MAP_SIZE]).toBe(1024);
		expect(values[C.LIGHT_VALUE_SHADOW_BIAS]).toBe(1.5);
		expect(values[C.LIGHT_VALUE_SHADOW_NORMAL_BIAS]).toBe(0.5);
		expect(values[C.LIGHT_VALUE_SHADOW_DISTANCE]).toBe(80);
		sun.setShadow({ cascades: 4 });
		expect(tableRow(sun).values[C.LIGHT_VALUE_SHADOW_CASCADES]).toBe(4);
		expect(tableRow(sun).values[C.LIGHT_VALUE_SHADOW_MAP_SIZE]).toBe(1024);
		// Settings left out keep the core's defaults.
		const plain = scene.createDirectionalLight({ shadow: {} });
		expect(tableRow(plain).values).toEqual([]);
	});

	test("a spot light's shadow biases land in the light table, and setShadow changes only those it names", () => {
		const { scene, tableRow } = fakeCore();
		const spot = scene.createSpotLight({
			range: 8,
			castShadows: true,
			shadow: { bias: 2, normalBias: 0.25 },
		});
		expect(tableRow(spot).values[C.LIGHT_VALUE_SHADOW_BIAS]).toBe(2);
		expect(tableRow(spot).values[C.LIGHT_VALUE_SHADOW_NORMAL_BIAS]).toBe(0.25);
		spot.setShadow({ normalBias: 3 });
		expect(tableRow(spot).values[C.LIGHT_VALUE_SHADOW_BIAS]).toBe(2);
		expect(tableRow(spot).values[C.LIGHT_VALUE_SHADOW_NORMAL_BIAS]).toBe(3);
	});

	test("a point light's shadow biases land in the light table", () => {
		const { scene, tableRow } = fakeCore();
		const lamp = scene.createPointLight({ range: 5, castShadows: true, shadow: { bias: 1.25 } });
		expect(tableRow(lamp).values[C.LIGHT_VALUE_SHADOW_BIAS]).toBe(1.25);
		lamp.setShadow({ normalBias: 2 });
		expect(tableRow(lamp).values[C.LIGHT_VALUE_SHADOW_NORMAL_BIAS]).toBe(2);
		expect(thrown(() => lamp.setShadow({ normalBias: -1 })).code).toBe('E1108');
	});

	test('castShadows travels with the create command', () => {
		const { scene, commands } = fakeCore();
		const lights = [
			scene.createDirectionalLight({ castShadows: true }),
			scene.createPointLight({ range: 2, castShadows: true }),
			scene.createSpotLight({ range: 2, castShadows: true }),
		];
		const creates = commands().filter(([op]) => ((op as number) & 0xff) === C.COMMAND_CREATE);
		expect(creates.map(([op, handle]) => [(op as number) >>> 8, handle])).toEqual(
			lights.map((light) => [C.FLAG_VISIBLE | C.FLAG_CAST_SHADOWS, light.handle]),
		);
	});
});

describe('directions', () => {
	test('directional and spot lights point straight down by default', () => {
		const { scene, pointing } = fakeCore();
		expectClose(pointing(scene.createDirectionalLight()), [0, -1, 0]);
		expectClose(pointing(scene.createSpotLight({ range: 1 })), [0, -1, 0]);
	});

	test('a direction turns the light as three.js aims its light from position to target', () => {
		const { scene, pointing } = fakeCore();
		const theirs = new ThreeDirectional();
		theirs.position.set(1, 2, 1);
		theirs.target.position.set(0, 0, 0);
		const aim = theirs.target.position.clone().sub(theirs.position).normalize().toArray();
		const sun = scene.createDirectionalLight({ direction: [-1, -2, -1] });
		expectClose(pointing(sun), aim);
		sun.setDirection(0, 0, 5);
		expectClose(pointing(sun), [0, 0, 1]);
		const spot = scene.createSpotLight({ range: 3, direction: [3, 0, 4] });
		expectClose(pointing(spot), [0.6, 0, 0.8]);
		spot.setDirection(0, -1, 0);
		expectClose(pointing(spot), [0, -1, 0]);
	});

	test('a spot light turns to its target, and lookAt turns any light', () => {
		const { scene, pointing } = fakeCore();
		const spot = scene.createSpotLight({
			range: 10,
			position: [0, 4, 0],
			target: [3, 0, 0],
			direction: [0, 0, 1],
		});
		expectClose(pointing(spot), [0.6, -0.8, 0]);
		const sun = scene.createDirectionalLight({ position: [0, 5, 0] });
		sun.lookAt(0, 5, -2);
		expectClose(pointing(sun), [0, 0, -1]);
	});

	test('a rotation stays when no direction is given', () => {
		const { scene, rotation } = fakeCore();
		const turn = [0, Math.SQRT1_2, 0, Math.SQRT1_2] as const;
		expectClose(rotation(scene.createDirectionalLight({ rotation: turn })), turn);
		expectClose(rotation(scene.createSpotLight({ range: 1, rotation: turn })), turn);
	});
});

describe('light calls', () => {
	test('the setters write the light table, colors in linear RGB', () => {
		const { scene, tableRow } = fakeCore();
		const spot = scene.createSpotLight({ range: 1 });
		spot.setIntensity(8);
		spot.setRange(20);
		spot.setDecay(0);
		spot.setAngle(Math.PI / 2);
		spot.setPenumbra(1);
		spot.setColor('#ff8000');
		expect(tableRow(spot).values).toEqual([8, 20, 0, Math.PI / 2, 1]);
		expectClose(tableRow(spot).colors[C.LIGHT_COLOR_MAIN] as number[], [1, 0.2158605, 0]);
		// Three numbers are linear already.
		spot.setColor([1, 0.5, 0]);
		expectClose(tableRow(spot).colors[C.LIGHT_COLOR_MAIN] as number[], [1, 0.5, 0]);

		const lamp = scene.createPointLight({ range: 1 });
		lamp.setRange(6);
		lamp.setDecay(1);
		expect(tableRow(lamp).values).toEqual([undefined, 6, 1]);

		const sky = scene.createHemisphereLight();
		sky.setColor('#ffffff');
		sky.setGroundColor('#000000');
		expect(tableRow(sky).colors).toEqual([
			[1, 1, 1],
			[0, 0, 0],
		]);
	});

	test('setCastShadows queues the flag on the lights that cast shadows', () => {
		const { scene, commands } = fakeCore();
		const lights = [
			scene.createDirectionalLight(),
			scene.createPointLight({ range: 2 }),
			scene.createSpotLight({ range: 2 }),
		];
		const before = commands().length;
		for (const light of lights) light.setCastShadows(true);
		lights[0]?.setCastShadows(false);
		expect(commands().slice(before)).toEqual([
			...lights.map((l) => [
				C.COMMAND_SET_FLAGS,
				l.handle,
				C.FLAG_CAST_SHADOWS,
				C.FLAG_CAST_SHADOWS,
			]),
			[C.COMMAND_SET_FLAGS, lights[0]?.handle as number, C.FLAG_CAST_SHADOWS, 0],
		]);
	});

	test('lights are objects: they move, parent, hide, join layers and have names', () => {
		const { scene, commands } = fakeCore();
		const rig = scene.createGroup();
		const lamp = scene.createPointLight({ name: 'Lamp', range: 3, parent: rig, dynamic: true });
		expect(scene.find('Lamp')).toBe(lamp);
		const before = commands().length;
		lamp.setParent(null);
		lamp.setVisible(false);
		lamp.setLayers(1 << 4);
		expect(commands().slice(before)).toEqual([
			[C.COMMAND_SET_PARENT, lamp.handle, 0, 0],
			[C.COMMAND_SET_VISIBLE, lamp.handle, 0, 0],
			[C.COMMAND_SET_LAYERS, lamp.handle, 1 << 4, 0],
		]);
		const create = commands().find(([, handle]) => handle === lamp.handle) as number[];
		expect(create).toEqual([
			C.COMMAND_CREATE | ((C.FLAG_VISIBLE | C.FLAG_DYNAMIC) << 8),
			lamp.handle,
			rig.handle,
			C.CORE_NO_MESH,
		]);
		const at = [0, 0, 0];
		lamp.setPosition(1, 2, 3);
		lamp.getPosition(at);
		expect(at).toEqual([1, 2, 3]);
	});

	test('destroy removes the object and frees the light row', () => {
		const { scene, commands, tableRow } = fakeCore();
		const lamp = scene.createPointLight({ name: 'Lamp', range: 3 });
		const row = tableRow(lamp);
		const { handle } = lamp;
		lamp.destroy();
		expect(row.live).toBe(false);
		// The light no longer names its old row, which the next light created takes.
		expect(lamp.id).toBe(0);
		expect(commands().at(-1)).toEqual([C.COMMAND_DESTROY, handle, 0, 0]);
		// Its handle now holds the generation that no live object has, so a later call on it can
		// never reach the object that takes its slot.
		expect(lamp.handle).toBe(handle | (C.HANDLE_DEAD_GENERATION << C.HANDLE_SLOT_BITS));
		expect(lamp.handle & ((1 << C.HANDLE_SLOT_BITS) - 1)).toBe(
			handle & ((1 << C.HANDLE_SLOT_BITS) - 1),
		);
		expect(scene.find('Lamp')).toBeUndefined();
	});
});

describe('development checks', () => {
	test('every light call on a destroyed light throws E1101', () => {
		const { scene } = fakeCore();
		const spot = scene.createSpotLight({ name: 'Spot', range: 2 });
		const sky = scene.createHemisphereLight({ name: 'Sky' });
		spot.destroy();
		sky.destroy();
		const calls: Record<string, () => void> = {
			setColor: () => spot.setColor('#fff'),
			setIntensity: () => spot.setIntensity(2),
			setRange: () => spot.setRange(2),
			setDecay: () => spot.setDecay(2),
			setAngle: () => spot.setAngle(0.5),
			setPenumbra: () => spot.setPenumbra(0.5),
			setDirection: () => spot.setDirection(0, -1, 0),
			setCastShadows: () => spot.setCastShadows(true),
			destroy: () => spot.destroy(),
		};
		for (const [name, call] of Object.entries(calls))
			expect(thrown(call).message).toStartWith(
				`E1101: ${name}() was called on "Spot" (slot ${spot.slot}), which was destroyed in frame ${FRAME}.`,
			);
		expect(thrown(() => sky.setGroundColor('#000')).code).toBe('E1101');
	});

	test('numbers outside their ranges throw E1108, and numbers that are not finite E1203', () => {
		const { scene } = fakeCore();
		const spot = scene.createSpotLight({ name: 'Spot', range: 2 });
		const on = `on "Spot" (slot ${spot.slot})`;
		expect(thrown(() => spot.setRange(0)).message).toStartWith(
			`E1108: setRange() got the range 0 ${on}, which must be above 0.`,
		);
		expect(thrown(() => spot.setRange(-3)).code).toBe('E1108');
		expect(thrown(() => spot.setRange(Number.POSITIVE_INFINITY)).code).toBe('E1203');
		expect(thrown(() => spot.setDecay(-0.5)).message).toStartWith(
			`E1108: setDecay() got the decay -0.5 ${on}, which must be at least 0.`,
		);
		expect(thrown(() => spot.setAngle(0)).message).toStartWith(
			`E1108: setAngle() got the angle 0 ${on}, which must be above 0 and at most π/2.`,
		);
		expect(thrown(() => spot.setAngle(1.6)).code).toBe('E1108');
		expect(thrown(() => spot.setPenumbra(1.5)).message).toStartWith(
			`E1108: setPenumbra() got the penumbra 1.5 ${on}, which must be from 0 to 1.`,
		);
		expect(thrown(() => spot.setIntensity(Number.NaN)).message).toStartWith(
			`E1203: setIntensity() got NaN for intensity ${on}.`,
		);
		expect(thrown(() => spot.setDirection(0, 0, 0)).message).toStartWith(
			`E1108: setDirection() got the direction (0, 0, 0) ${on}, which points nowhere.`,
		);
		expect(thrown(() => spot.setDirection(0, Number.NaN, 0)).code).toBe('E1203');
		expect(thrown(() => spot.setColor('reddish')).code).toBe('E1204');
		// A negative intensity takes light away, as in three.js.
		spot.setIntensity(-1);
	});

	test('shadow settings outside their ranges throw E1108', () => {
		const { scene } = fakeCore();
		const sun = scene.createDirectionalLight({ name: 'Sun' });
		const on = `on "Sun" (slot ${sun.slot})`;
		expect(thrown(() => sun.setShadow({ cascades: 5 })).message).toStartWith(
			`E1108: setShadow() got the shadow cascades 5 ${on}, which must be a whole number from 1 to 4.`,
		);
		expect(thrown(() => sun.setShadow({ cascades: 2.5 })).code).toBe('E1108');
		expect(thrown(() => sun.setShadow({ mapSize: 1000 })).message).toStartWith(
			`E1108: setShadow() got the shadow map size 1000 ${on}, which must be 256, 512, 1,024, 2,048 or 4,096.`,
		);
		expect(thrown(() => sun.setShadow({ mapSize: 8192 })).code).toBe('E1108');
		expect(thrown(() => sun.setShadow({ bias: -1 })).code).toBe('E1108');
		expect(thrown(() => sun.setShadow({ normalBias: -0.1 })).code).toBe('E1108');
		expect(thrown(() => sun.setShadow({ distance: 0 })).code).toBe('E1108');
		expect(thrown(() => sun.setShadow({ distance: Number.NaN })).code).toBe('E1203');
		expect(
			thrown(() => scene.createDirectionalLight({ shadow: { cascades: 0 } })).message,
		).toStartWith('E1108: createDirectionalLight() got the shadow cascades 0');
		sun.setShadow({ cascades: 1, mapSize: 256, bias: 0, normalBias: 0, distance: 0.5 });
		const spot = scene.createSpotLight({ range: 4, name: 'Lamp' });
		expect(thrown(() => spot.setShadow({ bias: -1 })).message).toStartWith(
			`E1108: setShadow() got the shadow bias -1 on "Lamp" (slot ${spot.slot}), which must be at least 0.`,
		);
		expect(thrown(() => scene.createSpotLight({ range: 4, shadow: { normalBias: -2 } })).code).toBe(
			'E1108',
		);
		spot.setShadow({ bias: 0, normalBias: 0 });
	});

	test('the create calls check their options and name themselves', () => {
		const { scene } = fakeCore();
		const noRange = {} as { range: number };
		expect(thrown(() => scene.createPointLight(noRange)).message).toMatch(
			/^E1108: createPointLight\(\) got the range undefined on an object \(slot \d+\), which must be above 0\./,
		);
		expect(thrown(() => scene.createSpotLight({ range: 1, angle: 2 })).message).toStartWith(
			'E1108: createSpotLight() got the angle 2',
		);
		expect(thrown(() => scene.createSpotLight({ range: 1, penumbra: -1 })).code).toBe('E1108');
		expect(
			thrown(() => scene.createDirectionalLight({ direction: [0, 0, 0] })).message,
		).toStartWith('E1108: createDirectionalLight() got the direction (0, 0, 0)');
		expect(thrown(() => scene.createAmbientLight({ intensity: Number.NaN })).code).toBe('E1203');
		expect(thrown(() => scene.createHemisphereLight({ groundColor: 'dirt' })).code).toBe('E1204');
		expect(thrown(() => scene.createPointLight({ range: 1, layers: 0.5 })).code).toBe('E1207');
	});
});
