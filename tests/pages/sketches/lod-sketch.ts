// Levels of detail, for their image tests. A sphere has three lower levels, each in a color of its
// own, so the image shows which level each copy draws: red, then green, blue and yellow. Each row
// holds two copies of one switch, at 95% and 103% of the distance from the camera to the sphere's
// nearest point, so the second copy lies inside the hand-over band at every preset.
// Each copy stands where the rule puts that distance on this canvas, so it keeps its size on the
// screen at any canvas size. Settings: `?batch` draws the copies as rows of one instance batch,
// `?crisp` turns the fading bands off, so each copy past a switch draws its new level alone,
// `?mask` draws with a mask smoothed by alpha to coverage, as foliage does, which passes every
// pixel, `?shadows` draws one large copy in front of a wall, whose shadow draws a coarser level
// than the copy itself, and `?hide` raises the threshold and places copies around the hide distance.
import { defineSketch, type MeshArrays, type Vec3 } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
/** The vertical field of view in degrees, and the threshold in pixels: the largest a setting takes. */
const FOV = 40;
const THRESHOLD = params.has('hide') ? 16 : 2;
/** Each lower level's error, in the units of the base sphere, whose radius is 1. */
const ERRORS = [0.05, 0.1, 0.2];
/** The segments around each level, and its color, from the base level down. */
const LEVELS: [number, Vec3][] = [
	[24, [0.9, 0.25, 0.2]],
	[12, [0.25, 0.8, 0.3]],
	[8, [0.25, 0.45, 0.95]],
	[5, [0.95, 0.8, 0.2]],
];
/** Each copy's distance as a share of its switch distance: before and after. */
const SIDES = [0.95, 1.03];
/** Each copy's distance as a share of its hide distance: before the band, in it, and past it. */
const HIDE_SIDES = [0.95, 1.03, 1.09];
/** Each row's height on the screen, from -1 at the bottom to 1 at the top. */
const ROWS = [0.55, -0.1, -0.6];
/** The world radius of the base sphere, whose local radius is 1 at scale 1. */
const RADIUS = 1;

/** A sphere of radius 1 in one color, with `segments` around and half as many from pole to pole. */
function sphere(segments: number, color: Vec3): MeshArrays {
	const rings = Math.max(2, Math.floor(segments / 2));
	const positions: number[] = [];
	const colors: number[] = [];
	const indices: number[] = [];
	for (let r = 0; r <= rings; r++) {
		const polar = (r / rings) * Math.PI;
		for (let s = 0; s <= segments; s++) {
			const turn = (s / segments) * Math.PI * 2;
			positions.push(
				Math.sin(polar) * Math.cos(turn),
				Math.cos(polar),
				Math.sin(polar) * Math.sin(turn),
			);
			colors.push(...color);
		}
	}
	for (let r = 0; r < rings; r++)
		for (let s = 0; s < segments; s++) {
			const a = r * (segments + 1) + s;
			const b = a + segments + 1;
			indices.push(a, a + 1, b, b, a + 1, b + 1);
		}
	return { positions, normals: positions, colors, indices };
}

export default defineSketch(({ scene, geometry, materials, quality, engine }) => {
	const shadows = params.has('shadows');
	quality.set({ lodThreshold: THRESHOLD, lodFade: !params.has('crisp'), lodShadowFactor: 8 });
	scene.setBackground('#20242c');
	const camera = scene.createPerspectiveCamera({
		fov: FOV,
		near: 0.5,
		far: 400,
		position: [0, 0, 0],
		target: [0, 0, -1],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({
		direction: shadows ? [-1, -0.25, -0.6] : [-0.4, -0.6, -1],
		color: '#ffffff',
		intensity: 2.5,
		castShadows: shadows,
		shadow: { cascades: 1, mapSize: 2048, distance: 40 },
	});
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.6 });
	const [base, ...lower] = LEVELS.map(([segments, color]) =>
		geometry.fromArrays(sphere(segments, color)),
	);
	if (!base) return;
	base.setLevels(lower.map((mesh, k) => ({ mesh, error: ERRORS[k] as number })));
	const material = materials.standard({
		color: '#ffffff',
		roughness: 0.5,
		vertexColors: true,
		...(params.has('mask') && { alphaMode: 'mask' as const, alphaToCoverage: true }),
	});

	// The factor of the rule on this canvas: the drawn height in pixels times P[1][1], over twice
	// the threshold. A copy of scale 1 switches to level j past ERRORS[j - 1] times it.
	const tan = Math.tan((FOV * Math.PI) / 360);
	const factor = () =>
		(engine.viewport.height * engine.viewport.pixelRatio) / (2 * tan * THRESHOLD);
	const aspect = () => engine.viewport.width / engine.viewport.height;

	if (shadows) {
		// One copy whose nearest point lies at half its first switch distance, in front of a wall
		// that takes its shadow.
		const distance = 0.5 * (ERRORS[0] as number) * factor();
		const center = distance + RADIUS;
		scene.createMesh({
			mesh: base,
			material,
			position: [0, 0, -center],
			castShadows: true,
		});
		scene.createMesh({
			mesh: geometry.plane({ width: 40, height: 40 }),
			material: materials.standard({ color: '#c8c4bc' }),
			position: [0, 0, -center - 2.5],
			receiveShadows: true,
		});
		return;
	}

	// Where each copy stands: its row's switch distance, or the distance where its bound covers
	// fewer pixels than the threshold, times the side's share, with the bound's nearest point at
	// that distance. The hide copies stand in one row: the first draws the last level, the second
	// lies in the band that thins it out, and the third past the band, where nothing draws.
	const hide = params.has('hide');
	const places = (out: Vec3[]) => {
		const f = factor();
		const sides = hide ? HIDE_SIDES : SIDES;
		const rows = hide ? 1 : ROWS.length;
		for (let k = 0; k < rows * sides.length; k++) {
			const row = Math.floor(k / sides.length);
			const side = k % sides.length;
			const base = hide ? 2 : (ERRORS[row] as number);
			const distance = (sides[side] as number) * base * f;
			const center = distance + RADIUS;
			const across = hide ? (side - 1) * 0.6 : side === 0 ? -0.35 : 0.35;
			const y = hide ? 0 : (ROWS[row] as number) * center * tan;
			out[k] = [across * center * tan * aspect(), y, -center];
		}
		return out;
	};
	const spots: Vec3[] = places([]);
	if (params.has('batch')) {
		const batch = scene.createInstances(base, spots.length, { material, dynamic: true });
		const place = () => {
			for (const [k, spot] of places(spots).entries()) batch.positions.set(spot, k * 3);
		};
		place();
		return { onUpdate: place };
	}
	const copies = spots.map((position) =>
		scene.createMesh({ mesh: base, material, position, dynamic: true }),
	);
	return {
		onUpdate() {
			for (const [k, [x, y, z]] of places(spots).entries()) copies[k]?.setPosition(x, y, z);
		},
	};
});
