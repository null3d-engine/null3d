// Places Creek's valley by the vegetation add-on's ecological rules and checks the placement
// against the reference that every device must reach: one seed gives the same points on any
// device, and neither the order of the tiles nor their size changes them. It times the placement
// as well, which is the figure that the vegetation budgets record for a valley this size.
// ?seed= changes the seed, ?runs= the number of timed runs, and ?tile= a second tile size to check.
import {
	builtinRules,
	CREEK_SPECIES,
	EcoScatter,
	groundMaps,
	scatterChecksum,
	scatterVegetation,
} from '@null3d/vegetation';
import { groundHeight, LAND, WATER } from '../../examples/showcase/creek/land';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);

/** The seed that the reference was recorded from. */
const DEFAULT_SEED = 7;

/** The checksum that every device and both GPU paths must give for the default seed. */
const REFERENCE: Record<number, number> = {
	7: 232657082,
};

/** The seed to place with. */
const SEED = Number(params.get('seed') ?? DEFAULT_SEED);

/** The timed runs, whose middle value is the figure that the report records. */
const RUNS = Math.max(1, Number(params.get('runs') ?? 3));

/** The second tile size, which must place the same points. */
const OTHER_TILE = Number(params.get('tile') ?? 17);

/** The middle of a list of numbers. */
function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] as number;
}

run('vegetation-scatter', async () => {
	const groundStarted = performance.now();
	const ground = groundMaps({ size: LAND, water: WATER, height: groundHeight });
	const groundMs = performance.now() - groundStarted;
	const rules = builtinRules(CREEK_SPECIES);
	progress(`ground maps in ${Math.round(groundMs)} ms`);

	const times: number[] = [];
	let points = scatterVegetation({ seed: SEED, ground, rules });
	const counts: Record<string, number> = {};
	for (let run = 0; run < RUNS; run++) {
		const at = performance.now();
		points = scatterVegetation({ seed: SEED, ground, rules });
		times.push(performance.now() - at);
		if (run === 0) {
			for (let index = 0; index < points.count; index++) {
				const rule = points.rules[points.data[index * points.stride + 3] as number];
				const layer = rule?.layer ?? 'none';
				counts[layer] = (counts[layer] ?? 0) + 1;
			}
		}
	}
	const checksum = scatterChecksum(points);
	progress(`${points.count} plants placed, checksum ${checksum}`);

	const reference = REFERENCE[SEED];
	if (reference !== undefined && checksum !== reference)
		throw new Error(
			`the scatter placed other plants than the reference: it gave ${checksum}, and the reference is ${reference}`,
		);

	// The tiles in the reverse order must give the same points.
	const tiles = Math.ceil(LAND / 32);
	const reversed = new EcoScatter({ seed: SEED, ground, rules });
	for (let row = tiles - 1; row >= 0; row--)
		for (let column = tiles - 1; column >= 0; column--) reversed.addTile(column, row);
	if (scatterChecksum(reversed.build()) !== checksum)
		throw new Error('the scatter gave other plants when the tiles arrived in the reverse order');

	// Another tile size must give the same points too.
	const retiled = scatterVegetation({ seed: SEED, ground, rules, tileSize: OTHER_TILE });
	if (scatterChecksum(retiled) !== checksum)
		throw new Error(`the scatter gave other plants with ${OTHER_TILE} m tiles`);

	const placementMs = median(times);
	progress(`placed in ${placementMs.toFixed(1)} ms`);
	return {
		seed: SEED,
		plants: points.count,
		counts,
		checksum,
		placementMs,
		worstMs: Math.max(...times),
		runs: RUNS,
		tileSize: OTHER_TILE,
		groundMs,
	};
});
