import { beforeEach, describe, expect, test } from 'bun:test';
import {
	BoxGeometry,
	type BufferGeometry,
	CapsuleGeometry,
	CircleGeometry,
	ConeGeometry,
	CylinderGeometry,
	PlaneGeometry,
	RingGeometry,
	SphereGeometry,
	TorusGeometry,
} from 'three';
import { type EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import {
	SHAPE_BOX,
	SHAPE_CAPSULE,
	SHAPE_CIRCLE,
	SHAPE_CYLINDER,
	SHAPE_PLANE,
	SHAPE_RING,
	SHAPE_SPHERE,
	SHAPE_TORUS,
} from '../generated/core';
import type { CoreGlue } from '../shared/core';
import { CoreMemory } from './memory';
import { Geometry } from './resources';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/** A geometry class of three.js, which keeps its constructor's arguments in `parameters`. */
type ThreeClass = new () => BufferGeometry & { parameters: object };

/** The generators' names. */
type Generator =
	| 'box'
	| 'sphere'
	| 'plane'
	| 'cylinder'
	| 'cone'
	| 'torus'
	| 'capsule'
	| 'circle'
	| 'ring';

/** Each generator, the three.js class it follows, and the shape code the core builds it with. */
const GENERATORS: [Generator, ThreeClass, number][] = [
	['box', BoxGeometry, SHAPE_BOX],
	['sphere', SphereGeometry, SHAPE_SPHERE],
	['plane', PlaneGeometry, SHAPE_PLANE],
	['cylinder', CylinderGeometry, SHAPE_CYLINDER],
	['cone', ConeGeometry, SHAPE_CYLINDER],
	['torus', TorusGeometry, SHAPE_TORUS],
	['capsule', CapsuleGeometry, SHAPE_CAPSULE],
	['circle', CircleGeometry, SHAPE_CIRCLE],
	['ring', RingGeometry, SHAPE_RING],
];

/** A geometry whose core records the arguments of each mesh it is asked for. */
function recording() {
	const calls: number[][] = [];
	const glue = {
		createShapeMesh: (...args: number[]) => calls.push(args),
		meshRadius: () => 1,
		lastErrorCode: () => 0,
		lastErrorDetail: () => 0,
	} as unknown as CoreGlue;
	const geometry = new Geometry(new CoreMemory(glue, new WebAssembly.Memory({ initial: 1 })));
	return { geometry, calls };
}

/** What the core receives: the shape code, a cone's top radius of 0, then eight numbers. */
function expected(name: string, shape: number, values: number[]): number[] {
	const args = [...(name === 'cone' ? [0] : []), ...values];
	return [shape, ...args, ...Array(8 - args.length).fill(0)];
}

describe('the geometry generators', () => {
	test("pass three.js's defaults, in the order of its constructor's arguments", () => {
		for (const [name, Three, shape] of GENERATORS) {
			const { geometry, calls } = recording();
			geometry[name]();
			const defaults = Object.values(new Three().parameters).map(Number);
			expect(calls).toEqual([expected(name, shape, defaults)]);
		}
	});

	test("pass each option in the place of three.js's argument of the same name", () => {
		for (const [name, Three, shape] of GENERATORS) {
			const { geometry, calls } = recording();
			const names = Object.keys(new Three().parameters);
			geometry[name](Object.fromEntries(names.map((option, k) => [option, 10 + k])));
			expect(calls).toEqual([
				expected(
					name,
					shape,
					names.map((_, k) => 10 + k),
				),
			]);
		}
	});

	test('pass open ends as 1', () => {
		const { geometry, calls } = recording();
		geometry.cylinder({ openEnded: true });
		geometry.cone({ openEnded: true });
		expect(calls.map((args) => args[6])).toEqual([1, 1]);
	});

	test('refuse an option that is not a finite number, and name it', () => {
		const { geometry, calls } = recording();
		const refuse = (make: () => void) => {
			try {
				make();
			} catch (error) {
				return error as EngineError;
			}
			throw new Error('the mesh was made');
		};
		const error = refuse(() => geometry.torus({ tube: Number.NaN }));
		expect(error.code).toBe('E1203');
		expect(error.message).toStartWith('E1203: geometry.torus() got NaN for tube.');
		const infinite = refuse(() => geometry.ring({ thetaSegments: Number.POSITIVE_INFINITY }));
		expect(infinite.message).toStartWith('E1203: geometry.ring() got Infinity for thetaSegments.');
		expect(calls).toEqual([]);
	});
});
