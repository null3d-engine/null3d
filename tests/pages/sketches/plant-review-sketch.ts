// One species in one review view, drawn to be laid beside its reference pictures: the whole plant
// and its turntable, the crown from outside, below and inside, a limb's junction and first fork, a
// sunlit shoot tip, a cut branch, sub-branch, leaf cluster or leaf, the bark at the base, mid-trunk
// and on a limb, the trunk, the wood alone, the silhouette, and the four panels of the per-species
// picture test. It grows the species through the plant core's public functions (any registered
// species, or any other id as a stand-in), so the page draws what a scene would draw. The query
// contract lives in `../lib/plant-review/`, which the review tools share. The page posts what it
// measured and where its cameras stood as the `plant-review` message, so a tool records the facts
// beside the pixels.
import { type Camera, defineSketch, type SketchContext } from '@null3d/engine';
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
	firstForkHeight,
	firstForkOf,
	largestLimb,
	normalize,
	pointAlong,
	stemAt,
	stemFoot,
	sunlitTip,
	type V3,
} from '../lib/plant-review/anatomy';
import { type ScreenFraming, standCamera } from '../lib/plant-review/framing';
import { measurePlant, partPositions } from '../lib/plant-review/measure';
import { readPlantReviewQuery } from '../lib/plant-review/query';
import { BACKGROUND_COLOURS, type PlantView, VIEW_SPECS } from '../lib/plant-review/views';

const QUERY = readPlantReviewQuery(new URL(import.meta.url).searchParams);
const VIEW: PlantView = QUERY.view ?? 'whole';
const SPEC = VIEW_SPECS[VIEW];
const SIZE = QUERY.size ?? SPEC.size;
const FOV = QUERY.fov ?? SPEC.fov;
const BACKGROUND = QUERY.background ?? SPEC.background;
const SUN = QUERY.sun ?? SPEC.sun;
const MATTE = VIEW === 'silhouette' || QUERY.matte === true;
const DEG = Math.PI / 180;
/** The quaternion that lays a plane, which faces +Z, flat on the ground. */
const FLAT: [number, number, number, number] = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
/** The height of a standing person's eye, in metres. */
const EYE = 1.6;
/** Where a second piece stands, far past every camera's far plane from the first. */
const AWAY: V3 = [20000, 0, 0];
/** A camera's far plane, in metres. */
const FAR = 9000;
/** The share of the frame left clear round a fitted plant. */
const MARGIN = 0.08;
/** The most cells a sheet draws: the scene's views less the camera's own. */
const MOST_CELLS = 31;

/** Where a camera stands and what it looks at. */
interface View {
	readonly position: V3;
	readonly target: V3;
	readonly fov: number;
	/** The near plane, when the view clears what stands close to the camera. */
	readonly near?: number;
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

/** Whether the query frames a whole plant in screen shares. */
const FRAMED =
	QUERY.horizon !== undefined ||
	QUERY.fill !== undefined ||
	QUERY.targetY !== undefined ||
	QUERY.targetX !== undefined ||
	QUERY.top !== undefined;

/** The asset as a view draws it: the wood alone, or one level at every distance. */
function shaped(asset: PlantAsset, woodOnly: boolean): PlantAsset {
	const keep = (parts: readonly PlantPart[]) =>
		woodOnly ? parts.filter((part) => part.name === 'wood') : parts;
	const levelAt = (index: 0 | 1 | 2, from: number, source = asset.levels[index]) => ({
		...source,
		level: index,
		parts: keep(source.parts),
		from,
	});
	const empty = { parts: [], triangles: 0, bytes: 0 };
	const lod = QUERY.lod;
	const rows =
		woodOnly || (lod !== undefined && lod !== 0) ? { ...asset.shoots, count: 0 } : asset.shoots;
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
	const { scene, geometry, materials, post, page } = ctx;
	// A review picture is laid beside a reference that carries no display curve; a tone curve
	// would crush and saturate the sky and the foliage that the reference shows as they are.
	post.set({ toneMapping: 'none' });
	const notes: string[] = [];
	const placeholders = QUERY.placeholders ?? !isSpeciesId(QUERY.species);
	const module = await loadSpeciesOrStandIn(QUERY.species);
	const record = module.record;
	const kit = await prepareSpecies(ctx, module, {
		detail: QUERY.preset ?? 'high',
		placeholders,
	});
	const grow = {
		seed: QUERY.seed ?? 11,
		variant: QUERY.variant ?? 0,
		near: true,
		...(QUERY.season && { season: QUERY.season }),
	};
	const turn0 = (QUERY.turn ?? 0) * DEG;
	const cuttingPart = VIEW === 'panels' ? 'cluster' : SPEC.cutting;
	const cutting = cuttingPart && {
		part: cuttingPart,
		...(QUERY.cut !== undefined && { length: QUERY.cut }),
		...(QUERY.pick !== undefined && { pick: QUERY.pick }),
		orient: 'upright' as const,
		...(VIEW === 'leaf-under' ? { face: 'lower' as const } : {}),
	};
	const needsWhole = !SPEC.cutting;
	const [whole, piece] = await Promise.all([
		needsWhole ? growPlant(kit, grow) : undefined,
		cutting ? growPlant(kit, { ...grow, cutting }) : undefined,
	]);
	const main = (whole ?? piece) as PlantAsset;
	const bounds = boundsOf(main, kit);
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

	/** The camera of the view at one turn, for the plant or the cut piece. */
	const viewAt = (view: PlantView, turn: number, aspect: number): View => {
		const spec = VIEW_SPECS[view];
		const e = QUERY.elevation ?? spec.elevation;
		const fov = QUERY.fov ?? spec.fov;
		const out = facing(turn);
		switch (view) {
			case 'turntable':
			case 'whole':
			case 'skeleton':
			case 'silhouette':
				return FRAMED ? standView(height, foot, turn, aspect) : fit(bounds, turn, e, aspect, fov);
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
				const surface = add(add(foot, scale(out, reach)), [0, middle, 0]);
				return orbit(surface, Math.max(0.5, 0.6 * main.crown.radius), e, turn, fov);
			}
			case 'below': {
				const r = stemAt(skeleton, 1)?.radius ?? 0.1;
				const eye = Math.max(0.3, Math.min(EYE, main.crown.base * 0.8 || EYE));
				const position = add(add(foot, scale(out, r + 0.8)), [0, eye, 0]);
				const look = add(scale(out, -Math.cos(e * DEG)), [0, Math.sin(e * DEG), 0]);
				return { position, target: add(position, look), fov, near: 0.1 };
			}
			case 'inside': {
				if (limb < 0) break;
				const at = pointAlong(skeleton, limb, 0.4);
				const side = normalize(cross(at.direction, [0, 1, 0]));
				const position = add(at.at, scale(side, at.radius * 2 + 0.3));
				const level = yaw(normalize([at.direction[0], 0, at.direction[2]]), turn);
				const look = add(scale(level, Math.cos(e * DEG)), [0, Math.sin(e * DEG), 0]);
				return { position, target: add(position, look), fov, near: 0.05 };
			}
			case 'junction':
			case 'fork': {
				if (limb < 0) break;
				const at =
					view === 'fork'
						? (firstForkOf(skeleton, limb) ?? pointAlong(skeleton, limb, 0.5))
						: pointAlong(skeleton, limb, 0);
				const across = yaw(normalize(cross([0, 1, 0], at.direction)), turn);
				const reach = (view === 'fork' ? 1 : 1.5) + at.radius;
				const back = Math.atan2(across[0], across[2]);
				return orbit(at.at, reach, e, back, fov);
			}
			case 'twigs': {
				const tip = sunlitTip(skeleton, out, BUD_TERMINAL);
				if (!tip) break;
				let shoot = 0.2;
				for (const prototype of kit.prototypes) shoot = Math.max(shoot, prototype.length);
				const target = add(tip.at, scale(tip.direction, shoot / 2));
				const outward = normalize([tip.at[0] - foot[0], 0, tip.at[2] - foot[2]]);
				const back = Math.atan2(outward[0], outward[2]);
				return { ...orbit(target, 0.5 + shoot / 2, e, back, fov), near: 0.02 };
			}
			case 'bark-base': {
				const r = stemAt(skeleton, 0.3)?.radius ?? 0.1;
				return orbit([foot[0], Math.max(0.2, r), foot[2]], 1.5 + r, e, turn, fov);
			}
			case 'bark-mid': {
				const y = Math.min(1.5, skeleton.height * 0.3);
				const stem = stemAt(skeleton, y);
				if (!stem) break;
				const span = QUERY.span ?? 0.6;
				const surface = add(stem.at, scale(out, stem.radius));
				return orbit(surface, span / 2 / Math.tan((fov * DEG) / 2), e, turn, fov);
			}
			case 'bark-limb': {
				if (limb < 0) break;
				const at = pointAlong(skeleton, limb, QUERY.along ?? 0.2);
				const across = yaw(normalize(cross([0, 1, 0], at.direction)), turn);
				const reach = QUERY.span !== undefined ? QUERY.span / 2 / Math.tan((fov * DEG) / 2) : 0.8;
				return orbit(at.at, reach + at.radius, e, Math.atan2(across[0], across[2]), fov);
			}
			case 'trunk': {
				const fork = firstForkHeight(skeleton) ?? Math.max(main.crown.base, height * 0.3);
				const span = Math.max(1, fork * 1.1);
				const r = stemAt(skeleton, 0.3)?.radius ?? 0.1;
				const distance = span / 2 / Math.tan((fov * DEG) / 2) / (1 - 2 * MARGIN) + r;
				return orbit([foot[0], fork / 2, foot[2]], distance, e, turn, fov);
			}
			case 'branch':
			case 'subbranch':
			case 'cluster':
			case 'leaf-upper':
			case 'leaf-under':
				return fit(boundsOf(piece as PlantAsset, kit), turn, e, aspect, fov);
			case 'panels':
				break;
		}
		notes.push(`the plant has no part for the ${view} view, so it shows the whole plant`);
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
			boundsOf(piece as PlantAsset, kit),
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
		const span = Math.hypot(...sub(cell.view.target, cell.view.position));
		return scene.createPerspectiveCamera({
			fov: cell.view.fov,
			near: cell.view.near ?? Math.max(0.005, Math.min(0.5, span * 0.02)),
			far: FAR,
			position: cell.view.position,
			target: cell.view.target,
		});
	});
	if (cells.length === 1) scene.setActiveCamera(cameras[0] as Camera);
	else {
		// A sheet draws every cell as a view of its own. The cells draw no background, so the page's
		// own camera, whose picture lies under them, stands far from the plant and looks straight up
		// at the sky alone. The sun's shadows follow that camera, so a sheet's cells have none.
		scene.setActiveCamera(
			scene.createPerspectiveCamera({
				fov: 30,
				far: FAR,
				position: [AWAY[0] * 2, 1, 0],
				target: [AWAY[0] * 2, 100, 0.01],
			}),
		);
		for (const [k, cell] of cells.entries())
			scene.createView({ camera: cameras[k] as Camera, rect: [...cell.rect] });
	}

	// The background, the meadow and the light.
	const colours = BACKGROUND_COLOURS[BACKGROUND];
	scene.setBackground(MATTE ? '#ffffff' : (QUERY.sky ?? colours.sky));
	const groundColour = QUERY.ground ?? colours.ground;
	if (groundColour && !MATTE && !SPEC.cutting) {
		// The meadow is unlit and casts nothing back, so it shows its measured colour everywhere and a
		// mask can tell it from the plant by colour alone.
		scene.createMesh({
			mesh: geometry.plane({ width: 8000, height: 8000 }),
			material: materials.unlit({ color: groundColour }),
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
		if (SUN === 'flat') {
			scene.createAmbientLight({ intensity: 1 });
			scene.createHemisphereLight({ skyColor: '#eef1f4', groundColor: '#b9b9b4', intensity: 1.5 });
		} else {
			// Soft daylight: most of the light from the whole sky, with a sun that gives the crown its
			// depth, and a little light from below for the undersides.
			scene.createAmbientLight({ intensity: 0.6 });
			scene.createHemisphereLight({ skyColor: '#dfe8f0', groundColor: '#7f8166', intensity: 1.7 });
			const direction: V3 =
				SUN === 'low'
					? sunFrom(turn0 + 0.7, 12)
					: SUN === 'back'
						? sunFrom(turn0 + Math.PI, 35)
						: SUN === 'overhead'
							? [0.02, -1, 0.01]
							: [-0.45, -1, -0.35];
			scene.createDirectionalLight({ direction, intensity: 1.9, castShadows: true, shadow });
			scene.createDirectionalLight({ direction: [0.35, 1, 0.3], intensity: 0.45 });
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
	const plantLook = MATTE
		? matteMaterials(ctx, kit)
		: plantMaterials(ctx, kit, wind ? { wind: wind.field } : undefined);
	let near: NearPool | undefined;
	if (QUERY.lod === undefined || QUERY.lod === 0) {
		try {
			near = createNearPool(ctx, { placeholders });
		} catch (error) {
			notes.push(`no near pool: ${(error as Error).message}`);
		}
	}
	const place = (asset: PlantAsset, at: V3, far?: readonly FarPlant[]) =>
		placePlants(
			ctx,
			kit,
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
				view: { height: SIZE[1] / rows, fov: FOV },
				castShadows: !MATTE,
			},
		);
	const drawn = shaped(main, SPEC.woodOnly === true);
	const far = QUERY.lod === 3 && whole ? [await bakeFarPlant(kit, whole)] : undefined;
	place(drawn, [0, 0, 0], far);
	if (VIEW === 'panels' && piece) place(shaped(piece, false), AWAY);
	if (
		!SPEC.woodOnly &&
		(QUERY.lod === undefined || QUERY.lod === 0) &&
		main.levels[0].parts.every((part) => part.name === 'wood') &&
		main.shoots.count > 0 &&
		placeholders
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

	const trunk = stemAt(skeleton, 1.3);
	facts = {
		species: record.id,
		name: record.name,
		standIn: !isSpeciesId(QUERY.species),
		placeholders,
		view: VIEW,
		background: MATTE ? 'matte' : BACKGROUND,
		sun: MATTE ? 'none' : SUN,
		size: SIZE,
		grid: [columns, rows],
		plant: {
			height,
			width: bounds.max[0] - bounds.min[0],
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
					const b = boundsOf(piece, kit);
					return sub(b.max, b.min);
				})(),
				axes: piece.skeleton.axes.count,
			},
		}),
		...(limb >= 0 && { limb: { axis: limb, nodes: chainOf(skeleton, limb).length } }),
		elevation,
		cells: cells.map((cell) => ({
			turn: cell.turn / DEG,
			rect: cell.rect,
			camera: { position: cell.view.position, target: cell.view.target, fov: cell.view.fov },
			...(QUERY.measure && {
				measure: measurePlant(cell.piece === 'away' && piece ? piece : main, kit.box, cell.turn),
			}),
		})),
		...(QUERY.time !== undefined && { time: QUERY.time }),
		notes,
	};
	page.post('plant-review', facts);

	// A matte's plain materials take no wind.
	const windMaterials = MATTE ? [] : Object.values(plantLook);
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
