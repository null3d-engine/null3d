// Model of the camera view's house-wall triangles at the timed page's pose: each copy culled by
// the view and its level picked as the engine does, then each facing piece culled by view and cone.
const W = process.env.WT as string;
const { HOUSE_KINDS, finish } = await import(`${W}/examples/showcase/island/kit.ts`);
const { LOTS } = await import(`${W}/examples/showcase/island/plan.ts`);
const P = await import(`${W}/packages/engine/levels/pieces.js`);

const eye = [-92, 36, 360];
const target = [-92, 26, 200];
const FOV = (45 * Math.PI) / 180;
const HEIGHT = 900;
const ASPECT = 1600 / 900;
const FAR_ERROR = 0.35;
const kinds = HOUSE_KINDS.map((kind: any, k: number) => {
	const a = finish(kind.walls);
	const positions = Float32Array.from(a.positions);
	const indices = Uint32Array.from(a.indices);
	const copies = LOTS.filter((l: any) => l.kind === k).length;
	const far = finish(kind.farWalls).indices.length / 3;
	return {
		t: indices.length / 3,
		far,
		plan: P.facingPieces(positions, indices, copies),
		positions,
	};
});
const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: number[]) => {
	const l = Math.hypot(a[0], a[1], a[2]);
	return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: number[], b: number[]) => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];
const f = norm(sub(target, eye));
const r = norm(cross(f, [0, 1, 0]));
const u = cross(r, f);
const ty = Math.tan(FOV / 2);
const tx = ty * ASPECT;
const inView = (c: number[], rad: number) => {
	const d = sub(c, eye);
	const z = dot(d, f);
	if (z < -rad) return false;
	return (
		Math.abs(dot(d, u)) - ty * z <= rad / Math.cos(Math.atan(ty)) &&
		Math.abs(dot(d, r)) - tx * z <= rad / Math.cos(Math.atan(tx))
	);
};
let whole = 0;
let kept = 0;
let farTris = 0;
let copiesIn = 0;
let pieced = 0;
for (const lot of LOTS) {
	const kind = kinds[lot.kind];
	// The copy's sphere from its base mesh's positions.
	const cy = Math.cos(lot.yaw);
	const sy = Math.sin(lot.yaw);
	const rot = (v: number[]) => [v[0] * cy + v[2] * sy, v[1], -v[0] * sy + v[2] * cy];
	const at = [lot.x, lot.y, lot.z];
	let reach = 0;
	for (let i = 0; i < kind.positions.length; i += 3)
		reach = Math.max(
			reach,
			Math.hypot(kind.positions[i], kind.positions[i + 1], kind.positions[i + 2]),
		);
	if (!inView(at, reach)) continue;
	const dist = Math.hypot(...sub(at, eye));
	if ((FAR_ERROR * HEIGHT) / (2 * dist * ty) < 1) {
		farTris += kind.far;
		continue;
	}
	copiesIn++;
	whole += kind.t;
	if (!kind.plan) {
		kept += kind.t;
		continue;
	}
	pieced += kind.t;
	const plan = kind.plan;
	for (let p = 0; p < plan.counts.length; p++) {
		const b = plan.bounds.subarray(p * 8, p * 8 + 8);
		const c = rot([b[0], b[1], b[2]]).map((v: number, i: number) => v + at[i]);
		const axis = rot([b[4], b[5], b[6]]);
		if (!inView(c, b[3])) continue;
		const d = sub(c, eye);
		if (b[7] < 1 && dot(d, axis) >= b[7] * Math.hypot(...d) + b[3]) continue;
		kept += plan.counts[p];
	}
}
console.log(
	`${copiesIn} wall copies in view at their base level (${farTris} far-level triangles besides)`,
);
console.log(
	`camera view wall triangles: ${whole} whole, ${kept} with facing pieces, cut ${((1 - kept / whole) * 100).toFixed(1)}%; of the kinds that get pieces, ${pieced} whole, cut ${(((whole - kept) / pieced) * 100).toFixed(1)}%`,
);
