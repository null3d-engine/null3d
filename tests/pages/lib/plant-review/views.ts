// The views of the plant review page: what each one frames, the reference slots it is judged
// against, and the field of view, background, light and elevation it takes when the query names
// none. The page and the review tools share this table, so a render is always laid beside the
// reference pictures of its own view.

/** The views that the page draws. */
export const PLANT_VIEWS = [
	'turntable',
	'whole',
	'crown',
	'below',
	'inside',
	'junction',
	'fork',
	'twigs',
	'strands',
	'limb',
	'branch',
	'subbranch',
	'cluster',
	'leaf-upper',
	'leaf-under',
	'soil',
	'bark-base',
	'bark-mid',
	'bark-limb',
	'trunk',
	'skeleton',
	'silhouette',
	'panels',
] as const;

/** One view of the page. */
export type PlantView = (typeof PLANT_VIEWS)[number];

/** The backgrounds that a plant stands against. */
export const PLANT_BACKGROUNDS = ['sky-meadow', 'sky', 'studio-grey', 'white'] as const;

/** One background of the page. */
export type PlantBackground = (typeof PLANT_BACKGROUNDS)[number];

/** The lights a view stands in. */
export const PLANT_SUNS = ['default', 'low', 'back', 'overhead', 'flat', 'albedo'] as const;

/** One light of the page. */
export type PlantSun = (typeof PLANT_SUNS)[number];

/**
 * The colours of each background, as sRGB hex: the medians of the reference corpus's plain
 * backgrounds, measured by the review tools' mask. The sky and meadow are those of the whole-plant
 * stills; the turning videos stand in a paler, greyer sky, which a run matched to a video passes as
 * `sky` and `ground`. The grey is the studio stills' seamless backdrop and the white the
 * single-leaf stills'.
 */
export const BACKGROUND_COLOURS: Readonly<
	Record<PlantBackground, { readonly sky: string; readonly ground?: string }>
> = {
	'sky-meadow': { sky: '#c5d8ef', ground: '#9e9b62' },
	// Sky alone: a view whose subject hangs at the crown's rim, against the sky and no ground.
	sky: { sky: '#c5d8ef' },
	'studio-grey': { sky: '#cccdd1' },
	white: { sky: '#fefefe' },
};

/** What a view frames and what it takes by default. */
export interface ViewSpec {
	/** The reference slots, by number, that the view is judged against. */
	readonly slots: readonly number[];
	/** Its vertical field of view in degrees. */
	readonly fov: number;
	/** What the plant stands against. */
	readonly background: PlantBackground;
	/** Its light. */
	readonly sun: PlantSun;
	/** Degrees the camera stands above its target, where the view orbits one. */
	readonly elevation: number;
	/** The piece the view cuts from the plant, for a view of one piece. */
	readonly cutting?: 'branch' | 'subbranch' | 'cluster' | 'leaf';
	/** Whether the view frames the whole plant, so a framing in screen shares can place it. */
	readonly whole?: boolean;
	/** Whether the view draws the wood alone. */
	readonly woodOnly?: boolean;
	/** The frame's size when the query names none. */
	readonly size: readonly [number, number];
}

/** Every view's framing and defaults, as the review sketch contract gives them. */
export const VIEW_SPECS: Readonly<Record<PlantView, ViewSpec>> = {
	turntable: {
		slots: [],
		fov: 38,
		background: 'sky-meadow',
		sun: 'default',
		elevation: 5,
		whole: true,
		size: [1600, 900],
	},
	whole: {
		slots: [1, 2],
		fov: 38,
		background: 'sky-meadow',
		sun: 'default',
		elevation: 5,
		whole: true,
		size: [960, 720],
	},
	crown: {
		slots: [4],
		fov: 50,
		background: 'sky-meadow',
		sun: 'default',
		elevation: 0,
		size: [960, 720],
	},
	below: {
		slots: [3, 5],
		fov: 70,
		background: 'sky-meadow',
		sun: 'default',
		elevation: 70,
		size: [960, 720],
	},
	inside: {
		slots: [6],
		fov: 75,
		background: 'sky-meadow',
		sun: 'default',
		elevation: 10,
		size: [960, 720],
	},
	junction: {
		slots: [7],
		fov: 50,
		background: 'sky-meadow',
		sun: 'default',
		elevation: 0,
		woodOnly: true,
		size: [960, 720],
	},
	fork: {
		slots: [8],
		fov: 50,
		// The photographs frame a cut limb on the studio's own ground, so the view cuts one too: a
		// fork inside a leafy crown carries neighbours the picture has not.
		background: 'studio-grey',
		sun: 'flat',
		elevation: 0,
		cutting: 'branch',
		size: [960, 720],
	},
	twigs: {
		slots: [19],
		fov: 45,
		background: 'studio-grey',
		sun: 'default',
		elevation: 0,
		size: [960, 720],
	},
	strands: {
		slots: [],
		fov: 45,
		background: 'sky',
		sun: 'default',
		elevation: 0,
		size: [960, 720],
	},
	limb: {
		slots: [4],
		fov: 45,
		background: 'sky-meadow',
		sun: 'default',
		elevation: -30,
		size: [960, 720],
	},
	branch: {
		slots: [9, 20, 21],
		fov: 40,
		background: 'studio-grey',
		sun: 'flat',
		elevation: 8,
		cutting: 'branch',
		size: [960, 720],
	},
	subbranch: {
		slots: [10, 22],
		fov: 40,
		background: 'studio-grey',
		sun: 'flat',
		elevation: 8,
		cutting: 'subbranch',
		size: [960, 720],
	},
	cluster: {
		slots: [11, 23],
		fov: 40,
		background: 'studio-grey',
		sun: 'flat',
		elevation: 8,
		cutting: 'cluster',
		size: [960, 720],
	},
	'leaf-upper': {
		slots: [12, 24],
		fov: 20,
		background: 'white',
		sun: 'albedo',
		elevation: 0,
		cutting: 'leaf',
		size: [720, 960],
	},
	'leaf-under': {
		slots: [13, 25],
		fov: 20,
		background: 'white',
		sun: 'albedo',
		elevation: 0,
		cutting: 'leaf',
		size: [720, 960],
	},
	soil: {
		slots: [],
		fov: 45,
		background: 'studio-grey',
		sun: 'flat',
		elevation: 10,
		size: [960, 720],
	},
	'bark-base': {
		slots: [14],
		fov: 50,
		background: 'sky-meadow',
		sun: 'default',
		elevation: 15,
		woodOnly: true,
		size: [960, 720],
	},
	'bark-mid': {
		slots: [15, 26, 27],
		fov: 40,
		background: 'sky-meadow',
		sun: 'albedo',
		elevation: 0,
		woodOnly: true,
		size: [960, 960],
	},
	'bark-limb': {
		slots: [16, 28],
		fov: 40,
		background: 'sky-meadow',
		sun: 'albedo',
		elevation: 0,
		woodOnly: true,
		size: [960, 720],
	},
	trunk: {
		slots: [17],
		fov: 40,
		background: 'sky-meadow',
		sun: 'default',
		elevation: 0,
		size: [720, 960],
	},
	skeleton: {
		slots: [],
		fov: 38,
		background: 'sky-meadow',
		sun: 'default',
		elevation: 5,
		whole: true,
		woodOnly: true,
		size: [960, 720],
	},
	silhouette: {
		slots: [18],
		fov: 38,
		background: 'white',
		sun: 'flat',
		elevation: 5,
		whole: true,
		size: [960, 720],
	},
	panels: {
		slots: [],
		fov: 38,
		background: 'sky-meadow',
		sun: 'default',
		elevation: 5,
		size: [1024, 1024],
	},
};

/** The views that draw a cut piece of the plant: a branch, a sub-branch or a leaf cluster. */
export const CUTTING_VIEWS: readonly PlantView[] = PLANT_VIEWS.filter(
	(view) => VIEW_SPECS[view].cutting !== undefined,
);

/** The views that frame the whole plant, which a framing in screen shares can place. */
export const WHOLE_VIEWS: readonly PlantView[] = PLANT_VIEWS.filter(
	(view) => VIEW_SPECS[view].whole === true,
);
