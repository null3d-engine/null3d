//! Levels of detail: simpler meshes that a mesh draws in its place where its error covers less
//! than a threshold of pixels on the screen. [`null3d_core::levels`] holds the rule that picks a
//! level; this module holds the meshes with levels, and the bucket keys and links that the frame
//! builders give each level.
//!
//! A mesh with levels names its lower levels, from the most detailed down, and each level's error,
//! in the units of the base mesh's positions. Every object and every instance batch that draws the
//! base mesh picks one level per frame and per view. The frame builders keep a bucket for each
//! level of each such mesh, and with fading bands a fade bucket beside each. A level's bucket key
//! names it by a level key ([`level_key`]), so a level's bucket never merges with the bucket of an
//! object that draws the same simple mesh as a mesh of its own.

use null3d_gpu::drawlist::{permutation, state_flags, template};

use crate::meshes::MeshStorage;
use crate::pipelines::DrawKey;

/// What makes a bucket in both frame builders: its pipeline's key, its material's map group, the
/// page of its mesh's first part, its mesh (or level key), its material, and one more field of
/// the builder's own.
pub(crate) type BucketKey = (DrawKey, u32, u32, u32, u32, u32);

/// The most levels a mesh has, its base mesh included.
pub const MAX_LEVELS: usize = 8;

/// The bit of a bucket key's mesh field that marks a level key.
const LEVEL_KEY: u32 = 1 << 31;
/// The bits of a level key that hold the level.
const LEVEL_BITS: u32 = 3;
const _: () = assert!(1 << LEVEL_BITS == MAX_LEVELS);

/// The mesh field of the bucket key of level `level` of the mesh with engine id `base`: the base
/// mesh's own id for level 0, and a level key for the lower levels.
pub fn level_key(base: u32, level: usize) -> u32 {
    if level == 0 {
        base
    } else {
        LEVEL_KEY | (base << LEVEL_BITS) | level as u32
    }
}

/// The base mesh and the level that a bucket key's mesh field names: the mesh itself and level 0
/// for a mesh's own id.
pub fn key_level(key: u32) -> (u32, usize) {
    if key & LEVEL_KEY == 0 {
        (key, 0)
    } else {
        (
            (key & !LEVEL_KEY) >> LEVEL_BITS,
            (key & ((1 << LEVEL_BITS) - 1)) as usize,
        )
    }
}

/// One mesh's levels: the engine mesh id of each, the base mesh first, and each one's error.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LevelSet {
    meshes: [u32; MAX_LEVELS],
    errors: [f32; MAX_LEVELS],
    count: u8,
    /// True when the levels hand over in a fading band, false when they switch at once.
    fades: bool,
}

impl LevelSet {
    /// The number of levels, the base mesh included.
    pub fn len(&self) -> usize {
        self.count as usize
    }

    /// True for a set with no levels.
    pub fn is_empty(&self) -> bool {
        self.count == 0
    }

    /// The engine mesh id of level `level`.
    pub fn mesh(&self, level: usize) -> u32 {
        self.meshes[level]
    }

    /// The error of level `level`, 0 for the base mesh.
    pub fn error(&self, level: usize) -> f32 {
        self.errors[level]
    }

    /// True when the levels hand over in a fading band.
    pub fn fades(&self) -> bool {
        self.fades
    }
}

/// Why a set of levels was refused.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LevelError {
    /// More levels than [`MAX_LEVELS`], the base mesh included.
    TooMany,
    /// An error that is not finite, not above the level before's, or not above 0.
    Errors,
    /// A level that names no mesh, or the base mesh.
    Mesh,
    /// A level whose vertices have other attributes than the base mesh's: each level draws with
    /// the base mesh's pipelines.
    Format,
}

/// The meshes with levels, by the base mesh's engine id.
#[derive(Clone, Debug, Default)]
pub struct Levels {
    sets: Vec<LevelSet>,
    /// The number of meshes with levels.
    count: usize,
}

impl Levels {
    /// Gives the mesh with engine id `base` the lower levels `meshes`, with their `errors`, or with
    /// none takes its levels away. `fades` makes the levels hand over in a fading band. The caller
    /// checks that every mesh id names a live mesh.
    pub fn set(
        &mut self,
        base: u32,
        meshes: &[u32],
        errors: &[f32],
        fades: bool,
    ) -> Result<(), LevelError> {
        if meshes.len() + 1 > MAX_LEVELS || meshes.len() != errors.len() {
            return Err(LevelError::TooMany);
        }
        if base == 0 || meshes.iter().any(|&mesh| mesh == 0 || mesh == base) {
            return Err(LevelError::Mesh);
        }
        let mut before = 0.0;
        for &error in errors {
            if !error.is_finite() || error <= before {
                return Err(LevelError::Errors);
            }
            before = error;
        }
        let index = base as usize;
        if meshes.is_empty() {
            if let Some(set) = self.sets.get_mut(index).filter(|set| !set.is_empty()) {
                *set = LevelSet::default();
                self.count -= 1;
            }
            return Ok(());
        }
        if self.sets.len() <= index {
            self.sets.resize(index + 1, LevelSet::default());
        }
        let set = &mut self.sets[index];
        if set.is_empty() {
            self.count += 1;
        }
        *set = LevelSet {
            count: meshes.len() as u8 + 1,
            fades,
            ..LevelSet::default()
        };
        set.meshes[0] = base;
        set.meshes[1..=meshes.len()].copy_from_slice(meshes);
        set.errors[1..=errors.len()].copy_from_slice(errors);
        Ok(())
    }

    /// The levels of the mesh with engine id `base`, or `None` for a mesh without.
    pub fn of(&self, base: u32) -> Option<&LevelSet> {
        self.sets.get(base as usize).filter(|set| !set.is_empty())
    }

    /// True while some mesh has levels.
    pub fn any(&self) -> bool {
        self.count > 0
    }

    /// The engine mesh id that a bucket key's mesh field draws: a level's own mesh for a level
    /// key, else the field itself.
    pub fn mesh_of_key(&self, key: u32) -> Option<u32> {
        let (base, level) = key_level(key);
        if level == 0 {
            return Some(base);
        }
        let set = self.of(base)?;
        (level < set.len()).then(|| set.mesh(level))
    }

    /// Takes the levels away from removed meshes, and from meshes whose levels name a removed
    /// mesh: `live` says whether an engine mesh id names a live mesh.
    pub fn forget_removed(&mut self, live: impl Fn(u32) -> bool) {
        for (base, set) in self.sets.iter_mut().enumerate() {
            if set.is_empty() {
                continue;
            }
            let gone = !live(base as u32) || set.meshes[..set.len()].iter().any(|&m| !live(m));
            if gone {
                *set = LevelSet::default();
                self.count -= 1;
            }
        }
    }
}

/// The permutation bits of the pipelines whose levels switch at once: their builds have no fading
/// level (see [`permutation::APART`]).
const NO_FADE: u32 = permutation::SKIN
    | permutation::MORPH
    | permutation::INSTANCE_INDEX
    | permutation::TRANSMISSION
    | permutation::ALPHA_COVERAGE
    | permutation::ALPHA_HASH;

/// True when a pipeline has builds of a fading level: the engine's standard and unlit templates,
/// with a plain mask test at most. Custom materials and the debug views switch levels at once.
pub(crate) fn fades_its_way(key: DrawKey) -> bool {
    matches!(
        key.template,
        template::INSTANCED_LIT
            | template::INSTANCED_STANDARD_MAPS
            | template::INSTANCED_UNLIT
            | template::INSTANCED_UNLIT_MAP
    ) && key.permutation & NO_FADE == 0
        && key.state & state_flags::ALPHA_TO_COVERAGE == 0
}

/// True when a bucket key draws a fading level.
pub(crate) fn is_fade_key(key: &BucketKey) -> bool {
    key.0.permutation & permutation::LOD_FADE != 0
}

/// The key of the fade bucket beside a level's bucket key.
fn fade_key(key: BucketKey) -> BucketKey {
    let pipeline = DrawKey {
        permutation: key.0.permutation | permutation::LOD_FADE,
        ..key.0
    };
    (pipeline, key.1, key.2, key.3, key.4, key.5)
}

/// The key of level `level` of `set` beside the bucket key `key` of its base mesh: its mesh field
/// is the level key, and its page is the page of the level's mesh's first part.
fn level_bucket_key(
    key: BucketKey,
    set: &LevelSet,
    level: usize,
    meshes: &MeshStorage,
) -> Option<BucketKey> {
    let mesh = meshes.mesh(set.mesh(level).checked_sub(1)?)?;
    let page = meshes.parts(mesh).first()?.page;
    Some((
        key.0,
        key.1,
        page,
        level_key(set.mesh(0), level),
        key.4,
        key.5,
    ))
}

/// Adds the keys of the level buckets of every key in `keys` whose mesh has levels and that
/// `eligible` lets pick them: one key for each lower level, and with `fade` one fade bucket for
/// each level, where the set fades and the pipeline has fading builds. Each takes the count of the
/// key it comes from, since any of its sources may draw any level. The keys are sorted again,
/// and equal keys merge as [`crate::frame::collect_bucket_keys`] merges them. Allocates nothing
/// once `keys` has room.
pub(crate) fn expand_level_keys(
    keys: &mut Vec<(BucketKey, u32)>,
    levels: &Levels,
    meshes: &MeshStorage,
    fade: bool,
    eligible: impl Fn(&BucketKey) -> bool,
) {
    if !levels.any() {
        return;
    }
    let original = keys.len();
    for k in 0..original {
        let (key, count) = keys[k];
        let Some(set) = levels.of(key.3).filter(|_| eligible(&key)) else {
            continue;
        };
        let fades = fade && set.fades() && fades_its_way(key.0);
        if fades {
            keys.push((fade_key(key), count));
        }
        for level in 1..set.len() {
            if let Some(level_key) = level_bucket_key(key, set, level, meshes) {
                keys.push((level_key, count));
                if fades {
                    keys.push((fade_key(level_key), count));
                }
            }
        }
    }
    if keys.len() == original {
        return;
    }
    keys.sort_unstable_by_key(|&(key, _)| key);
    keys.dedup_by(|next, kept| {
        let same = next.0 == kept.0;
        if same {
            kept.1 += next.1;
        }
        same
    });
}

/// What a bucket key says of its level of detail: the level's error, and the places in the sorted
/// keys of the next coarser level's key and of the level's fade key.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct KeyLinks {
    pub error: f32,
    pub next: Option<u32>,
    pub fade: Option<u32>,
}

/// The links of the bucket key `key`, in the sorted `keys` that
/// [`expand_level_keys`] made. A bucket of a mesh without levels, a fade bucket, and a base
/// level's bucket that `eligible` keeps from picking have none.
pub(crate) fn links_of(
    key: BucketKey,
    keys: &[(BucketKey, u32)],
    levels: &Levels,
    meshes: &MeshStorage,
    eligible: impl Fn(&BucketKey) -> bool,
) -> KeyLinks {
    let (base, level) = key_level(key.3);
    let set = levels.of(base).filter(|_| level > 0 || eligible(&key));
    let (Some(set), false) = (set, is_fade_key(&key)) else {
        return KeyLinks::default();
    };
    let find = |key: Option<BucketKey>| {
        key.and_then(|key| keys.binary_search_by_key(&key, |&(k, _)| k).ok())
            .map(|place| place as u32)
    };
    // Every level's key holds its base key's fields, and the base key's page.
    let base_key = level_bucket_key(key, set, 0, meshes);
    let next = (level + 1 < set.len())
        .then(|| base_key.and_then(|base| level_bucket_key(base, set, level + 1, meshes)))
        .flatten();
    KeyLinks {
        error: set.error(level),
        next: find(next),
        fade: find(Some(fade_key(key))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn level_keys_round_trip_and_never_equal_a_mesh_id() {
        for base in [1, 2, 1000, (1 << 27) - 1] {
            for level in 0..MAX_LEVELS {
                let key = level_key(base, level);
                assert_eq!(key_level(key), (base, level));
                assert_eq!(key & LEVEL_KEY != 0, level > 0);
            }
        }
    }

    #[test]
    fn sets_refuse_bad_levels_and_forget_removed_meshes() {
        let mut levels = Levels::default();
        assert_eq!(
            levels.set(1, &[2, 3], &[0.1, 0.1], true),
            Err(LevelError::Errors)
        );
        assert_eq!(levels.set(1, &[2], &[0.0], true), Err(LevelError::Errors));
        assert_eq!(levels.set(1, &[1], &[0.1], true), Err(LevelError::Mesh));
        assert_eq!(
            levels.set(1, &[2; 8], &[0.1; 8], true),
            Err(LevelError::TooMany)
        );
        levels.set(1, &[2, 3], &[0.1, 0.2], false).unwrap();
        levels.set(4, &[5], &[0.1], true).unwrap();
        assert!(levels.any());
        assert_eq!(levels.mesh_of_key(level_key(1, 2)), Some(3));
        assert_eq!(levels.mesh_of_key(level_key(1, 3)), None);
        levels.forget_removed(|mesh| mesh != 3);
        assert!(levels.of(1).is_none() && levels.of(4).is_some());
        levels.set(4, &[], &[], true).unwrap();
        assert!(!levels.any());
    }
}
