// Sockets: the places where a ground form's pieces attach. A ground plant has no axis above the
// soil, so its frame is a set of base points: the shoots of a stool spread over a small disc, or
// the feet of a colony spread over a patch. Each point carries pieces of the kit, a blade, a leaf
// on its stalk, a frond or a flowering stem, each placed whole at a socket.
//
// A socket is a bud site of the socket kind. Its frame stands the piece: +Y the piece's own up and
// +Z the way it heads. Its vigor names the piece's class (leaf/piece.ts) and its wood radius holds
// the piece's length in metres, which sets the row's scale.
//
// Every socket has a place in the order the plant thins by: its `keep`, from 0 for the pieces that
// go last to 1 for those that go first. A piece on a shoot never outlasts the shoot, so its keep
// is never below its shoot's. The sockets enter the skeleton sorted by keep, so a socket's rank is
// its place among the skeleton's sockets, and the first sockets of any count are a plant that is
// spread evenly and holds together. A socket's light holds how long it stays, 1 less its keep, as a
// shoot's bud holds the light it is pruned by: the sockets of the least plant are the brightest.
import { BUD_SOCKET, type SkeletonBuilder } from '../core/graph';
import { cos, PI, quatFromFrame, sin, type Vector3 } from '../core/math';
import { socketVigor } from '../leaf/piece';

/**
 * The plastic number's two steps: the low-discrepancy sequence of points in a square whose every
 * leading run is spread evenly over it (Roberts 2018, the R2 sequence).
 */
const R2_A = 0.7548776662466927;
const R2_B = 0.5698402909980532;

/**
 * One base point of a ground plant.
 *
 * @category api/vegetation
 */
export interface Place {
	/** Where it stands on the ground, in metres from the plant's middle. */
	readonly x: number;
	readonly z: number;
	/** How far out it stands, from 0 at the middle to 1 at the rim. */
	readonly out: number;
	/** The direction from the middle out through it, in radians; +X is 0. */
	readonly heading: number;
}

/**
 * Base points spread evenly over a disc, in an order whose every leading run is itself spread
 * evenly over the whole disc, rim and middle alike. A plant that keeps only its first points keeps
 * its full width and stays balanced round its middle.
 *
 * @param count The points.
 * @param radius The disc's radius in metres.
 * @param turn Radians to turn the whole set by.
 * @returns The points, the last to go first.
 * @category api/vegetation
 */
export function discPlaces(count: number, radius: number, turn: number): Place[] {
	const places: Place[] = [];
	for (let i = 0; i < count; i++) {
		const a = (0.5 + (i + 1) * R2_A) % 1;
		const b = (0.5 + (i + 1) * R2_B) % 1;
		// The square root spreads the points evenly by area; the rim keeps its share at every count.
		const out = Math.sqrt(a);
		const heading = turn + 2 * PI * b;
		places.push({ x: cos(heading) * out * radius, z: sin(heading) * out * radius, out, heading });
	}
	return places;
}

/**
 * One socket to add: the piece it carries and where and how the piece stands.
 *
 * @category api/vegetation
 */
export interface Socket {
	/** The axis the piece sways with, and the node of that axis it stands at. */
	readonly axis: number;
	readonly node: number;
	/** The attach point, in plant space. */
	readonly at: Readonly<Vector3>;
	/** The piece's own up, a unit vector: plumb for a piece that hangs under its own weight. */
	readonly up: Readonly<Vector3>;
	/** The way the piece heads, in radians about the plumb line; +X is 0. */
	readonly heading: number;
	/** The piece's class, as its place in the grower's list of classes. */
	readonly piece: number;
	/** The piece's length in metres. */
	readonly length: number;
	/** Its place in the order the plant thins by, from 0 for the last to go to 1 for the first. */
	readonly keep: number;
}

/**
 * Adds a plant's sockets to its skeleton, the last to go first, so each socket's rank is its place
 * among the skeleton's sockets. Sockets of the same keep stay in the order they were given.
 *
 * @param builder The skeleton under construction.
 * @param sockets The sockets.
 * @param classes The classes of piece in the grower's list.
 * @category api/vegetation
 */
export function addSockets(
	builder: SkeletonBuilder,
	sockets: readonly Socket[],
	classes: number,
): void {
	const order = sockets.map((_, i) => i);
	order.sort((a, b) => (sockets[a] as Socket).keep - (sockets[b] as Socket).keep || a - b);
	const frame = new Float32Array(4);
	for (const i of order) {
		const socket = sockets[i] as Socket;
		quatFromFrame(socket.up, [cos(socket.heading), 0, sin(socket.heading)], frame);
		builder.addBud({
			node: socket.node,
			x: socket.at[0],
			y: socket.at[1],
			z: socket.at[2],
			frame,
			kind: BUD_SOCKET,
			vigor: socketVigor(socket.piece, classes),
			light: 1 - socket.keep,
			axis: socket.axis,
			woodRadius: socket.length,
		});
	}
}
