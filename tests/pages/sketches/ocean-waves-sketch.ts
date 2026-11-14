// The ocean add-on's wave transform, read back: the sketch makes a sea of two bands, waits for the
// transform's passes to run, and reads a small square of each band's heights back through the
// engine. It also asks the add-on's own thread for the same heights, from the same spectra, so the
// test can compare what the GPU drew with what the transform should give.
import { defineSketch } from '@null3d/engine';
import { createOcean, type OceanBand } from '@null3d/water';

/** The bands: two widths of tile, so a stage that mixes the bands' scales shows. */
const BANDS: readonly OceanBand[] = [
	{ tile: 64, height: 2, wind: 9, direction: 0.5, seed: 11 },
	{ tile: 16, height: 0.6, wind: 6, direction: 0.9, seed: 23 },
];

/** The side of the square that the test reads, in texels. */
const SIDE = 4;
/** The texel that the square starts at, away from the transform's first row and column. */
const FROM = 6;

export default defineSketch((ctx) => {
	const { scene, page, render, time } = ctx;
	scene.setBackground('#000000');
	const camera = scene.createPerspectiveCamera({ position: [0, 6, 18], target: [0, 0, 0] });
	scene.setActiveCamera(camera);
	const ocean = createOcean(ctx, { camera, bands: BANDS });
	const grid = 128;
	/** The sketch time at which the transform's programs are built on every path. */
	const READY = 1.5;
	/** The sketch time of the second read, which shows whether the sea moves between the two. */
	const LATER = 4;
	/** The reads made so far: 0 none, 1 the first, 2 both. */
	let round = 0;
	let posted = false;
	const results: {
		time: number;
		stamps: number[];
		gpu: number[][];
		slopes: number[][];
		frames: number[];
	}[] = [];
	const finish = (): void => {
		if (posted || round < 2) return;
		const [first, second] = results;
		page.post('waves', {
			time: first?.time ?? 0,
			stamps: first?.stamps ?? [],
			gpu: first?.gpu ?? [],
			cpu: cpuOf(first?.stamps ?? []),
			slopes: first?.slopes ?? [],
			cpuSlopes: cpuSlopesOf(first?.stamps ?? []),
			later: {
				time: second?.time ?? 0,
				gpu: second?.gpu ?? [],
				stamps: second?.stamps ?? [],
			},
			frames: first?.frames ?? [],
			tiles: ocean.bands.map((band) => band.tile),
			grid,
		});
		posted = true;
	};
	const cpuOf = (stamps: number[]): number[][] =>
		ocean.bands.map((band, layer) => {
			const values: number[] = [];
			for (let row = 0; row < SIDE; row++)
				for (let column = 0; column < SIDE; column++)
					values.push(
						ocean.bandHeightAt(
							layer,
							((FROM + column) / grid) * band.tile,
							((FROM + row) / grid) * band.tile,
							stamps[layer] as number,
						),
					);
			return values;
		});
	/**
	 * The slopes that the last pass writes, from the heights beside each texel, as the surface reads
	 * them: one along the row and one along the column, in meters a meter.
	 */
	const cpuSlopesOf = (stamps: number[]): number[][] =>
		ocean.bands.map((band, layer) => {
			const at = (column: number, row: number): number =>
				ocean.bandHeightAt(
					layer,
					((FROM + column) / grid) * band.tile,
					((FROM + row) / grid) * band.tile,
					stamps[layer] as number,
				);
			const texel = band.tile / grid;
			const values: number[] = [];
			for (let row = 0; row < SIDE; row++)
				for (let column = 0; column < SIDE; column++)
					values.push(
						(at(column + 1, row) - at(column - 1, row)) / (2 * texel),
						(at(column, row + 1) - at(column, row - 1)) / (2 * texel),
					);
			return values;
		});
	const read = (): void => {
		const at = time.now;
		const reads = ocean.bands.map((_, layer) =>
			render.readPass(ocean.bandsPass, { x: FROM, y: FROM, width: SIDE, height: SIDE, layer }),
		);
		void Promise.all(reads).then((found) => {
			const first = found;
			results.push({
				time: at,
				stamps: first.map((result) => result.data[3] as number),
				gpu: first.map((result) => {
					const values: number[] = [];
					for (let k = 0; k < result.data.length; k += 4) values.push(result.data[k] as number);
					return values;
				}),
				slopes: first.map((result) => {
					const values: number[] = [];
					for (let k = 0; k < result.data.length; k += 4)
						values.push(result.data[k + 1] as number, result.data[k + 2] as number);
					return values;
				}),
				frames: first.map((result) => result.frames),
			});
			round++;
			finish();
		});
	};
	return {
		onUpdate() {
			ocean.update();
			// The engine reports no signal for a pass whose program is still building, and a program
			// that is not built yet draws nothing. So the page waits until the scene has run a while.
			// A slower machine that this bound is too short for shows it as a field that the comparison
			// refuses, not as a test that passes on nothing.
			if (round === 0 && time.now >= READY) read();
			else if (round === 1 && time.now >= LATER) read();
		},
	};
});
