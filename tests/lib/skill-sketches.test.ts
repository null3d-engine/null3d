import { describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './server.ts';
import {
	runnableSketches,
	SKETCH_DIR,
	type SkillSketch,
	sketchesIn,
	skillSketches,
	writeSketches,
} from './skill-sketches.ts';

const MARKDOWN = `# Recipes

## 1. A cube

\`\`\`ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene }) => {
  scene.setActiveCamera(scene.createPerspectiveCamera());
});
\`\`\`

## 2. A fragment

\`\`\`ts
cube.rotateY(dt);
\`\`\`

## 3. Models (0.2)

\`\`\`ts
export default defineSketch(async ({ assets }) => {
  await assets.loadGltf('/ship.glb');
});
\`\`\`

## 4. Controls (\`api/controls\`, later in 0.1)

\`\`\`sh
# not a heading
\`\`\`

\`\`\`typescript
export default defineSketch(() => {});
\`\`\`
`;

describe('sketchesIn', () => {
	const sketches = sketchesIn('skills/demo/recipes.md', MARKDOWN);

	test('finds the code blocks that export a sketch, with their headings and lines', () => {
		expect(sketches.map(({ heading, line }) => [heading, line])).toEqual([
			['1. A cube', 6],
			['3. Models (0.2)', 22],
			['4. Controls (`api/controls`, later in 0.1)', 34],
		]);
		expect(sketches[0]?.code).toStartWith("import { defineSketch } from '@null3d/engine';\n");
	});

	test('marks the sketches whose headings name parts that are not built yet, and those that pick a camera', () => {
		expect(sketches.map(({ later, draws }) => [later, draws])).toEqual([
			[undefined, true],
			[undefined, false],
			['`api/controls`, later in 0.1', false],
		]);
	});

	test('runs a sketch under a heading that names only a roadmap step', () => {
		// The release being built holds steps 0.1, 0.2 and 0.3, so a step's parts are shipped or
		// say "not built yet" themselves. A sketch left out under one would never be checked.
		const later = (heading: string) =>
			sketchesIn(
				'skills/demo/recipes.md',
				`# Recipes\n\n## ${heading}\n\n\`\`\`ts\nexport default defineSketch(() => {});\n\`\`\`\n`,
			)[0]?.later;
		expect(later('20. Fire, smoke and sparks with particles (0.2)')).toBeUndefined();
		expect(later('21. Terrain from a height field (0.2)')).toBeUndefined();
		expect(later('12. Minimap with a second camera (0.2)')).toBeUndefined();
		expect(later('6. The MCP server for agents (0.3, not built yet)')).toBe('0.3, not built yet');
		expect(later('5. Nodes (after 1.0)')).toBe('after 1.0');
		expect(later('7. Ray tracing (later in 1.0)')).toBe('later in 1.0');
	});
});

/**
 * Type checks `sketches` in a fresh folder named `folder`, so the check sees no sketch that the
 * skills no longer hold. Returns each error with the skill file's line in place of the sketch's.
 */
function typeCheck(folder: string, sketches: readonly SkillSketch[]): string[] {
	const dir = join(REPO_ROOT, SKETCH_DIR, folder);
	rmSync(dir, { recursive: true, force: true });
	writeSketches(REPO_ROOT, dir, sketches);
	const run = Bun.spawnSync(['bunx', 'tsc', '-p', dir], { cwd: REPO_ROOT });
	const output = `${run.stdout}${run.stderr}`;
	// Each error names a sketch's file and line, which become the skill file's line.
	const byFile = new Map(sketches.map((sketch) => [`${sketch.name}.ts`, sketch]));
	return output
		.split('\n')
		.filter(Boolean)
		.map((line) =>
			line.replace(/^.*?([a-z0-9-]+\.ts)\((\d+),\d+\)/, (found, file: string, row: string) => {
				const sketch = byFile.get(file);
				return sketch ? `${sketch.file}:${sketch.line + Number(row) - 1}` : found;
			}),
		);
}

test('every sketch that the skills show for this version type checks against the engine', () => {
	const sketches = runnableSketches(REPO_ROOT);
	expect(sketches.length).toBeGreaterThan(0);
	expect(typeCheck('type-check', sketches)).toEqual([]);
}, 120_000);

test('no sketch under a later version is built already', () => {
	// A sketch that type checks against the engine uses only parts that exist, so the tests must
	// run it: the version in its heading is stale, and the sketch has no guard while it stays.
	const later = skillSketches(REPO_ROOT).filter((sketch) => sketch.later !== undefined);
	if (later.length === 0) return;
	const errors = typeCheck('type-check-later', later);
	const fails = (sketch: SkillSketch) => {
		const last = sketch.line + sketch.code.split('\n').length - 1;
		return errors.some((error) => {
			const [file, row] = error.split(':');
			return file === sketch.file && Number(row) >= sketch.line && Number(row) < last;
		});
	};
	const built = later
		.filter((sketch) => !fails(sketch))
		.map((sketch) => `${sketch.file}:${sketch.line} "${sketch.heading}"`);
	expect(built).toEqual([]);
}, 120_000);
