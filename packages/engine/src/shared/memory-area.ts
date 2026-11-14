// The memory register's areas, by name, in the order that the core reports them. The area numbers
// are `null3d_core::memory::area`'s constants and the core reports three numbers for each: the
// bytes that the area reserves, uses and has used at most. A page that shows no development
// figures reads none of them.

/** The numbers that the core reports for each area. */
export const MEMORY_AREA_VALUES = 3;

/** The areas' names, in the core's order. */
export const MEMORY_AREA_NAMES = [
	'scene',
	'instances',
	'cells',
	'levels',
	'bucket keys',
	'shadow casters',
	'draw tables',
	'upload arenas',
	'draw lists',
	'animation',
] as const;

/** The number of memory areas that the core reports. */
export const MEMORY_AREA_COUNT = MEMORY_AREA_NAMES.length;
