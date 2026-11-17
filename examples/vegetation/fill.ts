// Stands a field's plants as each one finishes growing, so the field fills while the rest still
// grow rather than standing empty until the last build lands. A later field takes over from the one
// before it, and the plants the older one grows after the takeover are taken down again.

/** How one fill grows its plants, lands them and reports its progress. */
export interface FillHooks<T, Id extends string = string> {
	/**
	 * Grows the species at its slot. `current` reads false once a newer fill has taken the field
	 * over, which lets the grow stop before it spends more work. A throw leaves the slot empty and
	 * does not stop the other species.
	 */
	grow(id: Id, index: number, current: () => boolean): Promise<T | undefined>;
	/** Told the plants that stand, in species order, each time one lands. */
	land(plants: readonly T[]): void;
	/** Told the count of finished species, while this fill still owns the field. */
	progress(done: number, total: number): void;
	/** Takes down a plant that finishes after a newer fill took the field over. */
	discard(plant: T): void;
	/** Named when a species cannot grow, so the field goes on without it. */
	failed?(id: Id, error: unknown): void;
	/** Told once every species has finished, while this fill still owns the field. */
	settled?(): void;
}

/**
 * Makes the field's fill. Each call takes the field over: the call before it stops landing plants
 * and stops reporting progress, and a plant it grows after the takeover is handed back to `discard`
 * rather than joined to a field that no longer belongs to it.
 */
export function createFill<Id extends string = string>(): <T>(
	ids: readonly Id[],
	hooks: FillHooks<T, Id>,
) => Promise<void> {
	/** Which fill owns the field: a fill that a newer one overtook stands nothing. */
	let run = 0;
	return async function fill<T>(ids: readonly Id[], hooks: FillHooks<T, Id>): Promise<void> {
		const mine = ++run;
		const current = (): boolean => mine === run;
		/** The plants that stand, by species slot, so the list keeps the species' own order. */
		const slots: (T | undefined)[] = new Array(ids.length);
		const standing = (): T[] => slots.filter((plant): plant is T => plant !== undefined);
		let done = 0;
		await Promise.all(
			ids.map(async (id, index) => {
				try {
					const plant = await hooks.grow(id, index, current);
					if (plant === undefined) return;
					if (!current()) {
						hooks.discard(plant);
						return;
					}
					slots[index] = plant;
					hooks.land(standing());
				} catch (error) {
					hooks.failed?.(id, error);
				} finally {
					if (current()) {
						done++;
						hooks.progress(done, ids.length);
					}
				}
			}),
		);
		// A fill that a newer one overtook has no field left to report on.
		if (current()) hooks.settled?.();
	};
}
