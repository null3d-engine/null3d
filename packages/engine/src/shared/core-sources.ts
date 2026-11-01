// The stamps of the Rust sources that the engine core must be built from. The repository's dev
// server serves the stamps of its checkout in place of this module, so development builds can tell
// a core built from other sources, such as one built before a merge. The list holds the current
// stamp and, while a transition lasts, the stamp that an earlier build key wrote for the same
// sources. Everywhere else the stamps stay undefined, and the check is skipped.

/** The stamps of the core's sources that a core may carry, or undefined when no dev server gives them. */
export const CORE_SOURCES: readonly string[] | undefined = undefined;
