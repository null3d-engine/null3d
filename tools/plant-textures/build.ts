// One species' texture folder, from its sources and its `source.json`: the KTX2 files of both sets,
// the manifest with every input's and output's hash, and the module that names the files with
// literal `new URL(..., import.meta.url)` expressions, so every bundler emits them as files of their
// own and a page fetches only the species it places.
import { join } from 'node:path';
import { type BarkLayer, barkLayer } from './bark.ts';
import { type LeafConfig, readConfig, type SourceConfig } from './config.ts';
import { ENCODER, encodeKtx2, type KtxJob } from './encode.ts';
import { crop as cropFrom, decodePicture, type Picture } from './image.ts';
import { type LeafTextures, leafTextures } from './leaf.ts';
import { type SourceFile, type SourceFolder, Sources, sha256 } from './sources.ts';

/** The tool's version: raise it whenever the same inputs would give other outputs. */
export const TOOL_VERSION = '1';

/** The textures package's species folders. */
export const TEXTURES_ROOT = join(
	import.meta.dirname,
	'../../packages/vegetation-textures/textures',
);

/** Texels a side of the full set's bark layers and young bark; the half set takes half. */
export const BARK_SIZE = 1024;
export const YOUNG_SIZE = 512;

/** The keys of `TextureSet` by file name. */
const KEYS = {
	'leaf-color': 'leafColor',
	'leaf-normal': 'leafNormal',
	'bark-color': 'barkColor',
	'bark-normal': 'barkNormal',
	'young-color': 'youngColor',
	'young-normal': 'youngNormal',
} as const;

/** A species folder's files as the tool writes them, by name, and its report. */
export interface Built {
	readonly species: string;
	readonly files: Map<string, Uint8Array>;
	readonly report: Report;
}

/** What the tool measured, for its output. */
export interface Report {
	readonly sources: readonly SourceFile[];
	readonly leaf?: LeafTextures['report'];
	readonly bark?: readonly { readonly name: string; readonly seams: BarkLayer['seams'] }[];
	readonly config: SourceConfig;
	/** The finished bark tiles and young bark tile, and the leaf's layers, for the review sheet. */
	readonly pictures: {
		readonly leaf?: LeafTextures;
		readonly bark: readonly BarkLayer[];
		readonly young?: BarkLayer;
	};
}

/** Builds one species' folder from its sources. */
export async function buildSpecies(
	species: string,
	folder: SourceFolder,
	log: (line: string) => void = console.log,
): Promise<Built> {
	const dir = join(TEXTURES_ROOT, species);
	const config = readConfig(join(dir, 'source.json'));
	const sources = new Sources(folder, species);
	const used: SourceFile[] = [];
	const read = (slot: number) => {
		const file = sources.read(slot);
		used.push(file);
		log(`  slot ${slot}: ${file.name}`);
		return decodePicture(file.bytes);
	};
	const jobs: { name: string; job: KtxJob }[] = [];
	const add = (name: keyof typeof KEYS, half: boolean, job: Omit<KtxJob, 'quality'>) =>
		jobs.push({
			name: `${name}${half ? '-half' : ''}.ktx2`,
			job: { ...job, quality: config.quality[name] },
		});

	let leaf: LeafTextures | undefined;
	if (config.leaf) {
		// A compound leaf's picture holds its whole blade; the leaflet the mesh draws takes its own
		// part of it.
		const cut = (p: Picture, rect: LeafConfig['crop']) => (rect ? cropFrom(p, ...rect) : p);
		const upper = cut(read(config.leaf.upper), config.leaf.crop);
		const lower = cut(read(config.leaf.lower), config.leaf.lowerCrop ?? config.leaf.crop);
		leaf = leafTextures(upper, lower, config.leaf);
		for (const [set, half] of [
			[leaf.full, false],
			[leaf.half, true],
		] as const) {
			add('leaf-color', half, {
				layers: set.colour,
				size: set.size,
				kind: 'color',
				array: true,
				tile: false,
			});
			add('leaf-normal', half, {
				layers: [set.normal],
				size: set.size,
				kind: 'normal',
				array: true,
				tile: false,
			});
		}
	}

	let zones: BarkLayer[] = [];
	let young: BarkLayer | undefined;
	if (config.bark) {
		zones = config.bark.zones.map((zone) => barkLayer(read(zone.slot), zone, BARK_SIZE));
		young = barkLayer(read(config.bark.young.slot), config.bark.young, YOUNG_SIZE);
		for (const half of [false, true]) {
			const size = half ? BARK_SIZE / 2 : BARK_SIZE;
			const youngSize = half ? YOUNG_SIZE / 2 : YOUNG_SIZE;
			const pick = (layer: BarkLayer) => (half ? layer.half : layer.full);
			add('bark-color', half, {
				layers: zones.map((z) => pick(z).colour),
				size,
				kind: 'color',
				array: true,
				tile: true,
			});
			add('bark-normal', half, {
				layers: zones.map((z) => pick(z).normal),
				size,
				kind: 'normal',
				array: true,
				tile: true,
			});
			add('young-color', half, {
				layers: [pick(young).colour],
				size: youngSize,
				kind: 'color',
				array: false,
				tile: true,
			});
			add('young-normal', half, {
				layers: [pick(young).normal],
				size: youngSize,
				kind: 'normal',
				array: false,
				tile: true,
			});
		}
	}

	const files = new Map<string, Uint8Array>();
	for (const { name, job } of jobs) {
		const start = performance.now();
		files.set(name, await encodeKtx2(job));
		log(
			`  ${name}: ${(files.get(name) as Uint8Array).length.toLocaleString('en')} bytes, ${((performance.now() - start) / 1000).toFixed(1)} s`,
		);
	}

	const manifest = {
		format: 1,
		species,
		source: {
			repository: 'null3d-engine/plant-references',
			commit: folder.commit,
			files: used.map((file) => ({
				name: file.name,
				sha256: file.sha256,
				...(file.job ? { job: file.job } : {}),
			})),
		},
		tool: { version: TOOL_VERSION, encoder: ENCODER },
		...(leaf ? { leaf: leaf.manifest } : {}),
		...(config.bark && young
			? {
					bark: {
						size: BARK_SIZE,
						layers: config.bark.zones.map((zone, i) => ({
							name: zone.name,
							tile: zone.tile,
							mean: (zones[i] as BarkLayer).mean,
							height: (zones[i] as BarkLayer).height,
						})),
						young: { tile: config.bark.young.tile, mean: young.mean },
					},
				}
			: {}),
		outputs: [...files].map(([file, bytes]) => ({
			file,
			sha256: sha256(bytes),
			bytes: bytes.length,
		})),
	};
	const json = `${JSON.stringify(manifest, null, '\t')}\n`;
	files.set('manifest.json', new TextEncoder().encode(json));
	files.set('index.js', new TextEncoder().encode(moduleSource(species, json, [...files.keys()])));
	files.set('index.d.ts', new TextEncoder().encode(DECLARATIONS));
	if (leaf && config.leaf) {
		const upper = used.find((file) => file.slot === config.leaf?.upper);
		const lower = used.find((file) => file.slot === config.leaf?.lower);
		files.set(
			'leaf-coverage.json',
			coverageRuns(
				[upper?.name, lower?.name].filter((name) => name !== undefined).join(' and '),
				leaf.half.colour[0] as Uint8Array,
				leaf.half.colour[1] as Uint8Array,
				leaf.half.size,
			),
		);
	}
	return {
		species,
		files,
		report: {
			sources: used,
			...(leaf ? { leaf: leaf.report } : {}),
			...(zones.length
				? {
						bark: zones.map((z, i) => ({
							name: config.bark?.zones[i]?.name ?? '',
							seams: z.seams,
						})),
					}
				: {}),
			config,
			pictures: { ...(leaf ? { leaf } : {}), bark: zones, ...(young ? { young } : {}) },
		},
	};
}

/** The module beside the files: the manifest, and one literal URL per file of each set. */
function moduleSource(species: string, manifest: string, names: readonly string[]): string {
	const set = (half: boolean) =>
		Object.entries(KEYS)
			.filter(([name]) => names.includes(`${name}${half ? '-half' : ''}.ktx2`))
			.map(
				([name, key]) =>
					`\t\t${key}: new URL('./${name}${half ? '-half' : ''}.ktx2', import.meta.url),`,
			)
			.join('\n');
	return `// Written by tools/plant-textures from the reference set: the texture files of the species
// ${species}, as \`bun run plants:textures ${species}\` writes them. A page fetches the files only
// when it prepares the species, and the literal URLs let every bundler emit them as files.
/** @type {import('@null3d/vegetation/textures').SpeciesTextureFiles} */
export const files = {
	manifest: ${manifest.trim().replaceAll('\n', '\n\t')},
	full: {
${set(false)}
	},
	half: {
${set(true)}
	},
};
`;
}

/**
 * The coverage of either face at the alpha cutoff, which the leaf mesh's outline holds, as runs of
 * covered texels per row of the half set's layers: row 0 at v = 0, the stalk end, each run a start
 * and an exclusive end. Tests of the leaf mesh read it where neither the references nor a KTX2
 * decoder are at hand. The package leaves it out.
 */
function coverageRuns(
	source: string,
	upper: Uint8Array,
	lower: Uint8Array,
	size: number,
): Uint8Array {
	const rows: string[] = [];
	for (let row = 0; row < size; row++) {
		const y = size - 1 - row;
		const runs: number[] = [];
		let start = -1;
		for (let x = 0; x <= size; x++) {
			const at = (y * size + x) * 4 + 3;
			const covered = x < size && Math.max(upper[at] as number, lower[at] as number) >= 128;
			if (covered && start < 0) start = x;
			if (!covered && start >= 0) {
				runs.push(start, x);
				start = -1;
			}
		}
		rows.push(`\t\t[${runs.join(', ')}]`);
	}
	const text = `{\n\t"source": ${JSON.stringify(source)},\n\t"cutoff": 0.5,\n\t"size": ${size},\n\t"rows": [\n${rows.join(',\n')}\n\t]\n}\n`;
	return new TextEncoder().encode(text);
}

/** The module's types. */
const DECLARATIONS = `// Written by tools/plant-textures: the types of the species' texture module beside it.
import type { SpeciesTextureFiles } from '@null3d/vegetation/textures';

/** The species' texture files: its manifest, and the URLs of its full and half sets. */
export declare const files: SpeciesTextureFiles;
`;
