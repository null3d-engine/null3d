// Levels of detail, for their image tests. A sphere has three lower levels, each in a color of its
// own, so the image shows which level each copy draws: red, then green, blue and yellow. Each row
// holds two copies of one switch, at 94% and 106% of the distance where its level switches in.
// Each copy stands where the rule puts that distance on this canvas, so it keeps its size on the
// screen at any canvas size. Settings: `?batch` draws the copies as rows of one instance batch,
// `?crisp` turns the fading bands off, so each copy past a switch draws its new level alone, and
// `?shadows` draws one large copy in front of a wall, whose shadow draws a coarser level than the
// copy itself.
import { defineSketch, type MeshArrays, type Vec3 } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
/** The threshold in pixels, and the camera's vertical field of view in degrees. */
const THRESHOLD = 2;
const FOV = 40;
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
const SIDES = [0.94, 1.06];
/** Each row's height on the screen, from -1 at the bottom to 1 at the top. */
const ROWS = [0.55, -0.1, -0.6];

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
	const material = materials.standard({ color: '#ffffff', roughness: 0.5, vertexColors: true });

	// The factor of the rule on this canvas: the drawn height in pixels times P[1][1], over twice
	// the threshold. A copy of scale 1 switches to level j past ERRORS[j - 1] times it.
	const tan = Math.tan((FOV * Math.PI) / 360);
	const factor = () =>
		(engine.viewport.height * engine.viewport.pixelRatio) / (2 * tan * THRESHOLD);
	const aspect = () => engine.viewport.width / engine.viewport.height;

	if (shadows) {
		// One copy at half its first switch distance, in front of a wall that takes its shadow.
		const distance = 0.5 * (ERRORS[0] as number) * factor();
		scene.createMesh({ mesh: base, material, position: [0, 0, -distance], castShadows: true });
		scene.createMesh({
			mesh: geometry.plane({ width: 40, height: 40 }),
			material: materials.standard({ color: '#c8c4bc' }),
			position: [0, 0, -distance - 2.5],
			receiveShadows: true,
		});
		return;
	}

	// Where each copy stands: its row and side on the screen, at its share of its switch distance.
	const places = (out: Vec3[]) => {
		const f = factor();
		for (let k = 0; k < ROWS.length * SIDES.length; k++) {
			const row = Math.floor(k / SIDES.length);
			const side = k % SIDES.length;
			const distance = (SIDES[side] as number) * (ERRORS[row] as number) * f;
			const x = (side === 0 ? -0.35 : 0.35) * distance * tan * aspect();
			const y = (ROWS[row] as number) * distance * tan;
			out[k] = [x, y, -distance];
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
