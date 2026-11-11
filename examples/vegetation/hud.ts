// The vegetation meadow's control panel: the season buttons and the one slider that shapes a
// build. Each control carries its own explanation, since a reader meets them without a guide.
/** The meadow's adjustable state, as the panel shows it. */
export interface MeadowControls {
	season: 'summer' | 'autumn' | 'winter' | 'blossom';
	sparse: number;
}

/** Posts the panel, with every control showing the state it currently holds. */
export function postHud(
	page: { post(name: string, value: unknown): void },
	state: MeadowControls,
): void {
	const { season, sparse } = state;
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
						{ at: 0, label: 'full form' },
						{ at: 0.5, label: 'lighter' },
						{ at: 1, label: 'sparsest' },
					],
					tip: "Drag right to grow a lighter tree: fewer limbs, less leaf on what wood it keeps, and coarser wood, all together, toward the least the species still reads as itself. 0 is the record's own form. The meadow opens at the sparsest form, and a drag to the left adds density. The light form is what a phone or a tablet asks for, so a forest of full trees can load and draw on a small device.",
				},
			},
		],
		visible: true,
	});
}
