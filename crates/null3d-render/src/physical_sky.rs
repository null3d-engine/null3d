//! The physical sky: Rayleigh and Mie scattering and ozone over a round planet, from Hillaire's
//! three lookup tables (2020), as Unreal Engine and Bevy draw it (D-143).
//!
//! The sketch sets it with `scene.setBackground({ atmosphere })`. Its pass keeps four textures of
//! 16-bit floats, which one shader draws, each as one triangle over the whole texture:
//!
//! - the transmittance table, 256 x 64, the share of light that passes from each height to the
//!   top of the air along each angle;
//! - the multiple scattering table, 32 x 32, the light that scatters more than once, for each
//!   height and sun angle;
//! - the sky view table, 256 x 128, the whole sky's light seen from the camera's height;
//! - the panorama, 512 x 256, the sky view with the clouds, which a sky map's stages read
//!   ([`crate::sky_maps`]).
//!
//! The first two hold the air alone, so they draw again only when the air changes. The sky view
//! draws again when the air, the sun, the moon or the camera's height changes, and the panorama
//! when a sky map starts a refresh. While the scene draws no physical sky, the pass records
//! nothing and makes no GPU object. A table draws only once its pipeline is built: until then
//! the pass draws it again each frame, and the background waits.
//!
//! The background ([`crate::background`]) reads the sky view in each pixel's direction with the
//! pass's bind group. The aerial perspective, the air between the camera and each surface, needs
//! no table: [`AerialUniform`] gives the shaders' fog step the values of each frame.

use null3d_gpu::drawlist::{
    DrawList, NO_TARGET, Op, address, buffer_usage as usage, compare, format,
    layout as bind_layout, pass_flags, resource_kind, state_flags, template, texture_usage, view,
};

use crate::bloom::bytes_of;
use crate::frame::{LINEAR_LEVEL, RecordError, SceneSettings, UploadArena, clamp_sampler};
use crate::physical_sky_light::AirModel;
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey};

/// The planet's radius and the top of its air, in kilometres, as Hillaire's earth.
pub const BOTTOM_RADIUS: f32 = 6360.0;
pub const TOP_RADIUS: f32 = 6460.0;
/// Rayleigh's scattering per kilometre at the ground, for the primaries' wavelengths.
pub const RAYLEIGH_SCATTERING: [f32; 3] = [5.802e-3, 13.558e-3, 33.1e-3];
/// The height over which Rayleigh's density falls by a factor of e, in kilometres.
pub const RAYLEIGH_HEIGHT: f32 = 8.0;
/// Mie's scattering and extinction per kilometre at the ground.
pub const MIE_SCATTERING: f32 = 3.996e-3;
pub const MIE_EXTINCTION: f32 = 4.40e-3;
/// The height over which Mie's density falls by a factor of e, in kilometres.
pub const MIE_HEIGHT: f32 = 1.2;
/// Ozone's absorption per kilometre at its densest.
pub const OZONE_ABSORPTION: [f32; 3] = [0.650e-3, 1.881e-3, 0.085e-3];
/// The cosines of the sun's and the moon's angular radii: 0.2678 and 0.2588 degrees.
const SUN_COS_RADIUS: f32 = 0.999_989_1;
const MOON_COS_RADIUS: f32 = 0.999_989_8;
/// The lowest camera height above the ground that the tables take, in kilometres, so a camera at
/// or under the ground still sees a sky.
const LOWEST_HEIGHT: f32 = 0.001;

/// The physical sky's settings, with the names of `scene.setBackground({ atmosphere })`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Atmosphere {
    /// A point toward the sun. Its direction places the sun.
    pub sun_position: [f32; 3],
    /// The sun's light above the air.
    pub sun_intensity: f32,
    /// True where the sky shows the sun's disc.
    pub sun_disc: bool,
    /// The factors of Rayleigh's scattering, of the haze's (Mie's) and of ozone's absorption.
    pub rayleigh: f32,
    pub haze: f32,
    pub ozone: f32,
    /// How much the haze scatters toward the light, from 0 to 1 (below 1).
    pub mie_directional_g: f32,
    /// The ground's albedo, from 0 to 1.
    pub ground_albedo: f32,
    /// The height of the scene's y = 0 above the ground, in metres.
    pub altitude: f32,
    /// The metres in one unit of the scene.
    pub meters_per_unit: f32,
    /// The factor of the air between the camera and each surface: 0 for none, 1 for the real air.
    pub aerial_perspective: f32,
    pub cloud_scale: f32,
    pub cloud_speed: f32,
    pub cloud_coverage: f32,
    pub cloud_density: f32,
    pub cloud_elevation: f32,
    /// The time in seconds that moves the clouds and makes the stars twinkle.
    pub time: f32,
    /// A point toward the moon, and its light above the air: 0 for no moon.
    pub moon_position: [f32; 3],
    pub moon_intensity: f32,
    /// The stars' brightness: 0 for none.
    pub stars: f32,
}

impl Default for Atmosphere {
    fn default() -> Self {
        Self {
            sun_position: [0.0, 0.342, -0.94],
            sun_intensity: 3.6,
            sun_disc: true,
            rayleigh: 1.0,
            haze: 1.0,
            ozone: 1.0,
            mie_directional_g: 0.8,
            ground_albedo: 0.3,
            altitude: 0.0,
            meters_per_unit: 1.0,
            aerial_perspective: 1.0,
            cloud_scale: 0.0002,
            cloud_speed: 0.00002,
            cloud_coverage: 0.4,
            cloud_density: 0.4,
            cloud_elevation: 0.5,
            time: 0.0,
            moon_position: [0.0, 1.0, 0.0],
            moon_intensity: 0.0,
            stars: 0.0,
        }
    }
}

/// A unit vector along `v`, or straight up for a vector of no length.
pub(crate) fn unit(v: [f32; 3]) -> [f32; 3] {
    let length = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if length > 0.0 {
        v.map(|c| c / length)
    } else {
        [0.0, 1.0, 0.0]
    }
}

impl Atmosphere {
    /// The air's coefficients, as the shaders' `Air` holds them.
    pub fn air(&self) -> Air {
        let r = RAYLEIGH_SCATTERING.map(|c| c * self.rayleigh);
        let o = OZONE_ABSORPTION.map(|c| c * self.ozone);
        let a = self.ground_albedo;
        Air {
            rayleigh: [r[0], r[1], r[2], -1.0 / RAYLEIGH_HEIGHT],
            mie: [
                MIE_SCATTERING * self.haze,
                MIE_EXTINCTION * self.haze,
                -1.0 / MIE_HEIGHT,
                self.mie_directional_g,
            ],
            ozone: [o[0], o[1], o[2], 0.0],
            ground: [a, a, a, BOTTOM_RADIUS],
        }
    }

    /// The unit direction toward the sun.
    pub fn sun(&self) -> [f32; 3] {
        unit(self.sun_position)
    }

    /// The unit direction toward the moon.
    pub fn moon(&self) -> [f32; 3] {
        unit(self.moon_position)
    }

    /// The height above the ground, in kilometres, of a camera at height `y` in the scene.
    pub fn height_of(&self, y: f32) -> f32 {
        ((self.altitude + y * self.meters_per_unit) * 1e-3)
            .clamp(LOWEST_HEIGHT, TOP_RADIUS - BOTTOM_RADIUS - 1.0)
    }
}

/// The air's coefficients in kilometres, laid out as the shaders' `Air`.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Air {
    /// Rayleigh's scattering, and the fall of its density per kilometre up.
    pub rayleigh: [f32; 4],
    /// Mie's scattering, extinction, the fall of its density, and its directional g.
    pub mie: [f32; 4],
    /// Ozone's absorption, and a spare.
    pub ozone: [f32; 4],
    /// The ground's albedo, and the planet's radius.
    pub ground: [f32; 4],
}

/// The physical sky's uniform block, laid out as the shaders' `SkyValues`.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct SkyUniform {
    air: Air,
    /// The camera's distance from the planet's center, the top of the air, the background's
    /// intensity, and a spare.
    view: [f32; 4],
    sun: [f32; 4],
    moon: [f32; 4],
    /// The cosines of the sun's and the moon's angular radii, the sun's disc, the stars.
    discs: [f32; 4],
    clouds: [f32; 4],
    cloud_place: [f32; 4],
}

const UNIFORM_BYTES: u32 = std::mem::size_of::<SkyUniform>() as u32;
const _: () = assert!(UNIFORM_BYTES == 160);

impl SkyUniform {
    fn of(atmosphere: &Atmosphere, radius: f32, intensity: f32) -> Self {
        let a = atmosphere;
        let [sx, sy, sz] = a.sun();
        let [mx, my, mz] = a.moon();
        Self {
            air: a.air(),
            view: [radius, TOP_RADIUS, intensity, 0.0],
            sun: [sx, sy, sz, a.sun_intensity],
            moon: [mx, my, mz, a.moon_intensity],
            discs: [
                SUN_COS_RADIUS,
                MOON_COS_RADIUS,
                if a.sun_disc { 1.0 } else { 0.0 },
                a.stars,
            ],
            clouds: [
                a.cloud_scale,
                a.cloud_speed,
                a.cloud_coverage,
                a.cloud_density,
            ],
            cloud_place: [a.cloud_elevation, a.time, 0.0, 0.0],
        }
    }
}

/// The air between the camera and each surface, laid out as the shaders' `Aerial` in
/// `null3d::sky_scattering`: lengths in the scene's units, light exposed. All zero without a physical sky.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct AerialUniform {
    pub rayleigh: [f32; 4],
    pub shape: [f32; 4],
    pub sun: [f32; 4],
    pub sun_light: [f32; 4],
    pub moon: [f32; 4],
    pub moon_light: [f32; 4],
}

const _: () = assert!(std::mem::size_of::<AerialUniform>() == 96);

impl AerialUniform {
    /// The values for a camera at height `y` in the scene, in a frame whose light takes the factor
    /// `light`: the background's intensity times the exposure. `model` holds the air's tables.
    pub fn of(atmosphere: &Atmosphere, model: &AirModel, y: f32, light: f32) -> Self {
        let a = atmosphere;
        if a.aerial_perspective <= 0.0 {
            return Self::default();
        }
        let height = a.height_of(y);
        let air = a.air();
        let radius = BOTTOM_RADIUS + height;
        // Kilometres in one unit of the scene, for the densities' fall with height, and for the
        // path, scaled by the strength of the haze.
        let km = a.meters_per_unit * 1e-3;
        let path = km * a.aerial_perspective;
        let rayleigh_density = (air.rayleigh[3] * height).exp();
        let mie_density = (air.mie[2] * height).exp();
        let r = [air.rayleigh[0], air.rayleigh[1], air.rayleigh[2]]
            .map(|c| c * rayleigh_density * path);
        let sun = a.sun();
        let moon = a.moon();
        let sun_light = model
            .light_at(radius, sun[1], a.sun_intensity)
            .map(|c| c * light);
        let moon_light = model
            .light_at(radius, moon[1], a.moon_intensity)
            .map(|c| c * light);
        let again_sun = model.multiscatter(radius, sun[1]);
        let again_moon = model.multiscatter(radius, moon[1]);
        let again: [f32; 3] = std::array::from_fn(|c| {
            (again_sun[c] * a.sun_intensity + again_moon[c] * a.moon_intensity) * light
        });
        Self {
            rayleigh: [r[0], r[1], r[2], air.mie[0] * mie_density * path],
            shape: [
                air.mie[1] * mie_density * path,
                km / RAYLEIGH_HEIGHT,
                km / MIE_HEIGHT,
                a.mie_directional_g,
            ],
            sun: [sun[0], sun[1], sun[2], again[0]],
            sun_light: [sun_light[0], sun_light[1], sun_light[2], again[1]],
            moon: [moon[0], moon[1], moon[2], again[2]],
            moon_light: [moon_light[0], moon_light[1], moon_light[2], 1.0],
        }
    }
}

/// Records a frame's physical sky tables for a frame builder: the tables of `settings`' physical
/// sky, seen from the camera at height `y` in the world, with the pipelines of `pipelines` that the
/// thread that draws built by frame `pipelines_built`. The frame's texture work draws the panorama
/// later, once it knows which sky maps are ready ([`crate::frame::SceneSettings::record_materials`]).
pub(crate) fn record_frame(
    pass: &mut PhysicalSkyPass,
    settings: &mut SceneSettings,
    (pipelines, pipelines_built): (&PipelineCache, u32),
    y: f32,
    list: &mut DrawList,
    arena: &mut UploadArena,
) -> Result<(), RecordError> {
    let sky = settings
        .physical_sky()
        .map(|(atmosphere, intensity)| (*atmosphere, intensity));
    pass.record(
        list,
        arena,
        sky.as_ref().map(|(atmosphere, _)| atmosphere),
        y,
        sky.map_or(1.0, |(_, intensity)| intensity),
        |id| pipelines.built(id, pipelines_built),
    )?;
    if let Some(height) = pass.height() {
        settings.sky_maps_mut().set_height(height);
    }
    Ok(())
}

/// The tables' sizes, and the panorama's.
const TRANSMITTANCE_SIZE: (u32, u32) = (256, 64);
const MULTISCATTER_SIZE: (u32, u32) = (32, 32);
const SKY_VIEW_SIZE: (u32, u32) = (256, 128);
const PANORAMA_SIZE: (u32, u32) = (512, 256);
/// The texture format of every table: 16-bit floats, which every GPU path draws and filters.
const FORMAT: u32 = format::RGBA16_FLOAT;

/// The steps of the tables' shader, which each draw's first vertex names.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Step {
    Transmittance = 0,
    Multiscatter = 1,
    SkyView = 2,
    Panorama = 3,
}

impl Step {
    const ALL: [Step; 4] = [
        Step::Transmittance,
        Step::Multiscatter,
        Step::SkyView,
        Step::Panorama,
    ];

    fn size(self) -> (u32, u32) {
        match self {
            Step::Transmittance => TRANSMITTANCE_SIZE,
            Step::Multiscatter => MULTISCATTER_SIZE,
            Step::SkyView => SKY_VIEW_SIZE,
            Step::Panorama => PANORAMA_SIZE,
        }
    }
}

/// The GPU ids of the pass's objects.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct PhysicalSkyIds {
    /// The uniform buffer of [`SkyUniform`].
    pub buffer: u32,
    /// The four textures, in [`Step`]'s order, from this id.
    pub textures: u32,
    /// The clamped sampler, and the one that repeats across the width after it.
    pub samplers: u32,
    /// The bind groups of the transmittance, multiple scattering and sky view steps, then the
    /// group that the background and the panorama read, from this id.
    pub groups: u32,
}

/// The pass's ids of textures, samplers and groups that it takes after the first of each.
pub(crate) const TEXTURES: u32 = 4;
pub(crate) const SAMPLERS: u32 = 2;
pub(crate) const GROUPS: u32 = 4;

/// What a sky view drawn into its table shows: the air, the lights and the camera's height.
#[derive(Clone, Copy, Debug, PartialEq)]
struct ViewKey {
    air: Air,
    sun: [f32; 4],
    moon: [f32; 4],
    height: f32,
}

/// The physical sky's tables and what the GPU holds of them.
#[derive(Debug)]
pub(crate) struct PhysicalSkyPass {
    ids: PhysicalSkyIds,
    /// The id of the tables' pipeline, once asked for.
    pipeline: Option<u32>,
    /// True once the GPU has the buffer, the textures, the samplers and the groups.
    created: bool,
    /// The values in the buffer, once written.
    written: Option<SkyUniform>,
    /// The air that the transmittance and multiple scattering tables hold.
    air: Option<Air>,
    /// What the sky view table holds.
    view: Option<ViewKey>,
    /// True once every table holds the frame's sky, so the background may read them.
    ready: bool,
}

impl PhysicalSkyPass {
    /// Bytes a frame may copy into its arena: the uniform block.
    pub(crate) const UPLOAD_BYTES: usize = UNIFORM_BYTES as usize;

    pub(crate) fn new(ids: PhysicalSkyIds) -> Self {
        Self {
            ids,
            pipeline: None,
            created: false,
            written: None,
            air: None,
            view: None,
            ready: false,
        }
    }

    /// The bind group that the background and the panorama read, while every table holds the
    /// frame's sky.
    pub(crate) fn group(&self) -> Option<u32> {
        self.ready.then_some(self.ids.groups + 3)
    }

    /// The GPU id of the panorama.
    pub(crate) fn panorama(&self) -> u32 {
        self.ids.textures + Step::Panorama as u32
    }

    /// Asks `pipelines` for the tables' pipeline while the scene draws a physical sky. A builder
    /// asks before it records the pipelines that its frame creates.
    pub(crate) fn request_pipeline(&mut self, pipelines: &mut PipelineCache, drawn: bool) {
        if drawn && self.pipeline.is_none() {
            self.pipeline = Some(pipelines.id(PipelineKey {
                template: template::SKY_TABLE,
                permutation: 0,
                vertex_format: 0,
                color_format: FORMAT,
                depth_format: format::NONE,
                samples: 1,
                state: state_flags::CULL_NONE | state_flags::NO_DEPTH_TEST,
                bias: DepthBias::NONE,
            }));
        }
    }

    /// The height above the ground, in kilometres, that the sky view table holds, once drawn.
    pub(crate) fn height(&self) -> Option<f32> {
        self.view.map(|view| view.height)
    }

    /// Records the frame's tables for `atmosphere` seen from a camera at height `y` in the scene,
    /// with the background's `intensity`, or nothing without a physical sky. `built` says whether
    /// the tables' pipeline draws in this frame.
    pub(crate) fn record(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        atmosphere: Option<&Atmosphere>,
        y: f32,
        intensity: f32,
        built: impl Fn(u32) -> bool,
    ) -> Result<(), RecordError> {
        self.ready = false;
        let (Some(atmosphere), Some(pipeline)) = (atmosphere, self.pipeline) else {
            return Ok(());
        };
        if !self.created {
            self.create(list)?;
        }
        let height = atmosphere.height_of(y);
        let shown = self.view.map(|v| v.height);
        // The sky changes little with height near the ground: the table keeps its height while
        // the camera moves less than 10 metres, or 2% of its height.
        let height = match shown {
            Some(shown) if (height - shown).abs() <= (0.02 * height).max(0.01) => shown,
            _ => height,
        };
        let uniform = SkyUniform::of(atmosphere, BOTTOM_RADIUS + height, intensity);
        if self.written != Some(uniform) {
            let (at, bytes) = arena.push(bytes_of(&uniform))?;
            list.push(Op::WriteBuffer, &[self.ids.buffer, 0, at, bytes])?;
            self.written = Some(uniform);
        }
        if !built(pipeline) {
            return Ok(());
        }
        let air = uniform.air;
        if self.air != Some(air) {
            self.draw(list, pipeline, Step::Transmittance)?;
            self.draw(list, pipeline, Step::Multiscatter)?;
            self.air = Some(air);
            self.view = None;
        }
        let key = ViewKey {
            air,
            sun: uniform.sun,
            moon: uniform.moon,
            height,
        };
        if self.view != Some(key) {
            self.draw(list, pipeline, Step::SkyView)?;
            self.view = Some(key);
        }
        self.ready = true;
        Ok(())
    }

    /// Records the panorama of the frame's sky, once every table holds it, and returns true when
    /// it did.
    pub(crate) fn record_panorama(&self, list: &mut DrawList) -> Result<bool, RecordError> {
        match self.pipeline.filter(|_| self.ready) {
            Some(pipeline) => {
                self.draw(list, pipeline, Step::Panorama)?;
                Ok(true)
            }
            None => Ok(false),
        }
    }

    /// Records one step: a render pass into its texture, with its group, and one triangle whose
    /// first vertex names the step.
    fn draw(&self, list: &mut DrawList, pipeline: u32, step: Step) -> Result<(), RecordError> {
        let index = step as u32;
        let zero = 0f32.to_bits();
        list.push(
            Op::BeginRenderPass,
            &[
                self.ids.textures + index,
                NO_TARGET,
                NO_TARGET,
                zero,
                zero,
                zero,
                zero,
                zero,
                pass_flags::STORE_COLOR,
            ],
        )?;
        list.push(Op::SetPipeline, &[pipeline])?;
        // The panorama reads what the background reads.
        let group = self.ids.groups + index.min(3);
        list.push(Op::SetBindGroup, &[0, group, 0])?;
        list.push(Op::Draw, &[3, 1, 3 * index, 0])?;
        list.push(Op::EndRenderPass, &[])?;
        Ok(())
    }

    /// Records the buffer, the textures, the samplers and the bind groups.
    fn create(&mut self, list: &mut DrawList) -> Result<(), RecordError> {
        let ids = self.ids;
        list.push(
            Op::CreateBuffer,
            &[ids.buffer, UNIFORM_BYTES, usage::UNIFORM | usage::COPY_DST],
        )?;
        for step in Step::ALL {
            let (width, height) = step.size();
            list.push(
                Op::CreateTexture,
                &[
                    ids.textures + step as u32,
                    width,
                    height,
                    1,
                    FORMAT,
                    texture_usage::TEXTURE_BINDING | texture_usage::RENDER_ATTACHMENT,
                    1,
                    1,
                    view::D2,
                ],
            )?;
        }
        for (k, across) in [address::CLAMP_TO_EDGE, address::REPEAT]
            .into_iter()
            .enumerate()
        {
            clamp_sampler(
                list,
                ids.samplers + k as u32,
                across,
                LINEAR_LEVEL,
                0.0,
                compare::NONE,
            )?;
        }
        // Each step binds every table but the one it draws, in whose place it binds another that
        // it does not read.
        let texture = |step: Step| ids.textures + step as u32;
        let (t, m, v) = (
            texture(Step::Transmittance),
            texture(Step::Multiscatter),
            texture(Step::SkyView),
        );
        for (k, tables) in [[m, m, v], [t, v, v], [t, m, m], [t, m, v]]
            .into_iter()
            .enumerate()
        {
            let mut words = [0u32; 3 + 5 * 6];
            words[..3].copy_from_slice(&[ids.groups + k as u32, bind_layout::ATMOSPHERE, 6]);
            words[3..8].copy_from_slice(&[0, resource_kind::BUFFER, ids.buffer, 0, UNIFORM_BYTES]);
            for (place, table) in tables.into_iter().enumerate() {
                let binding = 1 + place as u32;
                words[3 + 5 * binding as usize..][..5].copy_from_slice(&[
                    binding,
                    resource_kind::TEXTURE,
                    table,
                    0,
                    0,
                ]);
            }
            for s in 0..2u32 {
                words[3 + 5 * (4 + s) as usize..][..5].copy_from_slice(&[
                    4 + s,
                    resource_kind::SAMPLER,
                    ids.samplers + s,
                    0,
                    0,
                ]);
            }
            list.push(Op::CreateBindGroup, &words)?;
        }
        self.created = true;
        Ok(())
    }

    /// Forgets the GPU's objects after the thread that draws replaced the GPU, so the next frame
    /// makes them again and draws every table.
    pub(crate) fn reset_gpu(&mut self) {
        self.created = false;
        self.written = None;
        self.air = None;
        self.view = None;
        self.ready = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The `const <name>: vec2f = vec2f(<width>.0, <height>.0);` lines of a WGSL source.
    fn table_sizes(source: &str) -> Vec<(String, (u32, u32))> {
        source
            .lines()
            .filter_map(|line| {
                let (name, values) = line
                    .strip_prefix("const ")?
                    .split_once(": vec2f = vec2f(")?;
                let (width, height) = values.trim_end_matches(");").split_once(", ")?;
                let width: f32 = width.parse().ok()?;
                let height: f32 = height.parse().ok()?;
                Some((name.to_owned(), (width as u32, height as u32)))
            })
            .collect()
    }

    #[test]
    fn the_shaders_place_the_sky_tables_in_targets_of_the_size_the_renderer_makes() {
        // The renderer sizes each table's target, and the shaders read a texel's place and count
        // the rows of the table they write by the same numbers. A size that one side changes alone
        // reads another texel of a table, or a row of another table.
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../null3d-shaders/wgsl");
        let declared: Vec<(String, (u32, u32))> = ["lib/sky_scattering.wgsl", "sky_tables.wgsl"]
            .iter()
            .flat_map(|name| {
                let path = dir.join(name);
                let source = std::fs::read_to_string(&path)
                    .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
                table_sizes(&source)
            })
            .collect();
        for (name, size) in [
            ("TRANSMITTANCE_SIZE", TRANSMITTANCE_SIZE),
            ("MULTISCATTER_SIZE", MULTISCATTER_SIZE),
            ("SKY_VIEW_SIZE", SKY_VIEW_SIZE),
            ("PANORAMA_SIZE", PANORAMA_SIZE),
        ] {
            assert!(
                declared.contains(&(name.to_owned(), size)),
                "the shaders declare {declared:?}, and the renderer sizes {name} as {size:?}",
            );
        }
    }
}
