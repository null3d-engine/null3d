//! Backgrounds: what the camera's view draws behind every object, as three.js draws
//! `scene.background`. A background is one of four sources:
//!
//! - A texture, which covers the whole view and stretches to its size, with its first row at the
//!   bottom, as it sits on a plane.
//! - An environment map (see [`crate::environment`]), read in each pixel's direction at the level
//!   that holds the blur's roughness, as three.js reads its PMREM with `backgroundBlurriness`.
//! - A cube map of six images, read in each pixel's direction. Like three.js, it reads the map
//!   mirrored across x, as three.js's `CubeTextureLoader` maps are seen from inside the cube.
//! - three.js's analytic sky (`Sky` in its examples), from the sun's position, the air's
//!   scattering and the clouds.
//!
//! Each draws at the far plane in the camera's opaque pass, after the opaque objects and before
//! the transparent ones, with the depth test on and no depth write. It shades only the pixels
//! where no object wrote depth, so a costly background such as the sky costs nothing where objects
//! cover it. Drawn first, it would shade the whole view on GPUs that do not drop the fragments that
//! later objects cover. A depth write would store the far plane where the target already holds
//! it, so it writes none. On a Galaxy S25 (Adreno 830), a scene pass with a background takes about
//! 4.8 ms more GPU time, but any other extra object costs the same, so the background's order,
//! shape and depth state do not change it (D-68). While an opaque material writes no depth, the
//! background draws first with no depth test instead, as three.js draws `scene.background`, so
//! that material still shows over it. Its color goes into the scene color like an object's, so
//! exposure and tone mapping change it too: its shader multiplies the exposure into its light,
//! with the background's intensity, as three.js's `backgroundIntensity`.
//!
//! The texture draws as one triangle over the whole target. It binds the bind group of the
//! texture's array and sampler, as materials bind their maps, and names the texture's layer by its
//! first vertex: the shader reads the layer as its vertex index divided by three. The cube map and
//! the sky draw as a box around the camera, as three.js draws them, so each fragment's direction
//! comes from the view's own matrix. An orthographic camera's view rays are parallel, so the box
//! becomes one triangle over the view in the view's direction.
//!
//! The pass keeps a small uniform buffer of the background's values, written only when they
//! change, and a bind group of the buffer, the cube texture and its sampler. The texture
//! background reads the buffer for its intensity alone. The pipeline exists from the frame after
//! the sketch sets the background, so it builds while a texture loads. Until the texture's texels
//! are on the GPU, and once the texture is destroyed, the pass draws nothing, and the view shows
//! the background color.

use null3d_core::handle::Handle;
use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, layout as bind_layout, resource_kind, sizes, state_flags,
    template,
};

use crate::bloom::bytes_of;
use crate::environment::inverse_rotation;
use crate::frame::{RecordError, SceneSettings, UploadArena, bind_frame_group};
use crate::pipelines::{DepthBias, DrawKey, PassTargets, PipelineCache};

/// What a background shows, and the texture it reads.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum BackgroundSource {
    /// A 2D texture that fills the view.
    Texture(Handle),
    /// The cube texture of an environment map, whose levels hold its light for each roughness.
    Environment(Handle),
    /// A cube texture of six images, of one level.
    Cubemap(Handle),
    /// three.js's analytic sky.
    Sky(Sky),
}

/// The scene's background as the sketch sets it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Background {
    pub source: BackgroundSource,
    /// The factor of the background's light, as three.js's `scene.backgroundIntensity`.
    pub intensity: f32,
    /// How much an environment blurs, as a roughness from 0 to 1, as three.js's
    /// `scene.backgroundBlurriness`. Other sources ignore it.
    pub blur: f32,
    /// The turn of a cube map or an environment about the scene, as Euler angles in radians in
    /// three.js's default order, X then Y then Z, as `scene.backgroundRotation`.
    pub rotation: [f32; 3],
}

/// three.js's sky, with the names of its uniforms.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sky {
    /// A point toward the sun. Its direction places the sun, and its height fades the sun once it
    /// sinks hundreds of thousands of units below the horizon, as three.js's `sunPosition`.
    pub sun_position: [f32; 3],
    pub turbidity: f32,
    pub rayleigh: f32,
    pub mie_coefficient: f32,
    pub mie_directional_g: f32,
    pub cloud_scale: f32,
    pub cloud_speed: f32,
    pub cloud_coverage: f32,
    pub cloud_density: f32,
    pub cloud_elevation: f32,
    /// The time in seconds that moves the clouds.
    pub time: f32,
    /// True where the sky shows the sun's disc.
    pub sun_disc: bool,
}

impl Default for Sky {
    /// three.js's defaults, with the sun on the horizon at +Z.
    fn default() -> Self {
        Self {
            sun_position: [0.0, 0.0, 1.0],
            turbidity: 2.0,
            rayleigh: 1.0,
            mie_coefficient: 0.005,
            mie_directional_g: 0.8,
            cloud_scale: 0.0002,
            cloud_speed: 0.00002,
            cloud_coverage: 0.4,
            cloud_density: 0.4,
            cloud_elevation: 0.5,
            time: 0.0,
            sun_disc: true,
        }
    }
}

/// The background's uniform block, laid out as the shaders' `Backdrop` reads it.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct BackdropUniform {
    /// The rows of the matrix that turns a direction in the world into the cube map's direction.
    rotation: [[f32; 4]; 3],
    /// The intensity, the blur, the cube map's last mip level, and a spare.
    params: [f32; 4],
    /// The sun's position, and 1 where the sky shows its disc.
    sun: [f32; 4],
    /// The turbidity, the Rayleigh and Mie coefficients, and the Mie directional g.
    scattering: [f32; 4],
    /// The cloud scale, speed, coverage and density.
    clouds: [f32; 4],
    /// The cloud elevation, the time, and two spares.
    cloud_place: [f32; 4],
}

const _: () =
    assert!(std::mem::size_of::<BackdropUniform>() == sizes::BACKGROUND_UNIFORM_BYTES as usize);

impl BackdropUniform {
    /// The values of `background`, whose cube texture, if it reads one, has `levels` mip levels.
    fn of(background: &Background, levels: u32) -> Self {
        let mut uniform = Self {
            rotation: inverse_rotation(background.rotation),
            params: [
                background.intensity,
                0.0,
                levels.saturating_sub(1) as f32,
                0.0,
            ],
            ..Self::default()
        };
        match background.source {
            BackgroundSource::Environment(_) => uniform.params[1] = background.blur,
            // three.js mirrors a cube texture across x, so a map of six images reads as seen from
            // inside its cube.
            BackgroundSource::Cubemap(_) => {
                for value in &mut uniform.rotation[0] {
                    *value = -*value;
                }
            }
            BackgroundSource::Sky(sky) => {
                let [x, y, z] = sky.sun_position;
                uniform.sun = [x, y, z, if sky.sun_disc { 1.0 } else { 0.0 }];
                uniform.scattering = [
                    sky.turbidity,
                    sky.rayleigh,
                    sky.mie_coefficient,
                    sky.mie_directional_g,
                ];
                uniform.clouds = [
                    sky.cloud_scale,
                    sky.cloud_speed,
                    sky.cloud_coverage,
                    sky.cloud_density,
                ];
                uniform.cloud_place = [sky.cloud_elevation, sky.time, 0.0, 0.0];
            }
            BackgroundSource::Texture(_) => {}
        }
        uniform
    }
}

/// The GPU ids of the pass's objects, and of the objects it binds that the builder makes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct BackgroundIds {
    /// The uniform buffer of the background's values.
    pub buffer: u32,
    /// The bind group of the buffer, the cube texture and its sampler.
    pub group: u32,
    /// The blank cube that the group binds when the background reads no cube texture.
    pub blank_cube: u32,
    /// The filtering sampler of cube textures.
    pub sampler: u32,
}

/// The index at which the texture background binds the texture's group, after the frame's group.
const TEXTURE_GROUP: u32 = 1;

/// Where the background draws in the camera's opaque pass.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Place {
    /// Before the objects, with no depth test, while an opaque material writes no depth: the
    /// objects draw over every pixel of it.
    First,
    /// After the opaque objects, at the far plane, only where no object wrote depth.
    Last,
}

impl Place {
    /// First while an opaque material writes no depth (`depthless`), else last.
    pub(crate) const fn of(depthless: bool) -> Self {
        if depthless { Self::First } else { Self::Last }
    }

    /// The depth state of the background's pipeline in this place.
    const fn depth_state(self) -> u32 {
        match self {
            Self::First => state_flags::NO_DEPTH_TEST,
            Self::Last => state_flags::DEPTH_OR_EQUAL | state_flags::NO_DEPTH_WRITE,
        }
    }
}

/// How the frame's background draws.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Shape {
    /// The triangle over the view of a texture: the bind group of the texture's array and
    /// sampler, and the texture's layer in its array.
    Texture { group: u32, layer: u32 },
    /// The box around the camera of a cube map or the sky.
    Box,
}

/// The draw of one frame's background.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Draw {
    pipeline: u32,
    shape: Shape,
    place: Place,
}

/// The background's pipeline, its buffer and bind group, and the draw of the frame being recorded.
#[derive(Debug)]
pub(crate) struct BackgroundPass {
    ids: BackgroundIds,
    /// The id of the pipeline, from the builder's pipeline cache, or 0 without a background.
    pipeline: u32,
    /// Where the pipeline draws.
    place: Place,
    draw: Option<Draw>,
    /// True once the GPU has the uniform buffer.
    created: bool,
    /// The GPU id and the handle of the cube texture that the group binds, or none before the
    /// group is made. A destroyed texture's GPU id may come back for another texture.
    bound: Option<(u32, Handle)>,
    /// The values in the buffer, once written.
    written: Option<BackdropUniform>,
}

impl BackgroundPass {
    /// Bytes a frame may copy into its arena: the whole uniform block.
    pub(crate) const UPLOAD_BYTES: usize = sizes::BACKGROUND_UNIFORM_BYTES as usize;

    pub(crate) fn new(ids: BackgroundIds) -> Self {
        Self {
            ids,
            pipeline: 0,
            place: Place::Last,
            draw: None,
            created: false,
            bound: None,
            written: None,
        }
    }

    /// Asks `pipelines` for the pipeline of the scene's background, which draws into the scene's
    /// `targets` in `place`, while its texture lives or it reads none. A builder asks before it
    /// records the pipelines that its frame creates, so the list creates this one with the others,
    /// at its start.
    pub(crate) fn request_pipeline(
        &mut self,
        settings: &SceneSettings,
        pipelines: &mut PipelineCache,
        targets: PassTargets,
        place: Place,
    ) {
        let live = |texture| settings.textures().is_live(texture);
        let template =
            match settings.background().map(|b| b.source) {
                Some(BackgroundSource::Texture(texture)) if live(texture) => template::BACKGROUND,
                Some(
                    BackgroundSource::Environment(texture) | BackgroundSource::Cubemap(texture),
                ) if live(texture) => template::BACKGROUND_CUBE,
                Some(BackgroundSource::Sky(_)) => template::BACKGROUND_SKY,
                _ => 0,
            };
        self.place = place;
        self.pipeline = if template == 0 {
            0
        } else {
            let state = if template == template::BACKGROUND {
                place.depth_state()
            } else {
                place.depth_state() | state_flags::CULL_NONE
            };
            let key = DrawKey {
                template,
                permutation: 0,
                vertex_format: 0,
                state,
                bias: DepthBias::NONE,
            };
            pipelines.id(key.in_pass(targets.tone_map_only()))
        };
    }

    /// Finds the frame's draw once the frame recorded its texture work, and makes what it binds:
    /// the uniform buffer when the GPU lacks it, the values when they changed, and the group when
    /// the cube texture it binds changed. A texture or cube map draws once its texels are on the
    /// GPU.
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        settings: &SceneSettings,
    ) -> Result<(), RecordError> {
        self.draw = None;
        let Some(background) = settings.background().filter(|_| self.pipeline != 0) else {
            return Ok(());
        };
        let textures = settings.textures();
        let blank = (self.ids.blank_cube, Handle::NONE);
        let (shape, cube, levels) = match background.source {
            BackgroundSource::Texture(texture) => {
                let (Some(layer), Some(group)) =
                    (textures.ready_layer(texture), textures.group_id(texture))
                else {
                    return Ok(());
                };
                (Shape::Texture { group, layer }, blank, 1)
            }
            BackgroundSource::Environment(texture) | BackgroundSource::Cubemap(texture) => {
                let Some((cube, levels)) = textures.ready_cube(texture) else {
                    return Ok(());
                };
                (Shape::Box, (cube, texture), levels)
            }
            BackgroundSource::Sky(_) => (Shape::Box, blank, 1),
        };
        let ids = self.ids;
        if !self.created {
            list.push(
                Op::CreateBuffer,
                &[
                    ids.buffer,
                    sizes::BACKGROUND_UNIFORM_BYTES,
                    usage::UNIFORM | usage::COPY_DST,
                ],
            )?;
            self.created = true;
        }
        let uniform = BackdropUniform::of(&background, levels);
        if self.written != Some(uniform) {
            let (at, bytes) = arena.push(bytes_of(&uniform))?;
            list.push(Op::WriteBuffer, &[ids.buffer, 0, at, bytes])?;
            self.written = Some(uniform);
        }
        if self.bound != Some(cube) {
            list.push(
                Op::CreateBindGroup,
                &[
                    ids.group,
                    bind_layout::BACKGROUND,
                    3,
                    0,
                    resource_kind::BUFFER,
                    ids.buffer,
                    0,
                    sizes::BACKGROUND_UNIFORM_BYTES,
                    1,
                    resource_kind::TEXTURE,
                    cube.0,
                    0,
                    0,
                    2,
                    resource_kind::SAMPLER,
                    ids.sampler,
                    0,
                    0,
                ],
            )?;
            self.bound = Some(cube);
        }
        self.draw = Some(Draw {
            pipeline: self.pipeline,
            shape,
            place: self.place,
        });
        Ok(())
    }

    /// Records the background inside the render pass that the camera's opaque pass began, at
    /// `place` among its objects, with the view's frame group `frame_group` bound at the dynamic
    /// offsets `offsets` as the opaque pass binds it. It records nothing without a background whose
    /// texels are on the GPU, or when the background draws in the other place. It sets every
    /// binding it reads, so it can follow a render bundle, which clears them.
    pub(crate) fn record(
        &self,
        list: &mut DrawList,
        frame_group: u32,
        offsets: &[u32],
        place: Place,
    ) -> Result<(), RecordError> {
        let Some(draw) = self.draw.filter(|draw| draw.place == place) else {
            return Ok(());
        };
        list.push(Op::SetPipeline, &[draw.pipeline])?;
        bind_frame_group(list, frame_group, offsets)?;
        match draw.shape {
            Shape::Texture { group, layer } => {
                list.push(Op::SetBindGroup, &[TEXTURE_GROUP, group, 0])?;
                list.push(Op::SetBindGroup, &[TEXTURE_GROUP + 1, self.ids.group, 0])?;
                list.push(Op::Draw, &[3, 1, layer * 3, 0])?;
            }
            Shape::Box => {
                list.push(Op::SetBindGroup, &[1, self.ids.group, 0])?;
                list.push(Op::Draw, &[36, 1, 0, 0])?;
            }
        }
        Ok(())
    }

    /// Forgets the GPU's objects after the GPU was lost, so the next frame makes them again.
    pub(crate) fn reset_gpu(&mut self) {
        self.created = false;
        self.bound = None;
        self.written = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn background(source: BackgroundSource) -> Background {
        Background {
            source,
            intensity: 2.0,
            blur: 0.5,
            rotation: [0.0, 0.0, 0.0],
        }
    }

    #[test]
    fn an_environment_takes_its_blur_and_its_last_level() {
        let uniform =
            BackdropUniform::of(&background(BackgroundSource::Environment(Handle::NONE)), 9);
        assert_eq!(uniform.params, [2.0, 0.5, 8.0, 0.0]);
        assert_eq!(uniform.rotation[0], [1.0, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn a_cube_map_reads_mirrored_across_x_and_takes_no_blur() {
        let uniform = BackdropUniform::of(&background(BackgroundSource::Cubemap(Handle::NONE)), 1);
        assert_eq!(uniform.params, [2.0, 0.0, 0.0, 0.0]);
        assert_eq!(uniform.rotation[0], [-1.0, 0.0, 0.0, 0.0]);
        assert_eq!(uniform.rotation[1], [0.0, 1.0, 0.0, 0.0]);
        assert_eq!(uniform.rotation[2], [0.0, 0.0, 1.0, 0.0]);
    }

    #[test]
    fn the_sky_writes_three_js_uniforms_in_place() {
        let sky = Sky {
            sun_position: [1.0, 2.0, 3.0],
            sun_disc: false,
            time: 7.0,
            ..Sky::default()
        };
        let uniform = BackdropUniform::of(&background(BackgroundSource::Sky(sky)), 1);
        assert_eq!(uniform.sun, [1.0, 2.0, 3.0, 0.0]);
        assert_eq!(uniform.scattering, [2.0, 1.0, 0.005, 0.8]);
        assert_eq!(uniform.clouds, [0.0002, 0.00002, 0.4, 0.4]);
        assert_eq!(uniform.cloud_place, [0.5, 7.0, 0.0, 0.0]);
        assert_eq!(uniform.params[1], 0.0, "only environments blur");
    }
}
