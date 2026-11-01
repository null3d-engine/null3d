// The names of the GPU scopes that the engine writes into its frame records, so the stats overlay
// shows which step of the frame each GPU pass is and a feature can show the time of the passes
// that carry its own work. A scope is the kind of step and, for a step that has one, its place:
// bloom's fourth step, or a sketch's third render pass. The codes come from the engine's core
// (`crates/null3d-render/src/scope.rs`) through the generated constants.

import {
	SCOPE_ACCUMULATE,
	SCOPE_AO,
	SCOPE_BLOOM,
	SCOPE_COMPUTE,
	SCOPE_CULL,
	SCOPE_DEBUG_LINES,
	SCOPE_DECAL_REDRAW,
	SCOPE_DECALS,
	SCOPE_DOF,
	SCOPE_EFFECT,
	SCOPE_FINAL,
	SCOPE_FINAL_BLOOM,
	SCOPE_FINAL_STILL,
	SCOPE_FOG_APPLY,
	SCOPE_FOG_BLOCK,
	SCOPE_FOG_LIGHT,
	SCOPE_FOG_SUM,
	SCOPE_FULLSCREEN,
	SCOPE_LATE_CULL,
	SCOPE_LIGHT_CLUSTERS,
	SCOPE_LIGHT_DEPTH,
	SCOPE_MOTION,
	SCOPE_MOTION_VIEW,
	SCOPE_NONE,
	SCOPE_OCCLUDERS,
	SCOPE_OPAQUE,
	SCOPE_OUTLINE_MASK,
	SCOPE_OUTPUT,
	SCOPE_OUTPUT_BLOOM,
	SCOPE_PARTICLE_DEPTH_COPY,
	SCOPE_PICK,
	SCOPE_PICK_RESOLVE,
	SCOPE_PREPASS,
	SCOPE_PYRAMID,
	SCOPE_RESOLVE,
	SCOPE_SHADOW,
	SCOPE_SKIN,
	SCOPE_SKIN_LIGHT,
	SCOPE_SSR,
	SCOPE_SUBSURFACE,
	SCOPE_TAA,
	SCOPE_TRANSMISSION_COPY,
	SCOPE_TRANSPARENT,
	SCOPE_VIEW_COPY,
	SCOPE_WEIGHTED,
	SCOPE_WEIGHTED_COMPOSITE,
} from '../generated/core';

/** The name of each kind of step, in the overlay's words. */
const NAMES: ReadonlyMap<number, string> = new Map([
	[SCOPE_LIGHT_CLUSTERS, 'light clusters'],
	[SCOPE_LIGHT_DEPTH, 'light depth'],
	[SCOPE_SKIN, 'skinning'],
	[SCOPE_CULL, 'culling'],
	[SCOPE_PREPASS, 'depth prepass'],
	[SCOPE_OPAQUE, 'opaque'],
	[SCOPE_OCCLUDERS, 'occluders'],
	[SCOPE_PYRAMID, 'depth pyramid'],
	[SCOPE_LATE_CULL, 'late culling'],
	[SCOPE_SHADOW, 'shadow'],
	[SCOPE_DEBUG_LINES, 'debug lines'],
	[SCOPE_TRANSPARENT, 'transparent'],
	[SCOPE_DECALS, 'decals'],
	[SCOPE_DECAL_REDRAW, 'decal redraw'],
	[SCOPE_PICK, 'picking'],
	[SCOPE_PICK_RESOLVE, 'pick resolve'],
	[SCOPE_RESOLVE, 'resolve'],
	[SCOPE_BLOOM, 'bloom'],
	[SCOPE_OUTLINE_MASK, 'outline'],
	[SCOPE_SKIN_LIGHT, 'skin light'],
	[SCOPE_SUBSURFACE, 'subsurface'],
	[SCOPE_AO, 'ambient occlusion'],
	[SCOPE_SSR, 'reflections'],
	[SCOPE_EFFECT, 'effect'],
	[SCOPE_DOF, 'depth of field'],
	[SCOPE_FOG_LIGHT, 'fog light'],
	[SCOPE_FOG_BLOCK, 'fog block'],
	[SCOPE_FOG_SUM, 'fog sum'],
	[SCOPE_FOG_APPLY, 'fog'],
	[SCOPE_TAA, 'anti-aliasing'],
	[SCOPE_VIEW_COPY, 'view copy'],
	[SCOPE_FULLSCREEN, 'full screen'],
	[SCOPE_COMPUTE, 'compute'],
	[SCOPE_TRANSMISSION_COPY, 'transmission'],
	[SCOPE_MOTION, 'motion'],
	[SCOPE_MOTION_VIEW, 'motion view'],
	[SCOPE_WEIGHTED, 'weighted layer'],
	[SCOPE_WEIGHTED_COMPOSITE, 'weighted composite'],
	[SCOPE_PARTICLE_DEPTH_COPY, 'particle depth'],
	[SCOPE_ACCUMULATE, 'accumulate'],
	[SCOPE_FINAL, 'final'],
	[SCOPE_FINAL_STILL, 'final'],
	[SCOPE_FINAL_BLOOM, 'final'],
	[SCOPE_OUTPUT, 'output'],
	[SCOPE_OUTPUT_BLOOM, 'output'],
]);

/** The scopes of a view, whose place is the sketch pass that the view draws into. */
const VIEWS: ReadonlySet<number> = new Set([
	SCOPE_CULL,
	SCOPE_PREPASS,
	SCOPE_OPAQUE,
	SCOPE_OCCLUDERS,
	SCOPE_PYRAMID,
	SCOPE_LATE_CULL,
	SCOPE_SHADOW,
	SCOPE_TRANSPARENT,
	SCOPE_VIEW_COPY,
	SCOPE_FULLSCREEN,
	SCOPE_COMPUTE,
]);

/** The kind of a scope: its step, without its place among steps of that kind. */
export function scopeKind(id: number): number {
	return id & 0xffff;
}

/** The place of a step among steps of its kind, such as the fourth step of bloom's chain. */
export function scopeIndex(id: number): number {
	return id >>> 16;
}

/**
 * The render pass that a scope's step draws into, for a step of a view, or 0 for a step of the
 * engine's own. A feature's scope names the passes that carry its work by this place.
 */
export function scopePlace(id: number): number {
	return VIEWS.has(scopeKind(id)) ? scopeIndex(id) : 0;
}

/**
 * The name of scope `id` for the overlay: the step's own name, such as `bloom 3`, and for a step
 * of a sketch's pass the pass's name from `passName` where the page knows it.
 */
export function scopeName(id: number, passName?: (place: number) => string | undefined): string {
	const kind = scopeKind(id);
	if (kind === SCOPE_NONE) return 'other';
	const name = NAMES.get(kind) ?? 'other';
	const place = scopeIndex(id);
	if (place === 0) return name;
	// A shadow step's place is the view of its cascade or tile, which the name does not need.
	if (kind === SCOPE_SHADOW) return name;
	if (VIEWS.has(kind)) return passName?.(place) ?? `${name} ${place}`;
	return `${name} ${place + 1}`;
}
