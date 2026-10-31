// The core's emitter against the reference emitter in TypeScript: for each scenario the page runs
// both over the same options, frames and seeds, then reads every record of both buffers and
// compares all nine numbers. The scenarios cover several seeds, every shape, a followed emitter, a
// two-level sub-emitter chain, a burst schedule that wraps the ring, and a prewarmed system.
import {
	defineSketch,
	type Object3D,
	type ParticleBuffer,
	type SketchTime,
	type Vec3Like,
} from '@null3d/engine';
import { createParticles, type ParticleSystemOptions } from '@null3d/particles';
import { ReferenceSystem, type ReferenceSystemOptions } from '../lib/particle-reference';

/** A difference between the two paths. */
interface Mismatch {
	scenario: string;
	record: number;
	field: number;
	reference: number;
	core: number;
}

/** What the check reports. */
interface Checked {
	scenarios: number;
	records: number;
	mismatches: Mismatch[];
	error?: string;
}

/** One scenario's settings and the number of frames that both paths run. */
interface Scenario {
	name: string;
	capacity: number;
	options: ParticleSystemOptions;
	frames: number;
	dt: number;
	/** Moves a followed object before each frame. */
	move?: (frame: number) => void;
	/** How many buffers the scenario pairs: the system and its sub-emitters. */
	buffers?: number;
}

/** The followed object of the follow scenario. */
interface Moving {
	object: Object3D;
	move(frame: number): void;
}

export default defineSketch((ctx) => {
	const { scene, page, time } = ctx;
	scene.setBackground('#10141a');
	const camera = scene.createPerspectiveCamera({ fov: 40, position: [0, 0, 8] });
	camera.lookAt(0, 0, 0);
	scene.setActiveCamera(camera);

	/** Places a buffer as `createParticles` places one. */
	const place = (
		buffer: ParticleBuffer,
		options: { parent?: Object3D; position?: Vec3Like; follow?: Object3D },
	) => {
		const { object } = buffer;
		if (options.parent) object.setParent(options.parent);
		const position = options.position;
		if (position)
			object.setPosition(position[0] as number, position[1] as number, position[2] as number);
		else if (options.follow) {
			const at = [0, 0, 0];
			options.follow.getWorldPosition(at);
			object.setPosition(at[0] as number, at[1] as number, at[2] as number);
		}
	};

	/** A reference system of its own buffer, placed as the live one is. */
	const reference = async (options: ReferenceSystemOptions, capacity: number) => {
		const buffer = await scene.createParticleBuffer({ ...options, capacity });
		place(buffer, options);
		return { buffer, system: new ReferenceSystem(buffer, options, time as SketchTime) };
	};

	/** Reads one buffer's records as the GPU reads them: nine numbers for each. */
	const readRecords = (buffer: ParticleBuffer): number[][] => {
		const out = new Float32Array(9);
		const rows: number[][] = [];
		for (let index = 0; index < buffer.capacity; index++) {
			buffer.read(index, out);
			rows.push([...out]);
		}
		return rows;
	};

	const compare = (
		mismatches: Mismatch[],
		name: string,
		capacity: number,
		referenceBuffer: ParticleBuffer,
		coreBuffer: ParticleBuffer,
	) => {
		const a = readRecords(referenceBuffer);
		const b = readRecords(coreBuffer);
		let records = 0;
		for (let index = 0; index < capacity; index++) {
			const left = a[index] as number[];
			const right = b[index] as number[];
			records++;
			for (let field = 0; field < 9; field++) {
				if (!Object.is(left[field], right[field]))
					mismatches.push({
						scenario: name,
						record: index,
						field,
						reference: left[field] as number,
						core: right[field] as number,
					});
			}
		}
		// The frame's values: the time, the count, and the time base.
		for (let field = 0; field < 4; field++) {
			const left = referenceBuffer.frame[field] as number;
			const right = coreBuffer.frame[field] as number;
			if (!Object.is(left, right))
				mismatches.push({
					scenario: `${name} frame`,
					record: 0,
					field: 8 + field,
					reference: left,
					core: right,
				});
		}
		return records;
	};

	/** Runs one scenario's two systems frame by frame and compares their records. */
	const run = async (scenario: Scenario, mismatches: Mismatch[]): Promise<number> => {
		const { options, capacity, frames, dt, move } = scenario;
		const old = await reference(options as unknown as ReferenceSystemOptions, capacity);
		const live = await createParticles(ctx, { ...options, capacity });
		for (let frame = 0; frame < frames; frame++) {
			move?.(frame);
			old.system.update(dt);
			live.update(dt);
		}
		return compare(mismatches, scenario.name, capacity, old.buffer, live.buffer);
	};

	/** Runs a parent whose sub-emitters chain: each pair of systems runs in the same order. */
	const chain = async (
		name: string,
		options: ParticleSystemOptions,
		capacity: number,
		frames: number,
		dt: number,
		mismatches: Mismatch[],
		on: 'death' | 'ground' = 'death',
	): Promise<number> => {
		const grandchildOld = await reference(
			{
				...options,
				lifetime: [0.15, 0.2],
				rate: 0,
				bursts: undefined,
				subEmitters: undefined,
			} as ReferenceSystemOptions,
			capacity,
		);
		const childOld = await reference(
			{
				...options,
				lifetime: [0.2, 0.3],
				rate: 0,
				bursts: undefined,
				subEmitters: [{ system: grandchildOld.system, on, count: 3, inheritVelocity: 0.2 }],
			} as ReferenceSystemOptions,
			capacity,
		);
		const parentOld = await reference(
			{
				...options,
				subEmitters: [{ system: childOld.system, on, count: 5, inheritVelocity: 0.5 }],
			},
			capacity,
		);
		const grandchildLive = await createParticles(ctx, {
			...options,
			lifetime: [0.15, 0.2],
			rate: 0,
			bursts: undefined,
			subEmitters: undefined,
			capacity,
		});
		const childLive = await createParticles(ctx, {
			...options,
			lifetime: [0.2, 0.3],
			rate: 0,
			bursts: undefined,
			subEmitters: [{ system: grandchildLive, on, count: 3, inheritVelocity: 0.2 }],
			capacity,
		});
		const parentLive = await createParticles(ctx, {
			...options,
			subEmitters: [{ system: childLive, on, count: 5, inheritVelocity: 0.5 }],
			capacity,
		});
		for (let frame = 0; frame < frames; frame++) {
			parentOld.system.update(dt);
			parentLive.update(dt);
			childOld.system.update(dt);
			childLive.update(dt);
			grandchildOld.system.update(dt);
			grandchildLive.update(dt);
		}
		let total = 0;
		total += compare(mismatches, `${name} parent`, capacity, parentOld.buffer, parentLive.buffer);
		total += compare(mismatches, `${name} child`, capacity, childOld.buffer, childLive.buffer);
		total += compare(
			mismatches,
			`${name} grandchild`,
			capacity,
			grandchildOld.buffer,
			grandchildLive.buffer,
		);
		return total;
	};

	const check = async () => {
		const mismatches: Mismatch[] = [];
		let recordCount = 0;
		let scenarios = 0;
		const followGroup = scene.createGroup();
		const moving: Moving = {
			object: followGroup,
			move(frame: number) {
				followGroup.setPosition(
					Math.sin(frame * 0.11) * 1.5,
					0.4 + frame * 0.01,
					Math.cos(frame * 0.09) * 1.2,
				);
				const turn = Math.sin(frame * 0.07) * 0.6;
				followGroup.setRotation(0, Math.sin(turn / 2), 0, Math.cos(turn / 2));
			},
		};
		const directions: Vec3Like[] = [
			[0, 1, 0],
			[0, 0, -1],
			[1, 0, 0],
		];
		const runScenario = async (scenario: Scenario) => {
			scenarios++;
			recordCount += await run(scenario, mismatches);
		};
		try {
			for (const seed of [1, 7, 12345, 4294967295]) {
				await runScenario({
					name: `seed ${seed}`,
					capacity: 64,
					frames: 40,
					dt: 1 / 60,
					options: {
						seed,
						rate: 60,
						lifetime: [0.8, 1.2],
						speed: [1, 3],
						direction: [0, 1, 0],
						spread: 0.3,
						velocity: [0.2, 0.1, 0],
						shape: { type: 'point' },
					},
				});
			}
			const shapes: ParticleSystemOptions['shape'][] = [
				{ type: 'sphere', radius: 0.7 },
				{ type: 'sphere', radius: 0.7, surface: true },
				{ type: 'cone', radius: 0.4, angle: 0.5 },
				{ type: 'box', size: [0.8, 0.3, 0.5] },
				{ type: 'disc', radius: 0.6 },
			];
			for (let k = 0; k < shapes.length; k++) {
				await runScenario({
					name: `shape ${k}`,
					capacity: 64,
					frames: 30,
					dt: 0.05,
					options: {
						seed: 21 + k,
						rate: 40,
						lifetime: [0.7, 1.1],
						speed: [0.5, 2],
						direction: directions[k % directions.length] as Vec3Like,
						spread: 0.5,
						shape: shapes[k],
					},
				});
			}
			await runScenario({
				name: 'bursts that wrap the ring',
				capacity: 8,
				frames: 40,
				dt: 0.05,
				options: {
					seed: 99,
					rate: 80,
					lifetime: [0.4, 0.6],
					speed: [0.4, 1.2],
					shape: { type: 'sphere', radius: 0.3 },
					bursts: [
						{ time: 0, count: 5 },
						{ time: 0.1, count: 2, interval: 0.15, cycles: 4 },
					],
				},
			});
			await runScenario({
				name: 'followed emitter',
				capacity: 64,
				frames: 40,
				dt: 1 / 60,
				move: (frame) => moving.move(frame),
				options: {
					seed: 33,
					rate: 50,
					lifetime: [0.6, 0.9],
					speed: [0.5, 1.5],
					shape: { type: 'sphere', radius: 0.2 },
					follow: moving.object,
				},
			});
			await runScenario({
				name: 'prewarmed system',
				capacity: 64,
				frames: 20,
				dt: 1 / 30,
				options: {
					seed: 44,
					rate: 30,
					lifetime: [0.4, 0.6],
					speed: [0.5, 1],
					shape: { type: 'point' },
					prewarm: true,
				},
			});
			scenarios++;
			recordCount += await chain(
				'sub-emitter chain',
				{
					seed: 5,
					rate: 0,
					bursts: [{ time: 0, count: 3 }],
					lifetime: [0.25, 0.35],
					speed: [1.5, 2.5],
					direction: [0, 1, 0],
					spread: 0.2,
					shape: { type: 'point' },
				},
				32,
				40,
				0.05,
				mismatches,
			);
			scenarios++;
			recordCount += await chain(
				'ground sub-emitter chain',
				{
					seed: 66,
					rate: 0,
					bursts: [{ time: 0.05, count: 4 }],
					lifetime: [0.8, 1],
					speed: [0.2, 0.6],
					direction: [1, 0.2, 0],
					gravity: [0, -9.8, 0],
					groundHeight: -0.5,
					shape: { type: 'point' },
				},
				32,
				60,
				0.05,
				mismatches,
				'ground',
			);
		} catch (error) {
			page.post('checked', {
				scenarios,
				records: recordCount,
				mismatches,
				error: (error as Error).message,
			} satisfies Checked);
			return;
		}
		page.post('checked', { scenarios, records: recordCount, mismatches } satisfies Checked);
	};

	page.onMessage((type) => {
		if (type === 'check') void check();
	});

	return {};
});
