// The entry to copy for a new species: it exports `species`, the record and its texture files, and
// the generated registry loads it as a chunk of its own. A species whose textures exist takes their
// files from the textures package, whose tool writes one module beside each species folder's
// files; that module exports `files`, which this entry gives as `textures`. A species that reads
// another's folder takes that folder's module. Until then a species has no texture files, and draws
// in flat colours.
import type { SpeciesModule } from '../../core/record';
import { noTextureFiles } from '../../core/textures';
import { record } from './record';

/** The template species. */
export const species: SpeciesModule = { record, textures: noTextureFiles(record.id) };
