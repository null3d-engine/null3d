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

/**
 * A limb view's composition, where a plant's limbs leave one stem as a cluster rather than along a
 * branch: `arms` frames the stem's top with its limbs either side, `between` stands close between
 * two of them, and `elbow` frames the sharpest turn of one limb's run into its rise.
 */
export const PLANT_COMPOSITIONS = ['arms', 'between', 'elbow'] as const;

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
	/**
	 * A limb view's composition: the stem's top with its limb cluster, or between the limbs. A plant
	 * whose limbs run along a branch leaves it absent and frames one limb. With it, `along` is the
	 * share of the plant's height where the camera stands and `span` the metres it frames across.
	 * Between the limbs, the camera stands close to the stem in the widest gap between two limbs, and
	 * an elbow composition stands across the limb's sharpest turn.
	 */
	readonly composition?: (typeof PLANT_COMPOSITIONS)[number];
	/** The cutting candidate, 0 for the best. */
	readonly pick?: number;
	/** The cutting's length in metres. */
	readonly cut?: number;
	/** Metres along the axis where a spanned piece starts, in place of the record's hint. */
	readonly cutFrom?: number;
	/** Metres of the axis a spanned piece keeps, in place of the record's hint. */
	readonly cutSpan?: number;
	/**
	 * The shoots a branch or sub-branch cutting carries, in place of the record hint's count, so two
	 * pictures of one species can show different numbers of side shoots.
	 */
	readonly shoots?: number;
	/**
	 * The shoot class a branch or sub-branch cutting draws, in place of the record hint's class, so a
	 * close view can draw a thin twig while the studio piece draws the whole branch.
	 */
	readonly shoot?: string;
	/**
	 * The class of piece a close view frames as the plant places it, such as a pine's `bough` or a
	 * tuft's `stalk`, in place of a cutting: the outermost placed piece of the class, square to its
	 * face, with only the slab of the plant that holds it drawn.
	 */
	readonly piece?: string;
	/** Whether a placed piece's view looks along the piece's side, so an arching piece shows its arch. */
	readonly edge?: boolean;
	/**
	 * Whether a whole view's photograph has lost the plant's foot below its horizon: the view then
	 * stands the plant by its top row and its share of the width, with no foot row.
	 */
	readonly footLost?: boolean;
	/**
	 * A limb view's subject as a great limb by its rank, the thickest first: the view frames that
	 * limb across its run from the side, as a cactus's arm or a limb's elbow is photographed.
	 */
	readonly limbRank?: number;
	/**
	 * The class of a site the plant marks on its surface that a close view frames, such as a
	 * saguaro's `dormant` site, its nest hole, or an `areole`: the site that faces the camera best.
	 */
	readonly site?: string;
	/**
	 * The radius of the ring a branch or sub-branch cutting's shoots stand on, as a share of the
	 * piece's height, in place of the record hint's. A wide ring separates the shoots.
	 */
	readonly ring?: number;
	/**
	 * The degrees a branch or sub-branch cutting's shoots lean outward from its axis, in place of the
	 * record hint's, so the tips separate while the bases stay together.
	 */
	readonly lean?: number;
	/**
	 * How a fanned cutting places its shoots: 'ring' round the piece's axis, 'spray' along one
	 * lateral line, or 'fan' across the piece's own leaf plane from one shared base.
	 */
	readonly layout?: 'ring' | 'spray' | 'fan';
	/**
	 * The width a 'spray' or 'fan' layout spans, as a share of the piece's height.
	 */
	readonly spread?: number;
	/**
	 * The shoot class of the piece's main stem. Naming it builds the stem-and-laterals assembly: the
	 * stem stands upright and the piece's own class hangs from it.
	 */
	readonly stem?: string;
	/** How many laterals hang from the stem, from 1 to the cutting's most. */
	readonly laterals?: number;
	/** The share of the stem's height where the first lateral leaves, and where the last leaves. */
	readonly lateralFrom?: number;
	readonly lateralTo?: number;
	/** Degrees each lateral leans outward from the stem's line. */
	readonly lateralAngle?: number;
	/** The laterals' length over their class's. */
	readonly lateralScale?: number;
	/** Which of the stem class's prototypes to take. */
	readonly stemPick?: number;
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
	 * Whether a picture's own background cannot be separated from the plant, so the picture carries
	 * no outline: its shape, width, pieces, frame gap, crown box and crown-box gap read null, while
	 * the colour comparison stays. A species' slot names a picture whose background is the subject,
	 * such as a far scrub band that the fitted sky and ground admit.
	 */
	readonly noOutline?: boolean;
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
	/**
	 * Whether to draw each part of the plant in a flat colour of its own on white, with no light:
	 * wood red with its radius in the blue channel, foliage green, extras green and blue. The parts
	 * are cut and layered as the colour picture is, so the picture says which part covers each texel.
	 */
	readonly parts?: boolean;
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
	/**
	 * The share of the frame's width that the reference's plant fills. A review run measures the
	 * render against it and redraws a whole view whose plant is over the band.
	 */
	readonly widthShare?: number;
	/**
	 * A multiplier on a whole view's stand from its framing. A redraw sets it from the width the
	 * picture itself measured, so the plant keeps the reference's margin.
	 */
	readonly standScale?: number;
	/**
	 * The share of a whole view's width correction that the review run takes, from 0 to 1. The
	 * tool's own field: the page does not read it, so a redraw keeps the stand the correction gave.
	 */
	readonly widthFraction?: number;
	/** The row share of the plant's top, for a frame whose plant base is cut off: give `eye` too. */
	readonly top?: number;
	/** The camera's height above the ground in metres, with `top`, when the base is out of frame. */
	readonly eye?: number;
	/** How far along a limb the limb view looks, as a share of the limb's length; a bark view of a stem, as a share of its height. */
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
	 * Metres above the ground at which a bark view of the trunk reads the surface, where the
	 * photograph shows the surface of one height: a column's skin above its corky foot, or a hole
	 * high in its trunk. It goes before the bark zone's own height.
	 */
	readonly barkHeight?: number;
	/**
	 * Metres that a close view covers: the bark or limb a bark or limb view frames, the sheath a
	 * ground plant's sheath view frames, or the width a cut view shows across the frame, where the
	 * reference is a picture of a part of the piece rather than the whole of it.
	 */
	readonly span?: number;
	/**
	 * The share of its picture's frame that a close view's subject box takes across and down, as the
	 * reference's own measure gives it. A junction view frames its subject so neither the limb's
	 * thickness nor the stem's width outgrows its share, instead of sizing the frame from the limb's
	 * diameter alone. Absent, the view keeps its own limb-diameter share.
	 */
	readonly subjectWidth?: number;
	/** The subject box's share of the picture's height, with `subjectWidth`. */
	readonly subjectHeight?: number;
	/**
	 * The share of the frame's height that a junction photograph's limb takes where it leaves the
	 * trunk, read off the photograph. It sets the junction view's frame alone.
	 */
	readonly limbShare?: number;
	/**
	 * The row share on which a crown photograph's limb crosses the frame under its leaves. The
	 * crown view then frames the limb that carries its foliage mass, low in the frame, and
	 * `limbShare` is that limb's share of the frame's height.
	 */
	readonly limbRow?: number;
	/** The column share on which a junction photograph's trunk meets its limb. */
	readonly collarColumn?: number;
	/**
	 * The degrees a junction photograph's limb rises above level where it leaves the trunk: the
	 * view frames the thick limb that lies nearest.
	 */
	readonly limbLie?: number;
	/**
	 * The row share on which a view up the stem puts the stem's first fork: the camera pitches up
	 * until the fork lands there.
	 */
	readonly forkRow?: number;
	/**
	 * The row shares on which a view up the stem puts the ground at the stem's bark and the crown's
	 * base: with both, the camera stands back until each lands where it is asked.
	 */
	readonly footRow?: number;
	readonly crownRow?: number;
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
	 * How far the wood's own sections are thinned, from 0 to 1: a review redraw reads the same plant
	 * with fewer rings and sides, to measure what the section level costs and what it breaks. Absent
	 * draws the level's own sections.
	 */
	readonly sections?: number;
	/**
	 * The share of a card level's own card rows to keep, from 0.05 to 1: a review redraw thins the
	 * cards to measure what they buy, the kept cards growing by the level's rule. Absent keeps them.
	 */
	readonly cards?: number;
	/**
	 * How a card joins the plant when a level does not draw its branch: `remove` drops it, `branch`
	 * draws the branch it stands on, and `twig` gives it a line to the nearest drawn branch.
	 */
	readonly cardJoin?: 'remove' | 'branch' | 'twig';
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
	'cutFrom',
	'cutSpan',
	'shoots',
	'ring',
	'lean',
	'spread',
	'laterals',
	'lateralFrom',
	'lateralTo',
	'lateralAngle',
	'lateralScale',
	'stemPick',
	'limbRank',
	'horizon',
	'fill',
	'targetY',
	'targetX',
	'widthShare',
	'standScale',
	'top',
	'eye',
	'along',
	'thin',
	'barkZone',
	'barkHeight',
	'span',
	'subjectWidth',
	'subjectHeight',
	'limbShare',
	'limbRow',
	'collarColumn',
	'limbLie',
	'forkRow',
	'footRow',
	'crownRow',
	'leaves',
	'leafLength',
	'sparse',
	'sections',
	'cards',
	'age',
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
	'widthShare',
	'top',
	'along',
	'skyShare',
	'sparse',
	'sections',
	'cards',
	'age',
]);

/** The fields that are whole numbers of at least one. */
const COUNT_FIELDS = new Set(['turns', 'columns', 'limbRank']);

/** The switches, written as 1 when on. */
const SWITCHES = [
	'measure',
	'scale',
	'matte',
	'parts',
	'fruit',
	'surface',
	'edge',
	'footLost',
	'lifted',
	'barkMask',
	'leafyBark',
	'noOutline',
	'foliage',
	'motion',
	'young',
] as const;

/** A short form of a number for a query, so a query reads well and keeps its precision. */
function short(value: number): string {
	return String(Number(value.toFixed(5)));
}

/** The query string that asks the page for a picture. */
export function plantReviewQuery(query: PlantReviewQuery): string {
	const params = new URLSearchParams({ species: query.species });
	if (query.form) params.set('form', query.form);
	if (query.shoot) params.set('shoot', query.shoot);
	if (query.piece) params.set('piece', query.piece);
	if (query.site) params.set('site', query.site);
	if (query.layout) params.set('layout', query.layout);
	if (query.stem) params.set('stem', query.stem);
	if (query.view) params.set('view', query.view);
	for (const name of NUMBER_FIELDS) {
		const value = query[name];
		if (value !== undefined) params.set(name, short(value));
	}
	for (const name of [
		'background',
		'sky',
		'ground',
		'lamp',
		'season',
		'preset',
		'sun',
		'composition',
	] as const) {
		const value = query[name];
		if (value) params.set(name, value);
	}
	if (query.lod !== undefined) params.set('lod', String(query.lod));
	if (query.cardJoin !== undefined) params.set('cardJoin', query.cardJoin);
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
	const layoutText = params.get('layout');
	if (
		layoutText !== null &&
		layoutText !== 'ring' &&
		layoutText !== 'spray' &&
		layoutText !== 'fan'
	)
		throw new Error(`layout=${layoutText} is not a layout: use ring, spray or fan.`);
	const shoot = params.get('shoot');
	if (shoot !== null && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(shoot))
		throw new Error(`shoot=${shoot} is not a class name: give a kebab-case word, such as twig.`);
	const site = params.get('site');
	if (site !== null && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(site))
		throw new Error(`site=${site} is not a class name: give a kebab-case word, such as areole.`);
	const piece = params.get('piece');
	if (piece !== null && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(piece))
		throw new Error(`piece=${piece} is not a class name: give a kebab-case word, such as bough.`);
	const stem = params.get('stem');
	if (stem !== null && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(stem))
		throw new Error(`stem=${stem} is not a class name: give a kebab-case word, such as cut.`);
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
	if (numbers.cutFrom !== undefined && numbers.cutFrom < 0)
		throw new Error(
			`cutFrom=${numbers.cutFrom} is a distance along the axis: give a number of 0 or more.`,
		);
	if (numbers.cutSpan !== undefined && numbers.cutSpan <= 0)
		throw new Error(`cutSpan=${numbers.cutSpan} is a length of axis: give a number above 0.`);
	if (numbers.barkHeight !== undefined && numbers.barkHeight < 0)
		throw new Error(
			`barkHeight=${numbers.barkHeight} is metres above the ground: give a number of 0 or more.`,
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
	for (const [name, value] of [
		['subjectWidth', numbers.subjectWidth],
		['subjectHeight', numbers.subjectHeight],
		['limbShare', numbers.limbShare],
		['limbRow', numbers.limbRow],
		['collarColumn', numbers.collarColumn],
	] as const)
		if (value !== undefined && !(value > 0 && value <= 1))
			throw new Error(
				`${name}=${value} is a share of the frame: give a number above 0 and up to 1.`,
			);
	if (numbers.leafLength !== undefined && numbers.leafLength <= 0)
		throw new Error(
			`leafLength=${numbers.leafLength} is a leaf's length in metres: give a number above 0.`,
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
	const joinText = params.get('cardJoin');
	let cardJoin: 'remove' | 'branch' | 'twig' | undefined;
	if (joinText !== null) {
		if (joinText !== 'remove' && joinText !== 'branch' && joinText !== 'twig')
			throw new Error(`cardJoin=${joinText} is not a join: use remove, branch or twig.`);
		cardJoin = joinText;
	}
	const sun = oneOf('sun', params.get('sun'), PLANT_SUNS);
	const composition = oneOf('composition', params.get('composition'), PLANT_COMPOSITIONS);
	const placeholders = params.get('placeholders');
	const pressed = params.get('pressed');
	return {
		species,
		...(form !== null && { form }),
		...(shoot !== null && { shoot }),
		...(piece !== null && { piece }),
		...(site !== null && { site }),
		...(stem !== null && { stem }),
		...(layoutText !== null && { layout: layoutText as 'ring' | 'spray' | 'fan' }),
		view,
		...numbers,
		...(background && { background }),
		...(params.get('sky') && { sky: params.get('sky') as string }),
		...(params.get('ground') && { ground: params.get('ground') as string }),
		...(params.get('lamp') && { lamp: params.get('lamp') as string }),
		...(season && { season }),
		...(preset && { preset }),
		...(sun && { sun }),
		...(composition && { composition }),
		...(lod !== undefined && { lod }),
		...(cardJoin !== undefined && { cardJoin }),
		...(size && { size }),
		...(placeholders !== null && { placeholders: placeholders === '1' }),
		...(pressed !== null && { pressed: pressed === '1' }),
		measure: params.get('measure') === '1',
		lifted: params.get('lifted') === '1',
		barkMask: params.get('barkMask') === '1',
		leafyBark: params.get('leafyBark') === '1',
		noOutline: params.get('noOutline') === '1',
		foliage: params.get('foliage') === '1',
		scale: params.get('scale') === '1',
		motion: params.get('motion') === '1',
		young: params.get('young') === '1',
		matte: params.get('matte') === '1',
		parts: params.get('parts') === '1',
		fruit: params.get('fruit') === '1',
		surface: params.get('surface') === '1',
		edge: params.get('edge') === '1',
		footLost: params.get('footLost') === '1',
	};
}
