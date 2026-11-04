// Writes the stored plan. `bun --conditions=null3d-source examples/showcase/island/write-layout.ts`
// reads the frozen search from layout-base.json, adds the layers and writes layout.json, which the scene
// and its tests read. With `--search` it first runs the search again and rewrites the frozen file, which
// moves houses all over the island: one small change to any number of the search draws another plan.
// With `--check` it writes nothing, and fails if its result differs from the stored files.
import { readFileSync, writeFileSync } from 'node:fs';
import type { Lot } from './ground';
import {
	addLayers,
	clearWays,
	cutCircles,
	dropOffGround,
	dropSpareRoads,
	mendGates,
	shiftJoins,
	spaceJunctions,
} from './layers';
import type { Road, RoadPoint } from './routes';

const flat = (points: readonly { x: number; y: number; z: number }[]): number[] =>
	points.flatMap(({ x, y, z }) => [Math.round(x * 100), Math.round(y * 1000), Math.round(z * 100)]);
const unflat = (f: readonly number[]): RoadPoint[] => {
	const points: RoadPoint[] = [];
	for (let k = 0; k + 2 < f.length; k += 3)
		points.push({
			x: (f[k] as number) / 100,
			y: (f[k + 1] as number) / 1000,
			z: (f[k + 2] as number) / 100,
		});
	return points;
};
const lotRow = (lot: Lot, roads: readonly Road[]): number[] => [
	Math.round(lot.x * 100),
	Math.round(lot.y * 100),
	Math.round(lot.z * 100),
	Math.round(lot.yaw * 10000),
	lot.kind,
	lot.garden,
	roads.indexOf(lot.road),
	lot.road.points.indexOf(lot.gate),
	Math.round(lot.plot[0] * 100),
	Math.round(lot.plot[1] * 100),
	Math.round(lot.plot[2] * 100),
	Math.round(lot.reach * 100),
	Math.round(lot.tone * 1000),
];
const packRoads = (roads: readonly Road[]) =>
	roads.map(({ half, end, radius, points }) => ({ half, end, radius, points: flat(points) }));

const baseFile = new URL('./layout-base.json', import.meta.url);
let baseText = readFileSync(baseFile, 'utf8');
if (process.argv.includes('--search')) {
	const { NETWORK, STAIRS } = await import('./layout');
	const { roads, lots } = NETWORK;
	const searched = `${JSON.stringify({
		roads: packRoads(roads),
		lots: lots.map((lot) => lotRow(lot, roads)),
		stairs: STAIRS.map(flat),
	})}\n`;
	if (process.argv.includes('--check')) {
		if (searched !== baseText) {
			console.error('the search does not make the frozen plan');
			process.exit(1);
		}
	} else writeFileSync(baseFile, searched);
	baseText = searched;
}
const base = JSON.parse(baseText) as {
	roads: { half: number; end: Road['end']; radius: number; points: number[] }[];
	lots: number[][];
	stairs: number[][];
};
const roads: Road[] = base.roads.map((road) => ({ ...road, points: unflat(road.points) }));
const lots: Lot[] = base.lots.map((f) => {
	const road = roads[f[6] as number] as Road;
	return {
		x: (f[0] as number) / 100,
		y: (f[1] as number) / 100,
		z: (f[2] as number) / 100,
		yaw: (f[3] as number) / 10000,
		kind: f[4] as number,
		garden: f[5] as number,
		road,
		gate: road.points[f[7] as number] as RoadPoint,
		plot: [(f[8] as number) / 100, (f[9] as number) / 100, (f[10] as number) / 100],
		reach: (f[11] as number) / 100,
		tone: (f[12] as number) / 1000,
	};
});
const stairs = base.stairs.map(unflat);
const moved = spaceJunctions(roads);
shiftJoins(roads);
cutCircles(roads);
mendGates(lots);
const { added, stairRoads, counts } = addLayers(roads, lots, stairs);
const ways = clearWays(dropOffGround([...lots, ...added], stairs));
const staying = dropSpareRoads(roads, ways.lots);
const every = [...staying.roads, ...stairRoads];
const text = `${JSON.stringify({
	baseHouses: lots.length,
	roads: packRoads(staying.roads),
	lots: staying.lots.map((lot) => lotRow(lot, every)),
	stairs: base.stairs,
})}\n`;
const target = new URL('./layout.json', import.meta.url);
if (process.argv.includes('--check')) {
	if (readFileSync(target, 'utf8') !== text) {
		console.error('the tool does not make the stored plan');
		process.exit(1);
	}
	process.exit(0);
}
writeFileSync(target, text);
console.log(
	`${roads.length} roads, ${lots.length} houses of the search, ${JSON.stringify(counts)} added, ${moved} junctions moved, ${ways.moved} gates moved, ${ways.gone} houses without a way gone, ${ways.lots.length} houses, ${text.length} bytes`,
);
