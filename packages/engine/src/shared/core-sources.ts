// The stamp of the Rust sources that the engine core must be built from. The repository's dev
// server serves the stamp of its checkout in place of this module, so development builds can tell
// a core built from other sources, such as one built before a merge. Everywhere else the stamp
// stays undefined, and the check is skipped.

/** The stamp of the core's sources, or undefined when no dev server gives one. */
export const CORE_SOURCES: string | undefined = undefined;
