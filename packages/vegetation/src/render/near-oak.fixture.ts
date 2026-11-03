// The oak that the near pool's tests and its test page grow until the pedunculate oak's own species
// folder lands: the self-organizing grower's oak, the leaf package's oak shoots and leaves, the wood
// package's test bark and base, and the oak's own texture files. It is a whole species module, so it
// goes through every real stage and every real page step.
import { files as oakTextures } from '@null3d/vegetation-textures/pedunculate-oak';
import type { Species, SpeciesModule } from '../core/record';
import { oakRecord as grownOak } from '../grow/oak.fixture';
import { oakRecord as leafOak } from '../leaf/oak.test-support';
import { testRecord } from '../wood/wood-test-tree';

/** The oak's record, with the leaf package's shoots and leaves and the wood package's bark. */
export function nearOakRecord(): Species {
	const leaves = leafOak();
	const wood = testRecord();
	return {
		...grownOak,
		shoots: leaves.shoots,
		foliage: leaves.foliage,
		...(wood.bark && { bark: wood.bark }),
		...(wood.base && { base: wood.base }),
	};
}

/** The oak as a species module, with the oak's own texture files. */
export function nearOak(): SpeciesModule {
	return { record: nearOakRecord(), textures: oakTextures };
}
