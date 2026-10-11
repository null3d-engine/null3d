// Polygon triangulation by ear clipping, ported from earcut 3.0.2 (mapbox/earcut, ISC licence),
// the copy that three.js 0.186.1 ships. It cuts a polygon with holes into triangles and returns
// three vertex indices per triangle. The steps and their order follow earcut exactly, so the
// triangles match three.js's.

class Node {
	// The vertex index in the input, and its coordinates.
	i: number;
	x: number;
	y: number;
	// The previous and next vertices of the polygon ring.
	prev: Node = this;
	next: Node = this;
	// The z-order curve value, and the previous and next nodes in z-order.
	z = 0;
	prevZ: Node | null = null;
	nextZ: Node | null = null;
	// True for a hole of one point.
	steiner = false;

	constructor(i: number, x: number, y: number) {
		this.i = i;
		this.x = x;
		this.y = y;
	}
}

/**
 * Triangulates a polygon. `data` holds the flat coordinates of the outline, then of each hole.
 * `holeIndices` gives the vertex at which each hole starts.
 */
export function earcut(data: readonly number[], holeIndices: readonly number[], dim = 2): number[] {
	const hasHoles = holeIndices.length > 0;
	const outerLen = hasHoles ? (holeIndices[0] as number) * dim : data.length;
	let outerNode = linkedList(data, 0, outerLen, dim, true);
	const triangles: number[] = [];
	if (!outerNode || outerNode.next === outerNode.prev) return triangles;
	let minX = 0;
	let minY = 0;
	let invSize = 0;
	if (hasHoles) outerNode = eliminateHoles(data, holeIndices, outerNode, dim);
	// A complex shape uses a z-order curve hash, which needs the polygon's bounding box.
	if (data.length > 80 * dim) {
		minX = data[0] as number;
		minY = data[1] as number;
		let maxX = minX;
		let maxY = minY;
		for (let i = dim; i < outerLen; i += dim) {
			const x = data[i] as number;
			const y = data[i + 1] as number;
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
		}
		invSize = Math.max(maxX - minX, maxY - minY);
		invSize = invSize !== 0 ? 32767 / invSize : 0;
	}
	earcutLinked(outerNode, triangles, dim, minX, minY, invSize, 0);
	return triangles;
}

// A circular doubly linked list of the polygon's points, in the given winding order.
function linkedList(
	data: readonly number[],
	start: number,
	end: number,
	dim: number,
	clockwise: boolean,
): Node | undefined {
	let last: Node | undefined;
	if (clockwise === signedArea(data, start, end, dim) > 0) {
		for (let i = start; i < end; i += dim) {
			last = insertNode((i / dim) | 0, data[i] as number, data[i + 1] as number, last);
		}
	} else {
		for (let i = end - dim; i >= start; i -= dim) {
			last = insertNode((i / dim) | 0, data[i] as number, data[i + 1] as number, last);
		}
	}
	if (last && equals(last, last.next)) {
		removeNode(last);
		last = last.next;
	}
	return last;
}

// Removes collinear and duplicate points.
function filterPoints(start: Node, end?: Node): Node {
	let stop = end ?? start;
	let p = start;
	let again: boolean;
	do {
		again = false;
		if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
			removeNode(p);
			p = stop = p.prev;
			if (p === p.next) break;
			again = true;
		} else {
			p = p.next;
		}
	} while (again || p !== stop);
	return stop;
}

// The main ear slicing loop.
function earcutLinked(
	start: Node,
	triangles: number[],
	dim: number,
	minX: number,
	minY: number,
	invSize: number,
	pass: number,
): void {
	let ear = start;
	if (!pass && invSize) indexCurve(ear, minX, minY, invSize);
	let stop = ear;
	while (ear.prev !== ear.next) {
		const prev = ear.prev;
		const next = ear.next;
		if (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
			triangles.push(prev.i, ear.i, next.i);
			removeNode(ear);
			// Skipping the next vertex leaves fewer sliver triangles.
			ear = next.next;
			stop = next.next;
			continue;
		}
		ear = next;
		// After a full loop with no ear, filter points, then cure small self-intersections, then
		// split the polygon in two.
		if (ear === stop) {
			if (!pass) {
				earcutLinked(filterPoints(ear), triangles, dim, minX, minY, invSize, 1);
			} else if (pass === 1) {
				ear = cureLocalIntersections(filterPoints(ear), triangles);
				earcutLinked(ear, triangles, dim, minX, minY, invSize, 2);
			} else if (pass === 2) {
				splitEarcut(ear, triangles, dim, minX, minY, invSize);
			}
			break;
		}
	}
}

// True when a node and its neighbors form an ear with no other point inside.
function isEar(ear: Node): boolean {
	const a = ear.prev;
	const b = ear;
	const c = ear.next;
	if (area(a, b, c) >= 0) return false;
	const ax = a.x;
	const bx = b.x;
	const cx = c.x;
	const ay = a.y;
	const by = b.y;
	const cy = c.y;
	const x0 = Math.min(ax, bx, cx);
	const y0 = Math.min(ay, by, cy);
	const x1 = Math.max(ax, bx, cx);
	const y1 = Math.max(ay, by, cy);
	let p = c.next;
	while (p !== a) {
		if (
			p.x >= x0 &&
			p.x <= x1 &&
			p.y >= y0 &&
			p.y <= y1 &&
			pointInTriangleExceptFirst(ax, ay, bx, by, cx, cy, p.x, p.y) &&
			area(p.prev, p, p.next) >= 0
		) {
			return false;
		}
		p = p.next;
	}
	return true;
}

// True when a point lies in the triangle a, b, c, is not a or c, and is a reflex vertex.
function blocksEar(
	p: Node,
	a: Node,
	b: Node,
	c: Node,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
) {
	return (
		p.x >= x0 &&
		p.x <= x1 &&
		p.y >= y0 &&
		p.y <= y1 &&
		p !== a &&
		p !== c &&
		pointInTriangleExceptFirst(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
		area(p.prev, p, p.next) >= 0
	);
}

// isEar for large polygons: it looks only at points whose z-order lies in the ear's box.
function isEarHashed(ear: Node, minX: number, minY: number, invSize: number): boolean {
	const a = ear.prev;
	const b = ear;
	const c = ear.next;
	if (area(a, b, c) >= 0) return false;
	const x0 = Math.min(a.x, b.x, c.x);
	const y0 = Math.min(a.y, b.y, c.y);
	const x1 = Math.max(a.x, b.x, c.x);
	const y1 = Math.max(a.y, b.y, c.y);
	const minZ = zOrder(x0, y0, minX, minY, invSize);
	const maxZ = zOrder(x1, y1, minX, minY, invSize);
	let p = ear.prevZ;
	let n = ear.nextZ;
	while (p && p.z >= minZ && n && n.z <= maxZ) {
		if (blocksEar(p, a, b, c, x0, y0, x1, y1)) return false;
		p = p.prevZ;
		if (blocksEar(n, a, b, c, x0, y0, x1, y1)) return false;
		n = n.nextZ;
	}
	while (p && p.z >= minZ) {
		if (blocksEar(p, a, b, c, x0, y0, x1, y1)) return false;
		p = p.prevZ;
	}
	while (n && n.z <= maxZ) {
		if (blocksEar(n, a, b, c, x0, y0, x1, y1)) return false;
		n = n.nextZ;
	}
	return true;
}

// Cures small local self-intersections.
function cureLocalIntersections(begin: Node, triangles: number[]): Node {
	let start = begin;
	let p = start;
	do {
		const a = p.prev;
		const b = p.next.next;
		if (
			!equals(a, b) &&
			intersects(a, p, p.next, b) &&
			locallyInside(a, b) &&
			locallyInside(b, a)
		) {
			triangles.push(a.i, p.i, b.i);
			removeNode(p);
			removeNode(p.next);
			p = start = b;
		}
		p = p.next;
	} while (p !== start);
	return filterPoints(p);
}

// Splits the polygon in two along a valid diagonal and triangulates each half.
function splitEarcut(
	start: Node,
	triangles: number[],
	dim: number,
	minX: number,
	minY: number,
	invSize: number,
): void {
	let a = start;
	do {
		let b = a.next.next;
		while (b !== a.prev) {
			if (a.i !== b.i && isValidDiagonal(a, b)) {
				let c = splitPolygon(a, b);
				a = filterPoints(a, a.next);
				c = filterPoints(c, c.next);
				earcutLinked(a, triangles, dim, minX, minY, invSize, 0);
				earcutLinked(c, triangles, dim, minX, minY, invSize, 0);
				return;
			}
			b = b.next;
		}
		a = a.next;
	} while (a !== start);
}

// Links every hole into the outer ring, which leaves one ring with no holes.
function eliminateHoles(
	data: readonly number[],
	holeIndices: readonly number[],
	outer: Node,
	dim: number,
): Node {
	let outerNode = outer;
	const queue: Node[] = [];
	for (let i = 0, len = holeIndices.length; i < len; i++) {
		const start = (holeIndices[i] as number) * dim;
		const end = i < len - 1 ? (holeIndices[i + 1] as number) * dim : data.length;
		const list = linkedList(data, start, end, dim, false) as Node;
		if (list === list.next) list.steiner = true;
		queue.push(getLeftmost(list));
	}
	queue.sort(compareXYSlope);
	for (const hole of queue) {
		outerNode = eliminateHole(hole, outerNode);
	}
	return outerNode;
}

// Sorts holes left to right. Holes whose leftmost points meet sort counterclockwise, so the bridge
// to the outer ring is the point where they meet.
function compareXYSlope(a: Node, b: Node): number {
	let result = a.x - b.x;
	if (result === 0) {
		result = a.y - b.y;
		if (result === 0) {
			const aSlope = (a.next.y - a.y) / (a.next.x - a.x);
			const bSlope = (b.next.y - b.y) / (b.next.x - b.x);
			result = aSlope - bSlope;
		}
	}
	return result;
}

// Finds a bridge from a hole to the outer ring and links them.
function eliminateHole(hole: Node, outerNode: Node): Node {
	const bridge = findHoleBridge(hole, outerNode);
	if (!bridge) return outerNode;
	const bridgeReverse = splitPolygon(bridge, hole);
	filterPoints(bridgeReverse, bridgeReverse.next);
	return filterPoints(bridge, bridge.next);
}

// David Eberly's method to find a bridge between a hole and the outer polygon.
function findHoleBridge(hole: Node, outerNode: Node): Node | null {
	let p = outerNode;
	const hx = hole.x;
	const hy = hole.y;
	let qx = Number.NEGATIVE_INFINITY;
	let m: Node | undefined;
	// A ray from the hole's leftmost point to the left meets a segment. The segment's end with the
	// smaller x may be the bridge, unless the ray meets a vertex.
	if (equals(hole, p)) return p;
	do {
		if (equals(hole, p.next)) return p.next;
		if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
			const x = p.x + ((hy - p.y) * (p.next.x - p.x)) / (p.next.y - p.y);
			if (x <= hx && x > qx) {
				qx = x;
				m = p.x < p.next.x ? p : p.next;
				if (x === hx) return m;
			}
		}
		p = p.next;
	} while (p !== outerNode);
	if (!m) return null;
	// A point inside the triangle of the hole point, the ray's hit and the end blocks the bridge.
	// Then the point at the smallest angle to the ray is the bridge.
	const stop = m;
	const mx = m.x;
	const my = m.y;
	let tanMin = Number.POSITIVE_INFINITY;
	p = m;
	do {
		if (
			hx >= p.x &&
			p.x >= mx &&
			hx !== p.x &&
			pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)
		) {
			const tan = Math.abs(hy - p.y) / (hx - p.x);
			if (
				locallyInside(p, hole) &&
				(tan < tanMin ||
					(tan === tanMin && (p.x > m.x || (p.x === m.x && sectorContainsSector(m, p)))))
			) {
				m = p;
				tanMin = tan;
			}
		}
		p = p.next;
	} while (p !== stop);
	return m;
}

// True when the sector at vertex m contains the sector at vertex p.
function sectorContainsSector(m: Node, p: Node): boolean {
	return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0;
}

// Links the polygon's nodes in z-order.
function indexCurve(start: Node, minX: number, minY: number, invSize: number): void {
	let p = start;
	do {
		if (p.z === 0) p.z = zOrder(p.x, p.y, minX, minY, invSize);
		p.prevZ = p.prev;
		p.nextZ = p.next;
		p = p.next;
	} while (p !== start);
	(p.prevZ as Node).nextZ = null;
	p.prevZ = null;
	sortLinked(p);
}

// Simon Tatham's merge sort of a linked list, by z-order.
function sortLinked(head: Node): Node | null {
	let list: Node | null = head;
	let numMerges: number;
	let inSize = 1;
	do {
		let p: Node | null = list;
		let e: Node;
		list = null;
		let tail: Node | null = null;
		numMerges = 0;
		while (p) {
			numMerges++;
			let q: Node | null = p;
			let pSize = 0;
			for (let i = 0; i < inSize; i++) {
				pSize++;
				q = (q as Node).nextZ;
				if (!q) break;
			}
			let qSize = inSize;
			while (pSize > 0 || (qSize > 0 && q)) {
				if (pSize !== 0 && (qSize === 0 || !q || (p as Node).z <= q.z)) {
					e = p as Node;
					p = e.nextZ;
					pSize--;
				} else {
					e = q as Node;
					q = e.nextZ;
					qSize--;
				}
				if (tail) tail.nextZ = e;
				else list = e;
				e.prevZ = tail;
				tail = e;
			}
			p = q;
		}
		(tail as Node).nextZ = null;
		inSize *= 2;
	} while (numMerges > 1);
	return list;
}

// The z-order of a point, from its coordinates mapped into 15-bit integers.
function zOrder(px: number, py: number, minX: number, minY: number, invSize: number): number {
	let x = ((px - minX) * invSize) | 0;
	let y = ((py - minY) * invSize) | 0;
	x = (x | (x << 8)) & 0x00ff00ff;
	x = (x | (x << 4)) & 0x0f0f0f0f;
	x = (x | (x << 2)) & 0x33333333;
	x = (x | (x << 1)) & 0x55555555;
	y = (y | (y << 8)) & 0x00ff00ff;
	y = (y | (y << 4)) & 0x0f0f0f0f;
	y = (y | (y << 2)) & 0x33333333;
	y = (y | (y << 1)) & 0x55555555;
	return x | (y << 1);
}

// The leftmost node of a ring, the lowest one on a tie.
function getLeftmost(start: Node): Node {
	let p = start;
	let leftmost = start;
	do {
		if (p.x < leftmost.x || (p.x === leftmost.x && p.y < leftmost.y)) leftmost = p;
		p = p.next;
	} while (p !== start);
	return leftmost;
}

// True when a point lies in a convex triangle.
function pointInTriangle(
	ax: number,
	ay: number,
	bx: number,
	by: number,
	cx: number,
	cy: number,
	px: number,
	py: number,
): boolean {
	return (
		(cx - px) * (ay - py) >= (ax - px) * (cy - py) &&
		(ax - px) * (by - py) >= (bx - px) * (ay - py) &&
		(bx - px) * (cy - py) >= (cx - px) * (by - py)
	);
}

// pointInTriangle, but false when the point equals the triangle's first corner.
function pointInTriangleExceptFirst(
	ax: number,
	ay: number,
	bx: number,
	by: number,
	cx: number,
	cy: number,
	px: number,
	py: number,
): boolean {
	return !(ax === px && ay === py) && pointInTriangle(ax, ay, bx, by, cx, cy, px, py);
}

// True when a diagonal between two nodes lies inside the polygon.
function isValidDiagonal(a: Node, b: Node): boolean {
	return (
		a.next.i !== b.i &&
		a.prev.i !== b.i &&
		!intersectsPolygon(a, b) &&
		// It is visible locally and makes no opposite-facing sectors.
		((locallyInside(a, b) &&
			locallyInside(b, a) &&
			middleInside(a, b) &&
			!!(area(a.prev, a, b.prev) || area(a, b.prev, b))) ||
			// The special case of a diagonal of zero length.
			(equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0))
	);
}

// The signed area of a triangle.
function area(p: Node, q: Node, r: Node): number {
	return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
}

function equals(p1: Node, p2: Node): boolean {
	return p1.x === p2.x && p1.y === p2.y;
}

// True when two segments intersect.
function intersects(p1: Node, q1: Node, p2: Node, q2: Node): boolean {
	const o1 = sign(area(p1, q1, p2));
	const o2 = sign(area(p1, q1, q2));
	const o3 = sign(area(p2, q2, p1));
	const o4 = sign(area(p2, q2, q1));
	if (o1 !== o2 && o3 !== o4) return true;
	if (o1 === 0 && onSegment(p1, p2, q1)) return true;
	if (o2 === 0 && onSegment(p1, q2, q1)) return true;
	if (o3 === 0 && onSegment(p2, p1, q2)) return true;
	if (o4 === 0 && onSegment(p2, q1, q2)) return true;
	return false;
}

// For collinear points, true when q lies on the segment from p to r.
function onSegment(p: Node, q: Node, r: Node): boolean {
	return (
		q.x <= Math.max(p.x, r.x) &&
		q.x >= Math.min(p.x, r.x) &&
		q.y <= Math.max(p.y, r.y) &&
		q.y >= Math.min(p.y, r.y)
	);
}

function sign(num: number): number {
	return num > 0 ? 1 : num < 0 ? -1 : 0;
}

// True when a diagonal crosses any edge of the polygon.
function intersectsPolygon(a: Node, b: Node): boolean {
	let p = a;
	do {
		if (
			p.i !== a.i &&
			p.next.i !== a.i &&
			p.i !== b.i &&
			p.next.i !== b.i &&
			intersects(p, p.next, a, b)
		) {
			return true;
		}
		p = p.next;
	} while (p !== a);
	return false;
}

// True when a diagonal lies inside the polygon near its first end.
function locallyInside(a: Node, b: Node): boolean {
	return area(a.prev, a, a.next) < 0
		? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0
		: area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
}

// True when the middle of a diagonal lies inside the polygon.
function middleInside(a: Node, b: Node): boolean {
	let p = a;
	let inside = false;
	const px = (a.x + b.x) / 2;
	const py = (a.y + b.y) / 2;
	do {
		if (
			p.y > py !== p.next.y > py &&
			p.next.y !== p.y &&
			px < ((p.next.x - p.x) * (py - p.y)) / (p.next.y - p.y) + p.x
		) {
			inside = !inside;
		}
		p = p.next;
	} while (p !== a);
	return inside;
}

// Links two vertices with a bridge. Vertices of one ring split it in two. A vertex of the outer
// ring and one of a hole merge the two rings into one.
function splitPolygon(a: Node, b: Node): Node {
	const a2 = new Node(a.i, a.x, a.y);
	const b2 = new Node(b.i, b.x, b.y);
	const an = a.next;
	const bp = b.prev;
	a.next = b;
	b.prev = a;
	a2.next = an;
	an.prev = a2;
	b2.next = a2;
	a2.prev = b2;
	bp.next = b2;
	b2.prev = bp;
	return b2;
}

// Makes a node and links it after `last` in a ring.
function insertNode(i: number, x: number, y: number, last: Node | undefined): Node {
	const p = new Node(i, x, y);
	if (last) {
		p.next = last.next;
		p.prev = last;
		last.next.prev = p;
		last.next = p;
	}
	return p;
}

function removeNode(p: Node): void {
	p.next.prev = p.prev;
	p.prev.next = p.next;
	if (p.prevZ) p.prevZ.nextZ = p.nextZ;
	if (p.nextZ) p.nextZ.prevZ = p.prevZ;
}

function signedArea(data: readonly number[], start: number, end: number, dim: number): number {
	let sum = 0;
	for (let i = start, j = end - dim; i < end; i += dim) {
		sum +=
			((data[j] as number) - (data[i] as number)) *
			((data[i + 1] as number) + (data[j + 1] as number));
		j = i;
	}
	return sum;
}
