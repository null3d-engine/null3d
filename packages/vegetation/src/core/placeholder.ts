// The stand-ins: a simple, deterministic result for every stage of the generator, which a run that
// asks for `placeholders` uses at every stage, so a stand-in species draws the same as stages land. They let the review page, the
// determinism tests and the stage packages run the whole pipeline from the first day: a stem with
// tiers of limbs and twigs, a leaf quad, small shoots, flat cards, tubes of a few sides, and an
// impostor of flat cells. They read only the record's numbers and the integer hash, and use only the
// core's own trigonometry, so their bytes are the same on every engine. No shipped species draws
// them: a run without `placeholders` throws where a stage is missing.

import type {
	CardCell,
	MeshArrays,
	PlantAsset,
	PlantLevel,
	PlantPart,
	PrototypeArrays,
	QuantisedArrays,
	ShootPrototype,
	ShootRows,
	SpeciesKitData,
	WindTable,
} from '../asset';
import { crownPrototypes } from '../asset';
import type { UncardedPrototype } from '../leaf/shoot';
import { firstCardStart, REFERENCE_VIEW } from '../lod/levels';
import { TEXTURE_UV_STEPS } from '../lod/quantise';
import { HEADER, HEADER_ROWS, RECORDS_WIDTH } from '../render/records';
import type { CardAtlas, CrownLight, DressInput, FarBake, GrowInput, MeshInput } from '../stages';
import { flutterAmplitudeAt, VARIANT_RECORDS, WIND_RECORD_FLOATS, windSway } from '../wind/records';
import type { SpeciesBox } from './box';
import {
	AXIS_LIMB,
	AXIS_STEM,
	BUD_LATERAL,
	BUD_TERMINAL,
	type MacroSkeleton,
	SkeletonBuilder,
} from './graph';
import { hashAt, unitAt } from './hash';
import {
	cos,
	cross3,
	length3,
	normalize3,
	pow,
	quatFromFrame,
	quatRotate,
	radians,
	sin,
	tan,
	type Vector3,
} from './math';
import type { Foliage, Species } from './record';
import { curveAt, DETAILS, type Detail, spreadAt, spreadMean } from './types';

/** The golden angle in radians, which spreads limbs and leaves around an axis. */
const GOLDEN = radians(137.50776405);

/** Purposes of the stand-ins' hash keys, so no two draws share one. */
const Purpose = {
	Height: 1,
	Lean: 2,
	Turn: 3,
	Limb: 4,
	Twig: 5,
	Prototype: 6,
	Scale: 7,
	Phase: 8,
	Wind: 9,
} as const;

/** A mesh under construction, in plain number lists. */
class MeshWriter {
	readonly positions: number[] = [];
	readonly normals: number[] = [];
	readonly uvs: number[] = [];
	readonly uvs1: number[] = [];
	readonly colors: number[] = [];
	readonly indices: number[] = [];

	get vertices(): number {
		return this.positions.length / 3;
	}

	vertex(
		p: Readonly<Vector3>,
		n: Readonly<Vector3>,
		u: number,
		v: number,
		color: readonly number[],
	): number {
		this.positions.push(p[0], p[1], p[2]);
		this.normals.push(n[0], n[1], n[2]);
		this.uvs.push(u, v);
		this.uvs1.push(0, 0);
		this.colors.push(
			color[0] as number,
			color[1] as number,
			color[2] as number,
			color[3] as number,
		);
		return this.vertices - 1;
	}

	finish(): MeshArrays {
		const count = this.vertices;
		return {
			positions: new Float32Array(this.positions),
			normals: new Float32Array(this.normals),
			uvs: new Float32Array(this.uvs),
			uvs1: new Float32Array(this.uvs1),
			colors: new Uint8Array(this.colors),
			indices: count > 0xffff ? new Uint32Array(this.indices) : new Uint16Array(this.indices),
		};
	}

	finishPrototype(): PrototypeArrays {
		const mesh = this.finish();
		return { ...mesh, indices: new Uint16Array(this.indices) };
	}
}

/** The length of the species' leaf, needle or blade in metres. */
function leafLength(foliage: Foliage): number {
	switch (foliage.kind) {
		case 'blade':
			return spreadMean(foliage.leaf.length);
		case 'needle':
		case 'fascicle':
			return spreadMean(foliage.needle.length);
		case 'grass-blade':
			return spreadMean(foliage.blade.length);
		case 'thick':
			return spreadMean(foliage.leaf.length);
		case 'scale-spray':
			return foliage.spray.segment * 4;
		case 'frond':
			return 0.3;
		default:
			return 0;
	}
}

/** A linear colour as bytes, with an alpha. */
function colourBytes(rgb: readonly number[], alpha: number): number[] {
	return [
		Math.round(Math.min(1, Math.max(0, rgb[0] as number)) * 255),
		Math.round(Math.min(1, Math.max(0, rgb[1] as number)) * 255),
		Math.round(Math.min(1, Math.max(0, rgb[2] as number)) * 255),
		alpha,
	];
}

/** A linear colour as sRGB bytes, as the far bake's colour atlas holds it. */
function srgbBytes(rgb: readonly number[], alpha: number): number[] {
	const encode = (value: number) => {
		const c = Math.min(1, Math.max(0, value));
		return Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1 / 2.4) - 0.055) * 255);
	};
	return [encode(rgb[0] as number), encode(rgb[1] as number), encode(rgb[2] as number), alpha];
}

/** The species' leaf colour, or a green where it has no optics. */
function leafColour(foliage: Foliage): readonly number[] {
	switch (foliage.kind) {
		case 'blade':
		case 'thick':
			return foliage.leaf.optics.reflectance;
		case 'needle':
		case 'fascicle':
			return foliage.needle.optics.reflectance;
		case 'grass-blade':
			return foliage.blade.optics.reflectance;
		case 'scale-spray':
			return foliage.spray.optics.reflectance;
		case 'frond':
			return foliage.optics.reflectance;
		default:
			return [0.1, 0.2, 0.06];
	}
}

/**
 * The stand-in leaf: one diamond quad in the leaf frame, the petiole tip at the origin and the
 * midrib up +Y, facing +Z. One per species; a leafless species has none.
 */
export function placeholderLeaves(record: Species, detail: Detail): PrototypeArrays[] {
	void detail;
	const length = leafLength(record.foliage);
	if (length <= 0) return [];
	const width = record.foliage.kind === 'needle' ? record.foliage.needle.width : length * 0.4;
	const mesh = new MeshWriter();
	const normal: Vector3 = [0, 0, 1];
	const leaf = [0, 0, 0, 255];
	const corners: [number, number, number, number][] = [
		[0, 0, 0.5, 0],
		[-width / 2, length * 0.4, 0, 0.4],
		[0, length, 0.5, 1],
		[width / 2, length * 0.4, 1, 0.4],
	];
	for (const [x, y, u, v] of corners) mesh.vertex([x, y, 0], normal, u, v, leaf);
	for (let i = 0; i < 4; i++) {
		const [x, y] = corners[i] as [number, number, number, number];
		mesh.uvs1[i * 2] = y;
		mesh.uvs1[i * 2 + 1] = x;
	}
	mesh.indices.push(0, 1, 2, 0, 2, 3);
	return [mesh.finishPrototype()];
}

/** A ring of `sides` vertices about `centre`, square to `direction`, closed by a seam copy. */
function ring(
	mesh: MeshWriter,
	centre: Readonly<Vector3>,
	direction: Readonly<Vector3>,
	radius: number,
	sides: number,
	v: number,
	tiles: number,
	color: readonly number[],
): number {
	const reference: Vector3 = Math.abs(direction[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
	const u = normalize3(cross3(direction, reference, [0, 0, 0]));
	const w = cross3(direction, u, [0, 0, 0]);
	const first = mesh.vertices;
	for (let j = 0; j <= sides; j++) {
		const angle = (j / sides) * 2 * Math.PI;
		const c = cos(angle);
		const s = sin(angle);
		const n: Vector3 = [c * u[0] + s * w[0], c * u[1] + s * w[1], c * u[2] + s * w[2]];
		mesh.vertex(
			[centre[0] + n[0] * radius, centre[1] + n[1] * radius, centre[2] + n[2] * radius],
			n,
			(j / sides) * tiles,
			v,
			color,
		);
	}
	return first;
}

/** Joins two rings of `sides` faces each with quads. */
function joinRings(mesh: MeshWriter, a: number, b: number, sides: number): void {
	for (let j = 0; j < sides; j++)
		mesh.indices.push(a + j, b + j, a + j + 1, a + j + 1, b + j, b + j + 1);
}

/** Copies a leaf mesh into `mesh`, turned by `q`, scaled and moved to `at`. */
function placeLeaf(
	mesh: MeshWriter,
	leaf: PrototypeArrays,
	q: ArrayLike<number>,
	scale: number,
	at: Readonly<Vector3>,
	phase: number,
	bend: number,
): void {
	const base = mesh.vertices;
	const count = leaf.positions.length / 3;
	const v: Vector3 = [0, 0, 0];
	for (let i = 0; i < count; i++) {
		quatRotate(
			q,
			0,
			[
				leaf.positions[i * 3] as number,
				leaf.positions[i * 3 + 1] as number,
				leaf.positions[i * 3 + 2] as number,
			],
			v,
		);
		const p: Vector3 = [at[0] + v[0] * scale, at[1] + v[1] * scale, at[2] + v[2] * scale];
		quatRotate(
			q,
			0,
			[
				leaf.normals[i * 3] as number,
				leaf.normals[i * 3 + 1] as number,
				leaf.normals[i * 3 + 2] as number,
			],
			v,
		);
		mesh.vertex(p, [v[0], v[1], v[2]], leaf.uvs[i * 2] as number, leaf.uvs[i * 2 + 1] as number, [
			bend,
			phase,
			0,
			255,
		]);
		mesh.uvs1[(base + i) * 2] = (leaf.uvs1[i * 2] as number) * scale;
		mesh.uvs1[(base + i) * 2 + 1] = (leaf.uvs1[i * 2 + 1] as number) * scale;
	}
	for (const index of leaf.indices) mesh.indices.push(base + index);
}

/**
 * The stand-in shoot prototypes: a straight stem of three sides with leaves on a golden-angle spiral,
 * at the angles and scales the shoot class gives, the same at every tier.
 */
export function placeholderPrototypes(
	record: Species,
	leaves: readonly (readonly PrototypeArrays[])[],
): UncardedPrototype[] {
	const shoots = record.shoots;
	if (!shoots) return [];
	const classes = shoots.classes;
	const out: UncardedPrototype[] = [];
	for (let index = 0; index < shoots.prototypes; index++) {
		const share = (index + 0.5) / shoots.prototypes;
		let shootClass = classes[classes.length - 1];
		let sum = 0;
		for (const candidate of classes) {
			sum += candidate.share;
			if (share <= sum) {
				shootClass = candidate;
				break;
			}
		}
		if (!shootClass) break;
		const length = spreadMean(shootClass.length);
		const nodes = Math.max(1, Math.min(8, Math.round(spreadMean(shootClass.nodes))));
		const tiers = DETAILS.map((_, tier) => {
			const mesh = new MeshWriter();
			const stem = [0, 0, 85, 255];
			const bottom = ring(mesh, [0, 0, 0], [0, 1, 0], shoots.stem.radius[0], 3, 0, 1, stem);
			const top = ring(
				mesh,
				[0, length, 0],
				[0, 1, 0],
				shoots.stem.radius[1],
				3,
				length,
				1,
				[255, 0, 85, 255],
			);
			joinRings(mesh, bottom, top, 3);
			const leaf = leaves[tier]?.[0];
			if (leaf) {
				for (let k = 0; k < nodes; k++) {
					const t = (k + 1) / (nodes + 1);
					const azimuth = k * GOLDEN + index;
					const tilt = radians(curveAt(shootClass.leafAngle, t));
					const up: Vector3 = [sin(tilt) * cos(azimuth), cos(tilt), sin(tilt) * sin(azimuth)];
					const q = [0, 0, 0, 1];
					quatFromFrame(up, [0, 1, 0], q);
					const scale = Math.max(0.05, curveAt(shootClass.leafScale, t));
					placeLeaf(mesh, leaf, q, scale, [0, t * length, 0], (k * 53) & 255, Math.round(t * 255));
				}
			}
			return mesh.finishPrototype();
		}) as unknown as UncardedPrototype['tiers'];
		const positions = tiers[0].positions;
		let reach = 0;
		let radius = 0;
		for (let i = 0; i < positions.length; i += 3) {
			const x = positions[i] as number;
			const y = positions[i + 1] as number;
			const z = positions[i + 2] as number;
			reach = Math.max(reach, length3(x, y, z));
			radius = Math.max(radius, length3(x, y - length / 2, z));
		}
		out.push({
			index,
			class: shootClass.name,
			vigor: shootClass.vigor,
			length: reach,
			radius,
			leaves: leaves[0]?.[0] ? nodes : 0,
			tiers,
		});
	}
	return out;
}

/** Texels a side of the stand-in card atlas, and of each cell in it. */
const ATLAS_SIZE = 64;
const CELL = 8;

/** The stand-in card atlas: each plane of each prototype a cell of a diamond in the leaf's colour. */
export function placeholderCardBake(
	record: Species,
	prototypes: readonly UncardedPrototype[],
): { readonly atlas: CardAtlas; readonly cells: readonly CardCell[] } {
	const color = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4 * 2);
	const surface = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4 * 2);
	const leaf = colourBytes(leafColour(record.foliage), 255);
	const perRow = ATLAS_SIZE / CELL;
	const cells: CardCell[] = prototypes.map((prototype) => {
		const half = prototype.length / 2;
		const r = Math.max(prototype.radius, 0.01);
		const frames: [Vector3, Vector3, Vector3][] = [
			[
				[0, half, 0],
				[r, 0, 0],
				[0, half, 0],
			],
			[
				[0, half, 0],
				[0, 0, r],
				[0, half, 0],
			],
			[
				[0, half * 1.2, 0],
				[r, 0, 0],
				[0, 0, r],
			],
		];
		return {
			planes: frames.map(([centre, right, up], k) => {
				const cell = (prototype.index * 3 + k) % (perRow * perRow);
				const rect = [
					(cell % perRow) * CELL,
					Math.floor(cell / perRow) * CELL,
					CELL,
					CELL,
				] as const;
				for (let layer = 0; layer < 2; layer++)
					for (let y = 0; y < CELL; y++)
						for (let x = 0; x < CELL; x++) {
							const inside = Math.abs(x - 3.5) + Math.abs(y - 3.5) <= 4;
							const at =
								(layer * ATLAS_SIZE * ATLAS_SIZE + (rect[1] + y) * ATLAS_SIZE + rect[0] + x) * 4;
							color[at] = leaf[0] as number;
							color[at + 1] = leaf[1] as number;
							color[at + 2] = leaf[2] as number;
							color[at + 3] = inside ? 255 : 0;
							surface[at] = 128;
							surface[at + 1] = 128;
							surface[at + 2] = 255;
							surface[at + 3] = 128;
						}
				return { centre, right, up, front: rect, back: rect };
			}),
		};
	});
	return { atlas: { size: ATLAS_SIZE, color, surface }, cells };
}

/** The stand-in records header: the leaf's optics and the species box, the rest zero. */
export function placeholderHeader(record: Species, box: SpeciesBox): Float32Array {
	const header = new Float32Array(HEADER_ROWS * RECORDS_WIDTH * 4);
	const colour = leafColour(record.foliage);
	header.set([colour[0] as number, colour[1] as number, colour[2] as number, 0.6], 0);
	header.set([...box.min, 0], 4);
	header.set([box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2], 0], 8);
	const sway = windSway(record);
	header.set([sway.amplitude, sway.frequency, 0, 0], HEADER.sway * 4);
	return header;
}

/** The stand-in skeleton: a leaning stem, a spiral of limbs through the crown, twigs on each limb. */
export function placeholderSkeleton(input: GrowInput): MacroSkeleton {
	const { record, seed, variant } = input;
	const salt = record.seedSalt;
	const height = spreadAt(record.size.height, unitAt(seed, salt, variant, Purpose.Height));
	const stemRadius = (record.size.dbh ?? height / 40) / 2;
	const envelope = record.envelope;
	const crownBase =
		envelope && envelope.kind === 'radial' ? (envelope.heights[0] ?? 0.35) * height : 0.35 * height;
	const lean = radians(3 * (unitAt(seed, salt, variant, Purpose.Lean) - 0.5));
	const turn = unitAt(seed, salt, variant, Purpose.Turn) * 2 * Math.PI;
	const builder = new SkeletonBuilder();
	const frame = [0, 0, 0, 1];
	const at = (y: number): Vector3 => [sin(lean) * cos(turn) * y, y, sin(lean) * sin(turn) * y];
	const stem = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
	const segments = 8;
	const stemNodes: number[] = [];
	for (let k = 0; k <= segments; k++) {
		const y = (k / segments) * height;
		const p = at(y);
		stemNodes.push(
			builder.addNode({
				x: p[0],
				y: p[1],
				z: p[2],
				radius: stemRadius * (1.15 - 0.95 * (k / segments)),
				parent: k === 0 ? -1 : (stemNodes[k - 1] as number),
				axis: stem,
				age: segments - k,
			}),
		);
	}
	const reach = Math.max(0.5 * record.size.aspect * height, 0.2);
	const orders =
		record.growth.model === 'self-organizing' ? Math.min(record.growth.macroOrders, 3) : 2;
	const addBranch = (
		parentAxis: number,
		parentNode: number,
		origin: Readonly<Vector3>,
		direction: Vector3,
		length: number,
		radius: number,
		order: number,
		barkV: number,
		barkU: number,
	): void => {
		normalize3(direction);
		const axis = builder.addAxis({
			parent: parentAxis,
			parentNode,
			parentT: 1,
			order,
			kind: AXIS_LIMB,
			barkV,
			barkU,
		});
		const steps = 3;
		let previous = parentNode;
		const nodes: number[] = [];
		for (let k = 1; k <= steps; k++) {
			const t = k / steps;
			const droop = order * 0.08 * t * t * length;
			const p: Vector3 = [
				origin[0] + direction[0] * length * t,
				origin[1] + direction[1] * length * t - droop,
				origin[2] + direction[2] * length * t,
			];
			previous = builder.addNode({
				x: p[0],
				y: p[1],
				z: p[2],
				radius: radius * (1 - 0.7 * t),
				parent: previous,
				axis,
				light: 0.5 + 0.5 * t,
				age: steps - k,
			});
			nodes.push(previous);
			quatFromFrame(direction, [0, 1, 0], frame);
			builder.addBud({
				node: previous,
				x: p[0],
				y: p[1],
				z: p[2],
				frame,
				kind: k === steps ? BUD_TERMINAL : BUD_LATERAL,
				vigor: Math.min(1, 0.3 + 0.7 * t),
				light: 0.5 + 0.5 * t,
				axis,
				woodRadius: radius * (1 - 0.7 * t),
			});
		}
		if (order + 1 > orders) return;
		for (let k = 0; k < 2; k++) {
			const node = nodes[k] as number;
			const p: Vector3 = [
				builder.position[node * 3] as number,
				builder.position[node * 3 + 1] as number,
				builder.position[node * 3 + 2] as number,
			];
			const side =
				(k === 0 ? 1 : -1) * (0.6 + 0.4 * unitAt(seed, salt, variant, Purpose.Twig, axis * 2 + k));
			const across = normalize3(cross3(direction, [0, 1, 0], [0, 0, 0]));
			const twig: Vector3 = [
				direction[0] + across[0] * side,
				direction[1] + 0.35,
				direction[2] + across[2] * side,
			];
			addBranch(
				axis,
				node,
				p,
				twig,
				length * 0.4,
				(builder.radius[node] as number) * 0.6,
				order + 1,
				0,
				k * Math.PI,
			);
		}
	};
	const limbs = 6;
	for (let k = 0; k < limbs; k++) {
		const t = (k + 0.5) / limbs;
		const y = crownBase + t * (height * 0.88 - crownBase);
		const stemIndex = Math.min(segments - 1, Math.floor((y / height) * segments));
		const node = stemNodes[stemIndex] as number;
		const azimuth = turn + k * GOLDEN + 0.4 * unitAt(seed, salt, variant, Purpose.Limb, k);
		const rise = radians(50 + 25 * t);
		const direction: Vector3 = [sin(rise) * cos(azimuth), cos(rise), sin(rise) * sin(azimuth)];
		const origin = at(y);
		const length = reach * (1.1 - 0.6 * t);
		addBranch(
			stem,
			node,
			origin,
			direction,
			length,
			(builder.radius[node] as number) * 0.45,
			1,
			y,
			azimuth,
		);
	}
	return builder.finish(crownBase);
}

/** No shoot rows. */
export function emptyRows(): ShootRows {
	return {
		count: 0,
		prototype: new Uint8Array(0),
		position: new Float32Array(0),
		rotation: new Float32Array(0),
		scale: new Float32Array(0),
		record: new Uint16Array(0),
		phase: new Uint8Array(0),
		sky: new Uint8Array(0),
		bent: new Uint8Array(0),
		order: new Uint32Array(0),
	};
}

/** The stand-in shoot rows: one on every bud site, a prototype by hash, turned by the bud frame. */
export function placeholderRows(input: DressInput): ShootRows {
	const { record, seed, variant, skeleton, kit } = input;
	const buds = skeleton.buds;
	const crowns = crownPrototypes(kit.prototypes);
	const count = crowns.length > 0 ? buds.count : 0;
	const rows = {
		count,
		prototype: new Uint8Array(count),
		position: new Float32Array(count * 3),
		rotation: new Float32Array(count * 4),
		scale: new Float32Array(count),
		record: new Uint16Array(count),
		phase: new Uint8Array(count),
		sky: new Uint8Array(count),
		bent: new Uint8Array(count),
		order: new Uint32Array(count),
	};
	const scale = record.shoots?.placement.scale ?? 1;
	for (let b = 0; b < count; b++) {
		const draw = hashAt(seed, record.seedSalt, variant, Purpose.Prototype, b) % crowns.length;
		rows.prototype[b] = (crowns[draw] as ShootPrototype).index;
		rows.position.set(buds.position.subarray(b * 3, b * 3 + 3), b * 3);
		rows.rotation.set(buds.frame.subarray(b * 4, b * 4 + 4), b * 4);
		rows.scale[b] = spreadAt(scale, unitAt(seed, record.seedSalt, variant, Purpose.Scale, b));
		rows.record[b] = skeleton.axes.record[buds.axis[b] as number] as number;
		rows.phase[b] = hashAt(seed, record.seedSalt, variant, Purpose.Phase, b) & 255;
		rows.sky[b] = 200;
		rows.bent[b] = 0x88;
		rows.order[b] = b;
	}
	return rows;
}

/** The stand-in crown light: one open cell over the skeleton's bounds. */
export function placeholderCrown(input: DressInput): CrownLight {
	const { min, max } = input.skeleton.bounds;
	const cell = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 0.01);
	return { cells: [1, 1, 1], min, cell, sky: new Float32Array([1]) };
}

/** The stand-in wind records: one per axis, from its base and its tip. */
export function placeholderWind(input: DressInput): WindTable {
	const { record, skeleton, variant, seed } = input;
	const axes = skeleton.axes;
	const records = new Float32Array(axes.count * WIND_RECORD_FLOATS);
	let deepest = 1;
	for (let a = 0; a < axes.count; a++) deepest = Math.max(deepest, axes.order[a] as number);
	const base = variant * VARIANT_RECORDS;
	const plantHeight = Math.max(1e-6, skeleton.height);
	for (let a = 0; a < axes.count; a++) {
		const first = axes.first[a] as number;
		const last = axes.last[a] as number;
		const p = skeleton.position;
		const dx = (p[last * 3] as number) - (p[first * 3] as number);
		const dy = (p[last * 3 + 1] as number) - (p[first * 3 + 1] as number);
		const dz = (p[last * 3 + 2] as number) - (p[first * 3 + 2] as number);
		const length = length3(dx, dy, dz);
		const order = axes.order[a] as number;
		const parent = axes.parent[a] as number;
		records.set(
			[
				p[first * 3] as number,
				p[first * 3 + 1] as number,
				p[first * 3 + 2] as number,
				parent < 0 ? -1 : base + (axes.record[parent] as number),
				length > 0 ? dx / length : 0,
				length > 0 ? dy / length : 1,
				length > 0 ? dz / length : 0,
				curveAt(record.wind.stiffness, order / deepest),
				flutterAmplitudeAt(
					record.wind.flutter,
					((p[first * 3 + 1] as number) + (p[last * 3 + 1] as number)) / 2 / plantHeight,
				),
				record.wind.flutter.frequency,
				order,
				length,
				unitAt(seed, record.seedSalt, variant, Purpose.Wind, a),
				0,
				0,
				0,
			],
			a * WIND_RECORD_FLOATS,
		);
	}
	return { base, count: axes.count, records };
}

/** The colour bytes of a wood or card vertex: the wind record's two bytes, a bend weight, occlusion. */
function windColour(record: number, bend: number, occlusion: number): number[] {
	return [(record >>> 8) & 255, record & 255, bend, occlusion];
}

/** The stand-in wood: tubes of 6, 4 and 3 sides, every order at the nearest level. */
export function placeholderWood(input: MeshInput, level: 0 | 1 | 2): MeshArrays {
	const { skeleton, record } = input;
	const axes = skeleton.axes;
	const keep = level === 0 ? 255 : (record.lod.woodOrders[level - 1] ?? 255);
	const sides = [6, 4, 3][level] as number;
	const base = input.variant * VARIANT_RECORDS;
	const mesh = new MeshWriter();
	const p = skeleton.position;
	for (let a = 0; a < axes.count; a++) {
		if ((axes.order[a] as number) > keep) continue;
		const first = axes.first[a] as number;
		const last = axes.last[a] as number;
		const parentNode = axes.parentNode[a] as number;
		const chain: number[] = parentNode >= 0 ? [parentNode] : [];
		for (let n = first; n <= last; n++) chain.push(n);
		if (chain.length < 2) continue;
		const color = windColour(
			base + (axes.record[a] as number),
			Math.min(255, (axes.order[a] as number) * 64),
			255,
		);
		let v = axes.barkV[a] as number;
		let previousRing = -1;
		for (let k = 0; k < chain.length; k++) {
			const node = chain[k] as number;
			const next = chain[Math.min(k + 1, chain.length - 1)] as number;
			const prev = chain[Math.max(k - 1, 0)] as number;
			const direction = normalize3([
				(p[next * 3] as number) - (p[prev * 3] as number),
				(p[next * 3 + 1] as number) - (p[prev * 3 + 1] as number),
				(p[next * 3 + 2] as number) - (p[prev * 3 + 2] as number),
			]);
			if (k > 0) {
				const before = chain[k - 1] as number;
				v += length3(
					(p[node * 3] as number) - (p[before * 3] as number),
					(p[node * 3 + 1] as number) - (p[before * 3 + 1] as number),
					(p[node * 3 + 2] as number) - (p[before * 3 + 2] as number),
				);
			}
			const radius =
				k === 0 && parentNode >= 0
					? (skeleton.radius[first] as number)
					: (skeleton.radius[node] as number);
			const centre: Vector3 = [
				p[node * 3] as number,
				p[node * 3 + 1] as number,
				p[node * 3 + 2] as number,
			];
			const tiles = Math.max(1, Math.round((2 * Math.PI * radius) / 0.5));
			const current = ring(mesh, centre, direction, radius, sides, v, tiles, color);
			if (previousRing >= 0) joinRings(mesh, previousRing, current, sides);
			previousRing = current;
		}
	}
	return mesh.finish();
}

/** The four corners of a card plane, as signs of its right and up half-extents. */
const CORNERS = [
	[-1, -1, 0, 1],
	[1, -1, 1, 1],
	[1, 1, 1, 0],
	[-1, 1, 0, 0],
] as const;

/** The stand-in cards: each row's three planes at the first card level, every second row's at the next. */
export function placeholderCardMesh(input: MeshInput, level: 1 | 2): MeshArrays {
	const { rows, kit } = input;
	const mesh = new MeshWriter();
	const base = input.variant * VARIANT_RECORDS;
	const size = kit.cards.size || 1;
	const step = level === 1 ? 1 : 2;
	const grow = level === 1 ? 1 : Math.SQRT2;
	const v: Vector3 = [0, 0, 0];
	for (let r = 0; r < rows.count; r += step) {
		const prototype = kit.prototypes[rows.prototype[r] as number];
		if (!prototype) continue;
		const scale = (rows.scale[r] as number) * grow;
		const color = windColour(
			base + (rows.record[r] as number),
			rows.phase[r] as number,
			rows.sky[r] as number,
		);
		const at: Vector3 = [
			rows.position[r * 3] as number,
			rows.position[r * 3 + 1] as number,
			rows.position[r * 3 + 2] as number,
		];
		for (const plane of prototype.card.planes) {
			const normal = normalize3(cross3(plane.right as Vector3, plane.up as Vector3, [0, 0, 0]));
			quatRotate(rows.rotation, r * 4, normal, normal);
			const first = mesh.vertices;
			for (const [sx, sy, cu, cv] of CORNERS) {
				quatRotate(
					rows.rotation,
					r * 4,
					[
						plane.centre[0] + sx * plane.right[0] + sy * plane.up[0],
						plane.centre[1] + sx * plane.right[1] + sy * plane.up[1],
						plane.centre[2] + sx * plane.right[2] + sy * plane.up[2],
					],
					v,
				);
				mesh.vertex(
					[at[0] + v[0] * scale, at[1] + v[1] * scale, at[2] + v[2] * scale],
					normal,
					(plane.front[0] + cu * plane.front[2]) / size,
					(plane.front[1] + cv * plane.front[3]) / size,
					color,
				);
			}
			mesh.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
		}
	}
	return mesh.finish();
}

/** The stand-in merged foliage: the species' leaf on every terminal bud, fewer at the card levels. */
export function placeholderFoliage(input: MeshInput, level: 0 | 1 | 2): MeshArrays {
	const { skeleton, kit } = input;
	const mesh = new MeshWriter();
	const leaf = kit.leaves[0];
	if (!leaf) return mesh.finish();
	const buds = skeleton.buds;
	const step = 1 << level;
	for (let b = 0; b < buds.count; b += step) {
		if ((buds.kind[b] as number) !== BUD_TERMINAL) continue;
		const q = buds.frame.subarray(b * 4, b * 4 + 4);
		const at: Vector3 = [
			buds.position[b * 3] as number,
			buds.position[b * 3 + 1] as number,
			buds.position[b * 3 + 2] as number,
		];
		placeLeaf(mesh, leaf, q, 1 + level * 0.4, at, (b * 37) & 255, 255);
	}
	return mesh.finish();
}

/** The stand-in quantisation: positions in the species box, normals in 8 bits, UVs in 16. */
export function placeholderQuantise(
	arrays: MeshArrays,
	box: SpeciesBox,
	uvSteps: number,
): QuantisedArrays {
	const count = arrays.positions.length / 3;
	const positions = new Uint16Array(count * 3);
	const normals = new Int8Array(count * 3);
	const uvs = new Uint16Array(count * 2);
	const uvs1 = new Uint16Array(count * 2);
	const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
	for (let i = 0; i < count; i++)
		for (let k = 0; k < 3; k++) {
			const low = box.min[k] as number;
			const span = (box.max[k] as number) - low;
			positions[i * 3 + k] = clamp(
				Math.round((((arrays.positions[i * 3 + k] as number) - low) / span) * 65535),
				0,
				65535,
			);
			normals[i * 3 + k] = clamp(
				Math.round((arrays.normals[i * 3 + k] as number) * 127),
				-127,
				127,
			);
		}
	for (let i = 0; i < count * 2; i++) {
		uvs[i] = clamp(Math.round((arrays.uvs[i] as number) * uvSteps), 0, 65535);
		uvs1[i] = clamp(Math.round((arrays.uvs1[i] as number) * TEXTURE_UV_STEPS), 0, 65535);
	}
	return {
		positions,
		normals,
		uvs,
		uvs1,
		colors: arrays.colors.slice(),
		indices: arrays.indices.slice(),
	};
}

/** Metres at which a size covers `pixels` pixels at the reference view. */
function distanceFor(size: number, pixels: number): number {
	return (size * REFERENCE_VIEW.height) / (2 * tan(radians(REFERENCE_VIEW.fov / 2)) * pixels);
}

/**
 * The stand-in level distances: a shoot's length, a card's width and the plant's height at the
 * record's pixels. A real kit's first card level starts where its page hands its shoots over to
 * cards, by the one rule both read; a stand-in kit keeps the shoot's length, so the scenes that
 * place stand-ins draw the same as real stages land.
 */
export function placeholderStarts(input: MeshInput): readonly [number, number, number] {
	const { record, kit, skeleton } = input;
	let shoot = 0.4;
	let card = 0.4;
	for (const prototype of kit.prototypes) {
		shoot = Math.max(shoot, prototype.length);
		card = Math.max(card, prototype.radius * 2);
	}
	const [first, second, far] = record.lod.switchPixels;
	return [
		kit.placeholders === true ? distanceFor(shoot, first) : firstCardStart(kit, REFERENCE_VIEW),
		distanceFor(card, second),
		distanceFor(skeleton.height, far),
	];
}

/** The stand-in far bake: every view a disc in the leaf's colour. */
export function placeholderFar(kit: SpeciesKitData, asset: PlantAsset): FarBake {
	const views = asset.impostor.views;
	const texels = Math.min(asset.impostor.texels, 8);
	const side = views * texels;
	const color = new Uint8Array(side * side * 4);
	const surface = new Uint8Array(side * side * 4);
	const leaf = srgbBytes(leafColour(kit.record.foliage), 255);
	const middle = (texels - 1) / 2;
	for (let y = 0; y < side; y++)
		for (let x = 0; x < side; x++) {
			const dx = (x % texels) - middle;
			const dy = (y % texels) - middle;
			const inside = dx * dx + dy * dy <= middle * middle;
			const at = (y * side + x) * 4;
			color.set(inside ? leaf : [0, 0, 0, 0], at);
			surface.set([128, 128, 255, inside ? 255 : 0], at);
		}
	const { min, max } = asset.skeleton.bounds;
	const width = Math.max(max[0] - min[0], max[2] - min[2]);
	return { views, texels, color, surface, size: [width, max[1] - min[1]], room: 1, depth: width };
}

/** An empty level. */
export function emptyLevel(level: 0 | 1 | 2): PlantLevel {
	return { level, parts: [], from: 0, triangles: 0, bytes: 0 };
}

/** A level made of parts, with its triangles and bytes counted. */
export function levelOf(level: 0 | 1 | 2, parts: readonly PlantPart[], from: number): PlantLevel {
	let triangles = 0;
	let bytes = 0;
	for (const part of parts) {
		const a = part.arrays;
		triangles += a.indices.length / 3;
		bytes +=
			a.positions.byteLength +
			a.normals.byteLength +
			a.uvs.byteLength +
			a.uvs1.byteLength +
			a.colors.byteLength +
			(a.tangents?.byteLength ?? 0) +
			a.indices.byteLength;
	}
	return { level, parts, from, triangles, bytes };
}
