// The null3d engine: createEngine runs on the page, defineSketch in the sketch module, and the math
// helpers in both.

export type { Debug, DebugGridOptions, DebugLightOptions, DebugView } from './debug/debug';
export type { FrameStats, FrameStatsThread } from './debug/stats';
export { EngineError } from './errors/engine-error';
export type { ErrorCode } from './errors/fixes';
/**
 * Colors as linear RGB in plain arrays of three numbers, from hex colors, sRGB components, or hue,
 * saturation and lightness: `color.fromHex(out, '#ff8800')`.
 *
 * @category api/math
 */
export * as color from './math/color';
/**
 * 4 by 4 matrices in plain arrays of 16 numbers, stored column by column: `mat4.multiply(out, a, b)`
 * writes the product into `out` and returns `out`.
 *
 * @category api/math
 */
export * as mat4 from './math/mat4';
/**
 * Number helpers with three.js's names, such as `math.clamp` and `math.damp`, and a random generator
 * that a sketch can seed and that hold mode seeds.
 *
 * @category api/math
 */
export * as math from './math/math';
/**
 * Rotations as quaternions (x, y, z, w) in plain arrays, with angles in radians:
 * `quat.setAxisAngle(out, [0, 1, 0], angle)` writes the rotation into `out` and returns `out`.
 *
 * @category api/math
 */
export * as quat from './math/quat';
export type { EulerOrder, Mat4Like, QuatLike, Vec3Like } from './math/types';
/**
 * Vectors (x, y, z) in plain arrays, in the style of gl-matrix: `vec3.add(out, a, b)` writes the sum
 * into `out` and returns `out`, so per-frame code allocates nothing.
 *
 * @category api/math
 */
export * as vec3 from './math/vec3';
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
	GpuPassStats,
	MainThreadStats,
	MemoryStats,
	SecondRates,
	ThreadStats,
} from './page/frame-stats';
export type { HeldFrame, HoldFailure, HoldResult } from './page/hold';
export type { DepthMode, LatencyMode, SketchThread } from './page/switches';
export type { PresetCheck, PresetCheckRound } from './quality/check';
export type { DeviceHints } from './quality/chooser';
export type { QualityPreset, QualitySettings } from './quality/presets';
export type {
	AnimationEvent,
	AnimationEventHandler,
	Animator,
	PlayOptions,
	StopOptions,
} from './scene/animation';
export type {
	Assets,
	LoadImageOptions,
	LoadTextureOptions,
	ProgressHandler,
} from './scene/assets';
export type { ColorInput } from './scene/color';
export type { Exp2FogOptions, FogOptions, LinearFogOptions } from './scene/fog';
export type { Ray } from './scene/frame-cameras';
export type { Lut, LutDomain } from './scene/lut';
export type {
	AoSettings,
	BloomSettings,
	Post,
	PostSettings,
	ToneMapping,
	VignetteSettings,
} from './scene/post';
export type { Prefab, PrefabBounds, PrefabNode } from './scene/prefab';
export type {
	OverlapHit,
	QueryOptions,
	RaycastBatchHits,
	RaycastHit,
	RaycastOptions,
} from './scene/queries';
export type {
	AlphaMode,
	Blending,
	BoxOptions,
	CapsuleOptions,
	CircleOptions,
	CompiledWgsl,
	ConeOptions,
	CylinderOptions,
	DepthBias,
	Geometry,
	IntegerArray,
	Material,
	MaterialFeatures,
	MaterialOptions,
	Materials,
	MeshArrays,
	MeshGeometry,
	PlaneOptions,
	RingOptions,
	ShaderOptions,
	ShaderValues,
	SphereOptions,
	StandardBaseOptions,
	StandardMaps,
	StandardOptions,
	StandardValues,
	TorusOptions,
	UnlitOptions,
	UnlitValues,
	UvTransform,
	VertexArray,
	VertexValues,
} from './scene/resources';
export type {
	AmbientLight,
	Camera,
	CameraOptions,
	DirectionalLight,
	DirectionalLightOptions,
	DirectionalShadowOptions,
	Group,
	HemisphereLight,
	HemisphereLightOptions,
	InstanceBatch,
	InstanceOptions,
	InstantiateOptions,
	Light,
	LightOptions,
	LightShadowOptions,
	Mesh,
	MeshOptions,
	NodeOptions,
	Object3D,
	OrthographicCamera,
	OrthographicCameraOptions,
	ParentOptions,
	PerspectiveCamera,
	PerspectiveCameraOptions,
	PointLight,
	PointLightOptions,
	PrefabInstance,
	Quat,
	Scene,
	SpotLight,
	SpotLightOptions,
	Vec3,
} from './scene/scene';
export type {
	SpriteAtlas,
	SpriteBatch,
	SpriteOptions,
	SpriteValues,
} from './scene/sprites';
export type {
	CompressedTextureFormat,
	Texture,
	TextureColorSpace,
	TextureData,
	TextureDataArray,
	TextureFilter,
	TextureFormat,
	TextureOptions,
	Textures,
	TextureWrap,
} from './scene/textures';
export type {
	UniformType,
	UniformValue,
	UniformValueByType,
	UniformValues,
	WgslUniforms,
} from './scene/wgsl-uniforms';
export type { PhaseName } from './shared/metrics';
export type { Percentiles } from './shared/stats';
export type { Tier } from './shared/tier';
export type {
	SketchCallbacks,
	SketchContext,
	SketchDefinition,
	SketchEngine,
	SketchOptions,
	SketchPreferences,
	SketchSetup,
	SketchTime,
	SketchViewport,
} from './sketch/define-sketch';
export { defineSketch } from './sketch/define-sketch';
export type { Input, InputActions, InputPointer, InputTouch } from './sketch/input';
export type { Quality, QualityGovernor } from './sketch/quality';
export type { WorkerProbe } from './workers/probe-worker';

/**
 * The engine version, which the WebAssembly core and this package always share.
 *
 * @category api/engine
 */
export const VERSION = '0.0.0';
