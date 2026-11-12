// One species in one review view, drawn to be laid beside its reference pictures: the whole plant
// and its turntable, the crown from outside, below and inside, a limb leaving the stem and a limb's
// fork, a branch across its own run or the crown's rim, a twig or a fruit, a cut branch, sub-branch,
// leaf cluster or leaf, the bark at the base, mid-trunk and on a limb, the trunk, the wood alone,
// the silhouette, and the four panels of the per-species picture test. It grows the species through the plant core's public functions (any registered
// species, or any other id as a stand-in), so the page draws what a scene would draw. The query
// contract lives in `../lib/plant-review/`, which the review tools share. The page posts what it
// measured and where its cameras stood as the `plant-review` message, so a tool records the facts
// beside the pixels.

import { type Camera, defineSketch, quat, type SketchContext } from '@null3d/engine';
import {
	BUD_TERMINAL,
	bakeFarPlant,
	createNearPool,
	type FarPlant,
	growPlant,
	isSpeciesId,
	loadSpeciesOrStandIn,
	type NearPool,
	type PlantAsset,
	type PlantMaterials,
	type PlantPart,
	placePlants,
	plantMaterials,
	prepareSpecies,
	type SpeciesKit,
	setWindLayer,
} from '@null3d/vegetation';
import { createWind, type Wind } from '@null3d/wind';
import {
	chainOf,
	facing,
	flowerSites,
	largestLimb,
	limbGapTurn,
	limbNear,
	nodeAt,
	normalize,
	pointAlong,
	stemAt,
	stemFoot,
	stemSurfaceAt,
	sunlitTip,
	turnedAbout,
	type V3,
} from '../lib/plant-review/anatomy';
import {
	barkLimbView,
	belowView,
	type ClosePlant,
	type CloseView,
	departures,
	forkView,
	insideView,
	junctionView,
	limbPieces,
	limbView,
	strandsView,
	surfaceView,
	trunkView,
	twigView,
	walkedRound,
} from '../lib/plant-review/close';
import {
	type CutRows,
	cutCamera,
	leafFrame,
	type ScreenFraming,
	spanDistance,
	standCamera,
} from '../lib/plant-review/framing';
import { measurePlant, partPositions, shootPositions } from '../lib/plant-review/measure';
import { readPlantReviewQuery } from '../lib/plant-review/query';
import { sharedRecords } from '../lib/plant-review/sight';
import { BACKGROUND_COLOURS, type PlantView, VIEW_SPECS } from '../lib/plant-review/views';

const QUERY = readPlantReviewQuery(new URL(import.meta.url).searchParams);
const VIEW: PlantView = QUERY.view ?? 'whole';
const SPEC = VIEW_SPECS[VIEW];
/**
 * Whether the view draws the wood alone: a wood view does, unless the slot asks for the foliage too,
 * which a bark photograph taken among leaves needs before its colour can be compared with like.
 */
const WOOD_ONLY = SPEC.woodOnly === true && QUERY.foliage !== true;
const SIZE = QUERY.size ?? SPEC.size;
const FOV = QUERY.fov ?? SPEC.fov;
const BACKGROUND = QUERY.background ?? SPEC.background;
const SUN = QUERY.sun ?? SPEC.sun;
/** The reference's own light as [radians to the camera's right, degrees above the horizon], or null. */
const REFERENCE_LIGHT: [number, number] | null =
	QUERY.sunAzimuth !== undefined && QUERY.sunRise !== undefined
		? [(QUERY.sunAzimuth * Math.PI) / 180, QUERY.sunRise]
		: null;
const MATTE = VIEW === 'silhouette' || QUERY.matte === true;
/**
 * The level forced at every distance: the query's, or the nearest for a view of the wood alone,
 * which judges the whole branching rather than what a level keeps at its distance. A view of the
 * fruit takes the nearest too: a plant's cones, keys and flowers stand on the grown plant's extras,
 * and only the nearest level carries them, so a farther level frames leaves where the fruit is.
 */
const LOD = QUERY.lod ?? (WOOD_ONLY || QUERY.fruit ? 0 : undefined);
const DEG = Math.PI / 180;
/**
 * A colour scaled by another colour's channels, which is how a picture's own white balance tints a
 * light: white keeps every light as it is, and a warmer lamp takes blue out of all of them.
 */
function tinted(colour: string, by: string): string {
	const channel = (hex: string, at: number) => Number.parseInt(hex.slice(at, at + 2), 16) / 255;
	const parts = [0, 2, 4].map((at) =>
		Math.round(Math.min(1, channel(colour, at + 1) * channel(by, at + 1)) * 255)
			.toString(16)
			.padStart(2, '0'),
	);
	return `#${parts.join('')}`;
}
/** The quaternion that lays a plane, which faces +Z, flat on the ground. */
const FLAT: [number, number, number, number] = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
/** The height of a standing person's eye, in metres. */
const EYE = 1.6;
/** Where a second piece stands, far past every camera's far plane from the first. */
const AWAY: V3 = [20000, 0, 0];
/** A camera's far plane, in metres. */
const FAR = 9000;
/**
 * Degrees a copy stand's lamps stand either side of its camera: far enough round that a glossy leaf
 * pressed square to the lens throws their glare clear of it.
 */
const COPY_STAND_LAMP = 60;
/** The share of the frame left clear round a fitted plant. */
const MARGIN = 0.08;
/** Metres from an acorn to the fruit of its own stalk, so a view of the fruit frames that cluster. */
const FRUIT_REACH = 0.2;
/** The share of the frame that the reference's close-up gives its acorn cluster. */
const FRUIT_SHARE = 0.73;
/** Metres around a fruit within which foliage counts as holding it. */
const FRUIT_ENCLOSED = 0.7;
/** Metres beyond a fruit along the lens's line in which foliage still fills the background. */
const FRUIT_CLEAR = 3;
/** Metres either side of that line within which foliage counts as standing in the frame. */
const FRUIT_TUBE = 0.6;
/** Degrees the fruit camera stands below its cluster, looking up at the join with the twig. */
const FRUIT_ELEVATION = -12;
/** Stops of switch bias that carry a forced nearest level's shoots past every far plane. */
const FORCED_NEAR_STOPS = 20;
/** The most cells a sheet draws: the scene's views less the camera's own. */
const MOST_CELLS = 31;

/** Where a camera stands and what it looks at. */
interface View {
	readonly position: V3;
	readonly target: V3;
	readonly fov: number;
	/** The near plane, when the view clears what stands close to the camera. */
	readonly near?: number;
	/** Radians the camera turns about its line of sight, the picture turning counterclockwise. */
	readonly roll?: number;
}

/** One cell of the canvas and the view drawn into it. */
interface Cell {
	readonly turn: number;
	readonly rect: readonly [number, number, number, number];
	readonly view: View;
	/** Which piece the cell shows: the plant, or the second piece standing away. */
	readonly piece: 'plant' | 'away';
}

function add(a: readonly number[], b: readonly number[]): V3 {
	return [
		(a[0] as number) + (b[0] as number),
		(a[1] as number) + (b[1] as number),
		(a[2] as number) + (b[2] as number),
	];
}
function sub(a: readonly number[], b: readonly number[]): V3 {
	return [
		(a[0] as number) - (b[0] as number),
		(a[1] as number) - (b[1] as number),
		(a[2] as number) - (b[2] as number),
	];
}
function scale(a: readonly number[], s: number): V3 {
	return [(a[0] as number) * s, (a[1] as number) * s, (a[2] as number) * s];
}
function cross(a: readonly number[], b: readonly number[]): V3 {
	const [ax, ay, az] = a as V3;
	const [bx, by, bz] = b as V3;
	return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}
/** A vector turned about +Y by an angle in radians. */
function yaw(v: readonly number[], angle: number): V3 {
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	return [
		(v[0] as number) * c + (v[2] as number) * s,
		v[1] as number,
		-(v[0] as number) * s + (v[2] as number) * c,
	];
}

/** A camera on a sphere round a target: `elevation` degrees up, seen from the target. */
function orbit(target: V3, distance: number, elevation: number, turn: number, fov = FOV): View {
	const e = elevation * DEG;
	const out = facing(turn);
	const direction: V3 = [out[0] * Math.cos(e), Math.sin(e), out[2] * Math.cos(e)];
	return { position: add(target, scale(direction, distance)), target, fov };
}

/**
 * The rotation of a camera at `position` that looks at `target`, turned about its line of sight by
 * `roll` radians: its up starts toward the sky and turns with the roll.
 */
function rolledLook(position: V3, target: V3, roll: number): [number, number, number, number] {
	const forward = normalize(sub(target, position));
	const right = normalize(cross(forward, Math.abs(forward[1]) > 0.999 ? [1, 0, 0] : [0, 1, 0]));
	const up = turnedAbout(cross(right, forward), forward, roll);
	// A camera points its -Z at what it looks at.
	return quat.lookAt([0, 0, 0, 1], target, position, up) as [number, number, number, number];
}

/** A view with its camera moved to the query's distance from its target, when it names one. */
function atDistance(view: View): View {
	if (QUERY.distance === undefined) return view;
	const along = normalize(sub(view.position, view.target));
	return { ...view, position: add(view.target, scale(along, QUERY.distance)) };
}

/** The box round a set of positions. */
interface Bounds {
	readonly min: V3;
	readonly max: V3;
}

/** The bounds of an asset's parts at every level and of its skeleton. */
function boundsOf(asset: PlantAsset, kit: SpeciesKit): Bounds {
	const min: V3 = [...asset.skeleton.bounds.min] as V3;
	const max: V3 = [...asset.skeleton.bounds.max] as V3;
	for (const level of asset.levels)
		for (const part of level.parts) {
			const p = partPositions(part, kit.box);
			for (let i = 0; i < p.length; i++) {
				const k = i % 3;
				min[k] = Math.min(min[k] as number, p[i] as number);
				max[k] = Math.max(max[k] as number, p[i] as number);
			}
		}
	return { min, max };
}

/**
 * The camera that fills the frame with the points a piece actually draws, rather than with the
 * corners of its box. A deep piece's corners stand well outside its own silhouette, so fitting the
 * box leaves the piece small; fitting its points puts it in the frame as the reference does, which
 * also keeps the thin wood that joins its parts from falling below a pixel. The points are its
 * parts' and those of its shoot rows, which draw the leaves of a piece cut from an instanced plant.
 * With `rows`, the piece's highest and lowest points land on the rows its photograph shows them on.
 */
function fitPoints(
	asset: PlantAsset,
	kit: SpeciesKit,
	turn: number,
	elevation: number,
	aspect: number,
	fov: number,
	rows?: CutRows,
): View {
	const points: number[] = [];
	const min: V3 = [...asset.skeleton.bounds.min] as V3;
	const max: V3 = [...asset.skeleton.bounds.max] as V3;
	for (const level of asset.levels)
		for (const part of level.parts) {
			const p = partPositions(part, kit.box);
			for (let i = 0; i < p.length; i++) points.push(p[i] as number);
		}
	const shoots = shootPositions(asset, kit);
	for (let i = 0; i < shoots.length; i++) points.push(shoots[i] as number);
	if (points.length === 0)
		return fit({ min: [...min] as V3, max: [...max] as V3 }, turn, elevation, aspect, fov);
	for (let i = 0; i < points.length; i += 3)
		for (let k = 0; k < 3; k++) {
			min[k] = Math.min(min[k] as number, points[i + k] as number);
			max[k] = Math.max(max[k] as number, points[i + k] as number);
		}
	const centre = scale(add(min, max), 0.5);
	const back = orbit([0, 0, 0], 1, elevation, turn);
	const forward = normalize(scale(back.position, -1));
	const right = normalize(cross(forward, [0, 1, 0]));
	const up = cross(right, forward);
	if (rows) {
		const { distance, lift } = cutCamera(
			points,
			centre,
			forward,
			right,
			up,
			fov,
			aspect,
			rows,
			MARGIN,
		);
		return orbit(add(centre, scale(up, lift)), distance, elevation, turn, fov);
	}
	const half = Math.tan((fov * DEG) / 2) * (1 - 2 * MARGIN);
	let distance = 0.05;
	for (let i = 0; i < points.length; i += 3) {
		const d: V3 = [
			(points[i] as number) - centre[0],
			(points[i + 1] as number) - centre[1],
			(points[i + 2] as number) - centre[2],
		];
		const across = Math.abs(d[0] * right[0] + d[1] * right[1] + d[2] * right[2]);
		const tall = Math.abs(d[0] * up[0] + d[1] * up[1] + d[2] * up[2]);
		const toward = -(d[0] * forward[0] + d[1] * forward[1] + d[2] * forward[2]);
		distance = Math.max(distance, across / (half * aspect) + toward, tall / half + toward);
	}
	return orbit(centre, distance, elevation, turn, fov);
}

/**
 * The orbit that fits a box in the frame with a margin all round, at a turn and an elevation: the
 * box's corners seen across the view's right and up axes set the distance.
 */
function fit(bounds: Bounds, turn: number, elevation: number, aspect: number, fov = FOV): View {
	const centre = scale(add(bounds.min, bounds.max), 0.5);
	const back = orbit([0, 0, 0], 1, elevation, turn);
	const forward = normalize(scale(back.position, -1));
	const right = normalize(cross(forward, [0, 1, 0]));
	const up = cross(right, forward);
	// Each corner needs the camera far enough back that it lands inside the frame, nearer corners
	// further back by how far they stand toward the camera.
	const half = Math.tan((fov * DEG) / 2) * (1 - 2 * MARGIN);
	let distance = 0.05;
	for (let c = 0; c < 8; c++) {
		const corner: V3 = [
			c & 1 ? bounds.max[0] : bounds.min[0],
			c & 2 ? bounds.max[1] : bounds.min[1],
			c & 4 ? bounds.max[2] : bounds.min[2],
		];
		const d = sub(corner, centre);
		const across = Math.abs(d[0] * right[0] + d[1] * right[1] + d[2] * right[2]);
		const tall = Math.abs(d[0] * up[0] + d[1] * up[1] + d[2] * up[2]);
		const toward = -(d[0] * forward[0] + d[1] * forward[1] + d[2] * forward[2]);
		distance = Math.max(distance, across / (half * aspect) + toward, tall / half + toward);
	}
	return orbit(centre, distance, elevation, turn, fov);
}

/**
 * The camera that stands on the ground and puts a whole plant where the query's framing in screen
 * shares asks, as a reference picture framed its plant.
 */
function standView(height: number, foot: V3, turn: number, aspect: number): View {
	const middle = QUERY.targetY ?? 0.5;
	const fill = QUERY.fill ?? 0.8;
	const asked = QUERY.top !== undefined && QUERY.fill === undefined;
	const framing: ScreenFraming = {
		fov: FOV,
		aspect,
		horizon: QUERY.horizon ?? 0.62,
		top: asked ? (QUERY.top as number) : middle - fill / 2,
		...(asked ? { eye: QUERY.eye ?? EYE } : { base: middle + fill / 2 }),
		targetX: QUERY.targetX ?? 0.5,
	};
	const stand = standCamera(framing, height);
	const out = facing(turn);
	const right: V3 = [Math.cos(turn), 0, -Math.sin(turn)];
	const position = add(add(foot, scale(out, stand.distance)), [0, stand.height, 0]);
	const level = sub(scale(out, -Math.cos(stand.yaw)), scale(right, Math.sin(stand.yaw)));
	const look = add(scale(level, Math.cos(stand.pitch)), [0, Math.sin(stand.pitch), 0]);
	return { position, target: add(position, scale(look, stand.distance)), fov: FOV };
}

/**
 * A view whose camera moves along its own line to the target by a scale: a review redraw corrects
 * a picture's margin from the width the picture itself measured.
 */
function scaledStand<T extends { readonly position: V3; readonly target: V3 }>(
	view: T,
	scale: number | undefined,
): T {
	if (scale === undefined || scale === 1 || !(scale > 0)) return view;
	return {
		...view,
		position: [
			view.target[0] + (view.position[0] - view.target[0]) * scale,
			view.target[1] + (view.position[1] - view.target[1]) * scale,
			view.target[2] + (view.position[2] - view.target[2]) * scale,
		],
	};
}

/** Whether the query frames a whole plant in screen shares. */
const FRAMED =
	QUERY.horizon !== undefined ||
	QUERY.fill !== undefined ||
	QUERY.targetY !== undefined ||
	QUERY.targetX !== undefined ||
	QUERY.top !== undefined;

/**
 * The rows a cut piece's top and foot land on, from the query's framing in screen shares: its top
 * row and its base row, or the frame's foot where the photograph's piece runs off it.
 */
const CUT_ROWS: CutRows | undefined =
	QUERY.fill !== undefined
		? {
				top: (QUERY.targetY ?? 0.5) - QUERY.fill / 2,
				base: (QUERY.targetY ?? 0.5) + QUERY.fill / 2,
			}
		: QUERY.top !== undefined
			? { top: QUERY.top, base: 1 }
			: undefined;

/** Whether an asset draws any wood at all: a ground plant draws its whole body as merged foliage. */
function hasWood(asset: PlantAsset): boolean {
	return asset.levels.some((level) => level.parts.some((part) => part.name === 'wood'));
}

/** The asset as a view draws it: the wood alone, or one level at every distance. */
function shaped(asset: PlantAsset, woodOnly: boolean): PlantAsset {
	// A view of the wood alone has no wood to draw on a ground plant. Its crown, sheaths and blades
	// are that plant's body, so the view keeps them rather than drawing an empty picture.
	const bare = woodOnly && hasWood(asset);
	const keep = (parts: readonly PlantPart[]) =>
		bare ? parts.filter((part) => part.name === 'wood') : parts;
	const levelAt = (index: 0 | 1 | 2, from: number, source = asset.levels[index]) => ({
		...source,
		level: index,
		parts: keep(source.parts),
		from,
	});
	const empty = { parts: [], triangles: 0, bytes: 0 };
	const lod = LOD;
	const rows =
		bare || (lod !== undefined && lod !== 0) ? { ...asset.shoots, count: 0 } : asset.shoots;
	if (lod === undefined || lod === 3)
		return {
			...asset,
			shoots: rows,
			levels: [
				levelAt(0, asset.levels[0].from),
				levelAt(1, asset.levels[1].from),
				levelAt(2, asset.levels[2].from),
			],
			impostor: lod === 3 ? { ...asset.impostor, from: 0 } : asset.impostor,
		};
	// A forced level draws as the nearest level from the camera to the horizon.
	const source = asset.levels[lod];
	return {
		...asset,
		shoots: rows,
		levels: [
			levelAt(0, 0, source),
			{ ...empty, level: 1, from: Number.MAX_VALUE },
			{ ...empty, level: 2, from: Number.MAX_VALUE },
		],
		impostor: { ...asset.impostor, from: Number.MAX_VALUE },
	};
}

/** The materials of a matte: the plant black, with the card atlas's cut-outs kept. */
function matteMaterials(ctx: SketchContext, kit: SpeciesKit): PlantMaterials {
	const black = { color: '#000000', doubleSided: true } as const;
	return {
		wood: ctx.materials.unlit(black),
		shoots: ctx.materials.unlit(black),
		cards: ctx.materials.unlit({
			...black,
			map: kit.textures.cardColor,
			alphaMode: 'mask',
			alphaCutoff: 0.5,
		}),
		foliage: ctx.materials.unlit(black),
		extras: ctx.materials.unlit(black),
	};
}

/** A cell grid for `count` cells of a frame's shape: columns and rows. */
function grid(count: number): readonly [number, number] {
	if (QUERY.columns) return [QUERY.columns, Math.ceil(count / QUERY.columns)];
	if (VIEW === 'turntable' && count === 8) return [4, 2];
	let best: [number, number] = [count, 1];
	let score = Number.POSITIVE_INFINITY;
	for (let columns = 1; columns <= count; columns++) {
		const rows = Math.ceil(count / columns);
		const cell = SIZE[0] / columns / (SIZE[1] / rows);
		const s = Math.abs(Math.log(cell / (4 / 3))) + (columns * rows - count) * 0.05;
		if (s < score) {
			score = s;
			best = [columns, rows];
		}
	}
	return best;
}

export default defineSketch(async (ctx) => {
	const { scene, geometry, materials, post, page, debug } = ctx;
	// A review picture is laid beside a reference that carries no display curve; a tone curve
	// would crush and saturate the sky and the foliage that the reference shows as they are.
	post.set({ toneMapping: 'none' });
	if (QUERY.motion) debug.view('motion');
	const notes: string[] = [];
	// A registered species grows through its own stages, with a stand-in only for each stage that is
	// not built yet; any other id, or the query's `placeholders`, grows the stand-in of every stage.
	const placeholders: boolean | 'missing' =
		QUERY.placeholders ?? (isSpeciesId(QUERY.species) ? 'missing' : true);
	const loadedModule = await loadSpeciesOrStandIn(QUERY.species);
	// A tuft's soil — its rhizome and roots — belongs to the picture that frames the lifted base;
	// every other view grows the plant above the soil, which is what the ground shows of it.
	const record =
		VIEW !== 'soil' &&
		loadedModule.record.growth.model === 'tuft' &&
		loadedModule.record.growth.soil !== undefined
			? (() => {
					const growth = loadedModule.record.growth;
					if (growth.model !== 'tuft') return loadedModule.record;
					const { soil: _soil, ...above } = growth;
					return { ...loadedModule.record, growth: above };
				})()
			: loadedModule.record;
	const module = { ...loadedModule, record };
	// The query's form, another habit or the young plant, grows when the record has it. A record
	// without that form grows as it stands, with a note, so a still of another habit is still drawn.
	const form =
		QUERY.form !== undefined && record.forms && Object.hasOwn(record.forms, QUERY.form)
			? QUERY.form
			: undefined;
	if (QUERY.form !== undefined && form === undefined)
		notes.push(`the record has no ${QUERY.form} form, so the plant grows as its record stands`);
	const prepare = {
		detail: QUERY.preset ?? 'high',
		placeholders,
		...(form !== undefined && { form }),
	} as const;
	const kit = await prepareSpecies(ctx, module, prepare);
	const grow = {
		seed: QUERY.seed ?? 11,
		variant: QUERY.variant ?? 0,
		near: true,
		...(QUERY.season && { season: QUERY.season }),
		...(QUERY.sparse !== undefined && { sparse: QUERY.sparse }),
	};
	const turn0 = (QUERY.turn ?? 0) * DEG;
	const cuttingPart = VIEW === 'panels' ? 'cluster' : SPEC.cutting;
	const cutting = cuttingPart && {
		part: cuttingPart,
		...(QUERY.cut !== undefined && { length: QUERY.cut }),
		...(QUERY.pick !== undefined && { pick: QUERY.pick }),
		orient: 'upright' as const,
		...(VIEW === 'leaf-under' ? { face: 'lower' as const } : {}),
		...(QUERY.pressed !== undefined && { pressed: QUERY.pressed }),
		...(QUERY.age !== undefined && { age: QUERY.age }),
		...(QUERY.young !== undefined && { young: QUERY.young }),
	};
	const needsWhole = !SPEC.cutting;
	// A piece whose record hint names one of the species' cutting classes grows from a kit of its
	// own, which holds that class and no cards: the piece is only ever drawn at the nearest level.
	const cutHint = cutting ? record.cuttings?.[cutting.part] : undefined;
	const cutsClass =
		cutHint !== undefined &&
		'shoot' in cutHint &&
		(record.shoots?.cuttingClasses ?? []).some(
			(shoot) => shoot.name === cutHint.shoot && shoot.cutOnly === true,
		);
	// A plant cut carries a denser covering when the record asks for one: its cutting kit places the
	// shoots the studio piece needs and holds no card levels.
	const plantCut = cutHint !== undefined && 'order' in cutHint;
	const needsCutKit = cutsClass || (plantCut && record.cuttings?.density !== undefined);
	const pieceKit =
		cutting && needsCutKit ? await prepareSpecies(ctx, module, { ...prepare, cutting: true }) : kit;
	const [whole, piece] = await Promise.all([
		needsWhole ? growPlant(kit, grow) : undefined,
		cutting ? growPlant(pieceKit, { ...grow, cutting }) : undefined,
	]);
	const main = (whole ?? piece) as PlantAsset;
	const mainKit = whole ? kit : pieceKit;
	const bounds = boundsOf(main, mainKit);
	const skeleton = main.skeleton;
	const foot = stemFoot(skeleton);
	const height = Math.max(0.05, bounds.max[1]);

	// The turns a sheet draws, each in a cell of its own.
	const turns = VIEW === 'turntable' ? (QUERY.turns ?? 8) : (QUERY.turns ?? 1);
	if (turns > MOST_CELLS)
		throw new Error(`turns=${turns} is more than a sheet holds: give at most ${MOST_CELLS}.`);
	const step = (QUERY.step ?? 360 / turns) * DEG;
	const [columns, rows] = VIEW === 'panels' ? [2, 2] : grid(turns);
	const cellAspect = SIZE[0] / columns / (SIZE[1] / rows);
	const rect = (k: number): Cell['rect'] => [
		(k % columns) / columns,
		Math.floor(k / columns) / rows,
		1 / columns,
		1 / rows,
	];

	const limb = largestLimb(skeleton);
	const elevation = QUERY.elevation ?? SPEC.elevation;
	let facts: Record<string, unknown> = {};
	const foliage = record.foliage;
	/**
	 * A leaf's length in metres: one blade (broadleaf or grass), or a compound leaf's stalk, rachis
	 * and terminal leaflet, which is the piece a cutting's frame and the close views measure in.
	 */
	const leafLength =
		foliage.kind === 'blade'
			? (typeof foliage.leaf.length === 'number' ? foliage.leaf.length : foliage.leaf.length.mean) *
					(foliage.compound ? foliage.compound.rachis + 1 : 1) +
				(foliage.compound ? foliage.leaf.petiole.length : 0)
			: undefined;
	/**
	 * A grass blade's length in metres. A cutting of several blades is framed in the leaf length its
	 * photograph was measured in, which a blade a metre long would over-scale tenfold, so only a
	 * picture of one leaf takes its frame from this.
	 */
	const bladeLength =
		foliage.kind === 'grass-blade'
			? typeof foliage.blade.length === 'number'
				? foliage.blade.length
				: foliage.blade.length.mean
			: undefined;
	/** The foliage cards' places, which a view of the crown's fringe weighs its sight line with. */
	const foliagePoints = ((): Float32Array | undefined => {
		const parts = (main.levels[0]?.parts ?? []).filter(
			(part) => part.name === 'foliage' || part.name === 'cards',
		);
		if (parts.length === 0) return undefined;
		const lists = parts.map((part) => partPositions(part, kit.box));
		const out = new Float32Array(lists.reduce((n, list) => n + list.length, 0));
		let at = 0;
		for (const list of lists) {
			out.set(list, at);
			at += list.length;
		}
		return out;
	})();
	/** What the close views read of the plant: its wood alone for a view that draws the wood alone. */
	const closePlant = (woodOnly: boolean): ClosePlant => ({
		skeleton,
		shoots: woodOnly ? { ...main.shoots, count: 0 } : main.shoots,
		prototypes: mainKit.prototypes,
		...(leafLength !== undefined && { leafLength }),
		...(foliagePoints !== undefined && { foliage: foliagePoints }),
	});
	/** Each close view's camera, found once and walked round its subject for a sheet's turns. */
	const closeViews = new Map<string, CloseView | undefined>();
	/**
	 * What a view that found no subject of its own drew instead, and why, so the figures of its
	 * picture say which camera drew them.
	 */
	const plainSubjects = new Map<PlantView, { readonly kind: string; readonly warning: string }>();
	const closeAt = (
		key: string,
		find: () => CloseView | undefined,
		turn: number,
		fov: number,
		near: number,
	): View | undefined => {
		if (!closeViews.has(key)) closeViews.set(key, find());
		const found = closeViews.get(key);
		if (!found) return undefined;
		const walked = walkedRound(found, turn);
		return {
			position: walked.position,
			target: walked.target,
			fov,
			near,
			...(walked.roll && { roll: walked.roll }),
		};
	};

	/** The camera of the view at one turn, for the plant or the cut piece. */
	const viewAt = (view: PlantView, turn: number, aspect: number): View => {
		const spec = VIEW_SPECS[view];
		const e = QUERY.elevation ?? spec.elevation;
		const fov = QUERY.fov ?? spec.fov;
		const out = facing(turn);
		const lens = { fov, aspect };
		switch (view) {
			case 'turntable':
			case 'whole':
			case 'skeleton':
			case 'silhouette': {
				const view = FRAMED
					? standView(height, foot, turn, aspect)
					: fit(bounds, turn, e, aspect, fov);
				return scaledStand(view, QUERY.standScale);
			}
			case 'crown-sky': {
				// The crown against the sky from outside the plant: the eye near a person's height, a
				// stand far enough that the crown's height fills the frame and the whole crown stands
				// in it, looking up so the sky is behind. The gap inside its box then reads the sky
				// between the foliage rather than the outline's ragged edge.
				const base = main.crown.base;
				const top = main.crown.top;
				const middle = base + (top - base) * 0.55;
				const span = 2 * Math.tan((fov * DEG) / 2);
				const away = ((top - base) / span) * 1.15;
				const eyeHeight = 1.7;
				const lift = middle - eyeHeight;
				const distance = Math.hypot(away, lift);
				const elevation = (Math.atan2(eyeHeight - middle, away) * 180) / Math.PI;
				return orbit([foot[0], middle, foot[2]], distance, elevation, turn, fov);
			}
			case 'crown': {
				const top = main.crown.top;
				const middle = (main.crown.base + top) / 2;
				const band = Math.max(0.1, (top - main.crown.base) * 0.12);
				let reach = 0;
				for (const part of main.levels[1].parts.length > 0
					? main.levels[1].parts
					: main.levels[0].parts) {
					const p = partPositions(part, kit.box);
					for (let i = 0; i < p.length; i += 3) {
						if (Math.abs((p[i + 1] as number) - middle) > band) continue;
						reach = Math.max(
							reach,
							((p[i] as number) - foot[0]) * out[0] + ((p[i + 2] as number) - foot[2]) * out[2],
						);
					}
				}
				// A tree's crown is its outer surface, which its close photographs look along; a plant
				// whose crown is its whole body, such as a rosette, is framed at its own centre.
				const surface = stemAt(skeleton, 1.3)
					? add(add(foot, scale(out, reach)), [0, middle, 0])
					: add(foot, [0, middle, 0]);
				// A crown wider than the frame needs the camera further back than a limb's own reach:
				// a slot names the distance where its photograph shows the whole crown.
				return orbit(
					surface,
					QUERY.distance ?? Math.max(0.5, 0.6 * main.crown.radius),
					e,
					turn,
					fov,
				);
			}
			case 'crown-foot': {
				// The crown at soil level: its shoots' lower length seen side on, standing on the
				// ground the slot names, with the studio behind. The camera looks at the foot just
				// above the soil, close enough for the sheath's colour to read.
				const aim = Math.max(0.05, 0.06 * height);
				return orbit(
					[foot[0], aim, foot[2]],
					QUERY.distance ?? Math.max(0.3, 5 * aim),
					e,
					turn,
					fov,
				);
			}
			case 'below': {
				const below = belowView(closePlant(false), turn, lens, {
					elevation: e,
					...(QUERY.forkRow !== undefined && { forkRow: QUERY.forkRow }),
					...(QUERY.footRow !== undefined && { footRow: QUERY.footRow }),
					...(QUERY.crownRow !== undefined && { crownRow: QUERY.crownRow }),
					...(QUERY.aside !== undefined && { aside: QUERY.aside }),
					...(QUERY.stand !== undefined && { stand: QUERY.stand }),
				});
				closeViews.set(view, below);
				return { position: below.position, target: below.target, fov, near: 0.1 };
			}
			case 'crown-underside': {
				// The camera stands under the crown, the eye as far below its base as the underside
				// photographs keep it, and looks up at the crown's top: the crown's box fills most of
				// the frame, its leaves overhead and the trunk below.
				const top = main.crown.top;
				const base = main.crown.base;
				const half = Math.max(0.3, (top - base) / 2);
				const distance = QUERY.distance ?? Math.max(0.6, half / Math.tan((fov * 0.78 * DEG) / 2));
				// A plant shorter than the eye stand has no room for a person's eye below its crown:
				// the eye goes as low as the ground allows, under the crown rather than level with
				// it, which is where its photograph was taken.
				const eye = Math.max(0.05, base - 1.6);
				return {
					position: [foot[0] + out[0] * distance, eye, foot[2] + out[2] * distance],
					target: [foot[0], top, foot[2]],
					fov,
					near: 0.1,
				};
			}
			case 'inside': {
				// A plant with no wood keeps its stalks at the crown's own centre, so its inside photograph
				// is of the stalk bundle: the camera stands just outside it at the crown's height and
				// looks at the bundle. A woody plant is framed beside its most level great limb.
				if (!stemAt(skeleton, 1.3)) {
					const middle = Math.max(0.05, 0.45 * main.crown.top);
					plainSubjects.set(view, {
						kind: 'the stalk bundle at the crown',
						warning: 'the plant has no wood, so the inside view frames its own crown',
					});
					return orbit(
						add(foot, [0, middle, 0]),
						QUERY.distance ?? Math.max(0.3, 1.6 * main.crown.radius),
						e,
						turn,
						fov,
					);
				}
				// Beside the most level great limb, under it, looking up along it into the crown.
				const found = closeAt(view, () => insideView(closePlant(false), lens), turn, fov, 0.05);
				if (found) return found;
				if (limb < 0) break;
				plainSubjects.set(view, {
					kind: 'the largest limb, looking along it',
					warning: 'no great limb crosses the frame clear from inside the crown',
				});
				const at = pointAlong(skeleton, limb, 0.4);
				const side = normalize(cross(at.direction, [0, 1, 0]));
				const position = add(at.at, scale(side, at.radius * 2 + 0.3));
				const level = yaw(normalize([at.direction[0], 0, at.direction[2]]), turn);
				const look = add(scale(level, Math.cos(e * DEG)), [0, Math.sin(e * DEG), 0]);
				return { position, target: add(position, look), fov, near: 0.05 };
			}
			case 'junction': {
				// A great limb leaving the stem, seen side on from where no other limb hides it.
				const found = closeAt(
					view,
					() => junctionView(closePlant(WOOD_ONLY), lens),
					turn,
					fov,
					0.05,
				);
				if (found) return found;
				// A tuft whose crown axis leaves no main stem has no limb to stand at. Its picture is
				// its crown's foot, where the sheaths that the row judges stand.
				if (record.growth.model === 'tuft' && departures(skeleton).limbs.length === 0) {
					const aim = Math.max(0.05, 0.06 * height);
					return orbit(
						[foot[0], aim, foot[2]],
						QUERY.distance ?? Math.max(0.3, 5 * aim),
						e,
						turn,
						fov,
					);
				}
				break;
			}
			case 'fork': {
				// A limb dividing into two, seen square to its arms against the least of the crown.
				const found = closeAt(
					view,
					() => forkView(closePlant(WOOD_ONLY), lens, QUERY.thin, QUERY.span),
					turn,
					fov,
					0.05,
				);
				if (found) return found;
				break;
			}
			case 'flowers': {
				// A ring of flowers at a crown's top: the flower sites the plant carries, framed as the
				// photograph frames the crown's top. The ring takes about three fifths of the frame's
				// width, and the crop sits a little above the ring so the stem's top fills the foot
				// rather than the height, as the pictures show it.
				const ring = flowerSites(skeleton);
				if (!ring) break;
				const fill = 0.42;
				const distance = Math.max(0.2, ring.radius / (fill * Math.tan((fov * DEG) / 2)));
				const target: V3 = [
					ring.centre[0],
					ring.centre[1] + 0.15 * Math.max(ring.radius, 0.05),
					ring.centre[2],
				];
				return orbit(target, distance, e, turn, fov);
			}
			case 'twigs': {
				// A view of the fruit goes to a fruit the plant carries rather than to a tip that
				// may stand bare; without fruit, or with none this season, it goes to a sunlit tip.
				if (QUERY.fruit) {
					// A fruit must hang where the picture shows what holds it, so the view takes the
					// fruit that faces the camera: the outermost one on the crown, where the stalk
					// and its twig stand clear of the leaves. A fruit inside the crown has leaves
					// between the lens and its join, whatever its height.
					const fruits: V3[] = [];
					const leaves: V3[] = [];
					for (const part of main.levels[0]?.parts ?? []) {
						if (part.name !== 'extras' && part.name !== 'foliage') continue;
						const p = partPositions(part, kit.box);
						const stride = part.name === 'extras' ? 24 : 16;
						const into = part.name === 'extras' ? fruits : leaves;
						for (let i = 0; i < p.length; i += 3 * stride)
							into.push([p[i] as number, p[i + 1] as number, p[i + 2] as number]);
					}
					let acorn: V3 | undefined;
					let best = Number.NEGATIVE_INFINITY;
					let behindCount = 0;
					for (const at of fruits) {
						let near = 0;
						for (const leaf of leaves)
							if (Math.hypot(leaf[0] - at[0], leaf[1] - at[1], leaf[2] - at[2]) < FRUIT_ENCLOSED)
								near++;
						const out: V3 = normalize([at[0] - foot[0], 0, at[2] - foot[2]]);
						// Foliage standing between the lens and the fruit fills the background however
						// clear the fruit's own corner is, and a picture of a fruit against leaves
						// cannot be cut out or counted as pieces. So a fruit is also measured by what
						// lies along the line the lens looks down: leaves past it, within the tube the
						// frame covers, count against it.
						let behind = 0;
						for (const leaf of leaves) {
							const dx = leaf[0] - at[0];
							const dz = leaf[2] - at[2];
							const along = dx * out[0] + dz * out[2];
							if (along < 0 || along > FRUIT_CLEAR) continue;
							const side = Math.abs(dx * out[2] - dz * out[0]);
							if (side > FRUIT_TUBE) continue;
							behind++;
						}
						const outward = Math.hypot(at[0] - foot[0], at[2] - foot[2]);
						// The fewest leaves behind the fruit wins, so the term is subtracted: the
						// highest score is the clearest way out.
						const score = -behind * 1_000_000_000 + near * 1_000_000 + outward * 100 + at[1];
						if (score > best) {
							best = score;
							acorn = at;
							behindCount = behind;
						}
					}
					if (acorn) {
						// A fruit that stands against its own foliage cannot be cut out, and its pieces
						// then count as one mass. The view says so rather than letting the figure read
						// as the plant's own.
						if (behindCount > 0)
							plainSubjects.set(view, {
								kind: 'a fruit with foliage behind it',
								warning: 'every fruit hangs against the crown, so this view cannot be cut out',
							});
						// The stalk and every acorn it carries set the frame, at the share of it the
						// reference's own close-up gives the cluster.
						const min: V3 = [...acorn];
						const max: V3 = [...acorn];
						for (const part of main.levels[0]?.parts ?? []) {
							if (part.name !== 'extras') continue;
							const p = partPositions(part, kit.box);
							for (let i = 0; i < p.length; i += 3) {
								const at: V3 = [p[i] as number, p[i + 1] as number, p[i + 2] as number];
								const apart = Math.hypot(at[0] - acorn[0], at[1] - acorn[1], at[2] - acorn[2]);
								if (apart > FRUIT_REACH) continue;
								for (let k = 0; k < 3; k++) {
									min[k] = Math.min(min[k] as number, at[k] as number);
									max[k] = Math.max(max[k] as number, at[k] as number);
								}
							}
						}
						const centre: V3 = [
							((min[0] as number) + (max[0] as number)) / 2,
							((min[1] as number) + (max[1] as number)) / 2,
							((min[2] as number) + (max[2] as number)) / 2,
						];
						const zoom = (1 - 2 * MARGIN) / FRUIT_SHARE;
						const box = {
							min: [
								centre[0] + ((min[0] as number) - centre[0]) * zoom,
								centre[1] + ((min[1] as number) - centre[1]) * zoom,
								centre[2] + ((min[2] as number) - centre[2]) * zoom,
							] as V3,
							max: [
								centre[0] + ((max[0] as number) - centre[0]) * zoom,
								centre[1] + ((max[1] as number) - centre[1]) * zoom,
								centre[2] + ((max[2] as number) - centre[2]) * zoom,
							] as V3,
						};
						const outward = normalize([acorn[0] - foot[0], 0, acorn[2] - foot[2]]);
						const back = Math.atan2(outward[0], outward[2]);
						// The camera looks up a little, as the reference's close-up does, so the
						// underside of the twig shows where the stalk joins it.
						const low = QUERY.elevation ?? FRUIT_ELEVATION;
						return { ...fit(box, back, low, aspect, fov), near: 0.01 };
					}
				}
				// A twig with its end clusters against a plain ground; a plant with no shoot rows takes
				// its sunlit tip on the turn's side.
				const twig = closeAt(view, () => twigView(closePlant(false), lens), turn, fov, 0.02);
				if (twig) return twig;
				const tip = sunlitTip(skeleton, out, BUD_TERMINAL);
				if (!tip) break;
				plainSubjects.set(view, {
					kind: 'a sunlit shoot tip',
					warning: 'the plant has no twig with end clusters that shows clear',
				});
				let shoot = 0.2;
				for (const prototype of mainKit.prototypes) shoot = Math.max(shoot, prototype.length);
				const target = add(tip.at, scale(tip.direction, shoot / 2));
				const outward = normalize([tip.at[0] - foot[0], 0, tip.at[2] - foot[2]]);
				const back = Math.atan2(outward[0], outward[2]);
				// The twig and its rosettes fill the frame: the reference stands a single twig against a
				// plain backdrop, so the camera sits close and the shoot's own length is not the subject.
				return { ...orbit(target, 0.28 + shoot / 4, e, back, fov), near: 0.02 };
			}
			case 'strands': {
				// A limb's hanging shoots at the crown's rim, seen level against the sky as a
				// drooping-twig photograph shows them.
				const found = closeAt(view, () => strandsView(closePlant(false), lens), turn, fov, 0.05);
				if (found) return found;
				break;
			}
			case 'limb': {
				// A plant whose limbs leave one stem as a cluster, as a saguaro's arms do, is
				// photographed as the stem's top with its limbs either side, or from between them,
				// rather than as one limb's run. The query names that composition, and the camera
				// stands on the stem at the share of its height the query gives.
				if (QUERY.composition) {
					// A limb's elbow: the node where the limb turns most sharply from its run to its
					// rise, seen across the turn with the run and the rise in frame.
					if (QUERY.composition === 'elbow') {
						const pieces = limbPieces(
							skeleton,
							QUERY.along ?? 0.5,
							QUERY.thin ?? Math.max(0.02, height * 0.02),
						);
						const piece = pieces[0];
						if (piece) {
							const first = skeleton.axes.first[piece.axis] as number;
							const last = skeleton.axes.last[piece.axis] as number;
							let at = piece.point.at as V3;
							let sharpest = 0;
							for (let n = Math.max(first + 1, 0); n < last; n++) {
								const a = nodeAt(skeleton, n - 1);
								const b = nodeAt(skeleton, n);
								const c = nodeAt(skeleton, n + 1);
								const u = normalize(sub(b, a));
								const v = normalize(sub(c, b));
								const turnAt = Math.acos(
									Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2])),
								);
								if (turnAt > sharpest) {
									sharpest = turnAt;
									at = b;
								}
							}
							const span = QUERY.span ?? Math.max(1, height * 0.15);
							const across = (span * 0.5) / (Math.tan((fov * DEG) / 2) * aspect);
							return orbit(at, across + piece.point.radius, e, turn, fov);
						}
					}
					const at = stemAt(skeleton, height * (QUERY.along ?? 0.78));
					if (at) {
						const span = QUERY.span ?? Math.max(1.5, height * 0.35);
						const across = (span * 0.5) / (Math.tan((fov * DEG) / 2) * aspect);
						// Between the limbs, the camera stands close to the stem, in the widest gap between
						// two limbs, so the picture holds the stem with one limb's turn at its edge, as a
						// photograph of the cluster's gap shows.
						const near = QUERY.composition === 'between' ? 0.45 : 1;
						const atTurn = QUERY.composition === 'between' ? (limbGapTurn(skeleton) ?? turn) : turn;
						return orbit(at.at, across * near + at.radius, e, atTurn, fov);
					}
				}
				// One branch with its side branches seen across its run, from the side where the least of
				// the plant stands in front of it; or, for the crown's outside, its lower rim seen from
				// under it, looking up past its edge.
				const framing = {
					share: QUERY.along ?? 0.6,
					thin: QUERY.thin ?? Math.max(0.005, height * 0.002),
					span: QUERY.span ?? Math.max(0.2, height * 0.02),
					lookUp: Math.max(0, -e),
				};
				const found = closeAt(
					view,
					() =>
						QUERY.surface
							? surfaceView(closePlant(false), lens, framing)
							: limbView(closePlant(false), lens, framing),
					turn,
					fov,
					0.02,
				);
				if (found) return scaledStand(found, QUERY.standScale);
				break;
			}
			case 'soil': {
				// The crown lifted from the soil: the rhizome and the roots that leave it, close enough
				// that their widths read, seen a little from above as a washed base is photographed.
				const wide = Math.max(
					(skeleton.bounds.max[0] as number) - (skeleton.bounds.min[0] as number),
					(skeleton.bounds.max[2] as number) - (skeleton.bounds.min[2] as number),
				);
				const reach = Math.max(0.1, Math.min(wide, 0.6) / 2);
				return orbit(
					[foot[0], 0.03, foot[2]],
					(reach * 0.8) / Math.tan((fov * DEG) / 2),
					e,
					turn,
					fov,
				);
			}
			case 'bark-base': {
				const r = stemAt(skeleton, 0.3)?.radius ?? 0.1;
				// The foot and its flare, with the ground it stands on. The stand-off is measured from
				// the buttressed surface, not the plain radius: on a thick bole the lobes reach nearly
				// twice the radius, and a camera inside them draws a wall of bark.
				return orbit([foot[0], 0.9, foot[2]], 1.5 + 3.5 * r, e, turn, fov);
			}
			case 'bark-mid': {
				// A bark zone of its own: the camera stands where that zone covers the wood, so the
				// surface is the one the zone's texture source shows. A slot that names a height stands
				// there instead, for a trunk whose zones are wider than the picture's frame.
				const zone = QUERY.barkZone === undefined ? undefined : record.bark?.zones[QUERY.barkZone];
				const y =
					QUERY.barkHeight ??
					(zone?.by === 'height'
						? Math.min(skeleton.height * 0.9, (zone.from + zone.to) / 2)
						: Math.min(1.5, skeleton.height * 0.3));
				// A plant with no single trunk, such as a tuft of culms, shows the thickest stem
				// surface that crosses the height the picture frames.
				const stem = stemAt(skeleton, y) ?? stemSurfaceAt(skeleton, y)?.at;
				if (!stem) break;
				const span = QUERY.span ?? 0.6;
				const surface = add(stem.at, scale(out, stem.radius));
				return orbit(surface, span / 2 / Math.tan((fov * DEG) / 2), e, turn, fov);
			}
			case 'bark-limb': {
				// The bark on a great limb shown with the limb itself, when the view asks for its girth.
				if (QUERY.girth !== undefined) {
					const girth = QUERY.girth;
					const share = QUERY.along ?? 0.3;
					const found = closeAt(
						view,
						() => barkLimbView(closePlant(WOOD_ONLY), lens, girth, share),
						turn,
						fov,
						0.02,
					);
					if (found) return found;
					plainSubjects.set(view, {
						kind: 'a point along the largest limb',
						warning: 'no great limb crosses the frame clear at the asked girth',
					});
				}
				if (limb < 0) break;
				const share = QUERY.along ?? 0.2;
				// Thin wood lies far out on a small limb, not on the thickest one: a view that asks
				// for a radius frames the limb that carries it, seen from outside the plant so that
				// no thicker limb stands between the camera and it.
				const thin = QUERY.thin;
				const axis = thin === undefined ? limb : limbNear(skeleton, share, thin);
				if (axis < 0) break;
				const at = pointAlong(skeleton, axis, share);
				const across =
					thin === undefined
						? yaw(normalize(cross([0, 1, 0], at.direction)), turn)
						: normalize([at.at[0] - foot[0], 0, at.at[2] - foot[2]]);
				const reach = QUERY.span !== undefined ? QUERY.span / 2 / Math.tan((fov * DEG) / 2) : 0.8;
				return orbit(at.at, reach + at.radius, e, Math.atan2(across[0], across[2]), fov);
			}
			case 'trunk': {
				// The bole from its foot to where it first divides, seen from a person's eye height on
				// the side where the fewest branches and leaves cross it near the asked turn; a sheet's
				// further turns walk round it from there.
				const bole = closeAt(
					view,
					() => trunkView(closePlant(WOOD_ONLY), lens, turn0),
					turn - turn0,
					fov,
					0.05,
				);
				if (bole) return scaledStand(bole, QUERY.standScale);
				break;
			}
			case 'branch':
			case 'subbranch':
			case 'cluster':
			case 'leaf-upper':
			case 'leaf-under': {
				// A span frames a part of the piece rather than the whole of it: the frame's middle
				// stands on the piece at the share the query names, halfway up by default, and the
				// span is the width it shows there.
				if (QUERY.span !== undefined && piece) {
					const part = boundsOf(piece as PlantAsset, pieceKit);
					const low = part.min[1] as number;
					const high = part.max[1] as number;
					const at = low + (high - low) * (QUERY.along ?? 0.5);
					return orbit(
						[
							((part.min[0] as number) + (part.max[0] as number)) / 2,
							at,
							((part.min[2] as number) + (part.max[2] as number)) / 2,
						],
						spanDistance(QUERY.span, fov, aspect),
						e,
						turn,
						fov,
					);
				}
				// A piece framed at the scale its photograph shows, in leaf lengths, stands on its cut:
				// the cut on the frame's lower edge, the piece running up across it and off its far edge
				// where it is longer, as a cut branch runs off its photograph. A roll lays it across.
				const oneLeaf = view === 'leaf-upper' || view === 'leaf-under';
				const length = QUERY.leafLength ?? leafLength ?? (oneLeaf ? bladeLength : undefined);
				if (QUERY.leaves !== undefined && length !== undefined) {
					const frame = leafFrame(QUERY.leaves, length, QUERY.roll ?? 0, aspect, fov);
					return {
						...orbit([0, frame.run / 2, 0], frame.distance, e, turn, fov),
						roll: frame.roll,
						near: 0.01,
					};
				}
				// A cutting fills the frame with its own points, as its reference's piece does, on the
				// rows its reference shows it on when the query measured them.
				return fitPoints(piece as PlantAsset, pieceKit, turn, e, aspect, fov, CUT_ROWS);
			}
			case 'panels':
				break;
		}
		notes.push(`the plant has no part for the ${view} view, so it shows the whole plant`);
		plainSubjects.set(view, {
			kind: 'the whole plant',
			warning: `the plant has no part for the ${view} view`,
		});
		return fit(bounds, turn, e, aspect, fov);
	};

	const cells: Cell[] = [];
	if (VIEW === 'panels') {
		// The per-species picture: the whole plant at a turn of 30, a crown close-up, the cluster
		// cutting standing away from the plant, and the bark at mid-trunk.
		const quarter = 1;
		cells.push({
			turn: 30 * DEG,
			rect: rect(0),
			view: viewAt('whole', 30 * DEG, quarter),
			piece: 'plant',
		});
		cells.push({
			turn: turn0,
			rect: rect(1),
			view: viewAt('crown', turn0, quarter),
			piece: 'plant',
		});
		const cluster = fit(
			boundsOf(piece as PlantAsset, pieceKit),
			turn0,
			8,
			quarter,
			VIEW_SPECS.cluster.fov,
		);
		cells.push({
			turn: turn0,
			rect: rect(2),
			view: {
				...cluster,
				position: add(cluster.position, AWAY),
				target: add(cluster.target, AWAY),
			},
			piece: 'away',
		});
		cells.push({
			turn: turn0,
			rect: rect(3),
			view: viewAt('bark-mid', turn0, quarter),
			piece: 'plant',
		});
	} else {
		for (let k = 0; k < turns; k++) {
			const turn = turn0 + k * step;
			cells.push({
				turn,
				rect: rect(k),
				view: atDistance(viewAt(VIEW, turn, cellAspect)),
				piece: 'plant',
			});
		}
	}

	const cameras: Camera[] = cells.map((cell) => {
		const { position, target, roll } = cell.view;
		const span = Math.hypot(...sub(target, position));
		return scene.createPerspectiveCamera({
			fov: cell.view.fov,
			near: cell.view.near ?? Math.max(0.005, Math.min(0.5, span * 0.02)),
			far: FAR,
			position,
			...(roll ? { rotation: rolledLook(position, target, roll) } : { target }),
		});
	});
	if (cells.length === 1) scene.setActiveCamera(cameras[0] as Camera);
	else {
		// A sheet draws every cell as a view of its own. The cells draw no background, so the page's
		// own camera, whose picture lies under them, stands far from the plant and looks straight up
		// at the sky alone. The sun's shadow cascades stand where the middle cell's camera stands
		// instead, so the shadows fall on the plant that every cell sees, as each turn of a reference
		// video shows them; a release build leaves the cascades with the page's camera, and the cells
		// without shadows.
		scene.setActiveCamera(
			scene.createPerspectiveCamera({
				fov: 30,
				far: FAR,
				position: [AWAY[0] * 2, 1, 0],
				target: [AWAY[0] * 2, 100, 0.01],
			}),
		);
		// The per-species picture keeps its four panels as its own references draw them.
		if (VIEW !== 'panels')
			debug.shadowCamera(cameras[Math.floor((cells.length - 1) / 2)] as Camera);
		for (const [k, cell] of cells.entries())
			scene.createView({ camera: cameras[k] as Camera, rect: [...cell.rect] });
	}
	// The turn a reference's light is measured from. A whole plant's camera faces its turn; a close
	// view's camera stands wherever its subject shows, so its sun follows that camera and lights the
	// side its reference lights. A sheet of turns has one sun for all its cells, so it stands as the
	// reference's light stands to the sheet's middle turn: a turning reference keeps its light where
	// its camera is, and the sheet's cells stand within half the sheet's span of that.
	const first = cells[0]?.view;
	const sunTurn =
		(SPEC.whole === true || !first
			? turn0
			: Math.atan2(first.position[0] - first.target[0], first.position[2] - first.target[2])) +
		((turns - 1) / 2) * step;
	/** A sun placed for a rolled camera turns with it, so it lights the side of the picture it should. */
	const sunRolled = (direction: V3): V3 =>
		first?.roll
			? turnedAbout(direction, normalize(sub(first.target, first.position)), first.roll)
			: direction;

	// The background, the meadow and the light.
	const colours = BACKGROUND_COLOURS[BACKGROUND];
	scene.setBackground(MATTE ? '#ffffff' : (QUERY.sky ?? colours.sky));
	const groundColour = QUERY.ground ?? colours.ground;
	if (groundColour && !MATTE && !SPEC.cutting && !QUERY.lifted) {
		// The meadow is unlit and casts nothing back, so it shows its measured colour everywhere and a
		// mask can tell it from the plant by colour alone.
		scene.createMesh({
			mesh: geometry.plane({ width: 8000, height: 8000 }),
			material: materials.unlit({ color: groundColour }),
			rotation: FLAT,
		});
	}
	if (MATTE && SPEC.whole && !SPEC.cutting && !QUERY.lifted) {
		// A whole plant's matte stands on a white ground, so what grows below the ground, such as the
		// buried part of a root flare, stays hidden as the meadow hides it in the picture.
		scene.createMesh({
			mesh: geometry.plane({ width: 8000, height: 8000 }),
			material: materials.unlit({ color: '#ffffff' }),
			rotation: FLAT,
		});
	}
	if (VIEW === 'panels' && !MATTE) {
		// The studio's grey behind the cluster cutting, facing its camera.
		const half = turn0 / 2;
		scene.createMesh({
			mesh: geometry.plane({ width: 40, height: 40 }),
			material: materials.unlit({ color: BACKGROUND_COLOURS['studio-grey'].sky }),
			position: add(AWAY, scale(facing(turn0), -3)),
			rotation: [0, Math.sin(half), 0, Math.cos(half)],
		});
	}
	if (!MATTE) {
		const reach = Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]);
		const shadow = { distance: Math.max(20, height * 2.5 + reach * 2), contactDistance: 0.4 };
		const sunFrom = (azimuth: number, rise: number): V3 => {
			const e = rise * DEG;
			return scale(add(scale(facing(azimuth), Math.cos(e)), [0, Math.sin(e), 0]), -1);
		};
		if (SUN === 'albedo') {
			// A copy stand's light: two lamps either side of the camera at the stand's angle, at the
			// strength that a diffuse surface turned to the camera shows its own reflectance. A glossy
			// face square to the lens then throws each lamp's glare away from it, as a copy stand's
			// lamps are set to do, and no light reaches its back to pass through. The lamps follow the
			// view, so a turned view stays lit.
			const shot = cells[0]?.view;
			const ahead = shot ? normalize(sub(shot.target, shot.position)) : ([0, 0, -1] as V3);
			// The lamps stand either side of the lens across the frame, or across x for a view straight
			// up or down.
			const level = cross(ahead, [0, 1, 0]);
			const across: V3 =
				Math.hypot(level[0], level[1], level[2]) > 1e-6 ? normalize(level) : [1, 0, 0];
			// A copy stand's lamps, coloured as their photograph's own white balance has them.
			const lamp = QUERY.lamp ?? '#ffffff';
			const lean = COPY_STAND_LAMP * DEG;
			// The stand's exposure, which a photograph's own sets: one lamp pair shows a diffuse face at
			// its reflectance, and a query's daylight copies a picture taken brighter or dimmer.
			const exposure = QUERY.daylight ?? 1;
			for (const side of [-1, 1])
				scene.createDirectionalLight({
					direction: normalize(
						add(scale(ahead, Math.cos(lean)), scale(across, side * Math.sin(lean))),
					),
					color: lamp,
					intensity: (Math.PI / (2 * Math.cos(lean))) * exposure,
				});
		} else if (SUN === 'flat' && REFERENCE_LIGHT === null) {
			// A studio's fill: an even light from every side rather than a sun, at the strength and the
			// colour its reference measures, so a studio picture is matched as a daylight one is.
			const fill = QUERY.daylight ?? 1;
			const studio = BACKGROUND === 'studio-grey';
			const lamp = QUERY.lamp ?? '#ffffff';
			scene.createAmbientLight({ intensity: fill });
			scene.createHemisphereLight({
				skyColor: tinted(studio ? '#f1ede6' : '#eef1f4', lamp),
				groundColor: tinted(studio ? '#c8c2b6' : '#b9b9b4', lamp),
				intensity: 1.5 * fill,
			});
		} else {
			// Soft daylight: most of the light from the whole sky, with a sun that gives the crown its
			// depth, and a little light from below for the undersides. A query's daylight scales the sum
			// of the sky and the sun, and its sky share splits that sum between them. The light from
			// below is what the ground throws back, so it grows with the daylight too.
			const skyLight = 0.6 + 1.7;
			const sunLight = 1.9;
			const strength = QUERY.daylight ?? 1;
			const share = QUERY.skyShare;
			const total = (skyLight + sunLight) * strength;
			const skyScale = share === undefined ? strength : (share * total) / skyLight;
			const sunScale = share === undefined ? strength : ((1 - share) * total) / sunLight;
			// The fill's colour is the photograph's own white balance, which tints the sky it saw. A
			// studio's own walls and paper are the base under it, warmer than an open sky's blue.
			const studio = BACKGROUND === 'studio-grey';
			const lamp = QUERY.lamp ?? '#ffffff';
			scene.createAmbientLight({ intensity: 0.6 * skyScale });
			scene.createHemisphereLight({
				skyColor: tinted(studio ? '#f2eee7' : '#dfe8f0', lamp),
				groundColor: tinted(studio ? '#c9c3b7' : '#7f8166', lamp),
				intensity: 1.7 * skyScale,
			});
			// The reference's own light when it gave one: the sun stands that far to the camera's
			// right and that high, so the crown is lit and shadowed as its reference's is.
			const direction: V3 =
				REFERENCE_LIGHT !== null
					? sunRolled(sunFrom(sunTurn + REFERENCE_LIGHT[0], REFERENCE_LIGHT[1]))
					: SUN === 'low'
						? sunFrom(turn0 + 0.7, 12)
						: SUN === 'back'
							? sunFrom(turn0 + Math.PI, 35)
							: SUN === 'overhead'
								? [0.02, -1, 0.01]
								: [-0.45, -1, -0.35];
			// The sun takes the photograph's own white balance too, so a picture lit by a warm or a
			// cool sun can be matched where its fill alone cannot reach.
			scene.createDirectionalLight({
				direction,
				color: tinted('#ffffff', lamp),
				intensity: sunLight * sunScale,
				castShadows: true,
				shadow,
			});
			scene.createDirectionalLight({ direction: [0.35, 1, 0.3], intensity: 0.45 * strength });
		}
	}

	// The plant, through the plant core's own placement.
	const wind: Wind | undefined =
		(QUERY.wind ?? 0) > 0
			? createWind(ctx, {
					camera: cameras[0] as Camera,
					box: 96,
					grid: 64,
					air: { speed: 4 * (QUERY.wind as number) },
				})
			: undefined;
	// A stand-in kit's matte is plain black materials; a real kit's is the plant shader's own, which
	// keeps its quantised parts, cut-outs and sway. The review frames one plant with a camera of its
	// own, so the sway reach follows that camera's distance: four times the distance keeps every
	// vertex of the framed plant inside the fade, whatever the governor's live preset is. A slot may
	// name a shorter reach to show the fade itself.
	const windCamera = cells[0]?.view.position ?? [0, 0, 0];
	const swayReach = Math.hypot(windCamera[0], windCamera[1], windCamera[2]) * 4;
	const plantLook =
		MATTE && kit.placeholders === true
			? matteMaterials(ctx, kit)
			: plantMaterials(ctx, kit, {
					...(wind && {
						wind: wind.field,
						swayDistance: QUERY.sway ?? swayReach,
					}),
					matte: MATTE,
				});
	// A stand-in kit draws through the stand-in near pool. A real kit's one plant stands at a fixed
	// place, so its placement composes its shoot rows once, with no pool.
	const near: NearPool | undefined =
		placeholders === true && (LOD === undefined || LOD === 0)
			? createNearPool(ctx, { placeholders: true })
			: undefined;
	const place = (asset: PlantAsset, at: V3, source: SpeciesKit, far?: readonly FarPlant[]) =>
		placePlants(
			ctx,
			source,
			[asset],
			{
				count: 1,
				position: new Float32Array(at),
				turn: new Float32Array([0]),
				scale: new Float32Array([1]),
				variant: new Uint8Array([0]),
			},
			{
				materials: plantLook,
				...(near && { near }),
				...(far && { far }),
				// A forced nearest level draws its real shoots at every distance: the bias moves the
				// shoots' switch past every camera's far plane. A cut piece takes the nearest level
				// too: it has no card levels, so a sheet's smaller cells would switch its foliage to
				// cards that hold nothing, and the piece would vanish.
				view: {
					height: SIZE[1] / rows,
					fov: FOV,
					...((LOD === 0 || SPEC.cutting !== undefined) && { switchBias: -FORCED_NEAR_STOPS }),
				},
				castShadows: !MATTE,
			},
		);
	const drawn = shaped(main, WOOD_ONLY);
	const far = LOD === 3 && whole ? [await bakeFarPlant(kit, whole)] : undefined;
	place(drawn, [0, 0, 0], mainKit, far);
	if (VIEW === 'panels' && piece) place(shaped(piece, false), AWAY, pieceKit);
	if (
		!WOOD_ONLY &&
		(LOD === undefined || LOD === 0) &&
		main.levels[0].parts.every((part) => part.name === 'wood') &&
		main.shoots.count > 0 &&
		placeholders === true
	)
		notes.push('the stand-in near pool draws no shoots, so the nearest level shows wood and cards');

	if (QUERY.scale) {
		// A 1 m bar of ten alternating tenths, upright beside the first view's target.
		const view = (cells[0] as Cell).view;
		const forward = normalize(sub(view.target, view.position));
		const right = normalize(cross(forward, [0, 1, 0]));
		const span = Math.hypot(...sub(view.target, view.position));
		const across = span * Math.tan((view.fov * DEG) / 2) * cellAspect * 0.7;
		const base = add(add(view.target, scale(right, across)), [0, -0.5, 0]);
		const black = materials.unlit({ color: '#111111' });
		const white = materials.unlit({ color: '#f4f4f4' });
		const width = Math.max(0.005, Math.min(0.05, span * 0.01));
		for (let k = 0; k < 10; k++)
			scene.createMesh({
				mesh: geometry.box({ width, height: 0.1, depth: width }),
				material: k % 2 === 0 ? black : white,
				position: add(base, [0, 0.05 + k * 0.1, 0]),
			});
	}

	// A close view tells its subject's shoots by the wind record they share with their axis.
	const shared = closeViews.size > 0 ? sharedRecords(skeleton) : 0;
	if (shared > 0)
		notes.push(
			`${shared} wind records are shared by several axes, so the close view counts the shoots on them as no subject's own`,
		);
	const trunk = stemAt(skeleton, 1.3);
	const close = closeViews.get(VIEW);
	const subject = close
		? { ...close.subject, ...(close.clutter && { clutter: close.clutter }) }
		: plainSubjects.get(VIEW);
	// The plant as the view draws it: the level's filled silhouette, not every level's part bounds,
	// so a vertex or a part outside the drawn cells cannot inflate the posted width and height.
	const drawnBox = cells[0] ? measurePlant(main, kit.box, cells[0].turn).plantBox : null;
	// A cut piece is drawn from its own kit, and its posted size is the box its own level draws, not
	// the union of every part's bounds.
	const pieceTurn = cells.find((cell) => cell.piece === 'away')?.turn ?? cells[0]?.turn ?? 0;
	const pieceBox = piece ? measurePlant(piece, pieceKit.box, pieceTurn).plantBox : null;
	facts = {
		species: record.id,
		name: record.name,
		form: form ?? null,
		standIn: !isSpeciesId(QUERY.species),
		placeholders,
		view: VIEW,
		background: MATTE ? 'matte' : BACKGROUND,
		sun: MATTE ? 'none' : SUN,
		size: SIZE,
		grid: [columns, rows],
		plant: {
			height: drawnBox ? drawnBox.top : height,
			width: drawnBox ? drawnBox.width : bounds.max[0] - bounds.min[0],
			depth: bounds.max[2] - bounds.min[2],
			crownBase: main.crown.base,
			trunkRadius: trunk?.radius ?? null,
			limbs: skeleton.axes.count,
			triangles: main.levels.map((level) => level.triangles),
		},
		...(piece && {
			cutting: {
				...piece.cutting,
				size: (() => {
					const b = boundsOf(piece, pieceKit);
					return pieceBox
						? [pieceBox.width, pieceBox.top, (b.max[2] as number) - (b.min[2] as number)]
						: sub(b.max, b.min);
				})(),
				axes: piece.skeleton.axes.count,
			},
		}),
		...(limb >= 0 && { limb: { axis: limb, nodes: chainOf(skeleton, limb).length } }),
		elevation,
		cells: cells.map((cell) => ({
			turn: cell.turn / DEG,
			rect: cell.rect,
			camera: {
				position: cell.view.position,
				target: cell.view.target,
				fov: cell.view.fov,
				...(cell.view.roll && { roll: cell.view.roll / DEG }),
			},
			...(QUERY.measure && {
				measure: measurePlant(cell.piece === 'away' && piece ? piece : main, kit.box, cell.turn),
			}),
		})),
		...(QUERY.time !== undefined && { time: QUERY.time }),
		...(subject && { subject }),
		notes,
	};
	page.post('plant-review', facts);

	// A stand-in's matte materials take no wind.
	const windMaterials = MATTE && kit.placeholders === true ? [] : Object.values(plantLook);
	if (!wind && !near) return {};
	return {
		onUpdate() {
			near?.update();
			if (wind) {
				wind.update();
				if (windMaterials.length > 0) setWindLayer(windMaterials, wind.field);
			}
		},
	};
});
