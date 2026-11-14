// The mesh writer that the leaf, shoot and extras builders share: vertices in plain number lists,
// tubes along a path with rings square to it, and lathe shapes turned about an axis. Every angle goes
// through the core's own trigonometry, so the bytes are the same on every script engine.
import type { MeshArrays, PrototypeArrays } from '../asset';
import { cos, cross3, normalize3, sin, type Vector3 } from '../core/math';

/** Steps a metre of a blade's keel offset is packed in, within a signed byte's range. */
const KEEL_STEPS = 8192;

/** Surface kinds in a prototype's third colour byte: leaf, stem or bud, extra. */
export const SURFACE_LEAF = 0;
export const SURFACE_STEM = 85;
/**
 * A brush card: crossed quads that picture a dense run of a piece's leaves, drawn from the card
 * atlas where the bake keeps the run's own picture. It sways and takes light as a leaf does.
 */
export const SURFACE_BRUSH = 8;
/**
 * A placed piece's own surface: drawn as the leaf is, with its second coordinates the share along
 * its part and its own browning, as a merged plant's foliage holds them.
 */
export const SURFACE_PIECE = 16;
/** A placed piece's sheath column: drawn in the record's sheath colour, and it does not flutter. */
export const SURFACE_PIECE_SHEATH = 32;
/** The leaf's own petiole: a stalk thin enough that the shader widens it like fine wood. */
export const SURFACE_PETIOLE = 42;
/** A shoot's bud: drawn as its stem, in the record's bud colour where it gives one. */
export const SURFACE_BUD = 128;
export const SURFACE_EXTRA = 170;
/**
 * A merged plant's sheath column, marked in the byte that holds every other run's flutter phase:
 * the material draws it in the record's sheath colour.
 */
export const SURFACE_SHEATH = 240;

/** Every surface kind the plant shaders read from a vertex's third colour byte. */
export const SURFACE_KINDS: readonly number[] = [
	SURFACE_LEAF,
	SURFACE_BRUSH,
	SURFACE_PIECE,
	SURFACE_PIECE_SHEATH,
	SURFACE_PETIOLE,
	SURFACE_STEM,
	SURFACE_BUD,
	SURFACE_EXTRA,
	SURFACE_SHEATH,
];

/**
 * A flutter phase byte from a hash, for a mesh whose third colour byte holds each run's phase:
 * the shaders read some values of that byte as surface kinds, so a phase that lands on one takes
 * the next free value, and a leaf never draws as a sheath column or widens as a petiole.
 *
 * @param hash Any whole number; its low byte is the phase.
 * @returns The phase, 0 to 255, never a surface kind.
 */
export function phaseByte(hash: number): number {
	let phase = hash & 255;
	while (SURFACE_KINDS.includes(phase)) phase = (phase + 1) & 255;
	return phase;
}

/**
 * Whether a prototype's surface kind draws with the leaf's texture: a leaf, or a placed piece's
 * own surface. The plant material draws every kind below half the stem's so.
 *
 * @param kind The surface kind.
 * @returns Whether it is a leaf surface.
 */
export function leafSurface(kind: number): boolean {
	return kind < SURFACE_STEM / 2 && kind !== SURFACE_PIECE_SHEATH;
}

/**
 * A mesh's wood, stems and buds alone: its leaf triangles left out, and the vertices the rest use
 * kept in their order.
 *
 * @param mesh The mesh, of any size.
 * @returns The arrays, with 16-bit indices.
 */
export function withoutLeaves(mesh: MeshArrays): PrototypeArrays {
	const keep = new Int32Array(mesh.positions.length / 3).fill(-1);
	const kept: number[] = [];
	const indices: number[] = [];
	for (let t = 0; t < mesh.indices.length; t += 3) {
		if (leafSurface(mesh.colors[(mesh.indices[t] as number) * 4 + 2] as number)) continue;
		for (let k = 0; k < 3; k++) {
			const v = mesh.indices[t + k] as number;
			if ((keep[v] as number) < 0) {
				keep[v] = kept.length;
				kept.push(v);
			}
			indices.push(keep[v] as number);
		}
	}
	if (kept.length > 0xffff)
		throw new Error('@null3d/vegetation: a shoot or leaf mesh passed 65,535 vertices');
	const picked = <T extends Float32Array | Uint8Array | Int8Array>(
		from: T,
		size: number,
		to: T,
	) => {
		kept.forEach((v, i) => {
			to.set(from.subarray(v * size, v * size + size), i * size);
		});
		return to;
	};
	return {
		positions: picked(mesh.positions, 3, new Float32Array(kept.length * 3)),
		normals: picked(mesh.normals, 3, new Float32Array(kept.length * 3)),
		uvs: picked(mesh.uvs, 2, new Float32Array(kept.length * 2)),
		uvs1: picked(mesh.uvs1, 2, new Float32Array(kept.length * 2)),
		colors: picked(mesh.colors, 4, new Uint8Array(kept.length * 4)),
		...(mesh.tangents
			? { tangents: picked(mesh.tangents, 4, new Int8Array(kept.length * 4)) }
			: {}),
		indices: Uint16Array.from(indices),
	};
}

/** A mesh under construction, in plain number lists. */
export class MeshWriter {
	readonly positions: number[] = [];
	readonly normals: number[] = [];
	readonly uvs: number[] = [];
	readonly uvs1: number[] = [];
	readonly colors: number[] = [];
	/** 4 bytes per vertex: the packed offset from a blade's keel, its fourth byte 127 on a blade. */
	readonly keel: number[] = [];
	/** True once a vertex names a keel, so a mesh without one writes no tangent attribute. */
	private keelUsed = false;
	readonly indices: number[] = [];
	/** The first vertex of each part that `mark` began, so meshes of one plan match part by part. */
	readonly parts: number[] = [];

	/** Begins a part at the next vertex. */
	mark(): void {
		this.parts.push(this.vertices);
	}

	/** Vertices written so far. */
	get vertices(): number {
		return this.positions.length / 3;
	}

	/** Writes one vertex and returns its index. */
	vertex(
		p: ArrayLike<number>,
		n: ArrayLike<number>,
		uv: ArrayLike<number>,
		uv1: ArrayLike<number>,
		color: ArrayLike<number>,
		keel?: ArrayLike<number>,
	): number {
		this.positions.push(p[0] as number, p[1] as number, p[2] as number);
		this.normals.push(n[0] as number, n[1] as number, n[2] as number);
		this.uvs.push(uv[0] as number, uv[1] as number);
		this.uvs1.push(uv1[0] as number, uv1[1] as number);
		this.colors.push(
			color[0] as number,
			color[1] as number,
			color[2] as number,
			color[3] as number,
		);
		this.keel.push(
			keel ? (keel[0] as number) : 0,
			keel ? (keel[1] as number) : 0,
			keel ? (keel[2] as number) : 0,
			keel ? (keel[3] as number) : 0,
		);
		if (keel) this.keelUsed = true;
		return this.vertices - 1;
	}

	/** Two triangles over the quad a, b, c, d, counter-clockwise. */
	quad(a: number, b: number, c: number, d: number): void {
		this.indices.push(a, b, c, a, c, d);
	}

	/** One triangle over the vertices a, b, c, counter-clockwise. */
	tri(a: number, b: number, c: number): void {
		this.indices.push(a, b, c);
	}

	/** The finished arrays, with 16-bit indices: a prototype or a leaf. */
	finishPrototype(): PrototypeArrays {
		if (this.vertices > 0xffff)
			throw new Error('@null3d/vegetation: a shoot or leaf mesh passed 65,535 vertices');
		return {
			positions: new Float32Array(this.positions),
			normals: new Float32Array(this.normals),
			uvs: new Float32Array(this.uvs),
			uvs1: new Float32Array(this.uvs1),
			colors: new Uint8Array(this.colors),
			...(this.keelUsed && { tangents: new Int8Array(this.keel) }),
			indices: new Uint16Array(this.indices),
		};
	}

	/** The finished arrays, with 32-bit indices past 65,535 vertices: a variant's mesh. */
	finishMesh(): MeshArrays {
		return {
			positions: new Float32Array(this.positions),
			normals: new Float32Array(this.normals),
			uvs: new Float32Array(this.uvs),
			uvs1: new Float32Array(this.uvs1),
			colors: new Uint8Array(this.colors),
			...(this.keelUsed && { tangents: new Int8Array(this.keel) }),
			indices:
				this.vertices > 0xffff ? new Uint32Array(this.indices) : new Uint16Array(this.indices),
		};
	}

	/** Copies another mesh in, each position and normal through `transform`, each colour through `colour`. */
	append(
		mesh: PrototypeArrays | MeshArrays,
		transform: (p: Vector3, n: Vector3) => void,
		colour?: (bytes: number[], vertex: number) => void,
		uv1?: (uv1: number[], vertex: number) => void,
	): void {
		const base = this.vertices;
		const count = mesh.positions.length / 3;
		const p: Vector3 = [0, 0, 0];
		const n: Vector3 = [0, 0, 0];
		const bytes = [0, 0, 0, 0];
		const second = [0, 0];
		const from: Vector3 = [0, 0, 0];
		const keel: Vector3 = [0, 0, 0];
		const spare: Vector3 = [0, 0, 0];
		const packed = [0, 0, 0, 0];
		for (let i = 0; i < count; i++) {
			from[0] = mesh.positions[i * 3] as number;
			from[1] = mesh.positions[i * 3 + 1] as number;
			from[2] = mesh.positions[i * 3 + 2] as number;
			p[0] = from[0];
			p[1] = from[1];
			p[2] = from[2];
			n[0] = mesh.normals[i * 3] as number;
			n[1] = mesh.normals[i * 3 + 1] as number;
			n[2] = mesh.normals[i * 3 + 2] as number;
			const packedKeel = mesh.tangents ? (mesh.tangents[i * 4 + 3] as number) : 0;
			if (packedKeel > 0) {
				for (let k = 0; k < 3; k++)
					keel[k] = (from[k] as number) - (mesh.tangents?.[i * 4 + k] as number) / KEEL_STEPS;
				transform(keel, spare);
			}
			transform(p, n);
			if (packedKeel > 0) {
				// The offset's direction and scale follow the piece, so the packed keel turns with it.
				for (let k = 0; k < 3; k++)
					packed[k] = Math.max(
						-127,
						Math.min(127, Math.round(((p[k] as number) - (keel[k] as number)) * KEEL_STEPS)),
					);
				packed[3] = 127;
			}
			for (let c = 0; c < 4; c++) bytes[c] = mesh.colors[i * 4 + c] as number;
			colour?.(bytes, i);
			second[0] = mesh.uvs1[i * 2] as number;
			second[1] = mesh.uvs1[i * 2 + 1] as number;
			uv1?.(second, i);
			this.vertex(
				p,
				n,
				[mesh.uvs[i * 2] as number, mesh.uvs[i * 2 + 1] as number],
				second,
				bytes,
				packedKeel > 0 ? packed : undefined,
			);
		}
		for (const index of mesh.indices) this.indices.push(base + (index as number));
	}
}

/** Two unit vectors square to a direction and to each other, the first as near to `hint` as it can be. */
export function sideAxes(
	direction: Readonly<Vector3>,
	hint: Readonly<Vector3>,
): [Vector3, Vector3] {
	let x = cross3(hint, direction, [0, 0, 0]);
	if (x[0] * x[0] + x[1] * x[1] + x[2] * x[2] < 1e-12)
		x = cross3(Math.abs(direction[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1], direction, [0, 0, 0]);
	normalize3(x);
	const y = cross3(direction, x, [0, 0, 0]);
	return [x, y];
}

/** One point of a tube's path: its centre, radius and metres along the tube. */
export interface TubePoint {
	readonly at: Readonly<Vector3>;
	readonly radius: number;
	readonly along: number;
}

/**
 * A tube along a path, a ring of `sides` faces at each point, square to the path, its frame carried
 * from ring to ring without twist. UVs are metres of bark: around, then along, unless `uv` gives a
 * texture coordinate for each ring's around index and ring.
 *
 * @param mesh The writer.
 * @param path The path's points, two at least.
 * @param sides Faces around, three at least.
 * @param colour The colour bytes of each ring, by its index.
 * @param closeTip Whether to close the last ring to a point.
 * @param uv The texture coordinate of a vertex, from its around index and ring.
 */
export function tube(
	mesh: MeshWriter,
	path: readonly TubePoint[],
	sides: number,
	colour: (ring: number) => ArrayLike<number>,
	closeTip = false,
	uv?: (around: number, ring: number) => readonly [number, number],
	second?: (ring: number, radius: number) => readonly [number, number],
): void {
	if (path.length < 2) return;
	let previous = -1;
	let frameX: Vector3 | undefined;
	for (let r = 0; r < path.length; r++) {
		const point = path[r] as TubePoint;
		const from = path[Math.max(0, r - 1)] as TubePoint;
		const to = path[Math.min(path.length - 1, r + 1)] as TubePoint;
		const direction = normalize3([
			to.at[0] - from.at[0],
			to.at[1] - from.at[1],
			to.at[2] - from.at[2],
		]);
		const [x, y] = sideAxes(direction, frameX ?? [0, 0, 1]);
		frameX = x;
		const first = mesh.vertices;
		const around = 2 * Math.PI * Math.max(point.radius, 1e-5);
		for (let j = 0; j <= sides; j++) {
			const angle = (2 * Math.PI * j) / sides;
			const c = cos(angle);
			const s = sin(angle);
			const n: Vector3 = [c * x[0] + s * y[0], c * x[1] + s * y[1], c * x[2] + s * y[2]];
			mesh.vertex(
				[
					point.at[0] + n[0] * point.radius,
					point.at[1] + n[1] * point.radius,
					point.at[2] + n[2] * point.radius,
				],
				n,
				uv ? uv(j, r) : [(j / sides) * around, point.along],
				second ? second(r, point.radius) : [0, 0],
				colour(r),
			);
		}
		if (previous >= 0)
			for (let j = 0; j < sides; j++)
				mesh.quad(previous + j, previous + j + 1, first + j + 1, first + j);
		previous = first;
	}
	if (closeTip) {
		const last = path[path.length - 1] as TubePoint;
		const before = path[path.length - 2] as TubePoint;
		const direction = normalize3([
			last.at[0] - before.at[0],
			last.at[1] - before.at[1],
			last.at[2] - before.at[2],
		]);
		const reach = last.radius;
		const tip = mesh.vertex(
			[
				last.at[0] + direction[0] * reach,
				last.at[1] + direction[1] * reach,
				last.at[2] + direction[2] * reach,
			],
			direction,
			[0, last.along + reach],
			[0, 0],
			colour(path.length - 1),
		);
		for (let j = 0; j < sides; j++) mesh.indices.push(previous + j, previous + j + 1, tip);
	}
}

/**
 * A lathe shape: a profile of [radius, height] pairs turned about an axis, from the base point along
 * the direction. A profile that starts or ends at radius 0 closes there.
 *
 * @param mesh The writer.
 * @param profile Radius and height pairs, in metres, from the base up.
 * @param base Where the axis starts.
 * @param direction The axis, a unit vector.
 * @param sides Faces around.
 * @param colour The colour bytes.
 * @param hint A direction the shape's u seam leans toward.
 * @param pointed Whether a ring of no radius closes the shape with one triangle a side.
 */
export function lathe(
	mesh: MeshWriter,
	profile: readonly (readonly [number, number])[],
	base: Readonly<Vector3>,
	direction: Readonly<Vector3>,
	sides: number,
	colour: ArrayLike<number>,
	hint: Readonly<Vector3> = [0, 0, 1],
	pointed = false,
): void {
	const [x, y] = sideAxes(direction, hint);
	let previous = -1;
	let previousRadius = -1;
	const height = (profile[profile.length - 1] as readonly [number, number])[1] || 1;
	for (let k = 0; k < profile.length; k++) {
		const [radius, h] = profile[k] as readonly [number, number];
		const prev = profile[Math.max(0, k - 1)] as readonly [number, number];
		const next = profile[Math.min(profile.length - 1, k + 1)] as readonly [number, number];
		// The profile's slope tilts each ring's normals along the axis.
		const dr = next[0] - prev[0];
		const dh = next[1] - prev[1];
		const slope = Math.sqrt(dr * dr + dh * dh) || 1;
		const out = dh / slope;
		const up = -dr / slope;
		const first = mesh.vertices;
		for (let j = 0; j <= sides; j++) {
			const angle = (2 * Math.PI * j) / sides;
			const c = cos(angle);
			const s = sin(angle);
			const radial: Vector3 = [c * x[0] + s * y[0], c * x[1] + s * y[1], c * x[2] + s * y[2]];
			const n: Vector3 = [
				radial[0] * out + direction[0] * up,
				radial[1] * out + direction[1] * up,
				radial[2] * out + direction[2] * up,
			];
			mesh.vertex(
				[
					base[0] + direction[0] * h + radial[0] * radius,
					base[1] + direction[1] * h + radial[1] * radius,
					base[2] + direction[2] * h + radial[2] * radius,
				],
				normalize3(n),
				[j / sides, h / height],
				[0, 0],
				colour,
			);
		}
		if (previous >= 0)
			for (let j = 0; j < sides; j++)
				// A pointed lathe closes on a ring of no radius, at either end, with one triangle a
				// side, not a quad whose second half has no area.
				if (pointed && radius === 0) mesh.tri(previous + j, previous + j + 1, first + j + 1);
				else if (pointed && previousRadius === 0) mesh.tri(previous + j, first + j + 1, first + j);
				else mesh.quad(previous + j, previous + j + 1, first + j + 1, first + j);
		previous = first;
		previousRadius = radius;
	}
}
