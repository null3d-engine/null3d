// A version that no release of the engine shares with the one that runs, for the tests that need an
// add-on built for another engine version. A fixed version stops being "other" on the release that
// takes it.

/** One major release past `version`, which no release of that engine has. */
export function otherVersion(version: string): string {
	return `${Number(version.split('.')[0]) + 1}.0.0`;
}
