// Rewrites the final pass for one diagnostic variant, on a branch that never lands:
//   bun bench/diag-final.ts four-tap   the GSR round back to the bilinear loop of four taps
//   bun bench/diag-final.ts no-loops   no upscale and no sharpening: right at the whole scale only
//   bun bench/diag-final.ts current    the file as the branch holds it
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const file = join(import.meta.dir, '../crates/null3d-shaders/wgsl/final.wgsl');
const variant = process.argv[2];
execFileSync('git', ['checkout', '--', file]);
if (variant === 'current') process.exit(0);
const source = readFileSync(file, 'utf8');
const lines = source.split('\n');
const sharpen = lines.findIndex((line) => line.includes('let sharpen_rounds = select('));
const rounds = lines.findIndex((line) => line.includes('let rounds = select(1u, 0u, whole);'));
const end = lines.findIndex((line, at) => at > rounds && line === '    }');
if (sharpen < 0 || rounds < 0 || end < 0)
	throw new Error('the final pass changed; update the patch');
const fourTap = [
	'    let taps = select(4u, 0u, whole);',
	'    for (var tap = 0u; tap < taps; tap++) {',
	'        let corner = vec2f(f32(tap & 1u), f32(tap >> 1u));',
	'        let weights = mix(1.0 - share, share, corner);',
	'        color += weights.x * weights.y',
	'            * corner_display(min(first + corner, render - 1.0), render, size, light, shade);',
	'    }',
];
const replaced =
	variant === 'four-tap'
		? [...lines.slice(0, rounds), ...fourTap, ...lines.slice(end + 1)]
		: variant === 'no-loops'
			? [...lines.slice(0, sharpen), ...lines.slice(end + 1)]
			: undefined;
if (!replaced) throw new Error(`unknown variant ${variant}`);
writeFileSync(file, replaced.join('\n'));
console.log(`final.wgsl: ${variant}, ${lines.length} lines to ${replaced.length}`);
