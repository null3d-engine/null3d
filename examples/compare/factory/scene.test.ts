import { describe, expect, test } from 'bun:test';
import {
	effectsFromText,
	effectsToText,
	gradeTable,
	quatMultiply,
	rotateVector,
	stepsUntil,
	surfaceMaps,
	triangleCount,
} from '../../lib/compare-scene';
import {
	ARM_PARENT,
	ARM_PART,
	ARM_PARTS,
	ArmState,
	armPartLocal,
	BELT_HEIGHT,
	BELT_SPACING,
	CRATE_HEIGHT,
	CRATE_SIZE,
	CRATES_PER_CELL,
	CrateParent,
	CrateState,
	crateTransform,
	createFactory,
	FACTORY_RAMPS,
	type FactoryState,
	factoryCells,
	factoryMeshes,
	factoryObjects,
	factoryTriangles,
	GRIP_POINT,
	gripWorld,
	MOVING_PER_CELL,
	REACH,
	SPARK_COUNT,
	SPARKS_PER_CELL,
	setActiveCells,
	sparkPosition,
	stepFactory,
} from './scene';

/** A position and a rotation (x, y, z, w). */
interface Pose {
	position: number[];
	rotation: number[];
}

/** The world pose of a child: the parent's pose applied to the child's local pose. */
function chain(parent: Pose, local: Pose): Pose {
	const moved = [0, 0, 0];
	rotateVector(
		moved,
		0,
		parent.rotation,
		0,
		local.position[0]!,
		local.position[1]!,
		local.position[2]!,
	);
	const rotation = [0, 0, 0, 1];
	quatMultiply(rotation, 0, parent.rotation, 0, local.rotation, 0);
	return { position: parent.position.map((value, i) => value + moved[i]!), rotation };
}

const run = (state: FactoryState, steps: number) => {
	for (let i = 0; i < steps; i++) stepFactory(state);
};

/** World poses of a cell's arm parts, parent first, as null3D's engine works them out. */
function armWorld(state: FactoryState, cell: number): Pose[] {
	const poses: Pose[] = [];
	for (let part = 0; part < ARM_PARTS; part++) {
		const position = [0, 0, 0];
		const rotation = [0, 0, 0, 1];
		armPartLocal(state, cell, part, position, rotation);
		const parent = ARM_PARENT[part]!;
		poses.push(parent < 0 ? { position, rotation } : chain(poses[parent]!, { position, rotation }));
	}
	return poses;
}

function crateWorld(state: FactoryState, cell: number, k: number): Pose {
	const position = [0, 0, 0];
	const rotation = [0, 0, 0, 1];
	const parent = crateTransform(state, cell, k, position, rotation);
	if (parent === CrateParent.hall) return { position, rotation };
	return chain(armWorld(state, cell)[ARM_PART.wrist]!, { position, rotation });
}

/** q and -q are the same rotation, so this is 1 for the same rotation. */
const sameRotation = (a: readonly number[], b: readonly number[]) =>
	Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!);

describe('Factory layout and counts', () => {
	test('a count of moving parts becomes whole cells of 10 moving parts', () => {
		expect(MOVING_PER_CELL).toBe(10);
		expect(factoryCells(10_000)).toBe(1_000);
		expect(factoryCells(10_001)).toBe(1_001);
		expect(factoryCells(0)).toBe(1);
		expect(factoryObjects(10_000)).toBe(1_000 * 15 + 31);
	});

	test('the ramps top out between 20,000 and 50,000 moving parts', () => {
		for (const plan of Object.values(FACTORY_RAMPS)) {
			expect(plan.max).toBeGreaterThanOrEqual(20_000);
			expect(plan.max).toBeLessThanOrEqual(50_000);
			expect(plan.start).toBeLessThan(plan.max / 10);
		}
	});

	test('triangles add up per cell, plus the hall', () => {
		const meshes = factoryMeshes(1);
		const one = factoryTriangles(10, meshes);
		const two = factoryTriangles(20, meshes);
		expect(two - one).toBeGreaterThan(0);
		expect(one - (two - one)).toBe(
			triangleCount(meshes.floor) +
				6 *
					(triangleCount(meshes.housing) +
						triangleCount(meshes.lens) +
						triangleCount(meshes.panel) +
						triangleCount(meshes.panelFrame) +
						triangleCount(meshes.cone)),
		);
	});

	test('the pick point lies in front of the arm, with the crate on the belt', () => {
		expect(REACH).toBeGreaterThan(1.5);
		expect(REACH).toBeLessThan(2.5);
		expect(CRATE_HEIGHT - CRATE_SIZE / 2).toBeCloseTo(BELT_HEIGHT, 9);
		expect(BELT_HEIGHT).toBeGreaterThan(0.2);
	});

	test('cells lie on distinct grid points', () => {
		const state = createFactory(500);
		const seen = new Set<string>();
		for (let c = 0; c < 500; c++) seen.add(`${state.origin[c * 2]},${state.origin[c * 2 + 1]}`);
		expect(seen.size).toBe(500);
	});

	test('every mesh has a texture coordinate for each vertex', () => {
		for (const mesh of Object.values(factoryMeshes(10)))
			expect(mesh.uv.length / 2).toBe(mesh.position.length / 3);
	});
});

describe('Factory simulation', () => {
	test('the same seed and steps give the same state', () => {
		const a = createFactory(40);
		const b = createFactory(40);
		run(a, stepsUntil(15));
		run(b, stepsUntil(15));
		expect([...a.joints]).toEqual([...b.joints]);
		expect([...a.crateState]).toEqual([...b.crateState]);
		expect([...a.crateDistance]).toEqual([...b.crateDistance]);
	});

	test('every arm runs through all nine states within a minute', () => {
		const state = createFactory(30);
		const seen = Array.from({ length: 30 }, () => new Set<number>());
		for (let i = 0; i < stepsUntil(60); i++) {
			stepFactory(state);
			for (let c = 0; c < 30; c++) seen[c]!.add(state.armState[c]!);
		}
		for (const states of seen) expect(states.size).toBe(Object.keys(ArmState).length);
	});

	test('a crate keeps its place and rotation when the arm grips it and when it lets go', () => {
		const cells = 12;
		const state = createFactory(cells);
		let grips = 0;
		let releases = 0;
		for (let i = 0; i < stepsUntil(40); i++) {
			const before = Array.from({ length: cells * CRATES_PER_CELL }, (_, i) =>
				crateWorld(state, Math.floor(i / CRATES_PER_CELL), i % CRATES_PER_CELL),
			);
			const was = [...state.crateState];
			stepFactory(state);
			for (let i = 0; i < cells * CRATES_PER_CELL; i++) {
				const now = state.crateState[i]!;
				const gripped = was[i] === CrateState.belt && now === CrateState.held;
				const released = was[i] === CrateState.held && now === CrateState.placed;
				if (!gripped && !released) continue;
				if (gripped) grips++;
				else releases++;
				const after = crateWorld(state, Math.floor(i / CRATES_PER_CELL), i % CRATES_PER_CELL);
				const old = before[i]!;
				const jump = Math.hypot(
					...after.position.map((value, axis) => value - old.position[axis]!),
				);
				expect(jump).toBeLessThan(0.01);
				expect(sameRotation(after.rotation, old.rotation)).toBeCloseTo(1, 4);
			}
		}
		expect(grips).toBeGreaterThan(cells);
		expect(releases).toBeGreaterThan(cells);
	});

	test('crates on a belt keep their spacing and never pass the pick point', () => {
		const state = createFactory(20);
		for (let i = 0; i < stepsUntil(45); i++) {
			stepFactory(state);
			for (let c = 0; c < 20; c++) {
				const onBelt: number[] = [];
				for (let k = 0; k < CRATES_PER_CELL; k++) {
					const index = c * CRATES_PER_CELL + k;
					if (state.crateState[index] === CrateState.belt) onBelt.push(state.crateDistance[index]!);
				}
				onBelt.sort((a, b) => a - b);
				expect(onBelt[0] ?? 0).toBeGreaterThanOrEqual(0);
				for (let j = 1; j < onBelt.length; j++)
					expect(onBelt[j]! - onBelt[j - 1]!).toBeGreaterThan(BELT_SPACING - 1e-4);
			}
		}
	});

	test('only the active cells move', () => {
		const state = createFactory(10);
		setActiveCells(state, 4);
		const frozen = [...state.joints.subarray(4 * 5)];
		run(state, stepsUntil(20));
		expect([...state.joints.subarray(4 * 5)]).toEqual(frozen);
		expect(state.armCycle.subarray(0, 4).some((cycle) => cycle > 0)).toBe(true);
	});

	test('the grip point is where the wrist holds a crate', () => {
		const state = createFactory(8);
		const out = [0, 0, 0];
		for (let moment = 0; moment < 20; moment++) {
			run(state, stepsUntil(0.7));
			for (let c = 0; c < 8; c++) {
				gripWorld(state, c, out);
				const grip = chain(armWorld(state, c)[ARM_PART.wrist]!, {
					position: [0, GRIP_POINT, 0],
					rotation: [0, 0, 0, 1],
				});
				for (let axis = 0; axis < 3; axis++)
					expect(out[axis]!).toBeCloseTo(grip.position[axis]!, 5);
			}
		}
	});

	test('sparks fly only while an arm grips or lets go, and stay above the floor', () => {
		const state = createFactory(9);
		const out = [0, 0, 0];
		let flying = 0;
		for (let step = 0; step < stepsUntil(30); step++) {
			stepFactory(state);
			if (step % 7 !== 0) continue;
			for (let k = 0; k < SPARK_COUNT; k++) {
				const cell = Math.floor(k / SPARKS_PER_CELL);
				const s = state.armState[cell]!;
				const flies = sparkPosition(state, k, step / 120, out);
				expect(flies).toBe(s === ArmState.grip || s === ArmState.release);
				if (!flies) continue;
				flying++;
				expect(out[1]!).toBeGreaterThan(0);
			}
		}
		expect(flying).toBeGreaterThan(100);
	});
});
