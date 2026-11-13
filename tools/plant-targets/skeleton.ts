// The wood of a cut branch as a graph: its outline thinned to lines one pixel wide, the lines'
// free ends and the joints where they meet, and the four figures the review judges a cut branch's
// density by. They are the wood for each tip, the tips for each area, the share of joints that
// are fans, and the kinks along the wood. A drawn shape with a known answer checks each.
//
// The figures read a flat picture. Two twigs that cross in the picture read as one joint of four
// lines, and wood behind a leaf is not seen, so a figure is a count of what shows.
import { rounded } from './shape.ts';

/** A joint is a fan when this many lines or more meet at it: the parent and four twigs. */
const FAN_LINES = 5;
/** The least turn, in degrees, between two straight stretches of a line that counts as a kink. */
const KINK_DEGREES = 20;
/**
 * The share of the piece's length under which a free end is a spur of the thinning, not a twig,
 * and a stretch between two corners is one corner.
 */
const SPUR_SHARE = 0.02;
/** The share of the piece's length within which two joints are one joint. */
const JOINT_SHARE = 0.015;
/** The wood thicknesses within which two corners of a line are one corner. */
const THICKNESSES = 2;
/** The share of the piece's length a line may bow from a straight stretch before it is two. */
const STRAIGHT_SHARE = 0.006;

/** The eight neighbours of a pixel, in order round it from the one above. */
const ROUND = [
	[0, -1],
	[1, -1],
	[1, 0],
	[1, 1],
	[0, 1],
	[-1, 1],
	[-1, 0],
	[-1, -1],
] as const;

/**
 * A mask thinned to lines one pixel wide that keep its joins, by Zhang and Suen's two-pass rule: a
 * pass takes each edge pixel that has two to six neighbours, one run of neighbours round it, and a
 * clear neighbour on the sides the pass names; passes repeat until none takes a pixel. The corner
 * pixels of a stepped diagonal go last, so a line that runs at a slant is one pixel wide too.
 */
export function thin(mask: Uint8Array, width: number, height: number): Uint8Array {
	const out = mask.slice();
	const at = (x: number, y: number): number =>
		x < 0 || y < 0 || x >= width || y >= height ? 0 : (out[y * width + x] as number);
	let live: number[] = [];
	for (let index = 0; index < out.length; index++) if (out[index]) live.push(index);
	const taken: number[] = [];
	const near = new Uint8Array(8);
	let changed = true;
	while (changed) {
		changed = false;
		for (let pass = 0; pass < 2; pass++) {
			taken.length = 0;
			for (const index of live) {
				const x = index % width;
				const y = (index - x) / width;
				let count = 0;
				let runs = 0;
				let before = at(x - 1, y - 1);
				for (let k = 0; k < 8; k++) {
					const step = ROUND[k] as readonly [number, number];
					const v = at(x + step[0], y + step[1]);
					near[k] = v;
					count += v;
					if (!before && v) runs++;
					before = v;
				}
				if (count < 2 || count > 6 || runs !== 1) continue;
				const up = near[0] as number;
				const right = near[2] as number;
				const down = near[4] as number;
				const left = near[6] as number;
				const clear =
					pass === 0
						? up * right * down === 0 && right * down * left === 0
						: up * right * left === 0 && up * down * left === 0;
				if (clear) taken.push(index);
			}
			if (taken.length === 0) continue;
			for (const index of taken) out[index] = 0;
			live = live.filter((index) => out[index] !== 0);
			changed = true;
		}
	}
	// A corner pixel joins two neighbours that already touch at their corners, so it adds a step
	// and a false joint. It goes where the far side of the corner is clear.
	for (const index of live) {
		const x = index % width;
		const y = (index - x) / width;
		const up = at(x, y - 1);
		const right = at(x + 1, y);
		const down = at(x, y + 1);
		const left = at(x - 1, y);
		const corner =
			(up && left && !right && !down && !at(x + 1, y + 1)) ||
			(up && right && !left && !down && !at(x - 1, y + 1)) ||
			(down && left && !right && !up && !at(x + 1, y - 1)) ||
			(down && right && !left && !up && !at(x - 1, y - 1));
		if (corner) out[index] = 0;
	}
	return out;
}

/** One line of the wood between two of its nodes. */
interface Line {
	a: number;
	b: number;
	/** The line's pixels in order, as x then y pairs. */
	points: number[];
	length: number;
}

/** The wood's lines and nodes: a node is a free end or a joint. */
export interface WoodGraph {
	/** Each node's place and the lines that meet at it. */
	readonly nodes: readonly { readonly x: number; readonly y: number; readonly lines: number }[];
	readonly lines: readonly {
		readonly a: number;
		readonly b: number;
		readonly points: readonly number[];
		readonly length: number;
	}[];
}

/** The length of a run of points, as x then y pairs. */
function lengthOf(points: readonly number[]): number {
	let total = 0;
	for (let k = 2; k < points.length; k += 2)
		total += Math.hypot(
			(points[k] as number) - (points[k - 2] as number),
			(points[k + 1] as number) - (points[k - 1] as number),
		);
	return total;
}

/**
 * The graph of a thinned mask. A pixel with one neighbour is a free end, and pixels with three or
 * more that touch each other are one joint. Free ends shorter than `spur` are dropped, joints
 * within `joint` of each other are one joint, and a node left with two lines is no node, so its
 * lines become one.
 *
 * @param lines The thinned mask.
 * @param width The mask's width.
 * @param height The mask's height.
 * @param spur The length under which a free end is dropped, in pixels.
 * @param joint The distance within which two joints are one, in pixels.
 */
export function graphOf(
	lines: Uint8Array,
	width: number,
	height: number,
	spur: number,
	joint: number,
): WoodGraph {
	const on = (x: number, y: number): boolean =>
		x >= 0 && y >= 0 && x < width && y < height && lines[y * width + x] !== 0;
	const neighbours = (x: number, y: number): number => {
		let count = 0;
		for (const [dx, dy] of ROUND) if (on(x + dx, y + dy)) count++;
		return count;
	};
	// Each pixel's node: 0 for none, otherwise the node's number plus one.
	const nodeOf = new Int32Array(width * height);
	const nodes: { x: number; y: number; pixels: number }[] = [];
	const stack: number[] = [];
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			if (!lines[y * width + x] || nodeOf[y * width + x]) continue;
			const count = neighbours(x, y);
			if (count === 2 || count === 0) continue;
			const id = nodes.length + 1;
			const node = { x: 0, y: 0, pixels: 0 };
			nodes.push(node);
			nodeOf[y * width + x] = id;
			stack.push(y * width + x);
			while (stack.length > 0) {
				const index = stack.pop() as number;
				const px = index % width;
				const py = (index - px) / width;
				node.x += px;
				node.y += py;
				node.pixels++;
				// Only joint pixels gather their neighbours: a free end stands alone.
				if (neighbours(px, py) < 3) continue;
				for (const [dx, dy] of ROUND) {
					const nx = px + dx;
					const ny = py + dy;
					if (!on(nx, ny) || nodeOf[ny * width + nx] || neighbours(nx, ny) < 3) continue;
					nodeOf[ny * width + nx] = id;
					stack.push(ny * width + nx);
				}
			}
			node.x /= node.pixels;
			node.y /= node.pixels;
		}
	const found: Line[] = [];
	const walked = new Uint8Array(width * height);
	const joined = new Set<number>();
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const from = nodeOf[y * width + x] as number;
			if (!from) continue;
			for (const [dx, dy] of ROUND) {
				let cx = x + dx;
				let cy = y + dy;
				if (!on(cx, cy)) continue;
				const other = nodeOf[cy * width + cx] as number;
				if (other) {
					// Two nodes that touch are joined by a line of one step.
					if (
						other !== from &&
						!joined.has(Math.min(from, other) * nodes.length * 2 + Math.max(from, other))
					) {
						joined.add(Math.min(from, other) * nodes.length * 2 + Math.max(from, other));
						const points = [x, y, cx, cy];
						found.push({ a: from - 1, b: other - 1, points, length: lengthOf(points) });
					}
					continue;
				}
				if (walked[cy * width + cx]) continue;
				const points = [x, y];
				let px = x;
				let py = y;
				let end = 0;
				while (true) {
					walked[cy * width + cx] = 1;
					points.push(cx, cy);
					let nextX = -1;
					let nextY = -1;
					for (const [ex, ey] of ROUND) {
						const nx = cx + ex;
						const ny = cy + ey;
						if (!on(nx, ny) || (nx === px && ny === py)) continue;
						const node = nodeOf[ny * width + nx] as number;
						if (node) {
							// The node the walk left is its end only once the walk has moved on from it.
							if (node === from && points.length <= 4) continue;
							end = node;
							nextX = nx;
							nextY = ny;
							break;
						}
						if (!walked[ny * width + nx]) {
							nextX = nx;
							nextY = ny;
						}
					}
					if (end || nextX < 0) {
						if (end) points.push(nextX, nextY);
						break;
					}
					px = cx;
					py = cy;
					cx = nextX;
					cy = nextY;
				}
				if (end && end !== from)
					found.push({ a: from - 1, b: end - 1, points, length: lengthOf(points) });
			}
		}
	// Joints within the joint distance of each other become one joint.
	const parent = nodes.map((_, i) => i);
	const root = (i: number): number => {
		let r = i;
		while (parent[r] !== r) r = parent[r] as number;
		parent[i] = r;
		return r;
	};
	const degree = (list: readonly Line[]): number[] => {
		const count = new Array<number>(nodes.length).fill(0);
		for (const line of list) {
			count[root(line.a)] = (count[root(line.a)] as number) + 1;
			count[root(line.b)] = (count[root(line.b)] as number) + 1;
		}
		return count;
	};
	let kept = found;
	const first = degree(kept);
	for (const line of kept)
		if (
			line.length <= joint &&
			(first[root(line.a)] as number) >= 3 &&
			(first[root(line.b)] as number) >= 3
		)
			parent[root(line.a)] = root(line.b);
	kept = kept.filter((line) => root(line.a) !== root(line.b));
	// A free end shorter than a spur goes, and a node left with two lines joins them into one,
	// until no free end is shorter than a spur. A line free at both ends is a twig of its own.
	kept = joinThrough(kept, root);
	while (true) {
		const count = degree(kept);
		const next = kept.filter((line) => {
			const freeA = count[root(line.a)] === 1;
			const freeB = count[root(line.b)] === 1;
			return !(freeA !== freeB && line.length < spur);
		});
		if (next.length === kept.length) break;
		kept = joinThrough(next, root);
	}
	const count = degree(kept);
	const index = new Map<number, number>();
	const outNodes: { x: number; y: number; lines: number }[] = [];
	const nodeIndex = (i: number): number => {
		const r = root(i);
		let known = index.get(r);
		if (known === undefined) {
			known = outNodes.length;
			index.set(r, known);
			const node = nodes[r] as { x: number; y: number };
			outNodes.push({ x: node.x, y: node.y, lines: count[r] as number });
		}
		return known;
	};
	return {
		lines: kept.map((line) => ({
			a: nodeIndex(line.a),
			b: nodeIndex(line.b),
			points: line.points,
			length: line.length,
		})),
		nodes: outNodes,
	};
}

/** Joins the two lines of every node that holds exactly two, so the node is a point on one line. */
function joinThrough(lines: readonly Line[], root: (i: number) => number): Line[] {
	const out: Line[] = lines.map((line) => ({ ...line, a: root(line.a), b: root(line.b) }));
	const live = new Array<boolean>(out.length).fill(true);
	const meeting = new Map<number, number[]>();
	const meet = (node: number, line: number): void => {
		const list = meeting.get(node);
		if (list) list.push(line);
		else meeting.set(node, [line]);
	};
	out.forEach((line, k) => {
		meet(line.a, k);
		meet(line.b, k);
	});
	for (const [node, list] of meeting) {
		const i = list[0] as number;
		const j = list[1] as number;
		// A ring that closes on the node holds it twice in one line, and stays.
		if (list.length !== 2 || i === j) continue;
		const p = out[i] as Line;
		const q = out[j] as Line;
		const pEnds = p.b === node;
		const qStarts = q.a === node;
		const end = qStarts ? q.b : q.a;
		out[i] = {
			a: pEnds ? p.a : p.b,
			b: end,
			points: (pEnds ? p.points : reversed(p.points)).concat(
				qStarts ? q.points : reversed(q.points),
			),
			length: p.length + q.length,
		};
		live[j] = false;
		const far = meeting.get(end) as number[];
		far[far.indexOf(j)] = i;
		list.length = 0;
	}
	return out.filter((_, k) => live[k]);
}

/** A run of points, as x then y pairs, end to start. */
function reversed(points: readonly number[]): number[] {
	const out: number[] = [];
	for (let k = points.length - 2; k >= 0; k -= 2)
		out.push(points[k] as number, points[k + 1] as number);
	return out;
}

/**
 * The turns of a line, in degrees, at its corners. The line is first reduced to straight stretches
 * that it leaves by no more than `bow` pixels (Ramer, Douglas and Peucker's rule). A stretch
 * shorter than `short` pixels is then no stretch of its own: the two corners at its ends are one
 * corner at its middle, and a short stretch at the line's end is a hook of the thinning and goes.
 */
export function turnsOf(points: readonly number[], bow: number, short = 0): number[] {
	const n = points.length / 2;
	if (n < 3) return [];
	const keep = new Uint8Array(n);
	keep[0] = 1;
	keep[n - 1] = 1;
	const spans: [number, number][] = [[0, n - 1]];
	while (spans.length > 0) {
		const [from, to] = spans.pop() as [number, number];
		const ax = points[from * 2] as number;
		const ay = points[from * 2 + 1] as number;
		const bx = points[to * 2] as number;
		const by = points[to * 2 + 1] as number;
		const span = Math.hypot(bx - ax, by - ay);
		let far = -1;
		let most = bow;
		for (let k = from + 1; k < to; k++) {
			const px = points[k * 2] as number;
			const py = points[k * 2 + 1] as number;
			const off =
				span === 0
					? Math.hypot(px - ax, py - ay)
					: Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / span;
			if (off > most) {
				most = off;
				far = k;
			}
		}
		if (far >= 0) {
			keep[far] = 1;
			spans.push([from, far], [far, to]);
		}
	}
	const corners: [number, number][] = [];
	for (let k = 0; k < n; k++)
		if (keep[k]) corners.push([points[k * 2] as number, points[k * 2 + 1] as number]);
	const stretch = (k: number): number => {
		const a = corners[k] as [number, number];
		const b = corners[k + 1] as [number, number];
		return Math.hypot(b[0] - a[0], b[1] - a[1]);
	};
	while (corners.length > 2) {
		let least = 0;
		for (let k = 1; k + 1 < corners.length; k++) if (stretch(k) < stretch(least)) least = k;
		if (stretch(least) >= short) break;
		if (least === 0) corners.splice(1, 1);
		else if (least === corners.length - 2) corners.splice(least, 1);
		else {
			const a = corners[least] as [number, number];
			const b = corners[least + 1] as [number, number];
			corners.splice(least, 2, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
		}
	}
	const turns: number[] = [];
	for (let c = 1; c + 1 < corners.length; c++) {
		const a = corners[c - 1] as [number, number];
		const b = corners[c] as [number, number];
		const d = corners[c + 1] as [number, number];
		const ux = b[0] - a[0];
		const uy = b[1] - a[1];
		const vx = d[0] - b[0];
		const vy = d[1] - b[1];
		const cos = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1);
		turns.push((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI);
	}
	return turns;
}

/** The four figures of a cut branch's wood, with what they were read from. */
export interface BranchFigures {
	/** The free ends of the wood, less the one end that is the cut. */
	readonly tips: number;
	/** The joints where three or more lines meet. */
	readonly joints: number;
	/** The wood's length for each tip, in piece lengths. */
	readonly woodPerTip: number;
	/** The tips for each square piece length of the piece's box. */
	readonly tipsPerArea: number;
	/** The share of the joints where the parent and four or more twigs meet. Null without a joint. */
	readonly fanShare: number | null;
	/** The kinks for each piece length of wood. */
	readonly kinksPerLength: number;
	/** The mean turn of the kinks, in degrees. Null without a kink. */
	readonly meanKink: number | null;
	/** The wood's whole length, in piece lengths. */
	readonly woodLength: number;
}

/**
 * Reads the four cut-branch figures from a mask of wood.
 *
 * @param wood The wood's mask.
 * @param width The mask's width.
 * @param height The mask's height.
 * @param piece The piece's length in pixels: the longer side of its box.
 * @param area The area of the piece's box in pixels.
 * @returns The figures, or null when the wood leaves no line with a free end.
 */
export function branchFigures(
	wood: Uint8Array,
	width: number,
	height: number,
	piece: number,
	area: number,
): BranchFigures | null {
	const graph = graphOf(
		thin(wood, width, height),
		width,
		height,
		Math.max(3, piece * SPUR_SHARE),
		Math.max(2, piece * JOINT_SHARE),
	);
	const ends = graph.nodes.filter((node) => node.lines === 1).length;
	if (graph.lines.length === 0 || ends === 0) return null;
	const tips = Math.max(1, ends - 1);
	const joints = graph.nodes.filter((node) => node.lines >= 3);
	const fans = joints.filter((node) => node.lines >= FAN_LINES).length;
	let length = 0;
	for (const line of graph.lines) length += line.length;
	// The wood's mean thickness is its area over its length. Thinning cuts a corner of a thick
	// twig by about that much, so two corners nearer than twice the thickness are one.
	let pixels = 0;
	for (let at = 0; at < wood.length; at++) pixels += wood[at] as number;
	const short = Math.max(3, piece * SPUR_SHARE, (THICKNESSES * pixels) / length);
	const kinks: number[] = [];
	for (const line of graph.lines)
		for (const turn of turnsOf(line.points, Math.max(1.5, piece * STRAIGHT_SHARE), short))
			if (turn >= KINK_DEGREES) kinks.push(turn);
	return {
		tips,
		joints: joints.length,
		woodPerTip: rounded(length / tips / piece),
		tipsPerArea: rounded((tips * piece * piece) / area, 3),
		fanShare: joints.length > 0 ? rounded(fans / joints.length) : null,
		kinksPerLength: rounded((kinks.length * piece) / length, 3),
		meanKink: kinks.length > 0 ? rounded(kinks.reduce((a, b) => a + b, 0) / kinks.length, 1) : null,
		woodLength: rounded(length / piece),
	};
}
