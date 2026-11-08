// The pendulous sedge: its record, and the empty texture files of a species whose leaf and sheath
// surfaces the blades and sheaths draw in their own measured colours. The generated registry loads
// this entry as a chunk of its own.
import type { SpeciesModule } from '../../core/record';
import { noTextureFiles } from '../../core/textures';
import { record } from './record';

/** The pendulous sedge. */
export const species: SpeciesModule = { record, textures: noTextureFiles(record.id) };
