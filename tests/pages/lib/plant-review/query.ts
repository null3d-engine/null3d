// The query contract of the plant review page: the names it reads and the values each takes. The
// page and the review tools share this file, so a tool that builds a query and the page that reads
// it agree on every name. Nothing here knows how a plant grows.
import {
	PLANT_BACKGROUNDS,
	PLANT_SUNS,
	PLANT_VIEWS,
	type PlantBackground,
	type PlantSun,
	type PlantView,
} from './views';

/** The seasons a plant grows for. */
export const PLANT_SEASONS = ['summer', 'autumn', 'winter', 'blossom'] as const;

/** The quality presets, which set the mesh tier. */
export const PLANT_PRESETS = ['low', 'medium', 'high', 'ultra'] as const;

/** The level a query forces: the nearest level, the two card levels, or the impostor. */
export type ForcedLevel = 0 | 1 | 2 | 3;

/**
 * Everything the page reads from its query. Leave a field out for the view's own default.
 * Shares count across the frame from its left edge and down from its top edge, from 0 to 1.
 */
export interface PlantReviewQuery {
	/** A species id: a registered species, or any other id, which draws as a stand-in. */
	readonly species: string;
	/** The variant's index, from 0. */
	readonly variant?: number;
	/** The scene's seed; 11 by default. */
	readonly seed?: number;
	/** The view to draw; `whole` by default. */
	readonly view?: PlantView;
	/** Degrees the camera walks round the plant's vertical axis; 0 looks from +Z. */
	readonly turn?: number;
	/** Degrees the camera stands above the view's target, seen from the target. */
	readonly elevation?: number;
	/** Metres from the camera to the view's target, in place of the distance the view fits. */
	readonly distance?: number;
	/** The vertical field of view in degrees. */
	readonly fov?: number;
	/** What the plant stands against. */
	readonly background?: PlantBackground;
	/** The sky's or the plain background's colour, as sRGB hex, in place of the background's own. */
	readonly sky?: string;
	/** The meadow's colour, as sRGB hex, in place of the background's own. */
	readonly ground?: string;
	/** The wind's strength: 0 still, 1 the default field, up to 3. */
	readonly wind?: number;
	/** Seconds on the wind clock. The runner holds the frame at this sketch time. */
	readonly time?: number;
	/** The season the plant grows for; the record's by default. */
	readonly season?: (typeof PLANT_SEASONS)[number];
	/** A level to draw at every distance, in place of the levels by distance. */
	readonly lod?: ForcedLevel;
	/** The quality preset whose mesh tier the plant grows at; high by default. */
	readonly preset?: (typeof PLANT_PRESETS)[number];
	/** The frame's width and height in pixels, which give the page its aspect. */
	readonly size?: readonly [number, number];
	/** The light. */
	readonly sun?: PlantSun;
	/** The cutting candidate, 0 for the best. */
	readonly pick?: number;
	/** The cutting's length in metres. */
	readonly cut?: number;
	/** Whether the page posts its measures of the plant beside the frame. */
	readonly measure?: boolean;
	/** Whether the page draws a 1 m scale bar beside the view's target. */
	readonly scale?: boolean;
	/** Whether to draw the plant black on white with no light, for its exact outline. */
	readonly matte?: boolean;
	/** Whether stages not built yet grow stand-ins; true for a species that is not registered. */
	readonly placeholders?: boolean;
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
	/** Metres of bark that a bark view's frame height covers. */
	readonly span?: number;
	/** Turns drawn as a sheet of cells, one camera each: the turntable's 8 by default. */
	readonly turns?: number;
	/** Degrees between a sheet's turns; a full circle over `turns` by default. */
	readonly step?: number;
	/** The sheet's columns; as near square as the cells allow by default. */
	readonly columns?: number;
}

/** The query fields that are numbers, in the order a query lists them. */
const NUMBER_FIELDS = [
	'variant',
	'seed',
	'turn',
	'elevation',
	'distance',
	'fov',
	'wind',
	'time',
	'pick',
	'cut',
	'horizon',
	'fill',
	'targetY',
	'targetX',
	'top',
	'eye',
	'along',
	'span',
	'turns',
	'step',
	'columns',
] as const;

/** The fields that are shares of the frame, which must lie from 0 to 1. */
const SHARE_FIELDS = new Set(['horizon', 'fill', 'targetY', 'targetX', 'top', 'along']);

/** The fields that are whole numbers of at least one. */
const COUNT_FIELDS = new Set(['turns', 'columns']);

/** The switches, written as 1 when on. */
const SWITCHES = ['measure', 'scale', 'matte'] as const;

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
	for (const name of ['background', 'sky', 'ground', 'season', 'preset', 'sun'] as const) {
		const value = query[name];
		if (value) params.set(name, value);
	}
	if (query.lod !== undefined) params.set('lod', String(query.lod));
	if (query.size) params.set('size', `${query.size[0]}x${query.size[1]}`);
	for (const name of SWITCHES) if (query[name]) params.set(name, '1');
	if (query.placeholders !== undefined) params.set('placeholders', query.placeholders ? '1' : '0');
	return params.toString();
}

/** A value that one of a list of names must be, or the error that names the list. */
function oneOf<T extends string>(
	name: string,
	text: string | null,
	values: readonly T[],
): T | undefined {
	if (text === null) return undefined;
	if (!values.includes(text as T))
		throw new Error(`${name}=${text} is not one of ${values.join(', ')}: use one of them.`);
	return text as T;
}

/** Reads the page's query, and throws with the fix for a name or a value the page does not take. */
export function readPlantReviewQuery(params: URLSearchParams): PlantReviewQuery {
	const species = params.get('species');
	if (!species) throw new Error('species= is missing: name a species id, such as stub.');
	const view = oneOf('view', params.get('view'), PLANT_VIEWS) ?? 'whole';
	const numbers: Partial<Record<(typeof NUMBER_FIELDS)[number], number>> = {};
	for (const name of NUMBER_FIELDS) {
		const text = params.get(name);
		if (text === null) continue;
		const value = Number(text);
		if (!Number.isFinite(value)) throw new Error(`${name}=${text} is not a number.`);
		if (SHARE_FIELDS.has(name) && (value < 0 || value > 1))
			throw new Error(`${name}=${text} is a share of the frame: give a number from 0 to 1.`);
		if (COUNT_FIELDS.has(name) && (!Number.isInteger(value) || value < 1))
			throw new Error(`${name}=${text} is a count: give a whole number of 1 or more.`);
		numbers[name] = value;
	}
	if (numbers.wind !== undefined && (numbers.wind < 0 || numbers.wind > 3))
		throw new Error(`wind=${numbers.wind} is a strength: give a number from 0 to 3.`);
	for (const name of ['sky', 'ground'] as const) {
		const text = params.get(name);
		if (text !== null && !/^#[0-9a-f]{6}$/i.test(text))
			throw new Error(`${name}=${text} is not a colour: give sRGB hex such as #c9d9e6.`);
	}
	const lodText = params.get('lod');
	let lod: ForcedLevel | undefined;
	if (lodText !== null && lodText !== 'auto') {
		const level = Number(lodText);
		if (![0, 1, 2, 3].includes(level))
			throw new Error(`lod=${lodText} is not a level: use auto, 0, 1, 2 or 3.`);
		lod = level as ForcedLevel;
	}
	const sizeText = params.get('size');
	let size: [number, number] | undefined;
	if (sizeText !== null) {
		const [width = 0, height = 0] = sizeText.split('x').map(Number);
		if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0))
			throw new Error(`size=${sizeText} is not a size: give one such as 960x720.`);
		size = [width, height];
	}
	const background = oneOf('background', params.get('background'), PLANT_BACKGROUNDS);
	const season = oneOf('season', params.get('season'), PLANT_SEASONS);
	const preset = oneOf('preset', params.get('preset'), PLANT_PRESETS);
	const sun = oneOf('sun', params.get('sun'), PLANT_SUNS);
	const placeholders = params.get('placeholders');
	return {
		species,
		view,
		...numbers,
		...(background && { background }),
		...(params.get('sky') && { sky: params.get('sky') as string }),
		...(params.get('ground') && { ground: params.get('ground') as string }),
		...(season && { season }),
		...(preset && { preset }),
		...(sun && { sun }),
		...(lod !== undefined && { lod }),
		...(size && { size }),
		...(placeholders !== null && { placeholders: placeholders === '1' }),
		measure: params.get('measure') === '1',
		scale: params.get('scale') === '1',
		matte: params.get('matte') === '1',
	};
}
