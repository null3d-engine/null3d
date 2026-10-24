// The generated page of the features whose shaders load on first use. The shader manifest's
// `[first_use.*]` tables name the features, so the page lists every feature that `preload` takes.
// Each feature's row says when its shaders download, from the descriptions below; a feature that
// the manifest names and the descriptions lack fails the docs generator.
import { readIfExists } from './files';
import { renderFrontMatter } from './frontmatter';

/** The generated page of the features whose shaders load on first use. */
export const FIRST_USE_PAGE_ID = 'guides/first-use-shaders';
/** The shader manifest, whose `[first_use.*]` tables name the features. */
export const SHADER_MANIFEST = 'crates/null3d-shaders/shaders.toml';

/** When each feature's shaders download, in the words of the page's table, by feature name. */
export const FIRST_USE_DOWNLOADS: Readonly<Record<string, string>> = {
	skinning: 'with the first skinned mesh, or as soon as the sketch reads a glTF file with skins',
	morph:
		"with the first morphed mesh, or as soon as the sketch reads a glTF file with morph targets. WebGPU morphs in the skinning pass, so there `'morph'` downloads the skinning shaders",
	bloom: 'when `post.set` turns bloom on',
	ao: 'when `post.set` turns ambient occlusion on',
	dof: 'when `post.set` turns depth of field on',
	exposure:
		'when `post.set` turns automatic exposure on. The camera keeps its own exposure until the meter is built',
	fog_volume:
		'when `scene.setFog` turns the volumetric fog on. The fog keeps its sun glow until the fog is built',
	taa: 'when `post.set` turns the temporal resolve on, a prototype for measuring only (D-206)',
	sprites: 'with the first sprite batch',
	picking: 'with the first `scene.pick()` call, which waits for the shaders',
	particles: 'with the first particle system (`@null3d/particles`)',
	lines: 'with the first line batch',
	decals: 'with the first mesh of a decal material (`materials.decal`)',
	cluster_levels:
		'with the first frame that draws a tree of cluster patches (`setMeshPatches`), which builds the pass that picks a tree of patches. A scene without a tree downloads none of it, and WebGL2 never builds that pass',
	probe_grid: 'when the sketch first sets a light probe grid (`scene.setLightProbeGrid`)',
	transmission: 'with the first material that lets light through (`transmission`)',
	translucency:
		'with the first material that lets light through a thin surface (`diffuseTransmission`)',
	bump: 'with the first material with a bump map',
	displacement:
		'with the first material with a displacement map, which also loads the builds of parallax. Its mesh draws nothing until they are built',
	subsurface:
		'with the first material whose light spreads under its surface (`subsurfaceRadius`). The skin pass and the blur draw its light',
	motion:
		'when a pass first reads the motion. The motion debug view is such a pass, and it exists in development builds only',
	coat_sheen: 'with the first material with a clear coat, a sheen, iridescence or anisotropy',
	weighted: "with the first material of the `'weighted'` blending",
	area_lights: 'with the first rectangle or tube light',
	background: 'with the first texture, environment or cube map background',
	sky: 'with the first sky background',
	physical_sky:
		'with the first physical sky background (`atmosphere`). The view shows the background color until the sky is built',
	occlusion:
		'with the first object that `setOccluder(true)` marks, while GPU occlusion culling runs on WebGPU. Until its shaders are built, the engine draws without it. WebGL2 has no such shaders',
	coverage: 'with the first masked material that MSAA smooths with alpha to coverage',
	hash: "with the first material whose alpha mode is `'hash'`",
	cutout:
		'with the first masked object that casts shadows. It casts none until its shaders are built',
	views: 'with the first scene pass. Its texture shows nothing until its shaders are built',
	effect_groups:
		'the first time custom effects join into one pass, or fold into the final pass. Until its shaders are built, each effect draws a pass of its own',
	row_values:
		'with the first instance batch whose rows have colors or values (`colors: true` or `values: true`)',
	lod_fade: 'with the first mesh whose levels of detail fade (the quality setting `lodFade`)',
	texcoords:
		"only in the engine's own tests, which draw meshes colored by their texture coordinates",
	instance_index: "only in the engine's own tests, through a test switch of WebGPU's instance data",
};

/**
 * The feature names of the manifest's `[first_use.*]` tables, in the manifest's order, or none in
 * a folder without the manifest, such as a test's fixture.
 */
export function manifestFeatures(root: string): string[] {
	const text = readIfExists(root, SHADER_MANIFEST);
	if (text === null) return [];
	const manifest = Bun.TOML.parse(text) as { first_use?: Record<string, unknown> };
	return Object.keys(manifest.first_use ?? {});
}

/** Features that the manifest names and the descriptions lack, and descriptions of no feature. */
export function firstUseProblems(features: readonly string[]): string[] {
	const named = new Set(features);
	return [
		...features
			.filter((feature) => !(feature in FIRST_USE_DOWNLOADS))
			.map(
				(feature) =>
					`${SHADER_MANIFEST} names the first-use feature '${feature}', which FIRST_USE_DOWNLOADS in tools/lib/first-use-docs.ts does not describe`,
			),
		...Object.keys(FIRST_USE_DOWNLOADS)
			.filter((feature) => !named.has(feature))
			.map(
				(feature) =>
					`FIRST_USE_DOWNLOADS in tools/lib/first-use-docs.ts describes '${feature}', which ${SHADER_MANIFEST} does not name`,
			),
	];
}

/** The page of the features whose shaders load on first use, one row for each feature. */
export function firstUsePage(features: readonly string[]): string {
	const rows = features.map(
		(feature) => `| \`'${feature}'\` | ${FIRST_USE_DOWNLOADS[feature] ?? 'not described'} |`,
	);
	return `${renderFrontMatter([
		['id', FIRST_USE_PAGE_ID],
		['title', 'Shaders that load on first use'],
		['status', 'generated'],
		['since', '0.1'],
		[
			'summary',
			"The features whose shaders download on first use, which createEngine's preload takes.",
		],
	])}
# Shaders that load on first use

> [Loading screens](loading-screens.md#loading-everything-up-front) explains this table. The engine's shader manifest makes it, so it lists every feature of this version.

Most shaders come with the engine's start. The shaders of each feature below download the first time the sketch uses the feature. \`createEngine\`'s \`preload\` option takes these names, and loads their shaders before the first frame.

| Feature | Its shaders download |
| --- | --- |
${rows.join('\n')}
`;
}
