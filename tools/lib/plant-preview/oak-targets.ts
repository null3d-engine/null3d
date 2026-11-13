// The pedunculate oak's whole-plant reference stills, as the preview reads them with the review
// tool's outline and measures: each still's turn, the enclosed sky gap of its crown, the share of
// its frame's width that its plant takes, and where its plant stands in its frame. A test draws the
// grown oak at these framings without the pictures, which the repository does not hold.
// `bun run plants:preview pedunculate-oak --refs <folder>` measures them again from the pictures.
import type { ScreenFraming } from '../../../tests/pages/lib/plant-review/framing.ts';

/** One whole-plant still's figures. */
export interface WholeTarget {
	/** The still's file name in the oak's reference folder. */
	readonly file: string;
	/** Degrees about the plant the still is drawn at. */
	readonly turn: number;
	/** The share of the crown's outline that shows background. */
	readonly gap: number;
	/** The share of the frame's width that the plant takes. */
	readonly widthShare: number;
	/** Where the plant stands in the frame. */
	readonly framing: ScreenFraming;
}

/** The oak's three whole-plant stills. */
export const OAK_WHOLE: readonly WholeTarget[] = [
	{
		file: '01-whole-distant.png',
		turn: 0,
		gap: 0.1145,
		widthShare: 0.7734,
		framing: {
			fov: 30,
			aspect: 1.48837,
			horizon: 0.84186,
			top: 0.17442,
			base: 0.85349,
			eye: 0.3,
			targetX: 0.48281,
		},
	},
	{
		file: '02-whole-profile.png',
		turn: 90,
		gap: 0.0908,
		widthShare: 0.95,
		framing: {
			fov: 30,
			aspect: 1.48837,
			horizon: 0.9186,
			top: 0.05581,
			base: 0.9186,
			eye: 0.3,
			targetX: 0.48984,
		},
	},
	{
		file: '18-silhouette.png',
		turn: 0,
		gap: 0.1523,
		widthShare: 0.8906,
		framing: {
			fov: 30,
			aspect: 1.48837,
			horizon: 0.94186,
			top: 0.06279,
			base: 0.93488,
			eye: 0.3,
			targetX: 0.49453,
		},
	},
];
