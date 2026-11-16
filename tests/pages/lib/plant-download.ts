// What the plant download page reports: every file that the sketch's thread fetched, with the time
// it started, and the times at which the sketch began to load and to prepare each species, all on
// the sketch thread's own clock.

/** One file the sketch's thread fetched. */
export interface Download {
	readonly url: string;
	readonly start: number;
}

/** The page's report. */
export interface DownloadReport {
	readonly preset: string;
	/** The time the sketch started, after the add-on's code had loaded. */
	readonly started: number;
	readonly species: readonly {
		readonly id: string;
		readonly loading: number;
		readonly preparing: number;
	}[];
	readonly downloads: readonly Download[];
}
