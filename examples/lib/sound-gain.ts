// The gain that each recorded sound needs before a scene writes it at the level this repository's
// mixes are tuned at, which is -20 LUFS at a level of 1. The generated sounds were left at the
// level that their generator gave them — some forty decibels apart — so a scene that played them
// at the old numbers would make one scene inaudible and another painful. A scene multiplies each
// level it writes for one of them by the gain here, and keeps the tuning it had.

/** The gain that brings each sound to the mix's own level, from its measured integrated loudness. */
export const SOUND_GAIN = {
	/** Measured -40.8 LUFS. */
	wind: 11,
	/** Measured -44.0 LUFS. */
	leaves: 16,
	/** Measured -21.8 LUFS. */
	sea: 1.23,
	/** Measured -23.8 LUFS. */
	surf: 1.55,
	/** Measured -37.1 LUFS. */
	car: 7.2,
	/** Measured -12.9 LUFS. */
	bus: 0.44,
	/** Measured -38.0 LUFS. */
	stream: 7.9,
	/** Measured -15.5 LUFS, and its own peak passes full scale. */
	waterfall: 0.6,
	/** Measured -20.0 LUFS, and already at the mix's level. */
	rain: 1,
	/** Measured -29.0 LUFS. */
	thunderNear: 2.8,
	/** Measured -29.9 LUFS. */
	thunderFar: 3.1,
} as const;
