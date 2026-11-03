// The stand-in species: the template's record under a name of its own. The determinism tests, the
// per-species test and the review page grow it with stand-ins for every stage that is not built yet,
// so the whole pipeline runs before any real species lands. Its folder starts with an underscore, so
// the registry leaves it out and the add-on never ships it.
import type { Species } from '../../core/record';
import { record as template } from '../_template/record';

/** The stand-in species' record. */
export const record: Species = {
	...template,
	id: 'stub',
	name: 'Stub tree',
	form: 'small round-crowned broadleaf, a stand-in for tests and review',
	seedSalt: 0x57b,
};
