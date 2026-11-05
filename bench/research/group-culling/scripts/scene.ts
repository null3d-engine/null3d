// Reads an optimized model the way the engine sees it: each mesh with its levels of detail, each
// level's error, its pieces with their bounds, and the stored positions and indices of each level.
// Builds the small groups of each level with meshoptimizer's clusterizer and keeps them in a cache
// beside the scripts, keyed by the model file and the group size.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MeshoptClusterizer } from '../../../../packages/cli/node_modules/meshoptimizer/index.js';
import { glTFIO } from '../../../../packages/cli/src/assets/pipeline.js';

/** A piece of a level: its first triangle, its count, its sphere and its cone, in stored units. */
export interface Piece {
	start: number;
	count: number;
	sphere: [number, number, number, number];
	cone: [number, number, number, number];
}

/** One level of a mesh. */
export interface Level {
	positions: Float32Array;
	indices: Uint32Array;
	triangles: number;
	pieces: Piece[];
}

/** The groups of one level at one size: eight floats each (sphere, cone axis, cutoff), their
 * triangle counts and the piece each lies in (-1 for a level without pieces). */
export interface Groups {
	bounds: Float32Array;
	triangles: Uint16Array;
	piece: Int16Array;
	count: number;
}

/** A mesh as the engine draws it. */
export interface Mesh {
	name: string;
	/** The base level's bounding sphere, in stored units. */
	sphere: [number, number, number, number];
	/** The error of each level after the base, in stored units. */
	errors: number[];
	levels: Level[];
	/** The node's own transform: translation, rotation (x, y, z, w) and scale. */
	node: { t: number[]; r: number[]; s: number[] };
	/** The groups of each level at each size, built on demand. */
	groups: Map<number, (Groups | null)[]>;
}

/** The least triangles of a level that gets groups, as the slots design plans. */
export const GROUP_FLOOR = 4096;

/** The values that a glTF-Transform accessor stores. */
type StoredValues = Float32Array | Int8Array | Uint8Array | Int16Array | Uint16Array | Uint32Array;

/** The part of a glTF-Transform accessor that this script reads. */
interface GltfAccessor {
	getArray(): StoredValues | null;
	getNormalized(): boolean;
	getElementSize(): number;
}

/** The part of a glTF-Transform primitive that this script reads. */
interface GltfPrimitive {
	getAttribute(name: string): GltfAccessor | null;
	getIndices(): { getArray(): StoredValues | null } | null;
	getExtension(name: string): unknown;
}

/** The part of a glTF-Transform mesh that this script reads. */
interface GltfMesh {
	listPrimitives(): GltfPrimitive[];
}

/** The part of a glTF-Transform node that this script reads. */
interface GltfNode {
	getName(): string;
	getMesh(): GltfMesh | null;
	getExtension(name: string): unknown;
	getExtras(): Record<string, unknown> | null;
	getTranslation(): number[];
	getRotation(): number[];
	getScale(): number[];
	getWorldMatrix(): number[];
}

/** The MSFT_lod extension's list of levels. */
interface LodExtension {
	listLevels(): GltfNode[];
}

/** The NULL3D_pieces extension's counts and bounds. */
interface PiecesExtension {
	getTriangles(): number[];
	getBounds(): number[];
}

function floatPositions(accessor: GltfAccessor | null): Float32Array {
	const array = accessor?.getArray();
	if (!accessor || !array) throw new Error('a position accessor holds no values');
	const out = new Float32Array(array.length);
	if (accessor.getNormalized()) {
		const max =
			array instanceof Int8Array
				? 127
				: array instanceof Uint8Array
					? 255
					: array instanceof Int16Array
						? 32767
						: 65535;
		const signed = array instanceof Int8Array || array instanceof Int16Array;
		for (let i = 0; i < array.length; i++) {
			const value = array[i] ?? 0;
			out[i] = signed ? Math.max(value / max, -1) : value / max;
		}
	} else {
		for (let i = 0; i < array.length; i++) out[i] = array[i] ?? 0;
	}
	// Positions in a vec3 accessor of 16-bit values are padded to four per vertex.
	const stride = accessor.getElementSize();
	if (stride === 3) return out;
	throw new Error(`positions with ${stride} components`);
}

function packed(accessor: GltfAccessor | null): Float32Array {
	// glTF-Transform hands each element as its own components; quantized positions keep a stride of
	// three in its arrays.
	return floatPositions(accessor);
}

function levelOf(prim: GltfPrimitive): Level {
	const positions = packed(prim.getAttribute('POSITION'));
	const raw = prim.getIndices()?.getArray();
	if (!raw) throw new Error('a primitive holds no indices');
	const indices = raw instanceof Uint32Array ? raw : Uint32Array.from(raw);
	const pieces: Piece[] = [];
	const ext = prim.getExtension('NULL3D_pieces') as PiecesExtension | null;
	if (ext) {
		const counts: number[] = ext.getTriangles();
		const b: number[] = ext.getBounds();
		let start = 0;
		counts.forEach((count, k) => {
			pieces.push({
				start,
				count,
				sphere: [b[k * 8], b[k * 8 + 1], b[k * 8 + 2], b[k * 8 + 3]],
				cone: [b[k * 8 + 4], b[k * 8 + 5], b[k * 8 + 6], b[k * 8 + 7]],
			});
			start += count;
		});
	}
	return { positions, indices, triangles: indices.length / 3, pieces };
}

function sphereOf(positions: Float32Array): [number, number, number, number] {
	const lo = [Infinity, Infinity, Infinity];
	const hi = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < positions.length; i += 3)
		for (let k = 0; k < 3; k++) {
			lo[k] = Math.min(lo[k], positions[i + k]);
			hi[k] = Math.max(hi[k], positions[i + k]);
		}
	const c = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
	let r2 = 0;
	for (let i = 0; i < positions.length; i += 3) {
		const dx = positions[i] - c[0];
		const dy = positions[i + 1] - c[1];
		const dz = positions[i + 2] - c[2];
		r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
	}
	return [c[0], c[1], c[2], Math.sqrt(r2)];
}

/** A node's world matrix as a column-major 4 x 4 array. */
export function nodeWorld(node: GltfNode): number[] {
	return node.getWorldMatrix();
}

/** Every mesh node of a model that is not one of another node's lower levels, with its mesh. */
export async function loadModel(
	path: string,
): Promise<{ meshes: Mesh[]; nodes: { mesh: Mesh; world: number[]; name: string }[] }> {
	const io = await glTFIO();
	const doc = await io.read(path);
	const allNodes = doc.getRoot().listNodes() as GltfNode[];
	const levelNodes = new Set<GltfNode>();
	for (const node of allNodes) {
		const lod = node.getExtension('MSFT_lod') as LodExtension | null;
		if (lod) for (const n of lod.listLevels()) levelNodes.add(n);
	}
	const byMesh = new Map<GltfMesh, Mesh[]>();
	const meshes: Mesh[] = [];
	const nodes: { mesh: Mesh; world: number[]; name: string }[] = [];
	for (const node of allNodes) {
		const gm = node.getMesh();
		if (!gm || levelNodes.has(node)) continue;
		let recs = byMesh.get(gm);
		if (!recs) {
			const lod = node.getExtension('MSFT_lod') as LodExtension | null;
			const lower = lod
				? lod
						.listLevels()
						.map((n) => n.getMesh())
						.filter((m): m is GltfMesh => m !== null)
				: [];
			const errors = lod ? ((node.getExtras()?.NULL3D_lod_error as number[]) ?? []) : [];
			recs = gm.listPrimitives().map((prim, p) => {
				const levels = [levelOf(prim), ...lower.map((m) => levelOf(m.listPrimitives()[p]))];
				return {
					name: `${node.getName()}${gm.listPrimitives().length > 1 ? `#${p}` : ''}`,
					sphere: sphereOf(levels[0].positions),
					errors: errors.slice(0, levels.length - 1),
					levels,
					node: { t: node.getTranslation(), r: node.getRotation(), s: node.getScale() },
					groups: new Map(),
				} satisfies Mesh;
			});
			byMesh.set(gm, recs);
			meshes.push(...recs);
		}
		for (const mesh of recs) nodes.push({ mesh, world: nodeWorld(node), name: node.getName() });
	}
	return { meshes, nodes };
}

/** The groups of `level` at `size` triangles each, built inside each piece, or null below the floor. */
function buildGroups(level: Level, size: number): Groups | null {
	if (level.triangles < GROUP_FLOOR) return null;
	const ranges =
		level.pieces.length > 0
			? level.pieces.map((p, k) => ({ ...p, k }))
			: [{ start: 0, count: level.triangles, k: -1 }];
	const bounds: number[] = [];
	const triangles: number[] = [];
	const piece: number[] = [];
	const maxVertices = size === 64 ? 128 : 255;
	for (const r of ranges) {
		const sub = level.indices.subarray(r.start * 3, (r.start + r.count) * 3);
		const built = MeshoptClusterizer.buildMeshlets(
			sub,
			level.positions,
			3,
			maxVertices,
			size,
			0.25,
		);
		const b = MeshoptClusterizer.computeMeshletBounds(built, level.positions, 3);
		for (let m = 0; m < built.meshletCount; m++) {
			const g = b[m];
			bounds.push(
				g.centerX,
				g.centerY,
				g.centerZ,
				g.radius,
				g.coneAxisX,
				g.coneAxisY,
				g.coneAxisZ,
				g.coneCutoff,
			);
			triangles.push(built.meshlets[m * 4 + 3]);
			piece.push(r.k);
		}
	}
	return {
		bounds: Float32Array.from(bounds),
		triangles: Uint16Array.from(triangles),
		piece: Int16Array.from(piece),
		count: triangles.length,
	};
}

/** Builds, or reads from the cache, the groups of every level of every mesh at `size`. */
export async function ensureGroups(modelPath: string, meshes: Mesh[], size: number): Promise<void> {
	await MeshoptClusterizer.ready;
	const st = statSync(modelPath);
	const key = createHash('sha256')
		.update(`${modelPath}:${st.size}:${st.mtimeMs}:${size}:v1`)
		.digest('hex')
		.slice(0, 16);
	const dir = join(import.meta.dirname, '../../../../target/group-culling/cache');
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `groups-${key}.json`);
	if (existsSync(file)) {
		const saved = JSON.parse(readFileSync(file, 'utf8')) as Record<
			string,
			(null | { b: number[]; t: number[]; p: number[] })[]
		>;
		for (const mesh of meshes) {
			const list = saved[mesh.name];
			if (!list) throw new Error(`no groups for ${mesh.name} in ${file}`);
			mesh.groups.set(
				size,
				list.map((g) =>
					g
						? {
								bounds: Float32Array.from(g.b),
								triangles: Uint16Array.from(g.t),
								piece: Int16Array.from(g.p),
								count: g.t.length,
							}
						: null,
				),
			);
		}
		return;
	}
	const out: Record<string, unknown> = {};
	for (const mesh of meshes) {
		const list = mesh.levels.map((level) => buildGroups(level, size));
		mesh.groups.set(size, list);
		out[mesh.name] = list.map((g) =>
			g ? { b: Array.from(g.bounds), t: Array.from(g.triangles), p: Array.from(g.piece) } : null,
		);
	}
	writeFileSync(file, JSON.stringify(out));
}
