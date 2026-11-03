// The shoot prototypes: small real shoots grown once per species from the record, a current-year
// shoot with one or two older years below it, stem tubes, nodes by the phyllotaxis, a leaf at each
// node scaled by position, buds at the axils and a tip cluster, then the extras its class carries.
// Each is built at all four detail tiers from the same random choices. It throws until the shoots
// are built.
import type { PrototypeArrays, ShootPrototype } from '../asset';
import { notBuilt } from '../core/not-built';
import type { Species } from '../core/record';
import type { TextureManifest } from '../core/textures';

/**
 * A shoot prototype before the card bake gives it its atlas cells.
 *
 * @category api/vegetation
 */
export type UncardedPrototype = Omit<ShootPrototype, 'card'>;

/**
 * Grows a species' shoot prototypes, each at every detail tier, from its leaf meshes.
 *
 * @param record The species record.
 * @param manifest The texture manifest.
 * @param leaves The species' leaf meshes at every tier, low first.
 * @returns The prototypes.
 */
export function shootPrototypes(
	record: Species,
	manifest: TextureManifest,
	leaves: readonly (readonly PrototypeArrays[])[],
): UncardedPrototype[] {
	void record;
	void manifest;
	void leaves;
	throw notBuilt('shoot prototypes');
}
