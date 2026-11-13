// The scaffold grower: a tree built in a set order, each step a function of the record, the seed
// and the variant, with no simulation between them.
//
// 1. The stem rises from the ground to where its great limbs leave it.
// 2. The crown's foliage masses, the lobes, are ellipsoids that stand against the envelope from
//    inside, spread evenly over it and held apart by the record's gap. The gaps are the sky a viewer
//    sees through the crown, and they break its outline into lumps.
// 3. The great limbs leave the stem round it by the record's arrangement, so they are balanced
//    through the full turn. Each takes the lobes nearest its line and runs to the farthest of them
//    on one smooth curve: out at the species' angle, and rising or dipping at its end.
// 4. A branch runs to each other lobe from the nearest wood of its limb, leaving at no more than
//    the species' angle. Inside a lobe a twig runs the same way to every socket on the lobe's lit
//    side, the nearest sockets first, so the wood divides order by order and every branch end is a
//    socket. This is space colonisation (Runions et al. 2007) with one curve laid for each point
//    that pulls: stepping the wood one internode at a time toward the points left it circling them.
// 5. The radii follow the pipe model from the sockets down, fitted to the stem's width.
// 6. Each socket is a bud site that holds one piece of foliage.
//
// Wood that leads to no socket is cut away, so no branch ends bare, and the socket count bounds
// the branch count. Every choice comes from the integer hash and every angle from the core's own
// trigonometry, so a plant grows the same bytes on every script engine.

import {
	AXIS_LIMB,
	AXIS_STEM,
	BUD_TERMINAL,
	type MacroSkeleton,
	SkeletonBuilder,
} from '../core/graph';
import { unitAt } from '../core/hash';
import {
	acos,
	atan2,
	cos,
	cross3,
	length3,
	normalize3,
	PI,
	pow,
	quatFromFrame,
	radians,
	sin,
	tan,
	type Vector3,
} from '../core/math';
import { thinningRanks } from '../core/rank';
import type { Phyllotaxis, Scaffold, Species } from '../core/record';
import { curveAt, spreadAt, spreadMean } from '../core/types';
import type { GrowInput } from '../stages';
import { type EnvelopeVolume, envelopeVolume } from './envelope';
import { scaledSkeleton, targetHeight } from './height';
import type { Grower } from './models';
import { fitRadii, pipeRadii } from './radii';
import { type StemStart, stemStarts } from './stems';

/** Height in metres where the stem's diameter is measured. */
const BREAST_HEIGHT = 1.3;
/** The golden angle, the divergence that spreads points most evenly round an axis or a sphere. */
const GOLDEN = PI * (3 - Math.sqrt(5));
/** Rows and azimuths of the envelope's surface that a lobe may stand against. */
const SURFACE_ROWS = 40;
const SURFACE_TURNS = 48;
/**
 * Where the lobes inside the crown stand: the share of the way out from the crown's middle to its
 * surface, and that middle's height as a share of the crown's.
 */
const INNER_DEPTH = 0.55;
const INNER_MIDDLE = 0.35;
/**
 * Where no lobe stands: nearer the plant's axis than a share of the crown's reach while lower than
 * a share of the crown's height, so the stem's fork shows through the crown's foot. A lobe inside
 * the crown keeps both, at any height and any distance.
 */
const STEM_CLEAR = 0.22;
const STEM_BARE = 0.4;
/** How far a lobe's place may be weighed up or down against an even spread, as a share. */
const PLACE_VARY = 0.08;
/** The least and most of a lobe's radius that its sockets stand out from its centre. */
const SOCKET_SHELL: readonly [number, number] = [0.3, 0.9];
/** The most lobes one limb carries, against an even share. */
const LIMB_LOAD = 1.4;
/** How far down and in from a lobe's centre its wood arrives, in its half-height and its radius. */
const CORE_DROP = 0.35;
const CORE_INSET = 0.2;
/** The control arms of a limb's and a branch's curve, as shares of its chord: leaving, arriving. */
const LIMB_ARMS: readonly [number, number] = [0.42, 0.3];
const BRANCH_ARMS: readonly [number, number] = [0.4, 0.25];
/** Points along a curve before it is laid out in nodes. */
const CURVE_SAMPLES = 48;
/** How many times finer than its even spacing a curve's nodes may stand before it is laid straight. */
const CURVE_FINEST = 6;
/**
 * Where a stretch of wood forks on its way to a group of lobes: the share of the way to the
 * group's middle, and the share of the way to its nearest lobe, whichever comes first.
 */
const FORK_SHARE = 0.5;
const FORK_BEFORE = 0.7;
/** How much of its leaving line a stretch keeps to its fork, against the line to its lobes. */
const FORK_KEEP = 0.6;
/** The most metres nearer the stem than the wood it leaves that a branch's lobes may stand. */
const INWARD_MOST = 0.5;
/** The most radians between a curve's own line and the direction it arrives in. */
const ARRIVE_MOST = radians(40);
/** The most radians off the wood's line that lobes may stand for the wood to run its axis on to them. */
const RUN_ON_MOST = radians(35);
/** The steps' worth of turn within which the wood that runs on past a fork leaves it. */
const RUN_ON_TURNS = 0.6;
/** How much a branch's cost grows for each of the species' angles it would leave past. */
const ANGLE_COST = 4;
/** The straight lead of a branch or a twig, as a share of the spacing of its nodes. */
const BRANCH_LEAD = 0.8;
/** The most twigs that leave the end of a lobe's own branch, as a bud cluster's shoots do. */
const END_TWIGS = 3;
/** The orders of twig inside one lobe: a twig off the lobe's branch, and a twig off that. */
const TWIG_DEPTH = 2;
/** The least share of its parent's radius that an axis keeps from one node to the next. */
const TAPER_FLOOR = 0.6;
/** The most of its parent's radius that a side axis starts at. */
const SIDE_CAP = 0.85;
/** How far below its lowest socket a crown's foliage hangs, as a share of the socket inset. */
const CROWN_HANG = 0.5;

/**
 * The order each kind of wood takes in the skeleton: the stem, a great limb, a branch that carries a
 * lobe, and after it a twig by its depth inside the lobe. A branch keeps its order whichever wood
 * of its limb it leaves, so a detail level that keeps the branches keeps every lobe's own wood.
 */
const ORDER_STEM = 0;
const ORDER_LIMB = 1;
const ORDER_BRANCH = 2;

/** The hash purposes of the grower's choices, so no two draws share a key. */
const Purpose = {
	LobeCount: 201,
	LobePlace: 202,
	LobeSize: 203,
	LobeTurn: 204,
	LimbCount: 205,
	LimbTurn: 206,
	LimbJitter: 207,
	LimbWander: 208,
	StemWander: 209,
	SocketTurn: 210,
} as const;

/** One foliage mass: an ellipsoid whose axes stand along the plant's. */
interface Lobe {
	/** Its centre. */
	readonly x: number;
	readonly y: number;
	readonly z: number;
	/** Its half-width and its half-height. */
	readonly r: number;
	readonly b: number;
	/** The unit direction from the stem's line out to it, level; zero for a lobe on the line. */
	readonly ox: number;
	readonly oz: number;
	/** The point its wood arrives at. */
	readonly core: Vector3;
}

/** The wood as it is laid: nodes with their parents, before axes and radii. */
interface Wood {
	readonly x: number[];
	readonly y: number[];
	readonly z: number[];
	readonly parent: number[];
	/** The curve a node was laid by: a stem, a limb or a branch; -1 for a twig inside a lobe. */
	readonly curve: number[];
	/** The limb a node belongs to, or -1 on a stem. */
	readonly limb: number[];
	/** The socket at a node, or -1. */
	readonly socket: number[];
	/** The order of the wood a node was laid as: a stem, a limb, a branch, or a twig by its depth. */
	readonly order: number[];
}

/** One socket: a branch end that holds foliage. */
interface Socket {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	/** The direction its foliage grows in, a unit vector. */
	readonly direction: Vector3;
	readonly lobe: number;
}

/** The record's scaffold growth, or an error for another model. */
function growthOf(record: Species): Scaffold {
	if (record.growth.model !== 'scaffold')
		throw new Error(`@null3d/vegetation: ${record.id} does not grow by the scaffold model`);
	return record.growth;
}

/** Adds a node to the wood and returns its index. */
function addWood(
	wood: Wood,
	x: number,
	y: number,
	z: number,
	parent: number,
	curve: number,
	limb: number,
	order: number,
): number {
	wood.order.push(order);
	wood.x.push(x);
	wood.y.push(y);
	wood.z.push(z);
	wood.parent.push(parent);
	wood.curve.push(curve);
	wood.limb.push(limb);
	wood.socket.push(-1);
	return wood.x.length - 1;
}

/** The radians between two unit vectors. */
function angleBetween(a: Readonly<Vector3>, b: Readonly<Vector3>): number {
	return acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
}

/**
 * A unit vector turned from `from` toward `to` until it stands no more than `most` radians from
 * `from`: `to` itself when it already does.
 */
function turnedToward(from: Readonly<Vector3>, to: Readonly<Vector3>, most: number): Vector3 {
	const angle = angleBetween(from, to);
	if (angle <= most || angle < 1e-6) return [to[0], to[1], to[2]];
	const k = sin(angle);
	if (k < 1e-6) {
		// Straight back: any side will do, and the level one keeps the wood from a loop.
		const side = normalize3(cross3(from, [0, 1, 0], [0, 0, 0]));
		return normalize3([
			from[0] * cos(most) + side[0] * sin(most),
			from[1] * cos(most) + side[1] * sin(most),
			from[2] * cos(most) + side[2] * sin(most),
		]);
	}
	const a = sin(angle - most) / k;
	const b = sin(most) / k;
	return normalize3([from[0] * a + to[0] * b, from[1] * a + to[1] * b, from[2] * a + to[2] * b]);
}

/** Degrees between successive limbs round the stem, and the limbs that share one height. */
function arrangementOf(arrangement: Phyllotaxis): {
	readonly step: number;
	readonly whorl: number;
} {
	switch (arrangement.kind) {
		case 'spiral':
			return { step: radians(arrangement.divergence), whorl: 1 };
		case 'distichous':
			return { step: PI, whorl: 1 };
		case 'opposite':
			return { step: PI, whorl: 2 };
		case 'whorled':
			return {
				step: (2 * PI) / Math.max(2, arrangement.count),
				whorl: Math.max(2, arrangement.count),
			};
		default:
			return { step: GOLDEN, whorl: 1 };
	}
}

/**
 * A curve laid out in points an even distance apart, to its end. The wood first leaves straight
 * along the curve's first direction for `lead` metres, which clears its parent's girth, and then
 * follows a cubic curve from there. The points stand close enough that no step turns more than
 * `mostTurn` radians from the last, the first step measured against the straight lead, or against
 * the line the wood arrived on where the curve runs that wood's axis on with no lead.
 *
 * @param p The curve's four control points.
 * @param spacing The most metres between two points.
 * @param lead Metres the wood leaves straight for; its end is the first point.
 * @param mostTurn The most radians between two successive steps.
 * @param offset A sideways offset at each share of the way along, or undefined for none.
 * @param lineIn The direction the wood arrives in, where the curve runs its axis on.
 * @returns The points, three numbers each; the last is the curve's end.
 */
function laidCurve(
	p: readonly [Vector3, Vector3, Vector3, Vector3],
	spacing: number,
	lead: number,
	mostTurn: number,
	offset?: (share: number, out: Vector3) => void,
	lineIn?: Readonly<Vector3>,
): number[] {
	const arm = length3(p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]);
	const chord = length3(p[3][0] - p[0][0], p[3][1] - p[0][1], p[3][2] - p[0][2]);
	const out = normalize3([p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]]);
	// A lead longer than half the way would carry the wood past its end.
	const straight = arm > 1e-9 ? Math.max(0, Math.min(lead, chord * 0.5)) : 0;
	const p0: Vector3 = [
		p[0][0] + out[0] * straight,
		p[0][1] + out[1] * straight,
		p[0][2] + out[2] * straight,
	];
	const p1: Vector3 = [p0[0] + out[0] * arm, p0[1] + out[1] * arm, p0[2] + out[2] * arm];
	const fine = new Float64Array((CURVE_SAMPLES + 1) * 3);
	const along = new Float64Array(CURVE_SAMPLES + 1);
	const shift: Vector3 = [0, 0, 0];
	for (let i = 0; i <= CURVE_SAMPLES; i++) {
		const t = i / CURVE_SAMPLES;
		const u = 1 - t;
		const w0 = u * u * u;
		const w1 = 3 * u * u * t;
		const w2 = 3 * u * t * t;
		const w3 = t * t * t;
		shift[0] = 0;
		shift[1] = 0;
		shift[2] = 0;
		offset?.(t, shift);
		for (let c = 0; c < 3; c++)
			fine[i * 3 + c] =
				w0 * p0[c as 0] + w1 * p1[c as 0] + w2 * p[2][c as 0] + w3 * p[3][c as 0] + shift[c as 0];
		if (i > 0)
			along[i] =
				(along[i - 1] as number) +
				length3(
					(fine[i * 3] as number) - (fine[i * 3 - 3] as number),
					(fine[i * 3 + 1] as number) - (fine[i * 3 - 2] as number),
					(fine[i * 3 + 2] as number) - (fine[i * 3 - 1] as number),
				);
	}
	const total = along[CURVE_SAMPLES] as number;
	const at = (arc: number, to: number[]): void => {
		let i = 1;
		while (i < CURVE_SAMPLES && (along[i] as number) < arc) i++;
		const a = along[i - 1] as number;
		const span = (along[i] as number) - a;
		const k = span > 1e-12 ? (arc - a) / span : 0;
		for (let c = 0; c < 3; c++)
			to.push((fine[(i - 1) * 3 + c] as number) * (1 - k) + (fine[i * 3 + c] as number) * k);
	};
	const first: Readonly<Vector3> | undefined = straight > 0 ? out : lineIn;
	const even = Math.max(1, Math.ceil(total / Math.max(1e-3, spacing)));
	const most = even * CURVE_FINEST;
	let count = even;
	for (;;) {
		const points: number[] = straight > 0 ? [p0[0], p0[1], p0[2]] : [];
		const before = points.length / 3;
		if (count > most) {
			// No layout of the curve bends gently enough: the wood runs straight from its start to
			// its end, with no lead.
			const direct: number[] = [];
			for (let j = 1; j <= even; j++)
				for (let c = 0; c < 3; c++)
					direct.push(p[0][c as 0] + ((p[3][c as 0] - p[0][c as 0]) * j) / even);
			return direct;
		}
		for (let j = 1; j <= count; j++) at((total * j) / count, points);
		let worst = 0;
		let px = p0[0];
		let py = p0[1];
		let pz = p0[2];
		let last = first;
		for (let j = before; j < before + count; j++) {
			const step = normalize3([
				(points[j * 3] as number) - px,
				(points[j * 3 + 1] as number) - py,
				(points[j * 3 + 2] as number) - pz,
			]);
			if (last) worst = Math.max(worst, angleBetween(last, step));
			last = step;
			px = points[j * 3] as number;
			py = points[j * 3 + 1] as number;
			pz = points[j * 3 + 2] as number;
		}
		if (worst <= mostTurn) return points;
		count = Math.ceil(count * Math.max(1.25, worst / mostTurn));
	}
}

/**
 * The lobes of one plant: places spread evenly over the envelope's surface from inside, each an
 * ellipsoid that touches the surface and keeps the record's gap from its neighbours.
 */
function placeLobes(
	g: Scaffold,
	volume: EnvelopeVolume,
	height: number,
	unit: (purpose: number, a?: number, b?: number) => number,
): Lobe[] {
	const flatten = Math.max(0.05, g.lobes.flatten);
	const low = Math.max(volume.base, Math.min(0.9, Math.max(0, g.lobes.floor)) * height);
	const top = volume.top;
	// The surface's points, each with the surface's outward normal there.
	const sx: number[] = [];
	const sy: number[] = [];
	const sz: number[] = [];
	const nx: number[] = [];
	const ny: number[] = [];
	const nz: number[] = [];
	const weight: number[] = [];
	const rise = (top - low) / SURFACE_ROWS;
	const clear = volume.reach * STEM_CLEAR;
	const bare = low + (top - low) * STEM_BARE;
	for (let row = 0; row < SURFACE_ROWS; row++) {
		const y = low + (row + 0.5) * rise;
		for (let turn = 0; turn < SURFACE_TURNS; turn++) {
			const azimuth = ((turn + unit(Purpose.LobePlace, row, turn)) / SURFACE_TURNS) * 2 * PI;
			const radius = volume.radius(y, azimuth);
			if (!(radius > 0)) continue;
			// No lobe stands on the stem and the bases of its limbs: a measured outline can run in
			// to the stem at the crown's foot, and the bark there shows through the crown.
			if (radius < clear && y < bare) continue;
			const slope =
				(volume.radius(Math.min(top, y + rise * 0.5), azimuth) -
					volume.radius(Math.max(low, y - rise * 0.5), azimuth)) /
				rise;
			const normal = normalize3([cos(azimuth), -slope, sin(azimuth)]);
			sx.push(radius * cos(azimuth));
			sy.push(y);
			sz.push(radius * sin(azimuth));
			nx.push(normal[0]);
			ny.push(normal[1]);
			nz.push(normal[2]);
			weight.push(1 + (unit(Purpose.LobePlace, row, turn + SURFACE_TURNS) * 2 - 1) * PLACE_VARY);
		}
	}
	// The same places drawn in toward the crown's middle, for the lobes that stand behind the outer
	// ones. Such a place has no surface to stand against, so it keeps no normal.
	const outer = sx.length;
	const middle = low + (top - low) * INNER_MIDDLE;
	for (let s = 0; s < outer; s++) {
		const out = length3(sx[s] as number, 0, sz[s] as number) * INNER_DEPTH;
		const up = middle + ((sy[s] as number) - middle) * INNER_DEPTH;
		if (out < clear || up < bare) continue;
		sx.push((sx[s] as number) * INNER_DEPTH);
		sy.push(middle + ((sy[s] as number) - middle) * INNER_DEPTH);
		sz.push((sz[s] as number) * INNER_DEPTH);
		nx.push(0);
		ny.push(0);
		nz.push(0);
		weight.push(weight[s] as number);
	}
	const places = sx.length;
	const wanted = Math.max(1, Math.round(spreadAt(g.lobes.count, unit(Purpose.LobeCount))));
	const count = Math.min(wanted, outer);
	if (count === 0) return [];
	const inside =
		places > outer
			? Math.min(count - 1, Math.round(count * Math.min(0.5, Math.max(0, g.lobes.inner))))
			: 0;
	// Farthest-point choice: each lobe takes the place farthest from every lobe before it, so the
	// lobes stand evenly over the surface whatever its shape. A lobe is flatter than it is wide, so
	// heights count for more than widths.
	const apart = (a: number, b: number): number => {
		const dx = (sx[a] as number) - (sx[b] as number);
		const dy = ((sy[a] as number) - (sy[b] as number)) / flatten;
		const dz = (sz[a] as number) - (sz[b] as number);
		return Math.sqrt(dx * dx + dy * dy + dz * dz);
	};
	const nearest = new Float64Array(places).fill(Number.POSITIVE_INFINITY);
	const chosen: number[] = [];
	// The first lobe is the crown's top, so the plant's height does not hang on a draw.
	let next = 0;
	for (let s = 1; s < places; s++) if ((sy[s] as number) > (sy[next] as number)) next = s;
	for (let k = 0; k < count; k++) {
		chosen.push(next);
		// The outer lobes first, then the inner ones, which so fall behind the gaps the outer leave.
		const from = k + 1 < count - inside ? 0 : outer;
		const to = k + 1 < count - inside ? outer : places;
		let best = -1;
		let far = -1;
		for (let s = 0; s < places; s++) {
			const d = apart(s, next);
			if (d < (nearest[s] as number)) nearest[s] = d;
			if (s < from || s >= to) continue;
			const reach = (nearest[s] as number) * (weight[s] as number);
			if (reach > far) {
				far = reach;
				best = s;
			}
		}
		next = best;
	}
	const gap = Math.min(0.8, Math.max(0, g.lobes.gap));
	const vary = Math.min(0.5, Math.max(0, g.lobes.vary));
	return chosen.map((s, k) => {
		let neighbour = Number.POSITIVE_INFINITY;
		for (const other of chosen) if (other !== s) neighbour = Math.min(neighbour, apart(s, other));
		// A lone lobe fills the crown.
		if (!Number.isFinite(neighbour)) neighbour = Math.max(top - low, volume.reach) / flatten;
		const size = 1 + (unit(Purpose.LobeSize, k) * 2 - 1) * vary;
		const r = Math.max(0.05, 0.5 * neighbour * (1 - gap) * size);
		const b = r * flatten;
		// The lobe touches the surface from inside: its centre stands back along the normal by the
		// ellipsoid's own reach that way.
		const n: Vector3 = [nx[s] as number, ny[s] as number, nz[s] as number];
		const back = Math.sqrt(r * r * (n[0] * n[0] + n[2] * n[2]) + b * b * n[1] * n[1]);
		const x = (sx[s] as number) - n[0] * back;
		const y = Math.max(low + b, (sy[s] as number) - n[1] * back);
		const z = (sz[s] as number) - n[2] * back;
		const out = Math.sqrt(x * x + z * z);
		const ox = out > 1e-6 ? x / out : 0;
		const oz = out > 1e-6 ? z / out : 0;
		return {
			x,
			y,
			z,
			r,
			b,
			ox,
			oz,
			core: [x - ox * r * CORE_INSET, y - b * CORE_DROP, z - oz * r * CORE_INSET],
		};
	});
}

/**
 * The sockets of one lobe: points spread evenly over the ellipsoid that stands inside its surface
 * by the record's inset, on the side that faces out and up from the plant.
 */
function lobeSockets(g: Scaffold, lobe: Lobe, index: number, turn: number, out: Socket[]): void {
	const shell = Math.min(
		SOCKET_SHELL[1],
		Math.max(SOCKET_SHELL[0], 1 - Math.max(0, g.sockets.inset) / lobe.r),
	);
	const a = lobe.r * shell;
	const b = lobe.b * shell;
	// The sockets are counted over the lobe's own surface, which their foliage covers, and stand
	// inside it: Thomsen's approximation of an ellipsoid's surface.
	const p = 1.6075;
	const area = 4 * PI * pow((2 * pow(lobe.r, p) * pow(lobe.b, p) + pow(lobe.r, 2 * p)) / 3, 1 / p);
	const spacing = Math.max(0.05, g.sockets.spacing);
	const lit = Math.min(1, Math.max(0.2, g.sockets.lit));
	const whole = Math.max(2, Math.round(area / (spacing * spacing)));
	// The lit side faces out from the stem and up; a lobe on the stem's line is lit from above.
	const light = normalize3([lobe.ox, 1, lobe.oz]);
	const least = 1 - 2 * lit;
	const lift = Math.min(1, Math.max(-1, g.branches.lift));
	for (let k = 0; k < whole; k++) {
		// A spiral of points over the sphere, each ring a golden angle on from the last.
		const up = 1 - (2 * (k + 0.5)) / whole;
		const ring = Math.sqrt(Math.max(0, 1 - up * up));
		const angle = turn + k * GOLDEN;
		const ux = ring * cos(angle);
		const uz = ring * sin(angle);
		if (ux * light[0] + up * light[1] + uz * light[2] < least) continue;
		// The surface's own normal at the point, turned toward the sky or the ground by the lift.
		const direction = normalize3([ux / a, up / b + (lift * (1 - Math.abs(up))) / b, uz / a]);
		out.push({
			x: lobe.x + ux * a,
			y: lobe.y + up * b,
			z: lobe.z + uz * a,
			direction,
			lobe: index,
		});
	}
}

/** The vector from one point to another. */
function span(from: Readonly<Vector3>, to: Readonly<Vector3>): Vector3 {
	return [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
}

/** The dot product of two vectors. */
function dot(a: Readonly<Vector3>, b: Readonly<Vector3>): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * The control points of a curve that leaves a point one way and arrives at another point another
 * way, each arm a share of the curve's reach.
 */
function curveFrom(
	start: Readonly<Vector3>,
	leave: Readonly<Vector3>,
	end: Readonly<Vector3>,
	arrive: Readonly<Vector3>,
	reach: number,
	arms: readonly [number, number],
): [Vector3, Vector3, Vector3, Vector3] {
	return [
		[start[0], start[1], start[2]],
		[
			start[0] + leave[0] * reach * arms[0],
			start[1] + leave[1] * reach * arms[0],
			start[2] + leave[2] * reach * arms[0],
		],
		[
			end[0] - arrive[0] * reach * arms[1],
			end[1] - arrive[1] * reach * arms[1],
			end[2] - arrive[2] * reach * arms[1],
		],
		[end[0], end[1], end[2]],
	];
}

/** One great limb before it is laid: where it leaves its stem, its line and the lobes it carries. */
interface Limb {
	/** The stem's node it leaves. */
	readonly joint: number;
	/** The direction the record's arrangement and angle give it, a unit vector. */
	readonly aim: Vector3;
	/** Its place among its stem's limbs, 0 the lowest and 1 the highest. */
	readonly share: number;
	readonly lobes: number[];
}

/** One stretch of wood still to lay: from a node, heading a way, to a group of lobes. */
interface Stretch {
	readonly from: number;
	/** The direction the stretch leaves in when the record names it, as a limb's joint does. */
	readonly leave?: Vector3;
	/** The most radians the stretch may leave its parent's line at. */
	readonly most: number;
	readonly lobes: readonly number[];
	readonly curve: number;
	readonly order: number;
	/** Metres the stretch leaves straight for: its parent's own girth. */
	readonly lead: number;
	/** Whether the stretch runs on the axis of the wood it starts from. */
	readonly on: boolean;
}

/** One plant as it is laid: its wood so far, its lobes, its sockets and the record's numbers. */
class Laying {
	readonly wood: Wood = {
		x: [],
		y: [],
		z: [],
		parent: [],
		curve: [],
		limb: [],
		socket: [],
		order: [],
	};
	readonly sockets: Socket[] = [];
	/** The nodes each lobe's twigs may start from. */
	readonly seeds: number[][];
	/** Curves laid so far: a stem, a limb, a branch and a twig each take the next number. */
	curves = 0;
	/** Metres of one twig internode, and the least metres between two branches along a parent. */
	readonly step: number;
	readonly spacing: number;
	/** The most radians one internode turns, and the most between a branch and its parent. */
	readonly mostTurn: number;
	readonly mostAngle: number;

	constructor(
		readonly g: Scaffold,
		readonly lobes: readonly Lobe[],
		readonly unit: (purpose: number, a?: number, b?: number) => number,
	) {
		this.seeds = lobes.map(() => []);
		this.step = Math.max(0.05, g.branches.step);
		this.spacing = Math.max(this.step, g.branches.spacing);
		this.mostTurn = radians(Math.min(90, Math.max(2, g.branches.turn)));
		this.mostAngle = radians(Math.min(90, Math.max(5, g.branches.angle)));
	}

	/** A node's place. */
	at(n: number): Vector3 {
		const { x, y, z } = this.wood;
		return [x[n] as number, y[n] as number, z[n] as number];
	}

	/** The unit direction of the wood as it arrives at a node. */
	arriving(n: number): Vector3 {
		const p = this.wood.parent[n] as number;
		return p < 0 ? [0, 1, 0] : normalize3(span(this.at(p), this.at(n)));
	}

	/** Lays a curve's points as nodes after a node, and returns them. */
	lay(
		points: readonly number[],
		from: number,
		curve: number,
		limb: number,
		order: number,
	): number[] {
		const nodes: number[] = [];
		let last = from;
		for (let j = 0; j < points.length; j += 3) {
			last = addWood(
				this.wood,
				points[j] as number,
				points[j + 1] as number,
				points[j + 2] as number,
				last,
				curve,
				limb,
				order,
			);
			nodes.push(last);
		}
		return nodes;
	}

	/** Slow bends either side of a curve's line, none at its ends, so its joints keep their angles. */
	wander(
		line: Readonly<Vector3>,
		reach: number,
		key: number,
	): ((share: number, out: Vector3) => void) | undefined {
		if (!(reach > 0)) return undefined;
		const across = normalize3(
			cross3(line, Math.abs(line[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], [0, 0, 0]),
		);
		const over = normalize3(cross3(across, line, [0, 0, 0]));
		const phaseA = this.unit(Purpose.LimbWander, key, 0) * 2 * PI;
		const phaseB = this.unit(Purpose.LimbWander, key, 1) * 2 * PI;
		return (share, out) => {
			const window = sin(PI * share) * sin(PI * share) * reach;
			const a = sin(phaseA + share * 2 * PI) * window;
			const b = sin(phaseB + share * 3 * PI) * window * 0.5;
			out[0] = across[0] * a + over[0] * b;
			out[1] = across[1] * a + over[1] * b;
			out[2] = across[2] * a + over[2] * b;
		};
	}

	/**
	 * The stems, each with a node at every height a limb leaves it, and each stem's limbs by the
	 * record's arrangement round it.
	 *
	 * @param starts The stems' feet and lines.
	 * @param height The height the plant is laid out at.
	 * @returns The limbs, none yet with its lobes.
	 */
	layStems(starts: readonly StemStart[], height: number): Limb[] {
		const { g, wood, unit, step } = this;
		const forkFrom = Math.min(0.98, Math.max(0.01, g.trunk.fork[0])) * height;
		const forkTo = Math.max(forkFrom, Math.min(0.99, g.trunk.fork[1]) * height);
		const perStem = Math.max(1, Math.round(spreadAt(g.limbs.count, unit(Purpose.LimbCount))));
		const arrangement = arrangementOf(g.limbs.arrangement);
		// The heights of a stem's limbs: a whorl's limbs share one.
		const tiers = Math.max(1, Math.ceil(perStem / arrangement.whorl));
		const jointHeight = (limb: number): number => {
			const tier = Math.floor(limb / arrangement.whorl);
			return forkFrom + (tiers > 1 ? tier / (tiers - 1) : 1) * (forkTo - forkFrom);
		};
		const wander = tan(radians(Math.min(30, Math.max(0, g.trunk.wander))));
		const jitter = radians(Math.max(0, g.limbs.jitter));
		const limbs: Limb[] = [];
		starts.forEach((start, s) => {
			const heights = new Set<number>();
			for (let y = step * 2; y < forkTo - step; y += step * 2) heights.add(y);
			for (let limb = 0; limb < perStem; limb++) heights.add(jointHeight(limb));
			heights.add(forkTo);
			const phase = unit(Purpose.StemWander, s) * 2 * PI;
			const side = normalize3(cross3(start.direction as Vector3, [0.3, 0, 1], [0, 0, 0]));
			const fore = normalize3(cross3(side, start.direction as Vector3, [0, 0, 0]));
			const curve = this.curves++;
			const nodeAt = new Map<number, number>();
			let last = addWood(wood, start.x, 0, start.z, -1, curve, -1, ORDER_STEM);
			for (const y of [...heights].sort((a, b) => a - b)) {
				// A slow curve about the stem's line, nothing at the foot, so the bole stands plumb there.
				const run = y / Math.max(1e-6, start.direction[1]);
				const sway = wander * y * 0.5;
				const a = sin(phase + (y / height) * 3 * PI) * sway;
				const b = sin(phase * 1.7 + (y / height) * 2 * PI) * sway;
				last = addWood(
					wood,
					start.x + start.direction[0] * run + side[0] * a + fore[0] * b,
					y,
					start.z + start.direction[2] * run + side[2] * a + fore[2] * b,
					last,
					curve,
					-1,
					ORDER_STEM,
				);
				nodeAt.set(y, last);
			}
			const first = unit(Purpose.LimbTurn, s) * 2 * PI;
			for (let limb = 0; limb < perStem; limb++) {
				const share = perStem > 1 ? limb / (perStem - 1) : 1;
				const tier = Math.floor(limb / arrangement.whorl);
				// A whorl turns half a step on from the one below, so its limbs stand over the gaps.
				const azimuth =
					first +
					limb * arrangement.step +
					(arrangement.whorl > 1 ? tier * arrangement.step * 0.5 : 0) +
					(unit(Purpose.LimbJitter, s, limb) * 2 - 1) * jitter;
				const lean = radians(Math.min(175, Math.max(0, curveAt(g.limbs.angle, share))));
				limbs.push({
					joint: nodeAt.get(jointHeight(limb)) as number,
					aim: [sin(lean) * cos(azimuth), cos(lean), sin(lean) * sin(azimuth)],
					share,
					lobes: [],
				});
			}
		});
		return limbs;
	}

	/** Gives each lobe to the limb whose line points nearest it; no limb takes more than its load. */
	shareLobes(limbs: readonly Limb[]): void {
		const pairs: { readonly lobe: number; readonly limb: number; readonly fit: number }[] = [];
		this.lobes.forEach((lobe, k) => {
			limbs.forEach((limb, i) => {
				const toward = normalize3(span(this.at(limb.joint), lobe.core));
				pairs.push({ lobe: k, limb: i, fit: dot(toward, limb.aim) });
			});
		});
		pairs.sort((a, b) => b.fit - a.fit || a.lobe - b.lobe || a.limb - b.limb);
		const load = Math.max(
			1,
			Math.ceil((this.lobes.length / Math.max(1, limbs.length)) * LIMB_LOAD),
		);
		const taken = new Uint8Array(this.lobes.length);
		for (const pair of pairs) {
			if (taken[pair.lobe]) continue;
			const limb = limbs[pair.limb] as Limb;
			if (limb.lobes.length >= load) continue;
			taken[pair.lobe] = 1;
			limb.lobes.push(pair.lobe);
		}
	}

	/**
	 * The node at or before a node, on the same limb, from which wood can leave toward a point at
	 * no more than the species' angle and without running back in toward the stem: a lobe that the
	 * wood has passed is reached from where the wood passed it, never by a turn back.
	 *
	 * @param from The node the wood would leave.
	 * @param point Where the wood is bound.
	 * @param stem The stem's place, which the wood runs out from.
	 * @returns The node to leave from.
	 */
	passedAt(from: number, point: Readonly<Vector3>, stem: Readonly<Vector3>): number {
		const { wood } = this;
		const out = length3(point[0] - stem[0], 0, point[2] - stem[2]);
		let n = from;
		while ((wood.limb[n] as number) >= 0) {
			const here = this.at(n);
			const off = length3(here[0] - stem[0], 0, here[2] - stem[2]);
			const angle = angleBetween(this.arriving(n), normalize3(span(here, point)));
			if (angle <= this.mostAngle && off <= out + INWARD_MOST) return n;
			const p = wood.parent[n] as number;
			if (p < 0 || (wood.limb[p] as number) !== (wood.limb[n] as number)) return n;
			n = p;
		}
		return n;
	}

	/**
	 * Lays one great limb and the branches that leave it. The wood divides as it runs out: each
	 * stretch runs toward the middle of its lobes and forks short of the nearest of them. One side
	 * runs the stretch's own axis on and the other leaves it as a branch. A stretch with one lobe
	 * left runs into that lobe.
	 *
	 * @param limb The limb.
	 * @param index The limb's index, which its wood carries.
	 * @param stemRadius The stem's radius in metres, which the limb leaves straight to clear.
	 */
	layLimb(limb: Limb, index: number, stemRadius: number): void {
		if (limb.lobes.length === 0) return;
		const { g, lobes, spacing, mostAngle } = this;
		const joint = this.at(limb.joint);
		// The limb leaves toward the middle of its group, at the angle from the stem's line that
		// the record gives its place on the stem, so its curve does not swing across the crown.
		const middle: Vector3 = [0, 0, 0];
		for (const k of limb.lobes) {
			const core = (lobes[k] as Lobe).core;
			middle[0] += core[0] - joint[0];
			middle[1] += core[1] - joint[1];
			middle[2] += core[2] - joint[2];
		}
		const lean = acos(Math.min(1, Math.max(-1, limb.aim[1])));
		const round =
			length3(middle[0], 0, middle[2]) > 1e-6
				? atan2(middle[2], middle[0])
				: atan2(limb.aim[2], limb.aim[0]);
		const pitch = radians(Math.min(90, Math.max(-90, curveAt(g.limbs.end, limb.share))));
		const waiting: Stretch[] = [
			{
				from: limb.joint,
				leave: [sin(lean) * cos(round), cos(lean), sin(lean) * sin(round)],
				most: mostAngle,
				lobes: limb.lobes,
				curve: this.curves++,
				order: ORDER_LIMB,
				lead: Math.max(spacing, stemRadius * 1.1),
				on: false,
			},
		];
		while (waiting.length > 0) {
			const stretch = waiting.shift() as Stretch;
			if (stretch.lobes.length === 1) this.layToLobe(stretch, index, joint, pitch);
			else this.layToFork(stretch, index, joint, waiting);
		}
	}

	/** Lays the last stretch of wood to one lobe, whose twigs then start from it. */
	private layToLobe(stretch: Stretch, limb: number, joint: Readonly<Vector3>, pitch: number): void {
		const { lobes, spacing, mostAngle } = this;
		const k = stretch.lobes[0] as number;
		const lobe = lobes[k] as Lobe;
		const core = lobe.core;
		// A lobe the wood has passed is reached by a branch from where the wood passed it.
		const foot = stretch.leave ? stretch.from : this.passedAt(stretch.from, core, joint);
		const moved = foot !== stretch.from;
		const order = moved ? ORDER_BRANCH : stretch.order;
		const isLimb = order === ORDER_LIMB;
		const start = this.at(foot);
		const line = this.arriving(foot);
		// The wood runs its axis on only toward a lobe that stands nearly on its line; toward any
		// other it leaves as a branch, so no axis bends tightly to reach its lobe.
		const runs =
			stretch.on && !moved && angleBetween(line, normalize3(span(start, core))) <= RUN_ON_MOST;
		const curve = moved || (stretch.on && !runs) ? this.curves++ : stretch.curve;
		const distance = length3(core[0] - start[0], core[1] - start[1], core[2] - start[2]);
		if (distance < 1e-6) {
			(this.seeds[k] as number[]).push(foot);
			return;
		}
		const toward = normalize3(span(start, core));
		const leave =
			stretch.leave ?? turnedToward(line, toward, stretch.on && !runs ? mostAngle : stretch.most);
		// A limb arrives level with the ground turned by the record's end angle, rising or dipping;
		// a branch arrives heading out and up into its lobe, so its twigs fan on from it.
		const flat = normalize3([toward[0], 0, toward[2]]);
		const level = length3(toward[0], 0, toward[2]) > 1e-6;
		const into: Vector3 =
			isLimb && level
				? [flat[0] * cos(pitch), sin(pitch), flat[2] * cos(pitch)]
				: normalize3([toward[0] + lobe.ox * 0.5, toward[1] + 0.5, toward[2] + lobe.oz * 0.5]);
		// However it arrives, it does so within a set angle of its own line, so it never hooks.
		const arrive = turnedToward(toward, into, ARRIVE_MOST);
		const laid = laidCurve(
			curveFrom(start, leave, core, arrive, distance, isLimb ? LIMB_ARMS : BRANCH_ARMS),
			spacing,
			runs ? 0 : moved || stretch.on ? spacing * BRANCH_LEAD : stretch.lead,
			this.mostTurn,
			isLimb ? this.wander(toward, Math.max(0, this.g.limbs.wander) * distance, curve) : undefined,
			runs ? line : undefined,
		);
		(this.seeds[k] as number[]).push(...this.lay(laid, foot, curve, limb, order));
	}

	/** Lays a stretch of wood to where it forks toward a group of lobes, and queues its two sides. */
	private layToFork(
		stretch: Stretch,
		limb: number,
		joint: Readonly<Vector3>,
		waiting: Stretch[],
	): void {
		const { lobes, spacing, mostAngle, mostTurn } = this;
		/** A lobe's weight where a group is weighed: the surface its foliage covers. */
		const weigh = (k: number): number => (lobes[k] as Lobe).r * (lobes[k] as Lobe).r;
		const coreOf = (k: number): Vector3 => (lobes[k] as Lobe).core;
		// The middle of the group, each lobe by its weight.
		const centre: Vector3 = [0, 0, 0];
		let weight = 0;
		for (const k of stretch.lobes) {
			const core = coreOf(k);
			const w = weigh(k);
			centre[0] += core[0] * w;
			centre[1] += core[1] * w;
			centre[2] += core[2] * w;
			weight += w;
		}
		centre[0] /= weight;
		centre[1] /= weight;
		centre[2] /= weight;
		// A group the wood has passed leaves it as a branch from where the wood passed it.
		const foot = stretch.leave ? stretch.from : this.passedAt(stretch.from, centre, joint);
		if (foot !== stretch.from) {
			waiting.unshift({
				...stretch,
				from: foot,
				most: mostAngle,
				curve: this.curves++,
				lead: spacing * BRANCH_LEAD,
				on: false,
			});
			return;
		}
		const start = this.at(stretch.from);
		const line = this.arriving(stretch.from);
		const isLimb = stretch.order === ORDER_LIMB;
		const toward = normalize3(span(start, centre));
		const whole = length3(centre[0] - start[0], centre[1] - start[1], centre[2] - start[2]);
		/** How far along the line to the group's middle a lobe stands. */
		const along = (k: number): number => {
			const core = coreOf(k);
			return (
				(core[0] - start[0]) * toward[0] +
				(core[1] - start[1]) * toward[1] +
				(core[2] - start[2]) * toward[2]
			);
		};
		// The lobes that stand nearer along the line than a fork can: each takes a branch of its own
		// from the wood here, and the rest go on as a group. When every lobe stands near, the
		// heaviest keeps the stretch and the others leave.
		const least = Math.max(stretch.lead, spacing * BRANCH_LEAD) + spacing;
		const near = stretch.lobes.filter((k) => along(k) < least);
		if (near.length > 0) {
			const keeps =
				near.length < stretch.lobes.length
					? stretch.lobes.filter((k) => !near.includes(k))
					: [near.reduce((best, k) => (weigh(k) > weigh(best) ? k : best))];
			for (const k of stretch.lobes) {
				if (keeps.includes(k)) continue;
				waiting.push({
					from: stretch.from,
					most: mostAngle,
					lobes: [k],
					curve: this.curves++,
					order: ORDER_BRANCH,
					lead: spacing * BRANCH_LEAD,
					on: false,
				});
			}
			waiting.unshift({ ...stretch, lobes: keeps });
			return;
		}
		let nearest = Number.POSITIVE_INFINITY;
		for (const k of stretch.lobes) nearest = Math.min(nearest, along(k));
		const run = Math.max(least, Math.min(whole * FORK_SHARE, nearest * FORK_BEFORE));
		const leave = stretch.leave ?? turnedToward(line, toward, stretch.most);
		// The fork stands along the stretch's own leaving line as much as toward the group, so a
		// limb that leaves the stem level stays level until it has cleared the stem.
		const aim = normalize3([
			toward[0] + leave[0] * FORK_KEEP,
			toward[1] + leave[1] * FORK_KEEP,
			toward[2] + leave[2] * FORK_KEEP,
		]);
		const fork: Vector3 = [
			start[0] + aim[0] * run,
			start[1] + aim[1] * run,
			start[2] + aim[2] * run,
		];
		const laid = laidCurve(
			curveFrom(start, leave, fork, toward, run, BRANCH_ARMS),
			spacing,
			stretch.lead,
			mostTurn,
			isLimb
				? this.wander(
						aim,
						Math.max(0, this.g.limbs.wander) * run,
						stretch.curve * 8 + stretch.lobes.length,
					)
				: undefined,
			stretch.on ? line : undefined,
		);
		const nodes = this.lay(laid, stretch.from, stretch.curve, limb, stretch.order);
		const end = nodes[nodes.length - 1] as number;
		// The two lobes that stand widest apart, seen from the fork, each gather the lobes nearer
		// their own side.
		const seen = stretch.lobes.map((k) => normalize3(span(fork, coreOf(k))));
		let first = 0;
		let second = 1;
		let widest = -1;
		for (let a = 0; a < seen.length; a++)
			for (let b = a + 1; b < seen.length; b++) {
				const angle = angleBetween(seen[a] as Vector3, seen[b] as Vector3);
				if (angle > widest) {
					widest = angle;
					first = a;
					second = b;
				}
			}
		const sides: [number[], number[]] = [[], []];
		stretch.lobes.forEach((k, at) => {
			const toFirst = angleBetween(seen[at] as Vector3, seen[first] as Vector3);
			const toSecond = angleBetween(seen[at] as Vector3, seen[second] as Vector3);
			sides[toFirst <= toSecond ? 0 : 1].push(k);
		});
		const heavy = (side: readonly number[]): number => side.reduce((sum, k) => sum + weigh(k), 0);
		// The side that stands more nearly on the wood's line runs its axis on, when it stands near
		// enough to that line; the other side leaves as a branch. Where neither does, the axis ends
		// in the fork and both sides leave it, the heavier as wood of its own order.
		const lineOut = this.arriving(end);
		const off = sides.map((side) => {
			const mid: Vector3 = [0, 0, 0];
			for (const k of side) {
				const core = coreOf(k);
				mid[0] += (core[0] - fork[0]) * weigh(k);
				mid[1] += (core[1] - fork[1]) * weigh(k);
				mid[2] += (core[2] - fork[2]) * weigh(k);
			}
			return angleBetween(lineOut, normalize3(mid));
		}) as [number, number];
		const straighter = off[0] <= off[1] ? 0 : 1;
		const runsOn = off[straighter] <= RUN_ON_MOST;
		const main = runsOn ? straighter : heavy(sides[0]) >= heavy(sides[1]) ? 0 : 1;
		waiting.push({
			from: end,
			most: runsOn ? mostTurn * RUN_ON_TURNS : mostAngle,
			lobes: sides[main],
			curve: runsOn ? stretch.curve : this.curves++,
			order: stretch.order,
			lead: runsOn ? 0 : spacing * BRANCH_LEAD,
			on: runsOn,
		});
		waiting.push({
			from: end,
			most: mostAngle,
			lobes: sides[main === 0 ? 1 : 0],
			curve: this.curves++,
			order: ORDER_BRANCH,
			lead: spacing * BRANCH_LEAD,
			on: false,
		});
	}

	/**
	 * Lays the twigs of one lobe: a twig runs to every socket from the nearest wood of the lobe that
	 * lets it leave at no more than the species' angle. The nearest sockets come first, so the
	 * farther ones leave the twigs before them and the wood divides order by order toward the lobe's
	 * surface.
	 *
	 * @param lobe The lobe.
	 * @param k The lobe's index.
	 */
	layTwigs(lobe: Lobe, k: number): void {
		const { g, wood, sockets, step, mostAngle } = this;
		const from = this.seeds[k] as number[];
		if (from.length === 0) return;
		const first = sockets.length;
		lobeSockets(g, lobe, k, this.unit(Purpose.SocketTurn, k) * 2 * PI, sockets);
		const limb = wood.limb[from[0] as number] as number;
		// The wood a twig may leave, and how many twigs each node already carries. A twig that left
		// another twig carries none, so the wood inside a lobe divides no more than twice.
		const open: number[] = [...from];
		const depth = new Map<number, number>();
		const carried = new Map<number, number>();
		const end = from[from.length - 1] as number;
		const placeOf = (s: number): Vector3 => {
			const socket = sockets[s] as Socket;
			return [socket.x, socket.y, socket.z];
		};
		const reachOf = (s: number): number => {
			const place = placeOf(s);
			let best = Number.POSITIVE_INFINITY;
			for (const n of from) {
				const here = this.at(n);
				best = Math.min(best, length3(place[0] - here[0], place[1] - here[1], place[2] - here[2]));
			}
			return best;
		};
		const waiting: number[] = [];
		for (let s = first; s < sockets.length; s++) waiting.push(s);
		const nearness = new Map(waiting.map((s) => [s, reachOf(s)]));
		waiting.sort((a, b) => (nearness.get(a) as number) - (nearness.get(b) as number) || a - b);
		for (const s of waiting) {
			const socket = sockets[s] as Socket;
			const place = placeOf(s);
			let best = -1;
			let bestCost = Number.POSITIVE_INFINITY;
			let full = -1;
			let fullCost = Number.POSITIVE_INFINITY;
			for (const n of open) {
				const toward = span(this.at(n), place);
				const distance = length3(toward[0], toward[1], toward[2]);
				if (distance < 1e-6) continue;
				const angle = angleBetween(this.arriving(n), normalize3(toward));
				const cost = distance * (1 + (ANGLE_COST * Math.max(0, angle - mostAngle)) / mostAngle);
				// A node along a curve carries one twig; the end of the lobe's own branch carries a
				// cluster of them. When every node is full, the best of them takes one more.
				if ((carried.get(n) ?? 0) >= (n === end ? END_TWIGS : 1)) {
					if (cost < fullCost) {
						fullCost = cost;
						full = n;
					}
				} else if (cost < bestCost) {
					bestCost = cost;
					best = n;
				}
			}
			const foot = best >= 0 ? best : full >= 0 ? full : end;
			carried.set(foot, (carried.get(foot) ?? 0) + 1);
			const start = this.at(foot);
			const distance = length3(place[0] - start[0], place[1] - start[1], place[2] - start[2]);
			const toward = normalize3(span(start, place));
			const leave = turnedToward(this.arriving(foot), toward, mostAngle);
			// It arrives between its own line and the socket's, so a short twig needs no tight bend.
			const arrive = turnedToward(
				toward,
				normalize3([
					toward[0] + socket.direction[0] * 0.5,
					toward[1] + socket.direction[1] * 0.5,
					toward[2] + socket.direction[2] * 0.5,
				]),
				ARRIVE_MOST,
			);
			const level = (depth.get(foot) ?? 0) + 1;
			const nodes = this.lay(
				laidCurve(
					curveFrom(start, leave, place, arrive, distance, BRANCH_ARMS),
					step,
					step * BRANCH_LEAD,
					this.mostTurn,
				),
				foot,
				this.curves++,
				limb,
				ORDER_BRANCH + level,
			);
			// A twig's own nodes carry the next order of twigs, but never its end: the end is its
			// socket, and a socket ends its branch.
			if (level < TWIG_DEPTH)
				for (let j = 0; j + 1 < nodes.length; j++) {
					open.push(nodes[j] as number);
					depth.set(nodes[j] as number, level);
				}
			wood.socket[nodes[nodes.length - 1] as number] = s;
		}
	}
}

/**
 * Grows one plant's skeleton and its sockets.
 *
 * @param input The record, the seed, the variant and the season.
 * @returns The skeleton.
 */
export function growScaffold(input: GrowInput): MacroSkeleton {
	const { record, variant } = input;
	const seed = input.seed >>> 0;
	const salt = record.seedSalt >>> 0;
	const g = growthOf(record);
	if (!record.envelope)
		throw new Error(`@null3d/vegetation: ${record.id} needs an envelope to grow`);
	const unit = (purpose: number, a = 0, b = 0) =>
		unitAt(seed, salt, variant, purpose * 4096 + a, b);
	// Every plant is laid out at the species' mean height and scaled to its own at the end, so a
	// shorter plant is the same plant, smaller: its lobes, its sockets and its stem keep their
	// proportions, and the stem's width is the record's at the mean height.
	const height = spreadMean(record.size.height);
	const own = targetHeight(record, seed, variant) / Math.max(1e-6, height);
	// The envelope keeps the azimuths it was measured at, so a view at a turn compares with the
	// reference's own view at that turn; a scene turns each copy it places.
	const volume = envelopeVolume(record.envelope, height, 0);
	const laying = new Laying(g, placeLobes(g, volume, height, unit), unit);
	const starts = stemStarts(g.stems, seed, salt, variant);
	const limbs = laying.layStems(starts, height);
	laying.shareLobes(limbs);
	const stemRadius = Math.max(0, (record.size.dbh ?? 0) / 2);
	limbs.forEach((limb, i) => {
		laying.layLimb(limb, i, stemRadius);
	});
	laying.lobes.forEach((lobe, k) => {
		laying.layTwigs(lobe, k);
	});
	const laid = skeletonOf(
		laying.wood,
		laying.sockets,
		laying.lobes,
		g,
		record,
		laying.mostTurn,
		starts.length,
	);
	const scaled = scaledSkeleton(laid, own);
	const sized = scaled.buds.sockets;
	return sized
		? {
				...scaled,
				buds: {
					...scaled.buds,
					sockets: { ...sized, scale: sized.scale.map((value) => value * own) },
				},
			}
		: scaled;
}

/**
 * The laid wood as a macro skeleton: the wood that leads to a socket, in axes that run on through
 * each node's straightest child, with pipe radii and a bud site at every socket.
 */
function skeletonOf(
	wood: Wood,
	sockets: readonly Socket[],
	lobes: readonly Lobe[],
	g: Scaffold,
	record: Species,
	mostTurn: number,
	stems: number,
): MacroSkeleton {
	const count = wood.x.length;
	// The sockets each node feeds: wood that feeds none is cut away, so no branch ends bare.
	const feeds = new Float64Array(count);
	for (let n = count - 1; n >= 0; n--) {
		if ((wood.socket[n] as number) >= 0) feeds[n] = (feeds[n] as number) + 1;
		const p = wood.parent[n] as number;
		if (p >= 0) feeds[p] = (feeds[p] as number) + (feeds[n] as number);
	}
	const children: number[][] = Array.from({ length: count }, () => []);
	for (let n = 0; n < count; n++) {
		const p = wood.parent[n] as number;
		if (p >= 0 && (feeds[n] as number) > 0) children[p]?.push(n);
	}
	const heading = (from: number, to: number): Vector3 =>
		normalize3([
			(wood.x[to] as number) - (wood.x[from] as number),
			(wood.y[to] as number) - (wood.y[from] as number),
			(wood.z[to] as number) - (wood.z[from] as number),
		]);
	/**
	 * The child an axis runs on through at a node: the next node of its own curve, or else the child
	 * that feeds the most sockets among those that turn no more than the species' most. A stem runs
	 * on only through its own curve, so a limb never takes its place.
	 */
	const runsOn = (n: number): number => {
		const kids = children[n] as number[];
		const curve = wood.curve[n] as number;
		if (curve >= 0) for (const kid of kids) if ((wood.curve[kid] as number) === curve) return kid;
		const p = wood.parent[n] as number;
		if (p < 0 || (curve >= 0 && curve < stems)) return -1;
		const line = heading(p, n);
		let best = -1;
		let most = 0;
		for (const kid of kids) {
			if (angleBetween(line, heading(n, kid)) > mostTurn) continue;
			if ((feeds[kid] as number) > most) {
				most = feeds[kid] as number;
				best = kid;
			}
		}
		return best;
	};

	// Axes in the order the skeleton holds them: a parent axis before the axes that leave it.
	const order: number[] = [];
	const axisStart: { readonly first: number; readonly parentNode: number }[] = [];
	for (let n = 0; n < count; n++)
		if ((wood.parent[n] as number) < 0 && ((feeds[n] as number) > 0 || count === 1))
			axisStart.push({ first: n, parentNode: -1 });
	const nodeOut = new Int32Array(count).fill(-1);
	const axisOfNode = new Int32Array(count).fill(-1);
	const chains: number[][] = [];
	for (let a = 0; a < axisStart.length; a++) {
		const start = axisStart[a] as (typeof axisStart)[number];
		const chain: number[] = [];
		for (let n = start.first; n >= 0; ) {
			chain.push(n);
			nodeOut[n] = order.length;
			axisOfNode[n] = a;
			order.push(n);
			const on = runsOn(n);
			for (const kid of children[n] as number[])
				if (kid !== on) axisStart.push({ first: kid, parentNode: n });
			n = on;
		}
		chains.push(chain);
	}

	// Pipe radii from the sockets down, fitted to the stem's width at breast height.
	const kept = order.length;
	const parent = new Int32Array(kept);
	const live = new Uint8Array(kept).fill(1);
	const pipes = new Float64Array(kept);
	order.forEach((n, i) => {
		const p = wood.parent[n] as number;
		parent[i] = p >= 0 ? (nodeOut[p] as number) : -1;
		if ((wood.socket[n] as number) >= 0) pipes[i] = 1;
	});
	const radius = new Float64Array(kept);
	const tip = Math.max(1e-4, g.pipe.tipRadius);
	pipeRadii(kept, parent, live, pipes, g.pipe.exponent, tip, radius);
	let measured = 0;
	for (let a = 0; a < axisStart.length; a++) {
		if ((axisStart[a] as (typeof axisStart)[number]).parentNode >= 0) continue;
		const chain = chains[a] as number[];
		// The stem's radius at breast height: its last node at or below it.
		let at = chain[0] as number;
		for (const n of chain) if ((wood.y[n] as number) <= BREAST_HEIGHT) at = n;
		measured = Math.max(measured, radius[nodeOut[at] as number] as number);
	}
	if (record.size.dbh !== undefined) fitRadii(radius, kept, tip, measured, record.size.dbh / 2);
	// A parent comes before its children, so one pass carries each floor and cap up the wood.
	for (let i = 0; i < kept; i++) {
		const p = parent[i] as number;
		if (p < 0) continue;
		const same = axisOfNode[order[i] as number] === axisOfNode[order[p] as number];
		radius[i] = same
			? Math.max(radius[i] as number, TAPER_FLOOR * (radius[p] as number))
			: Math.min(radius[i] as number, SIDE_CAP * (radius[p] as number));
	}

	const builder = new SkeletonBuilder();
	const along = new Float64Array(kept);
	const barkBase = new Float64Array(axisStart.length);
	const side: Vector3 = [0, 0, 0];
	const fore: Vector3 = [0, 0, 0];
	for (let a = 0; a < axisStart.length; a++) {
		const start = axisStart[a] as (typeof axisStart)[number];
		const from = start.parentNode;
		let barkV = 0;
		let barkU = 0;
		if (from >= 0) {
			barkV =
				(barkBase[axisOfNode[from] as number] as number) +
				(along[nodeOut[from] as number] as number);
			// The side of its parent the axis leaves on, as an angle about the parent's own line.
			const up = wood.parent[from] as number;
			const line: Vector3 = up >= 0 ? heading(up, from) : [0, 1, 0];
			cross3(line, Math.abs(line[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], side);
			normalize3(side);
			cross3(line, side, fore);
			const out = heading(from, start.first);
			barkU = atan2(
				out[0] * fore[0] + out[1] * fore[1] + out[2] * fore[2],
				out[0] * side[0] + out[1] * side[1] + out[2] * side[2],
			);
		}
		barkBase[a] = barkV;
		const axis = builder.addAxis({
			parent: from >= 0 ? (axisOfNode[from] as number) : -1,
			parentNode: from >= 0 ? (nodeOut[from] as number) : -1,
			parentT: 0,
			order: wood.order[start.first] as number,
			kind: from >= 0 ? AXIS_LIMB : AXIS_STEM,
			barkV,
			barkU,
		});
		for (const n of chains[a] as number[]) {
			const p = wood.parent[n] as number;
			const i = nodeOut[n] as number;
			if (p >= 0 && axisOfNode[p] === a)
				along[i] =
					(along[nodeOut[p] as number] as number) +
					length3(
						(wood.x[n] as number) - (wood.x[p] as number),
						(wood.y[n] as number) - (wood.y[p] as number),
						(wood.z[n] as number) - (wood.z[p] as number),
					);
			builder.addNode({
				x: wood.x[n] as number,
				y: wood.y[n] as number,
				z: wood.z[n] as number,
				radius: radius[i] as number,
				parent: p >= 0 ? (nodeOut[p] as number) : -1,
				axis,
			});
		}
	}

	// A socket's rank for thinning: the sockets in the order of a space-filling curve through the
	// crown, numbered so that the sockets below any rank stand spread along that curve.
	const tips: number[] = [];
	for (const n of order) if ((wood.socket[n] as number) >= 0) tips.push(n);
	const rank = thinningRanks(
		tips.map((n) => [wood.x[n] as number, wood.y[n] as number, wood.z[n] as number]),
	);
	const sizes = lobes.map((lobe) => lobe.r).sort((a, b) => a - b);
	const typical = sizes[sizes.length >> 1] ?? 1;
	const frame = [0, 0, 0, 1];
	let lowest = Number.POSITIVE_INFINITY;
	tips.forEach((n, t) => {
		const socket = sockets[wood.socket[n] as number] as Socket;
		const lobe = lobes[socket.lobe] as Lobe;
		quatFromFrame(socket.direction, [0, 1, 0], frame);
		const i = nodeOut[n] as number;
		lowest = Math.min(lowest, socket.y);
		builder.addBud({
			node: i,
			x: socket.x,
			y: socket.y,
			z: socket.z,
			frame,
			kind: BUD_TERMINAL,
			vigor: 1,
			light: 1,
			axis: axisOfNode[n] as number,
			woodRadius: radius[i] as number,
			socket: {
				scale: Math.min(1.25, Math.max(0.8, lobe.r / typical)),
				rank: rank[t] as number,
				lobe: socket.lobe,
			},
		});
	});
	const hang = Math.max(0, g.sockets.inset) * CROWN_HANG;
	return builder.finish(Number.isFinite(lowest) ? Math.max(0, lowest - hang) : undefined);
}

/** The scaffold grower. */
export const grower: Grower = {
	grow: growScaffold,
};
