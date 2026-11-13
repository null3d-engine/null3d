// Test helpers for a plant's outline: a matte of one level drawn on the CPU from two sides, and
// the overlap of two mattes. A wood, foliage or extras triangle covers its pixels; a leaf card
// covers the pixels its atlas cell covers. Shoot rows drawn as real shoots are drawn here as their
// cards, which hold the same outline, so a matte costs thousands of triangles and not millions.
// Only the tests import this file.
import type { PlantAsset, PlantPart, SpeciesKitData } from '../asset';
import type { MeshInput } from '../stages';
import { cardMesh } from './cards';
import { dequantisePosition } from './quantise';
import { rasterise, rasterTarget } from './raster';

/** A matte of a plant from two sides: the front view's pixels, then the side view's. */
export interface OutlineMatte {
	/** Pixels along each side of each view. */
	readonly size: number;
	/** One byte per pixel, 1 where the plant covers it. */
	readonly covered: Uint8Array;
}

/** Texels of the card atlas with at least this coverage count as covered. */
const CUTOFF = 128;

/** The margin round the skeleton's bounds, as a share of their longest side. */
const FRAME_MARGIN = 0.2;

/**
 * The matte of one level of a grown variant, from the front and from the side, in a frame that
 * holds the plant's skeleton and a margin for its foliage.
 *
 * @param kit The species' kit.
 * @param asset The grown variant.
 * @param level The level.
 * @param size Pixels along each side of each view.
 * @returns The matte.
 */
export function outlineMatte(
	kit: SpeciesKitData,
	asset: PlantAsset,
	level: 0 | 1 | 2,
	size = 128,
): OutlineMatte {
	const covered = new Uint8Array(size * size * 2);
	// The frame: the skeleton's bounds with a margin for the foliage. Every sparseness and maximum
	// of one plant shares the skeleton's frame, so their mattes compare pixel for pixel.
	const bounds = asset.skeleton.bounds;
	const reach = Math.max(
		bounds.max[0] - bounds.min[0],
		bounds.max[1] - bounds.min[1],
		bounds.max[2] - bounds.min[2],
	);
	const span = reach * (1 + 2 * FRAME_MARGIN);
	const min = [0, 1, 2].map(
		(k) => ((bounds.min[k] as number) + (bounds.max[k] as number)) / 2 - span / 2,
	);
	min[1] = bounds.min[1] - reach * FRAME_MARGIN;
	const scale = size / span;
	const atlas = kit.cards.size;
	const alpha = kit.cards.color;
	const targets = [rasterTarget(size, size), rasterTarget(size, size)];
	/** Draws triangles into both views; `uvs` names the atlas texel of each corner of a card. */
	const draw = (
		positions: ArrayLike<number>,
		indices: ArrayLike<number>,
		uvs?: ArrayLike<number>,
	): void => {
		const count = positions.length / 3;
		for (let view = 0; view < 2; view++) {
			const across = view === 0 ? 0 : 2;
			const points = new Float32Array(count * 3);
			for (let i = 0; i < count; i++) {
				points[i * 3] = ((positions[i * 3 + across] as number) - (min[across] as number)) * scale;
				points[i * 3 + 1] = ((positions[i * 3 + 1] as number) - (min[1] as number)) * scale;
			}
			const offset = view * size * size;
			rasterise(targets[view] as ReturnType<typeof rasterTarget>, points, indices, (fragment) => {
				if (uvs && atlas > 0) {
					const a = (indices[fragment.triangle * 3] as number) * 2;
					const b = (indices[fragment.triangle * 3 + 1] as number) * 2;
					const c = (indices[fragment.triangle * 3 + 2] as number) * 2;
					const u =
						fragment.w0 * (uvs[a] as number) +
						fragment.w1 * (uvs[b] as number) +
						fragment.w2 * (uvs[c] as number);
					const v =
						fragment.w0 * (uvs[a + 1] as number) +
						fragment.w1 * (uvs[b + 1] as number) +
						fragment.w2 * (uvs[c + 1] as number);
					const x = Math.min(atlas - 1, Math.max(0, Math.floor(u * atlas)));
					const y = Math.min(atlas - 1, Math.max(0, Math.floor(v * atlas)));
					if ((alpha[(y * atlas + x) * 4 + 3] as number) < CUTOFF) return false;
				}
				covered[offset + fragment.y * size + fragment.x] = 1;
				return false;
			});
		}
	};
	const out: [number, number, number] = [0, 0, 0];
	const drawPart = (part: PlantPart): void => {
		const arrays = part.arrays;
		const count = arrays.positions.length / 3;
		const positions = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			dequantisePosition(arrays.positions, i, kit.box, out);
			positions.set(out, i * 3);
		}
		if (part.name !== 'cards') {
			draw(positions, arrays.indices);
			return;
		}
		const uvs = new Float32Array(count * 2);
		for (let i = 0; i < count * 2; i++) uvs[i] = (arrays.uvs[i] as number) / 65535;
		draw(positions, arrays.indices, uvs);
	};
	for (const part of asset.levels[level].parts) drawPart(part);
	// The nearest level's shoot rows, where it draws them: as their cards.
	if (level === 0 && asset.shoots.count > 0 && asset.shootDetail !== 'none') {
		const input = {
			record: kit.record,
			seed: asset.seed,
			variant: asset.variant,
			season: asset.season,
			kit,
			skeleton: asset.skeleton,
			coarseness: asset.coarseness,
			rows: asset.shoots,
			crown: {
				cells: [1, 1, 1] as const,
				min: [0, 0, 0] as const,
				cell: 1,
				sky: new Float32Array([1]),
			},
			detail: kit.detail,
			// Every row draws its card: the rows are the foliage, whatever a card level would join.
			cardJoin: 'twig',
		} satisfies MeshInput;
		const cards = cardMesh(input, 1);
		// A twig join's lines are no part of the shoots: only the three planes of each row count.
		draw(cards.positions, cards.indices, cards.uvs);
	}
	return { size, covered };
}

/**
 * The overlap of two mattes: the pixels both cover over the pixels either covers, from 0 to 1.
 *
 * @param a One matte.
 * @param b The other, of the same size.
 * @returns The overlap; 1 where neither covers a pixel.
 */
export function outlineOverlap(a: OutlineMatte, b: OutlineMatte): number {
	let both = 0;
	let either = 0;
	for (let i = 0; i < a.covered.length; i++) {
		const inA = a.covered[i] as number;
		const inB = b.covered[i] as number;
		both += inA & inB;
		either += inA | inB;
	}
	return either === 0 ? 1 : both / either;
}
