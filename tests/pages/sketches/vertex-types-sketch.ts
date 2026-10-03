// Meshes whose attributes are 8-bit and 16-bit integers, for the image test of vertex types, and
// with ?float their float twins: the values that shaders read from the integers, as 32-bit floats.
// The integer meshes must draw the twins' image within one step of 255, on every GPU tier.
//
// The top row shows texture coordinates as colors on eight quads, one per integer type of the
// positions, with the coordinates in another integer type. Plain integers read as whole numbers
// and normalized ones as fractions, so a quad that read them the wrong way would change size or
// color. The bottom row holds two lit spheres with integer normals and vertex colors, which cast
// shadows on the wall behind them, a quad with a normal map and integer tangents, a quad whose map
// reads integer second coordinates, and two quads colored by their joints and weights in a full
// shader, which reads the joints as whole numbers.
import { defineSketch, type MeshArrays, type VertexValues } from '@null3d/engine';
import { texCoordsMaterial } from '@null3d/engine/internal';

const FLOAT = new URL(import.meta.url).searchParams.has('float');

type Integers = Int8Array | Uint8Array | Int16Array | Uint16Array;
type IntegerType = {
	new (values: ArrayLike<number>): Integers;
	readonly BYTES_PER_ELEMENT: number;
};

/** The largest value of an integer type, which a normalized integer divides by. */
const maxOf = (type: IntegerType, signed: boolean) =>
	2 ** (type.BYTES_PER_ELEMENT * 8 - (signed ? 1 : 0)) - 1;

const isSigned = (type: IntegerType) => type === Int8Array || type === Int16Array;

/** Integers of a type, or with ?float the floats that shaders read from them. */
function ints(type: IntegerType, values: readonly number[], normalized: boolean): VertexValues {
	const array = new type(values);
	if (!FLOAT) return { array, normalized };
	const max = normalized ? maxOf(type, isSigned(type)) : 1;
	return Float32Array.from(array, (v) => Math.max(v / max, -1));
}

/** The eight integer types, normalized and plain. */
const TYPES: readonly [IntegerType, boolean][] = [
	[Uint8Array, true],
	[Int8Array, true],
	[Uint16Array, true],
	[Int16Array, true],
	[Uint8Array, false],
	[Int8Array, false],
	[Uint16Array, false],
	[Int16Array, false],
];

const QUAD_INDICES = [0, 1, 2, 0, 2, 3];
/** A unit quad's corners as 0 or 1 along x and y. */
const CORNERS = [0, 0, 1, 0, 1, 1, 0, 1];

/** The values that span a quad in a type: -1 to 1 or 0 to 1 when normalized, else 0 to `plain`. */
function span(type: IntegerType, normalized: boolean, plain: number): [low: number, high: number] {
	if (!normalized) return [0, plain];
	const max = maxOf(type, isSigned(type));
	return [isSigned(type) ? -max : 0, max];
}

/** A quad facing +z with positions and texture coordinates in the given types. */
function quad(position: [IntegerType, boolean], uv: [IntegerType, boolean]): MeshArrays {
	const [low, high] = span(...position, position[0].BYTES_PER_ELEMENT === 1 ? 100 : 1000);
	const [, top] = span(uv[0], uv[1], 1);
	// Each corner's x, then its y and a z of 0.
	const xyz = CORNERS.flatMap((c, k) => (k % 2 ? [c ? high : low, 0] : [c ? high : low]));
	return {
		positions: ints(position[0], xyz, position[1]),
		normals: ints(Int8Array, [0, 0, 127, 0, 0, 127, 0, 0, 127, 0, 0, 127], true),
		uvs: ints(
			uv[0],
			CORNERS.map((c) => (c ? top : 0)),
			uv[1],
		),
		indices: QUAD_INDICES,
	};
}

/** A sphere of radius 1: positions, normals and colors by latitude and longitude. */
function sphere(rows: number, columns: number) {
	const points: number[] = [];
	const colors: number[] = [];
	const indices: number[] = [];
	for (let r = 0; r <= rows; r++)
		for (let c = 0; c <= columns; c++) {
			const [theta, phi] = [(r / rows) * Math.PI, (c / columns) * 2 * Math.PI];
			points.push(
				Math.sin(theta) * Math.cos(phi),
				Math.cos(theta),
				Math.sin(theta) * Math.sin(phi),
			);
			colors.push(0.1 + 0.9 * (c / columns), 0.9 - 0.8 * (r / rows), 0.2);
		}
	for (let r = 0; r < rows; r++)
		for (let c = 0; c < columns; c++) {
			const a = r * (columns + 1) + c;
			const b = a + columns + 1;
			indices.push(a, a + 1, b, a + 1, b + 1, b);
		}
	return { points, colors, indices };
}

const SKIN = /* wgsl */ `
#import null3d::mesh::{InstanceIn, clip_position, find_instance, finish}
#import null3d::vertex::{mesh_position}

struct Varyings {
    @builtin(position) clip: vec4f,
    @location(0) color: vec3f,
}

@vertex
fn vs(@location(0) position: vec3f, @location(6) joints: vec4u, @location(7) weights: vec4f, i: InstanceIn) -> Varyings {
    let color = vec3f(f32(joints.x) / 300.0, weights.x, weights.y + f32(joints.w) / 600.0);
    return Varyings(clip_position(find_instance(i), mesh_position(position)), color);
}

@fragment
fn fs(in: Varyings) -> @location(0) vec4f {
    return finish(in.color, in.clip.xy);
}
`;

export default defineSketch(({ scene, materials, geometry, textures }) => {
	scene.setBackground('#20242a');
	const camera = scene.createPerspectiveCamera({ fov: 40, near: 0.1, far: 50 });
	camera.setPosition(0, 0, 13);
	camera.lookAt(0, 0, 0);
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({
		direction: [-0.4, -0.5, -1],
		color: '#ffffff',
		intensity: 2,
		castShadows: true,
	});
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.4 });

	// Texture coordinates as colors: each type of position, with coordinates of another type.
	const view = texCoordsMaterial(materials);
	for (const [k, type] of TYPES.entries()) {
		const mesh = geometry.fromArrays(quad(type, TYPES[(k + 3) % TYPES.length]!));
		// The quad's corners as shaders read them, which the object's scale fits into one unit.
		const [low, high] = span(...type, type[0].BYTES_PER_ELEMENT === 1 ? 100 : 1000).map((end) =>
			type[1] ? end / maxOf(type[0], isSigned(type[0])) : end,
		) as [number, number];
		const scale = 1 / (high - low);
		scene.createMesh({
			mesh,
			material: view,
			position: [-5.2 + k * 1.3 - low * scale, 1.2 - low * scale, 0],
			scale: [scale, scale, scale],
		});
	}

	// Lit spheres: one of normalized 16-bit positions, 8-bit normals and 8-bit colors, and one of
	// plain 16-bit positions, 16-bit normals and 16-bit colors with alpha.
	const ball = sphere(12, 24);
	const lit = materials.standard({ roughness: 0.4, vertexColors: true });
	const unit = (values: number[], max: number) => values.map((v) => Math.round(v * max));
	const first = geometry.fromArrays({
		positions: ints(Int16Array, unit(ball.points, 32767), true),
		normals: ints(Int8Array, unit(ball.points, 127), true),
		colors: ints(Uint8Array, unit(ball.colors, 255), true),
		indices: ball.indices,
	});
	const second = geometry.fromArrays({
		positions: ints(
			Uint16Array,
			ball.points.map((p) => Math.round((p + 1) * 1000)),
			false,
		),
		normals: ints(Int16Array, unit(ball.points, 32767), true),
		colors: ints(
			Uint16Array,
			unit(
				ball.colors.flatMap((c, k) => (k % 3 === 2 ? [c, 1] : [c])),
				65535,
			),
			true,
		),
		indices: ball.indices,
	});
	const shadows = { castShadows: true, receiveShadows: true };
	scene.createMesh({
		mesh: first,
		material: lit,
		position: [-4.6, -1.4, 0],
		scale: [0.6, 0.6, 0.6],
		...shadows,
	});
	// The plain positions run from 0 to 2,000, so the object's origin sits 0.6 below each axis of
	// the sphere's center, as a glTF node's translation would place it.
	scene.createMesh({
		mesh: second,
		material: lit,
		position: [-3.7, -2, -0.6],
		scale: [6e-4, 6e-4, 6e-4],
		...shadows,
	});
	scene.createMesh({
		mesh: geometry.plane({ width: 12, height: 3 }),
		material: materials.standard({ color: '#9aa4b0' }),
		position: [0, -1.7, -1.2],
		receiveShadows: true,
	});

	// A normal map over plain 8-bit positions, 8-bit tangents and 16-bit texture coordinates.
	const bumps = textures.fromData({
		width: 2,
		height: 2,
		data: Uint8Array.from([
			90, 128, 230, 255, 166, 128, 230, 255, 128, 90, 230, 255, 128, 166, 230, 255,
		]),
		colorSpace: 'linear',
	});
	const plates = quad([Int8Array, false], [Uint16Array, true]);
	scene.createMesh({
		mesh: geometry.fromArrays({
			...plates,
			tangents: ints(
				Int8Array,
				[127, 0, 0, 127, 127, 0, 0, 127, 127, 0, 0, 127, 127, 0, 0, 127],
				true,
			),
		}),
		material: materials.standard({ color: '#d8c8a8', normalMap: bumps }),
		position: [-2.3, -2.1, 0],
		scale: [0.009, 0.009, 0.009],
	});

	// A map that reads plain 8-bit second coordinates, which run the other way to the first.
	const checks = textures.fromData({
		width: 2,
		height: 2,
		data: Uint8Array.from([
			230, 60, 60, 255, 60, 200, 60, 255, 60, 60, 230, 255, 230, 230, 60, 255,
		]),
		uvSet: 1,
	});
	scene.createMesh({
		mesh: geometry.fromArrays({
			...quad([Uint8Array, true], [Uint8Array, true]),
			uvs1: ints(Uint8Array, [1, 1, 0, 1, 0, 0, 1, 0], false),
		}),
		material: materials.unlit({ map: checks }),
		position: [-0.9, -2.1, 0],
		scale: [0.9, 0.9, 0.9],
	});

	// Joints and weights in 8-bit and 16-bit integers, as colors.
	const skin = materials.shader({ wgsl: SKIN });
	const joints = [10, 0, 0, 0, 150, 0, 0, 60, 300, 0, 0, 120, 75, 0, 0, 300];
	const weights = [1, 0, 0, 0, 0.5, 0.5, 0, 0, 0.25, 0.75, 0, 0, 0, 1, 0, 0];
	for (const [k, [joint, weight]] of (
		[
			[Uint8Array, Uint8Array],
			[Uint16Array, Uint16Array],
		] as const
	).entries()) {
		const max = maxOf(weight, false);
		const indices = joint === Uint8Array ? joints.map((j) => j % 256) : joints;
		scene.createMesh({
			mesh: geometry.fromArrays({
				...quad([Uint16Array, false], [Uint8Array, true]),
				joints: FLOAT ? indices : new joint(indices),
				weights: ints(weight, unit(weights, max), true),
			}),
			material: skin,
			position: [0.5 + k * 1.4, -2.1, 0],
			scale: [9e-4, 9e-4, 9e-4],
		});
	}
});
