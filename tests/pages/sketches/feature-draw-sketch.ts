// A point cloud that an add-on declares with a feature description, held at 0 seconds: an opaque
// cloud of small discs behind a blended cloud of soft discs. Each draw gives its WGSL, the vertex
// data of one point, its uniforms and the description's frame point and order. The points' colours
// come from the mesh's vertex colours, which the surface function reads, and the disc's edge from a
// uniform. The camera stands still, so every GPU path and thread mode draws the same frame.
import { color, defineFeature, defineSketch, type MeshArrays } from '@null3d/engine';

/** The palette of the points, as sRGB colours, which each cloud takes in turn. */
const PALETTE = ['#e8554e', '#f2c14e', '#5bc27a', '#fafafa', '#b06ce0', '#ff8a3d', '#3dd6d0'];

/** The WGSL of both draws: a soft disc of the point's colour, cut from the point's square. */
const POINTS = /* wgsl */ `
struct Uniforms {
    softness: f32,
    gain: f32,
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let away = length(input.uv - vec2f(0.5)) * 2.0;
    let cover = smoothstep(1.0, 1.0 - material.softness, away);
    s.baseColor = vec3f(0.0);
    s.emissive = input.vertexColor.rgb * (material.gain * cover);
    s.alpha = cover;
    return s;
}
`;

/** A point of a cloud: where it sits, how wide its square is and its sRGB colour. */
interface Point {
	position: readonly [number, number, number];
	size: number;
	color: string;
}

/** One square per point, as the arrays that a draw's vertex format takes. */
function cloudVertices(points: readonly Point[]): MeshArrays {
	const positions = new Float32Array(points.length * 12);
	const normals = new Float32Array(points.length * 12);
	const uvs = new Float32Array(points.length * 8);
	const colors = new Float32Array(points.length * 16);
	const indices = new Uint16Array(points.length * 6);
	const linear = [0, 0, 0];
	points.forEach(({ position: [x, y, z], size, color: hex }, k) => {
		const [r, g, b] = color.fromHex(linear, hex).slice();
		for (let corner = 0; corner < 4; corner++) {
			const v = k * 4 + corner;
			positions.set(
				[x + (corner === 0 || corner === 3 ? -size : size), y + (corner < 2 ? -size : size), z],
				v * 3,
			);
			normals.set([0, 0, 1], v * 3);
			uvs.set([corner === 0 || corner === 3 ? 0 : 1, corner < 2 ? 0 : 1], v * 2);
			colors.set([r as number, g as number, b as number, 1], v * 4);
		}
		indices.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3], k * 6);
	});
	return { positions, normals, uvs, colors, indices };
}

/** A grid of points, `columns` across and `rows` up, each at its own depth and size. */
function grid(
	columns: number,
	rows: number,
	[startX, startY]: readonly [number, number],
	[stepX, stepY]: readonly [number, number],
	depth: (k: number) => number,
	size: (k: number) => number,
	from = 0,
): Point[] {
	const points: Point[] = [];
	for (let y = 0; y < rows; y++)
		for (let x = 0; x < columns; x++) {
			const k = points.length;
			points.push({
				position: [startX + x * stepX, startY + y * stepY, depth(k)],
				size: size(k),
				color: PALETTE[(k + from) % PALETTE.length] as string,
			});
		}
	return points;
}

export default defineSketch(async ({ scene }) => {
	scene.setBackground('#0b0e14');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 40,
			near: 0.1,
			far: 50,
			position: [0, 0, 9],
			target: [0, 0, 0],
		}),
	);
	const behind = defineFeature({
		name: 'points-behind',
		frame: 'opaque',
		kind: 'draw',
		views: ['main'],
	});
	const inFront = defineFeature({
		name: 'points-in-front',
		frame: 'transparent',
		kind: 'draw',
		band: 'normal',
		order: 0,
		views: ['main'],
	});
	// The squares stand face on to the camera, so each point is a disc of its own colour.
	const opaquePoints = grid(
		6,
		4,
		[-2.5, -1.5],
		[1, 1],
		(k) => -2 + (k % 5) * 0.35,
		() => 0.3,
	);
	const blendedPoints = grid(
		5,
		3,
		[-2, -0.9],
		[1.2, 1],
		(k) => 1 + (k % 3) * 0.5,
		() => 0.5,
		2,
	);
	await scene.addFeatureDraw(behind, {
		shader: POINTS,
		vertices: cloudVertices(opaquePoints),
		uniforms: { softness: 0.35, gain: 1.2 },
	});
	await scene.addFeatureDraw(inFront, {
		shader: POINTS,
		vertices: cloudVertices(blendedPoints),
		uniforms: { softness: 1, gain: 1.6 },
		alphaMode: 'blend',
		depthWrite: false,
		doubleSided: true,
	});
});
