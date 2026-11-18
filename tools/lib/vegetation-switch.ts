// The vegetation add-on is a work in progress (D-378). No CI job builds, type checks, tests, draws,
// documents or scans it, and the repository's commands leave it out unless its switch is on.
// `bun run test:vegetation` turns the switch on and runs the add-on's checks by hand. This file
// names the add-on's packages and every file outside them that exists only for the add-on, so each
// command reads one list. It uses only Node's own modules, since Playwright loads it under Node.

/** The environment variable that brings the add-on back into the commands, set to `1`. */
export const VEGETATION_SWITCH = 'NULL3D_VEGETATION';

/** Whether the add-on's switch is on. */
export function vegetationOn(
	env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
	return env[VEGETATION_SWITCH] === '1';
}

/** The add-on's package folders under `packages/`. */
export const VEGETATION_PACKAGES: readonly string[] = ['vegetation', 'vegetation-textures'];

/**
 * The files outside the add-on's packages that exist only for it, as globs from the repository's
 * root. `vegetation-switch.test.ts` checks that every file outside the packages that imports the
 * add-on, or imports one of these files, is named here.
 */
export const VEGETATION_FILES: readonly string[] = [
	'tests/image/plant-*.spec.ts',
	'tests/lib/plant-species.test.ts',
	'tests/lib/leaf-card-rule.test.ts',
	'tests/lib/species-walk.ts',
	'tests/pages/plant-*',
	'tests/pages/leaves-wind-cost.*',
	'tests/pages/tree-generation.*',
	'tests/pages/vegetation-scatter.*',
	'tests/pages/sketches/plant-*',
	'tests/pages/sketches/leaves-wind-cost-sketch.ts',
	'tests/pages/lib/plant-*',
	'tests/pages/lib/plant-review/**',
	'tests/pages/lib/tree-generation-worker.ts',
	'tests/pages/lib/creek-rules.ts',
	'tools/plant-*',
	'tools/plant-*/**',
	'tools/vegetation-registry.ts',
	'tools/lib/plant-*',
	'tools/lib/plant-*/**',
	'tools/lib/vegetation-registry.ts',
	'tools/lib/vegetation-registry.test.ts',
];

/** A glob of the list as a pattern: `**` crosses folders, `*` stays within one. */
function globPattern(glob: string): RegExp {
	const body = glob
		.split('**')
		.map((part) =>
			part
				.split('*')
				.map((text) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
				.join('[^/]*'),
		)
		.join('.*');
	return new RegExp(`^${body}$`);
}

/** The list's globs as patterns. */
const FILE_PATTERNS = VEGETATION_FILES.map(globPattern);

/** Whether a path from the repository's root is one of the add-on's files, in its packages or out. */
export function isVegetationFile(path: string): boolean {
	if (VEGETATION_PACKAGES.some((name) => path.startsWith(`packages/${name}/`))) return true;
	return FILE_PATTERNS.some((pattern) => pattern.test(path));
}

/** The add-on's picture tests in the image manifest, each named `plant-` and more. */
export const VEGETATION_PICTURE = /^plant-/;

/**
 * The package folder names that the repository's checks read: all of `names`, but the add-on's own
 * unless its switch is on.
 */
export function packagesInUse(names: readonly string[]): string[] {
	return vegetationOn() ? [...names] : names.filter((name) => !VEGETATION_PACKAGES.includes(name));
}
