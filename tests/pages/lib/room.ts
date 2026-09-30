// What the shared memory page and the judge of its results agree on.

/**
 * Room for shared memories that the page may lose over its restarts: the single-threaded build's
 * page keeps one core for the next engine.
 */
export const ROOM_KEPT = 1;
