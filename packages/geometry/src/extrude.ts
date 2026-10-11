// The extrusion generator, ported from three.js's ExtrudeGeometry. It pushes a shape along +Z, or
// along a 3D curve, with an optional bevel around the caps. The caps come from the shape's
// triangles and the side walls from its outline and holes.

import type { Curve } from './curve';
import { CatmullRomCurve3 } from './curves';
import { faceNormals, type Tuple2, type Tuple3 } from './math';
import { Shape } from './path';
import { isClockWise, triangulateShape } from './shape-utils';
import type { GeneratedArrays, Vec2Like } from './types';

/**
 * Makes the texture coordinates of an extrusion's triangles, like the `UVGenerator` option of
 * three.js's `ExtrudeGeometry`. Each method gets the positions made so far, three numbers per
 * vertex, and the vertex numbers of one triangle or one side quad. three.js's methods also take
 * the geometry first. These do not, as there is no geometry object.
 *
 * @category api/geometry
 */
export interface UVGenerator {
	/** The texture coordinates of the three vertices of a cap triangle. */
	generateTopUV(
		vertices: readonly number[],
		indexA: number,
		indexB: number,
		indexC: number,
	): readonly Vec2Like[];
	/** The texture coordinates of the four corners of a side quad, in order. */
	generateSideWallUV(
		vertices: readonly number[],
		indexA: number,
		indexB: number,
		indexC: number,
		indexD: number,
	): readonly Vec2Like[];
}

/**
 * three.js's default texture coordinates for an extrusion. A cap vertex takes its x and y. A side
 * wall vertex takes its x or its y, whichever changes more along the wall, and 1 minus its z.
 *
 * @category api/geometry
 */
export const WorldUVGenerator: UVGenerator = {
	generateTopUV(vertices, indexA, indexB, indexC) {
		return [
			[vertices[indexA * 3] as number, vertices[indexA * 3 + 1] as number],
			[vertices[indexB * 3] as number, vertices[indexB * 3 + 1] as number],
			[vertices[indexC * 3] as number, vertices[indexC * 3 + 1] as number],
		];
	},
	generateSideWallUV(vertices, indexA, indexB, indexC, indexD) {
		const ax = vertices[indexA * 3] as number;
		const ay = vertices[indexA * 3 + 1] as number;
		const az = vertices[indexA * 3 + 2] as number;
		const bx = vertices[indexB * 3] as number;
		const by = vertices[indexB * 3 + 1] as number;
		const bz = vertices[indexB * 3 + 2] as number;
		const cx = vertices[indexC * 3] as number;
		const cy = vertices[indexC * 3 + 1] as number;
		const cz = vertices[indexC * 3 + 2] as number;
		const dx = vertices[indexD * 3] as number;
		const dy = vertices[indexD * 3 + 1] as number;
		const dz = vertices[indexD * 3 + 2] as number;
		if (Math.abs(ay - by) < Math.abs(ax - bx)) {
			return [
				[ax, 1 - az],
				[bx, 1 - bz],
				[cx, 1 - cz],
				[dx, 1 - dz],
			];
		}
		return [
			[ay, 1 - az],
			[by, 1 - bz],
			[cy, 1 - cz],
			[dy, 1 - dz],
		];
	},
};

/**
 * Options for `extrude`, with the names and defaults of three.js's `ExtrudeGeometry`.
 *
 * @category api/geometry
 */
export interface ExtrudeOptions {
	/**
	 * One shape or a list of shapes. The default is three.js's square with corners at x and y of
	 * 0.5 and -0.5.
	 */
	shapes?: Shape | readonly Shape[];
	/** The number of points along each curve of a shape. The default is 12. */
	curveSegments?: number;
	/** The number of steps along the depth or the path. The default is 1. */
	steps?: number;
	/** How far the shape moves along +Z. The default is 1. A path sets the length instead. */
	depth?: number;
	/** True adds a bevel around each cap. The default is true. A path turns it off. */
	bevelEnabled?: boolean;
	/** How far the bevel reaches out from each cap, along Z. The default is 0.2. */
	bevelThickness?: number;
	/** How far the bevel reaches out from the outline. The default is `bevelThickness` less 0.1. */
	bevelSize?: number;
	/** How far the bevel starts from the outline. The default is 0. */
	bevelOffset?: number;
	/** The number of layers in each bevel. The default is 3. */
	bevelSegments?: number;
	/**
	 * A 3D curve to extrude along in place of +Z. The shape's x follows the curve's normals and
	 * its y the binormals. A closed `CatmullRomCurve3` gives closed frames.
	 */
	extrudePath?: Curve<[number, number, number]>;
	/** Makes the texture coordinates. The default is `WorldUVGenerator`. */
	UVGenerator?: UVGenerator;
}

/**
 * The arrays of an extruded shape, like three.js's `ExtrudeGeometry`. The mesh has no indices:
 * each three vertices in a row make a triangle. Its normals are flat, one per face.
 *
 * three.js puts the caps in one group and the side walls in another, so each can take its own
 * material. Here they form one mesh, caps first. A material per group needs two meshes.
 *
 * @category api/geometry
 */
export function extrude(options: ExtrudeOptions = {}): GeneratedArrays {
	const {
		shapes = new Shape([
			[0.5, 0.5],
			[-0.5, 0.5],
			[-0.5, -0.5],
			[0.5, -0.5],
		]),
	} = options;
	const list: readonly Shape[] = Array.isArray(shapes) ? shapes : [shapes as Shape];
	const verticesArray: number[] = [];
	const uvArray: number[] = [];
	for (const item of list) addShape(item, options, verticesArray, uvArray);
	const positions = new Float32Array(verticesArray);
	return { positions, normals: faceNormals(positions), uvs: new Float32Array(uvArray) };
}

// Adds one shape's caps and side walls to the arrays, as three.js's addShape does.
function addShape(
	shape: Shape,
	options: ExtrudeOptions,
	verticesArray: number[],
	uvArray: number[],
): void {
	const placeholder: number[] = [];
	const {
		curveSegments = 12,
		steps = 1,
		depth = 1,
		extrudePath,
		UVGenerator: uvgen = WorldUVGenerator,
	} = options;
	let {
		bevelEnabled = true,
		bevelThickness = 0.2,
		bevelSize = bevelThickness - 0.1,
		bevelOffset = 0,
		bevelSegments = 3,
	} = options;

	let extrudePts: Tuple3[] = [];
	let extrudeByPath = false;
	let frameNormals: Tuple3[] = [];
	let frameBinormals: Tuple3[] = [];
	if (extrudePath) {
		extrudePts = extrudePath.getSpacedPoints(steps);
		extrudeByPath = true;
		// A path extrusion has no bevel.
		bevelEnabled = false;
		const isClosed = extrudePath instanceof CatmullRomCurve3 ? extrudePath.closed : false;
		const frames = extrudePath.computeFrenetFrames(steps, isClosed);
		frameNormals = frames.normals;
		frameBinormals = frames.binormals;
	}
	if (!bevelEnabled) {
		bevelSegments = 0;
		bevelThickness = 0;
		bevelSize = 0;
		bevelOffset = 0;
	}

	const shapePoints = shape.extractPoints(curveSegments);
	let vertices: Tuple2[] = shapePoints.shape;
	const holes: Tuple2[][] = shapePoints.holes;
	const reverse = !isClockWise(vertices);
	if (reverse) {
		vertices = vertices.reverse();
		for (let h = 0, hl = holes.length; h < hl; h++) {
			const ahole = holes[h] as Tuple2[];
			if (isClockWise(ahole)) holes[h] = ahole.reverse();
		}
	}
	mergeOverlappingPoints(vertices);
	for (const hole of holes) mergeOverlappingPoints(hole);
	const numHoles = holes.length;
	// The outline's points. `vertices` gets the holes' points after them.
	const contour = vertices;
	for (let h = 0; h < numHoles; h++) {
		vertices = vertices.concat(holes[h] as Tuple2[]);
	}
	const vlen = vertices.length;

	const contourMovements: Tuple2[] = [];
	for (let i = 0, il = contour.length, j = il - 1, k = i + 1; i < il; i++, j++, k++) {
		if (j === il) j = 0;
		if (k === il) k = 0;
		contourMovements[i] = getBevelVec(
			contour[i] as Tuple2,
			contour[j] as Tuple2,
			contour[k] as Tuple2,
		);
	}
	const holesMovements: Tuple2[][] = [];
	let verticesMovements = contourMovements.concat();
	for (let h = 0; h < numHoles; h++) {
		const ahole = holes[h] as Tuple2[];
		const oneHoleMovements: Tuple2[] = [];
		for (let i = 0, il = ahole.length, j = il - 1, k = i + 1; i < il; i++, j++, k++) {
			if (j === il) j = 0;
			if (k === il) k = 0;
			oneHoleMovements[i] = getBevelVec(ahole[i] as Tuple2, ahole[j] as Tuple2, ahole[k] as Tuple2);
		}
		holesMovements.push(oneHoleMovements);
		verticesMovements = verticesMovements.concat(oneHoleMovements);
	}

	const v = (x: number, y: number, z: number): void => {
		placeholder.push(x, y, z);
	};

	let faces: Tuple3[];
	if (bevelSegments === 0) {
		faces = triangulateShape(contour, holes);
	} else {
		const contractedContourVertices: Tuple2[] = [];
		const expandedHoleVertices: Tuple2[][] = [];
		// The back bevel's layers, from the outermost in.
		for (let b = 0; b < bevelSegments; b++) {
			const t = b / bevelSegments;
			const z = bevelThickness * Math.cos((t * Math.PI) / 2);
			const bs = bevelSize * Math.sin((t * Math.PI) / 2) + bevelOffset;
			for (let i = 0, il = contour.length; i < il; i++) {
				const vert = scalePt2(contour[i] as Tuple2, contourMovements[i] as Tuple2, bs);
				v(vert[0], vert[1], -z);
				if (t === 0) contractedContourVertices.push(vert);
			}
			for (let h = 0; h < numHoles; h++) {
				const ahole = holes[h] as Tuple2[];
				const oneHoleMovements = holesMovements[h] as Tuple2[];
				const oneHoleVertices: Tuple2[] = [];
				for (let i = 0, il = ahole.length; i < il; i++) {
					const vert = scalePt2(ahole[i] as Tuple2, oneHoleMovements[i] as Tuple2, bs);
					v(vert[0], vert[1], -z);
					if (t === 0) oneHoleVertices.push(vert);
				}
				if (t === 0) expandedHoleVertices.push(oneHoleVertices);
			}
		}
		faces = triangulateShape(contractedContourVertices, expandedHoleVertices);
	}
	const flen = faces.length;
	const bs = bevelSize + bevelOffset;

	// One layer of the shape at a step: at z along +Z, or on the path's frame.
	const layer = (s: number, z: number): void => {
		for (let i = 0; i < vlen; i++) {
			const vert = bevelEnabled
				? scalePt2(vertices[i] as Tuple2, verticesMovements[i] as Tuple2, bs)
				: (vertices[i] as Tuple2);
			if (!extrudeByPath) {
				v(vert[0], vert[1], z);
			} else {
				const n = frameNormals[s] as Tuple3;
				const bn = frameBinormals[s] as Tuple3;
				const p = extrudePts[s] as Tuple3;
				const nx = n[0] * vert[0];
				const ny = n[1] * vert[0];
				const nz = n[2] * vert[0];
				const bx = bn[0] * vert[1];
				const by = bn[1] * vert[1];
				const bz = bn[2] * vert[1];
				v(p[0] + nx + bx, p[1] + ny + by, p[2] + nz + bz);
			}
		}
	};
	// The back cap's layer, then each step up to the front cap's layer.
	layer(0, 0);
	for (let s = 1; s <= steps; s++) layer(s, (depth / steps) * s);

	// The front bevel's layers, from the innermost out.
	for (let b = bevelSegments - 1; b >= 0; b--) {
		const t = b / bevelSegments;
		const z = bevelThickness * Math.cos((t * Math.PI) / 2);
		const bsb = bevelSize * Math.sin((t * Math.PI) / 2) + bevelOffset;
		for (let i = 0, il = contour.length; i < il; i++) {
			const vert = scalePt2(contour[i] as Tuple2, contourMovements[i] as Tuple2, bsb);
			v(vert[0], vert[1], depth + z);
		}
		for (let h = 0, hl = holes.length; h < hl; h++) {
			const ahole = holes[h] as Tuple2[];
			const oneHoleMovements = holesMovements[h] as Tuple2[];
			for (let i = 0, il = ahole.length; i < il; i++) {
				const vert = scalePt2(ahole[i] as Tuple2, oneHoleMovements[i] as Tuple2, bsb);
				v(vert[0], vert[1], depth + z);
			}
		}
	}

	const addVertex = (index: number): void => {
		verticesArray.push(
			placeholder[index * 3] as number,
			placeholder[index * 3 + 1] as number,
			placeholder[index * 3 + 2] as number,
		);
	};
	const addUV = (uv: Vec2Like): void => {
		uvArray.push(uv[0] as number, uv[1] as number);
	};
	const f3 = (a: number, b: number, c: number): void => {
		addVertex(a);
		addVertex(b);
		addVertex(c);
		const nextIndex = verticesArray.length / 3;
		const uvs = uvgen.generateTopUV(verticesArray, nextIndex - 3, nextIndex - 2, nextIndex - 1);
		addUV(uvs[0] as Vec2Like);
		addUV(uvs[1] as Vec2Like);
		addUV(uvs[2] as Vec2Like);
	};
	const f4 = (a: number, b: number, c: number, d: number): void => {
		addVertex(a);
		addVertex(b);
		addVertex(d);
		addVertex(b);
		addVertex(c);
		addVertex(d);
		const nextIndex = verticesArray.length / 3;
		const uvs = uvgen.generateSideWallUV(
			verticesArray,
			nextIndex - 6,
			nextIndex - 3,
			nextIndex - 2,
			nextIndex - 1,
		);
		addUV(uvs[0] as Vec2Like);
		addUV(uvs[1] as Vec2Like);
		addUV(uvs[3] as Vec2Like);
		addUV(uvs[1] as Vec2Like);
		addUV(uvs[2] as Vec2Like);
		addUV(uvs[3] as Vec2Like);
	};

	// The caps: the back cap faces -Z and the front cap +Z.
	const backOffset = 0;
	const frontOffset = vlen * (bevelEnabled ? steps + bevelSegments * 2 : steps);
	for (let i = 0; i < flen; i++) {
		const face = faces[i] as Tuple3;
		f3(face[2] + backOffset, face[1] + backOffset, face[0] + backOffset);
	}
	for (let i = 0; i < flen; i++) {
		const face = faces[i] as Tuple3;
		f3(face[0] + frontOffset, face[1] + frontOffset, face[2] + frontOffset);
	}

	// The side walls of the outline, then of each hole.
	const sidewalls = (ring: readonly Tuple2[], layeroffset: number): void => {
		let i = ring.length;
		while (--i >= 0) {
			const j = i;
			let k = i - 1;
			if (k < 0) k = ring.length - 1;
			for (let s = 0, sl = steps + bevelSegments * 2; s < sl; s++) {
				const slen1 = vlen * s;
				const slen2 = vlen * (s + 1);
				f4(
					layeroffset + j + slen1,
					layeroffset + k + slen1,
					layeroffset + k + slen2,
					layeroffset + j + slen2,
				);
			}
		}
	};
	let layeroffset = 0;
	sidewalls(contour, layeroffset);
	layeroffset += contour.length;
	for (const ahole of holes) {
		sidewalls(ahole, layeroffset);
		layeroffset += ahole.length;
	}
}

// Removes points that lie on the point before them, within a tolerance scaled to their size. The
// list wraps, so the last point is checked against the first.
function mergeOverlappingPoints(points: Tuple2[]): void {
	const THRESHOLD = 1e-10;
	const THRESHOLD_SQ = THRESHOLD * THRESHOLD;
	let prevPos = points[0] as Tuple2;
	for (let i = 1; i <= points.length; i++) {
		const currentIndex = i % points.length;
		const currentPos = points[currentIndex] as Tuple2;
		const dx = currentPos[0] - prevPos[0];
		const dy = currentPos[1] - prevPos[1];
		const distSq = dx * dx + dy * dy;
		const scalingFactorSqrt = Math.max(
			Math.abs(currentPos[0]),
			Math.abs(currentPos[1]),
			Math.abs(prevPos[0]),
			Math.abs(prevPos[1]),
		);
		const thresholdSqScaled = THRESHOLD_SQ * scalingFactorSqrt * scalingFactorSqrt;
		if (distSq <= thresholdSqScaled) {
			points.splice(currentIndex, 1);
			i--;
			continue;
		}
		prevPos = currentPos;
	}
}

// A point moved along a bevel direction by a distance.
function scalePt2(pt: Tuple2, vec: Tuple2, size: number): Tuple2 {
	return [pt[0] + vec[0] * size, pt[1] + vec[1] * size];
}

// The direction in which a bevel moves a point of a clockwise outline: toward the left, out of
// the shape. It is where the two edges' parallels at distance 1 meet. Sharp corners would give
// long spikes, so a long direction shrinks.
function getBevelVec(inPt: Tuple2, inPrev: Tuple2, inNext: Tuple2): Tuple2 {
	let vTransX: number;
	let vTransY: number;
	let shrinkBy: number;
	const vPrevX = inPt[0] - inPrev[0];
	const vPrevY = inPt[1] - inPrev[1];
	const vNextX = inNext[0] - inPt[0];
	const vNextY = inNext[1] - inPt[1];
	const vPrevLensq = vPrevX * vPrevX + vPrevY * vPrevY;
	const collinear0 = vPrevX * vNextY - vPrevY * vNextX;
	if (Math.abs(collinear0) > Number.EPSILON) {
		// The edges are not collinear.
		const vPrevLen = Math.sqrt(vPrevLensq);
		const vNextLen = Math.sqrt(vNextX * vNextX + vNextY * vNextY);
		const ptPrevShiftX = inPrev[0] - vPrevY / vPrevLen;
		const ptPrevShiftY = inPrev[1] + vPrevX / vPrevLen;
		const ptNextShiftX = inNext[0] - vNextY / vNextLen;
		const ptNextShiftY = inNext[1] + vNextX / vNextLen;
		const sf =
			((ptNextShiftX - ptPrevShiftX) * vNextY - (ptNextShiftY - ptPrevShiftY) * vNextX) /
			(vPrevX * vNextY - vPrevY * vNextX);
		vTransX = ptPrevShiftX + vPrevX * sf - inPt[0];
		vTransY = ptPrevShiftY + vPrevY * sf - inPt[1];
		const vTransLensq = vTransX * vTransX + vTransY * vTransY;
		if (vTransLensq <= 2) return [vTransX, vTransY];
		shrinkBy = Math.sqrt(vTransLensq / 2);
	} else {
		// The edges are collinear: a straight run, or a spike that turns back.
		let directionEq = false;
		if (vPrevX > Number.EPSILON) {
			if (vNextX > Number.EPSILON) directionEq = true;
		} else if (vPrevX < -Number.EPSILON) {
			if (vNextX < -Number.EPSILON) directionEq = true;
		} else if (Math.sign(vPrevY) === Math.sign(vNextY)) {
			directionEq = true;
		}
		if (directionEq) {
			vTransX = -vPrevY;
			vTransY = vPrevX;
			shrinkBy = Math.sqrt(vPrevLensq);
		} else {
			vTransX = vPrevX;
			vTransY = vPrevY;
			shrinkBy = Math.sqrt(vPrevLensq / 2);
		}
	}
	return [vTransX / shrinkBy, vTransY / shrinkBy];
}
