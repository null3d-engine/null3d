// The vegetation meadow's control panel: the season buttons and the three sliders that shape a
// build. Each control carries its own explanation, since a reader meets them without a guide.
/** The meadow's adjustable state, as the panel shows it. */
export interface MeadowControls {
	season: 'summer' | 'autumn' | 'winter' | 'blossom';
	leaves: number;
	limbs: number;
	coarseness: number;
}

/** Posts the panel, with every control showing the state it currently holds. */
export function postHud(
	page: { post(name: string, value: unknown): void },
	state: MeadowControls,
): void {
	const { season, leaves, limbs, coarseness } = state;
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
				name: 'leaves',
				title: 'Leaves',
				radio: false,
				buttons: [],
				slider: {
					min: 0,
					max: 1,
					step: 0.05,
					value: leaves,
					live: false,
					marks: [
						{ at: 0, label: 'small' },
						{ at: 0.5, label: 'default' },
						{ at: 1, label: 'large' },
					],
					tip: "Drag left to draw smaller leaves on the same wood, or right to draw larger ones. The middle is every record's own leaf, and the wood does not move.",
				},
			},
			{
				name: 'limbs',
				title: 'Limbs',
				radio: false,
				buttons: [],
				slider: {
					min: 0,
					max: 1,
					step: 0.05,
					value: limbs,
					live: false,
					marks: [
						{ at: 0, label: 'sparse' },
						{ at: 0.5, label: 'default' },
						{ at: 1, label: 'dense' },
					],
					tip: "Drag left to keep fewer limbs toward the bare wood, or right to keep the shoots the record's own density drops. The middle is every record's own crown, and every species answers with its own count of branches, fronds or tillers.",
				},
			},
			{
				name: 'coarseness',
				title: 'Coarseness',
				radio: false,
				buttons: [],
				slider: {
					min: 0,
					max: 1,
					step: 0.05,
					value: coarseness,
					live: false,
					marks: [
						{ at: 0, label: 'as grown' },
						{ at: 0.5, label: 'coarser' },
						{ at: 1, label: 'coarsest' },
					],
					tip: 'Coarseness answers how much of a plant must draw at a distance. Near the camera every plant draws whole; farther away the add-on may draw fewer of its finest twigs and fewer, larger shoots, which keeps the leaf area but costs the finest detail. 0 is each plant as it grows and 1 the coarsest it may become, and a game sets it from the plant’s size on the screen.',
				},
			},
		],
		visible: true,
	});
}
