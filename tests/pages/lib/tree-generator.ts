// A stand-in for the vegetation add-on's tree generator, for the timing page: a parametric model in
// the style of Weber and Penn (1995), which Blender's Sapling and ez-tree follow, in ez-tree's two
// phases. The skeleton makes every random choice and the meshing makes none, so one seed gives one
// tree at every detail. Branches are generalized cylinders swept with a twist-free frame, and the
// last level carries leaf cards. The triangle counts sit in ez-tree's range, so the figures compare
// with the research note's desktop timings. The add-on's own generator (M3-V4) replaces this one.

export type Vec3 = [number, number, number];
export type DetailName = 'low' | 'medium' | 'high' | 'ultra';

/** One level of a species: what a stem of that level grows from its parent's stem. */
export interface Level {
	/** Children that each stem of the level below grows. */
	children: number;
	/** The stem's length, as a share of its parent's length. */
	length: number;
	/** The stem's radius at its base, as a share of its parent's radius. */
	radius: number;
	/** How far a stem leaves its parent's direction, in radians. */
	downAngle: number;
	/** How far a stem curves away from its own first direction, over its length. */
	curve: number;
	/** The sideways wobble of a stem's sections, relative to its radius. */
	gnarliness: number;
	/** Where along its parent a stem starts, from 0 to 1. */
	start: number;
}

/** A species as a short record of numbers. */
export interface Species {
	name: string;
	/** The levels above the trunk: the trunk is level 0. */
	levels: readonly Level[];
	/** Leaf cards that each stem of the last level carries. */
	leafCards: number;
	/** The card's width in metres. */
	leafSize: number;
	/** How much of a last-level stem carries cards, from 0 to 1. */
	leafStart: number;
	/** The trunk's length in metres. */
	trunkLength: number;
	/** The trunk's radius at its base, in metres. */
	trunkRadius: number;
}

/** The rings and radial segments that each detail keeps, and its share of the leaf cards. */
export const DETAIL: Record<DetailName, { sections: number; segments: number; leafShare: number }> =
	{
		low: { sections: 0.5, segments: 0.55, leafShare: 0.4 },
		medium: { sections: 0.7, segments: 0.75, leafShare: 0.7 },
		high: { sections: 1, segments: 1, leafShare: 1 },
		ultra: { sections: 1.25, segments: 1.25, leafShare: 1.2 },
	};

/** Sections along a stem of each level, which the detail scales. */
const LEVEL_SECTIONS = [5, 6, 6, 5];
/** Radial segments around a stem at each level, at the High detail. */
const LEVEL_SEGMENTS = [12, 7, 4, 3];

/** The figures of one generated tree. */
export interface TreeFigures {
	/** Branch triangles and leaf triangles together. */
	triangles: number;
	branchTriangles: number;
	leafTriangles: number;
	/** Vertices, with each ring's seam vertex repeated as its texture coordinates need. */
	vertices: number;
	/** Leaf cards placed. */
	leafCards: number;
	/** Bytes of the vertex, normal, texture-coordinate and index arrays. */
	bytes: number;
}

/** A stem of the skeleton, before meshing. */
interface Stem {
	level: number;
	origin: Vec3;
	dir: Vec3;
	length: number;
	radius: number;
	/** How far its own sections turn away from its first direction. */
	curve: number;
	/** How far its own sections wobble sideways, relative to its radius. */
	gnarliness: number;
}

/** A seeded random number generator: mulberry32, whose stream is fixed for a seed. */
function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function normalize(x: number, y: number, z: number): Vec3 {
	const length = Math.hypot(x, y, z) || 1;
	return [x / length, y / length, z / length];
}

function cross(a: Vec3, b: Vec3): Vec3 {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Any unit vector at right angles to `dir`. */
function perpendicular(dir: Vec3): Vec3 {
	return normalize(...cross(dir, Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
}

/** Rotates `dir` towards `axis` by `angle` radians, where `axis` is at right angles to `dir`. */
function bend(dir: Vec3, axis: Vec3, angle: number): Vec3 {
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const turn = cross(axis, dir);
	return normalize(
		dir[0] * cos + turn[0] * sin,
		dir[1] * cos + turn[1] * sin,
		dir[2] * cos + turn[2] * sin,
	);
}

/** The points and radii of one stem, from its base to its tip. */
interface Walk {
	points: Vec3[];
	radii: number[];
}

/**
 * Grows one stem from its base: each section turns the direction a little, wobbles it, and pulls it
 * up, so thin twigs wobble more than thick limbs.
 */
function walk(stem: Stem, sections: number, next: () => number): Walk {
	const points: Vec3[] = [stem.origin];
	const radii: number[] = [stem.radius];
	let x = stem.origin[0];
	let y = stem.origin[1];
	let z = stem.origin[2];
	let dir = stem.dir;
	const step = stem.length / sections;
	const side = perpendicular(dir);
	// Thin twigs wobble more, but a tiny radius must not blow the wobble up.
	const wobbleScale = Math.min(4, 1 / Math.sqrt(Math.max(0.01, stem.radius)));
	for (let section = 1; section <= sections; section++) {
		const wobble = (next() - 0.5) * 2 * stem.gnarliness * wobbleScale * 0.12;
		dir = bend(dir, side, stem.curve / sections + wobble);
		dir = normalize(dir[0], dir[1] + 0.08, dir[2]);
		x += dir[0] * step;
		y += dir[1] * step;
		z += dir[2] * step;
		points.push([x, y, z]);
		radii.push(stem.radius * (1 - (section / sections) * 0.7));
	}
	return { points, radii };
}

/** Grows the skeleton: the trunk, then each level's stems along their parents. */
function skeleton(species: Species, next: () => number): { stem: Stem; walk: Walk }[] {
	const grown: { stem: Stem; walk: Walk }[] = [];
	let queue: Stem[] = [
		{
			level: 0,
			origin: [0, 0, 0],
			dir: [0, 1, 0],
			length: species.trunkLength,
			radius: species.trunkRadius,
			// A trunk stands almost straight; the branches above it take the species' own curves.
			curve: 0.04,
			gnarliness: 0.04,
		},
	];
	for (let level = 0; level < species.levels.length && queue.length > 0; level++) {
		const rule = species.levels[level] as Level;
		const nextQueue: Stem[] = [];
		for (const stem of queue) {
			const sections = LEVEL_SECTIONS[
				Math.min(level, LEVEL_SECTIONS.length - 1)
			] as number as number;
			const body = walk(stem, sections, next);
			grown.push({ stem, walk: body });
			// Children sit in stratified slots along the parent and around it, so height and angle
			// do not correlate. One jittered offset moves every slot of a parent together.
			const offset = next();
			for (let child = 0; child < rule.children; child++) {
				const along = rule.start + ((1 - rule.start) * (child + offset)) / rule.children;
				const angle = (child / rule.children) * Math.PI * 2 + next() * 0.9;
				const at = Math.min(sections, Math.round(along * sections));
				const origin = body.points[at] as Vec3;
				const ahead = body.points[Math.min(sections, at + 1)] as Vec3;
				const tangent = normalize(ahead[0] - origin[0], ahead[1] - origin[1], ahead[2] - origin[2]);
				// The child leaves the parent's direction around the parent's own axis.
				const across = perpendicular(tangent);
				const along2 = cross(tangent, across);
				const axis = normalize(
					across[0] * Math.cos(angle) + along2[0] * Math.sin(angle),
					across[1] * Math.cos(angle) + along2[1] * Math.sin(angle),
					across[2] * Math.cos(angle) + along2[2] * Math.sin(angle),
				);
				nextQueue.push({
					level: level + 1,
					origin,
					dir: bend(tangent, axis, rule.downAngle + (next() - 0.5) * 0.3),
					length: stem.length * rule.length * (0.8 + next() * 0.4),
					radius: Math.max(0.004, stem.radius * rule.radius * (0.85 + next() * 0.3)),
					curve: rule.curve,
					gnarliness: rule.gnarliness,
				});
			}
		}
		queue = nextQueue;
	}
	// The stems of the deepest level carry the leaves, so they are walked after the loop ends.
	for (const stem of queue) {
		const sections = LEVEL_SECTIONS[Math.min(stem.level, LEVEL_SECTIONS.length - 1)] as number;
		grown.push({ stem, walk: walk(stem, sections, next) });
	}
	return grown;
}

/** A vertex buffer that grows by doubling, as a generator that builds a mesh does. */
class Buffer {
	array = new Float32Array(1 << 14);
	length = 0;

	/** Makes room for `count` more numbers. */
	room(count: number): void {
		if (this.length + count <= this.array.length) return;
		let capacity = this.array.length || 1;
		while (capacity < this.length + count) capacity *= 2;
		const grown = new Float32Array(capacity);
		grown.set(this.array.subarray(0, this.length));
		this.array = grown;
	}

	/** Writes one vertex: its position, its normal and its texture coordinates. */
	vertex(
		x: number,
		y: number,
		z: number,
		nx: number,
		ny: number,
		nz: number,
		u: number,
		v: number,
	): void {
		this.room(8);
		const array = this.array;
		const at = this.length;
		array[at] = x;
		array[at + 1] = y;
		array[at + 2] = z;
		array[at + 3] = nx;
		array[at + 4] = ny;
		array[at + 5] = nz;
		array[at + 6] = u;
		array[at + 7] = v;
		this.length += 8;
	}
}

/** The same stem at another ring count, which keeps its first and last point in place. */
function resample(body: Walk, rings: number): Walk {
	if (rings === body.points.length) return body;
	const points: Vec3[] = [];
	const radii: number[] = [];
	const last = body.points.length - 1;
	for (let ring = 0; ring < rings; ring++) {
		const at = (ring / (rings - 1)) * last;
		const lower = Math.floor(at);
		const upper = Math.min(last, lower + 1);
		const share = at - lower;
		const a = body.points[lower] as Vec3;
		const b = body.points[upper] as Vec3;
		points.push([
			a[0] + (b[0] - a[0]) * share,
			a[1] + (b[1] - a[1]) * share,
			a[2] + (b[2] - a[2]) * share,
		]);
		const low = body.radii[lower] as number;
		radii.push(low + ((body.radii[upper] as number) - low) * share);
	}
	return { points, radii };
}

/** Builds one stem's tube: rings of radial segments, the seam vertex repeated, and no end caps. */
function meshStem(
	body: Walk,
	segments: number,
	vertices: Buffer,
	indices: number[],
	uvWrap: number,
): number {
	const rings = body.points.length;
	const row = segments + 1;
	let normal = perpendicular(normalize(0, 1, 0));
	const first = vertices.length / 8;
	for (let ring = 0; ring < rings; ring++) {
		const point = body.points[ring] as Vec3;
		const ahead = body.points[Math.min(rings - 1, ring + 1)] as Vec3;
		const behind = body.points[Math.max(0, ring - 1)] as Vec3;
		const tangent = normalize(ahead[0] - behind[0], ahead[1] - behind[1], ahead[2] - behind[2]);
		// The frame follows the stem without twisting: the last normal, squared to the tangent.
		const dot = normal[0] * tangent[0] + normal[1] * tangent[1] + normal[2] * tangent[2];
		normal = normalize(
			normal[0] - tangent[0] * dot,
			normal[1] - tangent[1] * dot,
			normal[2] - tangent[2] * dot,
		);
		const across = cross(tangent, normal);
		const radius = body.radii[ring] as number;
		for (let around = 0; around <= segments; around++) {
			const angle = (around / segments) * Math.PI * 2;
			const cos = Math.cos(angle);
			const sin = Math.sin(angle);
			const nx = normal[0] * cos + across[0] * sin;
			const ny = normal[1] * cos + across[1] * sin;
			const nz = normal[2] * cos + across[2] * sin;
			vertices.vertex(
				point[0] + nx * radius,
				point[1] + ny * radius,
				point[2] + nz * radius,
				nx,
				ny,
				nz,
				(around / segments) * uvWrap,
				ring & 1,
			);
		}
	}
	for (let ring = 0; ring < rings - 1; ring++) {
		for (let around = 0; around < segments; around++) {
			const a = first + ring * row + around;
			const b = a + row;
			indices.push(a, b, a + 1, a + 1, b, b + 1);
		}
	}
	return (rings - 1) * segments * 2;
}

/**
 * Generates one tree and returns its figures. The detail sets the rings and radial segments of each
 * stem, and the share of the leaf cards, as a level-of-detail chain does.
 */
export function generateTree(species: Species, detail: DetailName, seed: number): TreeFigures {
	const next = random(seed);
	const settings = DETAIL[detail];
	const grown = skeleton(species, next);
	// The meshing phase uses no random numbers: every detail shares the skeleton.
	const vertices = new Buffer();
	const indices: number[] = [];
	let branchTriangles = 0;
	let leafTriangles = 0;
	let leafCards = 0;
	for (const { stem, walk: body } of grown) {
		const base = LEVEL_SEGMENTS[Math.min(stem.level, LEVEL_SEGMENTS.length - 1)] as number;
		const segments = Math.max(3, Math.round(base * settings.segments));
		const rings = Math.max(2, Math.round(body.points.length * settings.sections));
		const mesh = resample(body, rings);
		branchTriangles += meshStem(
			mesh,
			segments,
			vertices,
			indices,
			Math.max(1, Math.round(stem.radius * 4)),
		);
		if (stem.level !== species.levels.length) continue;
		// The last level carries the leaves: cards along the end of the stem, each two triangles.
		const cards = Math.round(species.leafCards * settings.leafShare);
		const span = mesh.points.length - 1;
		for (let card = 0; card < cards; card++) {
			const at = Math.round(span * (species.leafStart + ((1 - species.leafStart) * card) / cards));
			const point = mesh.points[Math.min(span, at)] as Vec3;
			const size = species.leafSize;
			// A card that faces up and out from the stem: four corners, two triangles.
			const first = vertices.length / 8;
			vertices.vertex(point[0] - size, point[1] - size, point[2], 0, 1, 0, 0, 0);
			vertices.vertex(point[0] + size, point[1] - size, point[2], 0, 1, 0, 1, 0);
			vertices.vertex(point[0] + size, point[1] + size, point[2], 0, 1, 0, 1, 1);
			vertices.vertex(point[0] - size, point[1] + size, point[2], 0, 1, 0, 0, 1);
			indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
			leafTriangles += 2;
			leafCards++;
		}
	}
	return {
		triangles: branchTriangles + leafTriangles,
		branchTriangles,
		leafTriangles,
		vertices: vertices.length / 8,
		leafCards,
		bytes: vertices.length * 4 + indices.length * 4,
	};
}

/**
 * The species that the timing page measures: Creek's oaks, beeches and birches, and the forest's
 * pines. Each is a short record of numbers, as the add-on's species set will be.
 */
export const SPECIES: readonly Species[] = [
	{
		name: 'oak',
		trunkLength: 5.6,
		trunkRadius: 0.3,
		leafCards: 24,
		leafSize: 0.42,
		leafStart: 0.25,
		levels: [
			{
				children: 8,
				length: 0.62,
				radius: 0.62,
				downAngle: 0.75,
				curve: 0.3,
				gnarliness: 0.25,
				start: 0.35,
			},
			{
				children: 6,
				length: 0.58,
				radius: 0.6,
				downAngle: 0.6,
				curve: 0.4,
				gnarliness: 0.35,
				start: 0.15,
			},
			{
				children: 4,
				length: 0.55,
				radius: 0.62,
				downAngle: 0.5,
				curve: 0.5,
				gnarliness: 0.5,
				start: 0.1,
			},
		],
	},
	{
		name: 'beech',
		trunkLength: 6.4,
		trunkRadius: 0.26,
		leafCards: 22,
		leafSize: 0.36,
		leafStart: 0.2,
		levels: [
			{
				children: 8,
				length: 0.58,
				radius: 0.6,
				downAngle: 0.65,
				curve: 0.25,
				gnarliness: 0.2,
				start: 0.4,
			},
			{
				children: 6,
				length: 0.54,
				radius: 0.6,
				downAngle: 0.55,
				curve: 0.4,
				gnarliness: 0.35,
				start: 0.12,
			},
			{
				children: 4,
				length: 0.52,
				radius: 0.62,
				downAngle: 0.45,
				curve: 0.5,
				gnarliness: 0.5,
				start: 0.1,
			},
		],
	},
	{
		name: 'birch',
		trunkLength: 7.2,
		trunkRadius: 0.17,
		leafCards: 20,
		leafSize: 0.3,
		leafStart: 0.35,
		levels: [
			{
				children: 7,
				length: 0.55,
				radius: 0.55,
				downAngle: 0.9,
				curve: 0.35,
				gnarliness: 0.3,
				start: 0.3,
			},
			{
				children: 5,
				length: 0.5,
				radius: 0.58,
				downAngle: 0.7,
				curve: 0.5,
				gnarliness: 0.45,
				start: 0.1,
			},
			{
				children: 4,
				length: 0.48,
				radius: 0.6,
				downAngle: 0.55,
				curve: 0.6,
				gnarliness: 0.6,
				start: 0.08,
			},
		],
	},
	{
		name: 'pine',
		trunkLength: 9.5,
		trunkRadius: 0.22,
		leafCards: 30,
		leafSize: 0.5,
		leafStart: 0.15,
		levels: [
			{
				children: 12,
				length: 0.42,
				radius: 0.4,
				downAngle: 1.5,
				curve: 0.2,
				gnarliness: 0.15,
				start: 0.12,
			},
			{
				children: 3,
				length: 0.4,
				radius: 0.5,
				downAngle: 0.9,
				curve: 0.3,
				gnarliness: 0.3,
				start: 0.2,
			},
		],
	},
];
