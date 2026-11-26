// The generated page of the features whose shaders load on first use. The shader manifest's
// `[first_use.*]` tables name the features, so the page lists every feature that `preload` takes.
// Each feature's row says when its shaders download, from the descriptions below; a feature that
// the manifest names and the descriptions lack fails the docs generator.
import { readIfExists } from './files';
import { generatedFrontMatter, type PageText } from './frontmatter';

/** The generated page of the features whose shaders load on first use. */
export const FIRST_USE_PAGE_ID = 'guides/first-use-shaders';
/** The shader manifest, whose `[first_use.*]` tables name the features. */
export const SHADER_MANIFEST = 'crates/null3d-shaders/shaders.toml';

/** The groups of the page, in the order that it prints them. */
export const FIRST_USE_GROUPS = [
	'Post-processing',
	'Materials',
	'Transparency',
	'Lights and shadows',
	'Sky and background',
	'Meshes and animation',
	'Engine passes',
	'Engine tests',
] as const;

/** One group of features on the page. */
export type FirstUseGroup = (typeof FIRST_USE_GROUPS)[number];

/** When a feature's shaders download, and what waits until they are built. */
export interface FirstUseDownload {
	readonly group: FirstUseGroup;
	readonly downloads: string;
	readonly untilBuilt?: string;
}

/** When each feature's shaders download, in the words of the page's table, by feature name. */
export const FIRST_USE_DOWNLOADS: Readonly<Record<string, FirstUseDownload>> = {
	skinning: {
		group: 'Meshes and animation',
		downloads: 'with the first skinned mesh, or as soon as the sketch reads a glTF file with skins',
	},
	morph: {
		group: 'Meshes and animation',
		downloads:
			'with the first morphed mesh, or as soon as the sketch reads a glTF file with morph targets',
		untilBuilt:
			"WebGPU morphs in the skinning pass, so there `'morph'` downloads the skinning shaders",
	},
	bloom: { group: 'Post-processing', downloads: 'when `post.set` turns bloom on' },
	ao: {
		group: 'Post-processing',
		downloads:
			'when `post.set` turns ambient occlusion on, or with the first opaque material where the preset draws the screen-space bounce light that reads its steps',
	},
	dof: { group: 'Post-processing', downloads: 'when `post.set` turns depth of field on' },
	exposure: {
		group: 'Post-processing',
		downloads: 'when `post.set` turns automatic exposure on',
		untilBuilt: 'The camera keeps its own exposure until the meter is built',
	},
	fog_volume: {
		group: 'Post-processing',
		downloads: 'when `scene.setFog` turns the volumetric fog on',
		untilBuilt: 'The fog keeps its sun glow until the fog is built',
	},
	taa: {
		group: 'Post-processing',
		downloads:
			'only by an internal test option of temporal anti-aliasing, which the public API does not offer',
		untilBuilt:
			"No quality preset turns it on, so a page never downloads these shaders, and preloading `'taa'` only adds to the download",
	},
	effect_groups: {
		group: 'Post-processing',
		downloads: 'the first time custom effects join into one pass, or fold into the final pass',
		untilBuilt: 'Until its shaders are built, each effect draws a pass of its own',
	},
	sprites: { group: 'Meshes and animation', downloads: 'with the first sprite batch' },
	picking: {
		group: 'Meshes and animation',
		downloads: 'with the first `scene.pick()` call',
		untilBuilt: 'which waits for the shaders',
	},
	particles: {
		group: 'Materials',
		downloads: 'with the first particle system (`@null3d/particles`)',
	},
	lines: { group: 'Meshes and animation', downloads: 'with the first line batch' },
	decals: {
		group: 'Materials',
		downloads: 'with the first mesh of a decal material (`materials.decal`)',
	},
	cluster_levels: {
		group: 'Engine passes',
		downloads:
			'with the first frame that draws a tree of cluster patches (`setMeshPatches`), which builds the pass that picks a tree of patches',
		untilBuilt: 'A scene without a tree downloads none of it, and WebGL2 never builds that pass',
	},
	probe_grid: {
		group: 'Lights and shadows',
		downloads: 'when the sketch first sets a light probe grid (`scene.setLightProbeGrid`)',
	},
	transmission: {
		group: 'Transparency',
		downloads: 'with the first material that lets light through (`transmission`)',
	},
	color_copy: {
		group: 'Engine passes',
		downloads:
			'with the first step that reads the color that the frame before showed: the first material that lets light through, screen-space reflections, or the bounce light that the preset draws',
		untilBuilt: 'whose file downloads with the first opaque material',
	},
	translucency: {
		group: 'Transparency',
		downloads:
			'with the first material that lets light through a thin surface (`diffuseTransmission`)',
	},
	bump: { group: 'Materials', downloads: 'with the first material with a bump map' },
	displacement: {
		group: 'Materials',
		downloads:
			'with the first material with a displacement map, which also loads the builds of parallax',
		untilBuilt: 'Its mesh draws nothing until they are built',
	},
	subsurface: {
		group: 'Materials',
		downloads: 'with the first material whose light spreads under its surface (`subsurfaceRadius`)',
		untilBuilt: 'The skin pass and the blur draw its light',
	},
	motion: {
		group: 'Engine passes',
		downloads: 'when a pass first reads the motion',
		untilBuilt: 'The motion debug view is such a pass, and it exists in development builds only',
	},
	coat_sheen: {
		group: 'Materials',
		downloads: 'with the first material with a clear coat, a sheen, iridescence or anisotropy',
	},
	weighted: {
		group: 'Transparency',
		downloads: "with the first material of the `'weighted'` blending",
	},
	single_layer: {
		group: 'Transparency',
		downloads:
			"with MSAA, when the first blended draw of a feature at the `'resolve'` frame point draws",
		untilBuilt: 'Its surfaces blend in the transparent pass until the layer is built',
	},
	moment: {
		group: 'Transparency',
		downloads:
			'when the quality setting `momentTransparency` is on and the first blended surface draws',
		untilBuilt: 'The surfaces draw sorted until the layer and its anti-aliasing are built',
	},
	area_lights: { group: 'Lights and shadows', downloads: 'with the first rectangle or tube light' },
	background: {
		group: 'Sky and background',
		downloads: 'with the first texture, environment or cube map background',
	},
	sky: { group: 'Sky and background', downloads: 'with the first sky background' },
	clouds: {
		group: 'Sky and background',
		downloads:
			"with the first sky background with clouds while `cloudSteps` is above 0, as High and Ultra set it, or with the first frame that draws the sky's volumetric cloud tier after `quality.set({ cloudSteps })`",
		untilBuilt:
			'A page that draws the flat layer downloads none of it. The noise field of its march is made in the browser when the tier first draws',
	},
	physical_sky: {
		group: 'Sky and background',
		downloads: 'with the first physical sky background (`atmosphere`)',
		untilBuilt: 'The view shows the background color until the sky is built',
	},
	occlusion: {
		group: 'Lights and shadows',
		downloads: 'with the first opaque material while GPU occlusion culling runs on WebGPU',
		untilBuilt:
			'Until its shaders are built, the engine draws without it. WebGL2 has no such shaders',
	},
	coverage: {
		group: 'Transparency',
		downloads: 'with the first masked material that MSAA smooths with alpha to coverage',
	},
	hash: {
		group: 'Transparency',
		downloads: "with the first material whose alpha mode is `'hash'`",
	},
	cutout: {
		group: 'Transparency',
		downloads: 'with the first masked object that casts shadows',
		untilBuilt: 'It casts none until its shaders are built',
	},
	views: {
		group: 'Engine passes',
		downloads: 'with the first scene pass',
		untilBuilt: 'Its texture shows nothing until its shaders are built',
	},
	row_values: {
		group: 'Meshes and animation',
		downloads:
			'with the first instance batch whose rows have colors or values (`colors: true` or `values: true`)',
	},
	lod_fade: {
		group: 'Meshes and animation',
		downloads: 'with the first mesh whose levels of detail fade, or whose distance bands fade',
		untilBuilt:
			"The quality setting `lodFade` turns the bands' fades off on Low, not a level's fade",
	},
	texcoords: {
		group: 'Engine tests',
		downloads:
			"only in the engine's own tests, which draw meshes colored by their texture coordinates",
	},
	instance_index: {
		group: 'Engine tests',
		downloads: "only in the engine's own tests, through a test switch of WebGPU's instance data",
	},
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
		...Object.entries(FIRST_USE_DOWNLOADS)
			.filter(([, entry]) => !FIRST_USE_GROUPS.includes(entry.group))
			.map(
				([feature]) =>
					`FIRST_USE_DOWNLOADS in tools/lib/first-use-docs.ts gives '${feature}' no group`,
			),
	];
}

/** The page of the features whose shaders load on first use, grouped by kind. */
export function firstUsePage(features: readonly string[], text: PageText): string {
	const sections = FIRST_USE_GROUPS.map((group) => {
		const rows = features
			.filter((feature) => FIRST_USE_DOWNLOADS[feature]?.group === group)
			.sort()
			.map((feature) => {
				const entry = FIRST_USE_DOWNLOADS[feature];
				const downloads = entry?.downloads ?? 'not described';
				const untilBuilt = entry?.untilBuilt ?? '';
				return `| \`'${feature}'\` | ${downloads} | ${untilBuilt} |`;
			});
		const intro = group === 'Engine tests' ? '\nA page never needs these features.\n' : '';
		return `## ${group}
${intro}
| Feature | Its shaders download | Until they are built |
| --- | --- | --- |
${rows.join('\n')}
`;
	});
	return `${generatedFrontMatter(FIRST_USE_PAGE_ID, text.title, text.summary)}
# ${text.title}

> [Loading screens](loading-screens.md#loading-everything-up-front) explains this table. The engine's shader manifest makes it, so it lists every feature of this version.

Most shaders come with the engine's start. The shaders of each feature below download the first time the sketch uses the feature. \`createEngine\`'s \`preload\` option takes these names, and loads their shaders before the first frame.

${sections.join('\n')}`;
}
