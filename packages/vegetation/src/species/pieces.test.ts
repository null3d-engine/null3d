// The branch pieces of each species that has them: every variant is one joined body, no stem of it
// ends bare, it stays under the prototype vertex limit at every tier, and the same record builds the
// same bytes. A hanging piece runs along its own line and its leaves hang with it. A studio layout
// stands every piece on its cut wood.
import { beforeAll, describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { SpeciesModule } from '../core/record';
import type { SpeciesId } from '../core/registry';
import { loadSpecies } from '../core/registry';
import { DETAILS } from '../core/types';
import { buildPiecesNow, loadPlantCode } from '../generate';
import {
	layStudio,
	type PiecePrototype,
	type PieceRule,
	type PieceStudio,
	pieceKey,
	planPiece,
} from '../leaf/piece';
import type { ShootPlan } from '../leaf/shoot';
import { bakeCards } from '../lod/card-bake';
import { PIECES as ALDER, STUDIO as ALDER_STUDIO } from './common-alder/pieces';
import { PIECES as ASH, STUDIO as ASH_STUDIO } from './common-ash/pieces';
import { PIECES as BEECH, STUDIO as BEECH_STUDIO } from './european-beech/pieces';
import { PIECES as HAWTHORN, STUDIO as HAWTHORN_STUDIO } from './hawthorn-shrub/pieces';
import { PIECES as HOLM, STUDIO as HOLM_STUDIO } from './holm-oak/pieces';
import { PIECES as OLIVE, STUDIO as OLIVE_STUDIO } from './olive/pieces';
import { PIECES as OAK, STUDIO as OAK_STUDIO } from './pedunculate-oak/pieces';
import { PIECES as PINE, STUDIO as PINE_STUDIO } from './scots-pine/pieces';
import { PIECES as BIRCH, STUDIO as BIRCH_STUDIO } from './silver-birch/pieces';
import { PIECES as WILLOW, STUDIO as WILLOW_STUDIO } from './weeping-willow/pieces';

const LONG = scaledBudget(120_000);
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
	{ id: 'scots-pine', pieces: PINE, studio: PINE_STUDIO },
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

/** The stems of a plan whose tip carries neither a bud nor a leaf within `reach` metres. */
function bareTips(plan: ShootPlan, reach: number): number[] {
	const out: number[] = [];
	for (const [a, points] of plan.axes.entries()) {
		const tip = points[points.length - 1]?.at ?? [0, 0, 0];
		const bud = plan.buds.some((candidate) => distance(candidate.at, tip) < SAME);
		const leaf = plan.leaves.some(
			(candidate) => candidate.axis === a && distance(candidate.at, tip) < reach,
		);
		if (!bud && !leaf) out.push(a);
	}
	return out;
}

for (const { id, pieces, studio } of SPECIES)
	describe(`the pieces of ${id}`, () => {
		let module: SpeciesModule;
		let built: PiecePrototype[];
		beforeAll(async () => {
			module = await loadSpecies(id);
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

describe('a flat rosette', () => {
	it(
		"lays the oak's tuft leaves in the plane that faces the sky side, spread to both sides",
		async () => {
			const module = await loadSpecies('pedunculate-oak');
			await loadPlantCode(module.record);
			const rule = OAK[0] as PieceRule;
			const plan = planPiece(module.record, rule, pieceKey(0, 0), 4);
			expect(plan.leaves.length).toBeGreaterThan(40);
			for (const leaf of plan.leaves) expect(Math.abs(leaf.direction[2])).toBeLessThan(1e-6);
			// The main stem's own tuft fans to both sides of the stem's line.
			const own = plan.leaves.filter((leaf) => leaf.axis === 0);
			expect(own.some((leaf) => leaf.direction[0] > 0.5)).toBe(true);
			expect(own.some((leaf) => leaf.direction[0] < -0.5)).toBe(true);
		},
		LONG,
	);
});

describe('a piece through the card bake', () => {
	it(
		"gives the oak's branch end three planes whose front cell holds its leaf tufts",
		async () => {
			const module = await loadSpecies('pedunculate-oak');
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
