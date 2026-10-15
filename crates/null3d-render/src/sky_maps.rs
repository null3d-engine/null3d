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

    /// True when a map of the physical sky starts a fill in this frame once it has the panorama:
    /// a map whose texture is ready, which no fill runs on, and which does not show the sky yet.
    pub(crate) fn wants_panorama(&self, textures: &TextureStore) -> bool {
        let Some(sky @ MapSky::Physical { .. }) = self.sky else {
            return false;
        };
        self.maps.iter().any(|map| {
            map.fill.is_none()
                && textures.generated_cube(map.texture).is_some()
                && map.shown.is_none_or(|(shown, _)| shown != sky)
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
        let Some(sky) = self.sky else {
            return Ok(());
        };
        for map in &mut self.maps {
            let Some((id, _, generator)) = textures.generated_cube(map.texture) else {
                map.shown = None;
                map.fill = None;
                continue;
            };
            let (first, sky, sh) = match map.fill {
                Some(fill) => fill,
                None if map.shown.is_some_and(|(shown, _)| shown == sky) => continue,
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
