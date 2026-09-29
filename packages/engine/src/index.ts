// The null3d engine: createEngine runs on the page, defineSketch in the sketch module.

export { EngineError } from './errors/engine-error';
export type { ErrorCode } from './errors/fixes';
export type { CapabilityReport, WebGL2Report, WebGPUReport } from './page/capabilities';
export type {
	Engine,
	EngineCapabilities,
	EngineMode,
	EngineOptions,
	StartupStage,
} from './page/engine';
export { createEngine } from './page/engine';
export type {
	FrameMetrics,
	FrameSummary,
	MainThreadStats,
	MemoryStats,
	ThreadStats,
} from './page/frame-stats';
export type { HeldFrame, HoldFailure, HoldResult } from './page/hold';
export type { LatencyMode } from './page/switches';
export type { Tier } from './render/renderer';
export type { ColorInput } from './scene/color';
export type {
	BoxOptions,
	Geometry,
	Material,
	MaterialOptions,
	Materials,
	MeshArrays,
	MeshGeometry,
	SphereOptions,
} from './scene/resources';
export type { EulerOrder } from './scene/rotation';
export type {
	AmbientLight,
	Camera,
	CameraOptions,
	DirectionalLight,
	DirectionalLightOptions,
	Group,
	InstanceBatch,
	InstanceOptions,
	LightOptions,
	Mesh,
	MeshOptions,
	NodeOptions,
	Object3D,
	Quat,
	Scene,
	Vec3,
} from './scene/scene';
export type { PhaseName } from './shared/metrics';
export type { Percentiles } from './shared/stats';
export type {
	SketchCallbacks,
	SketchContext,
	SketchDefinition,
	SketchPreferences,
	SketchSetup,
} from './sketch/define-sketch';
export { defineSketch } from './sketch/define-sketch';
export type { WorkerProbe } from './workers/probe-worker';

/**
 * The engine version, which the WebAssembly core and this package always share.
 *
 * @category api/engine
 */
export const VERSION = '0.0.0';
