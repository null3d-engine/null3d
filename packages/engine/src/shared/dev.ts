// Whether this is a development build. The Vite plugin defines the constant: true on the dev
// server and false in production builds, where every check behind it becomes dead code and leaves
// the download. Where nothing defines it, as in unit tests, the engine counts as a development
// build. The module holds a constant only, so the bundler folds it into each file that reads it,
// and the files that load on first use share no module with the start's files.

declare const __NULL3D_DEV__: boolean | undefined;

/** True in development builds, and whenever no bundler has defined the constant. */
export const DEV: boolean = typeof __NULL3D_DEV__ === 'undefined' ? true : __NULL3D_DEV__;

declare const __NULL3D_URL_SWITCHES__: boolean | undefined;

/**
 * True when the page's address may set the engine's test switches, such as ?gpu= and ?hold=: in
 * development builds, and in production builds that ask for them, as test and benchmark pages do.
 * A shipped game ignores them, so a link cannot change how it runs.
 */
export const URL_SWITCHES: boolean =
	typeof __NULL3D_URL_SWITCHES__ === 'undefined' ? DEV : __NULL3D_URL_SWITCHES__;
