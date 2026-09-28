#!/usr/bin/env node
// Scan a three.js project and write a porting inventory for null3d.
//
// Usage:
//   node analyze-threejs.mjs <project-dir> [--md PORTING-INVENTORY.md] [--json porting-inventory.json]
//                            [--mapping path/to/threejs-mapping.json] [--max-refs 5]
//
// The scan is pattern-based (no parser), so it can over-count or miss unusual code. Treat the
// result as a checklist to confirm by reading the code, not as proof. Needs Node.js 18 or newer.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const target = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!target || !existsSync(target)) {
	console.error(
		'Usage: node analyze-threejs.mjs <project-dir> [--md out.md] [--json out.json] [--mapping mapping.json] [--max-refs 5]',
	);
	process.exit(2);
}
const mappingPath = opt('--mapping', join(here, '../references/threejs-mapping.json'));
const mdOut = opt('--md', 'PORTING-INVENTORY.md');
const jsonOut = opt('--json', null);
const maxRefs = Number(opt('--max-refs', '5'));

const mapping = JSON.parse(readFileSync(mappingPath, 'utf8'));
const rules = mapping.entries.map((e) => ({ ...e, re: new RegExp(e.detect, 'g') }));

const EXT = new Set([
	'.js',
	'.mjs',
	'.cjs',
	'.ts',
	'.tsx',
	'.jsx',
	'.mts',
	'.cts',
	'.vue',
	'.svelte',
	'.html',
	'.astro',
]);
const SKIP = new Set([
	'node_modules',
	'.git',
	'dist',
	'build',
	'out',
	'.next',
	'.nuxt',
	'.svelte-kit',
	'coverage',
	'vendor',
	'.turbo',
	'.cache',
	'public/draco',
	'libs',
]);

function walk(dir, files = []) {
	for (const name of readdirSync(dir)) {
		if (SKIP.has(name)) continue;
		const p = join(dir, name);
		let st;
		try {
			st = statSync(p);
		} catch {
			continue;
		}
		if (st.isDirectory()) walk(p, files);
		else if (EXT.has(extname(name)) && st.size < 2_000_000 && !/\.min\.js$/.test(name))
			files.push(p);
	}
	return files;
}

const root = statSync(target).isDirectory() ? target : dirname(target);
const files = statSync(target).isDirectory() ? walk(target) : [target];

// Results per mapping entry
const found = new Map(); // id -> { entry, count, refs: [] }
const imports = new Map(); // module specifier -> count
let totalLines = 0;
let glslLines = 0;
const loopFiles = new Set();
const mathAllocFiles = new Map(); // file -> count
const domFiles = new Set();

const importRe =
	/(?:import\s[^'"]*?from\s*|import\s*\(\s*|require\s*\(\s*)['"]((?:three|@react-three|postprocessing|three-mesh-bvh|troika-three-text|cannon-es|@dimforge|lil-gui|dat\.gui|stats\.js)[^'"]*)['"]/g;

for (const file of files) {
	let text;
	try {
		text = readFileSync(file, 'utf8');
	} catch {
		continue;
	}
	if (!/three|THREE|@react-three|gl_Position|gl_FragColor/.test(text)) continue;
	const rel = relative(root, file) || file;
	const lines = text.split(/\r?\n/);
	totalLines += lines.length;
	for (const m of text.matchAll(importRe)) imports.set(m[1], (imports.get(m[1]) || 0) + 1);

	lines.forEach((line, idx) => {
		const t = line.trim();
		if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
		if (
			/gl_FragColor|gl_Position|gl_FragCoord|texture2D\s*\(|\bvarying\s+\w+|\buniform\s+(float|vec[234]|mat[34]|sampler2D|int|bool)\b/.test(
				line,
			)
		)
			glslLines++;
		for (const r of rules) {
			r.re.lastIndex = 0;
			let n = 0;
			for (let m = r.re.exec(line); m !== null; m = r.re.exec(line)) {
				n++;
				if (m.index === r.re.lastIndex) r.re.lastIndex++;
			}
			if (!n) continue;
			let f = found.get(r.id);
			if (!f) {
				f = { entry: r, count: 0, files: new Set(), refs: [] };
				found.set(r.id, f);
			}
			f.count += n;
			f.files.add(rel);
			if (f.refs.length < maxRefs) f.refs.push(`${rel}:${idx + 1}`);
			if (r.id === 'render-loop') loopFiles.add(rel);
			if (r.id === 'math-objects') mathAllocFiles.set(rel, (mathAllocFiles.get(rel) || 0) + n);
			if (r.id === 'dom-access') domFiles.add(rel);
		}
	});
}

const order = ['manual', 'unsupported', 'post-1.0', 'changed', 'direct'];
const byStatus = Object.fromEntries(order.map((s) => [s, []]));
for (const f of found.values()) byStatus[f.entry.status].push(f);
for (const s of order) byStatus[s].sort((a, b) => b.count - a.count);

const sinceOrder = ['0.1', '0.2', '0.3', '1.0'];
const needed =
	[...found.values()]
		.map((f) => f.entry.since)
		.filter(Boolean)
		.sort((a, b) => sinceOrder.indexOf(b) - sinceOrder.indexOf(a))[0] || '0.1';

// Rough effort: distinct features weighted by status, plus GLSL volume. A planning aid only.
const weight = { direct: 1, changed: 2, manual: 5, 'post-1.0': 3, unsupported: 3 };
const points =
	[...found.values()].reduce((s, f) => s + weight[f.entry.status], 0) + Math.ceil(glslLines / 20);
const effort = points < 25 ? 'small' : points < 70 ? 'medium' : 'large';

let threeVersion = null;
for (const dir of [root, dirname(root)]) {
	const pj = join(dir, 'package.json');
	if (existsSync(pj)) {
		try {
			const p = JSON.parse(readFileSync(pj, 'utf8'));
			threeVersion =
				p.dependencies?.three || p.devDependencies?.three || p.peerDependencies?.three || null;
			if (threeVersion) break;
		} catch {
			/* ignore */
		}
	}
}

const warnings = [];
for (const [file, n] of mathAllocFiles) {
	if (loopFiles.has(file))
		warnings.push(
			`${file}: ${n} three.js math allocations in a file that also runs the render loop. Check that none run every frame; per-frame allocations must become scratch arrays created once.`,
		);
}
if (domFiles.size)
	warnings.push(
		`DOM access in ${[...domFiles].join(', ')}. The game worker has no DOM: keep this code in page.ts and pass data with messages.`,
	);
if (glslLines)
	warnings.push(
		`About ${glslLines} lines of GLSL. Every shader must be rewritten in WGSL (references/shaders.md).`,
	);
if (found.has('r3f'))
	warnings.push(
		'React Three Fiber detected: follow references/react-three-fiber.md before porting components one by one.',
	);
if (!found.size)
	warnings.push(
		'No three.js usage found. Check the path, or whether the code is minified or bundled.',
	);

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');
const md = [];
md.push('# Porting inventory: three.js to null3d\n');
md.push(
	`Generated by analyze-threejs.mjs on ${new Date().toISOString().slice(0, 10)}. The scan matches text patterns, so confirm each item by reading the code.\n`,
);
md.push('## Summary\n');
md.push(`- Files scanned: ${files.length} (${totalLines} lines in files that mention three.js)`);
md.push(`- three.js version in package.json: ${threeVersion ?? 'not found'}`);
md.push(`- Distinct three.js features found: ${found.size}`);
md.push(`- By status: ${order.map((s) => `${s} ${byStatus[s].length}`).join(', ')}`);
md.push(`- Lowest null3d version that covers every supported feature found: ${needed}`);
md.push(
	`- Rough porting effort: ${effort} (${points} points; a planning aid, not an estimate of hours)\n`,
);
if (imports.size) {
	md.push('## Modules imported\n');
	md.push('| Module | Imports |');
	md.push('| --- | --- |');
	for (const [k, v] of [...imports.entries()].sort((a, b) => b[1] - a[1])) {
		md.push(`| \`${k}\` | ${v} |`);
	}
	md.push('');
}
if (warnings.length) {
	md.push('## Warnings\n');
	for (const w of warnings) md.push(`- ${w}`);
	md.push('');
}
const titles = {
	manual: 'Rewrite by hand',
	unsupported: 'Out of scope: use the workaround',
	'post-1.0': 'Not in null3d 1.0: use the workaround',
	changed: 'Supported with a different API or pattern',
	direct: 'Direct equivalents',
};
for (const s of order) {
	if (!byStatus[s].length) continue;
	md.push(`## ${titles[s]} (${byStatus[s].length})\n`);
	md.push('| three.js | Uses | Where (first matches) | null3d | Since | Notes | Docs |');
	md.push('| --- | --- | --- | --- | --- | --- | --- |');
	for (const f of byStatus[s]) {
		const e = f.entry;
		md.push(
			`| ${esc(e.three)} | ${f.count} in ${f.files.size} file(s) | ${f.refs.map((r) => `\`${r}\``).join('<br>')} | ${esc(e.target)} | ${e.since ?? '-'} | ${esc(e.notes)} | \`${e.docs}\` |`,
		);
	}
	md.push('');
}
md.push('## Next steps\n');
md.push('1. Record baseline images and timings of the three.js app (references/verification.md).');
md.push(
	'2. Decide what stays on the page and what moves to game.ts (references/architecture-and-loop.md).',
);
md.push(
	'3. Port in this order: scene setup, assets, materials, lights, interaction, animation, post-processing, shaders.',
);
md.push('4. After each step, compare parity images and tick the rows above.');

writeFileSync(mdOut, `${md.join('\n')}\n`);
if (jsonOut) {
	const out = {
		generated: new Date().toISOString(),
		filesScanned: files.length,
		totalLines,
		threeVersion,
		glslLines,
		neededEngineVersion: needed,
		effort,
		points,
		warnings,
		imports: Object.fromEntries(imports),
		features: [...found.values()].map((f) => ({
			id: f.entry.id,
			three: f.entry.three,
			status: f.entry.status,
			since: f.entry.since,
			count: f.count,
			files: [...f.files],
			refs: f.refs,
			target: f.entry.target,
			docs: f.entry.docs,
		})),
	};
	writeFileSync(jsonOut, `${JSON.stringify(out, null, 2)}\n`);
}
console.log(
	`Scanned ${files.length} files: ${found.size} three.js features (${order.map((s) => `${s} ${byStatus[s].length}`).join(', ')}). Effort: ${effort}. Needs null3d ${needed}. Wrote ${mdOut}${jsonOut ? ` and ${jsonOut}` : ''}.`,
);
