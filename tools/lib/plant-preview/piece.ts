// A species' branch pieces drawn on the CPU as a studio photograph lays them out: the cut's bare
// wood standing from its foot with a piece at each socket, or one piece alone. The camera has no
// perspective. It stands so the drawn layout takes the photograph's own box in the frame, so the two
// outlines lie over one another and the review tool's measures read both the same way.
import type {
	CardCell,
	PrototypeArrays,
	ShootPrototype,
	ShootRows,
	SpeciesKitData,
} from '../../../packages/vegetation/src/asset.ts';
import { DETAILS } from '../../../packages/vegetation/src/core/types.ts';
import type {
	PiecePrototype,
	PlacedPiece,
	StudioLayout,
} from '../../../packages/vegetation/src/leaf/piece.ts';
import { meshedPlan } from '../../../packages/vegetation/src/leaf/shoot.ts';
import { bakeCards } from '../../../packages/vegetation/src/lod/card-bake.ts';
import { rasterise } from '../../../packages/vegetation/src/lod/raster.ts';
import { matteMask, measurePlant } from '../plant-review/references.ts';
import { type PreviewCamera, project } from './camera.ts';
import { type Canvas, COVER_LEAF, canvas, drawShoots, matte, NATURAL, painted } from './draw.ts';
import { type ReferenceView, type RenderView, SUPERSAMPLE } from './match.ts';
import { gapSpread } from './spread.ts';

const DEG = Math.PI / 180;
/** The tier a studio view draws: the near meshes a close photograph is judged on. */
const TIER = DETAILS.indexOf('high');
/** The sky share a studio row draws its leaves at: full light, as a studio's is. */
const STUDIO_SKY = 220;

/** A mesh with no vertices, for the tiers a studio view does not draw. */
function emptyTier(): PrototypeArrays {
	return {
		positions: new Float32Array(0),
		normals: new Float32Array(0),
		uvs: new Float32Array(0),
		uvs1: new Float32Array(0),
		colors: new Uint8Array(0),
		indices: new Uint16Array(0),
	};
}

/** A piece's or a stand's meshes as a kit prototype that holds the drawn tier alone. */
function drawn(
	source: Pick<PiecePrototype, 'length' | 'radius' | 'leaves' | 'tiers'>,
	index: number,
): ShootPrototype {
	const tiers = source.tiers.map((tier, t) =>
		t === TIER ? tier : emptyTier(),
	) as unknown as ShootPrototype['tiers'];
	return {
		index,
		class: 'cut',
		cutting: true,
		vigor: [0, 1],
		length: source.length,
		radius: source.radius,
		leaves: source.leaves,
		tiers,
		card: { planes: [] } as unknown as ShootPrototype['card'],
	};
}

/** A studio layout as the kit and rows the preview's drawing reads. */
export interface StudioScene {
	readonly kit: SpeciesKitData;
	readonly rows: ShootRows;
	/** Leaves and pieces the layout holds. */
	readonly leaves: number;
	readonly pieces: number;
	/** Rows that draw the stand's wood, which come first; the rest draw pieces. */
	readonly standRows: number;
	/** The pieces' own prototypes, in the kit's order, which the card bake reads. */
	readonly source: readonly PiecePrototype[];
}

/**
 * Turns a studio layout into prototypes and rows: one row for the stand and one for each piece.
 *
 * @param kit The species' kit, whose record and leaf outline the drawing reads.
 * @param pieces The species' pieces.
 * @param layout The layout.
 * @returns The scene.
 */
export function studioScene(
	kit: SpeciesKitData,
	pieces: readonly PiecePrototype[],
	layout: StudioLayout,
): StudioScene {
	const prototypes: ShootPrototype[] = pieces.map((piece, index) => drawn(piece, index));
	const placed: { prototype: number; position: readonly number[]; rotation: readonly number[] }[] =
		[];
	if (layout.stand) {
		prototypes.push(
			drawn(
				meshedPlan(
					layout.stand,
					DETAILS.map(() => []),
				),
				prototypes.length,
			),
		);
		placed.push({ prototype: prototypes.length - 1, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
	}
	let leaves = 0;
	// A piece's variants by name, each with the prototypes of its parts.
	const variantsOf = (name: string): number[][] => {
		const byVariant = new Map<number, number[]>();
		for (const [index, piece] of pieces.entries())
			if (piece.piece === name)
				byVariant.set(piece.variant, [...(byVariant.get(piece.variant) ?? []), index]);
		return [...byVariant.values()];
	};
	for (const piece of layout.placed as readonly PlacedPiece[]) {
		const variants = variantsOf(piece.piece);
		const parts = variants[piece.pick % Math.max(1, variants.length)];
		if (!parts) throw new Error(`no piece named '${piece.piece}' was built`);
		// Every part of the variant stands at the one socket with the one turn.
		for (const prototype of parts) {
			leaves += (pieces[prototype] as PiecePrototype).leaves;
			placed.push({ prototype, position: piece.position, rotation: piece.rotation });
		}
	}
	const count = placed.length;
	const rows: ShootRows = {
		count,
		prototype: Uint8Array.from(placed, (row) => row.prototype),
		position: Float32Array.from(placed.flatMap((row) => [...row.position])),
		rotation: Float32Array.from(placed.flatMap((row) => [...row.rotation])),
		scale: new Float32Array(count).fill(1),
		record: new Uint16Array(count),
		phase: new Uint8Array(count),
		sky: new Uint8Array(count).fill(STUDIO_SKY),
		bent: new Uint8Array(count),
		order: Uint32Array.from(placed, (_, k) => k),
	};
	return {
		kit: { ...kit, prototypes },
		rows,
		leaves,
		pieces: layout.placed.length,
		standRows: layout.stand ? 1 : 0,
		source: pieces,
	};
}

/** A scene's extent across and up the picture of a camera at a turn, in metres. */
function extent(scene: StudioScene, turn: number): [number, number, number, number] {
	const rx = Math.cos(turn * DEG);
	const rz = -Math.sin(turn * DEG);
	let left = Infinity;
	let right = -Infinity;
	let low = Infinity;
	let high = -Infinity;
	const { rows, kit } = scene;
	for (let r = 0; r < rows.count; r++) {
		const mesh = kit.prototypes[rows.prototype[r] as number]?.tiers[TIER];
		if (!mesh) continue;
		const [x, y, z, w] = rows.rotation.subarray(r * 4, r * 4 + 4) as unknown as number[];
		const px = rows.position[r * 3] as number;
		const py = rows.position[r * 3 + 1] as number;
		const pz = rows.position[r * 3 + 2] as number;
		for (let i = 0; i < mesh.positions.length; i += 3) {
			const vx = mesh.positions[i] as number;
			const vy = mesh.positions[i + 1] as number;
			const vz = mesh.positions[i + 2] as number;
			// The vertex turned by the row's quaternion.
			const tx = 2 * ((y as number) * vz - (z as number) * vy);
			const ty = 2 * ((z as number) * vx - (x as number) * vz);
			const tz = 2 * ((x as number) * vy - (y as number) * vx);
			const wx = px + vx + (w as number) * tx + ((y as number) * tz - (z as number) * ty);
			const wy = py + vy + (w as number) * ty + ((z as number) * tx - (x as number) * tz);
			const wz = pz + vz + (w as number) * tz + ((x as number) * ty - (y as number) * tx);
			const across = wx * rx + wz * rz;
			if (across < left) left = across;
			if (across > right) right = across;
			if (wy < low) low = wy;
			if (wy > high) high = wy;
		}
	}
	return [left, right, low, high];
}

/** A studio view: the render, and the scale it was drawn at. */
export interface StudioView extends RenderView {
	/** Metres the layout spans across and up the picture. */
	readonly wide: number;
	readonly tall: number;
}

/** The cards of a scene's pieces: the atlas and each piece prototype's planes. */
export interface PieceCards {
	readonly atlas: SpeciesKitData['cards'];
	readonly cells: readonly CardCell[];
}

/**
 * Bakes the cards of a scene's pieces through the package's own card bake: one cell per prototype
 * on three planes, at the tier a review draws.
 *
 * @param scene The scene.
 * @returns The atlas and the cells, in the pieces' order.
 */
export function pieceCards(scene: StudioScene): PieceCards {
	return bakeCards(
		scene.kit.record,
		scene.kit.manifest,
		'high',
		scene.source.map((piece, index) => ({
			index,
			class: 'cut' as const,
			vigor: [0, 1] as const,
			length: piece.length,
			radius: piece.radius,
			leaves: piece.leaves,
			tiers: piece.tiers,
		})),
	);
}

/** The coverage at which a card's texel counts as leaf: the plant material's own cutoff. */
const CARD_CUTOFF = 0.5;

/**
 * Draws the piece rows of a scene as their cards: each prototype's three planes, turned and placed
 * as the row places it, with the atlas's coverage cut from them. A studio view stands close, so a
 * cell's texels are magnified and each shows.
 */
function drawPieceCards(
	into: Canvas,
	camera: PreviewCamera,
	scene: StudioScene,
	cards: PieceCards,
): void {
	const { size, color } = cards.atlas;
	const alphaAt = (x: number, y: number): number =>
		(color[
			(Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))) * 4 + 3
		] as number) / 255;
	const { rows } = scene;
	const points = new Float64Array(12);
	const shown = new Float32Array(into.width * into.height).fill(Infinity);
	for (let r = scene.standRows; r < rows.count; r++) {
		const cell = cards.cells[rows.prototype[r] as number];
		if (!cell) continue;
		const x = rows.rotation[r * 4] as number;
		const y = rows.rotation[r * 4 + 1] as number;
		const z = rows.rotation[r * 4 + 2] as number;
		const w = rows.rotation[r * 4 + 3] as number;
		const turned = (v: readonly number[]): [number, number, number] => {
			const tx = 2 * (y * (v[2] as number) - z * (v[1] as number));
			const ty = 2 * (z * (v[0] as number) - x * (v[2] as number));
			const tz = 2 * (x * (v[1] as number) - y * (v[0] as number));
			return [
				(v[0] as number) + w * tx + (y * tz - z * ty),
				(v[1] as number) + w * ty + (z * tx - x * tz),
				(v[2] as number) + w * tz + (x * ty - y * tx),
			];
		};
		for (const plane of cell.planes) {
			const centre = turned(plane.centre);
			const right = turned(plane.right);
			const up = turned(plane.up);
			// The plane's corners, in the order of the cell's corners: low, right, far, up.
			const corners = [
				[-1, -1],
				[1, -1],
				[1, 1],
				[-1, 1],
			] as const;
			for (const [k, [a, b]] of corners.entries())
				project(
					camera,
					(rows.position[r * 3] as number) + centre[0] + right[0] * a + up[0] * b,
					(rows.position[r * 3 + 1] as number) + centre[1] + right[1] * a + up[1] * b,
					(rows.position[r * 3 + 2] as number) + centre[2] + right[2] * a + up[2] * b,
					points,
					k * 3,
				);
			const [rx, ry, rw, rh] = plane.front;
			rasterise(into.target, points, [0, 1, 2, 0, 2, 3], (f) => {
				// The fragment's place on the cell, from the corner weights of its triangle.
				const [ca, cb, cc] = f.triangle === 0 ? [0, 1, 2] : [0, 2, 3];
				const u =
					((corners[ca as number] as readonly number[])[0] as number) * f.w0 +
					((corners[cb as number] as readonly number[])[0] as number) * f.w1 +
					((corners[cc as number] as readonly number[])[0] as number) * f.w2;
				const v =
					((corners[ca as number] as readonly number[])[1] as number) * f.w0 +
					((corners[cb as number] as readonly number[])[1] as number) * f.w1 +
					((corners[cc as number] as readonly number[])[1] as number) * f.w2;
				const tx = rx + ((u + 1) / 2) * rw - 0.5;
				const ty = ry + ((v + 1) / 2) * rh - 0.5;
				const x0 = Math.floor(tx);
				const y0 = Math.floor(ty);
				const fx = tx - x0;
				const fy = ty - y0;
				const alpha =
					(alphaAt(x0, y0) * (1 - fx) + alphaAt(x0 + 1, y0) * fx) * (1 - fy) +
					(alphaAt(x0, y0 + 1) * (1 - fx) + alphaAt(x0 + 1, y0 + 1) * fx) * fy;
				const at = f.y * into.width + f.x;
				into.clear[at] = (into.clear[at] as number) * (1 - alpha);
				if (alpha >= CARD_CUTOFF && f.depth < (shown[at] as number)) {
					shown[at] = f.depth;
					into.cover[at] = COVER_LEAF;
					into.tone[at] = 190;
				}
				return false;
			});
		}
	}
}

/**
 * Draws a studio scene so it takes its photograph's box in the frame: the same height in the frame,
 * centred where the photograph's cut is centred.
 *
 * @param scene The scene.
 * @param reference The photograph.
 * @param turn Degrees the camera stands round the layout.
 * @param cards The pieces' cards, to draw each piece as its cards and not as its leaves.
 * @returns The picture, its matte and the review's measures of it.
 */
export function studioView(
	scene: StudioScene,
	reference: ReferenceView,
	turn: number,
	cards?: PieceCards,
): StudioView {
	const box = reference.measures.box;
	if (!box) throw new Error('the reference holds no outline to frame by');
	const { width, height } = reference.plant;
	const [left, right, low, high] = extent(scene, turn);
	const scale = (box.bottom - box.top + 1) / Math.max(1e-6, high - low);
	const across = (left + right) / 2 - ((box.left + box.right + 1) / 2 - width / 2) / scale;
	const rise = (low + high) / 2 + ((box.top + box.bottom + 1) / 2 - height / 2) / scale;
	const out = [Math.sin(turn * DEG), 0, Math.cos(turn * DEG)] as const;
	const rightward = [Math.cos(turn * DEG), 0, -Math.sin(turn * DEG)] as const;
	const far = 20;
	const camera: PreviewCamera = {
		width: width * SUPERSAMPLE,
		height: height * SUPERSAMPLE,
		position: [rightward[0] * across + out[0] * far, rise, rightward[2] * across + out[2] * far],
		right: rightward,
		up: [0, 1, 0],
		forward: [-out[0], 0, -out[2]],
		focal: 0,
		scale: scale * SUPERSAMPLE,
	};
	const drawing = canvas(camera.width, camera.height);
	if (cards) {
		// The stand's wood stays wood at the card level; only the pieces turn to cards.
		if (scene.standRows > 0)
			drawShoots(drawing, camera, scene.kit, { ...scene.rows, count: scene.standRows });
		drawPieceCards(drawing, camera, scene, cards);
	} else drawShoots(drawing, camera, scene.kit, scene.rows);
	const picture = matte(drawing, SUPERSAMPLE);
	const plant = matteMask(picture);
	const measures = measurePlant(picture, plant);
	return {
		colour: painted(drawing, SUPERSAMPLE, NATURAL),
		matte: picture,
		plant,
		measures,
		spread: gapSpread(plant, measures),
		wide: right - left,
		tall: high - low,
	};
}
