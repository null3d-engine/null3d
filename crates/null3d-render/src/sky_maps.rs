//! Sky maps: environment maps of three.js's sky, which follow the scene's sky as the sketch moves
//! its sun or changes its air and clouds, as three.js's `PMREMGenerator.fromScene` makes one from
//! a scene that holds its `Sky`.
//!
//! A sky map is a cube texture whose generator, which the thread that draws holds, made it ready
//! for the sky. The map then fills in stages, one draw-list command each ([`Op::SkyMapStep`]). The
//! thread that draws plans what each stage does, and the map knows only how many there are: the
//! first stages draw the sky into the generator's chain of levels, the next ones filter the map's
//! levels from the chain for their roughness, a few faces each, and the last stage copies every
//! level into the texture at once. Until that copy, frames draw with the map as it was. The first fill records every stage in
//! one frame, so the first frame that draws with the map already has its light. A later change of
//! the sky refreshes the map one stage a frame, so no frame waits for the whole map. A change that
//! comes while a refresh runs waits for it to end, and then starts the next one with the sky as it
//! is then.
//!
//! A map redraws only for a change that shows: its sun turning more than half a degree, one of its
//! colour values drifting by a fiftieth, or its clouds drifting a tenth of a cell of their pattern.
//! Anything finer waits, so a sun that moves in every frame costs one stage a frame only while it
//! crosses those steps. When the sky stops changing, one last fill captures it exactly, so a map
//! never keeps a sun that stopped short of a step.
//!
//! The map's diffuse light comes from the CPU ([`crate::sky_light`]), worked out when a fill
//! starts. Frames take it in the frame of the last stage, with the map's new levels, so the diffuse
//! light and the reflections change together.
//!
//! A map of the physical sky (D-143) reads the physical sky's panorama in place of the analytic
//! sky's model: its stages name the panorama's texture. Its fill starts only in a frame whose
//! physical sky pass drew the panorama for the sky as it is then, so the faces that later frames
//! draw show the same sky. Its diffuse light comes from the CPU copy of the physical model
//! ([`crate::physical_sky_light`]).

use null3d_core::handle::Handle;
use null3d_gpu::drawlist::{DrawList, Op};

use crate::background::Sky;
use crate::frame::RecordError;
use crate::physical_sky::{Atmosphere, BOTTOM_RADIUS};
use crate::physical_sky_light::AirModel;
use crate::sky_light::{Sh, sky_sh};
use crate::textures::TextureStore;

/// Words of a stage's command: the texture, the generator, the stage, the panorama and the sky's
/// 16 values.
const STEP_WORDS: usize = 20;

/// The least turn of a sun, in radians, that a map draws again for: half a degree. A sun that
/// turns less darkens or brightens the light it gives a surface by far less than a level of 255.
const SUN_STEP: f32 = std::f32::consts::PI / 360.0;

/// The least drift of a colour value, relative to its size, that a map draws again for: a fiftieth.
const COLOUR_STEP: f32 = 0.02;

/// The least drift of the clouds across the sky, in cells of their pattern, that a map draws again
/// for: a tenth. The pattern is a thousand times the drift of the clock times their speed, so they
/// drift a tenth of a cell about every five seconds at three.js's speed.
const CLOUD_STEP: f32 = 0.1;

/// The height, in kilometres, under which a camera counts as this high when a map weighs how far
/// it moved. The sky changes little with height near the ground, so a camera below it must climb
/// 10 metres before a map draws again.
const FLAT_HEIGHT: f32 = 0.5;

/// The sky that a map shows.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum MapSky {
    /// The analytic sky, whose light frames take times `gain`: 1, or the factor that matches the
    /// analytic sky to the physical sky that it stands in for.
    Analytic { sky: Sky, gain: f32 },
    /// The physical sky, seen from `height` kilometres above the ground.
    Physical { atmosphere: Atmosphere, height: f32 },
}

impl MapSky {
    /// The analytic sky as it is.
    pub fn analytic(sky: Sky) -> Self {
        Self::Analytic { sky, gain: 1.0 }
    }

    /// The factor of the light that frames take from a map of this sky.
    fn gain(&self) -> f32 {
        match self {
            Self::Analytic { gain, .. } => *gain,
            Self::Physical { .. } => 1.0,
        }
    }

    /// The diffuse light of this sky, with the physical sky's model `model`.
    fn sh(&self, model: Option<&AirModel>) -> Sh {
        match self {
            Self::Analytic { sky, .. } => sky_sh(sky),
            Self::Physical { atmosphere, height } => model.map_or([[0.0; 3]; 9], |model| {
                model.sh(atmosphere, BOTTOM_RADIUS + height)
            }),
        }
    }

    /// True when a map of `self` keeps its levels for `other`: its sun stands within half a degree
    /// of the other's, no colour value has drifted by a fiftieth, and its clouds have drifted less
    /// than a tenth of their pattern's cell.
    fn near(&self, other: &Self) -> bool {
        self.compares(other, SUN_STEP, COLOUR_STEP, CLOUD_STEP)
    }

    /// True when `other` is the same sky down to the last value that a map draws, but for its
    /// clouds: they drift on their own, and only their step draws the map again.
    fn same(&self, other: &Self) -> bool {
        self.compares(other, 0.0, 0.0, f32::INFINITY)
    }

    /// True when `other` holds the same values as `self`, within `turn` radians of each sun's
    /// direction, `drift` of each colour value relative to its size, and `clouds` cells of the
    /// clouds' pattern.
    fn compares(&self, other: &Self, turn: f32, drift: f32, clouds: f32) -> bool {
        match (self, other) {
            (Self::Analytic { sky: a, gain: ga }, Self::Analytic { sky: b, gain: gb }) => {
                same_direction(a.sun_position, b.sun_position, turn)
                    && within(rayleigh_coefficient(a), rayleigh_coefficient(b), drift)
                    && within(a.turbidity, b.turbidity, drift)
                    && within(a.mie_coefficient, b.mie_coefficient, drift)
                    && within(a.mie_directional_g, b.mie_directional_g, drift)
                    && within(a.cloud_scale, b.cloud_scale, drift)
                    && within(a.cloud_speed, b.cloud_speed, drift)
                    && within(a.cloud_coverage, b.cloud_coverage, drift)
                    && within(a.cloud_density, b.cloud_density, drift)
                    && within(a.cloud_elevation, b.cloud_elevation, drift)
                    && within(a.second_sky_weight, b.second_sky_weight, drift)
                    && within(*ga, *gb, drift)
                    && same_clouds(a.clouds(), b.clouds(), clouds)
                    && (a.second_sky_weight <= 0.0
                        || same_direction(a.second_sun_position, b.second_sun_position, turn))
            }
            (
                Self::Physical {
                    atmosphere: a,
                    height: ha,
                },
                Self::Physical {
                    atmosphere: b,
                    height: hb,
                },
            ) => {
                // The air between the camera and the surfaces is not the sky that a map draws, so
                // its aerial perspective counts for nothing here.
                same_direction(a.sun_position, b.sun_position, turn)
                    && same_direction(a.moon_position, b.moon_position, turn)
                    && within(a.sun_intensity, b.sun_intensity, drift)
                    && within(a.moon_intensity, b.moon_intensity, drift)
                    && within(a.stars, b.stars, drift)
                    && within(a.rayleigh, b.rayleigh, drift)
                    && within(a.haze, b.haze, drift)
                    && within(a.ozone, b.ozone, drift)
                    && within(a.mie_directional_g, b.mie_directional_g, drift)
                    && within(a.ground_albedo, b.ground_albedo, drift)
                    && within(a.altitude, b.altitude, drift)
                    && within(a.meters_per_unit, b.meters_per_unit, drift)
                    && within(a.cloud_scale, b.cloud_scale, drift)
                    && within(a.cloud_speed, b.cloud_speed, drift)
                    && within(a.cloud_coverage, b.cloud_coverage, drift)
                    && within(a.cloud_density, b.cloud_density, drift)
                    && within(a.cloud_elevation, b.cloud_elevation, drift)
                    && same_clouds(a.clouds(), b.clouds(), clouds)
                    && same_height(*ha, *hb, drift)
            }
            _ => false,
        }
    }
}

/// The Rayleigh coefficient that the analytic sky scatters its air by: its setting, less what a sun
/// sunk far below the horizon takes from it, as three.js's `sunFade` does.
fn rayleigh_coefficient(sky: &Sky) -> f32 {
    let fade = (sky.sun_position[1] / 450_000.0).exp().min(1.0);
    sky.rayleigh - (1.0 - fade)
}

/// True when the points `a` and `b` lie within `turn` radians of each other.
fn same_direction(a: [f32; 3], b: [f32; 3], turn: f32) -> bool {
    if a == b {
        return true;
    }
    let length = |v: [f32; 3]| (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    let (la, lb) = (length(a), length(b));
    if la <= 0.0 || lb <= 0.0 {
        return false;
    }
    // The sine of the angle between the points, from their cross product: a cosine rounds a turn
    // under two degrees to 1 on a sun hundreds of thousands of units away, which is exactly the
    // turn that a map weighs.
    let cross = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
    let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    dot > 0.0 && length(cross) <= turn.sin() * la * lb
}

/// The clouds of a sky: their coverage, the speed that moves them and the clock that does.
type Clouds = (f32, f32, f32);

/// A sky's settings, seen by the values that its clouds draw with.
trait Clouded {
    fn clouds(&self) -> Clouds;
}

impl Clouded for Sky {
    fn clouds(&self) -> Clouds {
        (self.cloud_coverage, self.cloud_speed, self.time)
    }
}

impl Clouded for Atmosphere {
    fn clouds(&self) -> Clouds {
        (self.cloud_coverage, self.cloud_speed, self.time)
    }
}

/// True when the clouds of two skies have drifted by less than `cells` cells of their pattern from
/// one another. The sky's shaders read the pattern at a thousand times the drift of the clock times
/// the speed. A sky that draws no clouds keeps as still as it likes.
fn same_clouds(ours: Clouds, theirs: Clouds, cells: f32) -> bool {
    let (coverage, speed, time) = ours;
    let (other_coverage, other_speed, other_time) = theirs;
    if coverage <= 0.0 || other_coverage <= 0.0 {
        return true;
    }
    (time * speed - other_time * other_speed).abs() * 1000.0 <= cells
}

/// True when `a` and `b` lie within `drift` of each other, relative to the larger.
fn within(a: f32, b: f32, drift: f32) -> bool {
    (a - b).abs() <= drift * a.abs().max(b.abs())
}

/// True when two heights above the ground, in kilometres, lie within `drift` of each other. A
/// height under `FLAT_HEIGHT` counts as that high, so a camera near the ground must climb 10 metres
/// before a map draws again, as the physical sky's own tables wait for.
fn same_height(a: f32, b: f32, drift: f32) -> bool {
    (a - b).abs() <= drift * a.abs().max(b.abs()).max(FLAT_HEIGHT)
}

/// True when a map that shows `shown` starts a fill for `sky`: the sky has moved past the step that
/// a map draws for, or it has come to rest, which `settled` says, and the map does not hold it
/// exactly.
fn start_fill(shown: &MapSky, sky: &MapSky, settled: bool) -> bool {
    !shown.near(sky) || (settled && !shown.same(sky))
}

/// One sky map.
#[derive(Clone, Copy, Debug)]
struct SkyMap {
    texture: Handle,
    /// Its stages, the copy included.
    stages: u32,
    /// The sky of the levels that frames draw with, and its diffuse light, once the map is full.
    shown: Option<(MapSky, Sh)>,
    /// The fill under way: the next stage to record, and the sky and diffuse light that it makes.
    fill: Option<(u32, MapSky, Sh)>,
}

/// The scene's sky maps, and the sky that they show.
#[derive(Debug, Default)]
pub struct SkyMaps {
    /// The sky that the maps show: the settings of the scene's last sky background, or none
    /// before the first.
    sky: Option<MapSky>,
    /// The sky of the frame before the last recorded one, to tell when the sky has come to rest.
    before: Option<MapSky>,
    maps: Vec<SkyMap>,
}

impl SkyMaps {
    /// The sky that the maps show, or none before the first.
    pub fn sky(&self) -> Option<MapSky> {
        self.sky
    }

    /// Makes the maps show `sky` from the next recorded frame on, in stages.
    pub fn set_sky(&mut self, sky: MapSky) {
        self.sky = Some(sky);
    }

    /// Sets the height above the ground, in kilometres, from which a map of the physical sky sees
    /// it: the height of the physical sky's tables.
    pub(crate) fn set_height(&mut self, height: f32) {
        if let Some(MapSky::Physical { height: h, .. }) = &mut self.sky {
            *h = height;
        }
    }

    /// True when the sky of this frame holds the values of the frame before, so it has come to
    /// rest and a map that lags it captures it exactly.
    fn settled(&self) -> bool {
        match (&self.before, &self.sky) {
            (Some(before), Some(sky)) => before.same(sky),
            _ => false,
        }
    }

    /// True when a map of the physical sky starts a fill in this frame once it has the panorama:
    /// a map whose texture is ready, which no fill runs on, and whose sky has moved past the step
    /// that a map draws for, or has come to rest and the map does not hold it exactly.
    pub(crate) fn wants_panorama(&self, textures: &TextureStore) -> bool {
        let Some(sky @ MapSky::Physical { .. }) = &self.sky else {
            return false;
        };
        let settled = self.settled();
        self.maps.iter().any(|map| {
            map.fill.is_none()
                && textures.generated_cube(map.texture).is_some()
                && map
                    .shown
                    .is_none_or(|(shown, _)| start_fill(&shown, sky, settled))
        })
    }

    /// Makes cube texture `texture` a sky map of `stages` stages, at least 1, which fills in the
    /// first frame after its generator made it ready. A texture that is a sky map already stays one.
    pub fn add(&mut self, texture: Handle, stages: u32) {
        if self.maps.iter().all(|map| map.texture != texture) {
            self.maps.push(SkyMap {
                texture,
                stages: stages.max(1),
                shown: None,
                fill: None,
            });
        }
    }

    /// The diffuse light of the sky map in `texture`, once frames draw with its levels, or none
    /// for a texture that is not a full sky map.
    pub fn sh(&self, texture: Handle) -> Option<Sh> {
        self.light(texture).map(|(sh, _)| sh)
    }

    /// The diffuse light of the sky map in `texture` and the factor of its light, once frames draw
    /// with its levels, or none for a texture that is not a full sky map.
    pub fn light(&self, texture: Handle) -> Option<(Sh, f32)> {
        let map = self.maps.iter().find(|map| map.texture == texture)?;
        map.shown.map(|(sky, sh)| (sh, sky.gain()))
    }

    /// Forgets every map's levels after the thread that draws replaced the GPU: each map fills
    /// whole again once its generator has run on the new device.
    pub fn reset_gpu(&mut self) {
        for map in &mut self.maps {
            map.shown = None;
            map.fill = None;
        }
    }

    /// Records the frame's stages of each map whose texture is ready: every stage of a map that
    /// is not full yet, and the next stage of a refresh. Forgets maps whose texture was destroyed.
    /// `panorama_drawn` is true when the frame drew the physical sky's panorama, texture
    /// `panorama`, for the sky as it is, which a fill of the physical sky needs to start. `model`
    /// is the physical sky's CPU model.
    pub(crate) fn record(
        &mut self,
        textures: &TextureStore,
        list: &mut DrawList,
        panorama_drawn: bool,
        panorama: u32,
        model: Option<&AirModel>,
    ) -> Result<(), RecordError> {
        self.maps.retain(|map| textures.is_live(map.texture));
        let settled = self.settled();
        self.before = self.sky;
        let Some(sky) = self.sky else {
            return Ok(());
        };
        for map in &mut self.maps {
            let Some((id, _, generator)) = textures.generated_cube(map.texture) else {
                map.shown = None;
                map.fill = None;
                continue;
            };
            let start = map
                .shown
                .is_none_or(|(shown, _)| start_fill(&shown, &sky, settled));
            let (first, sky, sh) = match map.fill {
                Some(fill) => fill,
                None if !start => continue,
                None if matches!(sky, MapSky::Physical { .. }) && !panorama_drawn => continue,
                None => (0, sky, sky.sh(model)),
            };
            // A map that frames do not draw with yet fills whole at once.
            let copy = map.stages - 1;
            let last = if map.shown.is_none() { copy } else { first };
            for stage in first..=last {
                push_stage(list, id, generator, stage, &sky, panorama)?;
            }
            map.fill = if last == copy {
                map.shown = Some((sky, sh));
                None
            } else {
                Some((last + 1, sky, sh))
            };
        }
        Ok(())
    }
}

/// Records stage `stage` of the sky map in cube texture `id`, which generator `generator` holds:
/// of the analytic sky's settings, or of the physical sky's panorama in texture `panorama`.
fn push_stage(
    list: &mut DrawList,
    id: u32,
    generator: u32,
    stage: u32,
    sky: &MapSky,
    panorama: u32,
) -> Result<(), RecordError> {
    let mut words = [0u32; STEP_WORDS];
    words[..3].copy_from_slice(&[id, generator, stage]);
    let sky = match sky {
        MapSky::Analytic { sky, .. } => sky,
        MapSky::Physical { .. } => {
            words[3] = panorama;
            list.push(Op::SkyMapStep, &words)?;
            return Ok(());
        }
    };
    let [x, y, z] = sky.sun_position;
    let [heading, elevation] = sky.second_angles();
    let values = [
        x,
        y,
        z,
        sky.second_sky_weight,
        sky.turbidity,
        sky.rayleigh,
        sky.mie_coefficient,
        sky.mie_directional_g,
        sky.cloud_scale,
        sky.cloud_speed,
        sky.cloud_coverage,
        sky.cloud_density,
        sky.cloud_elevation,
        sky.time,
        heading,
        elevation,
    ];
    for (word, value) in words[4..].iter_mut().zip(values) {
        *word = value.to_bits();
    }
    list.push(Op::SkyMapStep, &words)?;
    Ok(())
}
