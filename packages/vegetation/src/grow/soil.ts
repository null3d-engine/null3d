// The crown's hold in the soil: a rhizome lying along the ground and the roots that leave it and the
// crown. A tuft draws it from its crown; a frond colony draws the same rhizome under its fronds when
// its record gives one. A root runs below the soil, where a shoot's own path never goes, so it takes
// its own node run rather than the arching one.
import { AXIS_ROOT, NODE_SOIL_BODY, type SkeletonBuilder } from '../core/graph';
import { cos, radians, sin, type Vector3 } from '../core/math';
import type { TuftSoil } from '../core/record';
import { spreadAt } from '../core/types';

/** A direction in the vertical plane of a heading: `elevation` radians above the horizontal. */
function inPlane(heading: number, elevation: number): Vector3 {
	const c = cos(elevation);
	return [cos(heading) * c, sin(elevation), sin(heading) * c];
}

/** One draw for the soil's parts: a purpose, then up to two indices. */
export type SoilDraw = (purpose: number, a?: number, b?: number) => number;

/**
 * Adds the soil's rhizome and roots to a skeleton.
 *
 * @param builder The skeleton being grown.
 * @param soil What the record draws under the plant.
 * @param draw The grower's draw, with the two purposes below.
 * @param rootPurpose The draw's key for a root.
 * @param rhizomePurpose The draw's key for the rhizome.
 * @param host The axis the roots leave when there is no rhizome.
 * @param hostNode The host's node the roots leave from.
 * @param margin Metres from the host's axis that the roots start, when there is no rhizome.
 */
export function growSoil(
	builder: SkeletonBuilder,
	soil: TuftSoil,
	draw: SoilDraw,
	rootPurpose: number,
	rhizomePurpose: number,
	host: number,
	hostNode: number,
	margin: number,
	spines?: readonly (readonly (readonly [number, number])[])[],
): void {
	const roots = Math.max(0, Math.round(spreadAt(soil.roots, draw(rootPurpose) as number)));
	const heading = (draw(rhizomePurpose, 2) as number) * 2 * Math.PI;
	let from = host;
	let fromNode = hostNode;
	if (spines && spines.length > 0) {
		// A colony's rhizome lines carry its fronds, so each line's body runs through the feet of
		// its own stipes: the body starts thick at the colony's middle and thins toward the ends.
		const radius = soil.rhizomeRadius ?? 0.01;
		let firstNode = -1;
		for (const spine of spines) {
			if (spine.length < 2) continue;
			const points = resample(spine, 5);
			const axis = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_ROOT });
			let previous = -1;
			points.forEach((point, i) => {
				const share = i / (points.length - 1);
				previous = builder.addNode({
					x: point[0],
					y: -radius * (1.15 - 0.35 * share),
					z: point[1],
					radius: radius * (1 - 0.45 * share),
					parent: previous < 0 ? -1 : previous,
					axis,
					light: 1,
					flags: soil.body ? NODE_SOIL_BODY : 0,
				});
				if (i === 0 && firstNode < 0) {
					firstNode = previous;
					from = axis;
				}
			});
		}
		if (firstNode >= 0) fromNode = firstNode;
	} else if (soil.rhizome !== undefined) {
		const half = spreadAt(soil.rhizome, draw(rhizomePurpose) as number);
		const radius = soil.rhizomeRadius ?? 0.01;
		const along: [number, number] = [cos(heading), sin(heading)];
		const axis = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_ROOT });
		const nodes = 5;
		let previous = -1;
		for (let i = 0; i < nodes; i++) {
			const share = i / (nodes - 1);
			const reach = -half + 2 * half * share;
			const end = Math.abs(2 * share - 1);
			previous = builder.addNode({
				x: along[0] * reach,
				y: -radius * (0.4 + 0.35 * end),
				z: along[1] * reach,
				radius: radius * (0.55 + 0.45 * (1 - end)),
				parent: previous < 0 ? -1 : previous,
				axis,
				light: 1,
				flags: soil.body ? NODE_SOIL_BODY : 0,
			});
		}
		from = axis;
		fromNode = previous;
	}
	for (let r = 0; r < roots; r++) {
		const unit = (k: number) => draw(rootPurpose, r, k) as number;
		const out = heading + (r / Math.max(1, roots)) * 2 * Math.PI + (unit(0) - 0.5) * 0.8;
		const droop = radians(spreadAt(soil.droop, unit(1)));
		const length = spreadAt(soil.rootLength, unit(2));
		const start = from === host ? -0.02 : -0.01;
		const rootMargin = from === host ? margin : 0.01;
		const position: Vector3 = [
			cos(out) * rootMargin * unit(3),
			start,
			sin(out) * rootMargin * unit(3),
		];
		rootPath(builder, from, fromNode, position, out, -droop, length, soil.rootRadius);
	}
}

/** A polyline's points at even arc lengths, so a body's rings spread along its line. */
function resample(
	spine: readonly (readonly [number, number])[],
	count: number,
): [number, number][] {
	const lengths: number[] = [0];
	let total = 0;
	for (let i = 1; i < spine.length; i++) {
		const from = spine[i - 1] as readonly [number, number];
		const to = spine[i] as readonly [number, number];
		total += Math.hypot(to[0] - from[0], to[1] - from[1]);
		lengths.push(total);
	}
	const only = spine[0] as readonly [number, number];
	if (total < 1e-6) return [[only[0], only[1]]];
	const points: [number, number][] = [];
	for (let k = 0; k < count; k++) {
		const at = (total * k) / (count - 1);
		let i = 1;
		while (i < lengths.length - 1 && (lengths[i] as number) < at) i++;
		const from = spine[i - 1] as readonly [number, number];
		const to = spine[i] as readonly [number, number];
		const span = (lengths[i] as number) - (lengths[i - 1] as number) || 1;
		const t = (at - (lengths[i - 1] as number)) / span;
		points.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
	}
	return points;
}

/**
 * Adds a root's axis: nodes running out from the crown and down below the soil, its radius closing
 * to a point at the end.
 */ function rootPath(
	builder: SkeletonBuilder,
	parent: number,
	parentNode: number,
	start: Readonly<Vector3>,
	heading: number,
	elevation: number,
	length: number,
	radius: number,
): void {
	const axis = builder.addAxis({ parent, parentNode, parentT: 1, order: 1, kind: AXIS_ROOT });
	const nodes = 4;
	const p: Vector3 = [start[0], start[1], start[2]];
	const step = length / (nodes - 1);
	let previous = parentNode;
	for (let i = 0; i < nodes; i++) {
		const share = i / (nodes - 1);
		if (i > 0) {
			const d = inPlane(heading, elevation - radians(25) * share);
			p[0] += d[0] * step;
			p[1] += d[1] * step;
			p[2] += d[2] * step;
		}
		previous = builder.addNode({
			x: p[0],
			y: p[1],
			z: p[2],
			radius: radius * (1 - 0.85 * share),
			parent: i === 0 ? parentNode : previous,
			axis,
			light: 1,
		});
	}
}
