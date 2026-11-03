// The wind records: one record of 16 floats per axis, with 16-bit ids global in the species' records
// texture, so one material serves every variant. A variant's records start at its own base. It
// throws until the records are built.
import type { WindTable } from '../asset';
import { notBuilt } from '../core/not-built';
import type { DressInput } from '../stages';

/**
 * Floats in one wind record.
 *
 * @category api/vegetation
 */
export const WIND_RECORD_FLOATS = 16;

/**
 * Records each variant may hold. A variant's records start at its index times this, so eight
 * variants fit the species' 65,000 records.
 *
 * @category api/vegetation
 */
export const VARIANT_RECORDS = 8000;

/**
 * The wind records of one variant: pivot, axis, parent record, stiffness, flutter, order, length,
 * phase and whip weight per axis.
 *
 * @param input The grown skeleton, the kit, the record, the seed and the variant.
 * @returns The variant's wind table.
 */
export function windRecords(input: DressInput): WindTable {
	void input;
	throw notBuilt('wind records');
}
