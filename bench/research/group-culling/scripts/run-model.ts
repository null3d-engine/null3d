// Runs the CPU model over a scene's views and gathers its figures: per view, a flat record of named
// numbers; over the views, the mean and the median of each.

import { writeFileSync } from 'node:fs';
import { encode } from '../../../../packages/cli/node_modules/fast-png/lib/index.js';
import {
	type CameraCopy,
	type Copy,
	camera,
	cameraCopies,
	cascades,
	Depth,
	drawCopies,
	heaviest,
	Pyramid,
	shadowCopies,
	testGroups,
	viewVertices,
} from './model.ts';
import { drawTriangles } from './raster.ts';

/** Writes a depth image as a gray PNG, near light and far dark, the sky black. */
function depthPng(path: string, d: Depth): void {
	const out = new Uint8Array(d.width * d.height);
	for (let i = 0; i < out.length; i++) {
		const z = d.data[i];
		out[i] =
			z === Infinity
				? 0
				: Math.max(1, Math.round(255 * (1 - Math.log(1 + z) / Math.log(1 + 1000))));
	}
	writeFileSync(
		path,
		encode({ width: d.width, height: d.height, data: out, channels: 1, depth: 8 }),
	);
}

export interface SceneInput {
	name: string;
	copies: Copy[];
	views: { label: string; eye: number[]; target: number[] }[];
	lens: {
		fovDegrees: number;
		near: number;
		far: number;
		width: number;
		height: number;
		threshold: number;
	};
	sun?: number[];
	shadows?: { count: number; mapSize: number; distance: number; blend: number };
	sizes: number[];
	/** World-space meshes that draw depth but are not counted, such as a ground drawn from its tree. */
	extraDepth?: { positions: ArrayLike<number>; indices: Uint32Array }[];
	/** The slot counts per mesh to report. */
	ks?: number[];
	/** Global slot counts: the N heaviest copies of the whole scene. */
	globalKs?: number[];
	/** A folder to write each view's depth images into. */
	depthImages?: string;
}

type Record_ = Record<string, number>;

const add = (r: Record_, key: string, v: number) => {
	r[key] = (r[key] ?? 0) + v;
};

export function analyse(input: SceneInput) {
	const ks = input.ks ?? [2, 4, 8, 16];
	const globalKs = input.globalKs ?? [];
	const perView: { label: string; figures: Record_; ms: number }[] = [];
	const identity = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
	for (const v of input.views) {
		const started = performance.now();
		const r: Record_ = {};
		const cam = camera(v.eye, v.target, input.lens);
		const list = cameraCopies(input.copies, cam);
		// The frame's depth, and the depth of D-40's occluders alone.
		const full = new Depth(cam.width, cam.height);
		const d40 = new Depth(cam.width, cam.height);
		for (const extra of input.extraDepth ?? []) {
			const verts = new Float64Array(extra.positions.length);
			viewVertices(verts, cam, identity, extra.positions);
			drawTriangles(full, cam, verts, extra.indices, 0, extra.indices.length / 3, true);
			drawTriangles(d40, cam, verts, extra.indices, 0, extra.indices.length / 3, true);
		}
		drawCopies(full, cam, list, () => true);
		drawCopies(d40, cam, list, (c) => c.occluder);
		if (input.depthImages) {
			depthPng(`${input.depthImages}/${input.name}-${v.label}-full.png`, full);
			depthPng(`${input.depthImages}/${input.name}-${v.label}-d40.png`, d40);
		}
		let covered = 0;
		for (const d of full.data) if (d < Infinity) covered++;
		r['camera.coveredShare'] = covered / full.data.length;
		testGroups(list, cam, input.sizes, new Pyramid(full), new Pyramid(d40));

		const tally = (prefix: string, set: Iterable<CameraCopy>) => {
			for (const c of set) {
				const k = `${prefix}.${c.copy.kind}`;
				add(r, `${k}.copies`, 1);
				add(r, `${k}.now`, c.now);
				for (const [size, g] of c.groups)
					for (const [name, v] of Object.entries(g)) add(r, `${k}.g${size}.${name}`, v);
			}
		};
		tally('camera.all', list);
		const weight = (c: CameraCopy) => c.levelTriangles - c.distance * 1e-6;
		const slotSets: [string, Set<CameraCopy>][] = [['all', new Set(list)]];
		for (const k of ks) {
			const set = heaviest(list, k, weight);
			slotSets.push([`K${k}`, set]);
			tally(`camera.K${k}`, set);
		}
		for (const n of globalKs) {
			const set = new Set([...list].sort((a, b) => weight(b) - weight(a)).slice(0, n));
			slotSets.push([`N${n}`, set]);
			tally(`camera.N${n}`, set);
		}
		// The frame's totals for each choice of slot copies: the groups' view and facing tests alone,
		// with their hidden test, and with the hidden test of whole copies and pieces that GPU
		// occlusion already makes, for copies with and without slots.
		for (const [name, set] of slotSets)
			for (const size of input.sizes)
				for (const c of list) {
					const g = c.groups.get(size);
					if (!g) continue;
					const slot = set.has(c);
					const k = `camera.cfg.${name}.g${size}`;
					const seen = slot ? c.now - g.offscreen - g.facing : c.now;
					add(r, `${k}.viewFacing`, seen);
					add(r, `${k}.groupHiddenFull`, slot ? seen - g.hiddenFull : seen);
					add(r, `${k}.groupHiddenD40`, slot ? seen - g.hiddenD40 : seen);
					add(
						r,
						`${k}.allHiddenFull`,
						c.copyHiddenFull ? 0 : slot ? seen - g.hiddenFull : c.now - c.pieceHiddenFull,
					);
					add(
						r,
						`${k}.allHiddenD40`,
						c.copyHiddenD40 ? 0 : slot ? seen - g.hiddenD40 : c.now - c.pieceHiddenD40,
					);
					add(r, `${k}.copyHiddenFullOnly`, c.copyHiddenFull ? 0 : c.now - c.pieceHiddenFull);
					add(r, `${k}.copyHiddenD40Only`, c.copyHiddenD40 ? 0 : c.now - c.pieceHiddenD40);
					add(r, `${k}.now`, c.now);
				}
		for (const c of list) {
			const k = `camera.occlusion.${c.copy.kind}`;
			add(r, `${k}.copies`, 1);
			add(r, `${k}.now`, c.now);
			if (c.copyHiddenFull) {
				add(r, `${k}.copyHiddenFull`, 1);
				add(r, `${k}.copyHiddenFullTris`, c.now);
			}
			if (c.copyHiddenD40) {
				add(r, `${k}.copyHiddenD40`, 1);
				add(r, `${k}.copyHiddenD40Tris`, c.now);
			}
			add(r, `${k}.pieceHiddenFull`, c.copyHiddenFull ? c.now : c.pieceHiddenFull);
			add(r, `${k}.pieceHiddenD40`, c.copyHiddenD40 ? c.now : c.pieceHiddenD40);
			if (c.occluder) {
				add(r, `${k}.occluderTris`, c.now);
				add(r, `${k}.occluders`, 1);
			}
		}

		if (input.sun && input.shadows) {
			const cs = cascades(cam, input.sun, input.shadows);
			cs.forEach((cascade, ci) => {
				r[`shadow${ci}.texel`] = cascade.texel;
				r[`shadow${ci}.radius`] = cascade.radius;
				const sl = shadowCopies(input.copies, cascade, input.sizes, 1);
				const distanceTo = (c: Copy) =>
					Math.hypot(c.center[0] - cam.eye[0], c.center[1] - cam.eye[1], c.center[2] - cam.eye[2]);
				const tallyS = (prefix: string, set: Iterable<(typeof sl)[number]>) => {
					for (const s of set) {
						const k = `${prefix}.${s.copy.kind}`;
						add(r, `${k}.copies`, 1);
						add(r, `${k}.now`, s.now);
						for (const [size, drop] of s.offscreen) add(r, `${k}.g${size}.offscreen`, drop);
						for (const [size, n] of s.tested) add(r, `${k}.g${size}.tested`, n);
					}
				};
				tallyS(`shadow${ci}.all`, sl);
				const w = (s: (typeof sl)[number]) => s.now - distanceTo(s.copy) * 1e-6;
				for (const k of ks) tallyS(`shadow${ci}.K${k}`, heaviest(sl, k, w));
				for (const n of globalKs)
					tallyS(`shadow${ci}.N${n}`, [...sl].sort((a, b) => w(b) - w(a)).slice(0, n));
			});
		}
		const ms = performance.now() - started;
		perView.push({ label: v.label, figures: r, ms });
		const total = (prefix: string) =>
			Object.entries(r)
				.filter(([key]) => key.startsWith(prefix) && key.endsWith('.now'))
				.reduce((s, [, x]) => s + x, 0);
		console.log(
			`${input.name} ${v.label}: camera now ${(total('camera.all.') / 1e6).toFixed(2)} M, shadows ${[0, 1, 2].map((c) => (total(`shadow${c}.all.`) / 1e6).toFixed(2)).join('/')} M, ${(ms / 1000).toFixed(1)} s`,
		);
	}
	const keys = new Set(perView.flatMap((p) => Object.keys(p.figures)));
	const summary: Record<string, { mean: number; median: number }> = {};
	for (const key of keys) {
		const values = perView.map((p) => p.figures[key] ?? 0).sort((a, b) => a - b);
		summary[key] = {
			mean: values.reduce((s, x) => s + x, 0) / values.length,
			median: values[Math.floor(values.length / 2)],
		};
	}
	return {
		name: input.name,
		views: perView.length,
		sizes: input.sizes,
		ks,
		globalKs,
		summary,
		perView,
	};
}
