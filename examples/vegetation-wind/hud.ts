// The wind demo's control panel: the air's strength, its direction, and a button that holds it still.
/** The wind's adjustable state, as the panel shows it. */
export interface WindControls {
	power: number;
	bearing: number;
	still: boolean;
}

/** Posts the panel, with every control showing the state it currently holds. */
export function postWindHud(
	page: { post(name: string, value: unknown): void },
	state: WindControls,
): void {
	const { power, bearing, still } = state;
	page.post('hud', {
		groups: [
			{
				name: 'wind',
				title: 'Wind',
				radio: false,
				buttons: [
					{
						id: 'still',
						label: 'Hold',
						tip: 'Hold the air still, or let it move again.',
						active: still,
					},
				],
				slider: {
					min: 0,
					max: 12,
					step: 0.1,
					value: power,
					live: false,
					marks: [
						{ at: 0, label: 'still' },
						{ at: 6, label: 'breeze' },
						{ at: 12, label: 'gale' },
					],
					tip: "Drag the slider to set the wind's strength, from still air to a gale.",
				},
			},
			{
				name: 'bearing',
				title: 'Direction',
				radio: false,
				buttons: [],
				slider: {
					min: 0,
					max: 360,
					step: 1,
					value: bearing,
					live: false,
					marks: [
						{ at: 0, label: 'N' },
						{ at: 90, label: 'E' },
						{ at: 180, label: 'S' },
						{ at: 270, label: 'W' },
					],
					tip: 'Drag the slider to turn the wind round the meadow.',
				},
			},
		],
		visible: true,
	});
}
