// Prints the model's figures as Markdown tables: the camera pass per kind and per slot count, the
// shadow cascades, and occlusion at each grain. Figures are means over the views, in millions of
// triangles. `bun summarize.ts <model.json> [--interval 3]`.
import { readFileSync } from 'node:fs';

const [path, ...rest] = process.argv.slice(2);
const interval = Number(rest[rest.indexOf('--interval') + 1] ?? 3) || 3;
const r = JSON.parse(readFileSync(path, 'utf8'));
const S: Record<string, { mean: number; median: number }> = r.summary;
const get = (k: string) => S[k]?.mean ?? 0;
const M = (v: number) => (v / 1e6).toFixed(2);
const pct = (a: number, b: number) => (b > 0 ? `${((100 * a) / b).toFixed(0)}%` : '-');
const kinds = [
	...new Set(
		Object.keys(S)
			.filter((k) => k.startsWith('camera.all.'))
			.map((k) => k.split('.')[2]),
	),
];
const sizes: number[] = r.sizes;
const ks: number[] = r.ks;
const globalKs: number[] = r.globalKs ?? [];
const lines: string[] = [];
const out = (s = '') => lines.push(s);

out(`## ${r.name}: ${r.views} views, means`);
out();
out('### Camera pass, all copies');
out();
for (const size of sizes) {
	out(`Groups of ${size}:`);
	out();
	out(
		'| Kind | Now | Off screen | Facing away | Hidden (full depth) | Hidden (D-40 occluders) | With groups, no hidden | With groups and hidden |',
	);
	out('| --- | --- | --- | --- | --- | --- | --- | --- |');
	const tot = { now: 0, off: 0, face: 0, hf: 0, hd: 0 };
	for (const kind of kinds) {
		const p = `camera.all.${kind}`;
		const now = get(`${p}.now`);
		const off = get(`${p}.g${size}.offscreen`);
		const face = get(`${p}.g${size}.facing`);
		const hf = get(`${p}.g${size}.hiddenFull`);
		const hd = get(`${p}.g${size}.hiddenD40`);
		tot.now += now;
		tot.off += off;
		tot.face += face;
		tot.hf += hf;
		tot.hd += hd;
		out(
			`| ${kind} | ${M(now)} | ${M(off)} | ${M(face)} | ${M(hf)} | ${M(hd)} | ${M(now - off - face)} | ${M(now - off - face - hf)} |`,
		);
	}
	out(
		`| all | ${M(tot.now)} | ${M(tot.off)} | ${M(tot.face)} | ${M(tot.hf)} | ${M(tot.hd)} | ${M(tot.now - tot.off - tot.face)} | ${M(tot.now - tot.off - tot.face - tot.hf)} |`,
	);
	out();
}

const slotRows = (
	pass: string,
	label: string,
	list: number[],
	prefix: string,
	withHidden: boolean,
) => {
	for (const size of sizes) {
		out(`${label}, groups of ${size}:`);
		out();
		out(
			withHidden
				? '| Slots | Copies with slots | Groups tested | Off screen | Facing away | Hidden (full) | Total after, no hidden | Total after, with hidden |'
				: '| Slots | Copies with slots | Groups tested | Off screen | Total after |',
		);
		out(
			withHidden
				? '| --- | --- | --- | --- | --- | --- | --- | --- |'
				: '| --- | --- | --- | --- | --- |',
		);
		const now = kinds.reduce((s, k) => s + get(`${pass}.all.${k}.now`), 0);
		for (const k of list) {
			let copies = 0;
			let tested = 0;
			let off = 0;
			let face = 0;
			let hf = 0;
			for (const kind of kinds) {
				const p = `${pass}.${prefix}${k}.${kind}`;
				copies += get(`${p}.copies`);
				tested += get(`${p}.g${size}.tested`);
				off += get(`${p}.g${size}.offscreen`);
				face += get(`${p}.g${size}.facing`);
				hf += get(`${p}.g${size}.hiddenFull`);
			}
			out(
				withHidden
					? `| ${prefix}=${k} | ${copies.toFixed(0)} | ${tested.toFixed(0)} | ${M(off)} | ${M(face)} | ${M(hf)} | ${M(now - off - face)} | ${M(now - off - face - hf)} |`
					: `| ${prefix}=${k} | ${copies.toFixed(0)} | ${tested.toFixed(0)} | ${M(off)} | ${M(now - off)} |`,
			);
		}
		let tested = 0;
		for (const kind of kinds) tested += get(`${pass}.all.${kind}.g${size}.tested`);
		const all = (t: string) => kinds.reduce((s, k) => s + get(`${pass}.all.${k}.g${size}.${t}`), 0);
		out(
			withHidden
				? `| all | ${kinds.reduce((s, k) => s + get(`${pass}.all.${k}.copies`), 0).toFixed(0)} | ${tested.toFixed(0)} | ${M(all('offscreen'))} | ${M(all('facing'))} | ${M(all('hiddenFull'))} | ${M(now - all('offscreen') - all('facing'))} | ${M(now - all('offscreen') - all('facing') - all('hiddenFull'))} |`
				: `| all | ${kinds.reduce((s, k) => s + get(`${pass}.all.${k}.copies`), 0).toFixed(0)} | ${tested.toFixed(0)} | ${M(all('offscreen'))} | ${M(now - all('offscreen'))} |`,
		);
		out();
	}
};
out('### Camera pass, slots for the K heaviest copies of each mesh');
out();
slotRows('camera', 'Camera', ks, 'K', true);
if (globalKs.length > 0) {
	out('### Camera pass, slots for the N heaviest copies of the scene');
	out();
	slotRows('camera', 'Camera', globalKs, 'N', true);
}

out(
	'### Camera pass totals, each choice of slot copies (hidden: full-depth pyramid; D-40 occluders in brackets)',
);
out();
for (const size of sizes) {
	out(`Groups of ${size}:`);
	out();
	out(
		'| Slot copies | Now | Copy and piece occlusion alone (GPU occlusion today) | Groups: view and facing | Groups: view, facing, hidden | Groups, plus copy and piece occlusion for the rest |',
	);
	out('| --- | --- | --- | --- | --- | --- |');
	for (const name of ['all', ...ks.map((k) => `K${k}`), ...globalKs.map((n) => `N${n}`)]) {
		const k = `camera.cfg.${name}.g${size}`;
		out(
			`| ${name} | ${M(get(`${k}.now`))} | ${M(get(`${k}.copyHiddenFullOnly`))} (${M(get(`${k}.copyHiddenD40Only`))}) | ${M(get(`${k}.viewFacing`))} | ${M(get(`${k}.groupHiddenFull`))} (${M(get(`${k}.groupHiddenD40`))}) | ${M(get(`${k}.allHiddenFull`))} (${M(get(`${k}.allHiddenD40`))}) |`,
		);
	}
	out();
}

const cascades = [0, 1, 2, 3].filter((c) => S[`shadow${c}.texel`]);
if (cascades.length > 0) {
	out('### Shadow cascades (casters: whole levels now; groups: box planes only)');
	out();
	out(
		`| Cascade | Texel (m) | Now | Off box, pieces | ${sizes.map((s) => `Off box, ${s}`).join(' | ')} | ${ks.map((k) => `K=${k}, 64`).join(' | ')} |`,
	);
	out(
		`| --- | --- | --- | --- | ${sizes.map(() => '---').join(' | ')} | ${ks.map(() => '---').join(' | ')} |`,
	);
	const perFrame = { now: 0, pieces: 0, sizes: sizes.map(() => 0), ks: ks.map(() => 0) };
	for (const c of cascades) {
		const share = c === 0 ? 1 : 1 / interval;
		const now = kinds.reduce((s, k) => s + get(`shadow${c}.all.${k}.now`), 0);
		const offs = sizes.map((size) =>
			kinds.reduce((s, k) => s + get(`shadow${c}.all.${k}.g${size}.offscreen`), 0),
		);
		const kOffs = ks.map((k) =>
			kinds.reduce((s, kind) => s + get(`shadow${c}.K${k}.${kind}.g64.offscreen`), 0),
		);
		const pieces = kinds.reduce((s, k) => s + get(`shadow${c}.all.${k}.g0.offscreen`), 0);
		perFrame.now += now * share;
		perFrame.pieces += pieces * share;
		for (const [i, v] of offs.entries()) perFrame.sizes[i] += v * share;
		for (const [i, v] of kOffs.entries()) perFrame.ks[i] += v * share;
		out(
			`| ${c} | ${get(`shadow${c}.texel`).toFixed(3)} | ${M(now)} | ${M(pieces)} | ${offs.map(M).join(' | ')} | ${kOffs.map(M).join(' | ')} |`,
		);
	}
	out(
		`| per frame (far cascades every ${interval} frames) | | ${M(perFrame.now)} | ${M(perFrame.pieces)} | ${perFrame.sizes.map(M).join(' | ')} | ${perFrame.ks.map(M).join(' | ')} |`,
	);
	out();
	out('Shadow casters per kind, all cascades per frame:');
	out();
	out('| Kind | Now | Off box, 64 |');
	out('| --- | --- | --- |');
	for (const kind of kinds) {
		let now = 0;
		let off = 0;
		for (const c of cascades) {
			const share = c === 0 ? 1 : 1 / interval;
			now += get(`shadow${c}.all.${kind}.now`) * share;
			off += get(`shadow${c}.all.${kind}.g64.offscreen`) * share;
		}
		out(`| ${kind} | ${M(now)} | ${M(off)} |`);
	}
	out();
}

out('### Occlusion at each grain, camera pass');
out();
out(
	'| Kind | Copies in view | Copies hidden (full / D-40) | Triangles now | Hidden as copies (full / D-40) | Hidden as copies or pieces (full) | Groups that pass view and facing (64) | Of them hidden (full / D-40) |',
);
out('| --- | --- | --- | --- | --- | --- | --- | --- |');
const t = { copies: 0, hcf: 0, hcd: 0, now: 0, tf: 0, td: 0, pf: 0, gv: 0, ghf: 0, ghd: 0 };
for (const kind of kinds) {
	const p = `camera.occlusion.${kind}`;
	const row = {
		copies: get(`${p}.copies`),
		hcf: get(`${p}.copyHiddenFull`),
		hcd: get(`${p}.copyHiddenD40`),
		now: get(`${p}.now`),
		tf: get(`${p}.copyHiddenFullTris`),
		td: get(`${p}.copyHiddenD40Tris`),
		pf: get(`${p}.pieceHiddenFull`),
		gv: get(`camera.all.${kind}.g64.visible`),
		ghf: get(`camera.all.${kind}.g64.hiddenGroupsFull`),
		ghd: get(`camera.all.${kind}.g64.hiddenGroupsD40`),
	};
	for (const key of Object.keys(t) as (keyof typeof t)[]) t[key] += row[key];
	out(
		`| ${kind} | ${row.copies.toFixed(0)} | ${row.hcf.toFixed(0)} / ${row.hcd.toFixed(0)} | ${M(row.now)} | ${M(row.tf)} / ${M(row.td)} | ${M(row.pf)} | ${row.gv.toFixed(0)} | ${pct(row.ghf, row.gv)} / ${pct(row.ghd, row.gv)} |`,
	);
}
out(
	`| all | ${t.copies.toFixed(0)} | ${t.hcf.toFixed(0)} (${pct(t.hcf, t.copies)}) / ${t.hcd.toFixed(0)} (${pct(t.hcd, t.copies)}) | ${M(t.now)} | ${M(t.tf)} (${pct(t.tf, t.now)}) / ${M(t.td)} (${pct(t.td, t.now)}) | ${M(t.pf)} (${pct(t.pf, t.now)}) | ${t.gv.toFixed(0)} | ${pct(t.ghf, t.gv)} / ${pct(t.ghd, t.gv)} |`,
);
out();
const occl = kinds.reduce((s, k) => s + get(`camera.occlusion.${k}.occluderTris`), 0);
out(
	`D-40 occluders (copies spanning at least a sixteenth of the screen): ${kinds.reduce((s, k) => s + get(`camera.occlusion.${k}.occluders`), 0).toFixed(0)} copies, ${M(occl)} M triangles in the occluders' depth pass, plus the ground. Share of the screen covered: ${(100 * get('camera.coveredShare')).toFixed(0)}%.`,
);
console.log(lines.join('\n'));
