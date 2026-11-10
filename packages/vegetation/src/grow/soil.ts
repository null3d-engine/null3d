// The crown's hold in the soil: a rhizome lying along the ground and the roots that leave it and the
// crown. A tuft draws it from its crown; a frond colony draws the same rhizome under its fronds when
// its record gives one. A root runs below the soil, where a shoot's own path never goes, so it takes
// its own node run rather than the arching one.
import { AXIS_ROOT, type SkeletonBuilder } from '../core/graph';
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
): void {
	const roots = Math.max(0, Math.round(spreadAt(soil.roots, draw(rootPurpose) as number)));
	const heading = (draw(rhizomePurpose, 2) as number) * 2 * Math.PI;
	let from = host;
	let fromNode = hostNode;
	if (soil.rhizome !== undefined) {
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

/**
 * Adds a root's axis: nodes running out from the crown and down below the soil, its radius closing
 * to a point at the end.
 */
function rootPath(
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
