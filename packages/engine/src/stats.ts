// `@null3d/engine/stats`: the stats overlay's panel, its figures and text layout, the page's own
// meters, and the percentiles and rates of per-frame samples. A page that draws with another
// engine, such as three.js, uses them to show its figures in the same panel and layout as null3D's
// overlay, measured by the same code. The engine's start does not load this module.

export {
	MainThreadWindow,
	type MemoryMeasurement,
	type PageMemory,
	PageMemorySampler,
	pageHeapBytes,
} from './debug/page-meters';
export {
	type StatsFrameMode,
	StatsPanel,
	type StatsPanelFrame,
	type StatsPanelOptions,
} from './debug/stats-panel';
export {
	type StatsFigures,
	type StatsMainThread,
	type StatsMemory,
	type StatsThread,
	statsText,
} from './debug/stats-text';
export { countPerSecond, type Percentiles, percentiles, ratePerSecond } from './shared/stats';
