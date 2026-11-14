// Cuttings: a branch or sub-branch cut from the grown skeleton stands upright on its cut at the
// origin, holds only the chosen axis's subtree, dresses into wood and merged shoots, and grows the
// same bytes on this thread and in a worker that runs the job-worker task. A leaf and a leaf cluster
// come from the kit alone.
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaledBudget } from '../../../tests/lib/run-budget.ts';
import { type PlantAsset, plantAssetDigest, type SpeciesKitData } from './asset';
import { AXIS_LIMB, AXIS_STEM, BUD_TERMINAL, SkeletonBuilder } from './core/graph';
import { quatRotate } from './core/math';
import type { Species } from './core/record';
import { standInSpecies } from './core/stand-in';
import {
	CUTTING_LENGTH,
	clusterRank,
	clusterRow,
	cutBranch,
	cutFoliage,
	cutsShoot,
} from './cutting';
import { buildKitNow, growPlantNow, loadPlantCode } from './generate';
import type { PlantTaskInput } from './generate-task';
import { oakRecord } from './grow/oak.fixture';
import { growSelfOrganizing } from './grow/self-organizing';
import { carriesPieces } from './leaf/piece-rows';
import { SURFACE_STEM } from './leaf/writer';

const stub = standInSpecies('stub', { height: 12, aspect: 0.8 });
await loadPlantCode(stub.record);
const kit = buildKitNow(stub, { placeholders: true });
const whole = growPlantNow(kit, { seed: 11, variant: 0, near: true });

/** The mean of a skeleton's node positions. */
function meanNode(positions: Float32Array): [number, number, number] {
	const count = positions.length / 3;
	const mean = [0, 0, 0];
	for (let i = 0; i < count * 3; i++)
		mean[i % 3] = (mean[i % 3] as number) + (positions[i] as number) / count;
	return [mean[0] as number, mean[1] as number, mean[2] as number];
}

describe('cuttings', () => {
	for (const part of ['branch', 'subbranch'] as const) {
		it(`cuts a ${part} that stands upright on its cut`, () => {
			const cut = cutBranch(whole.skeleton, stub.record, { part });
			if (!cut) throw new Error('the stub grew no axis to cut');
			const piece = cut.skeleton;
			expect(Array.from(piece.position.subarray(0, 3))).toEqual([0, 0, 0]);
			expect(piece.parent[0]).toBe(-1);
			const [x, y, z] = meanNode(piece.position);
			expect(Math.hypot(x, z)).toBeLessThan(1e-4 * Math.max(1, y));
			expect(y).toBeGreaterThan(0);
			expect(piece.axes.parent[0]).toBe(-1);
			expect(piece.axes.order[0]).toBe(cut.order);
			expect(piece.axes.count).toBeLessThan(whole.skeleton.axes.count);
			expect(piece.nodeCount).toBe(
				1 + countSubtreeNodes(whole.skeleton.axes, whole.skeleton.axes.count, cut.axis),
			);
			for (let b = 0; b < piece.buds.count; b++) {
				const f = piece.buds.frame.subarray(b * 4, b * 4 + 4);
				expect(
					Math.hypot(f[0] as number, f[1] as number, f[2] as number, f[3] as number),
				).toBeCloseTo(1, 5);
			}
		});
	}

	it('prefers the thickest axis near the asked length when the record hints no order', () => {
		const builder = new SkeletonBuilder();
		const stem = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
		let node = builder.addNode({ x: 0, y: 0, z: 0, radius: 0.4, parent: -1, axis: stem });
		for (let i = 1; i <= 12; i++)
			node = builder.addNode({ x: 0, y: i, z: 0, radius: 0.4, parent: node, axis: stem });
		const limb = (at: number, radius: number): number => {
			const axis = builder.addAxis({
				parent: stem,
				parentNode: at,
				parentT: 0,
				order: 1,
				kind: AXIS_LIMB,
			});
			let previous = builder.addNode({
				x: radius,
				y: at,
				z: 0,
				radius,
				parent: at,
				axis,
			});
			const first = previous;
			for (let i = 1; i <= 3; i++)
				previous = builder.addNode({
					x: radius + i * 0.3,
					y: at,
					z: 0,
					radius: radius * (1 - i * 0.1),
					parent: previous,
					axis,
				});
			builder.addBud({
				node: first,
				x: radius,
				y: at,
				z: 0,
				frame: [0, 0, 0, 1],
				kind: BUD_TERMINAL,
				vigor: 0.5,
				light: 1,
				axis,
				woodRadius: radius,
			});
			return axis;
		};
		const thin = limb(4, 0.04);
		const thick = limb(8, 0.16);
		const cut = cutBranch(
			builder.finish(0),
			{ ...stub.record, cuttings: undefined },
			{
				part: 'branch',
			},
		);
		if (!cut) throw new Error('nothing was cut');
		expect(cut.order).toBe(1);
		expect(cut.axis).toBe(thick);
		expect(cut.axis).not.toBe(thin);
	});

	it('cuts an axis that leaves at its parent node there, with every axis whose parents reach it', () => {
		// A stem of five nodes; a limb leaving its third node; a twig on the limb; a second limb above.
		const b = new SkeletonBuilder();
		const stem = b.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
		const stemNodes: number[] = [];
		for (let k = 0; k < 5; k++)
			stemNodes.push(
				b.addNode({
					x: 0,
					y: k,
					z: 0,
					radius: 0.2,
					parent: k === 0 ? -1 : (stemNodes[k - 1] as number),
					axis: stem,
				}),
			);
		const fork = stemNodes[2] as number;
		const limb = b.addAxis({
			parent: stem,
			parentNode: fork,
			parentT: 0,
			order: 1,
			kind: AXIS_LIMB,
		});
		const limbNodes: number[] = [];
		for (let k = 1; k <= 3; k++)
			limbNodes.push(
				b.addNode({
					x: 0.3 * k,
					y: 2 + 0.3 * k,
					z: 0,
					radius: 0.05,
					parent: k === 1 ? fork : (limbNodes[k - 2] as number),
					axis: limb,
				}),
			);
		const twig = b.addAxis({
			parent: limb,
			parentNode: limbNodes[1] as number,
			parentT: 0,
			order: 2,
			kind: AXIS_LIMB,
		});
		b.addNode({ x: 0.6, y: 2.9, z: 0.3, radius: 0.01, parent: limbNodes[1] as number, axis: twig });
		const other = b.addAxis({
			parent: stem,
			parentNode: stemNodes[3] as number,
			parentT: 0,
			order: 1,
			kind: AXIS_LIMB,
		});
		b.addNode({ x: -0.5, y: 3.4, z: 0, radius: 0.04, parent: stemNodes[3] as number, axis: other });
		const skeleton = b.finish();
		const cut = cutBranch(skeleton, stub.record, {
			part: 'branch',
			length: 1.3,
			orient: 'as-grown',
		});
		if (!cut) throw new Error('nothing was cut');
		expect(cut.axis).toBe(limb);
		expect(cut.skeleton.nodeCount).toBe(1 + 3 + 1);
		expect(cut.skeleton.axes.count).toBe(2);
		// The cut sits at the stem node the limb leaves from, so the limb's first node keeps its offset.
		expect(Array.from(cut.skeleton.position.subarray(3, 6))).toEqual([
			expect.closeTo(0.3, 5),
			expect.closeTo(0.3, 5),
			expect.closeTo(0, 5),
		]);
		expect(cut.extent).toBeCloseTo(Math.hypot(0.9, 0.9), 5);
	});

	it('cuts a branch and a sub-branch from the self-organizing oak, upright on their cut', () => {
		const oak = growSelfOrganizing({ record: oakRecord, seed: 11, variant: 0, season: 'summer' });
		for (const [part, length] of [
			['branch', 1],
			['subbranch', 0.35],
		] as const) {
			const cut = cutBranch(oak, oakRecord, { part });
			if (!cut) throw new Error(`the oak gave no ${part}`);
			const piece = cut.skeleton;
			expect(cut.order).toBeGreaterThanOrEqual(1);
			expect(Math.abs(Math.log(cut.extent / length))).toBeLessThan(0.5);
			expect(Array.from(piece.position.subarray(0, 3))).toEqual([0, 0, 0]);
			const [x, y, z] = meanNode(piece.position);
			expect(Math.hypot(x, z)).toBeLessThan(1e-4 * Math.max(1, y));
			expect(piece.buds.count).toBeGreaterThan(0);
			expect(piece.nodeCount).toBe(1 + countSubtreeNodes(oak.axes, oak.axes.count, cut.axis));
			let far = 0;
			for (let n = 0; n < piece.nodeCount; n++)
				far = Math.max(
					far,
					Math.hypot(
						piece.position[n * 3] as number,
						piece.position[n * 3 + 1] as number,
						piece.position[n * 3 + 2] as number,
					),
				);
			expect(far).toBeCloseTo(cut.extent, 4);
		}
	});

	it('ranks the branch nearest the asked length first, and takes others by pick', () => {
		const best = cutBranch(whole.skeleton, stub.record, { part: 'branch' });
		const second = cutBranch(whole.skeleton, stub.record, { part: 'branch', pick: 1 });
		const short = cutBranch(whole.skeleton, stub.record, { part: 'branch', length: 0.3 });
		if (!best || !second || !short) throw new Error('the stub grew no axis to cut');
		expect(second.axis).not.toBe(best.axis);
		const miss = (extent: number, length: number) => Math.abs(Math.log(extent / length));
		expect(miss(short.extent, 0.3)).toBeLessThanOrEqual(miss(best.extent, 0.3) + 0.15);
		expect(miss(best.extent, CUTTING_LENGTH.branch)).toBeLessThanOrEqual(
			miss(short.extent, CUTTING_LENGTH.branch) + 0.15,
		);
	});

	it('keeps the pose of a piece cut as grown', () => {
		const grown = cutBranch(whole.skeleton, stub.record, { part: 'branch', orient: 'as-grown' });
		const upright = cutBranch(whole.skeleton, stub.record, { part: 'branch' });
		if (!grown || !upright) throw new Error('the stub grew no axis to cut');
		expect(grown.axis).toBe(upright.axis);
		const [x, , z] = meanNode(grown.skeleton.position);
		expect(Math.hypot(x, z)).toBeGreaterThan(0.01);
	});

	it('dresses a cut branch into wood and merged shoots at the nearest level only', () => {
		const piece = growPlantNow(kit, { seed: 11, variant: 0, cutting: { part: 'branch' } });
		expect(piece.cutting?.part).toBe('branch');
		expect(piece.levels[0].parts.map((part) => part.name)).toEqual(['wood', 'foliage']);
		expect(piece.levels[1].parts).toHaveLength(0);
		expect(piece.levels[2].parts).toHaveLength(0);
		expect(piece.shoots.count).toBe(0);
		expect(piece.impostor.views).toBe(0);
		expect(piece.wind.count).toBe(piece.skeleton.axes.count);
		expect(piece.skeleton.bounds.min[1]).toBeGreaterThanOrEqual(-0.05);
		expect(piece.skeleton.height).toBeLessThan(whole.skeleton.height);
	});

	it('leaves the crown as it was when a cutting class joins the kit', async () => {
		// A cutting class is planned after the crown's prototypes and marked as a cutting's, so the
		// crown never offers one and no index it reads moves. A species that adds a cutting class
		// therefore keeps the crown it grew, and a figure that moves came from something else.
		const { species: oak } = await import('./species/pedunculate-oak');
		await loadPlantCode(oak.record);
		const without = { ...oak.record, shoots: { ...oak.record.shoots!, cuttingClasses: [] } };
		const before = buildKitNow(
			{ ...oak, record: without },
			{ placeholders: 'missing', detail: 'low' },
		);
		const after = buildKitNow(oak, { placeholders: 'missing', detail: 'low' });
		const grow = { seed: 11, variant: 0, near: true } as const;
		const own = growPlantNow(before, grow).shoots;
		const withCuttings = growPlantNow(after, grow).shoots;
		expect(withCuttings.count).toBe(own.count);
		expect(Array.from(withCuttings.prototype.subarray(0, own.count))).toEqual(
			Array.from(own.prototype),
		);
		expect(Array.from(withCuttings.position.subarray(0, own.count * 3))).toEqual(
			Array.from(own.position),
		);
	});

	it('takes a branch or sub-branch from the shoot class its record names', async () => {
		const { species: oak } = await import('./species/pedunculate-oak');
		await loadPlantCode(oak.record);
		const oakKit = buildKitNow(oak, { placeholders: 'missing', detail: 'low' });
		for (const part of ['branch', 'subbranch', 'cluster'] as const) {
			const hint = oak.record.cuttings?.[part];
			if (!hint || !('shoot' in hint)) throw new Error(`the oak names no shoot for its ${part}`);
			expect(cutsShoot(oak.record, part)).toBe(true);
			const piece = growPlantNow(oakKit, { seed: 11, variant: 0, cutting: { part } });
			expect(piece.shoots.count).toBe(1);
			const prototype = oakKit.prototypes[piece.shoots.prototype[0] as number];
			// A piece-carrying kit dresses the cut from the piece its sockets carry; another kit
			// dresses it from the shoot class the hint names.
			if (carriesPieces(oak.record)) {
				const growth = oak.record.growth;
				const sockets = 'sockets' in growth ? growth.sockets : undefined;
				const socketPiece = sockets && 'piece' in sockets ? sockets.piece : undefined;
				if (!socketPiece) throw new Error('the piece-carrying record names no socket piece');
				expect(prototype?.piece?.name).toBe(socketPiece);
			} else {
				expect(prototype?.class).toBe(hint.shoot);
			}
		}
		expect(cutsShoot(stub.record, 'branch')).toBe(false);
		expect(cutsShoot(stub.record, 'leaf')).toBe(false);
	});

	it('cuts a cluster that names a plant cut from one long axis, not from the kit', async () => {
		// A crown-rosette frond is a long leaf axis of the grown plant, and its record states the
		// cluster cut over that axis. The cut must keep the axis rather than refuse it as a
		// shoot-style cluster does.
		const { species: fernModule } = await import('./species/tree-fern');
		const { record: fernRecord } = await import('./species/tree-fern/record');
		await loadPlantCode(fernRecord);
		const kit = buildKitNow(
			{ record: fernRecord, textures: fernModule.textures },
			{ placeholders: 'missing', detail: 'low' },
		);
		const whole = growPlantNow(kit, { seed: 11, variant: 0, near: true });
		const hint = fernRecord.cuttings?.cluster;
		if (!hint || !('order' in hint))
			throw new Error('the fern record names no plant cut for its cluster');
		expect(cutsShoot(fernRecord, 'cluster')).toBe(false);
		const cut = cutBranch(whole.skeleton, fernRecord, { part: 'cluster' });
		if (!cut) throw new Error('the fern cluster cut found no axis');
		expect(cut.order).toBe(hint.order);
		// The piece is the span of one frond, not the whole plant.
		expect(cut.skeleton.height).toBeLessThan(whole.skeleton.height * 0.5);
		expect(cut.skeleton.height).toBeGreaterThan((hint.span ?? 0) * 0.5);
	});

	it("takes a plant cut's leaf scale from its record, and the crown's size when none is named", async () => {
		// The crown-rosette frond states a plant cut with a leaf scale of its own: the scale lengthens
		// its pinnae alone, so the cut's axes and nodes stay where they are.
		const { species: fernModule } = await import('./species/tree-fern');
		const { record: fernRecord } = await import('./species/tree-fern/record');
		await loadPlantCode(fernRecord);
		const hint = fernRecord.cuttings?.cluster;
		if (!hint || !('order' in hint))
			throw new Error('the fern record names no plant cut for its cluster');
		const kitOf = (scale?: number) =>
			buildKitNow(
				{
					record: {
						...fernRecord,
						cuttings: {
							...fernRecord.cuttings,
							cluster: scale === undefined ? hint : { ...hint, scale },
						},
					},
					textures: fernModule.textures,
				},
				{ placeholders: 'missing', detail: 'low' },
			);
		const grow = { seed: 11, variant: 0, cutting: { part: 'cluster' } } as const;
		const own = hint.scale ?? 1;
		const plain = growPlantNow(kitOf(), grow);
		const same = growPlantNow(kitOf(own), grow);
		const smaller = growPlantNow(kitOf(own * 0.9), grow);
		expect(plantAssetDigest(same)).toBe(plantAssetDigest(plain));
		// The scale steers the leaflets' size alone: the cut's axes and nodes stay where they are.
		expect(smaller.skeleton).toEqual(plain.skeleton);
		expect(plantAssetDigest(smaller)).not.toBe(plantAssetDigest(plain));
	});

	it('stands a shoot cutting upright on its attach point, or as grown when asked', async () => {
		const { species: oak } = await import('./species/pedunculate-oak');
		await loadPlantCode(oak.record);
		const oakKit = buildKitNow(oak, { placeholders: 'missing', detail: 'low' });
		for (const part of ['branch', 'subbranch', 'cluster'] as const) {
			const piece = growPlantNow(oakKit, { seed: 11, variant: 0, cutting: { part } });
			const prototype = oakKit.prototypes[piece.shoots.prototype[0] as number];
			if (!prototype) throw new Error(`the oak's ${part} drew no prototype`);
			// The mean of the low tier's stem vertices, turned as the row stands, lies straight above the cut.
			const { positions: p, colors } = prototype.tiers[0];
			const mean: [number, number, number] = [0, 0, 0];
			for (let i = 0; i < p.length; i += 3)
				if (colors[(i / 3) * 4 + 2] === SURFACE_STEM)
					for (let k = 0; k < 3; k++) mean[k] = (mean[k] as number) + (p[i + k] as number);
			const [x, y, z] = quatRotate(piece.shoots.rotation, 0, mean, [0, 0, 0]);
			expect(Math.hypot(x, z)).toBeLessThan(1e-4 * y);
			const grown = growPlantNow(oakKit, {
				seed: 11,
				variant: 0,
				cutting: { part, orient: 'as-grown' },
			});
			expect(Array.from(grown.shoots.rotation)).toEqual([0, 0, 0, 1]);
		}
	});

	it(
		'presses a cut leaf flat where the record says, and leaves it as on the plant otherwise',
		async () => {
			const { species: oak } = await import('./species/pedunculate-oak');
			await loadPlantCode(oak.record);
			const shaped = {
				...oak,
				record: { ...oak.record, cuttings: { ...oak.record.cuttings, leaf: undefined } },
			};
			const pressedKit = buildKitNow(oak, { placeholders: 'missing', detail: 'low' });
			const shapedKit = buildKitNow(shaped, { placeholders: 'missing', detail: 'low' });
			const pressed = cutFoliage(pressedKit, { part: 'leaf' }, 'low');
			const plain = cutFoliage(shapedKit, { part: 'leaf' }, 'low');
			if (!pressed || !plain) throw new Error('the oak has no leaf');
			// The pressed blade lies in the plane of its frame; the plant's own blade folds and curls out
			// of it, and the kit's leaves are the plant's.
			let flat = 0;
			let shapedDepth = 0;
			for (let i = 2; i < pressed.positions.length; i += 3)
				flat = Math.max(flat, Math.abs(pressed.positions[i] as number));
			for (let i = 2; i < plain.positions.length; i += 3)
				shapedDepth = Math.max(shapedDepth, Math.abs(plain.positions[i] as number));
			expect(flat).toBeLessThan(1e-6);
			expect(shapedDepth).toBeGreaterThan(0.005);
			expect(Array.from(plain.positions)).toEqual(Array.from(shapedKit.leaves[0]?.positions ?? []));
			expect(Array.from(pressedKit.leaves[0]?.positions ?? [])).toEqual(
				Array.from(shapedKit.leaves[0]?.positions ?? []),
			);
			// A piece may ask for itself: as grown where the record presses, pressed where it does not.
			const grown = cutFoliage(pressedKit, { part: 'leaf', pressed: false }, 'low');
			const flattened = cutFoliage(shapedKit, { part: 'leaf', pressed: true }, 'low');
			expect(Array.from(grown?.positions ?? [])).toEqual(Array.from(plain.positions));
			expect(Array.from(flattened?.positions ?? [])).toEqual(Array.from(pressed.positions));
			// Two whole kits of a mature species are built, which no other test in this file does.
		},
		scaledBudget(20_000),
	);

	it('presses a cut grass blade flat in its frame', async () => {
		const { species } = await import('./species/sedge');
		const { record } = species;
		await loadPlantCode(record);
		const pressedKit = buildKitNow(species, { placeholders: 'missing', detail: 'low' });
		// The grown kit keeps the record's leaf length but not its press, so the explicit press
		// below is the same piece the record's own hint draws.
		const grown = {
			...record,
			cuttings: { ...record.cuttings, leaf: { ...record.cuttings?.leaf, pressed: false } },
		};
		const grownKit = buildKitNow(
			{ ...species, record: grown },
			{ placeholders: 'missing', detail: 'low' },
		);
		const pressed = cutFoliage(pressedKit, { part: 'leaf' }, 'low');
		const plain = cutFoliage(grownKit, { part: 'leaf' }, 'low');
		if (!pressed || !plain) throw new Error('the sedge has no leaf');
		// A picked blade lies in the plane of its frame; the plant's blade folds and twists out of it.
		const depth = (mesh: { readonly positions: Float32Array }): number => {
			let far = 0;
			for (let i = 2; i < mesh.positions.length; i += 3)
				far = Math.max(far, Math.abs(mesh.positions[i] as number));
			return far;
		};
		expect(depth(pressed)).toBeLessThan(1e-6);
		expect(depth(plain)).toBeGreaterThan(0.002);
		expect(Array.from(plain.positions)).toEqual(Array.from(grownKit.leaves[0]?.positions ?? []));
		const flattenOfGrown = cutFoliage(grownKit, { part: 'leaf', pressed: true }, 'low');
		expect(Array.from(flattenOfGrown?.positions ?? [])).toEqual(Array.from(pressed.positions));
	});

	it('presses a cut frond flat in its own plane', async () => {
		const { brackenRecord } = await import('./grow/bracken.fixture');
		const { noTextureFiles } = await import('./core/textures');
		await loadPlantCode(brackenRecord);
		const species = { record: brackenRecord, textures: noTextureFiles(brackenRecord.id) };
		const frondKit = buildKitNow(species, { placeholders: 'missing', detail: 'low' });
		const depth = (mesh: ReturnType<typeof cutFoliage> | undefined): number => {
			let far = 0;
			for (let i = 2; i < (mesh?.positions.length ?? 0); i += 3)
				far = Math.max(far, Math.abs(mesh?.positions[i] as number));
			return far;
		};
		// The frond of the plant curls out of its frame's plane; the pressed one lies in it, the
		// blade flat and only its stipe's own tube standing off the axis.
		expect(depth(cutFoliage(frondKit, { part: 'leaf' }, 'low'))).toBeGreaterThan(0.05);
		expect(depth(cutFoliage(frondKit, { part: 'leaf', pressed: true }, 'low'))).toBeLessThan(0.01);
		// A frond named young is the same leaf earlier in its opening: it is drawn again, and it is
		// shorter than the frond it opens into, which is the crozier the picture shows.
		const tall = (mesh: ReturnType<typeof cutFoliage> | undefined): number => {
			let high = 0;
			for (let i = 1; i < (mesh?.positions.length ?? 0); i += 3)
				high = Math.max(high, mesh?.positions[i] as number);
			return high;
		};
		const mature = cutFoliage(frondKit, { part: 'leaf' }, 'low');
		const young = cutFoliage(frondKit, { part: 'leaf', age: 0.1 }, 'low');
		expect(Array.from(young?.positions ?? [])).not.toEqual(Array.from(mature?.positions ?? []));
		expect(tall(young)).toBeLessThan(tall(mature));
		// An age outside the leaf's opening is refused rather than drawn as something else.
		expect(() => cutFoliage(frondKit, { part: 'leaf', age: 1.5 }, 'low')).toThrow(
			/runs from 0 to 1/,
		);
	});

	it('cuts a cluster from a frond colony rather than the whole plant', async () => {
		const { brackenRecord } = await import('./grow/bracken.fixture');
		const { noTextureFiles } = await import('./core/textures');
		await loadPlantCode(brackenRecord);
		const species = { record: brackenRecord, textures: noTextureFiles(brackenRecord.id) };
		const frondKit = buildKitNow(species, { placeholders: 'missing', detail: 'low' });
		const grown = growPlantNow(frondKit, { seed: 11, variant: 0, near: true });
		// The colony's fronds stand on stipes that are each a root of their own, so cut the cluster
		// without a hint leaves no candidate under the cluster rule, which refuses a rachis. The
		// fallback takes the rachis: the piece is one blade hanging from its cut, not the colony.
		const piece = cutBranch(grown.skeleton, brackenRecord, { part: 'cluster' });
		expect(piece).toBeDefined();
		const baked = (piece as NonNullable<typeof piece>).skeleton;
		expect(baked.axes.count).toBeGreaterThan(0);
		expect(baked.axes.count).toBeLessThan(grown.skeleton.axes.count);
		// One root node, the cut face: every other node hangs from it.
		let roots = 0;
		for (let node = 0; node < baked.nodeCount; node++)
			if ((baked.parent[node] as number) < 0) roots++;
		expect(roots).toBe(1);
	});

	it('gives a rosette piece the leaf count its cutting hint names', async () => {
		const { hostaRecord } = await import('./grow/ground.fixture');
		const { noTextureFiles } = await import('./core/textures');
		const { AXIS_LEAF } = await import('./grow/ground');
		await loadPlantCode(hostaRecord);
		// The leaves one cut eye carries, with the hint given and with the crown's own count.
		const leavesOfPiece = (hint?: number): number => {
			const record =
				hint === undefined
					? hostaRecord
					: {
							...hostaRecord,
							cuttings: { ...hostaRecord.cuttings, leaves: { mean: hint, spread: 0 } },
						};
			const kit = buildKitNow(
				{ record, textures: noTextureFiles(record.id) },
				{ placeholders: 'missing', detail: 'low' },
			);
			const piece = growPlantNow(kit, {
				seed: 11,
				variant: 0,
				near: true,
				cutting: { part: 'subbranch' },
			});
			let leaves = 0;
			for (let a = 0; a < piece.skeleton.axes.count; a++)
				if ((piece.skeleton.axes.kind[a] as number) === AXIS_LEAF) leaves++;
			return leaves;
		};
		const crown = leavesOfPiece();
		const sparse = leavesOfPiece(3);
		expect(sparse).toBeLessThan(crown);
		expect(sparse).toBeLessThanOrEqual(4);
	});

	it('scales the leaf of a rosette piece from its cutting hint', async () => {
		const { hostaRecord } = await import('./grow/ground.fixture');
		const { noTextureFiles } = await import('./core/textures');
		await loadPlantCode(hostaRecord);
		const heightOfPiece = (scale?: number): number => {
			const cuttings = {
				...hostaRecord.cuttings,
				...(scale === undefined ? {} : { subbranch: { order: 1, length: 0.4, scale } }),
			};
			const record = { ...hostaRecord, cuttings };
			const kit = buildKitNow(
				{ record, textures: noTextureFiles(record.id) },
				{ placeholders: 'missing', detail: 'low' },
			);
			return growPlantNow(kit, {
				seed: 11,
				variant: 0,
				near: true,
				cutting: { part: 'subbranch' },
			}).skeleton.height;
		};
		expect(heightOfPiece(0.5)).toBeLessThan(heightOfPiece(1));
	});

	it('gives a woodless plant a piece with no wood, and a woody plant its cut face', async () => {
		const { hostaRecord } = await import('./grow/ground.fixture');
		const { noTextureFiles } = await import('./core/textures');
		const { species: oak } = await import('./species/pedunculate-oak');
		await loadPlantCode(hostaRecord);
		await loadPlantCode(oak.record);
		const partsOf = (kit: SpeciesKitData, part: 'branch' | 'subbranch'): string[] =>
			growPlantNow(kit, {
				seed: 11,
				variant: 0,
				near: true,
				cutting: { part },
			}).levels[0].parts.map((p) => p.name);
		const hostaKit = buildKitNow(
			{ record: hostaRecord, textures: noTextureFiles(hostaRecord.id) },
			{ placeholders: 'missing', detail: 'low' },
		);
		for (const part of ['branch', 'subbranch'] as const)
			expect(partsOf(hostaKit, part)).not.toContain('wood');
		// A woody plant's piece keeps its cut face: its root hangs on a stem, so the cut end draws.
		const cutOak: Species = {
			...oakRecord,
			id: 'cut-oak',
			cuttings: { ...oakRecord.cuttings, branch: { order: 1, length: 1 } },
		};
		await loadPlantCode(cutOak);
		const oakKit = buildKitNow(
			{ record: cutOak, textures: noTextureFiles(cutOak.id) },
			{ placeholders: 'missing', detail: 'low' },
		);
		expect(partsOf(oakKit, 'branch')).toContain('wood');
	});

	it('cuts a leaf with either face toward +Z, and a cluster in rank order', () => {
		const upper = cutFoliage(kit, { part: 'leaf' }, kit.detail);
		const lower = cutFoliage(kit, { part: 'leaf', face: 'lower' }, kit.detail);
		if (!upper || !lower) throw new Error('the stub has no leaf');
		expect(upper.normals[2]).toBeCloseTo(1, 5);
		expect(lower.normals[2]).toBeCloseTo(-1, 5);
		const ranked = clusterRank(kit);
		const cluster = cutFoliage(kit, { part: 'cluster', pick: 1 }, kit.detail);
		expect(cluster?.positions.length).toBe(ranked[1]?.tiers[2].positions.length);
		const leaf = growPlantNow(kit, { seed: 11, variant: 0, cutting: { part: 'leaf' } });
		expect(leaf.levels[0].parts.map((part) => part.name)).toEqual(['foliage']);
		expect(leaf.skeleton.height).toBeGreaterThan(0);
	});

	it('fans the shoots a branch hint names, and keeps one without it', () => {
		const className = kit.record.shoots?.classes?.[0]?.name ?? 'cut';
		const hinted = {
			...kit,
			record: {
				...kit.record,
				cuttings: { branch: { shoot: className, shoots: 3 } },
			},
		} as SpeciesKitData;
		const single = clusterRow(kit, { part: 'branch' }, kit.detail);
		const fanned = clusterRow(hinted, { part: 'branch' }, kit.detail);
		expect(single?.rows.count).toBe(1);
		expect(fanned?.rows.count).toBe(3);
		// The shoots stand apart: the second row's place differs from the first's.
		expect(fanned?.rows.position[3]).not.toBe(fanned?.rows.position[0]);
		// A cluster keeps one shoot whatever its hint names.
		const clusterHinted = clusterRow(hinted, { part: 'cluster' }, kit.detail);
		expect(clusterHinted?.rows.count).toBe(1);
	});

	it('lets a piece name its own shoot class over the record hint', () => {
		const hint = kit.record.shoots?.classes?.[0]?.name;
		const other = kit.prototypes.map((p) => p.class).find((name) => name !== hint);
		if (!other) return;
		const row = clusterRow(kit, { part: 'subbranch', shoot: other }, kit.detail);
		const drawn = kit.prototypes[row?.rows.prototype[0] as number]?.class;
		expect(drawn).toBe(other);
	});

	it('lets a piece name its own shoot count and ring over the record hint', () => {
		const className = kit.record.shoots?.classes?.[0]?.name ?? 'cut';
		const hinted = {
			...kit,
			record: {
				...kit.record,
				cuttings: { branch: { shoot: className, shoots: 3, fanRing: 0.06, fanSpin: 0 } },
			},
		} as SpeciesKitData;
		const single = clusterRow(hinted, { part: 'branch', shoots: 1 }, kit.detail);
		const seven = clusterRow(hinted, { part: 'branch', shoots: 7, ring: 0.4 }, kit.detail);
		expect(single?.rows.count).toBe(1);
		expect(seven?.rows.count).toBe(7);
		// The wider ring stands the rows further from the piece's axis than the hint's near-base ring.
		expect(seven?.bounds.max[0]).toBeGreaterThan((single?.bounds.max[0] as number) + 1e-6);
	});

	it('turns a whole fanned piece a quarter about its axis', () => {
		const className = kit.record.shoots?.classes?.[0]?.name ?? 'cut';
		const hint = { shoot: className, shoots: 3, fanRing: 0.06, fanSpin: 0 };
		const withHint = (extra: object): SpeciesKitData =>
			({
				...kit,
				record: { ...kit.record, cuttings: { branch: { ...hint, ...extra } } },
			}) as SpeciesKitData;
		const plain = clusterRow(withHint({}), { part: 'branch' }, kit.detail);
		const turned = clusterRow(withHint({ fanYaw: 90 }), { part: 'branch' }, kit.detail);
		if (!plain || !turned) throw new Error('the kit grew no piece to turn');
		const span = (row: typeof plain) => [
			(row.bounds.max[0] as number) - (row.bounds.min[0] as number),
			(row.bounds.max[2] as number) - (row.bounds.min[2] as number),
		];
		const [px, pz] = span(plain) as [number, number];
		const [tx, tz] = span(turned) as [number, number];
		// A quarter turn about the upright axis swaps the piece's width and its depth.
		expect(Math.abs(tx - pz)).toBeLessThan(0.05 * Math.max(1, pz));
		expect(Math.abs(tz - px)).toBeLessThan(0.05 * Math.max(1, px));
	});

	it('fans a piece from one shared base across its own leaf plane', () => {
		const className = kit.record.shoots?.classes?.[0]?.name ?? 'cut';
		const hinted = {
			...kit,
			record: {
				...kit.record,
				cuttings: { branch: { shoot: className, shoots: 5, fanRing: 0, fanSpin: 0 } },
			},
		} as SpeciesKitData;
		const ring = clusterRow(hinted, { part: 'branch' }, kit.detail);
		const fan = clusterRow(hinted, { part: 'branch', layout: 'fan', spread: 1 }, kit.detail);
		if (!ring || !fan) throw new Error('the kit grew no piece to fan');
		// Every row of a fan leaves the same foot.
		for (let row = 0; row < fan.rows.count; row++)
			expect([...fan.rows.position.subarray(row * 3, row * 3 + 3)]).toEqual([0, 0, 0]);
		// The fan opens a body the unspread rows do not reach.
		const size = (row: typeof fan) =>
			[0, 1, 2].reduce(
				(v, k) => v * ((row.bounds.max[k] as number) - (row.bounds.min[k] as number)),
				1,
			);
		expect(size(fan)).toBeGreaterThan(size(ring) * 1.1);
		// A record hint names the same fan the caller can.
		const recorded = clusterRow(
			{
				...hinted,
				record: {
					...hinted.record,
					cuttings: {
						branch: { shoot: className, shoots: 5, layout: 'fan', spread: 1 },
					},
				},
			} as SpeciesKitData,
			{ part: 'branch' },
			kit.detail,
		);
		expect(recorded?.bounds.max[2]).toBeCloseTo(fan.bounds.max[2] as number, 5);
	});

	it('joins hanging laterals to one upright stem', () => {
		const lateralClass = kit.record.shoots?.classes?.[0]?.name ?? 'cut';
		const stemClass = kit.record.shoots?.cuttingClasses?.[0]?.name ?? lateralClass;
		const hinted = {
			...kit,
			record: {
				...kit.record,
				cuttings: {
					branch: { shoot: lateralClass, stem: stemClass, laterals: 3 },
				},
			},
		} as SpeciesKitData;
		const piece = clusterRow(hinted, { part: 'branch' }, kit.detail);
		if (!piece) throw new Error('the kit grew no stem piece');
		expect(piece.rows.count).toBe(4);
		// The stem stands on its cut at the foot, and every lateral roots above it.
		expect([...piece.rows.position.subarray(0, 3)]).toEqual([0, 0, 0]);
		for (let row = 1; row < piece.rows.count; row++) {
			const y = piece.rows.position[row * 3 + 1] as number;
			expect(y).toBeGreaterThan(0);
			expect(y).toBeLessThan(piece.bounds.max[1] as number);
		}
		// The stem draws the stem's class and the laterals the piece's own.
		const drawn = [...piece.rows.prototype].map((index) => kit.prototypes[index]?.class);
		expect(drawn[0]).toBe(stemClass);
		expect(drawn[1]).toBe(lateralClass);
		// A cluster keeps one shoot, whatever its hint names.
		expect(clusterRow(hinted, { part: 'cluster' }, kit.detail)?.rows.count).toBe(1);
		// A shorter lateral scale draws a narrower piece and shows in the rows' own scales.
		const shorter = clusterRow(
			{
				...hinted,
				record: {
					...hinted.record,
					cuttings: {
						branch: { shoot: lateralClass, stem: stemClass, laterals: 3, lateralScale: 0.5 },
					},
				},
			} as SpeciesKitData,
			{ part: 'branch' },
			kit.detail,
		);
		if (!shorter) throw new Error('the kit grew no shorter stem piece');
		expect(shorter.rows.scale[1]).toBeCloseTo(0.5, 5);
		const width = (row: typeof piece) =>
			(row.bounds.max[0] as number) - (row.bounds.min[0] as number);
		expect(width(shorter)).toBeLessThan(width(piece));
	});

	it('grows the same bytes twice, and in a worker that runs the job-worker task', async () => {
		const options = { seed: 11, variant: 0, cutting: { part: 'subbranch' as const } };
		const here = plantAssetDigest(growPlantNow(kit, options));
		expect(plantAssetDigest(growPlantNow(kit, options))).toBe(here);
		const dir = mkdtempSync(join(tmpdir(), 'plant-cutting-'));
		try {
			const script = join(dir, 'worker.ts');
			writeFileSync(
				script,
				`import { run } from ${JSON.stringify(join(import.meta.dirname, 'generate-task.ts'))};
self.onmessage = async (event) => {
	const answer = await run(event.data);
	postMessage(answer.output, answer.transfer);
};
`,
			);
			const worker = new Worker(script);
			const grown = await new Promise<PlantAsset>((resolve, reject) => {
				worker.onmessage = (event) => resolve(event.data as PlantAsset);
				worker.onerror = (event) => reject(new Error(String(event.message)));
				worker.postMessage({ stage: 'grow', kit, options } satisfies PlantTaskInput);
			});
			worker.terminate();
			expect(plantAssetDigest(grown)).toBe(here);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

/** The nodes of an axis's subtree in a skeleton's axis table. */
function countSubtreeNodes(
	axes: PlantAsset['skeleton']['axes'],
	count: number,
	root: number,
): number {
	let nodes = 0;
	for (let a = 0; a < count; a++) {
		let at = a;
		while (at >= 0 && at !== root) at = axes.parent[at] as number;
		if (at === root) nodes += (axes.last[a] as number) - (axes.first[a] as number) + 1;
	}
	return nodes;
}
