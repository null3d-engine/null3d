// The garden's planting. The trees stand by hand where the concept has them, so the test holds each
// to its scale, to growing ground, seated, clear of the rocks and the steps, and out of the view to
// the statue. The ground cover is held to each mask through that mask's own function, not through
// the rule that places it, so a mask dropped from the rule fails here; and to its budget.
import { expect, test } from 'bun:test';
import { gardenPlaces, terraceStones } from './garden';
import {
	alongFlight,
	bearingOf,
	flights,
	gravelPlace,
	groundHeight,
	islandDistance,
	LANDING,
	rimRadius,
	STAIRS,
	streamHalf,
	streamZ,
	TERRACE,
} from './land';
import { WIDE } from './route';
import { onSteps } from './steps';
import { ROCK_REACH, rockPlaces } from './stones';
import {
	crownOf,
	GROUND_BUDGET,
	groundTriangles,
	MAPLE_SPOTS,
	PLANT_KINDS,
	type PlantKind,
	placeValley,
	SCALE,
	SIZES,
	type Spot,
	TREES,
	TRUNK,
	type TreeKind,
	underSolid,
} from './valley';

const valley = placeValley();
const all: readonly Spot[] = [...valley.trees, ...valley.plants];
/**
 * The garden's models, each kind listed here from the garden's own places with its own footprint,
 * so a kind left out of the placing rule still fails the tests.
 */
const models = (() => {
	const places = gardenPlaces();
	return [
		...[places.statue].map((f) => ({ ...f, kind: 'the statue' })),
		...[places.gate].map((f) => ({ ...f, kind: 'the gate' })),
		...places.lanterns.map((f) => ({ ...f, kind: 'a lantern' })),
		...places.rocks.map((f) => ({ ...f, kind: 'a hill rock' })),
		...places.ring.map((f) => ({ ...f, kind: "a block of the ledge's ring" })),
		...terraceStones().map((f) => ({ ...f, kind: 'a terrace wall stone' })),
	];
})();

test('each tree stands at its scale, on growing ground, seated, clear of the rocks, its trunk off the steps', () => {
	// Every pine of the list stands: none is dropped for the camera's route.
	expect(valley.trees.filter((tree) => tree.kind !== 'maple').length).toBe(TREES.length);
	TREES.forEach(([label, , , kind, size], k) => {
		const tree = valley.trees[k] as Spot;
		const at = `${label}, the ${kind} at ${tree.x}, ${tree.z}`;
		const [low, high] = SCALE[label] ?? [0, 0];
		const height = SIZES[kind].height * size;
		expect(height, `${at}: its height against the scale table`).toBeGreaterThanOrEqual(low);
		expect(height, `${at}: its height against the scale table`).toBeLessThanOrEqual(high);
		// Its foot lies a little into the ground, so no root shows air under it.
		expect(tree.y - groundHeight(tree.x, tree.z), `${at} over the ground`).toBeLessThan(0);
		// Its trunk's base keeps off every model's footprint: the rocks, the walls' stones, the
		// lanterns, the gate and the statue.
		for (const model of models)
			expect(
				Math.hypot(tree.x - model.x, tree.z - model.z),
				`${at}: its trunk into ${model.kind} at ${model.x.toFixed(1)}, ${model.z.toFixed(1)}`,
			).toBeGreaterThan(model.reach + TRUNK * size);
		// Its trunk and foot keep off the steps; its crown may reach over their edge, as the concept's
		// does, but not past their middle line.
		for (const flight of flights()) {
			const { t, side } = alongFlight(flight, tree.x, tree.z);
			if (t > -0.1 && t < 1.1) {
				expect(side - STAIRS.half, `${at}: its trunk on the steps`).toBeGreaterThan(TRUNK * size);
				expect(side, `${at}: its crown past the steps' middle`).toBeGreaterThan(
					SIZES[kind].reach * size,
				);
			}
		}
		for (const other of valley.trees) {
			if (other === tree) continue;
			// Crowns may touch, as the concept's do, but no two trunks stand within each other's crown.
			const room =
				(SIZES[tree.kind as TreeKind].reach * tree.size +
					SIZES[other.kind as TreeKind].reach * other.size) *
				0.4;
			expect(
				Math.hypot(tree.x - other.x, tree.z - other.z),
				`${at} crowding another`,
			).toBeGreaterThan(room);
		}
	});
});

test('nothing grows past the rim, in the creek or on its stones, on the steps, landing, terrace or gravel, or under the garden', () => {
	const stones = rockPlaces();
	for (const spot of all) {
		const { x, z } = spot;
		const at = `the ${spot.kind} at ${x.toFixed(1)}, ${z.toFixed(1)}`;
		expect(Math.hypot(x, z), `${at} past the rim`).toBeLessThan(rimRadius(bearingOf(x, z)) - 0.5);
		expect(Math.abs(z - streamZ(x)), `${at} in the creek or on its banks`).toBeGreaterThan(
			streamHalf(x) * 1.2,
		);
		for (const stone of stones)
			expect(Math.hypot(x - stone.x, z - stone.z), `${at} on a creek stone`).toBeGreaterThan(
				stone.size * ROCK_REACH,
			);
		expect(onSteps(x, z), `${at} on the steps`).toBe(false);
		expect(Math.hypot(x - LANDING.x, z - LANDING.z), `${at} on the landing`).toBeGreaterThan(
			LANDING.radius,
		);
		expect(Math.hypot(x - TERRACE.x, z - TERRACE.z), `${at} on the terrace`).toBeGreaterThan(
			TERRACE.top,
		);
		// Off the gravel, but for the moss islands in it.
		expect(gravelPlace(x, z).edge > 0 || islandDistance(x, z) < 0, `${at} on the gravel`).toBe(
			true,
		);
		for (const model of models)
			expect(Math.hypot(x - model.x, z - model.z), `${at} under ${model.kind}`).toBeGreaterThan(
				model.reach,
			);
	}
});

test('no tree or plant stands in the opening view of the statue, read along sampled lines', () => {
	const { statue } = gardenPlaces();
	// Lines from the opening camera to the statue's foot, chest, head and knees, sampled every 0.25 m.
	const targets = [
		[0, 1, 0],
		[0, 4, 0],
		[0, 7.5, 0],
		[-3, 1.5, 0],
		[3, 1.5, 0],
	].map(([ox, oy, oz]) => [
		statue.x + (ox as number),
		statue.y + (oy as number) * statue.size,
		statue.z + (oz as number),
	]);
	for (const spot of all) {
		const crown = crownOf(spot);
		for (const target of targets) {
			const length = Math.hypot(...target.map((v, i) => (v as number) - (WIDE[i] as number)));
			for (let d = 0; d < length; d += 0.25) {
				const p = target.map(
					(v, i) => (WIDE[i] as number) + (((v as number) - (WIDE[i] as number)) * d) / length,
				);
				const inside =
					(p[1] as number) < crown.top && underSolid(crown, p[0] as number, p[2] as number);
				expect(
					inside,
					`the ${spot.kind} at ${spot.x.toFixed(1)}, ${spot.z.toFixed(1)} in the view to the statue`,
				).toBe(false);
			}
		}
	}
});

test('every maple stands near its mapped place, at about its mapped width, seated and clear', () => {
	const maples = valley.trees.filter((tree) => tree.kind === 'maple');
	expect(maples).toHaveLength(MAPLE_SPOTS.length);
	MAPLE_SPOTS.forEach(([label, x, z, color, width], k) => {
		const maple = maples[k] as Spot;
		const at = `${label}, the ${color} maple at ${maple.x.toFixed(1)}, ${maple.z.toFixed(1)}`;
		expect(maple.color, `${at}: its color`).toBe(color);
		expect(
			Math.hypot(maple.x - x, maple.z - z),
			`${at}: from its mapped place`,
		).toBeLessThanOrEqual(4);
		const drawn = SIZES.maple.reach * 2 * maple.size;
		expect(drawn, `${at}: its width against the map's`).toBeLessThanOrEqual(width + 1e-6);
		expect(drawn, `${at}: its width against the map's`).toBeGreaterThanOrEqual(width * 0.7 - 1e-6);
		expect(maple.y - groundHeight(maple.x, maple.z), `${at} over the ground`).toBeLessThan(0);
		for (const model of models)
			expect(
				Math.hypot(maple.x - model.x, maple.z - model.z),
				`${at}: its trunk into ${model.kind}`,
			).toBeGreaterThan(model.reach + TRUNK * maple.size);
		expect(onSteps(maple.x, maple.z), `${at}: its trunk on the steps`).toBe(false);
	});
});

test("the ground cover holds the planting map's kinds within its triangle budget", () => {
	const counts = Object.fromEntries(PLANT_KINDS.map((kind) => [kind, 0])) as Record<
		PlantKind,
		number
	>;
	for (const plant of valley.plants) counts[plant.kind as PlantKind]++;
	// The planting map's rough counts: conifers at the rims, clipped shrubs, azaleas, many autumn
	// clumps and moss cushions, with ferns and hostas under them.
	expect(counts['rim-conifer']).toBeGreaterThanOrEqual(4);
	expect(counts['clipped-shrub']).toBeGreaterThanOrEqual(6);
	expect(counts.azalea).toBeGreaterThanOrEqual(8);
	expect(counts['autumn-clump']).toBeGreaterThanOrEqual(35);
	expect(counts['moss-cushion']).toBeGreaterThanOrEqual(30);
	const { full, drawn } = groundTriangles(valley.plants);
	console.log(
		`the ground cover: ${full} triangles at its finest level, ${drawn} drawn from the opening camera`,
	);
	expect(drawn, 'the ground cover drawn from the opening camera').toBeLessThanOrEqual(
		GROUND_BUDGET,
	);
	expect(drawn).toBeLessThan(full);
});
