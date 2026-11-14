// Caps what a run may hold, so a test that grows past its need stops with a message that names the
// ceiling rather than taking the machine's memory. The unit script loads this as a preload and sets
// `NULL3D_TEST_MEMORY_MIB`; a run that does not set it is not capped. Bun's own memory knobs do not
// stop a run: `BUN_JSC_forceRAMSize` sets the size that the JavaScript heap grows towards, which a
// fast allocation passes without failing (.dev/tests.md has the measurement), so the run is watched
// instead.
const ceilingMiB = Number(process.env.NULL3D_TEST_MEMORY_MIB ?? 0);

/** How often the run's memory is read: often enough to catch a runaway while it is still small. */
const EVERY_MS = 100;

if (ceilingMiB > 0) {
	const ceiling = ceilingMiB * 1024 * 1024;
	const watch = setInterval(() => {
		const held = process.memoryUsage.rss();
		if (held <= ceiling) return;
		console.error(
			`the run holds ${Math.round(held / 1048576)} MiB, past the ${ceilingMiB} MiB ceiling of NULL3D_TEST_MEMORY_MIB. ` +
				'A check that needs more than the ceiling usually needs splitting, or a process of its own: .dev/tests.md says how.',
		);
		process.exit(1);
	}, EVERY_MS);
	// The watch never holds a run open: a run ends when its tests do.
	watch.unref();
}
