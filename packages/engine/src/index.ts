// The sokko3d engine: createEngine runs on the page, defineGame in the game module.

export type { ErrorCode } from './errors/codes';
export { EngineError } from './errors/engine-error';
export type { GameCallbacks, GameContext, GameDefinition, GameSetup } from './game/define-game';
export { defineGame } from './game/define-game';
export type { CapabilityReport } from './page/capabilities';
export type { Engine, EngineCapabilities, EngineMode, EngineOptions } from './page/engine';
export { createEngine } from './page/engine';
export type { FrameMetrics, FrameSummary, MemoryStats, ThreadStats } from './page/frame-stats';
export type { Tier } from './render/renderer';
export type { PhaseName } from './shared/metrics';
export type { Percentiles } from './shared/stats';

/** The engine version, which the WebAssembly core and this package always share. */
export const VERSION = '0.0.0';
