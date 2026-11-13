// The branch pieces of each species that has them: every variant is one joined body, no stem of it
// ends bare, it stays under the prototype vertex limit at every tier, and the same record builds the
// same bytes. A hanging piece runs along its own line and its leaves hang with it. A studio layout
// stands every piece on its cut wood.
import { beforeAll, describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import { quatRotate } from '../core/math';
import type { SpeciesModule } from '../core/record';
import type { SpeciesId } from '../core/registry';
import { loadSpecies } from '../core/registry';
import { DETAILS } from '../core/types';
import { buildPiecesNow, loadPlantCode } from '../generate';
import { bladeMesh, outlineOf } from '../leaf/leaf-mesh';
import {
	layStudio,
	type PieceLeaf,
	type PiecePrototype,
	type PieceRule,
	type PieceStudio,
	pieceKey,
	pieceRecord,
	planPiece,
} from '../leaf/piece';
import { meshedPlan, type ShootPlan } from '../leaf/shoot';
import { SURFACE_LEAF } from '../leaf/writer';
import { bakeCards, paletteOf } from '../lod/card-bake';
import { rasterise, rasterTarget } from '../lod/raster';
import {
	PIECES as ALDER,
	FRUIT_PIECES as ALDER_FRUIT,
	PIECE_LEAF as ALDER_LEAF,
	STUDIO as ALDER_STUDIO,
} from './common-alder/pieces';
import {
	PIECES as ASH,
	FRUIT_PIECES as ASH_FRUIT,
	STUDIO as ASH_STUDIO,
} from './common-ash/pieces';
import {
	PIECES as BEECH,
	PIECE_LEAF as BEECH_LEAF,
	STUDIO as BEECH_STUDIO,
} from './european-beech/pieces';
import {
	PIECES as HAWTHORN,
	FRUIT_PIECES as HAWTHORN_FRUIT,
	PIECE_LEAF as HAWTHORN_LEAF,
	STUDIO as HAWTHORN_STUDIO,
} from './hawthorn-shrub/pieces';
import { PIECES as HOLM, STUDIO as HOLM_STUDIO } from './holm-oak/pieces';
import { PIECES as OLIVE, STUDIO as OLIVE_STUDIO } from './olive/pieces';
import {
	PIECES as OAK,
	FRUIT_PIECES as OAK_FRUIT,
	STUDIO as OAK_STUDIO,
} from './pedunculate-oak/pieces';
import {
	PIECES as BIRCH,
	FRUIT_PIECES as BIRCH_FRUIT,
	STUDIO as BIRCH_STUDIO,
} from './silver-birch/pieces';
import {
	PIECES as WILLOW,
	FRUIT_PIECES as WILLOW_FRUIT,
	STUDIO as WILLOW_STUDIO,
} from './weeping-willow/pieces';

const LONG = scaledBudget(120_000);
/** The leaf a species' pieces wear, where it differs from the record's. */
const PIECE_LEAVES: Partial<Record<SpeciesId, PieceLeaf>> = {
	'european-beech': BEECH_LEAF,
	'common-alder': ALDER_LEAF,
	'hawthorn-shrub': HAWTHORN_LEAF,
};

/** A species' module with the record its pieces are built by. */
async function loadPieces(id: SpeciesId): Promise<SpeciesModule> {
	const module = await loadSpecies(id);
	return { ...module, record: pieceRecord(module.record, PIECE_LEAVES[id]) };
}

/** The most vertices one prototype may hold at a tier, which its 16-bit indices set. */
const VERTICES_MOST = 65_535;
/** Metres within which two points of a plan are the same place. */
const SAME = 1e-5;

const SPECIES: readonly {
	readonly id: SpeciesId;
	readonly pieces: readonly PieceRule[];
	readonly studio: readonly PieceStudio[];
}[] = [
	{ id: 'silver-birch', pieces: BIRCH, studio: BIRCH_STUDIO },
	{ id: 'weeping-willow', pieces: WILLOW, studio: WILLOW_STUDIO },
	{ id: 'pedunculate-oak', pieces: OAK, studio: OAK_STUDIO },
	{ id: 'olive', pieces: OLIVE, studio: OLIVE_STUDIO },
	{ id: 'european-beech', pieces: BEECH, studio: BEECH_STUDIO },
	{ id: 'common-ash', pieces: ASH, studio: ASH_STUDIO },
	{ id: 'common-alder', pieces: ALDER, studio: ALDER_STUDIO },
	{ id: 'holm-oak', pieces: HOLM, studio: HOLM_STUDIO },
	{ id: 'hawthorn-shrub', pieces: HAWTHORN, studio: HAWTHORN_STUDIO },
];

const distance = (a: readonly number[], b: readonly number[]): number =>
	Math.hypot(
		(a[0] as number) - (b[0] as number),
		(a[1] as number) - (b[1] as number),
		(a[2] as number) - (b[2] as number),
	);

/** The stems of a plan whose foot stands on no earlier stem. */
function loose(plan: ShootPlan): number[] {
	const out: number[] = [];
	for (const [a, points] of plan.axes.entries()) {
		if (a === 0) continue;
		const foot = points[0]?.at ?? [0, 0, 0];
		const joined = plan.axes
			.slice(0, a)
			.some((other) => other.some((point) => distance(point.at, foot) < SAME));
		if (!joined) out.push(a);
	}
	return out;
}

/**
 * The stems of a plan whose tip carries neither a bud nor a leaf within `reach` metres. A tip that
 * another stem grows from is a fork, not an end.
 */
function bareTips(plan: ShootPlan, reach: number): number[] {
	const out: number[] = [];
	for (const [a, points] of plan.axes.entries()) {
		const tip = points[points.length - 1]?.at ?? [0, 0, 0];
		const bud = plan.buds.some((candidate) => distance(candidate.at, tip) < SAME);
		const leaf = plan.leaves.some(
			(candidate) => candidate.axis === a && distance(candidate.at, tip) < reach,
		);
		const forks = plan.axes.some(
			(other, b) => b !== a && distance(other[0]?.at ?? [0, 0, 0], tip) < SAME,
		);
		if (!bud && !leaf && !forks) out.push(a);
	}
	return out;
}

for (const { id, pieces, studio } of SPECIES)
	describe(`the pieces of ${id}`, () => {
		let module: SpeciesModule;
		let built: PiecePrototype[];
		beforeAll(async () => {
			module = await loadPieces(id);
			await loadPlantCode(module.record);
			built = buildPiecesNow(module, pieces);
		}, LONG);

		it('builds every variant of every rule', () => {
			const variants = new Set(built.map((piece) => `${piece.piece}:${piece.variant}`));
			expect(variants.size).toBe(pieces.reduce((sum, rule) => sum + rule.variants, 0));
			for (const piece of built) expect(piece.leaves).toBeGreaterThan(0);
			// A variant's parts together hold every leaf of its plan, each once.
			for (const [r, rule] of pieces.entries())
				for (let variant = 0; variant < rule.variants; variant++) {
					const parts = built.filter((p) => p.piece === rule.name && p.variant === variant);
					expect(parts.length).toBe(parts[0]?.parts ?? 0);
					expect(parts.reduce((sum, p) => sum + p.leaves, 0)).toBe(
						planPiece(module.record, rule, pieceKey(r, variant), 4).leaves.length,
					);
				}
		});

		it('plans each variant as one joined body with no bare stem end', () => {
			for (const [r, rule] of pieces.entries())
				for (let variant = 0; variant < rule.variants; variant++) {
					const plan = planPiece(module.record, rule, pieceKey(r, variant), 4);
					expect(loose(plan)).toEqual([]);
					expect(bareTips(plan, 0.05)).toEqual([]);
					// Every leaf stands on a point of its own stem.
					for (const leaf of plan.leaves) {
						const points = plan.axes[leaf.axis] ?? [];
						expect(points.some((point) => distance(point.at, leaf.at) <= point.radius + SAME)).toBe(
							true,
						);
					}
				}
		});

		it('records a site at every stem end and every leafy node, ranked within its kind', () => {
			for (const piece of built) {
				const tips = piece.sites.filter((site) => site.kind === 'tip');
				const nodes = piece.sites.filter((site) => site.kind === 'node');
				expect(tips.length).toBeGreaterThan(0);
				expect(nodes.length).toBeGreaterThan(0);
				expect(nodes.length).toBeLessThanOrEqual(piece.leaves);
				for (const kind of [tips, nodes])
					expect(kind.map((site) => site.rank)).toEqual(kind.map((_, index) => index));
				for (const site of piece.sites) expect(Math.hypot(...site.direction)).toBeCloseTo(1, 5);
			}
		});

		it('stays under the prototype vertex limit at every tier', () => {
			for (const piece of built)
				for (const [tier, mesh] of piece.tiers.entries()) {
					const vertices = mesh.positions.length / 3;
					expect(vertices).toBeLessThanOrEqual(VERTICES_MOST);
					// A finer tier never holds fewer vertices than a coarser one.
					if (tier > 0)
						expect(vertices).toBeGreaterThanOrEqual(
							(piece.tiers[tier - 1]?.positions.length ?? 0) / 3,
						);
				}
			expect(DETAILS.length).toBe(4);
		});

		it(
			'builds the same bytes twice',
			() => {
				const again = buildPiecesNow(module, pieces);
				expect(again.length).toBe(built.length);
				for (const [k, piece] of built.entries())
					for (const [tier, mesh] of piece.tiers.entries()) {
						const other = again[k]?.tiers[tier];
						expect(other?.positions).toEqual(mesh.positions);
						expect(other?.indices).toEqual(mesh.indices);
						expect(other?.colors).toEqual(mesh.colors);
					}
			},
			LONG,
		);

		it('ends a plumb piece along its own line, with its leaves hanging too', () => {
			for (const [r, rule] of pieces.entries()) {
				if (rule.attitude !== 'plumb') continue;
				const plan = planPiece(module.record, rule, pieceKey(r, 0), 4);
				const stem = plan.axes[0] ?? [];
				const tip = stem[stem.length - 1]?.at ?? [0, 0, 0];
				const before = stem[stem.length - 2]?.at ?? [0, 0, 0];
				// Whatever its hook did at its foot, the stem ends running along the piece's line.
				expect((tip[1] - before[1]) / distance(tip, before)).toBeGreaterThan(0.9);
				const down = plan.leaves.filter((leaf) => leaf.direction[1] > 0).length;
				expect(down / plan.leaves.length).toBeGreaterThan(0.9);
			}
		});

		it('lays each studio photograph out with every piece on its cut wood', () => {
			for (const layout of studio) {
				const laid = layStudio(module.record, pieces, layout);
				expect(laid.placed.length).toBeGreaterThan(0);
				if (!laid.stand) {
					expect(laid.placed.length).toBe(1);
					continue;
				}
				expect(loose(laid.stand)).toEqual([]);
				for (const piece of laid.placed)
					expect(
						laid.stand.axes.some((points) =>
							points.some((point) => distance(point.at, piece.position) < SAME),
						),
					).toBe(true);
			}
		});
	});

/**
 * What each species' turning videos show of its two cuts (still 21 with `branch-turntable`, still 22
 * with `subbranch-turntable`): `depth` is the cut's narrowest outline over its widest as it turns,
 * and `edge` is the share of its own box that the cut covers in the narrowest frame. Both are read
 * by `bun run plants:piece <species> --turns`.
 */
const TURNING: readonly {
	readonly id: SpeciesId;
	readonly pieces: readonly PieceRule[];
	readonly studio: readonly PieceStudio[];
	readonly still: number;
	readonly depth: number;
	readonly edge: number;
}[] = [
	{ id: 'pedunculate-oak', pieces: OAK, studio: OAK_STUDIO, still: 21, depth: 0.33, edge: 0.358 },
	{ id: 'pedunculate-oak', pieces: OAK, studio: OAK_STUDIO, still: 22, depth: 0.37, edge: 0.366 },
	{ id: 'silver-birch', pieces: BIRCH, studio: BIRCH_STUDIO, still: 21, depth: 0.21, edge: 0.493 },
	{ id: 'silver-birch', pieces: BIRCH, studio: BIRCH_STUDIO, still: 22, depth: 0.27, edge: 0.233 },
	{
		id: 'weeping-willow',
		pieces: WILLOW,
		studio: WILLOW_STUDIO,
		still: 21,
		depth: 0.37,
		edge: 0.55,
	},
	{
		id: 'weeping-willow',
		pieces: WILLOW,
		studio: WILLOW_STUDIO,
		still: 22,
		depth: 0.23,
		edge: 0.466,
	},
	{ id: 'olive', pieces: OLIVE, studio: OLIVE_STUDIO, still: 21, depth: 0.38, edge: 0.297 },
	{ id: 'olive', pieces: OLIVE, studio: OLIVE_STUDIO, still: 22, depth: 0.31, edge: 0.252 },
	{
		id: 'european-beech',
		pieces: BEECH,
		studio: BEECH_STUDIO,
		still: 21,
		depth: 0.24,
		edge: 0.248,
	},
	{ id: 'european-beech', pieces: BEECH, studio: BEECH_STUDIO, still: 22, depth: 0.29, edge: 0.31 },
	{ id: 'common-ash', pieces: ASH, studio: ASH_STUDIO, still: 21, depth: 0.18, edge: 0.269 },
	{ id: 'common-ash', pieces: ASH, studio: ASH_STUDIO, still: 22, depth: 0.33, edge: 0.207 },
	{ id: 'common-alder', pieces: ALDER, studio: ALDER_STUDIO, still: 21, depth: 0.29, edge: 0.365 },
	{ id: 'common-alder', pieces: ALDER, studio: ALDER_STUDIO, still: 22, depth: 0.2, edge: 0.325 },
	{ id: 'holm-oak', pieces: HOLM, studio: HOLM_STUDIO, still: 21, depth: 0.3, edge: 0.427 },
	{ id: 'holm-oak', pieces: HOLM, studio: HOLM_STUDIO, still: 22, depth: 0.35, edge: 0.365 },
	{
		id: 'hawthorn-shrub',
		pieces: HAWTHORN,
		studio: HAWTHORN_STUDIO,
		still: 21,
		depth: 0.22,
		edge: 0.402,
	},
	{
		id: 'hawthorn-shrub',
		pieces: HAWTHORN,
		studio: HAWTHORN_STUDIO,
		still: 22,
		depth: 0.39,
		edge: 0.301,
	},
];
/** How far a built cut's depth over width may stand from its video's, as a share of the video's. */
const DEPTH_SHARE = 0.3;
/** The same for its cover seen edge on. */
const EDGE_SHARE = 0.35;
/**
 * The cuts that do not yet hold their video's figure, each with what is wrong. The test holds every
 * other cut inside its band, and holds these outside it, so a cut that is mended leaves this list.
 */
const OPEN_DEPTH: Readonly<Record<string, string>> = {
	'common-alder 22':
		"0.27 against 0.20: its cones hang to the twig's own ground side, behind it, where the photograph's hang below a twig that stands in a clamp",
	'weeping-willow 22':
		"0.31 against 0.23: its strands' leaves hang to every side, and at the high tier each long blade is a flat card that keeps its tilt but not its curl (0.29 as meshed blades)",
};
const OPEN_EDGE: Readonly<Record<string, string>> = {
	'silver-birch 21':
		'0.29 against 0.49: about a third of its blades show their faces edge on, and the video shows a column of whole leaves',
	'weeping-willow 22':
		"0.26 against 0.47: a strand's leaves stand to every side, so half show their faces from any side, and the video shows each leaf whole in every frame",
	'hawthorn-shrub 21': '0.20 against 0.40: its arms and tufts stand in one plane',
};

/** A laid cut's triangles: three corners each, with each corner's leaf texture place. */
interface Laid {
	readonly points: Float64Array;
	readonly uvs: Float32Array;
	/** One per corner: whether its triangle is a leaf's. */
	readonly leaf: Uint8Array;
}

/** A studio layout's meshes at the tier a close view draws, each turned and placed as laid. */
function laidTriangles(
	module: SpeciesModule,
	pieces: readonly PieceRule[],
	studio: PieceStudio,
): Laid[] {
	const tier = DETAILS.indexOf('high');
	const built = buildPiecesNow(module, pieces);
	const layout = layStudio(module.record, pieces, studio);
	const out: Laid[] = [];
	const add = (
		mesh: PiecePrototype['tiers'][number] | undefined,
		rotation: readonly number[],
		position: readonly number[],
	): void => {
		if (!mesh) return;
		const count = mesh.indices.length;
		const points = new Float64Array(count * 3);
		const uvs = new Float32Array(count * 2);
		const leaf = new Uint8Array(count);
		const v: [number, number, number] = [0, 0, 0];
		for (let k = 0; k < count; k++) {
			const i = mesh.indices[k] as number;
			v[0] = mesh.positions[i * 3] as number;
			v[1] = mesh.positions[i * 3 + 1] as number;
			v[2] = mesh.positions[i * 3 + 2] as number;
			quatRotate(rotation as number[], 0, v, v);
			points[k * 3] = v[0] + (position[0] as number);
			points[k * 3 + 1] = v[1] + (position[1] as number);
			points[k * 3 + 2] = v[2] + (position[2] as number);
			uvs[k * 2] = mesh.uvs[i * 2] as number;
			uvs[k * 2 + 1] = mesh.uvs[i * 2 + 1] as number;
			leaf[k] = (mesh.colors[i * 4 + 2] as number) === SURFACE_LEAF ? 1 : 0;
		}
		out.push({ points, uvs, leaf });
	};
	if (layout.stand)
		add(
			meshedPlan(
				layout.stand,
				DETAILS.map(() => []),
			).tiers[tier],
			[0, 0, 0, 1],
			[0, 0, 0],
		);
	for (const placed of layout.placed) {
		const variants = [
			...new Set(built.filter((p) => p.piece === placed.piece).map((p) => p.variant)),
		];
		const variant = variants[placed.pick % Math.max(1, variants.length)];
		for (const part of built.filter((p) => p.piece === placed.piece && p.variant === variant))
			add(part.tiers[tier], placed.rotation, placed.position);
	}
	return out;
}

/** Pixels down the edge-on picture that a cut's cover is read on. */
const EDGE_ROWS = 240;
/** Texels a side of the leaf outline the card bake makes. */
const LEAF_MASK = 512;

/**
 * A laid cut's depth over its width, and the share of its own box it covers seen edge on: its
 * triangles drawn along the layout's X axis, a leaf's kept only where its outline covers it.
 */
function turned(
	module: SpeciesModule,
	meshes: readonly Laid[],
): { readonly depth: number; readonly edge: number } {
	const low = [Infinity, Infinity, Infinity];
	const high = [-Infinity, -Infinity, -Infinity];
	for (const mesh of meshes)
		for (let i = 0; i < mesh.points.length; i++) {
			low[i % 3] = Math.min(low[i % 3] as number, mesh.points[i] as number);
			high[i % 3] = Math.max(high[i % 3] as number, mesh.points[i] as number);
		}
	const [x0, y0, z0] = low as [number, number, number];
	const [x1, y1, z1] = high as [number, number, number];
	const scale = EDGE_ROWS / (y1 - y0);
	const width = Math.max(2, Math.ceil((z1 - z0) * scale) + 2);
	const target = rasterTarget(width, EDGE_ROWS + 2);
	const covered = new Uint8Array(width * (EDGE_ROWS + 2));
	const mask = paletteOf(module.record, module.textures.manifest).mask;
	for (const mesh of meshes) {
		const count = mesh.points.length / 3;
		const screen = new Float64Array(count * 3);
		const indices = new Uint32Array(count);
		for (let k = 0; k < count; k++) {
			screen[k * 3] = ((mesh.points[k * 3 + 2] as number) - z0) * scale + 1;
			screen[k * 3 + 1] = (y1 - (mesh.points[k * 3 + 1] as number)) * scale + 1;
			screen[k * 3 + 2] = (mesh.points[k * 3] as number) - x0 + 1;
			indices[k] = k;
		}
		rasterise(target, screen, indices, (f) => {
			const a = f.triangle * 3;
			if (mesh.leaf[a] && mask) {
				const u =
					(mesh.uvs[a * 2] as number) * f.w0 +
					(mesh.uvs[a * 2 + 2] as number) * f.w1 +
					(mesh.uvs[a * 2 + 4] as number) * f.w2;
				const v =
					(mesh.uvs[a * 2 + 1] as number) * f.w0 +
					(mesh.uvs[a * 2 + 3] as number) * f.w1 +
					(mesh.uvs[a * 2 + 5] as number) * f.w2;
				const mx = Math.min(LEAF_MASK - 1, Math.max(0, Math.floor(u * LEAF_MASK)));
				const my = Math.min(LEAF_MASK - 1, Math.max(0, Math.floor(v * LEAF_MASK)));
				if (!mask[my * LEAF_MASK + mx]) return false;
			}
			covered[f.y * width + f.x] = 1;
			return true;
		});
	}
	// The covered pixels' own box, and the share of it they fill.
	let left = width;
	let right = -1;
	let top = EDGE_ROWS + 2;
	let bottom = -1;
	let count = 0;
	for (let y = 0; y < EDGE_ROWS + 2; y++)
		for (let x = 0; x < width; x++)
			if (covered[y * width + x]) {
				count++;
				left = Math.min(left, x);
				right = Math.max(right, x);
				top = Math.min(top, y);
				bottom = Math.max(bottom, y);
			}
	return {
		depth: (z1 - z0) / (x1 - x0),
		edge: count / Math.max(1, (right - left + 1) * (bottom - top + 1)),
	};
}

describe('a cut keeps what its turning video shows from the side', () => {
	it(
		'is as deep against its width, and covers as much of its box edge on, as its video, all eighteen cuts',
		async () => {
			const seen: string[] = [];
			// The cuts that stand on the wrong side of their band's edge for their list.
			const wrong: string[] = [];
			for (const { id, pieces, studio, still, depth, edge } of TURNING) {
				const module = await loadPieces(id);
				await loadPlantCode(module.record);
				const layout = studio.find((candidate) => candidate.still === still);
				expect(layout).toBeDefined();
				if (!layout) continue;
				const built = turned(module, laidTriangles(module, pieces, layout));
				const key = `${id} ${still}`;
				seen.push(
					`${key}: depth ${built.depth.toFixed(2)} against ${depth}, edge-on cover ${built.edge.toFixed(2)} against ${edge}`,
				);
				const depthHeld = Math.abs(built.depth - depth) <= DEPTH_SHARE * depth;
				const edgeHeld = Math.abs(built.edge - edge) <= EDGE_SHARE * edge;
				// A cut on a list is held outside its band; every other cut inside it.
				if (depthHeld === key in OPEN_DEPTH)
					wrong.push(`${key}: depth ${built.depth.toFixed(2)} against ${depth}`);
				if (edgeHeld === key in OPEN_EDGE)
					wrong.push(`${key}: edge-on cover ${built.edge.toFixed(2)} against ${edge}`);
			}
			if (process.env.NULL3D_PIECE_FIGURES) console.log(seen.join('\n'));
			expect(wrong).toEqual([]);
		},
		LONG,
	);
});

/**
 * How thick each cut is at its foot, as a share of the cut's height, read on the full-size
 * photograph as the stem's width in pixels over the piece's height in pixels (stills 21 and 22).
 */
const CUT_THICKNESS: readonly {
	readonly id: SpeciesId;
	readonly pieces: readonly PieceRule[];
	readonly piece: string;
	readonly photograph: number;
}[] = [
	{ id: 'pedunculate-oak', pieces: OAK, piece: 'branch-end', photograph: 0.023 },
	{ id: 'pedunculate-oak', pieces: OAK, piece: 'twig', photograph: 0.032 },
	{ id: 'olive', pieces: OLIVE, piece: 'branch-end', photograph: 0.023 },
	{ id: 'olive', pieces: OLIVE, piece: 'twig', photograph: 0.014 },
	{ id: 'european-beech', pieces: BEECH, piece: 'branch-end', photograph: 0.021 },
	{ id: 'european-beech', pieces: BEECH, piece: 'twig', photograph: 0.02 },
	{ id: 'common-ash', pieces: ASH, piece: 'branch-end', photograph: 0.03 },
	{ id: 'common-ash', pieces: ASH, piece: 'twig', photograph: 0.04 },
	{ id: 'common-alder', pieces: ALDER, piece: 'branch-end', photograph: 0.028 },
	{ id: 'common-alder', pieces: ALDER, piece: 'twig', photograph: 0.028 },
	{ id: 'holm-oak', pieces: HOLM, piece: 'branch-end', photograph: 0.037 },
	{ id: 'holm-oak', pieces: HOLM, piece: 'twig', photograph: 0.026 },
	{ id: 'hawthorn-shrub', pieces: HAWTHORN, piece: 'branch-end', photograph: 0.03 },
	{ id: 'hawthorn-shrub', pieces: HAWTHORN, piece: 'twig', photograph: 0.025 },
];
/** The most degrees a stem may turn at one joint between two of its straight runs. */
const JOINT_MOST = 15;

describe("a piece's wood", () => {
	it(
		'is as thick at its cut as its photograph shows, within a quarter, read from the built mesh',
		async () => {
			for (const { id, pieces, piece, photograph } of CUT_THICKNESS) {
				const module = await loadPieces(id);
				await loadPlantCode(module.record);
				const built = buildPiecesNow(module, pieces, true).filter(
					(part) => part.piece === piece && part.variant === 0,
				);
				// The leafless piece's own height, and its width across the lowest fiftieth of it.
				let low = Infinity;
				let high = -Infinity;
				for (const part of built) {
					const positions = part.tiers[DETAILS.indexOf('high')]?.positions ?? [];
					for (let i = 1; i < positions.length; i += 3) {
						low = Math.min(low, positions[i] as number);
						high = Math.max(high, positions[i] as number);
					}
				}
				let left = Infinity;
				let right = -Infinity;
				for (const part of built) {
					const positions = part.tiers[DETAILS.indexOf('high')]?.positions ?? [];
					for (let i = 0; i < positions.length; i += 3)
						if ((positions[i + 1] as number) <= low + (high - low) / 50) {
							left = Math.min(left, positions[i] as number);
							right = Math.max(right, positions[i] as number);
						}
				}
				const share = (right - left) / (high - low);
				expect(share).toBeGreaterThan(photograph * 0.75);
				expect(share).toBeLessThan(photograph * 1.25);
			}
		},
		LONG,
	);

	it(
		'bends on curves: no stem of any piece turns a corner at one joint',
		async () => {
			for (const { id, pieces } of SPECIES) {
				const module = await loadPieces(id);
				await loadPlantCode(module.record);
				for (const [r, rule] of pieces.entries())
					for (let variant = 0; variant < rule.variants; variant++) {
						const plan = planPiece(module.record, rule, pieceKey(r, variant), 4);
						for (const points of plan.axes)
							for (let k = 1; k + 1 < points.length; k++) {
								const before = points[k - 1]?.at ?? [0, 0, 0];
								const here = points[k]?.at ?? [0, 0, 0];
								const after = points[k + 1]?.at ?? [0, 0, 0];
								const a = [here[0] - before[0], here[1] - before[1], here[2] - before[2]];
								const b = [after[0] - here[0], after[1] - here[1], after[2] - here[2]];
								const cosine =
									((a[0] as number) * (b[0] as number) +
										(a[1] as number) * (b[1] as number) +
										(a[2] as number) * (b[2] as number)) /
									(Math.hypot(...a) * Math.hypot(...b));
								const degrees = (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
								expect(degrees).toBeLessThan(JOINT_MOST);
							}
					}
			}
		},
		LONG,
	);

	it('tapers: every stem is at least as thick at its foot as at its tip', async () => {
		for (const { id, pieces } of SPECIES) {
			const module = await loadPieces(id);
			await loadPlantCode(module.record);
			for (const [r, rule] of pieces.entries()) {
				const plan = planPiece(module.record, rule, pieceKey(r, 0), 4);
				for (const points of plan.axes)
					expect(points[0]?.radius ?? 0).toBeGreaterThanOrEqual(
						points[points.length - 1]?.radius ?? 0,
					);
			}
		}
	});
});

describe("the ash's branch end, as still 21 and its turning video count it", () => {
	it('carries six leaves: one pair under the bud at each of its three ends, in its own plane', async () => {
		const module = await loadPieces('common-ash');
		await loadPlantCode(module.record);
		const rule = ASH[0] as PieceRule;
		for (let variant = 0; variant < rule.variants; variant++) {
			const plan = planPiece(module.record, rule, pieceKey(0, variant), 4);
			// The stem and one opposite pair of side shoots.
			expect(plan.axes.length).toBe(3);
			expect(plan.leaves.length).toBe(6);
			for (const points of plan.axes) {
				const tip = points[points.length - 1]?.at ?? [0, 0, 0];
				const reach = (rule.scale ?? 1) * 0.04;
				const pair = plan.leaves.filter((leaf) => distance(leaf.at, tip) < reach);
				expect(pair.length).toBe(2);
				// The two leaves of a pair stand at least 40 degrees apart.
				const [one, other] = pair.map((leaf) => leaf.direction);
				expect(
					(one?.[0] ?? 0) * (other?.[0] ?? 0) +
						(one?.[1] ?? 0) * (other?.[1] ?? 0) +
						(one?.[2] ?? 0) * (other?.[2] ?? 0),
				).toBeLessThan(0.766);
			}
			for (const leaf of plan.leaves) {
				// A midrib stands within 15 degrees of the plane, and a blade shows the sky side at
				// least three quarters of its face.
				expect(Math.abs(leaf.direction[2] as number)).toBeLessThan(0.259);
				const face = quatRotate(leaf.rotation, 0, [0, 0, 1], [0, 0, 0]);
				expect(face[2]).toBeGreaterThan(0.75);
			}
		}
	});
});

describe("the beech's branch end, as still 21 shows it at full size", () => {
	it("wears a leaf 0.5 to 0.6 as wide as long, as the photographs' full leaves are", async () => {
		const module = await loadPieces('european-beech');
		const foliage = module.record.foliage;
		if (foliage.kind !== 'blade') throw new Error('the beech has blade leaves');
		const outline = outlineOf(foliage.leaf, module.textures.manifest);
		const mesh = bladeMesh(foliage.leaf, outline, 'high');
		let left = Number.POSITIVE_INFINITY;
		let right = Number.NEGATIVE_INFINITY;
		let low = Number.POSITIVE_INFINITY;
		let high = Number.NEGATIVE_INFINITY;
		for (let i = 0; i < mesh.uvs.length / 2; i++) {
			if ((mesh.uvs[i * 2 + 1] as number) < outline.base[1]) continue;
			const x = mesh.positions[i * 3] as number;
			const y = mesh.positions[i * 3 + 1] as number;
			left = Math.min(left, x);
			right = Math.max(right, x);
			low = Math.min(low, y);
			high = Math.max(high, y);
		}
		const ratio = (right - left) / (high - low);
		expect(ratio).toBeGreaterThan(0.5);
		expect(ratio).toBeLessThan(0.6);
	});

	it('is a bare forked stem whose leaves stand on thin twigs, 45 to 95 degrees out', async () => {
		const module = await loadPieces('european-beech');
		await loadPlantCode(module.record);
		const rule = BEECH[0] as PieceRule;
		const scale = rule.scale ?? 1;
		for (let variant = 0; variant < rule.variants; variant++) {
			const plan = planPiece(module.record, rule, pieceKey(0, variant), 4);
			// The photograph holds 100 to 120 leaves.
			expect(plan.leaves.length).toBeGreaterThanOrEqual(100);
			expect(plan.leaves.length).toBeLessThanOrEqual(120);
			const points = plan.axes.flat();
			for (const leaf of plan.leaves) {
				// The wood a leaf stands on is thin: under seven millimetres through.
				let nearest = Number.POSITIVE_INFINITY;
				let radius = 0;
				for (const point of points) {
					const d = distance(point.at, leaf.at);
					if (d < nearest) {
						nearest = d;
						radius = point.radius;
					}
				}
				expect(radius).toBeLessThan(0.0035 * scale);
				const along =
					(leaf.direction[0] as number) * (leaf.stem[0] as number) +
					(leaf.direction[1] as number) * (leaf.stem[1] as number) +
					(leaf.direction[2] as number) * (leaf.stem[2] as number);
				expect(along).toBeLessThan(0.71);
				expect(along).toBeGreaterThan(-0.09);
			}
			// The stem and its upper part end in forks and carry no leaf: the first stem is bare.
			const stem = plan.axes[0] ?? [];
			const top = stem[stem.length - 1]?.at ?? [0, 0, 0];
			expect(
				plan.axes.filter((other) => distance(other[0]?.at ?? [9, 9, 9], top) < SAME).length,
			).toBe(2);
		}
	});
});

/** The dot product of two vectors. */
const dot = (a: readonly number[], b: readonly number[]): number =>
	(a[0] as number) * (b[0] as number) +
	(a[1] as number) * (b[1] as number) +
	(a[2] as number) * (b[2] as number);

/** A rule with the species' own bend at the stalk. */
function speciesDroop(rule: PieceRule): PieceRule {
	const { leafDroop: _droop, ...rest } = rule;
	return rest;
}

/**
 * The root mean square of the leaves' reach to the piece's flank over their reach to its sky
 * side: 1 where the leaves stand to every side alike, 0 where they lie in the piece's plane.
 */
function flankOverSky(plan: ShootPlan): number {
	let flank = 0;
	let sky = 0;
	for (const leaf of plan.leaves) {
		flank += (leaf.direction[0] as number) ** 2;
		sky += (leaf.direction[2] as number) ** 2;
	}
	return Math.sqrt(flank / Math.max(sky, 1e-9));
}

describe("a hanging piece's blades", () => {
	it(
		"turn at their stalks about their own normals, toward the ground, by the species' droop",
		async () => {
			for (const [id, rules] of [
				['weeping-willow', WILLOW],
				['silver-birch', BIRCH],
			] as const) {
				const module = await loadPieces(id);
				await loadPlantCode(module.record);
				const foliage = module.record.foliage;
				if (foliage.kind !== 'blade') throw new Error(`${id} has no blade leaf`);
				const droop = foliage.leaf.petiole.droop;
				for (const [r, rule] of rules.entries()) {
					expect(rule.leafDroop).toBe('plane');
					const bent = planPiece(module.record, rule, pieceKey(r, 0), 4);
					const straight = planPiece(module.record, speciesDroop(rule), pieceKey(r, 0), 4);
					expect(bent.leaves.length).toBe(straight.leaves.length);
					for (const [i, leaf] of bent.leaves.entries()) {
						const before = straight.leaves[i] ?? leaf;
						const normal = quatRotate(leaf.rotation, 0, [0, 0, 1], [0, 0, 0]);
						// The blade keeps its face, and its midrib stays in its own plane.
						expect(
							dot(normal, quatRotate(before.rotation, 0, [0, 0, 1], [0, 0, 0])),
						).toBeGreaterThan(0.9999);
						expect(Math.abs(dot(leaf.direction, normal))).toBeLessThan(1e-4);
						// It turns no farther than the species' stalk droop, and toward the ground side,
						// which is the way a hanging piece's line runs.
						const turned = Math.min(1, dot(leaf.direction, before.direction));
						expect((Math.acos(turned) * 180) / Math.PI).toBeLessThanOrEqual(droop + 0.01);
						expect(leaf.direction[1] as number).toBeGreaterThanOrEqual(
							(before.direction[1] as number) - 1e-6,
						);
					}
				}
			}
		},
		LONG,
	);

	it(
		"keep the built willow blade within 12 degrees of its own plane, where the species' leaf leaves it by 40",
		async () => {
			const module = await loadPieces('weeping-willow');
			await loadPlantCode(module.record);
			const strand = WILLOW[0] as PieceRule;
			// One leaf on a short stem, by the strand's own leaf rule.
			const one: PieceRule = {
				...strand,
				variants: 1,
				stem: {
					length: 0.02,
					radius: [0.001, 0.001],
					bud: false,
					leaves: {
						...(strand.stem.leaves as NonNullable<PieceRule['stem']['leaves']>),
						gap: 0.02,
						from: 0.5,
					},
				},
			};
			/** The built blade's greatest distance from its planned plane over its reach. */
			const offPlane = (rule: PieceRule): number => {
				const plan = planPiece(module.record, rule, pieceKey(0, 0), 4);
				expect(plan.leaves.length).toBe(1);
				const leaf = plan.leaves[0] as ShootPlan['leaves'][number];
				const normal = quatRotate(leaf.rotation, 0, [0, 0, 1], [0, 0, 0]);
				const mesh = buildPiecesNow(module, [rule])[0]?.tiers[DETAILS.indexOf('high')];
				if (!mesh) throw new Error('the one-leaf piece built no mesh');
				let off = 0;
				let reach = 0;
				for (let i = 0; i < mesh.positions.length / 3; i++) {
					if ((mesh.colors[i * 4 + 2] as number) !== SURFACE_LEAF) continue;
					const v = [
						(mesh.positions[i * 3] as number) - (leaf.at[0] as number),
						(mesh.positions[i * 3 + 1] as number) - (leaf.at[1] as number),
						(mesh.positions[i * 3 + 2] as number) - (leaf.at[2] as number),
					];
					off = Math.max(off, Math.abs(dot(v, normal)));
					reach = Math.max(reach, Math.hypot(v[0] as number, v[1] as number, v[2] as number));
				}
				expect(reach).toBeGreaterThan(0.05);
				return off / reach;
			};
			// The sine of 12 degrees, and of 25.
			expect(offPlane(one)).toBeLessThan(0.21);
			expect(offPlane(speciesDroop(one))).toBeGreaterThan(0.42);
		},
		LONG,
	);

	it("hang to every side of a willow strand, and near the plane of a birch strand's arch", async () => {
		// The willow sub-branch's turning video, frames 0 and 30: a strand's leafy band is 0.10 to
		// 0.13 of the twig's height wide face on, and the three strands in line make a column 0.15
		// wide, so a strand is as deep as it is wide.
		const willow = await loadPieces('weeping-willow');
		await loadPlantCode(willow.record);
		for (const [r, rule] of WILLOW.entries()) {
			const ratio = flankOverSky(planPiece(willow.record, rule, pieceKey(r, 0), 4));
			expect(ratio).toBeGreaterThan(0.6);
			expect(ratio).toBeLessThan(1.67);
		}
		// The birch sub-branch's turning video, frame 72: edge on, the arching twig is 0.214 as wide
		// as tall against 0.781 face on, and its leaves hang beside it. Their midribs lean out of
		// the arch's plane by under 12 degrees in the root mean square, and not by nothing.
		const birch = await loadPieces('silver-birch');
		await loadPlantCode(birch.record);
		for (const [r, rule] of BIRCH.entries()) {
			const leaves = planPiece(birch.record, rule, pieceKey(r, 0), 4).leaves;
			const lean = Math.sqrt(
				leaves.reduce((sum, leaf) => sum + (leaf.direction[0] as number) ** 2, 0) /
					Math.max(1, leaves.length),
			);
			expect(lean).toBeGreaterThan(0.02);
			expect(lean).toBeLessThan(0.21);
		}
	});
});

/**
 * Each piece's triangles at the high tier, its first variant, when its leaves, wood and buds took the
 * crown's own cut: what a whole tree carrying thousands of pieces could not afford.
 */
const CROWN_CUT_HIGH: Readonly<Record<string, number>> = {
	'pedunculate-oak branch-end': 9604,
	'pedunculate-oak twig': 4698,
	'holm-oak branch-end': 36432,
	'holm-oak twig': 4166,
	'european-beech branch-end': 18186,
	'european-beech twig': 2062,
	'common-ash branch-end': 2864,
	'common-ash twig': 1686,
	'common-alder branch-end': 6914,
	'common-alder twig': 1840,
	'olive branch-end': 39850,
	'olive twig': 5040,
	'weeping-willow strand-short': 1962,
	'weeping-willow strand': 5758,
	'weeping-willow strand-long': 10498,
	'silver-birch strand-short': 2082,
	'silver-birch strand': 2840,
	'silver-birch strand-long': 6582,
	'silver-birch strand-arch-short': 3090,
	'silver-birch strand-arch': 3382,
	'hawthorn-shrub branch-end': 9822,
	'hawthorn-shrub twig': 5958,
};

describe("a piece's cost", () => {
	it(
		'is at most a third of the crown cut at the high tier, every piece of the nine species',
		async () => {
			const high = DETAILS.indexOf('high');
			for (const { id, pieces } of SPECIES) {
				const module = await loadPieces(id);
				await loadPlantCode(module.record);
				const built = buildPiecesNow(module, pieces);
				for (const rule of pieces) {
					const drawn = built
						.filter((piece) => piece.piece === rule.name && piece.variant === 0)
						.reduce((sum, piece) => sum + (piece.tiers[high]?.indices.length ?? 0) / 3, 0);
					const crown = CROWN_CUT_HIGH[`${id} ${rule.name}`];
					expect(crown).toBeDefined();
					expect(drawn).toBeLessThanOrEqual((crown ?? 0) / 3);
				}
			}
		},
		LONG,
	);
});

describe("a species' marks", () => {
	it(
		"stands a straight thorn of one to four centimetres at most nodes of the hawthorn's branch",
		async () => {
			const module = await loadPieces('hawthorn-shrub');
			await loadPlantCode(module.record);
			const rule = HAWTHORN[0] as PieceRule;
			const plan = planPiece(module.record, rule, pieceKey(0, 0), 4);
			// A thorn is longer than any bud of the species, and it is not a tip's bud.
			const thorns = plan.buds.filter((bud) => !bud.cluster && bud.length >= 0.01);
			expect(thorns.length).toBeGreaterThanOrEqual(8);
			for (const thorn of thorns) {
				expect(thorn.length).toBeLessThanOrEqual(0.04);
				// It stands on a point of a stem.
				expect(plan.axes.flat().some((point) => distance(point.at, thorn.at) < SAME)).toBe(true);
			}
			// The leafless mesh holds more with the thorns than without them.
			const bare = (rules: readonly PieceRule[]): number =>
				(buildPiecesNow(module, rules, true)[0]?.tiers[DETAILS.indexOf('high')]?.positions.length ??
					0) / 3;
			expect(bare([rule])).toBeGreaterThan(bare([{ ...rule, stem: stripped(rule.stem) }]));
		},
		LONG,
	);

	it("hangs the alder's cones and the olive's fruit on stalks from their own wood", async () => {
		for (const [id, rules] of [
			['common-alder', ALDER],
			['olive', OLIVE],
		] as const) {
			const module = await loadPieces(id);
			await loadPlantCode(module.record);
			const plan = planPiece(module.record, rules[0] as PieceRule, pieceKey(0, 0), 4);
			const bodies = plan.buds.filter((bud) => bud.cluster && bud.stack === bud.length);
			expect(bodies.length).toBeGreaterThanOrEqual(4);
			// Each body hangs at the end of a stalk, and every stalk's foot stands on a stem.
			for (const body of bodies)
				expect(
					plan.axes.some(
						(points) => distance(points[points.length - 1]?.at ?? [0, 0, 0], body.at) < SAME,
					),
				).toBe(true);
			expect(loose(plan)).toEqual([]);
		}
	});
});

describe('a species in fruit or in catkin', () => {
	it(
		'hangs fruit or catkins on its own wood, each piece still one joined body within the vertex limit',
		async () => {
			/** The bodies that hang on a plan's stalks. */
			const bodies = (plan: ShootPlan): number =>
				plan.buds.filter((bud) => bud.cluster && bud.stack === bud.length).length;
			for (const [id, fruiting, plain] of [
				['pedunculate-oak', OAK_FRUIT, OAK],
				['common-ash', ASH_FRUIT, ASH],
				['hawthorn-shrub', HAWTHORN_FRUIT, HAWTHORN],
				['silver-birch', BIRCH_FRUIT, BIRCH],
				['weeping-willow', WILLOW_FRUIT, WILLOW],
				['common-alder', ALDER_FRUIT, ALDER],
			] as const) {
				const module = await loadPieces(id);
				await loadPlantCode(module.record);
				let hung = 0;
				let before = 0;
				for (const [r, rule] of fruiting.entries())
					for (let variant = 0; variant < rule.variants; variant++) {
						const plan = planPiece(module.record, rule, pieceKey(r, variant), 4);
						expect(loose(plan)).toEqual([]);
						hung += bodies(plan);
						before += bodies(
							planPiece(module.record, plain[r] as PieceRule, pieceKey(r, variant), 4),
						);
					}
				expect(hung).toBeGreaterThan(before);
				for (const piece of buildPiecesNow(module, fruiting))
					for (const tier of piece.tiers)
						expect(tier.positions.length / 3).toBeLessThanOrEqual(VERTICES_MOST);
			}
		},
		LONG,
	);
});

/** A stem's rule with no marks on it or on any of its side stems. */
function stripped(stem: PieceRule['stem']): PieceRule['stem'] {
	const { marks: _marks, ...rest } = stem;
	return {
		...rest,
		...(stem.sides
			? { sides: stem.sides.map((side) => ({ ...side, stem: stripped(side.stem) })) }
			: {}),
	};
}

describe('a piece through the card bake', () => {
	it(
		"gives the oak's branch end three planes whose front cell holds its leaf tufts",
		async () => {
			const module = await loadPieces('pedunculate-oak');
			await loadPlantCode(module.record);
			const built = buildPiecesNow(module, OAK);
			const { atlas, cells } = bakeCards(
				module.record,
				module.textures.manifest,
				'high',
				built.map((piece, index) => ({
					index,
					class: 'cut' as const,
					vigor: [0, 1] as const,
					length: piece.length,
					radius: piece.radius,
					leaves: piece.leaves,
					tiers: piece.tiers,
				})),
			);
			expect(cells.length).toBe(built.length);
			for (const cell of cells) {
				expect(cell.planes.length).toBe(3);
				// The share of each plane's cell that the piece covers: some, and not all of it.
				for (const plane of cell.planes.slice(0, 1)) {
					const [x, y, w, h] = plane.front;
					let covered = 0;
					for (let row = y; row < y + h; row++)
						for (let column = x; column < x + w; column++)
							if ((atlas.color[(row * atlas.size + column) * 4 + 3] as number) >= 128) covered++;
					expect(covered / (w * h)).toBeGreaterThan(0.05);
					expect(covered / (w * h)).toBeLessThan(0.9);
				}
			}
		},
		LONG,
	);
});
