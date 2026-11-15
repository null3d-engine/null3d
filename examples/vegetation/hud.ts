// The vegetation meadow's control panel: the season buttons and the two sliders that shape a build.
// Each control carries its own explanation, since a reader meets them without a guide.
/** The meadow's adjustable state, as the panel shows it. */
export interface MeadowControls {
	season: 'summer' | 'autumn' | 'winter' | 'blossom';
	/** How much of its foliage and branches a plant gives up, from 0 to 1. */
	sparse: number;
	/** The most triangles one plant may draw; undefined draws the record's own form. */
	maxTriangles: number | undefined;
}

/**
 * The polygon slider's steps, from the record's own form to a floor under a hundred triangles. A
 * plant draws millions of triangles and the floor is a few dozen, so a linear axis cannot span the
 * range: the slider names a cap at each step, each about a tenth of the one before it.
 */
export const POLYGON_STEPS: readonly { readonly label: string; readonly max?: number }[] = [
	{ label: 'full' },
	{ label: '100k', max: 100_000 },
	{ label: '10k', max: 10_000 },
	{ label: '1k', max: 1_000 },
	{ label: '96', max: 96 },
];

/** Whether a number names one of the polygon slider's steps. */
export function isPolygonStep(step: number): boolean {
	return Number.isInteger(step) && step >= 0 && step < POLYGON_STEPS.length;
}

/** The triangle maximum a polygon slider step sets, or undefined at the record's own form. */
export function polygonMaximum(step: number): number | undefined {
	return POLYGON_STEPS[step]?.max;
}

/** The polygon slider step that shows a triangle maximum, or the first step for no maximum. */
export function polygonStep(max: number | undefined): number {
	if (max === undefined) return 0;
	const at = POLYGON_STEPS.findIndex((step) => step.max === max);
	return at < 0 ? 0 : at;
}

/** Posts the panel, with every control showing the state it currently holds. */
export function postHud(
	page: { post(name: string, value: unknown): void },
	state: MeadowControls,
): void {
	const { season, sparse, maxTriangles } = state;
	page.post('hud', {
		groups: [
			{
				name: 'season',
				title: 'Season',
				radio: true,
				buttons: (['blossom', 'summer', 'autumn', 'winter'] as const).map((id) => ({
					id,
					label: id[0]?.toUpperCase() + id.slice(1),
					tip: `Grow the meadow in ${id}.`,
					active: season === id,
				})),
			},
			{
				name: 'sparse',
				title: 'Sparseness',
				radio: false,
				buttons: [],
				slider: {
					min: 0,
					max: 1,
					step: 0.05,
					value: sparse,
					live: false,
					marks: [
						{ at: 0, label: 'own form' },
						{ at: 0.5, label: 'lighter' },
						{ at: 1, label: 'sparsest' },
					],
					tip: "Drag right to grow a lighter tree: fewer limbs, less leaf on what wood it keeps, and coarser wood, all together, toward the least the species still reads as itself. The left end is the record's own form. The light form is what a phone or a tablet asks for, so a forest of full trees can load and draw on a small device.",
				},
			},
			{
				name: 'polygons',
				title: 'Polygons',
				radio: false,
				buttons: [],
				slider: {
					min: 0,
					max: POLYGON_STEPS.length - 1,
					step: 1,
					value: polygonStep(maxTriangles),
					live: false,
					marks: POLYGON_STEPS.map((step, at) => ({ at, label: step.label })),
					tip: "Drag right to cap the triangles one plant draws, from the record's own form at the left to under a hundred at the right. A plant's trunk, limbs, leaves and extras step down together to meet the cap, so it keeps one joined shape, and the meadow regrows at the new cap.",
				},
			},
		],
		visible: true,
	});
}
