// The rain of the clear coat and sheen demo (sketch.ts): faint streaks around the plinth that a
// vertex offset drops through the air, each at its own pace, so the sketch never moves them. Each
// streak adds its light to the scene and fades out at both ends, as a falling drop blurs.
import { math, type SketchContext } from '@null3d/engine';

const STREAKS = 2400;
/** The height that the rain falls from, and each streak's length, in meters. */
const [HEIGHT, LENGTH] = [6, 0.3];

/**
 * Each streak falls as one piece: the first texture coordinate holds its pace, the second how far
 * along the streak the vertex is. Its top wraps from the floor back to the top of the air.
 */
const falling = /* wgsl */ `
fn vertexOffset(input: VertexInput) -> vec3f {
    let base = input.position.y - input.uv.y * 0.3;
    let fallen = fract((base - frame.time * (6.0 + input.uv.x * 3.0)) / 5.7) * 5.7;
    return vec3f(-0.08 * (fallen - base), fallen - base, 0.0);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.alpha = sin(input.uv.y * 3.14159) * (0.25 + 0.35 * input.uv.x);
    return s;
}
`;

/** Adds the rain: streaks of two crossed strips each, outside the plinth and before the curtain. */
export function createRain(ctx: SketchContext): void {
	const [positions, uvs, indices] = [[], [], []] as number[][];
	math.seed(11);
	for (let k = 0; k < STREAKS; k++) {
		const [x, z] = [math.randFloat(-7, 7), math.randFloat(-3, 7)];
		if (Math.hypot(x, z) < 2.3) continue;
		const [y, pace, w] = [math.randFloat(0, HEIGHT - LENGTH), math.random(), 0.003];
		for (const [dx, dz] of [
			[w, 0],
			[0, w],
		] as const) {
			const first = positions.length / 3;
			positions.push(
				x - dx,
				y,
				z - dz,
				x + dx,
				y,
				z + dz,
				x + dx - 0.024,
				y + LENGTH,
				z + dz,
				x - dx - 0.024,
				y + LENGTH,
				z - dz,
			);
			uvs.push(pace, 0, pace, 0, pace, 1, pace, 1);
			indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
		}
	}
	ctx.scene.createMesh({
		mesh: ctx.geometry.fromArrays({
			positions: new Float32Array(positions),
			uvs: new Float32Array(uvs),
			indices: new Uint32Array(indices),
			computeNormals: true,
		}),
		material: ctx.materials.shader({
			wgsl: falling,
			color: '#6d7c8c',
			roughness: 0.25,
			emissive: '#1a2531',
			doubleSided: true,
			alphaMode: 'blend',
			blending: 'additive',
			depthWrite: false,
			forceSinglePass: true,
		}),
	});
}
