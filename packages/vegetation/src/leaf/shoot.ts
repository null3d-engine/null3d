// The shoot prototypes: small real shoots grown once per species from the record. A prototype is a
// current-year shoot with older years below it: each year a growth unit of nodes spaced by the
// class's internode curve, its stem bending by the twig's zigzag and droop. Older units end in the
// cluster of buds that last year's laterals grew from, so a prototype of two or three orders
// branches where a year ended. Leaves (or needles, or fascicles) stand on the newest years' nodes by
// the phyllotaxis, scaled and angled by position, each with a bud in its axil, and each axis ends in
// its bud cluster.
//
// A prototype is planned once from the record and the integer hash, then meshed at every tier from
// that plan, so a tier changes triangles and never the shoot's shape. Each vertex then gets its
// shade inside the shoot from rays cast against the plan's high-tier triangles.
//
// Prototype space: the attach point at the origin, the shoot leaving along +Y, +Z toward the sky
// side of the bud it grows from.
import type { PrototypeArrays, ShootPrototype } from '../asset';
import { hashAt, unitAt } from '../core/hash';
import {
	cos,
	cross3,
	length3,
	normalize3,
	quatAxisAngle,
	quatFromFrame,
	quatRotate,
	radians,
	sin,
	type Vector3,
} from '../core/math';
import type { Phyllotaxis, ShootClass, Species } from '../core/record';
import type { TextureManifest } from '../core/textures';
import { curveAt, DETAILS, type Detail, spreadAt, spreadMean } from '../core/types';
import { shootOcclusion } from './occlusion';
import { hasBareTwins } from './season';
import { lathe, MeshWriter, SURFACE_STEM, type TubePoint, tube } from './writer';

/**
 * A shoot prototype before the card bake gives it its atlas cells.
 *
 * @category api/vegetation
 */
export type UncardedPrototype = Omit<ShootPrototype, 'card'>;

/** The golden angle in degrees. */
const GOLDEN = 137.50776405;
/** Degrees between a lateral shoot of the prototype and its parent. */
const LATERAL_ANGLE = 42;
/** Degrees an axillary bud leans from its stem. */
const BUD_LEAN = 28;
/** Degrees the buds of a tip cluster lean from the terminal bud. */
const CLUSTER_LEAN = 32;

/** Purposes of the prototypes' hash keys, so no two draws share one. */
const Purpose = {
	Length: 1,
	Unit: 2,
	Nodes: 3,
	Start: 4,
	Wander: 5,
	Laterals: 6,
	LateralTurn: 7,
	LeafSize: 8,
	LeafMesh: 9,
	Phase: 10,
	Spur: 11,
} as const;

/** Sides of stem tubes and buds by tier. */
const STEM_SIDES: Readonly<Record<Detail, number>> = { low: 3, medium: 4, high: 5, ultra: 6 };
/** A bud's mesh at a tier: faces around, and whether its profile is rounded or a plain cone. */
interface BudShape {
	readonly sides: number;
	readonly round: boolean;
}
/** The buds of a tip cluster, which a close view reads, are rounder than those in the leaf axils. */
const CLUSTER_BUD: Readonly<Record<Detail, BudShape>> = {
	low: { sides: 3, round: false },
	medium: { sides: 4, round: false },
	high: { sides: 5, round: true },
	ultra: { sides: 6, round: true },
};
/** An axil's bud hides under its leaf, so the low tier leaves it out. */
const AXIL_BUD: Readonly<Record<Detail, BudShape | undefined>> = {
	low: undefined,
	medium: { sides: 3, round: false },
	high: { sides: 4, round: false },
	ultra: { sides: 5, round: true },
};
/** The tier whose vertices cast the shoot's shade rays. */
const SHADE_TIER = DETAILS.indexOf('medium');

/** One point along an axis of the plan. */
interface AxisPoint {
	readonly at: Vector3;
	readonly radius: number;
	/** Metres along the shoot from the attach point. */
	readonly along: number;
}

/** One leaf of the plan. */
export interface PlannedLeaf {
	/** Where its stalk joins the stem. */
	readonly at: Vector3;
	/** Its turn from leaf space, x, y, z, w: +Y along the midrib, +Z the upper face. */
	readonly rotation: readonly number[];
	/** Its size over the leaf mesh's. */
	readonly scale: number;
	/** The leaf mesh it draws, by index. */
	readonly mesh: number;
	/** Its flutter phase, 0 to 255. */
	readonly phase: number;
	/** Metres along the shoot from the attach point. */
	readonly along: number;
	/** The axis it stands on, and its node's index along that axis. */
	readonly axis: number;
	readonly node: number;
	/** The stem's direction at its node. */
	readonly stem: Vector3;
	/** The direction the leaf leaves in. */
	readonly direction: Vector3;
}

/** One bud of the plan. */
interface PlannedBud {
	readonly at: Vector3;
	readonly direction: Vector3;
	readonly length: number;
	readonly width: number;
	readonly along: number;
	/** Whether it belongs to a tip cluster, not to a leaf axil. */
	readonly cluster: boolean;
}

/**
 * A prototype's plan: its axes, leaves and buds, which every tier meshes.
 *
 * @category api/vegetation
 */
export interface ShootPlan {
	/** Each axis as points from base to tip; axis 0 is the shoot itself. */
	readonly axes: readonly (readonly AxisPoint[])[];
	readonly leaves: readonly PlannedLeaf[];
	readonly buds: readonly PlannedBud[];
	/** Metres from the attach point to the farthest point of any axis. */
	readonly reach: number;
	/** Metres along the longest path, for the bend weight. */
	readonly span: number;
}

/** What one axis grows from. */
interface AxisStart {
	readonly at: Vector3;
	readonly direction: Vector3;
	/** The sky side, square or nearly square to the direction. */
	readonly sky: Vector3;
	readonly order: number;
	/** Growth units still to grow: the newest is the last. */
	readonly units: number;
	/** Metres of one unit. */
	readonly unitLength: number;
	readonly radius: number;
	readonly along: number;
}

/** Projects `v` square to the unit `axis`, then scales it to unit length; `fallback` when it vanishes. */
function square(
	v: Readonly<Vector3>,
	axis: Readonly<Vector3>,
	fallback: Readonly<Vector3>,
): Vector3 {
	const d = v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2];
	const out: Vector3 = [v[0] - d * axis[0], v[1] - d * axis[1], v[2] - d * axis[2]];
	if (length3(out[0], out[1], out[2]) < 1e-6) return square(fallback, axis, [1, 0, 0]);
	return normalize3(out);
}

/** Turns `v` about the unit `axis` by `degrees`. */
function turn(v: Readonly<Vector3>, axis: Readonly<Vector3>, degrees: number): Vector3 {
	const q = [0, 0, 0, 1];
	quatAxisAngle(axis, radians(degrees), q);
	return quatRotate(q, 0, v, [0, 0, 0]);
}

/** The leaves standing at one node: their azimuths in degrees about the stem. */
function nodeAzimuths(
	phyllotaxis: Phyllotaxis,
	node: number,
	start: number,
	count: (key: number) => number,
): number[] {
	switch (phyllotaxis.kind) {
		case 'spiral':
			return [start + node * phyllotaxis.divergence];
		case 'fascicle':
			return [start + node * GOLDEN];
		case 'distichous':
			return [start + node * 180];
		case 'opposite': {
			const a = start + (phyllotaxis.decussate ? node * 90 : 0);
			return [a, a + 180];
		}
		case 'whorled': {
			const n = Math.max(2, Math.round(phyllotaxis.count));
			const a = start + (node * 180) / n;
			const out: number[] = [];
			for (let k = 0; k < n; k++) out.push(a + (k * 360) / n);
			return out;
		}
		case 'rosette-spur': {
			const n = Math.max(1, Math.round(count(node)));
			const out: number[] = [];
			for (let k = 0; k < n; k++) out.push(start + k * GOLDEN);
			return out;
		}
	}
}

/** The class each prototype belongs to: classes take prototypes by share, in vigor order. */
function classOf(classes: readonly ShootClass[], index: number, count: number): ShootClass {
	const share = (index + 0.5) / count;
	let sum = 0;
	for (const candidate of classes) {
		sum += candidate.share;
		if (share <= sum) return candidate;
	}
	return classes[classes.length - 1] as ShootClass;
}

/** How many leaves (or needles, or fascicles) a growth unit of this length carries. */
function unitNodes(
	record: Species,
	shootClass: ShootClass,
	unitLength: number,
	unit: number,
): number {
	const foliage = record.foliage;
	// A spur carries its whole rosette at its one node.
	if (record.shoots?.phyllotaxis.kind === 'rosette-spur') return 1;
	if (foliage.kind === 'needle')
		return Math.max(1, Math.round(foliage.needle.density * unitLength * 100));
	return Math.max(1, Math.round(spreadAt(shootClass.nodes, unit)));
}

/**
 * Plans one prototype from the record: its axes, its leaves and its buds.
 *
 * @param record The species record.
 * @param index The prototype's index.
 * @param leafMeshes The leaf meshes it may place.
 * @returns The plan.
 * @category api/vegetation
 */
export function planShoot(record: Species, index: number, leafMeshes: number): ShootPlan {
	const shoots = record.shoots;
	if (!shoots) throw new Error(`@null3d/vegetation: '${record.id}' has no shoots to plan`);
	const salt = record.seedSalt;
	const draw = (purpose: number, a = 0, b = 0) => unitAt(salt, 0x5400 + index, purpose, a, b);
	const shootClass = classOf(shoots.classes, index, shoots.prototypes);
	const total = Math.max(0.005, spreadAt(shootClass.length, draw(Purpose.Length)));
	const years = Math.max(1, Math.round(shootClass.years ?? shoots.years));
	const leafYears = Math.max(0, Math.min(years, Math.round(shoots.leafYears)));
	// How far a leaf turns its upper face from the shoot's tip toward the sky side: the record's
	// skyward share, all the way for flattened two-ranked sprays.
	const skyTurn = Math.min(1, Math.max(0, shoots.placement.skyward));
	const phyllotaxis = shoots.phyllotaxis;
	const foliage = record.foliage;
	const leafLength = foliage.kind === 'blade' ? spreadMean(foliage.leaf.length) : 0;
	const leafSpread =
		foliage.kind === 'blade'
			? foliage.leaf.length
			: foliage.kind === 'needle' || foliage.kind === 'fascicle'
				? foliage.needle.length
				: 1;
	const leafMean = spreadMean(leafSpread);
	const needleAngle =
		foliage.kind === 'needle' || foliage.kind === 'fascicle' ? foliage.needle.angle : undefined;
	const ranks = foliage.kind === 'needle' ? foliage.needle.ranks : 0;
	const flatten = phyllotaxis.kind === 'distichous' ? phyllotaxis.flatten : 0;
	const [baseRadius, tipRadius] = shoots.stem.radius;
	const axes: AxisPoint[][] = [];
	const leaves: PlannedLeaf[] = [];
	const buds: PlannedBud[] = [];
	const budLength = shoots.bud.length;
	const budWidth = shoots.bud.width;
	let span = 0;

	const grow = (start: AxisStart): void => {
		const axis = axes.length;
		const points: AxisPoint[] = [{ at: start.at, radius: start.radius, along: start.along }];
		axes.push(points);
		let at: Vector3 = [...start.at];
		let direction: Vector3 = [...start.direction];
		let sky = square(start.sky, direction, [0, 0, 1]);
		let along = start.along;
		let node = 0;
		const azimuthStart = draw(Purpose.Start, axis) * 360;
		const axisLength = start.unitLength * start.units;
		let zig = 1;
		for (let unit = 0; unit < start.units; unit++) {
			const length = start.unitLength * (0.85 + 0.3 * draw(Purpose.Unit, axis, unit));
			const newest = unit === start.units - 1;
			const leafy = unit >= start.units - leafYears;
			const nodes = unitNodes(record, shootClass, length, draw(Purpose.Nodes, axis, unit));
			// Internodes by the class's curve along the unit, scaled to the unit's length.
			const weights: number[] = [];
			let weightSum = 0;
			for (let k = 0; k < nodes; k++) {
				const w = Math.max(0.02, curveAt(shootClass.internode, (k + 0.5) / nodes));
				weights.push(w);
				weightSum += w;
			}
			for (let k = 0; k < nodes; k++) {
				const step = (length * (weights[k] as number)) / weightSum;
				// How crowded the node stands: 0 at an even spacing, toward 1 where internodes shrink (a tip rosette).
				const crowded = 1 - Math.min(1, step / (length / nodes));
				// Zigzag in the shoot's own plane at each node, droop toward the ground side, a small wander.
				direction = turn(direction, sky, zig * shoots.stem.zigzag);
				zig = -zig;
				const side = normalize3(cross3(direction, sky, [0, 0, 0]));
				direction = turn(direction, side, (shootClass.droop * step) / Math.max(total, 1e-6));
				direction = turn(direction, sky, (draw(Purpose.Wander, axis, node) - 0.5) * 6);
				normalize3(direction);
				sky = square(sky, direction, [0, 0, 1]);
				at = [
					at[0] + direction[0] * step,
					at[1] + direction[1] * step,
					at[2] + direction[2] * step,
				];
				along += step;
				const share = Math.min(1, (along - start.along) / Math.max(axisLength, 1e-6));
				const radius = start.radius + (tipRadius - start.radius) * share;
				points.push({ at: [...at], radius, along });
				span = Math.max(span, along);
				const t = nodes === 1 ? 1 : k / (nodes - 1);
				if (leafy && leafMeshes > 0)
					placeLeaves(axis, node, at, direction, sky, radius, along, t, azimuthStart, crowded);
				node++;
			}
			// The end of a unit: the newest ends in its bud cluster; an older one in last year's
			// cluster, from which this year's laterals grew.
			if (newest) addCluster(at, direction, sky, along);
			else if (start.order + 1 < shoots.orders) {
				const count = Math.max(
					1,
					Math.min(
						3,
						Math.round(
							shoots.bud.tipCluster * 0.45 * (0.6 + 0.8 * draw(Purpose.Laterals, axis, unit)),
						),
					),
				);
				for (let k = 0; k < count; k++) {
					const azimuth = azimuthStart + k * GOLDEN + draw(Purpose.LateralTurn, axis, k) * 40;
					const outward = turn(sky, direction, azimuth);
					const lean = LATERAL_ANGLE * (0.75 + 0.5 * draw(Purpose.LateralTurn, axis, k + 8));
					const lateral = normalize3([
						direction[0] * cos(radians(lean)) + outward[0] * sin(radians(lean)),
						direction[1] * cos(radians(lean)) + outward[1] * sin(radians(lean)),
						direction[2] * cos(radians(lean)) + outward[2] * sin(radians(lean)),
					]);
					grow({
						at: [...at],
						direction: lateral,
						sky,
						order: start.order + 1,
						units: start.units - unit - 1,
						unitLength: start.unitLength * (0.6 + 0.25 * draw(Purpose.Laterals, axis, k + 16)),
						radius: Math.max(tipRadius, (points[points.length - 1] as AxisPoint).radius * 0.75),
						along,
					});
				}
			}
		}
	};

	/** The leaves of one node, each with its axillary bud. */
	const placeLeaves = (
		axis: number,
		node: number,
		at: Vector3,
		stem: Vector3,
		sky: Vector3,
		radius: number,
		along: number,
		t: number,
		azimuthStart: number,
		crowded: number,
	): void => {
		const side = normalize3(cross3(stem, sky, [0, 0, 0]));
		const azimuths = nodeAzimuths(phyllotaxis, node, azimuthStart, (key) =>
			phyllotaxis.kind === 'rosette-spur'
				? spreadAt(phyllotaxis.leaves, draw(Purpose.Spur, axis, key))
				: 1,
		);
		const leafAngle = needleAngle ?? curveAt(shootClass.leafAngle, t);
		for (let k = 0; k < azimuths.length; k++) {
			let azimuth = radians(azimuths[k] as number);
			// Two-ranked needles turn toward the shoot's two sides.
			if (ranks > 0) {
				const toward = cos(azimuth) >= 0 ? 0 : Math.PI;
				let gap = toward - azimuth;
				gap -= 2 * Math.PI * Math.round(gap / (2 * Math.PI));
				azimuth += gap * ranks;
			}
			// A lit shoot twists its leaves' stalks into a mosaic: by the skyward share, each leaf swings
			// from the sky side toward the shoot's own side plane, so its leaves open as a fan that the sky
			// looks down on.
			const lift = sin(azimuth) * Math.min(skyTurn, 0.95);
			const radial = normalize3([
				side[0] * cos(azimuth) + sky[0] * (sin(azimuth) - lift),
				side[1] * cos(azimuth) + sky[1] * (sin(azimuth) - lift),
				side[2] * cos(azimuth) + sky[2] * (sin(azimuth) - lift),
			]);
			const a = radians(leafAngle);
			const direction = normalize3([
				stem[0] * cos(a) + radial[0] * sin(a),
				stem[1] * cos(a) + radial[1] * sin(a),
				stem[2] * cos(a) + radial[2] * sin(a),
			]);
			// The upper face looks toward the shoot's tip, turned toward the sky side.
			const adaxial = square(stem, direction, radial);
			const skyward = square(sky, direction, adaxial);
			const w = Math.min(1, skyTurn + flatten * (1 - skyTurn));
			const face = normalize3([
				adaxial[0] * (1 - w) + skyward[0] * w,
				adaxial[1] * (1 - w) + skyward[1] * w,
				adaxial[2] * (1 - w) + skyward[2] * w,
			]);
			const rotation = [0, 0, 0, 1];
			quatFromFrame(direction, face, rotation);
			const key = node * 8 + k;
			const size =
				curveAt(shootClass.leafScale, t) *
				(leafMean > 0 ? spreadAt(leafSpread, draw(Purpose.LeafSize, axis, key)) / leafMean : 1);
			leaves.push({
				at: [at[0] + radial[0] * radius, at[1] + radial[1] * radius, at[2] + radial[2] * radius],
				rotation,
				scale: Math.max(0.05, size),
				mesh: hashAt(salt, 0x5400 + index, Purpose.LeafMesh, axis, key) % leafMeshes,
				phase: hashAt(salt, 0x5400 + index, Purpose.Phase, axis, key) & 255,
				along,
				axis,
				node,
				stem: [...stem],
				direction,
			});
			if (leafLength > 0 && budLength > 0) {
				const lean = radians(BUD_LEAN);
				buds.push({
					at: [at[0] + radial[0] * radius, at[1] + radial[1] * radius, at[2] + radial[2] * radius],
					direction: normalize3([
						stem[0] * cos(lean) + radial[0] * sin(lean),
						stem[1] * cos(lean) + radial[1] * sin(lean),
						stem[2] * cos(lean) + radial[2] * sin(lean),
					]),
					cluster: false,
					// Axil buds grow toward the tip cluster's size where the nodes crowd into a rosette.
					length: budLength * (0.55 + 0.35 * crowded),
					width: budWidth * (0.55 + 0.35 * crowded),
					along,
				});
			}
		}
	};

	/** The bud cluster at an axis's tip: the terminal bud and the buds stacked below it. */
	const addCluster = (at: Vector3, direction: Vector3, sky: Vector3, along: number): void => {
		if (budLength <= 0) return;
		buds.push({
			at: [...at],
			direction: [...direction],
			length: budLength,
			width: budWidth,
			along,
			cluster: true,
		});
		const count = Math.max(0, Math.round(shoots.bud.tipCluster) - 1);
		for (let k = 0; k < count; k++) {
			const outward = turn(sky, direction, k * GOLDEN);
			const lean = radians(CLUSTER_LEAN);
			// The cluster stacks down the twig's last centimetres, each bud a little below the last on a
			// spiral, standing on the bark.
			const back = budLength * (0.35 + 0.4 * k);
			const out = tipRadius + budWidth * 0.2;
			buds.push({
				at: [
					at[0] - direction[0] * back + outward[0] * out,
					at[1] - direction[1] * back + outward[1] * out,
					at[2] - direction[2] * back + outward[2] * out,
				],
				direction: normalize3([
					direction[0] * cos(lean) + outward[0] * sin(lean),
					direction[1] * cos(lean) + outward[1] * sin(lean),
					direction[2] * cos(lean) + outward[2] * sin(lean),
				]),
				cluster: true,
				length: budLength * 0.8,
				width: budWidth * 0.85,
				along: along - back,
			});
		}
	};

	const units = years;
	grow({
		at: [0, 0, 0],
		direction: [0, 1, 0],
		sky: [0, 0, 1],
		order: 0,
		units,
		unitLength: total / units,
		radius: baseRadius,
		along: 0,
	});
	let reach = 0;
	for (const points of axes)
		for (const point of points)
			reach = Math.max(reach, length3(point.at[0], point.at[1], point.at[2]));
	return { axes, leaves, buds, reach, span: Math.max(span, 1e-6) };
}

/** The bend weight byte of a point along the shoot. */
function bendByte(along: number, span: number): number {
	return Math.min(255, Math.max(0, Math.round((along / span) * 255)));
}

/**
 * Meshes a prototype's plan at one tier, every vertex unoccluded.
 *
 * @param plan The plan.
 * @param leafMeshes The leaf meshes at this tier.
 * @param detail The tier.
 * @returns The mesh.
 * @category api/vegetation
 */
export function meshShoot(
	plan: ShootPlan,
	leafMeshes: readonly PrototypeArrays[],
	detail: Detail,
): MeshWriter {
	const mesh = new MeshWriter();
	const sides = STEM_SIDES[detail];
	for (const points of plan.axes) {
		// Rings no closer than twice the stem's radius, and every other one on the low tier.
		const path: TubePoint[] = [];
		const keepEvery = detail === 'low' ? 2 : 1;
		for (let k = 0; k < points.length; k++) {
			const point = points[k] as AxisPoint;
			const last = path[path.length - 1];
			const end = k === points.length - 1;
			if (last && !end) {
				const gap = point.along - last.along;
				if (gap < point.radius * 2 || k % keepEvery !== 0) continue;
			}
			path.push(point);
		}
		mesh.mark();
		tube(mesh, path, sides, (ring) => [
			bendByte((path[ring] as TubePoint).along, plan.span),
			0,
			SURFACE_STEM,
			255,
		]);
	}
	for (const bud of plan.buds) {
		const shape = (bud.cluster ? CLUSTER_BUD : AXIL_BUD)[detail];
		mesh.mark();
		if (!shape) continue;
		const w = bud.width / 2;
		const l = bud.length;
		const profile: [number, number][] = shape.round
			? [
					[w * 0.6, 0],
					[w, l * 0.35],
					[w * 0.7, l * 0.72],
					[0, l],
				]
			: [
					[w * 0.5, 0],
					[w, l * 0.4],
					[0, l],
				];
		lathe(mesh, profile, bud.at, bud.direction, shape.sides, [
			bendByte(bud.along, plan.span),
			0,
			SURFACE_STEM,
			255,
		]);
	}
	for (const leaf of plan.leaves) {
		const source = leafMeshes[leaf.mesh];
		mesh.mark();
		if (!source) continue;
		const bend = bendByte(leaf.along, plan.span);
		mesh.append(
			source,
			(p, n) => {
				p[0] *= leaf.scale;
				p[1] *= leaf.scale;
				p[2] *= leaf.scale;
				quatRotate(leaf.rotation, 0, p, p);
				p[0] += leaf.at[0];
				p[1] += leaf.at[1];
				p[2] += leaf.at[2];
				quatRotate(leaf.rotation, 0, n, n);
			},
			(bytes) => {
				bytes[0] = bend;
				bytes[1] = leaf.phase;
			},
			(uv1) => {
				uv1[0] = (uv1[0] as number) * leaf.scale;
				uv1[1] = (uv1[1] as number) * leaf.scale;
			},
		);
	}
	return mesh;
}

/** One prototype from a plan: its tiers meshed and shaded, its reach and bounds measured. */
function prototypeOf(
	plan: ShootPlan,
	leaves: readonly (readonly PrototypeArrays[])[],
	index: number,
	shootClass: ShootClass,
): UncardedPrototype {
	const writers = DETAILS.map((detail, tier) => meshShoot(plan, leaves[tier] ?? [], detail));
	shootOcclusion(writers, SHADE_TIER);
	const tiers = writers.map((writer) =>
		writer.finishPrototype(),
	) as unknown as UncardedPrototype['tiers'];
	let radius = 0;
	const positions = (tiers[DETAILS.indexOf('high')] as PrototypeArrays).positions;
	for (let i = 0; i < positions.length; i += 3)
		radius = Math.max(
			radius,
			length3(positions[i] as number, positions[i + 1] as number, positions[i + 2] as number),
		);
	return {
		index,
		class: shootClass.name,
		vigor: shootClass.vigor,
		length: plan.reach,
		radius,
		leaves: plan.leaves.length,
		tiers,
	};
}

/**
 * Grows a species' shoot prototypes, each at every detail tier, from its leaf meshes. A deciduous
 * species' kit holds the record's prototypes, then a leafless twin of each in the same order (its
 * `leaves` is 0), which rows draw where the season leaves the shoot bare.
 *
 * @param record The species record.
 * @param manifest The texture manifest.
 * @param leaves The species' leaf meshes at every tier, low first.
 * @returns The prototypes.
 */
export function shootPrototypes(
	record: Species,
	manifest: TextureManifest,
	leaves: readonly (readonly PrototypeArrays[])[],
): UncardedPrototype[] {
	void manifest;
	const shoots = record.shoots;
	if (!shoots) return [];
	const leafMeshes = Math.min(...leaves.map((tier) => tier.length));
	const plans = Array.from({ length: shoots.prototypes }, (_, index) =>
		planShoot(record, index, leafMeshes),
	);
	const classes = plans.map((_, index) => classOf(shoots.classes, index, shoots.prototypes));
	const out = plans.map((plan, index) =>
		prototypeOf(
			leafMeshes > 0 ? plan : { ...plan, leaves: [] },
			leaves,
			index,
			classes[index] as ShootClass,
		),
	);
	if (leafMeshes > 0 && hasBareTwins(record))
		for (const [index, plan] of plans.entries())
			out.push(
				prototypeOf({ ...plan, leaves: [] }, leaves, out.length, classes[index] as ShootClass),
			);
	return out;
}
