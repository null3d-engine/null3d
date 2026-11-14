// The vegetation add-on's species registry and species page, both generated from the species folders
// in packages/vegetation/src/species/. A species adds a folder and nothing else: the registry gives it
// a lazy loader, so a page fetches only the species it places, and the species page lists it. Git
// keeps neither file (D-105): the install step, the git hooks and `bun run docs` write them through
// tools/lib/generated.ts, and `bun tools/vegetation-registry.ts` writes them alone.
//
// A folder whose name starts with an underscore is not a species: `_template` holds the files to
// copy.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { renderFrontMatter } from './frontmatter';
import { SPECIES_DIR, type SpeciesFolder, speciesFolders } from './vegetation-folders';

export { SPECIES_DIR, type SpeciesFolder, speciesFolders };

/** The generated registry. */
export const REGISTRY_FILE = `${SPECIES_DIR}/registry.generated.ts`;
/** The generated species page's ID and path. */
export const SPECIES_PAGE_ID = 'api/vegetation-species';
export const SPECIES_PAGE = `docs/${SPECIES_PAGE_ID}.md`;

/** The registry's source: one lazy loader per species folder, and one per hooks file. */
export function registrySource(folders: readonly SpeciesFolder[]): string {
	const loaders = folders.map((f) => `\t'${f.id}': () => import('./${f.id}/index'),`).join('\n');
	const hooks = folders
		.filter((f) => f.hooks)
		.map((f) => `\t'${f.id}': () => import('./${f.id}/hooks'),`)
		.join('\n');
	return `// The species registry, which tools/vegetation-registry.ts writes from the folders beside it. Git
// does not keep it: a species adds its own folder, and the install step, the git hooks and
// \`bun run docs\` write its line here. Each loader is a dynamic import, so each species is a chunk of
// its own and a page fetches only the species it asks for.
import type { SpeciesHooks, SpeciesModule } from '../core/record';

/** Every species folder's loader, by the folder's name. */
export const SPECIES = {
${loaders ? `${loaders}\n` : ''}} as const satisfies Record<string, () => Promise<{ readonly species: SpeciesModule }>>;

/**
 * A species' id: the name of its folder under the add-on's species folder.
 *
 * @category api/vegetation
 */
export type SpeciesId = keyof typeof SPECIES;

/** The loader of each species folder's own shape code, which only the job worker imports. */
export const SPECIES_HOOKS = {
${hooks ? `${hooks}\n` : ''}} as const satisfies Partial<
	Record<SpeciesId, () => Promise<{ readonly hooks: SpeciesHooks }>>
>;
`;
}

/** What the species page shows of one record. */
interface RecordSummary {
	readonly id: string;
	readonly name: string;
	readonly latin: string;
	readonly form: string;
	readonly model: string;
	readonly foliage: string;
	readonly variants: number;
}

/** Reads a species folder's record. Records are plain data, so loading one runs no code but its own. */
function readRecord(root: string, id: string): RecordSummary {
	const require = createRequire(import.meta.url);
	const module = require(join(root, SPECIES_DIR, id, 'record.ts')) as {
		record?: {
			id: string;
			name: string;
			latin: string;
			form: string;
			growth: { model: string };
			foliage: { kind: string };
			variants: number;
		};
	};
	const record = module.record;
	if (!record) throw new Error(`${SPECIES_DIR}/${id}/record.ts exports no record`);
	return {
		id: record.id,
		name: record.name,
		latin: record.latin,
		form: record.form,
		model: record.growth.model,
		foliage: record.foliage.kind,
		variants: record.variants,
	};
}

/** A table cell's text, with its pipes escaped. */
const cell = (text: string) => text.replace(/\|/g, '\\|');

/** The species page: one row per species, from its record. */
export function speciesPage(root: string, folders: readonly SpeciesFolder[]): string {
	const rows = folders.map((folder) => readRecord(root, folder.id));
	const table =
		rows.length === 0
			? 'The add-on ships no species yet.'
			: [
					'| Id | Name | Latin name | Form | Growth model | Foliage | Variants |',
					'| --- | --- | --- | --- | --- | --- | --- |',
					...rows.map(
						(r) =>
							`| \`${r.id}\` | ${cell(r.name)} | *${cell(r.latin)}* | ${cell(r.form)} | \`${r.model}\` | \`${r.foliage}\` | ${r.variants} |`,
					),
				].join('\n');
	return `${renderFrontMatter([
		['id', SPECIES_PAGE_ID],
		['title', 'Vegetation species'],
		['status', 'generated'],
		['since', '0.3'],
		['summary', "Every species of the vegetation add-on's plant core, from its record."],
	])}
# Vegetation species

> [Vegetation](vegetation.md) explains the species records. The species folders make this page.

${table}
`;
}

/** Both generated files, by path. */
export function vegetationRegistryFiles(root: string): Map<string, string> {
	const folders = speciesFolders(root);
	return new Map([
		[REGISTRY_FILE, registrySource(folders)],
		[SPECIES_PAGE, speciesPage(root, folders)],
	]);
}
