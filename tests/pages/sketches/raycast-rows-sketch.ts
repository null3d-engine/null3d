// Raycasts against sprite, point and line rows, against three.js's Raycaster on the same rows. The
// scene has sprites sized in world units and in pixels, turned and with an anchor off their middle,
// points of both kinds, a strip and a loop sized in pixels and segments sized in world units. Each
// row has a twin in three.js: a Sprite for each sprite and each point's square, Line2 and
// LineSegments2 for the lines, and for the thresholds a Points cloud and a Line, LineSegments and
// LineLoop.
//
// On 'results' it posts how two comparisons went. Rays from the camera through the canvas must
// give the hits of the Sprite and Line2 twins. Rays from anywhere, with three.js's point and line
// thresholds, must give the hits of the Points and Line twins. On 'targets' it posts a point of the
// canvas over a sprite, a point and a line, with what a raycast through each hits, and on 'clicks'
// what its click handlers saw. On 'picture' it posts, for each pixel of the canvas, the batch that
// a ray through its center hits, so the page can check that rays hit what the frame draws.
import {
	defineSketch,
	type LineBatch,
	type PointBatch,
	type QueryTarget,
	type RaycastHit,
	type RaycastOptions,
	type SpriteBatch,
} from '@null3d/engine';
import {
	BufferGeometry,
	Float32BufferAttribute,
	type Intersection,
	Line,
	LineLoop,
	LineSegments,
	PerspectiveCamera,
	Points,
	Raycaster,
	Sprite,
	SpriteMaterial,
	type Object3D as ThreeObject,
	Vector3,
} from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import {
	ROW_BATCHES,
	ROW_PIXEL_EDGE,
	ROW_PIXEL_NONE,
	ROWS_HEIGHT,
	ROWS_WIDTH,
	type RowRaycastResults,
	type RowTarget,
} from '../lib/raycast-rows';

/** Distances may differ by this share: 32-bit rows and camera against three.js's 64-bit numbers. */
const TOLERANCE = 2e-4;
const FOV = 50;
const EYE = [0, 3, 28] as const;
const POINT_THRESHOLD = 0.4;
const LINE_THRESHOLD = 0.25;
/** How far from a pixel's center its other rays start, in CSS pixels, to find edges. */
const EDGE_REACH = 0.7;

/** A small seeded generator, so every run builds the same scene and casts the same rays. */
function generator(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** The colors of the batches, in the order of `ROW_BATCHES`. */
const COLORS = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffffff'];

export default defineSketch(async ({ scene, page, post }) => {
	const random = generator(11);
	const range = (lo: number, hi: number) => lo + (hi - lo) * random();
	post.set({ toneMapping: 'none' });
	scene.setBackground('#000000');
	const camera = scene.createPerspectiveCamera({
		fov: FOV,
		near: 0.5,
		far: 120,
		position: [...EYE],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	const twinCamera = new PerspectiveCamera(FOV, ROWS_WIDTH / ROWS_HEIGHT, 0.5, 120);
	twinCamera.position.set(...EYE);
	twinCamera.lookAt(0, 0, 0);
	twinCamera.updateMatrixWorld(true);
	/** The world size of one CSS pixel at a depth of 1, which three.js's sprite scale counts in. */
	const pixel = (2 * Math.tan((FOV * Math.PI) / 360)) / ROWS_HEIGHT;
	const place = (): [number, number, number] => [range(-12, 12), range(-6, 6), range(-15, 10)];

	/** The three.js twins: drawn shapes for rays from the camera, thresholds for the others. */
	const shapes: ThreeObject[] = [];
	const thresholds: ThreeObject[] = [];
	/** Turns a three.js hit into the batch and row it stands for. */
	const keyOf = (hit: Intersection): string => {
		const { batch, rows } = hit.object.userData as { batch: number; rows: string };
		const row =
			rows === 'sprite'
				? (hit.object.userData.row as number)
				: rows === 'pairs'
					? (hit.index as number) / 2
					: rows === 'segment'
						? (hit.faceIndex as number)
						: (hit.index as number);
		return `${ROW_BATCHES[batch]}#${row}`;
	};
	const tag = (object: ThreeObject, batch: number, rows: string, row = -1) => {
		object.userData = { batch, rows, row };
		return object;
	};

	/** A sprite twin of each row of a sprite or point batch. */
	const spriteTwins = (
		batch: number,
		positions: number[][],
		sizes: number[][],
		rotations: number[],
		center: [number, number],
		screen: boolean,
	) => {
		positions.forEach((p, row) => {
			const material = new SpriteMaterial({
				rotation: rotations[row] ?? 0,
				sizeAttenuation: !screen,
			});
			const sprite = new Sprite(material);
			sprite.center.set(...center);
			const [w, h] = sizes[row] as number[];
			const scale = screen ? pixel : 1;
			sprite.scale.set((w as number) * scale, (h as number) * scale, 1);
			sprite.position.fromArray(p);
			shapes.push(tag(sprite, batch, 'sprite', row));
		});
	};

	const batches: (SpriteBatch | PointBatch | LineBatch)[] = [];
	/** Two sprite batches: sized in world units with an anchor off their middle, and in pixels. */
	for (const [batch, screen, count] of [
		[0, false, 40],
		[1, true, 25],
	] as const) {
		const center: [number, number] = screen ? [0.5, 0.5] : [0.3, 0.2];
		const sprites = await scene.createSprites({
			count,
			sizeAttenuation: !screen,
			center,
			alphaMode: 'opaque',
			color: COLORS[batch],
		});
		const positions = Array.from({ length: count }, place);
		const sizes = positions.map(() =>
			screen ? [range(6, 30), range(6, 30)] : [range(0.4, 2.5), range(0.4, 2.5)],
		);
		const rotations = positions.map(() => range(-Math.PI, Math.PI));
		positions.forEach((p, row) => {
			sprites.positions.set(p, row * 3);
			sprites.sizes.set(sizes[row] as number[], row * 2);
		});
		sprites.rotations.set(rotations);
		sprites.markDirty();
		spriteTwins(batch, positions, sizes, rotations, center, screen);
		batches.push(sprites);
	}
	/** Two point batches: 0.6 m wide, and 10 pixels wide. */
	for (const [batch, screen, count, size] of [
		[2, false, 40, 0.6],
		[3, true, 30, 10],
	] as const) {
		const positions = Array.from({ length: count }, place);
		const points = await scene.createPoints({
			positions: positions.flat(),
			size,
			sizeAttenuation: !screen,
			color: COLORS[batch],
		});
		spriteTwins(
			batch,
			positions,
			positions.map(() => [size, size]),
			[],
			[0.5, 0.5],
			screen,
		);
		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new Float32BufferAttribute(positions.flat(), 3));
		thresholds.push(tag(new Points(geometry), batch, 'points'));
		batches.push(points);
	}
	/** A strip 5 pixels wide, segments 0.5 m wide, and a loop 3 pixels wide. */
	for (const [batch, mode, count, width, worldUnits] of [
		[4, 'strip', 24, 5, false],
		[5, 'segments', 24, 0.5, true],
		[6, 'loop', 10, 3, false],
	] as const) {
		const positions: number[] = [];
		let at = place();
		for (let k = 0; k < count; k++) {
			at =
				mode === 'segments' && k % 2 === 0
					? place()
					: (at.map((v) => v + range(-4, 4)) as typeof at);
			positions.push(...at);
		}
		const lines = await scene.createLines({
			positions,
			mode,
			width,
			worldUnits,
			color: COLORS[batch],
		});
		const material = new LineMaterial({ linewidth: width, worldUnits });
		material.resolution.set(ROWS_WIDTH, ROWS_HEIGHT);
		if (mode === 'strip') {
			const geometry = new LineGeometry();
			geometry.setPositions(positions);
			shapes.push(tag(new Line2(geometry, material), batch, 'segment'));
		} else {
			// A loop's segments, the closing one last, as LineSegments2 takes them.
			const pairs =
				mode === 'segments'
					? positions
					: Array.from({ length: count }, (_, k) => [
							...positions.slice(k * 3, k * 3 + 3),
							...positions.slice(((k + 1) % count) * 3, ((k + 1) % count) * 3 + 3),
						]).flat();
			const geometry = new LineSegmentsGeometry();
			geometry.setPositions(pairs);
			shapes.push(tag(new LineSegments2(geometry, material), batch, 'segment'));
		}
		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
		const thin =
			mode === 'strip'
				? new Line(geometry)
				: mode === 'segments'
					? new LineSegments(geometry)
					: new LineLoop(geometry);
		thresholds.push(tag(thin, batch, mode === 'segments' ? 'pairs' : 'index'));
		batches.push(lines);
	}
	// The sprite twins stand in the threshold comparison too: thresholds reach points, not sprites.
	thresholds.push(...shapes.filter((s) => (s.userData.batch as number) < 2));
	for (const twin of [...shapes, ...thresholds]) twin.updateMatrixWorld(true);

	const nameOf = (object: QueryTarget | null, instance: number) => {
		const k = batches.indexOf(object as SpriteBatch);
		return k < 0 ? 'none' : `${ROW_BATCHES[k]}#${instance}`;
	};
	const raycaster = new Raycaster();
	raycaster.camera = twinCamera;
	raycaster.params.Points.threshold = POINT_THRESHOLD;
	raycaster.params.Line.threshold = LINE_THRESHOLD;
	const results: RowRaycastResults = {
		cameraRays: 0,
		thresholdRays: 0,
		rowHits: 0,
		hitsByBatch: {},
		mismatches: 0,
		examples: [],
	};
	const mismatch = (text: string) => {
		results.mismatches++;
		if (results.examples.length < 12) results.examples.push(text);
	};
	const hits: RaycastHit[] = [];
	const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(b));

	/** Casts one ray through both scenes, with `options` against `twins`, and records how they differ. */
	const compare = (
		origin: number[],
		direction: number[],
		options: RaycastOptions,
		twins: ThreeObject[],
		what: string,
	) => {
		raycaster.set(new Vector3(...origin), new Vector3(...direction).normalize());
		raycaster.far = options.maxDistance ?? Infinity;
		const want = new Map<string, number>();
		// three.js's Line2 and LineSegments2 ignore the raycaster's far limit; its other objects keep
		// it, as null3D keeps maxDistance for every row.
		for (const hit of raycaster.intersectObjects(twins, false))
			if (hit.distance <= raycaster.far && !want.has(keyOf(hit)))
				want.set(keyOf(hit), hit.distance);
		const count = scene.raycastAll(origin, direction, options, hits);
		const got = new Map<string, number>();
		for (const hit of hits.slice(0, count)) got.set(nameOf(hit.object, hit.instance), hit.distance);
		for (const [key, distance] of want)
			if (!got.has(key) || !near(got.get(key) as number, distance))
				mismatch(`${what}: lacks ${key} at ${distance}, got ${got.get(key)}`);
		for (const key of got.keys()) if (!want.has(key)) mismatch(`${what}: adds ${key}`);
		for (const key of got.keys()) {
			const batch = key.split('#')[0] as string;
			results.hitsByBatch[batch] = (results.hitsByBatch[batch] ?? 0) + 1;
		}
		results.rowHits += got.size;
	};

	const ray = { origin: [0, 0, 0], direction: [0, 0, 0] };
	const screen = [0, 0, 0];
	/** A point of the canvas: near a random row's position on the screen, or anywhere. */
	const screenPoint = () => {
		if (random() < 0.3) return [range(0, ROWS_WIDTH), range(0, ROWS_HEIGHT)];
		camera.worldToScreen(place(), screen);
		return [(screen[0] as number) + range(-6, 6), (screen[1] as number) + range(-6, 6)];
	};
	const allPositions = () => {
		const out: number[][] = [];
		for (const batch of batches)
			for (let k = 0; k < batch.positions.length; k += 3)
				out.push([...batch.positions.subarray(k, k + 3)]);
		return out;
	};

	const compareAll = () => {
		// Rays from the camera, as pointer events cast them, against the drawn shapes.
		const targets = allPositions();
		for (let r = 0; r < 800; r++) {
			let point = screenPoint();
			if (random() < 0.6) {
				camera.worldToScreen(targets[Math.floor(random() * targets.length)] as number[], screen);
				point = [(screen[0] as number) + range(-8, 8), (screen[1] as number) + range(-8, 8)];
			}
			camera.screenToRay(point[0] as number, point[1] as number, ray);
			const options = r % 7 === 3 ? { maxDistance: range(15, 40) } : {};
			compare(ray.origin, ray.direction, options, shapes, `camera ray ${r} at ${point}`);
			results.cameraRays++;
		}
		// Rays from anywhere near, toward a row, with three.js's thresholds.
		const options = { pointThreshold: POINT_THRESHOLD, lineThreshold: LINE_THRESHOLD };
		for (let r = 0; r < 800; r++) {
			const goal = targets[Math.floor(random() * targets.length)] as number[];
			const origin = goal.map((v) => v + range(-25, 25));
			const direction = goal.map((v, k) => v - (origin[k] as number) + range(-0.6, 0.6));
			compare(origin, direction, options, thresholds, `threshold ray ${r}`);
			results.thresholdRays++;
		}
	};

	const clicks: string[] = [];
	batches.forEach((batch) => {
		batch.on('click', (event) => clicks.push(nameOf(event.object, event.instance)));
	});
	const hit: RaycastHit = {
		object: null,
		instance: -1,
		point: [0, 0, 0],
		normal: [0, 0, 0],
		distance: 0,
		triangle: -1,
	};
	/**
	 * The canvas points over a sprite, a point and a line, and what a ray through each hits: the
	 * first row of each batch whose anchor, or whose segment's middle, no other row hides, and that
	 * lies on the canvas.
	 */
	const targetsOf = (): RowTarget[] =>
		[0, 2, 4].map((batch) => {
			const positions = (batches[batch] as SpriteBatch).positions;
			const rows = batch === 4 ? positions.length / 3 - 1 : positions.length / 3;
			for (let row = 0; row < rows; row++) {
				const at = [0, 1, 2].map((k) =>
					batch === 4
						? ((positions[row * 3 + k] as number) + (positions[row * 3 + 3 + k] as number)) / 2
						: (positions[row * 3 + k] as number),
				);
				camera.worldToScreen(at, screen);
				const [x, y] = [screen[0] as number, screen[1] as number];
				if (!(x > 2 && x < ROWS_WIDTH - 2 && y > 2 && y < ROWS_HEIGHT - 2)) continue;
				camera.screenToRay(x, y, ray);
				if (!scene.raycast(ray.origin, ray.direction, undefined, hit)) continue;
				if (hit.object === batches[batch] && hit.instance === row)
					return { batch: ROW_BATCHES[batch] as string, x, y, hit: nameOf(hit.object, row) };
			}
			throw new Error(`no row of ${ROW_BATCHES[batch]} shows on the canvas`);
		});

	/** The batch that a ray through a point of the canvas hits, or `ROW_PIXEL_NONE`. */
	const classAt = (x: number, y: number) => {
		camera.screenToRay(x, y, ray);
		if (!scene.raycast(ray.origin, ray.direction, undefined, hit)) return ROW_PIXEL_NONE;
		return batches.indexOf(hit.object as SpriteBatch);
	};
	/** Each pixel's batch, or `ROW_PIXEL_EDGE` where rays near its center disagree. */
	const picture = () => {
		const classes = new Uint8Array(ROWS_WIDTH * ROWS_HEIGHT);
		for (let y = 0; y < ROWS_HEIGHT; y++)
			for (let x = 0; x < ROWS_WIDTH; x++) {
				const [cx, cy] = [x + 0.5, y + 0.5];
				const center = classAt(cx, cy);
				const steady = [
					[-EDGE_REACH, 0],
					[EDGE_REACH, 0],
					[0, -EDGE_REACH],
					[0, EDGE_REACH],
				].every(([dx, dy]) => classAt(cx + (dx as number), cy + (dy as number)) === center);
				classes[y * ROWS_WIDTH + x] = steady ? center : ROW_PIXEL_EDGE;
			}
		return classes;
	};

	let frame = 0;
	const asked: string[] = [];
	page.onMessage((name) => asked.push(name));
	return {
		onLateUpdate() {
			frame++;
			// By the second frame, every row has its place.
			if (frame === 2) compareAll();
			if (frame < 2) return;
			for (const name of asked.splice(0)) {
				if (name === 'results') page.post('results', results);
				if (name === 'targets') page.post('targets', targetsOf());
				if (name === 'clicks') page.post('clicks', clicks);
				if (name === 'picture') page.post('picture', picture());
			}
		},
	};
});
