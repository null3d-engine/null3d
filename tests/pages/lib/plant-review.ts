// The query contract of the plant review page: the names it reads, the views it draws, the
// backgrounds it stands a plant against, and the camera that a framing in screen shares asks for.
// The page and the review tools in tools/plant-review share this file, so a tool that builds a
// query and the page that reads it agree on every name. Nothing here knows how a plant grows.

/** The views that the page draws. */
export const PLANT_VIEWS = [
	'whole',
	'crown',
	'below',
	'inside',
	'skeleton',
	'silhouette',
	'trunk',
	'bark-base',
	'bark-mid',
	'bark-limb',
	'leaf-upper',
	'leaf-under',
	'branch',
	'subbranch',
	'cluster',
] as const;

/** One view of the page. */
export type PlantView = (typeof PLANT_VIEWS)[number];

/** The views that frame the whole plant, which a framing in screen shares can place. */
export const WHOLE_VIEWS: readonly PlantView[] = ['whole', 'skeleton', 'silhouette'];

/** The views that draw a cut piece of the plant: a branch, a sub-branch or a leaf cluster. */
export const CUTTING_VIEWS: readonly PlantView[] = ['branch', 'subbranch', 'cluster'];

/** The backgrounds that a plant stands against. */
export const PLANT_BACKGROUNDS = ['sky-meadow', 'studio-grey', 'white'] as const;

/** One background of the page. */
export type PlantBackground = (typeof PLANT_BACKGROUNDS)[number];

/**
 * The colours of each background, as sRGB hex: the medians of the reference corpus's plain
 * backgrounds, measured by the review tools' mask. The sky and meadow are those of the whole-plant
 * stills; the turning videos stand in a paler, greyer sky, about #ced3d2 over #918d5e, which a
 * run matched to a video passes as `sky` and `ground`. The grey is the studio stills' seamless
 * backdrop and the white the single-leaf stills'.
 */
export const BACKGROUND_COLOURS: Readonly<
	Record<PlantBackground, { readonly sky: string; readonly ground?: string }>
> = {
	'sky-meadow': { sky: '#c5d8ef', ground: '#9e9b62' },
	'studio-grey': { sky: '#cccdd1' },
	white: { sky: '#fefefe' },
};

/** The background a view stands against when the query names none. */
export function defaultBackground(view: PlantView): PlantBackground {
	if (view === 'leaf-upper' || view === 'leaf-under' || view === 'silhouette') return 'white';
	if (CUTTING_VIEWS.includes(view)) return 'studio-grey';
	return 'sky-meadow';
}

/** The vertical field of view, in degrees, that a view takes when the query names none. */
export function defaultFov(view: PlantView): number {
	switch (view) {
		case 'below':
			return 60;
		case 'inside':
			return 70;
		case 'crown':
			return 44;
		case 'trunk':
		case 'bark-mid':
		case 'leaf-upper':
		case 'leaf-under':
			return 34;
		case 'bark-base':
		case 'bark-limb':
		case 'branch':
		case 'subbranch':
		case 'cluster':
			return 40;
		default:
			return 30;
	}
}

/**
 * Everything the page reads from its query. Leave a field out for the view's own default.
 * Shares count across the frame from its left edge and down from its top edge, from 0 to 1.
 */
export interface PlantReviewQuery {
	/** A review species' id, such as `review-oak`, or its index in the review list. */
	readonly species: string;
	/** The variant's index, from 0. */
	readonly variant?: number;
	/** The scene's seed. */
	readonly seed?: number;
	/** The view to draw. The default is `whole`. */
	readonly view?: PlantView;
	/** Degrees the camera walks round the plant's vertical axis, anticlockwise seen from above. */
	readonly turn?: number;
	/**
	 * Degrees the camera stands above the view's target, seen from the target: negative looks up
	 * from below. For a whole-plant view it replaces the stand framing with an orbit.
	 */
	readonly elevation?: number;
	/** A multiple of the view's fitted distance. The default is 1. */
	readonly distance?: number;
	/** The vertical field of view in degrees. */
	readonly fov?: number;
	/** The output's width over its height, so the page frames for the picture it is drawn into. */
	readonly aspect?: number;
	/** What the plant stands against. */
	readonly background?: PlantBackground;
	/** The sky's or the plain background's colour, as sRGB hex, in place of the background's own. */
	readonly sky?: string;
	/** The meadow's colour, as sRGB hex, in place of the background's own. */
	readonly ground?: string;
	/** Whether the plant moves in the wind. A still holds still. */
	readonly wind?: boolean;
	/**
	 * Whether to draw the view as a matte: the plant black on white with no light and no ground, so
	 * a tool reads the plant's exact outline from the same camera. The silhouette view is a matte.
	 */
	readonly matte?: boolean;
	/** The row share of the horizon, which sets the camera's pitch with the field of view. */
	readonly horizon?: number;
	/** The share of the frame's height that the plant's height fills. */
	readonly fill?: number;
	/** The row share where the middle of the plant's height sits. */
	readonly targetY?: number;
	/** The column share where the plant's axis sits. */
	readonly targetX?: number;
	/** The row share of the plant's top, for a frame whose plant base is cut off: give `eye` too. */
	readonly top?: number;
	/** The camera's height above the ground in metres, with `top`, when the base is out of frame. */
	readonly eye?: number;
	/** How far along a limb the limb view looks, as a share of the limb's length. */
	readonly along?: number;
}

/** The query fields that are numbers, in the order a query lists them. */
const NUMBER_FIELDS = [
	'variant',
	'seed',
	'turn',
	'elevation',
	'distance',
	'fov',
	'aspect',
	'horizon',
	'fill',
	'targetY',
	'targetX',
	'top',
	'eye',
	'along',
] as const;

/** The fields that are shares of the frame, which must lie from 0 to 1. */
const SHARE_FIELDS = new Set(['horizon', 'fill', 'targetY', 'targetX', 'top', 'along']);

/** A short form of a number for a query, so a query reads well and keeps its precision. */
function short(value: number): string {
	return String(Number(value.toFixed(5)));
}

/** The query string that asks the page for a picture. */
export function plantReviewQuery(query: PlantReviewQuery): string {
	const params = new URLSearchParams({ species: query.species });
	if (query.view) params.set('view', query.view);
	for (const name of NUMBER_FIELDS) {
		const value = query[name];
		if (value !== undefined) params.set(name, short(value));
	}
	if (query.background) params.set('background', query.background);
	if (query.sky) params.set('sky', query.sky);
	if (query.ground) params.set('ground', query.ground);
	if (query.wind) params.set('wind', '1');
	if (query.matte) params.set('matte', '1');
	return params.toString();
}

/** Reads the page's query, and throws with the fix for a name or a value the page does not take. */
export function readPlantReviewQuery(params: URLSearchParams): PlantReviewQuery {
	const view = (params.get('view') ?? 'whole') as PlantView;
	if (!PLANT_VIEWS.includes(view))
		throw new Error(`view=${view} is not a review view: use one of ${PLANT_VIEWS.join(', ')}.`);
	const background = params.get('background') as PlantBackground | null;
	if (background !== null && !PLANT_BACKGROUNDS.includes(background))
		throw new Error(
			`background=${background} is not a review background: use one of ${PLANT_BACKGROUNDS.join(', ')}.`,
		);
	const numbers: Partial<Record<(typeof NUMBER_FIELDS)[number], number>> = {};
	for (const name of NUMBER_FIELDS) {
		const text = params.get(name);
		if (text === null) continue;
		const value = Number(text);
		if (!Number.isFinite(value)) throw new Error(`${name}=${text} is not a number.`);
		if (SHARE_FIELDS.has(name) && (value < 0 || value > 1))
			throw new Error(`${name}=${text} is a share of the frame: give a number from 0 to 1.`);
		numbers[name] = value;
	}
	for (const name of ['sky', 'ground'] as const) {
		const text = params.get(name);
		if (text !== null && !/^#[0-9a-f]{6}$/i.test(text))
			throw new Error(`${name}=${text} is not a colour: give sRGB hex such as #c9d9e6.`);
	}
	return {
		species: params.get('species') ?? '0',
		view,
		...numbers,
		...(background ? { background } : {}),
		...(params.get('sky') ? { sky: params.get('sky') as string } : {}),
		...(params.get('ground') ? { ground: params.get('ground') as string } : {}),
		wind: params.get('wind') === '1',
		matte: params.get('matte') === '1',
	};
}

/**
 * Where a whole plant lands in the frame, in screen shares: the horizon's row, the plant's top
 * row, and either its base row or the camera's height when the base is out of frame.
 */
export interface ScreenFraming {
	/** The vertical field of view in degrees. */
	readonly fov: number;
	/** The frame's width over its height. */
	readonly aspect: number;
	/** The horizon's row share. */
	readonly horizon: number;
	/** The plant top's row share. */
	readonly top: number;
	/** The plant base's row share, where the plant meets the ground. */
	readonly base?: number;
	/** The camera's height above the ground in metres, used when `base` is absent. */
	readonly eye?: number;
	/** The column share of the plant's axis. */
	readonly targetX: number;
}

/** A camera that stands on the ground plane's normal side, at a distance from the plant's axis. */
export interface StandCamera {
	/** The horizontal distance from the plant's axis, in metres. */
	readonly distance: number;
	/** The camera's height above the ground, in metres. */
	readonly height: number;
	/** The camera's pitch in radians: positive looks up. */
	readonly pitch: number;
	/** The camera's turn away from the plant's axis in radians: positive puts the plant right. */
	readonly yaw: number;
	/** What the solve had to give up, such as a camera that would stand under the ground. */
	readonly warning?: string;
}

/** The angle in radians, up from the optical axis, of the ray through a row share. */
export function rowAngle(row: number, fov: number): number {
	const half = Math.tan((fov * Math.PI) / 360);
	return Math.atan((0.5 - row) * 2 * half);
}

/** The least height a camera stands at, in metres: one that would stand lower is raised to it. */
const LOWEST_EYE = 0.3;

/**
 * The camera that puts a plant `height` metres tall where a framing asks: the horizon's row sets
 * the pitch, and the top and base rows set the distance and the camera's height. Without a base
 * row, the camera stands at `eye` and only the top row sets the distance.
 */
export function standCamera(framing: ScreenFraming, height: number): StandCamera {
	const pitch = -rowAngle(framing.horizon, framing.fov);
	const topRay = rowAngle(framing.top, framing.fov) + pitch;
	const half = Math.tan((framing.fov * Math.PI) / 360);
	const yaw = Math.atan((framing.targetX - 0.5) * 2 * half * framing.aspect);
	// The solve works along the optical axis; a camera turned off the plant stands further back by
	// the cosine of its turn, so the plant's axis still lands on the rows asked for.
	const along = Math.cos(yaw);
	if (framing.base !== undefined) {
		const baseRay = rowAngle(framing.base, framing.fov) + pitch;
		const spread = Math.tan(topRay) - Math.tan(baseRay);
		if (spread > 1e-6) {
			const forward = height / spread;
			const eye = -forward * Math.tan(baseRay);
			if (eye >= LOWEST_EYE) return { distance: forward / along, height: eye, pitch, yaw };
		}
	}
	const eye = Math.max(LOWEST_EYE, framing.eye ?? 1.6);
	const rise = Math.tan(topRay);
	if (rise > 1e-6 && height > eye)
		return {
			distance: (height - eye) / rise / along,
			height: eye,
			pitch,
			yaw,
			...(framing.base !== undefined
				? { warning: 'the base row sits above the horizon, so the camera stands at eye height' }
				: {}),
		};
	// A top row at or under the horizon cannot hold a plant taller than the eye: stand far enough
	// back that the plant fills the frame's height at a level camera.
	return {
		distance: height / (2 * half) / along,
		height: Math.min(eye, height / 2),
		pitch,
		yaw,
		warning: 'the top row sits at or under the horizon, so the camera stands back at plant height',
	};
}

/** The row share at which a point `y` metres up the plant's axis lands for a stand camera. */
export function projectRow(camera: StandCamera, y: number, fov: number): number {
	const elevation = Math.atan2(y - camera.height, camera.distance * Math.cos(camera.yaw));
	const half = Math.tan((fov * Math.PI) / 360);
	return 0.5 - Math.tan(elevation - camera.pitch) / (2 * half);
}
