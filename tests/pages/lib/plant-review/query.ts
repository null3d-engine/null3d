// The query contract of the plant review page: the names it reads and the values each takes. The
// page and the review tools share this file, so a tool that builds a query and the page that reads
// it agree on every name. Nothing here knows how a plant grows.
import { LEAST_ROW_GAP } from './framing';
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
	/**
	 * One of the species' other forms by name, such as `young` or `woodland`, which the plant grows
	 * in when its record has that form. The record as it stands by default.
	 */
	readonly form?: string;
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
	/**
	 * Where the light stands, in degrees: how far to the camera's right, and how high above the
	 * horizon. A reference picture's own light, so a render is lit as its reference is.
	 */
	readonly sunAzimuth?: number;
	readonly sunRise?: number;
	/**
	 * The share of a sunlit view's light that comes from the whole sky rather than from the sun, from
	 * 0 to 1: low for clear sun with hard shadows, high for haze or a bright overcast. The light keeps
	 * its total strength.
	 */
	readonly skyShare?: number;
	/**
	 * The strength of a sunlit view's light, the sky, the sun and the light the ground throws back
	 * together, as a multiple of the page's soft daylight, above 0 and up to 8; 1 by default. A
	 * picture under a clear sky lights its plant more brightly than that soft daylight, against the
	 * same sky colour behind it. A review measures each view's value from its photograph's own sky,
	 * which calibrates the light to the picture rather than deriving it from physics: a photograph's
	 * tone curve squeezes a bright sky more than the plant under it.
	 */
	readonly daylight?: number;
	/**
	 * A copy stand's lamp colour, as sRGB hex, in place of white: a photograph's own white balance,
	 * so a picture taken under warm lamps is drawn under them too.
	 */
	readonly lamp?: string;
	/** The wind's strength: 0 still, 1 the default field, up to 3. */
	readonly wind?: number;
	/**
	 * Metres from the camera out to which the plant's materials sway, in place of the preset's
	 * distance: a plant beyond it stands still under the same field, which a picture contrasts
	 * with the plant swaying inside the preset's distance.
	 */
	readonly sway?: number;
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
	/**
	 * Whether the picture shows the plant lifted from the soil, as a photograph of its washed base
	 * does: no ground plane is drawn, so the rhizome and the roots below the crown stay in view.
	 */
	readonly lifted?: boolean;
	/** Whether the page draws a 1 m scale bar beside the view's target. */
	readonly scale?: boolean;
	/**
	 * Whether the page draws the motion debug view in place of the plant: each pixel's motion since
	 * the frame before, as a color. A held frame has the frame before it, so a plant that its vertex
	 * offset sways shows its motion and a plant past its sway distance stays black.
	 */
	readonly motion?: boolean;
	/**
	 * Whether a close view's colour is measured on the plant alone, ignoring the backdrop. A stem
	 * does not fill its frame, so the nine patches of a plain average reach sky and ground; a slot
	 * naming this has those patches drop every pixel close to the picture's own background. A
	 * texture source takes it too, since its reference is often a cut-out laid on one colour and
	 * the render stands on another, so a plain average lifts both sides alike.
	 */
	readonly barkMask?: boolean;
	/**
	 * Whether a bark close view's photograph shows leaves over the bark: the patches drop
	 * leaf-green pixels on both pictures, so the figure reads the bark's own colour rather than a
	 * blend with the foliage. A bark that is itself green leaves this off and keeps `barkMask`
	 * alone, since that green is the material being measured.
	 */
	readonly leafyBark?: boolean;
	/**
	 * Whether a view that draws the wood alone draws the plant's foliage as well, which a bark
	 * photograph taken among leaves needs if its colour is to be compared with like.
	 */
	readonly foliage?: boolean;
	/** Whether the twigs view looks for the plant's fruit rather than for a sunlit tip. */
	readonly fruit?: boolean;
	/**
	 * For a single-leaf still: whether the leaf lies pressed flat or as it grew, as the still's
	 * picture shows it. The record's cutting hint by default.
	 */
	readonly pressed?: boolean;
	/**
	 * For a single-leaf still: how far the leaf has opened, from 0 for a crozier still rolled to 1
	 * for a leaf fully out. Absent, it is drawn as it stands on a mature plant.
	 */
	readonly age?: number;
	/** For a cut branch: whether its candidates rank by how young they are, so the piece is opening. */
	readonly young?: boolean;
	/**
	 * Whether a limb view frames the crown's outer surface, whose depth into the crown is part of its
	 * subject, rather than one branch that its picture shows against a plain ground.
	 */
	readonly surface?: boolean;
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
	/**
	 * Metres of radius that a limb view frames: it picks the limb that carries that thickness.
	 */
	readonly thin?: number;
	/**
	 * The bark zone whose own height a bark view frames, as an index into the record's zones: the
	 * camera stands where that zone covers the wood, so each bark source is compared with the bark
	 * its photograph shows. From 0.
	 */
	readonly barkZone?: number;
	/**
	 * Metres that a close view covers: the bark or limb a bark or limb view frames, the sheath a
	 * ground plant's sheath view frames, or the width a cut view shows across the frame, where the
	 * reference is a picture of a part of the piece rather than the whole of it.
	 */
	readonly span?: number;
	/**
	 * The row share on which a view up the stem puts the stem's first fork: the camera pitches up
	 * until the fork lands there, no steeper than the view's elevation.
	 */
	readonly forkRow?: number;
	/**
	 * The row shares on which a view up the stem puts the ground at the stem's bark and the crown's
	 * base: with both, the camera stands back until each lands where it is asked.
	 */
	readonly footRow?: number;
	readonly crownRow?: number;
	/** Degrees a view up the stem turns its look to the right of the stem, so the stem enters low left. */
	readonly aside?: number;
	/** Stem radii from the stem's axis at which a view up the stem stands, in place of a step back. */
	readonly stand?: number;
	/**
	 * Leaf lengths that a cut piece's frame height covers, in place of fitting the whole piece: the
	 * scale its photograph shows it at. The piece then stands on its cut at the frame's lower edge.
	 */
	readonly leaves?: number;
	/**
	 * How far toward its sparse form the plant grows, from 0 to 1, the level a phone or a tablet
	 * asks for: the species' floors hold it at what still reads as itself. 0 grows the record's own.
	 */
	readonly sparse?: number;
	/**
	 * Metres of one leaf that a photographed cutting was measured in, for the `leaves` frame. A
	 * blade or a cluster whose own leaf is far longer than the photographed one frames at the
	 * photograph's scale only when the length the photograph was measured in is named.
	 */
	readonly leafLength?: number;
	/** Degrees the camera turns about its line of sight, the picture turning counterclockwise. */
	readonly roll?: number;
	/**
	 * The share of the frame's height that a limb's thickness fills, for a view of the bark on a
	 * great limb that shows the limb itself, as a photograph of it does.
	 */
	readonly girth?: number;
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
	'sway',
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
	'thin',
	'barkZone',
	'span',
	'forkRow',
	'footRow',
	'crownRow',
	'aside',
	'stand',
	'leaves',
	'leafLength',
	'sparse',
	'roll',
	'girth',
	'turns',
	'step',
	'columns',
	'sunAzimuth',
	'sunRise',
	'skyShare',
	'daylight',
] as const;

/** The fields that are shares, of the frame or of the light, which must lie from 0 to 1. */
const SHARE_FIELDS = new Set([
	'horizon',
	'fill',
	'targetY',
	'targetX',
	'top',
	'along',
	'skyShare',
	'sparse',
]);

/** The fields that are whole numbers of at least one. */
const COUNT_FIELDS = new Set(['turns', 'columns']);

/** The switches, written as 1 when on. */
const SWITCHES = [
	'measure',
	'scale',
	'matte',
	'fruit',
	'surface',
	'lifted',
	'barkMask',
	'leafyBark',
	'foliage',
] as const;

/** A short form of a number for a query, so a query reads well and keeps its precision. */
function short(value: number): string {
	return String(Number(value.toFixed(5)));
}

/** The query string that asks the page for a picture. */
export function plantReviewQuery(query: PlantReviewQuery): string {
	const params = new URLSearchParams({ species: query.species });
	if (query.form) params.set('form', query.form);
	if (query.view) params.set('view', query.view);
	for (const name of NUMBER_FIELDS) {
		const value = query[name];
		if (value !== undefined) params.set(name, short(value));
	}
	for (const name of ['background', 'sky', 'ground', 'lamp', 'season', 'preset', 'sun'] as const) {
		const value = query[name];
		if (value) params.set(name, value);
	}
	if (query.lod !== undefined) params.set('lod', String(query.lod));
	if (query.size) params.set('size', `${query.size[0]}x${query.size[1]}`);
	for (const name of SWITCHES) if (query[name]) params.set(name, '1');
	if (query.placeholders !== undefined) params.set('placeholders', query.placeholders ? '1' : '0');
	if (query.pressed !== undefined) params.set('pressed', query.pressed ? '1' : '0');
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
	const form = params.get('form');
	if (form !== null && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(form))
		throw new Error(`form=${form} is not a form's name: give a kebab-case word, such as young.`);
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
	if (numbers.sway !== undefined && numbers.sway <= 0)
		throw new Error(
			`sway=${numbers.sway} is a distance in metres: give a number above 0, or leave it out for the preset's distance.`,
		);
	if (numbers.daylight !== undefined && (numbers.daylight <= 0 || numbers.daylight > 8))
		throw new Error(
			`daylight=${numbers.daylight} is a multiple of the soft daylight: give a number above 0, up to 8.`,
		);
	for (const name of ['forkRow', 'footRow', 'crownRow'] as const) {
		const value = numbers[name];
		if (value !== undefined && (value < 0 || value > 1))
			throw new Error(`${name}=${value} is a share of the frame: give a number from 0 to 1.`);
	}
	if (
		numbers.crownRow !== undefined &&
		numbers.footRow !== undefined &&
		numbers.footRow - numbers.crownRow < LEAST_ROW_GAP - 1e-9
	)
		throw new Error(
			`crownRow=${numbers.crownRow} is not well above footRow=${numbers.footRow}: the crown's base stands over the foot, so give it a share at least ${LEAST_ROW_GAP} smaller.`,
		);
	if (numbers.girth !== undefined && (numbers.girth <= 0 || numbers.girth > 1))
		throw new Error(
			`girth=${numbers.girth} is a share of the frame that a limb fills: give a number above 0, up to 1.`,
		);
	if (numbers.leaves !== undefined && numbers.leaves <= 0)
		throw new Error(`leaves=${numbers.leaves} is a frame in leaf lengths: give a number above 0.`);
	if (
		numbers.barkZone !== undefined &&
		(!Number.isInteger(numbers.barkZone) || numbers.barkZone < 0)
	)
		throw new Error(
			`barkZone=${numbers.barkZone} is an index into the record's bark zones: give a whole number of 0 or more.`,
		);
	if (numbers.leafLength !== undefined && numbers.leafLength <= 0)
		throw new Error(
			`leafLength=${numbers.leafLength} is a leaf's length in metres: give a number above 0.`,
		);
	if (numbers.stand !== undefined && numbers.stand <= 1)
		throw new Error(
			`stand=${numbers.stand} is in stem radii from its axis: give a number above 1.`,
		);
	for (const name of ['sky', 'ground', 'lamp'] as const) {
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
	const pressed = params.get('pressed');
	return {
		species,
		...(form !== null && { form }),
		view,
		...numbers,
		...(background && { background }),
		...(params.get('sky') && { sky: params.get('sky') as string }),
		...(params.get('ground') && { ground: params.get('ground') as string }),
		...(params.get('lamp') && { lamp: params.get('lamp') as string }),
		...(season && { season }),
		...(preset && { preset }),
		...(sun && { sun }),
		...(lod !== undefined && { lod }),
		...(size && { size }),
		...(placeholders !== null && { placeholders: placeholders === '1' }),
		...(pressed !== null && { pressed: pressed === '1' }),
		measure: params.get('measure') === '1',
		lifted: params.get('lifted') === '1',
		barkMask: params.get('barkMask') === '1',
		leafyBark: params.get('leafyBark') === '1',
		foliage: params.get('foliage') === '1',
		scale: params.get('scale') === '1',
		motion: params.get('motion') === '1',
		matte: params.get('matte') === '1',
		fruit: params.get('fruit') === '1',
		surface: params.get('surface') === '1',
	};
}
