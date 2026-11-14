// Shows in which units meshoptimizer's simplifier weighs vertex attributes. The same bumpy sphere
// is simplified at two sizes, with and without its normals in the error, with absolute errors. If
// the weights applied in the units of the positions, the normals' share of the error would shrink
// as the mesh grows. If they apply after the simplifier scales the mesh into a unit box, the error
// grows with the mesh at the same rate with and without the normals.
// Run from the repository's root: bun bench/research/triangle-budget/scripts/weight-units.ts
import { MeshoptSimplifier as S } from '../../../../packages/cli/node_modules/meshoptimizer/index.js';

await S.ready;
const N = 64;
const M = 128;
const pos: number[] = [];
const nrm: number[] = [];
const idx: number[] = [];
for (let i = 0; i <= N; i++)
	for (let j = 0; j <= M; j++) {
		const th = (i / N) * Math.PI;
		const ph = (j / M) * 2 * Math.PI;
		const r = 1 + 0.05 * Math.sin(7 * th) * Math.cos(5 * ph);
		const x = Math.sin(th) * Math.cos(ph);
		const y = Math.cos(th);
		const z = Math.sin(th) * Math.sin(ph);
		pos.push(r * x, r * y, r * z);
		// Normals that turn from vertex to vertex, so that their share of the error shows.
		const t = 0.3 * Math.sin(37 * th + 11 * ph);
		nrm.push(x + t, y - t, z + 0.5 * t);
	}
for (let i = 0; i < N; i++)
	for (let j = 0; j < M; j++) {
		const a = i * (M + 1) + j;
		const b = a + M + 1;
		idx.push(a, b, a + 1, a + 1, b, b + 1);
	}
const I = new Uint32Array(idx);
for (const s of [1, 1000, 16383]) {
	const P = new Float32Array(pos.map((v) => v * s));
	const A = new Float32Array(nrm);
	for (const w of [0, 1]) {
		const [out, err] = S.simplifyWithAttributes(
			I,
			P,
			3,
			A,
			3,
			[w, w, w],
			null,
			Math.floor(I.length / 4 / 3) * 3,
			s * 10,
			['ErrorAbsolute', 'Sparse', 'LockBorder'],
		);
		console.log(
			`size ${s}, normal weight ${w}: ${out.length / 3} triangles, error ${err.toPrecision(4)}, as a share of the size ${(err / (2.1 * s)).toPrecision(3)}`,
		);
	}
}

// The level planner's own weights: each normal component at 1, and each texture coordinate at a
// sixty-fourth of the mesh's longest side in the units of its positions. The texture repeats
// twice around the sphere. The same sphere in meters and in the integer steps of a quantized file
// should report the same error as a share of its size.
const uvs: number[] = [];
for (let i = 0; i <= N; i++) for (let j = 0; j <= M; j++) uvs.push((2 * j) / M, i / N);
for (const s of [1, 16383]) {
	const P = new Float32Array(pos.map((v) => v * s));
	const side = 2.1 * s;
	const vertices = (N + 1) * (M + 1);
	const A = new Float32Array(vertices * 5);
	for (let v = 0; v < vertices; v++)
		A.set(
			[
				nrm[v * 3] as number,
				nrm[v * 3 + 1] as number,
				nrm[v * 3 + 2] as number,
				uvs[v * 2] as number,
				uvs[v * 2 + 1] as number,
			],
			v * 5,
		);
	const weights = [1, 1, 1, side / 64, side / 64];
	const [out, err] = S.simplifyWithAttributes(
		I,
		P,
		3,
		A,
		5,
		weights,
		null,
		Math.floor(I.length / 4 / 3) * 3,
		side,
		['ErrorAbsolute', 'Sparse', 'LockBorder'],
	);
	console.log(
		`planner's weights, size ${s}: ${out.length / 3} triangles, error as a share of the size ${(err / side).toPrecision(3)}`,
	);
}
