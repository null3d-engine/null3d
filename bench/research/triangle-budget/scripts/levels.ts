// Compares how null3D and three.js r187's meshlet pipeline pick levels of detail in the desert, copy
// by copy, with whole levels and the view's frustum alone, so that only the level rules differ.
//
// - null3D's levels and errors come from the asset tool's props file (`MSFT_lod` and
//   `NULL3D_lod_error`), its rule from `cull.wgsl` `level_of`: level j draws while
//   error[j] x scale x k < threshold x d, with d the distance to the sphere's nearest point, and a
//   copy hides when its diameter x k < threshold x d. Shadow cascades pick in their own texels.
// - three.js's levels come from `MeshletGeometryUtils.createMeshlets`, rebuilt here with the
//   simplifier that three.js ships, from the raw meshes: six levels at shares 1, 0.55, 0.25, 0.1,
//   0.04 and 0.015, errors summed level by level. Its rule comes from `MeshletDrawingPipeline`'s
//   cull pass: the coarsest level with error x scale x k / d <= threshold, d the distance to the
//   sphere's center, no hiding at `minScreenRadius` 0. A level draws whole meshlets of 64.
// - k = render height x P[1][1] / 2 in both.
//
// Switches: `--null3d <props.glb>` (default target/desert's latest build), `--view walk|aerial`,
// `--samples <n>` camera times over the lap, `--out <file.json>`.
// Run from the repository's root: bun bench/research/triangle-budget/scripts/levels.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { glTFIO } from '../../../../packages/cli/src/assets/pipeline.js';
import { MeshoptClusterizer } from '../../../node_modules/three-r187/examples/jsm/libs/meshopt_clusterizer.module.js';
import { MeshoptSimplifier } from '../../../node_modules/three-r187/examples/jsm/libs/meshopt_simplifier.module.js';
import {
	DESERT_CAMERA,
	DESERT_CANVAS,
	DESERT_MESHES,
	DESERT_SHADOWS,
	DESERT_SUN,
	type DesertMeshData,
	type DesertView,
	desertCamera,
	desertPlacements,
	GROUND,
	LAP_SECONDS,
	ROW_FLOATS,
} from '../../../scenes/desert.ts';

const root = join(import.meta.dirname, '../../../..');
const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
	const i = args.indexOf(name);
	return i >= 0 ? (args[i + 1] as string) : fallback;
};
const view = opt('--view', 'walk') as DesertView;
const samples = Number(opt('--samples', '40'));
const latest = () => {
	const manifest = JSON.parse(readFileSync(join(root, 'target/desert/files.json'), 'utf8'));
	return manifest.files['/bench-desert/null3d/props.glb'].path as string;
};
const null3dPath = opt('--null3d', '') || latest();
const out = opt('--out', join(import.meta.dirname, `../results/levels-${view}.json`));
const cacheDir = join(root, 'target/triangle-budget');
mkdirSync(cacheDir, { recursive: true });

type V3 = [number, number, number];

/** A mesh's levels in one engine: triangles drawn and error in meters at a copy's scale of 1. */
interface Chain {
	triangles: number[];
	errors: number[];
}

// --- null3D's levels, from the asset tool's file --------------------------------------------------

async function null3dChains(path: string): Promise<Map<string, Chain>> {
	const io = await glTFIO();
	const doc = await io.read(path);
	const levelNodes = new Set<unknown>();
	for (const node of doc.getRoot().listNodes()) {
		const lod = node.getExtension('MSFT_lod') as { listLevels(): unknown[] } | null;
		if (lod) for (const n of lod.listLevels()) levelNodes.add(n);
	}
	const chains = new Map<string, Chain>();
	for (const node of doc.getRoot().listNodes()) {
		const mesh = node.getMesh();
		if (!mesh || levelNodes.has(node)) continue;
		const lod = node.getExtension('MSFT_lod') as {
			listLevels(): { getMesh(): typeof mesh }[];
		} | null;
		const count = (m: NonNullable<typeof mesh>) =>
			m.listPrimitives().reduce((sum, p) => sum + (p.getIndices()?.getCount() ?? 0) / 3, 0);
		const lower = lod ? lod.listLevels().map((n) => n.getMesh() as NonNullable<typeof mesh>) : [];
		const stored = (node.getExtras()?.NULL3D_lod_error as number[] | undefined) ?? [];
		// Errors are in the file's stored units; the node's scale turns them into meters.
		const scale = Math.max(...node.getScale().map(Math.abs));
		chains.set(node.getName(), {
			triangles: [count(mesh), ...lower.map(count)],
			errors: [0, ...stored.slice(0, lower.length).map((e) => e * scale)],
		});
	}
	return chains;
}

// --- three.js's levels, rebuilt as `createMeshlets` builds them -----------------------------------

const LOD_TARGETS = [
	{ ratio: 1.0, error: 0.0, weights: [0.25, 0.25, 0.25, 0.5, 0.5], flags: [] as string[] },
	{
		ratio: 0.55,
		error: 0.004,
		weights: [0.2, 0.2, 0.2, 0.35, 0.35],
		flags: ['RegularizeLight', 'Permissive', 'Prune'],
	},
	{
		ratio: 0.25,
		error: 0.015,
		weights: [0.12, 0.12, 0.12, 0.2, 0.2],
		flags: ['RegularizeLight', 'Permissive', 'Prune'],
	},
	{
		ratio: 0.1,
		error: 0.05,
		weights: [0.08, 0.08, 0.08, 0.12, 0.12],
		flags: ['RegularizeLight', 'Permissive', 'Prune'],
	},
	{
		ratio: 0.04,
		error: 0.14,
		weights: [0.04, 0.04, 0.04, 0.06, 0.06],
		flags: ['Regularize', 'Permissive', 'Prune'],
	},
	{
		ratio: 0.015,
		error: 0.3,
		weights: [0.02, 0.02, 0.02, 0.03, 0.03],
		flags: ['Regularize', 'Permissive', 'Prune'],
	},
];
const MIN_LOD_REDUCTION = 0.85;
const SLOPPY_ERROR_SCALE = 4;
const MESHLET_SIZE = 64;

function threeChain(data: DesertMeshData): Chain & { real: number[] } {
	// Welds identical vertices by position and normal, as three.js does; the scene's meshes have no
	// texture coordinates, so the simplifier's last two attributes are zero.
	const count = data.positions.length / 3;
	const key = new Map<string, number>();
	const remap = new Uint32Array(count);
	const sources: number[] = [];
	for (let i = 0; i < count; i++) {
		const k = Array.from(data.positions.subarray(i * 3, i * 3 + 3))
			.concat(Array.from(data.normals.subarray(i * 3, i * 3 + 3)))
			.join(',');
		let index = key.get(k);
		if (index === undefined) {
			index = sources.length;
			sources.push(i);
			key.set(k, index);
		}
		remap[i] = index;
	}
	const positions = new Float32Array(sources.length * 3);
	const attributes = new Float32Array(sources.length * 5);
	sources.forEach((s, i) => {
		positions.set(data.positions.subarray(s * 3, s * 3 + 3), i * 3);
		attributes.set(data.normals.subarray(s * 3, s * 3 + 3), i * 5);
	});
	const sourceIndices = data.indices.map((v) => remap[v] as number);
	const sourceScale = MeshoptSimplifier.getScale(positions, 3);
	const triangles: number[] = [];
	const errors: number[] = [];
	const real: number[] = [];
	let indices: Uint32Array = sourceIndices;
	let previous = 0;
	for (let i = 0; i < LOD_TARGETS.length; i++) {
		let error = 0;
		if (i > 0) {
			const target = LOD_TARGETS[i] as (typeof LOD_TARGETS)[number];
			const targetCount = Math.min(
				indices.length,
				Math.max(3, Math.floor((sourceIndices.length * target.ratio) / 3) * 3),
			);
			let simplified = MeshoptSimplifier.simplifyWithAttributes(
				indices,
				positions,
				3,
				attributes,
				5,
				target.weights,
				null,
				targetCount,
				target.error,
				target.flags,
			);
			if (
				indices.length > targetCount &&
				simplified[0].length > indices.length * MIN_LOD_REDUCTION
			) {
				const sloppy = MeshoptSimplifier.simplifySloppy(
					indices,
					positions,
					3,
					null,
					targetCount,
					target.error * SLOPPY_ERROR_SCALE,
				);
				if (sloppy[0].length >= 3 && sloppy[0].length < simplified[0].length) simplified = sloppy;
			}
			if (simplified[0].length >= 3) {
				indices = simplified[0];
				error = previous + simplified[1] * sourceScale;
			} else error = previous;
		}
		previous = error;
		const meshlets = MeshoptClusterizer.buildMeshlets(
			indices,
			positions,
			3,
			MESHLET_SIZE * 3,
			MESHLET_SIZE,
			0.25,
		);
		triangles.push(meshlets.meshletCount * MESHLET_SIZE);
		real.push(indices.length / 3);
		errors.push(error);
	}
	return { triangles, errors, real };
}

// --- The scene ----------------------------------------------------------------------------------

/** A mesh's bounding sphere, as both engines take it: the box's center and the farthest vertex. */
function sphereOf(positions: Float32Array): [number, number, number, number] {
	const lo = [Infinity, Infinity, Infinity];
	const hi = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < positions.length; i += 3)
		for (let k = 0; k < 3; k++) {
			lo[k] = Math.min(lo[k] as number, positions[i + k] as number);
			hi[k] = Math.max(hi[k] as number, positions[i + k] as number);
		}
	const c = [0, 1, 2].map((k) => ((lo[k] as number) + (hi[k] as number)) / 2) as V3;
	let r2 = 0;
	for (let i = 0; i < positions.length; i += 3)
		r2 = Math.max(
			r2,
			((positions[i] as number) - c[0]) ** 2 +
				((positions[i + 1] as number) - c[1]) ** 2 +
				((positions[i + 2] as number) - c[2]) ** 2,
		);
	return [c[0], c[1], c[2], Math.sqrt(r2)];
}

function rotate(q: ArrayLike<number>, x: number, y: number, z: number): V3 {
	const [qx, qy, qz, qw] = [q[0], q[1], q[2], q[3]] as number[] as [number, number, number, number];
	const tx = 2 * (qy * z - qz * y);
	const ty = 2 * (qz * x - qx * z);
	const tz = 2 * (qx * y - qy * x);
	return [
		x + qw * tx + (qy * tz - qz * ty),
		y + qw * ty + (qz * tx - qx * tz),
		z + qw * tz + (qx * ty - qy * tx),
	];
}

interface Copy {
	name: string;
	kind: string;
	center: V3;
	radius: number;
	scale: number;
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) =>
	(a[0] as number) * (b[0] as number) +
	(a[1] as number) * (b[1] as number) +
	(a[2] as number) * (b[2] as number);
const sub = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [
	(a[0] as number) - (b[0] as number),
	(a[1] as number) - (b[1] as number),
	(a[2] as number) - (b[2] as number),
];
const cross = (a: V3, b: V3): V3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3): V3 => {
	const l = Math.hypot(...a);
	return [a[0] / l, a[1] / l, a[2] / l];
};
type Planes = [number, number, number, number][];
const inside = (planes: Planes, c: V3, r: number) =>
	planes.every((p) => p[0] * c[0] + p[1] * c[1] + p[2] * c[2] + p[3] >= -r);

interface Cam {
	eye: V3;
	forward: V3;
	planes: Planes;
	k: number;
	tanY: number;
	aspect: number;
}

function cameraAt(t: number): Cam {
	const { position, target } = desertCamera(view, t);
	const eye = position as V3;
	const f = norm(sub(target, eye));
	const r = norm(cross(f, [0, 1, 0]));
	const u = cross(r, f);
	const tanY = Math.tan((DESERT_CAMERA.fov * Math.PI) / 360);
	const aspect = DESERT_CANVAS.width / DESERT_CANVAS.height;
	const tanX = tanY * aspect;
	const planes: Planes = [];
	const side = (n: V3) => {
		const nn = norm(n);
		planes.push([nn[0], nn[1], nn[2], -dot(nn, eye)]);
	};
	// The four side planes through the eye, each normal pointing into the view.
	for (const [axis, tan] of [
		[r, tanX],
		[u, tanY],
	] as const)
		for (const sign of [1, -1])
			side([f[0] * tan + sign * axis[0], f[1] * tan + sign * axis[1], f[2] * tan + sign * axis[2]]);
	planes.push([f[0], f[1], f[2], -dot(f, eye) - DESERT_CAMERA.near]);
	planes.push([-f[0], -f[1], -f[2], dot(f, eye) + DESERT_CAMERA.far]);
	return { eye, forward: f, planes, k: DESERT_CANVAS.height / (2 * tanY), tanY, aspect };
}

/** null3D's level for a factor and distance, or -1 for a copy that hides. */
function null3dPick(chain: Chain, scale: number, radius: number, factor: number, d: number) {
	let level = 0;
	while (
		level + 1 < chain.errors.length &&
		(chain.errors[level + 1] as number) * scale * factor < d
	)
		level++;
	if (chain.errors.length > 1 && 2 * radius * factor < d) return -1;
	return level;
}

/** three.js's level: the coarsest whose error, over the distance, stays within the threshold. */
function threePick(chain: Chain, scale: number, pixelsPerMeter: number, threshold: number) {
	let level = 0;
	for (let j = 1; j < chain.errors.length; j++)
		if ((chain.errors[j] as number) * scale * pixelsPerMeter <= threshold) level = j;
	return level;
}

// --- Null3D's shadow cascades, as `shadows.rs` `fit_cascades` places them -------------------------

function splitDistances(near: number, end: number, count: number, lambda: number): number[] {
	const ends: number[] = [];
	for (let i = 0; i < count; i++) {
		const share = (i + 1) / count;
		const even = near + (end - near) * share;
		const log = near * (end / near) ** share;
		ends.push(lambda * log + (1 - lambda) * even);
	}
	ends[count - 1] = end;
	return ends;
}

function lightBasis(): { x: V3; y: V3; z: V3 } {
	const d = norm([...DESERT_SUN.direction] as V3);
	const z: V3 = [-d[0], -d[1], -d[2]];
	const x = norm(cross(Math.abs(z[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0], z));
	return { x, y: cross(z, x), z };
}

function null3dCascades(cam: Cam): { planes: Planes; texel: number }[] {
	const { x, y, z } = lightBasis();
	const count = DESERT_SHADOWS.cascades;
	const ends = splitDistances(DESERT_CAMERA.near, DESERT_SHADOWS.distance, count, 0.65);
	const reach = Math.sqrt(1 + (cam.tanY * cam.aspect) ** 2 + cam.tanY ** 2);
	const blend = 0.1;
	const cascades: { planes: Planes; texel: number }[] = [];
	let start = DESERT_CAMERA.near;
	let from: number = DESERT_CAMERA.near;
	for (let k = 0; k < count; k++) {
		const e = ends[k] as number;
		const band = k + 1 < count ? e - blend * (e - start) : e;
		const cx = cam.tanY * cam.aspect * e;
		const cy = cam.tanY * e;
		const k2 = (cx * cx + cy * cy) / (e * e);
		const along = Math.min(((e + from) * (1 + k2)) / 2, e);
		const radius = Math.sqrt((e - along) ** 2 + e * e * k2);
		const center = cam.eye.map((v, i) => v + along * (cam.forward[i] as number)) as V3;
		const C = [dot(center, x), dot(center, y), dot(center, z)] as V3;
		cascades.push({
			planes: [
				[x[0], x[1], x[2], radius - C[0]],
				[-x[0], -x[1], -x[2], radius + C[0]],
				[y[0], y[1], y[2], radius - C[1]],
				[-y[0], -y[1], -y[2], radius + C[1]],
				[z[0], z[1], z[2], radius - C[2]],
			],
			texel: (2 * radius) / DESERT_SHADOWS.mapSize,
		});
		start = e;
		from = band / reach;
	}
	return cascades;
}

/** three.js's one shadow map: a box of the shadow distance each way around the camera. */
function threeShadowBox(cam: Cam): { planes: Planes; texel: number } {
	const { x, y, z } = lightBasis();
	const half = DESERT_SHADOWS.distance;
	const C = [dot(cam.eye, x), dot(cam.eye, y), dot(cam.eye, z)] as V3;
	// The sun stands 400 m from the camera; the map's depth runs from 1 m to 800 m from it.
	return {
		planes: [
			[x[0], x[1], x[2], half - C[0]],
			[-x[0], -x[1], -x[2], half + C[0]],
			[y[0], y[1], y[2], half - C[1]],
			[-y[0], -y[1], -y[2], half + C[1]],
			[z[0], z[1], z[2], 399 - C[2]],
			[-z[0], -z[1], -z[2], 399 + C[2]],
		],
		texel: (2 * half) / DESERT_SHADOWS.threeMapSize,
	};
}

// --- The run ------------------------------------------------------------------------------------

await Promise.all([MeshoptSimplifier.ready, MeshoptClusterizer.ready]);
const n3 = await null3dChains(null3dPath);
const threeCache = join(cacheDir, 'three-levels.json');
const three: Record<string, Chain & { real: number[] }> = existsSync(threeCache)
	? JSON.parse(readFileSync(threeCache, 'utf8'))
	: {};
const spheres: Record<string, [number, number, number, number]> = {};
for (const mesh of DESERT_MESHES) {
	if (mesh.name === GROUND) continue;
	const data = mesh.build();
	spheres[mesh.name] = sphereOf(data.positions);
	if (!three[mesh.name]) {
		const started = performance.now();
		three[mesh.name] = threeChain(data);
		console.log(
			`three.js levels of ${mesh.name} in ${((performance.now() - started) / 1000).toFixed(1)} s`,
		);
	}
}
writeFileSync(threeCache, JSON.stringify(three));

const copies: Copy[] = [];
for (const [name, list] of Object.entries(desertPlacements())) {
	const [cx, cy, cz, r] = spheres[name] as [number, number, number, number];
	for (let o = 0; o < list.length; o += ROW_FLOATS) {
		const s = list[o + 7] as number;
		const q = list.subarray(o + 3, o + 7);
		const c = rotate(q, cx * s, cy * s, cz * s);
		copies.push({
			name,
			kind: name.replace(/-\d+$/, ''),
			center: [
				(list[o] as number) + c[0],
				(list[o + 1] as number) + c[1],
				(list[o + 2] as number) + c[2],
			],
			radius: r * s,
			scale: s,
		});
	}
}

const THRESHOLDS = [0.5, 1, 1.5, 2, 3, 4];
const kinds = ['arch', 'boulder', 'column', 'pebble'];
type Tally = Record<string, number>;
const tally = () => Object.fromEntries([...kinds, 'all'].map((k) => [k, 0])) as Tally;
const add = (t: Tally, kind: string, n: number) => {
	t[kind] = (t[kind] as number) + n / samples;
	t.all = (t.all as number) + n / samples;
};
const camera = {
	// null3D's rule at each threshold, three.js's rule, and each engine's levels under the other's distance.
	null3d: Object.fromEntries(THRESHOLDS.map((t) => [t, tally()])) as Record<number, Tally>,
	null3dCenter: Object.fromEntries(THRESHOLDS.map((t) => [t, tally()])) as Record<number, Tally>,
	three: tally(),
	threeReal: tally(),
	null3dLevelsCenterDistance: tally(),
	threeLevelsNearestDistance: tally(),
	copiesInView: tally(),
	null3dHidden: tally(),
};
const shadow = {
	null3dCascades: [tally(), tally(), tally()],
	null3dCascadesAt: Object.fromEntries([2, 4].map((t) => [t, [tally(), tally(), tally()]])),
	three: tally(),
	threeAtNull3dCascade0Texel: tally(),
	texels: [0, 0, 0, 0],
};
const arches: Record<string, unknown>[] = [];
for (let i = 0; i < samples; i++) {
	const t = (i + 0.5) * (LAP_SECONDS / samples);
	const cam = cameraAt(t);
	for (const copy of copies) {
		const a = n3.get(copy.name) as Chain;
		const b = three[copy.name] as Chain & { real: number[] };
		if (inside(cam.planes, copy.center, copy.radius)) {
			const centerDistance = Math.hypot(...sub(copy.center, cam.eye));
			const nearest = Math.max(centerDistance - copy.radius, 1e-3);
			add(camera.copiesInView, copy.kind, 1);
			for (const th of THRESHOLDS) {
				const level = null3dPick(a, copy.scale, copy.radius, cam.k / th, nearest);
				if (level >= 0) add(camera.null3d[th] as Tally, copy.kind, a.triangles[level] as number);
				else if (th === 1) add(camera.null3dHidden, copy.kind, 1);
				const centered = null3dPick(a, copy.scale, copy.radius, cam.k / th, centerDistance);
				if (centered >= 0)
					add(camera.null3dCenter[th] as Tally, copy.kind, a.triangles[centered] as number);
			}
			const tl = threePick(b, copy.scale, cam.k / Math.max(0.01, centerDistance), 1);
			add(camera.three, copy.kind, b.triangles[tl] as number);
			add(camera.threeReal, copy.kind, b.real[tl] as number);
			const centered = null3dPick(
				a,
				copy.scale,
				copy.radius,
				cam.k,
				Math.max(centerDistance, 1e-3),
			);
			if (centered >= 0)
				add(camera.null3dLevelsCenterDistance, copy.kind, a.triangles[centered] as number);
			const tn = threePick(b, copy.scale, cam.k / nearest, 1);
			add(camera.threeLevelsNearestDistance, copy.kind, b.triangles[tn] as number);
			if (copy.kind === 'arch') {
				const nl = null3dPick(a, copy.scale, copy.radius, cam.k, nearest);
				arches.push({
					t,
					name: copy.name,
					scale: +copy.scale.toFixed(3),
					radius: +copy.radius.toFixed(2),
					centerDistance: +centerDistance.toFixed(1),
					nearestDistance: +nearest.toFixed(1),
					null3dLevel: nl,
					null3dTriangles: nl >= 0 ? a.triangles[nl] : 0,
					null3dErrorPx:
						nl >= 0
							? +(((a.errors[nl] as number) * copy.scale * cam.k) / nearest).toFixed(2)
							: null,
					null3dErrorPxAtCenter:
						nl >= 0
							? +(((a.errors[nl] as number) * copy.scale * cam.k) / centerDistance).toFixed(2)
							: null,
					threeLevel: tl,
					threeTriangles: b.triangles[tl],
					threeErrorPx: +(((b.errors[tl] as number) * copy.scale * cam.k) / centerDistance).toFixed(
						2,
					),
					null3dLevelAtCenterDistance: centered,
					null3dTrianglesAtCenterDistance: centered >= 0 ? a.triangles[centered] : 0,
				});
			}
		}
	}
	const cascades = null3dCascades(cam);
	cascades.forEach((c, ci) => {
		shadow.texels[ci] = (shadow.texels[ci] as number) + c.texel / samples;
		for (const copy of copies) {
			if (!inside(c.planes, copy.center, copy.radius)) continue;
			const a = n3.get(copy.name) as Chain;
			const level = null3dPick(a, copy.scale, copy.radius, 1 / c.texel, 1);
			if (level >= 0)
				add(shadow.null3dCascades[ci] as Tally, copy.kind, a.triangles[level] as number);
			for (const th of [2, 4]) {
				const coarse = null3dPick(a, copy.scale, copy.radius, 1 / (c.texel * th), 1);
				if (coarse >= 0)
					add(
						(shadow.null3dCascadesAt[th] as Tally[])[ci] as Tally,
						copy.kind,
						a.triangles[coarse] as number,
					);
			}
		}
	});
	const box = threeShadowBox(cam);
	shadow.texels[3] = (shadow.texels[3] as number) + box.texel / samples;
	for (const copy of copies) {
		if (!inside(box.planes, copy.center, copy.radius)) continue;
		const b = three[copy.name] as Chain;
		add(shadow.three, copy.kind, b.triangles[threePick(b, copy.scale, 1 / box.texel, 1)] as number);
		const c0 = cascades[0]?.texel as number;
		add(
			shadow.threeAtNull3dCascade0Texel,
			copy.kind,
			b.triangles[threePick(b, copy.scale, 1 / c0, 1)] as number,
		);
	}
}

const chains = Object.fromEntries(
	[...n3.keys()]
		.filter((name) => name !== GROUND && three[name])
		.map((name) => [
			name,
			{
				null3d: n3.get(name),
				three: three[name],
				radius: (spheres[name] as number[])[3],
			},
		]),
);
const result = { view, samples, null3dFile: null3dPath, chains, camera, shadow, arches };
mkdirSync(join(out, '..'), { recursive: true });
writeFileSync(out, `${JSON.stringify(result, null, '\t')}\n`);
const M = (n: number) => (n / 1e6).toFixed(3);
console.log(`camera, whole levels in the frustum, M triangles (${view}, ${samples} times):`);
console.log(['rule', ...kinds, 'all'].join('\t'));
for (const [label, rule] of [
	['', camera.null3d],
	[', center distance', camera.null3dCenter],
] as const)
	for (const th of THRESHOLDS)
		console.log(
			[
				`null3D ${th} px${label}`,
				...[...kinds, 'all'].map((k) => M((rule[th] as Tally)[k] as number)),
			].join('\t'),
		);
for (const [label, t] of [
	['three.js 1 px', camera.three],
	['three.js unpadded', camera.threeReal],
	['null3D levels, center distance', camera.null3dLevelsCenterDistance],
	['three.js levels, nearest distance', camera.threeLevelsNearestDistance],
] as const)
	console.log([label, ...[...kinds, 'all'].map((k) => M(t[k] as number))].join('\t'));
console.log(
	'copies in view',
	JSON.stringify(camera.copiesInView),
	'hidden',
	JSON.stringify(camera.null3dHidden),
);
console.log('shadow texels (m):', shadow.texels.map((t) => t.toFixed(4)).join(', '));
shadow.null3dCascades.forEach((c, ci) => {
	console.log(
		[`null3D cascade ${ci}`, ...[...kinds, 'all'].map((k) => M(c[k] as number))].join('\t'),
	);
});
console.log(
	['three.js map', ...[...kinds, 'all'].map((k) => M(shadow.three[k] as number))].join('\t'),
);
console.log(`wrote ${out}`);
