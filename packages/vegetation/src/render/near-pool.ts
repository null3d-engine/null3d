// The near pool: one per scene. It reads the camera once a frame and, when the camera has moved
// half a metre or turned five degrees, starts the near task that picks the copies nearest the camera
// within the preset's caps and composes their shoot rows. Until the pool is built, a page that asks
// for `placeholders` gets a pool that draws no real shoots, and any other page an error.
import type { SketchContext } from '@null3d/engine';
import { notBuilt } from '../core/not-built';
import { standInNearPool } from './stand-in';

/**
 * The near pool's caps; the preset's by default.
 *
 * @category api/vegetation
 */
export interface NearPoolOptions {
	/** Copies that draw real shoots. */
	readonly copies?: number;
	/** Triangles those copies' shoots may draw together. */
	readonly triangles?: number;
	/** A pool for stand-in kits, which draws no real shoots while the near pool is not built. */
	readonly placeholders?: boolean;
}

/**
 * The scene's near pool: which copies draw real shoots.
 *
 * @category api/vegetation
 */
export interface NearPool {
	/** Reads the camera; starts the near task when it has moved 0.5 m or turned 5 degrees. Allocates nothing. */
	update(): void;
	/** Copies drawing real shoots now, for the stats overlay and the tests. */
	readonly copies: number;
	/** Triangles of real shoots drawn now. */
	readonly triangles: number;
	/** Removes the pool's batches and stops its task. */
	destroy(): void;
}

/**
 * Makes the scene's near pool.
 *
 * @param ctx The sketch's context.
 * @param options The caps; the preset's by default.
 * @returns The pool.
 * @category api/vegetation
 */
export function createNearPool(ctx: SketchContext, options?: NearPoolOptions): NearPool {
	void ctx;
	if (options?.placeholders) return standInNearPool();
	throw notBuilt('the near pool');
}
