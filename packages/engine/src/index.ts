// The null3d engine: createEngine runs on the page, defineSketch in the sketch module, and the math
// helpers in both.

export type { Debug, DebugGridOptions, DebugLightOptions, DebugView } from './debug/debug';
export type { FrameStats, FrameStatsThread } from './debug/stats';
export type { StatsOverlayOptions } from './debug/stats-options';
export { EngineError } from './errors/engine-error';
export type { ErrorCode } from './errors/fixes';
export type { ShaderFeature } from './generated/shader-features';
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
export type { EulerOrder, Mat4Like, QuatLike, Vec2Like, Vec3Like } from './math/types';
/**
 * Vectors (x, y, z) in plain arrays, in the style of gl-matrix: `vec3.add(out, a, b)` writes the sum
 * into `out` and returns `out`, so per-frame code allocates nothing.
 *
 * @category api/math
 */
export * as vec3 from './math/vec3';
export type {
	CapabilityReport,
	WebGL2Report,
	WebGPUReport,
	WorkerProbeFailure,
} from './page/capabilities';
export type {
	Engine,
	EngineCapabilities,
	EngineMode,
	EngineOptions,
	RenderFallback,
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
export type { EngineLabels } from './page/labels';
export type { PointerLockOptions } from './page/pointer-lock';
export type { DepthMode, LatencyMode, SketchThread } from './page/switches';
export type { VideoOptions } from './page/videos';
export type { PresetCheck, PresetCheckRound, TargetFps } from './quality/check';
export type { DeviceHints } from './quality/chooser';
export type { QualityPreset, QualitySettings } from './quality/presets';
export type {
	AnimationEvent,
	AnimationEventHandler,
	Animator,
	BlendOptions,
	LookAtOptions,
	PlayOptions,
	StopOptions,
} from './scene/animation';
export type {
	Assets,
	GltfExtensionContext,
	GltfExtensionData,
	GltfExtensionHandler,
	GltfExtensionNode,
	GltfExtensionPart,
	GltfExtensionPrimitive,
	LoadGltfOptions,
	LoadImageOptions,
	LoadTextureOptions,
	ProgressHandler,
} from './scene/assets';
export type {
	AtmosphereBackground,
	AtmosphereOptions,
	BackgroundOptions,
	BackgroundSource,
	Cubemap,
	SkyBackground,
	SkyOptions,
} from './scene/background';
export type { ColorInput } from './scene/color';
export type { Effect, EffectOptions } from './scene/effects';
export type {
	BuiltinEnvironmentName,
	Environment,
	EnvironmentFormat,
	EnvironmentOptions,
} from './scene/environment';
export type {
	FeatureDraw,
	FeatureDrawOptions,
	FeatureDrawVertices,
} from './scene/feature-draws';
export type { FeatureHandle, FeatureHostOptions } from './scene/feature-host';
export { FeatureHost } from './scene/feature-host';
export type {
	FeatureBand,
	FeatureBudget,
	FeatureDescription,
	FeatureFrame,
	FeatureGovernor,
	FeatureKind,
	FeatureNeutral,
	FeatureOutput,
	FeatureQuality,
	FeatureReset,
	FeatureResource,
	FeatureSetting,
	FeatureSize,
	FeatureSlot,
	FeatureStats,
	FeatureValue,
	FeatureView,
	SceneInput,
} from './scene/features';
export { defineFeature, FeatureRegistry } from './scene/features';
export type { FogCurve, FogOptions, FogVolumeOptions } from './scene/fog';
export type { Ray } from './scene/frame-cameras';
export type { LightImagePixels } from './scene/light-images';
export type { BakeProbesOptions, LightProbeGridOptions } from './scene/light-probes';
export { bakeProbes, LightProbeGridData, ProbeBake } from './scene/light-probes';
export type {
	LineBatch,
	LineMaterial,
	LineMode,
	LineOptions,
	LineValues,
} from './scene/lines';
export type { Lut, LutData, LutDomain } from './scene/lut';
export type { AddonNamespace, ExportedNames } from './scene/namespaces';
export {
	AddonNamespaces,
	addonNamespaces,
	declareAddonNamespace,
} from './scene/namespaces';
export type {
	ParticleBuffer,
	ParticleBufferOptions,
	ParticleFacing,
	ParticleFlipbook,
	ParticleGroundMode,
	ParticleLook,
	ParticleMotion,
	ParticleValues,
} from './scene/particles';
export type { PickHit } from './scene/picks';
export type {
	ObjectEventHandler,
	ObjectEventType,
	ObjectPointerEvent,
} from './scene/pointer-events';
export type {
	AoSettings,
	AutoExposureSettings,
	BloomBlend,
	BloomSettings,
	DofSettings,
	ExposureMetering,
	GradingSettings,
	OutlineSettings,
	Post,
	PostSettings,
	SplitToningSettings,
	SsrSettings,
	ToneCurve,
	ToneMapping,
	VignetteSettings,
	WhiteBalanceSettings,
} from './scene/post';
export type { Prefab, PrefabBounds, PrefabNode } from './scene/prefab';
export type { ReflectionProbe, ReflectionProbeOptions } from './scene/probes';
export type {
	PropertyAnimation,
	PropertyInterpolation,
	PropertyKeyframes,
} from './scene/property-animation';
export type {
	OverlapHit,
	QueryOptions,
	QueryTarget,
	RaycastBatchHits,
	RaycastHit,
	RaycastOptions,
} from './scene/queries';
export type {
	FullscreenPassOptions,
	PassInput,
	PassScale,
	ReflectionPassOptions,
	ReflectionPlane,
	Render,
	RenderPass,
	RenderPassOptions,
	RenderPassSize,
	ScenePassOptions,
} from './scene/render';
export type {
	AlphaMode,
	Blending,
	BoxOptions,
	CapsuleOptions,
	CircleOptions,
	CompiledWgsl,
	ConeOptions,
	CylinderOptions,
	DecalOptions,
	DecalValues,
	DepthBias,
	Geometry,
	IntegerArray,
	Material,
	MaterialFeatures,
	MaterialOptions,
	Materials,
	MeshArrays,
	MeshGeometry,
	MeshLevel,
	MeshLevelOptions,
	MorphTargets,
	PlaneOptions,
	RingOptions,
	ShaderOptions,
	ShaderValues,
	ShadowCatcherOptions,
	ShadowCatcherValues,
	SphereOptions,
	StandardBaseOptions,
	StandardMaps,
	StandardOptions,
	StandardValues,
	TorusOptions,
	UnlitOptions,
	UnlitValues,
	UpdatableAttribute,
	UvTransform,
	VertexArray,
	VertexValues,
} from './scene/resources';
export type {
	AmbientLight,
	AmbientLightOptions,
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
	RectAreaLight,
	RectAreaLightOptions,
	Scene,
	SceneView,
	SceneViewOptions,
	SceneViewRect,
	SpotLight,
	SpotLightOptions,
	TubeLight,
	TubeLightOptions,
	Vec3,
} from './scene/scene';
export type {
	PointBatch,
	PointOptions,
	PointValues,
	SpriteAtlas,
	SpriteBatch,
	SpriteOptions,
	SpriteValues,
} from './scene/sprites';
export type {
	CanvasRect,
	CanvasTextureOptions,
	CompressedTextureFormat,
	Texture,
	TextureColorSpace,
	TextureData,
	TextureDataArray,
	TextureFilter,
	TextureFormat,
	TextureMemory,
	TextureOptions,
	Textures,
	TextureWrap,
} from './scene/textures';
export type {
	TimeOfDay,
	TimeOfDayAtmosphere,
	TimeOfDayOptions,
	TimeOfDayPreset,
} from './scene/time-of-day';
export { emptyTimeOfDay, timeOfDay } from './scene/time-of-day';
export type { VertexDrawBounds, VertexDrawOptions } from './scene/vertex-draws';
export { VertexDraw } from './scene/vertex-draws';
export type {
	TextureValues,
	UniformType,
	UniformValue,
	UniformValueByType,
	UniformValues,
	WgslTextures,
	WgslUniforms,
} from './scene/wgsl-uniforms';
export type { PhaseName } from './shared/metrics';
export { runTask } from './shared/run-task';
export type { Percentiles } from './shared/stats';
export { TaskFailure } from './shared/task-failure';
export { TaskLoadError } from './shared/task-load-error';
export type { Task, WasmFile } from './shared/tasks';
export type { Tier } from './shared/tier';
export type { PluginInterfaceRange } from './shared/version';
export {
	checkAddonVersion,
	checkPluginInterface,
	PLUGIN_INTERFACE_VERSION,
	VERSION,
} from './shared/version';
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
export type {
	Quality,
	QualityBudget,
	QualityBudgetOptions,
	QualityGovernor,
} from './sketch/quality';
export type { LabelOptions, LabelTransform, Ui } from './sketch/ui';
export type { WorkerProbe } from './workers/probe-worker';
export type { TaskModule, TaskResult, TaskStage } from './workers/tasks';
