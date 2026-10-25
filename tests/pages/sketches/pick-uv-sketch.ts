// Surfaces whose texture coordinates make a pick's answer easy to get wrong: one set repeated
// beyond 0 to 1, one behind a texture transform, one with no coordinates at all, and a batch whose
// rows differ in scale. The page reports, for points on them, what `scene.pick` says and what a
// raycast through the same point says, so the two answers meet on the same texel.
import { defineSketch } from '@null3d/engine';

/** The camera's field of view, and its distance from the surfaces. */
const FOV = 60;
const DISTANCE = 15;
/** The half-size of each test quad, in meters. */
const HALF = 1;
/** The columns of the surfaces, in meters across the view. */
const COLUMNS = [-8, -4, 0, 4, 8];
/** The heights and scales of the batch's rows. */
const ROWS = [
	{ y: -2.5, scale: 0.5 },
	{ y: 0, scale: 1 },
	{ y: 2.5, scale: 0.5 },
];
/** A texture coordinate set that repeats four times across the surface. */
const REPEAT = 4;

/** A point to ask about: its surface, its place in the world and the coordinates it must give. */
interface Probe {
	surface: string;
	instance: number;
	world: [number, number, number];
	uv: [number, number] | null;
}

/** What a query or a pick said about a point. */
interface Said {
	object: string;
	instance: number;
	hasUv: boolean;
	uv: [number, number] | null;
}

/** One probe's answers from the two ways of asking. */
interface Answered {
	surface: string;
	instance: number;
	expected: [number, number] | null;
	screen: [number, number];
	ray: Said | null;
	pick: Said | null;
}

export default defineSketch(({ scene, geometry, materials, page }) => {
	const camera = scene.createPerspectiveCamera({
		fov: FOV,
		position: [0, 0, DISTANCE],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createAmbientLight({ intensity: 2 });

	const quad = (uvs?: readonly number[]) =>
		geometry.fromArrays({
			positions: new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]),
			uvs: uvs ? new Float32Array(uvs) : undefined,
			indices: new Uint16Array([0, 1, 2, 2, 1, 3]),
			computeNormals: true,
		});
	const square = [0, 0, 1, 0, 0, 1, 1, 1];
	const paint = materials.standard({ color: '#8090a0' });
	const plain = scene.createMesh({
		name: 'plain',
		mesh: quad(square),
		material: paint,
		position: [COLUMNS[0] as number, 0, 0],
	});
	const repeated = scene.createMesh({
		name: 'repeated',
		mesh: quad(square.map((value) => value * REPEAT)),
		material: paint,
		position: [COLUMNS[1] as number, 0, 0],
	});
	// The transform changes how the material samples the texture, not the mesh's own coordinates.
	const transformed = scene.createMesh({
		name: 'transformed',
		mesh: quad(square),
		material: materials.standard({
			color: '#8090a0',
			uvTransform: { offset: [0.5, 0.25], repeat: [2, 3], rotation: 0.25 },
		}),
		position: [COLUMNS[2] as number, 0, 0],
	});
	const bare = scene.createMesh({
		name: 'bare',
		mesh: quad(),
		material: paint,
		position: [COLUMNS[3] as number, 0, 0],
	});
	const batch = scene.createInstances(quad(square), ROWS.length, { material: paint });
	for (let row = 0; row < ROWS.length; row++) {
		const { y, scale } = ROWS[row] as (typeof ROWS)[number];
		batch.positions.set([COLUMNS[4] as number, y, 0], row * 3);
		batch.scales.set([scale, scale, 1], row * 3);
	}
	batch.markDirty();

	/** The name of a target that an answer names. */
	const names = new Map<unknown, string>([
		[plain, 'plain'],
		[repeated, 'repeated'],
		[transformed, 'transformed'],
		[bare, 'bare'],
		[batch, 'instances'],
	]);
	const nameOf = (object: unknown): string => (object ? (names.get(object) ?? 'other') : '');

	/** A probe on a quad centred at (`x`, `y`), `dx` and `dy` from its centre, in meters. */
	const quadProbe = (
		surface: string,
		x: number,
		y: number,
		dx: number,
		dy: number,
		repeat = 1,
	): Probe => ({
		surface,
		instance: -1,
		world: [x + dx, y + dy, 0],
		uv: [repeat * ((dx / HALF + 1) / 2), repeat * ((dy / HALF + 1) / 2)],
	});

	const probes: Probe[] = [
		quadProbe('plain', COLUMNS[0] as number, 0, 0, 0),
		quadProbe('plain', COLUMNS[0] as number, 0, 0.6, -0.4),
		quadProbe('plain', COLUMNS[0] as number, 0, -0.75, 0.5),
		quadProbe('repeated', COLUMNS[1] as number, 0, 0, 0, REPEAT),
		quadProbe('repeated', COLUMNS[1] as number, 0, -0.4, 0.4, REPEAT),
		quadProbe('transformed', COLUMNS[2] as number, 0, 0, 0),
		quadProbe('transformed', COLUMNS[2] as number, 0, 0.5, -0.3),
		{ surface: 'bare', instance: -1, world: [COLUMNS[3] as number, 0, 0], uv: null },
	];
	ROWS.forEach(({ y, scale }, row) => {
		for (const [dx, dy] of [
			[0, 0],
			[0.4, -0.3],
		] as const) {
			probes.push({
				surface: 'instances',
				instance: row,
				world: [(COLUMNS[4] as number) + dx * scale, y + dy * scale, 0],
				uv: [(dx / HALF + 1) / 2, (dy / HALF + 1) / 2],
			});
		}
	});

	const ray = { origin: [0, 0, 0], direction: [0, 0, 0] };
	const hit = {
		object: null,
		instance: -1,
		point: [0, 0, 0],
		normal: [0, 0, 0],
		uv: [0, 0],
		hasUv: false,
		distance: 0,
		triangle: -1,
	};
	const at = [0, 0, 0];

	const said = (
		target: unknown,
		instance: number,
		hasUv: boolean,
		uv?: { [index: number]: number },
	) => ({
		object: nameOf(target),
		instance,
		hasUv,
		uv: hasUv ? ([uv?.[0] ?? 0, uv?.[1] ?? 0] as [number, number]) : null,
	});

	async function answerProbes(): Promise<Answered[]> {
		const answers: Answered[] = [];
		for (const probe of probes) {
			camera.worldToScreen(probe.world, at);
			const x = at[0] as number;
			const y = at[1] as number;
			camera.screenToRay(x, y, ray);
			const found = scene.raycast(ray.origin, ray.direction, undefined, hit);
			const picked = await scene.pick(x, y);
			answers.push({
				surface: probe.surface,
				instance: probe.instance,
				expected: probe.uv,
				screen: [x, y],
				ray: found ? said(hit.object, hit.instance, hit.hasUv ?? false, hit.uv) : null,
				pick: picked
					? said(picked.object, picked.instance, picked.hasUv === true, picked.uv)
					: null,
			});
		}
		return answers;
	}

	page.onMessage((type) => {
		if (type !== 'probes') return;
		answerProbes().then(
			(answers) => page.post('probes', answers),
			(error) => page.post('error', String(error)),
		);
	});
	return {};
});
