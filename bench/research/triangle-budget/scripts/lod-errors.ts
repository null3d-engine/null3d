// Prints the stored level errors of each node in GLB files, in meters (the node's scale applied),
// for this checkout's file and, with `--base <ref>`, for the same path at that commit.
// Run from the repository's root:
//   bun bench/research/triangle-budget/scripts/lod-errors.ts [--base HEAD] <file.glb>...
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const at = args.indexOf('--base');
const base = at >= 0 ? args[at + 1] : null;
const files = args.filter((a, i) => a !== '--base' && (at < 0 || i !== at + 1));

const json = (bytes: Buffer) =>
	JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
const show = (label: string, bytes: Buffer, file: string) => {
	for (const node of json(bytes).nodes ?? []) {
		const errors = node.extras?.NULL3D_lod_error as number[] | undefined;
		if (!errors) continue;
		const scale = Math.max(...((node.scale as number[] | undefined) ?? [1]).map(Math.abs));
		console.log(
			`${file.split('/').pop()} ${label} ${node.name}: ${errors.map((e) => (e * scale).toFixed(4)).join(' ')} m`,
		);
	}
};
for (const file of files) {
	show('now', readFileSync(file), file);
	if (base)
		show(base, execFileSync('git', ['show', `${base}:${file}`], { maxBuffer: 1 << 28 }), file);
}
