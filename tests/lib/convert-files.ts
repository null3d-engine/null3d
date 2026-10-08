// The test files of `assets convert`, and its outputs that the image test draws. Blender made the
// FBX and OBJ files with tests/lib/convert-sources.py. The STL and PLY files are made here: a
// pyramid in binary STL with a color on each face, as Materialise writes them, and a cube in
// binary PLY with normals, a color at each corner and texture coordinates.

/** The files, from the repository's root. */
export const CONVERT_FILES = {
	sources: 'tests/pages/assets/models/sources',
	converted: 'tests/pages/assets/models/converted',
	/** Each source and the name of its output in the converted folder. */
	models: [
		['column.fbx', 'column-fbx.glb'],
		['column.obj', 'column-obj.glb'],
		['pyramid.stl', 'pyramid-stl.glb'],
		['cube.ply', 'cube-ply.glb'],
	],
} as const;

/** A 5-bit color channel of Materialise's packed colors, from a byte. */
const five = (byte: number) => Math.round((byte * 31) / 255);

/** The pyramid's faces: its base, two triangles, and its four sides, each with its color. */
const PYRAMID: { corners: [number, number, number][]; color: [number, number, number] }[] = (() => {
	const apex: [number, number, number] = [0, 1, 0];
	const base: [number, number, number][] = [
		[-0.5, 0, -0.5],
		[0.5, 0, -0.5],
		[0.5, 0, 0.5],
		[-0.5, 0, 0.5],
	];
	const at = (i: number) => base[i] as [number, number, number];
	const sides: [number, number, number][] = [
		[220, 70, 50],
		[240, 200, 60],
		[60, 160, 90],
		[70, 110, 220],
	];
	return [
		{ corners: [at(0), at(1), at(2)], color: [200, 200, 200] },
		{ corners: [at(0), at(2), at(3)], color: [200, 200, 200] },
		...[0, 1, 2, 3].map((side) => ({
			corners: [at((side + 1) % 4), at(side), apex] as [number, number, number][],
			color: sides[side] as [number, number, number],
		})),
	];
})();

/** The pyramid as a binary STL file, with the faces' colors. */
export function pyramidStl(): Uint8Array {
	const bytes = new Uint8Array(84 + PYRAMID.length * 50);
	const view = new DataView(bytes.buffer);
	bytes.set(new TextEncoder().encode('null3D test pyramid COLOR='));
	bytes.set([255, 255, 255, 255], 26);
	view.setUint32(80, PYRAMID.length, true);
	PYRAMID.forEach(({ corners, color }, t) => {
		const at = 84 + t * 50;
		for (const [k, v] of corners.flat().entries()) view.setFloat32(at + 12 + k * 4, v, true);
		const [r, g, b] = color.map(five) as [number, number, number];
		view.setUint16(at + 48, r | (g << 5) | (b << 10), true);
	});
	return bytes;
}

/** The cube as a binary PLY file: a vertex at each corner of each face, and the faces as quads. */
export function cubePly(): Uint8Array {
	const faces: { normal: [number, number, number]; corners: [number, number, number][] }[] = [
		{
			normal: [1, 0, 0],
			corners: [
				[1, -1, 1],
				[1, -1, -1],
				[1, 1, -1],
				[1, 1, 1],
			],
		},
		{
			normal: [-1, 0, 0],
			corners: [
				[-1, -1, -1],
				[-1, -1, 1],
				[-1, 1, 1],
				[-1, 1, -1],
			],
		},
		{
			normal: [0, 1, 0],
			corners: [
				[-1, 1, 1],
				[1, 1, 1],
				[1, 1, -1],
				[-1, 1, -1],
			],
		},
		{
			normal: [0, -1, 0],
			corners: [
				[-1, -1, -1],
				[1, -1, -1],
				[1, -1, 1],
				[-1, -1, 1],
			],
		},
		{
			normal: [0, 0, 1],
			corners: [
				[-1, -1, 1],
				[1, -1, 1],
				[1, 1, 1],
				[-1, 1, 1],
			],
		},
		{
			normal: [0, 0, -1],
			corners: [
				[1, -1, -1],
				[-1, -1, -1],
				[-1, 1, -1],
				[1, 1, -1],
			],
		},
	];
	const header = [
		'ply',
		'format binary_little_endian 1.0',
		'comment null3D test cube',
		`element vertex ${faces.length * 4}`,
		...['x', 'y', 'z', 'nx', 'ny', 'nz'].map((name) => `property float ${name}`),
		...['red', 'green', 'blue'].map((name) => `property uchar ${name}`),
		'property float s',
		'property float t',
		`element face ${faces.length}`,
		'property list uchar int vertex_indices',
		'end_header',
		'',
	].join('\n');
	const vertexBytes = 6 * 4 + 3 + 2 * 4;
	const head = new TextEncoder().encode(header);
	const bytes = new Uint8Array(head.length + faces.length * 4 * vertexBytes + faces.length * 17);
	const view = new DataView(bytes.buffer);
	bytes.set(head);
	let at = head.length;
	const uvs = [
		[0, 0],
		[1, 0],
		[1, 1],
		[0, 1],
	];
	for (const { normal, corners } of faces)
		corners.forEach((corner, k) => {
			for (const v of [...corner.map((c) => c * 0.5), ...normal]) {
				view.setFloat32(at, v, true);
				at += 4;
			}
			// Each corner's color follows its place, so the faces show smooth ramps.
			for (const c of corner) bytes[at++] = Math.round((c * 0.5 + 0.5) * 200 + 40);
			for (const v of uvs[k] as number[]) {
				view.setFloat32(at, v, true);
				at += 4;
			}
		});
	faces.forEach((_, f) => {
		bytes[at++] = 4;
		for (let k = 0; k < 4; k++) {
			view.setInt32(at, f * 4 + k, true);
			at += 4;
		}
	});
	return bytes;
}
