// Fresh copies of the device's shaders. Each shader's text gets a comment that no earlier start
// used, so the browser cannot reuse a program or module that it compiled from the same text before,
// in this page or in its shader cache on disk. Warm-up tests then time the compiles of a first visit.
import type { DeviceShaders, GlslStage, ShaderVariant } from '../generated/shaders';

/** A comment text that differs on every call. */
export const freshSalt = () =>
	`fresh ${Math.round(performance.timeOrigin + performance.now()).toString(36)} ${Math.random().toString(36).slice(2)}`;

/** A GLSL shader with the comment after its first line, which must stay the `#version` line. */
function saltGlsl(stage: GlslStage, salt: string): GlslStage {
	const end = stage.source.indexOf('\n');
	const source =
		end < 0
			? `${stage.source}\n// ${salt}\n`
			: `${stage.source.slice(0, end + 1)}// ${salt}\n${stage.source.slice(end + 1)}`;
	return { ...stage, source };
}

function saltVariant(variant: ShaderVariant, salt: string): ShaderVariant {
	return {
		...variant,
		wgsl: variant.wgsl && { ...variant.wgsl, source: `// ${salt}\n${variant.wgsl.source}` },
		glsl:
			variant.glsl &&
			Object.fromEntries(
				Object.entries(variant.glsl).map(([pipeline, program]) => [
					pipeline,
					{ vertex: saltGlsl(program.vertex, salt), fragment: saltGlsl(program.fragment, salt) },
				]),
			),
	};
}

/** A copy of the shaders in which every WGSL module and GLSL shader carries the comment `salt`. */
export function saltShaders(shaders: DeviceShaders, salt: string): DeviceShaders {
	return Object.fromEntries(
		Object.entries(shaders).map(([name, variants]) => [
			name,
			Object.fromEntries(
				Object.entries(variants as Record<string, ShaderVariant>).map(([key, variant]) => [
					key,
					saltVariant(variant, salt),
				]),
			),
		]),
	) as unknown as DeviceShaders;
}
