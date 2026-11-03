// The stand-in species' entry: its record and no texture files. Tests and the review page import it
// by path; the registry leaves underscored folders out.
import type { SpeciesModule } from '../../core/record';
import { noTextureFiles } from '../../core/textures';
import { record } from './record';

/** The stand-in species, which grows through every stage with stand-ins. */
export const species: SpeciesModule = { record, textures: noTextureFiles(record.id) };
