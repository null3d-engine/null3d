//! The texture memory budget: the GPU bytes that the textures may take, which the quality preset
//! sets. When the textures pass it, the store drops the largest mip levels of some textures, and
//! when room returns, it loads them again.
//!
//! # The band
//!
//! The store acts outside a band of 5% around the budget, so it does not drop and restore the
//! same levels in turn. Past the band's top, it first makes every array that textures share as
//! small as its textures, then drops one level at a time until the textures fit under the band's
//! bottom. Below the band's bottom, it gives levels back while they fit under it. Each frame takes
//! at most [`STEPS_PER_FRAME`] steps, so a burst of loads spreads its copies over frames.
//!
//! # The order
//!
//! Godot's texture streaming sets the order of the drops. The store drops a level of the texture
//! that ranks first by, in turn: a texture that holds more detail than any view needs, the frames
//! since a view last saw it, its GPU bytes, its dropped levels (fewer first), and its slot. A
//! texture drops at most [`MAX_DROPPED_LEVELS`] levels, keeps whole blocks of a compressed format,
//! and a texture smaller than [`MIN_DROP_BYTES`] keeps its levels. Godot learns what each texture
//! needs from the GPU, which writes it from the fragment shaders with storage atomics. WebGL2 and
//! WebGPU's compatibility mode lack them, so the store estimates it on the CPU instead (below).
//!
//! # What drops
//!
//! Only a texture whose texels the page can load again drops, so every level it drops can come
//! back: a texture from a file. A texture that a sketch makes from an image or data keeps its
//! levels, and counts toward the budget. A texture drops a level in one of three ways:
//!
//! - Other texels on the GPU move to the array of the next smaller size: the recorded frame copies
//!   every level but the largest. The move needs no download.
//! - Texels that bring their own levels, and wait in engine memory for their upload, lose their
//!   largest level there.
//! - Texels of a format that takes writes only, compressed or shared-exponent, load again without
//!   their largest levels when they are on the GPU, because no GPU path copies them: compatibility
//!   mode and WebGL2 cannot.
//!
//! # Loads again
//!
//! A level comes back when the page loads the texture's file again. The store asks for it, and the
//! page gives the texels of the levels that it wants to a hidden texture of that size. Once they
//! are on the GPU, the texture swaps places with the hidden texture, which is then destroyed. So
//! the texture draws with its old levels until the new ones are ready, and never draws without its
//! map. A texture whose texels a new GPU device lost loads again in the same way.
//!
//! # The estimate of need
//!
//! Over a few frames, the store reads every scene object and instance row whose material maps a
//! texture: its bounding sphere, against the camera's view. An object inside the view covers about
//! `diameter / (distance * tan(fov / 2))` of the canvas's height, and the texture needs about one
//! texel per pixel across the object. The estimate assumes that the texture spans the object once,
//! and keeps one more level than that. A texture that no object in the view maps needs no level
//! the budget would drop.

use null3d_core::cells::{CellCoords, CellPosition};
use null3d_core::culling::Frustum;
use null3d_core::frames::next_frame;
use null3d_core::instances::BatchTable;
use null3d_core::scene::SceneStorage;
use null3d_core::world::WorldArrays;

use super::*;
use crate::camera::Lens;
use crate::materials::MaterialTable;

/// The most mip levels that the budget drops from one texture.
pub const MAX_DROPPED_LEVELS: u32 = 3;
/// The band around the budget inside which the store neither drops nor restores, in percent.
pub const BAND_PERCENT: u64 = 5;
/// The GPU bytes under which a texture keeps its levels: dropping them would save little.
pub const MIN_DROP_BYTES: u64 = 64 * 1024;
/// The drops and loads again that one frame starts, at most.
pub const STEPS_PER_FRAME: u32 = 8;
/// The bounding spheres that the estimate of need reads in one frame, at most.
pub const SPHERES_PER_FRAME: u32 = 4096;
/// The pixels of an object that the camera stands inside, which needs every level.
const INSIDE: f32 = f32::MAX;

/// How many frames before `frame` a texture was last seen, measured around the circle of frame
/// numbers, so the count stays right where it goes round. A texture never seen counts as unseen
/// the longest.
fn frames_unseen(frame: u32, seen: u32) -> u32 {
    if seen == 0 {
        u32::MAX
    } else {
        frame.wrapping_sub(seen)
    }
}

/// A texture's place in the order of drops, which ranks the greatest first: more detail than any
/// view needs, then the frames unseen, the GPU bytes, the levels left to drop, and the lower slot.
type DropRank = (bool, u32, u64, u32, u32);

/// How a texture drops its largest level.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Drop {
    /// It moves to a smaller array, which copies its other levels.
    Copy,
    /// Its texels, which wait in engine memory, lose their largest level.
    Skip,
    /// The page loads its texels again without their largest level.
    Reload,
}

/// The budget, its loads again, and the estimate of need under way.
#[derive(Debug, Default)]
pub(super) struct Budget {
    /// The GPU bytes that the textures may take, or 0 for no budget.
    limit: u64,
    /// The textures with a load again under way: asked for, or taken by the page.
    reloads: Vec<Handle>,
    /// Counts each drop, each load again asked for and each swap, so the page sees a change.
    epoch: u32,
    /// The dropped levels of every texture, and the textures with any.
    dropped_levels: u32,
    dropped_textures: u32,
    sweep: Sweep,
}

/// Where the estimate of need is, and the most pixels that each material's objects cover so far.
#[derive(Debug, Default)]
struct Sweep {
    object: u32,
    batch: u32,
    row: u32,
    pixels: Vec<f32>,
}

/// What the estimate reads of the frame and of the camera's view.
#[derive(Clone, Copy, Debug)]
pub(crate) struct NeedView {
    pub camera: CellPosition,
    pub frustum: Frustum,
    pub lens: Lens,
    /// The canvas's height in pixels.
    pub height: f32,
    /// The frame, and which world output of the scene it reads.
    pub frame: u32,
    pub parity: usize,
    /// The texture that the view draws behind every object, which it always needs whole.
    pub background: Handle,
}

impl NeedView {
    /// The pixels across a sphere at `center` from the camera, or 0 outside the view.
    fn pixels(&self, center: [f32; 3], radius: f32) -> f32 {
        let [x, y, z] = center;
        // A hidden object's radius is negative infinity, and NaN fails every test.
        let visible = radius > 0.0 && self.frustum.contains_sphere(x, y, z, radius);
        if !visible {
            return 0.0;
        }
        match self.lens {
            Lens::Perspective(lens) => {
                let distance = (x * x + y * y + z * z).sqrt();
                if distance <= radius {
                    return INSIDE;
                }
                let focal = 1.0 / (lens.fov_degrees.to_radians() * 0.5).tan();
                2.0 * radius * focal * self.height * 0.5 / distance
            }
            Lens::Orthographic(lens) => 2.0 * radius / lens.height.max(f32::EPSILON) * self.height,
        }
    }
}

/// The largest levels of a texture `side` texels across that an object of `pixels` pixels does
/// not need: none at one texel per pixel, keeping one level more, up to [`MAX_DROPPED_LEVELS`].
pub fn unneeded_levels(side: u32, pixels: f32) -> u32 {
    if pixels <= 0.0 {
        return MAX_DROPPED_LEVELS;
    }
    let ratio = side as f32 / (2.0 * pixels);
    if ratio < 2.0 {
        0
    } else {
        (ratio.log2().floor() as u32).min(MAX_DROPPED_LEVELS)
    }
}

impl TextureStore {
    /// Sets the GPU bytes that the textures may take, or 0 for no budget.
    pub fn set_memory_budget(&mut self, bytes: u64) {
        self.memory.limit = bytes;
    }

    /// The GPU bytes that the textures may take, or 0 for no budget.
    pub fn memory_budget(&self) -> u64 {
        self.memory.limit
    }

    /// The mip levels that the budget dropped from a texture.
    pub fn dropped_levels(&self, texture: Handle) -> Result<u32, TextureError> {
        Ok(self.slot(texture)?.dropped)
    }

    /// The mip levels that the budget dropped from every texture, and the textures with any.
    pub fn dropped(&self) -> (u32, u32) {
        (self.memory.dropped_levels, self.memory.dropped_textures)
    }

    /// A number that changes with each drop, each load again asked for and each swap.
    pub fn budget_epoch(&self) -> u32 {
        self.memory.epoch
    }

    /// Notes that the page can load a texture's texels again, at any mip level, as it can a
    /// file's. Only such a texture drops levels. New texels from the page undo it.
    pub fn set_reloadable(&mut self, texture: Handle) -> Result<(), TextureError> {
        let slot = self.slot_mut(texture)?;
        if slot.owner != Handle::NONE {
            return Err(TextureError::Unsupported);
        }
        slot.reloadable = true;
        Ok(())
    }

    /// The next texture whose texels the page should load again, which gets its hidden texture
    /// now: [`Self::reload_of`] gives the levels and the hidden texture.
    pub fn take_reload(&mut self) -> Option<Handle> {
        let mut k = 0;
        while k < self.memory.reloads.len() {
            let texture = self.memory.reloads[k];
            k += 1;
            let Ok(slot) = self.slot(texture).copied() else {
                continue;
            };
            let (Some(level), Handle::NONE) = (slot.reload, slot.incoming) else {
                continue;
            };
            let key = self.arrays[slot.array as usize].key;
            let desc = TextureDesc {
                width: format::level_size(slot.full[0], level),
                height: format::level_size(slot.full[1], level),
                depth: key.depth,
                format: key.format,
                mipmaps: slot.mipmaps,
                levels: if slot.mipmaps {
                    1
                } else {
                    slot.full_levels() - level
                },
                sampling: self.samplers[slot.sampler as usize].sampling,
            };
            match self.create(desc) {
                Ok(incoming) => {
                    if let Ok(hidden) = self.slot_mut(incoming) {
                        hidden.owner = texture;
                    }
                    if let Ok(slot) = self.slot_mut(texture) {
                        slot.incoming = incoming;
                    }
                    return Some(texture);
                }
                Err(_) => {
                    self.fail_reload(texture);
                    k -= 1;
                }
            }
        }
        None
    }

    /// The dropped levels that a texture's load again asks for, and the hidden texture that takes
    /// its texels once the page took the load.
    pub fn reload_of(&self, texture: Handle) -> Option<(u32, Handle)> {
        let slot = self.slot(texture).ok()?;
        slot.reload.map(|level| (level, slot.incoming))
    }

    /// Stops a texture's load again for good, because the page could not load its texels: the
    /// texture keeps the levels it holds, and drops no more.
    pub fn fail_reload(&mut self, texture: Handle) {
        self.cancel_reload(texture);
        if let Ok(slot) = self.slot_mut(texture) {
            slot.reloadable = false;
        }
    }

    /// Stops a texture's load again, and destroys its hidden texture.
    pub(super) fn cancel_reload(&mut self, texture: Handle) {
        let Ok(slot) = self.slot_mut(texture) else {
            return;
        };
        let incoming = std::mem::replace(&mut slot.incoming, Handle::NONE);
        if slot.reload.take().is_none() {
            return;
        }
        self.memory.reloads.retain(|&t| t != texture);
        if self.is_live(incoming) {
            let _ = self.destroy(incoming, self.recorded);
        }
    }

    /// Gives a texture `dropped` dropped levels in the counts of every texture.
    fn set_dropped(&mut self, index: usize, dropped: u32) {
        let slot = &mut self.textures[index];
        let memory = &mut self.memory;
        memory.dropped_levels = memory.dropped_levels - slot.dropped + dropped;
        match (slot.dropped > 0, dropped > 0) {
            (false, true) => memory.dropped_textures += 1,
            (true, false) => memory.dropped_textures -= 1,
            _ => {}
        }
        slot.dropped = dropped;
    }

    /// Takes a destroyed or refilled texture's dropped levels out of the counts.
    pub(super) fn forget_dropped(&mut self, texture: Handle) {
        if let Ok(index) = self.handles.resolve(texture) {
            self.set_dropped(index as usize, 0);
        }
    }

    /// The GPU bytes of a texture that the GPU holds without its largest `dropped` levels.
    fn bytes_at(&self, slot: &TextureSlot, dropped: u32) -> u64 {
        let key = self.arrays[slot.array as usize].key;
        let width = format::level_size(slot.full[0], dropped);
        let height = format::level_size(slot.full[1], dropped);
        let mips = if slot.mipmaps {
            format::full_chain(width, height)
        } else {
            slot.full_levels() - dropped
        };
        format::layer_bytes(key.format, width, height, mips) * u64::from(key.depth)
    }

    /// The GPU bytes that the textures will take once the next recorded frame has sized every
    /// array, and the loads again under way have swapped.
    fn projected_bytes(&self) -> u64 {
        let arrays: u64 = self
            .arrays
            .iter()
            .map(|array| array.bytes(array.target_capacity()))
            .sum();
        let mut bytes = arrays as i64;
        for &texture in &self.memory.reloads {
            let Ok(slot) = self.slot(texture) else {
                continue;
            };
            if let (Some(level), Handle::NONE) = (slot.reload, slot.incoming) {
                bytes += self.bytes_at(slot, level) as i64;
            }
            bytes -= self.bytes_at(slot, slot.dropped) as i64;
        }
        bytes.max(0) as u64
    }

    /// Makes every array that textures share as small as its textures from the next recorded
    /// frame on, with no free layers, and returns the GPU bytes that the textures will take then.
    fn compact_arrays(&mut self) -> u64 {
        for array in &mut self.arrays {
            array.compact = array.key.shared() && array.live > 0;
        }
        self.projected_bytes()
    }

    /// Swaps each texture with its hidden texture once the hidden one's texels are on the GPU, and
    /// destroys the hidden one with the texture's old layer. Returns true when any swapped, which
    /// changes the draw tables.
    fn swap_incoming(&mut self) -> bool {
        let mut swapped = false;
        let mut k = 0;
        while k < self.memory.reloads.len() {
            let texture = self.memory.reloads[k];
            k += 1;
            let Ok(index) = self.handles.resolve(texture) else {
                continue;
            };
            let slot = self.textures[index as usize];
            let Ok(hidden_index) = self.handles.resolve(slot.incoming) else {
                continue;
            };
            let hidden = self.textures[hidden_index as usize];
            if !matches!(hidden.state, State::Uploaded { .. }) || slot.moving {
                continue;
            }
            let level = slot.reload.unwrap_or(slot.dropped);
            let visible = &mut self.textures[index as usize];
            (visible.array, visible.layer, visible.group) =
                (hidden.array, hidden.layer, hidden.group);
            (visible.state, visible.levels) = (hidden.state, hidden.levels);
            (visible.incoming, visible.reload) = (Handle::NONE, None);
            let old = &mut self.textures[hidden_index as usize];
            (old.array, old.layer, old.group) = (slot.array, slot.layer, slot.group);
            (old.state, old.levels) = (slot.state, slot.levels);
            self.set_dropped(index as usize, level);
            let incoming = slot.incoming;
            for release in &mut self.releases {
                if release.texture == incoming {
                    release.texture = texture;
                }
            }
            let _ = self.destroy(incoming, self.recorded);
            self.memory.reloads.retain(|&t| t != texture);
            k -= 1;
            self.memory.epoch = self.memory.epoch.wrapping_add(1);
            self.layers_changed = true;
            swapped = true;
        }
        swapped
    }

    /// How a texture can drop its largest level now, if it can.
    fn drop_kind(&self, slot: &TextureSlot) -> Option<Drop> {
        if slot.owner != Handle::NONE
            || !slot.reloadable
            || slot.moving
            || slot.reload.is_some()
            || slot.dropped >= MAX_DROPPED_LEVELS
        {
            return None;
        }
        let key = self.arrays[slot.array as usize].key;
        let block = format::block_size(key.format);
        let width = format::level_size(slot.full[0], slot.dropped + 1);
        let height = format::level_size(slot.full[1], slot.dropped + 1);
        if key.kind != Kind::Layers
            || key.mips < 2
            || !width.is_multiple_of(block)
            || !height.is_multiple_of(block)
            || key.layer_bytes() * u64::from(key.depth) < MIN_DROP_BYTES
        {
            return None;
        }
        // No GPU path copies the texels of a format that takes writes only.
        let writes_only = format::writes_only(key.format);
        match slot.state {
            State::Uploaded { .. } if writes_only => Some(Drop::Reload),
            State::Uploaded { .. } => Some(Drop::Copy),
            State::Queued {
                source: Source::Data { .. },
                ..
            } if !slot.mipmaps => Some(Drop::Skip),
            _ => None,
        }
    }

    /// The texture whose largest level drops next, in Godot's order, and how it drops.
    fn drop_candidate(&self, frame: u32) -> Option<(Handle, Drop)> {
        let mut best: Option<(DropRank, Handle, Drop)> = None;
        for slot in self.handles.live().iter_ones() {
            let texture = &self.textures[slot as usize];
            let Some(how) = self.drop_kind(texture) else {
                continue;
            };
            let key = self.arrays[texture.array as usize].key;
            let rank = (
                texture.dropped < texture.unneeded,
                frames_unseen(frame, texture.seen),
                key.layer_bytes() * u64::from(key.depth),
                MAX_DROPPED_LEVELS - texture.dropped,
                u32::MAX - slot,
            );
            if best.as_ref().is_none_or(|(top, ..)| rank > *top) {
                let generation = u32::from(self.handles.generations()[slot as usize]);
                best = Some((rank, Handle::new(slot, generation), how));
            }
        }
        best.map(|(_, texture, how)| (texture, how))
    }

    /// The texture whose level comes back next: the one whose views need the most levels it
    /// lacks, then the one seen last, then the cheapest. Returns it with the bytes it adds.
    fn restore_candidate(&self, frame: u32) -> Option<(Handle, u64)> {
        let mut best: Option<((u32, u32, u64), Handle, u64)> = None;
        for slot in self.handles.live().iter_ones() {
            let texture = &self.textures[slot as usize];
            if texture.owner != Handle::NONE
                || !texture.reloadable
                || texture.dropped == 0
                || texture.moving
                || texture.reload.is_some()
                || texture.unneeded >= texture.dropped
            {
                continue;
            }
            let cost = self
                .bytes_at(texture, texture.dropped - 1)
                .saturating_sub(self.bytes_at(texture, texture.dropped));
            let rank = (
                texture.dropped - texture.unneeded,
                u32::MAX - frames_unseen(frame, texture.seen),
                u64::MAX - cost,
            );
            if best.as_ref().is_none_or(|(top, ..)| rank > *top) {
                let generation = u32::from(self.handles.generations()[slot as usize]);
                best = Some((rank, Handle::new(slot, generation), cost));
            }
        }
        best.map(|(_, texture, cost)| (texture, cost))
    }

    /// Asks the page to load a texture's texels again without their largest `level` levels.
    fn ask_reload(&mut self, texture: Handle, level: u32) {
        if let Ok(slot) = self.slot_mut(texture) {
            slot.reload = Some(level);
            self.memory.reloads.push(texture);
            self.memory.epoch = self.memory.epoch.wrapping_add(1);
        }
    }

    /// Drops a texture's largest level as `how` says. Returns true when the texture moved to
    /// another array, which changes the draw tables.
    fn drop_level(&mut self, texture: Handle, how: Drop) -> bool {
        let Ok(index) = self.handles.resolve(texture) else {
            return false;
        };
        let mut slot = self.textures[index as usize];
        if how == Drop::Reload {
            self.ask_reload(texture, slot.dropped + 1);
            return false;
        }
        let key = self.arrays[slot.array as usize].key;
        let smaller = ArrayKey {
            width: format::level_size(key.width, 1),
            height: format::level_size(key.height, 1),
            mips: key.mips - 1,
            ..key
        };
        let from = (slot.array, slot.layer);
        if how == Drop::Copy {
            self.arrays[slot.array as usize].leaving += key.depth;
            slot.moving = true;
        } else if let State::Queued {
            source: Source::Data { slot: data },
            ..
        } = slot.state
        {
            // The texels hold each level's layers in turn, so the largest level's go first.
            let words = (format::level_bytes(key.format, key.width, key.height, 0)
                * u64::from(key.depth)
                / 4) as usize;
            let texels = &mut self.data[data as usize];
            texels.copy_within(words.., 0);
            texels.truncate(texels.len() - words);
            self.arrays[slot.array as usize].mark(slot.layer, false);
            slot.state = State::Queued {
                source: Source::Data { slot: data },
                rows: 0,
            };
        }
        self.settle(&mut slot, smaller);
        if !slot.mipmaps {
            slot.levels -= 1;
        }
        if how == Drop::Copy {
            self.moves.push(Move {
                texture,
                from,
                to: (slot.array, slot.layer),
                layers: key.depth,
            });
        }
        self.textures[index as usize] = slot;
        self.set_dropped(index as usize, slot.dropped + 1);
        self.memory.epoch = self.memory.epoch.wrapping_add(1);
        self.layers_changed = true;
        true
    }

    /// Fits the textures to the budget before a frame is recorded: swaps the loads again that
    /// finished, then drops levels past the band's top or gives levels back below its bottom.
    /// Returns true when a texture moved to another array, which changes the draw tables.
    pub fn fit_memory(&mut self) -> bool {
        let mut changed = self.swap_incoming();
        let limit = self.memory.limit;
        if limit == 0 {
            return changed;
        }
        let frame = next_frame(self.recorded);
        let band = limit * BAND_PERCENT / 100;
        let (top, bottom) = (limit + band, limit - band);
        for array in &mut self.arrays {
            array.compact = false;
        }
        let mut projected = self.projected_bytes();
        if projected > top {
            projected = self.compact_arrays();
            let mut steps = 0;
            while projected > bottom && steps < STEPS_PER_FRAME {
                let Some((texture, how)) = self.drop_candidate(frame) else {
                    break;
                };
                changed |= self.drop_level(texture, how);
                projected = self.compact_arrays();
                steps += 1;
            }
        } else if projected < bottom && self.memory.dropped_levels > 0 {
            let mut steps = 0;
            while steps < STEPS_PER_FRAME {
                let Some((texture, cost)) = self.restore_candidate(frame) else {
                    break;
                };
                if projected + cost > bottom {
                    break;
                }
                let level = self.slot(texture).map_or(0, |slot| slot.dropped - 1);
                self.ask_reload(texture, level);
                projected = self.projected_bytes();
                steps += 1;
            }
        }
        changed
    }

    /// True when the estimate of need should run: while the textures take more than half the
    /// budget, or any texture has dropped levels.
    pub fn needs_estimate(&self) -> bool {
        let limit = self.memory.limit;
        limit > 0 && (self.memory.dropped_levels > 0 || self.memory_bytes() > limit / 2)
    }

    /// Reads up to [`SPHERES_PER_FRAME`] bounding spheres of objects and instance rows, from where
    /// the last frame stopped, against `view`. Once it has read every one, it notes what each
    /// texture needs, and starts again.
    pub(crate) fn estimate_needs(
        &mut self,
        scene: &SceneStorage,
        batches: &BatchTable,
        materials: &MaterialTable,
        view: &NeedView,
    ) {
        let parity = view.parity;
        let sweep = &mut self.memory.sweep;
        let rows = materials.capacity() as usize;
        if sweep.pixels.len() < rows {
            sweep.pixels.resize(rows, 0.0);
        }
        let mut left = SPHERES_PER_FRAME;
        let cells = scene.cell_table();
        let note = |pixels: &mut [f32], material: u32, value: f32| {
            if let Some(best) = material
                .checked_sub(1)
                .and_then(|m| pixels.get_mut(m as usize))
            {
                *best = best.max(value);
            }
        };
        let world = scene.world(parity);
        let created = scene.created();
        let capacity = scene.capacity();
        while sweep.object < capacity && left > 0 {
            let slot = sweep.object;
            sweep.object += 1;
            left -= 1;
            let material = scene.materials()[slot as usize];
            if material == 0 || !created.get(slot) {
                continue;
            }
            let cell = cells.coords(scene.cells()[slot as usize]);
            let pixels = sphere_pixels(view, world, slot as usize, cell);
            note(&mut sweep.pixels, material, pixels);
        }
        if sweep.object >= capacity {
            for (_, batch) in batches.iter().skip(sweep.batch as usize) {
                let world = batch.world(parity);
                let count = batch.active_count();
                let material = batch.material();
                while sweep.row < count && left > 0 {
                    let row = sweep.row;
                    sweep.row += 1;
                    left -= 1;
                    let cell = cells.coords(batch.cells()[row as usize]);
                    let pixels = sphere_pixels(view, world, row as usize, cell);
                    note(&mut sweep.pixels, material, pixels);
                }
                if left == 0 && sweep.row < count {
                    return;
                }
                sweep.batch += 1;
                sweep.row = 0;
            }
            self.publish_needs(materials, view.background, view.frame);
        }
    }

    /// Notes what each texture needs from the estimate that just read every object, and starts a
    /// new one.
    fn publish_needs(&mut self, materials: &MaterialTable, background: Handle, frame: u32) {
        let mut pixels = std::mem::take(&mut self.memory.sweep.pixels);
        for (row, best) in pixels.iter_mut().enumerate() {
            if *best > 0.0 {
                for map in materials.maps(row as u32) {
                    if let Ok(slot) = self.slot_mut(map) {
                        slot.pixels = slot.pixels.max(*best);
                    }
                }
            }
            *best = 0.0;
        }
        self.memory.sweep = Sweep {
            pixels,
            ..Sweep::default()
        };
        if let Ok(slot) = self.slot_mut(background) {
            slot.pixels = INSIDE;
        }
        for slot in self.handles.live().iter_ones() {
            let texture = &mut self.textures[slot as usize];
            if texture.pixels > 0.0 {
                texture.seen = frame;
            }
            texture.unneeded =
                unneeded_levels(texture.full[0].max(texture.full[1]), texture.pixels);
            texture.pixels = 0.0;
        }
    }

    /// Readies the budget for a new GPU device: moves under way are void, and each texture whose
    /// texels the device lost, and which the page can load again, asks for them.
    pub(super) fn reset_budget(&mut self) {
        let mut k = 0;
        while k < self.memory.reloads.len() {
            let texture = self.memory.reloads[k];
            k += 1;
            let incoming = self
                .slot(texture)
                .map_or(Handle::NONE, |slot| slot.incoming);
            if self
                .slot(incoming)
                .is_ok_and(|hidden| hidden.state == State::Empty)
            {
                self.cancel_reload(texture);
                k -= 1;
            }
        }
        for k in 0..self.moves.len() {
            let Move {
                texture,
                from,
                layers,
                ..
            } = self.moves[k];
            if let Ok(slot) = self.slot_mut(texture) {
                slot.moving = false;
            }
            let array = &mut self.arrays[from.0 as usize];
            array.mark(from.1, false);
            array.leaving -= layers;
        }
        self.moves.clear();
        for slot in 0..self.textures.len() as u32 {
            let texture = self.textures[slot as usize];
            if self.handles.live().get(slot)
                && texture.reloadable
                && texture.reload.is_none()
                && texture.state == State::Empty
            {
                let generation = u32::from(self.handles.generations()[slot as usize]);
                self.ask_reload(Handle::new(slot, generation), texture.dropped);
            }
        }
    }
}

/// The pixels across row `row`'s bounding sphere in `world`, whose position is relative to `cell`.
fn sphere_pixels(view: &NeedView, world: &WorldArrays, row: usize, cell: CellCoords) -> f32 {
    let [x, y, z, radius] = world.sphere(row);
    if radius >= 1.0e29 {
        return INSIDE;
    }
    let [ox, oy, oz] = view.camera.offset_to(cell);
    view.pixels([x + ox, y + oy, z + oz], radius)
}

#[cfg(test)]
mod tests {
    use super::super::tests::{Harness, astc_desc, fill, layer_bytes, ops};
    use super::*;
    use crate::camera::Perspective;
    use null3d_core::frames::FIRST_FRAME;
    use null3d_gpu::caps::Capabilities;

    /// `count` textures of `size` x `size` from images that the page can load again, on the GPU.
    fn loaded(h: &mut Harness, count: u32, size: u32) -> Vec<Handle> {
        let textures: Vec<Handle> = (0..count)
            .map(|_| {
                let texture = h.texture(size, size);
                h.image(texture, size, size);
                h.store.set_reloadable(texture).unwrap();
                texture
            })
            .collect();
        h.arrive(h.images.len() as u32);
        h.frame();
        textures
    }

    fn dropped(h: &Harness, textures: &[Handle]) -> Vec<u32> {
        textures
            .iter()
            .map(|&t| h.store.dropped_levels(t).unwrap())
            .collect()
    }

    #[test]
    fn textures_past_the_budget_move_to_smaller_arrays_until_they_fit_under_it() {
        let mut h = Harness::new();
        let textures = loaded(&mut h, 4, 256);
        let (large, small) = (layer_bytes(256, 256), layer_bytes(128, 128));
        assert_eq!(h.store.memory_bytes(), 4 * large);
        h.store.set_memory_budget(1_000_000);
        let (commands, _) = h.frame();
        // Two drops bring 1,398,096 bytes under the band's bottom of 950,000.
        assert_eq!(dropped(&h, &textures), [1, 1, 0, 0], "lowest slots first");
        assert_eq!(h.store.dropped(), (2, 2));
        let copies = ops(&commands, Op::CopyTextureToTexture);
        let moves: Vec<&Vec<u32>> = copies.iter().filter(|c| c[1] == c[6] + 1).collect();
        assert_eq!(
            moves.len(),
            2 * 8,
            "every level of the 128-texel chain, for each texture"
        );
        assert_eq!(moves[0][10..], [128, 128, 1]);
        let slot = |t: Handle| *h.store.slot(t).unwrap();
        assert_eq!(slot(textures[0]).array, slot(textures[1]).array);
        assert_ne!(slot(textures[0]).array, slot(textures[2]).array);
        assert_eq!(
            (slot(textures[2]).layer, slot(textures[3]).layer),
            (0, 1),
            "the textures that stay move to the lowest layers"
        );
        assert!(
            h.store.ready_layer(textures[0]).is_some(),
            "a moved texture keeps drawing"
        );
        h.frame();
        assert_eq!(h.store.memory_bytes(), 2 * large + 2 * small);
        assert!(h.store.memory_bytes() <= 1_000_000);
        // Inside the band, nothing changes.
        let epoch = h.store.budget_epoch();
        h.frame();
        assert_eq!(h.store.budget_epoch(), epoch);
        assert_eq!(dropped(&h, &textures), [1, 1, 0, 0]);
    }

    #[test]
    fn a_texture_drops_at_most_three_levels_and_never_below_the_smallest_worth_dropping() {
        let mut h = Harness::new();
        let textures = loaded(&mut h, 2, 1024);
        h.store.set_memory_budget(1);
        for _ in 0..8 {
            h.frame();
        }
        assert_eq!(dropped(&h, &textures), [3, 3]);
        let tiny = loaded(&mut h, 1, 64);
        h.frame();
        h.frame();
        assert_eq!(
            dropped(&h, &tiny),
            [0],
            "a 64-texel texture saves too little"
        );
        assert_eq!(
            h.store.memory_bytes(),
            2 * layer_bytes(128, 128) + layer_bytes(64, 64)
        );
    }

    #[test]
    fn a_texture_the_page_cannot_load_again_keeps_its_levels() {
        let mut h = Harness::new();
        let texture = h.texture(512, 512);
        h.image(texture, 512, 512);
        h.arrive(1);
        h.store.set_memory_budget(1);
        h.frame();
        h.frame();
        assert_eq!(h.store.dropped_levels(texture), Ok(0));
        assert_eq!(h.store.memory_bytes(), layer_bytes(512, 512));
    }

    #[test]
    fn drops_follow_godots_order_of_need_then_time_unseen_then_size() {
        let mut h = Harness::new();
        let big = loaded(&mut h, 1, 512)[0];
        let seen = loaded(&mut h, 1, 256)[0];
        let unseen = loaded(&mut h, 1, 256)[0];
        let far = loaded(&mut h, 1, 256)[0];
        let set = |h: &mut Harness, t: Handle, seen: u32, unneeded: u32| {
            let slot = h.store.slot_mut(t).unwrap();
            (slot.seen, slot.unneeded) = (seen, unneeded);
        };
        let frame = h.frame + 1;
        set(&mut h, big, frame, 0);
        set(&mut h, seen, frame, 0);
        set(&mut h, unseen, 0, 0);
        set(&mut h, far, frame, 2);
        let next = |h: &Harness| h.store.drop_candidate(frame).unwrap().0;
        assert_eq!(next(&h), far, "more detail than any view needs comes first");
        set(&mut h, far, frame, 0);
        assert_eq!(next(&h), unseen, "then the texture unseen the longest");
        set(&mut h, unseen, frame, 0);
        assert_eq!(next(&h), big, "then the largest");
    }

    #[test]
    fn the_texture_unseen_the_longest_drops_first_across_the_wrap_of_the_frame_count() {
        let mut h = Harness::new();
        let [before, after] = loaded(&mut h, 2, 256)[..] else {
            unreachable!()
        };
        let frame = next_frame(next_frame(FIRST_FRAME));
        for (texture, seen) in [(before, u32::MAX - 2), (after, FIRST_FRAME)] {
            h.store.slot_mut(texture).unwrap().seen = seen;
        }
        assert_eq!(
            h.store.drop_candidate(frame).unwrap().0,
            before,
            "the texture last seen before the count went round"
        );
    }

    #[test]
    fn compressed_texels_that_wait_lose_their_largest_level_in_engine_memory() {
        let mut h = Harness::with_capabilities(Capabilities::TEXTURE_ASTC);
        let texture = h.store.create(astc_desc(256, 256, 9)).unwrap();
        fill(&mut h.store, texture, 256, 256);
        h.store.set_reloadable(texture).unwrap();
        let first = format::level_bytes(format::ASTC_4X4_UNORM_SRGB, 256, 256, 0) / 4;
        let words = h.store.data[0].len() as u64;
        h.store.set_memory_budget(1);
        assert!(
            h.store.fit_memory(),
            "the texture moves to an array of 128 texels"
        );
        assert_eq!(h.store.dropped_levels(texture), Ok(1));
        assert_eq!(h.store.data[0].len() as u64, words - first);
        assert_eq!(
            u64::from(h.store.data[0][0]),
            first,
            "level 1 leads the texels now"
        );
        let (commands, _) = h.frame();
        let created = ops(&commands, Op::CreateTexture);
        assert_eq!(created[0][1..3], [128, 128]);
        assert_eq!(created[0][7], 8, "eight levels");
        assert!(ops(&commands, Op::CopyTextureToTexture).is_empty());
    }

    #[test]
    fn compressed_texels_on_the_gpu_load_again_without_their_largest_level() {
        let mut h = Harness::with_capabilities(Capabilities::TEXTURE_ASTC);
        let texture = h.store.create(astc_desc(256, 256, 9)).unwrap();
        fill(&mut h.store, texture, 256, 256);
        h.store.set_reloadable(texture).unwrap();
        h.frame();
        let full = h.store.bytes(texture).unwrap();
        let epoch = h.store.budget_epoch();
        h.store.set_memory_budget(1);
        h.frame();
        assert_ne!(h.store.budget_epoch(), epoch, "the page sees the request");
        assert_eq!(h.store.reload_of(texture), Some((1, Handle::NONE)));
        assert_eq!(h.store.take_reload(), Some(texture));
        assert_eq!(h.store.take_reload(), None, "one load again at a time");
        let (level, hidden) = h.store.reload_of(texture).unwrap();
        assert_eq!(level, 1);
        assert!(
            h.store.ready_layer(texture).is_some(),
            "the old levels still draw"
        );
        fill(&mut h.store, hidden, 128, 128);
        h.frame();
        h.frame();
        assert_eq!(h.store.dropped_levels(texture), Ok(1));
        assert!(
            !h.store.is_live(hidden),
            "the hidden texture is gone after the swap"
        );
        assert!(h.store.ready_layer(texture).is_some());
        h.frame();
        let smaller = h.store.bytes(texture).unwrap();
        assert!(smaller < full / 3);
        assert_eq!(h.store.memory_bytes(), smaller);
    }

    #[test]
    fn shared_exponent_texels_on_the_gpu_load_again_too() {
        let mut h = Harness::new();
        let texture = h
            .store
            .create(TextureDesc {
                format: format::RGB9E5_UFLOAT,
                ..astc_desc(256, 256, 9)
            })
            .unwrap();
        fill(&mut h.store, texture, 256, 256);
        h.store.set_reloadable(texture).unwrap();
        h.frame();
        h.store.set_memory_budget(1);
        h.frame();
        assert_eq!(
            h.store.take_reload(),
            Some(texture),
            "no GPU path copies the format, so the file loads again"
        );
        assert_eq!(h.store.reload_of(texture).map(|(level, _)| level), Some(1));
    }

    #[test]
    fn levels_come_back_when_room_returns_through_a_hidden_texture() {
        let mut h = Harness::new();
        let textures = loaded(&mut h, 4, 256);
        h.store.set_memory_budget(1_000_000);
        h.frame();
        h.frame();
        assert_eq!(dropped(&h, &textures), [1, 1, 0, 0]);
        h.store.destroy(textures[2], h.frame).unwrap();
        h.store.destroy(textures[3], h.frame).unwrap();
        h.frame();
        // Each texture that comes back adds 262,144 bytes, and both fit under 950,000.
        let first = h.store.take_reload().unwrap();
        assert_eq!(first, textures[0], "the lower slot of two equal textures");
        let (level, hidden) = h.store.reload_of(first).unwrap();
        assert_eq!(level, 0);
        let second = h.store.take_reload().unwrap();
        let (_, other) = h.store.reload_of(second).unwrap();
        h.image(hidden, 256, 256);
        h.image(other, 256, 256);
        h.arrive(h.images.len() as u32);
        h.frame();
        h.frame();
        assert_eq!(dropped(&h, &textures[..2]), [0, 0]);
        assert_eq!(h.store.dropped(), (0, 0));
        h.frame();
        assert_eq!(h.store.memory_bytes(), 2 * layer_bytes(256, 256));
    }

    #[test]
    fn new_texels_from_the_page_give_a_texture_its_levels_and_end_its_loads_again() {
        let mut h = Harness::new();
        let textures = loaded(&mut h, 4, 256);
        h.store.set_memory_budget(1_000_000);
        h.frame();
        h.store.set_memory_budget(0);
        h.image(textures[0], 256, 256);
        assert_eq!(h.store.dropped_levels(textures[0]), Ok(0));
        assert_eq!(h.store.dropped(), (1, 1));
        assert!(!h.store.slot(textures[0]).unwrap().reloadable);
    }

    #[test]
    fn a_texture_whose_texels_a_new_gpu_lost_loads_them_again() {
        let mut h = Harness::new();
        let texture = loaded(&mut h, 1, 256)[0];
        h.frame();
        h.frame();
        h.store.reset_gpu();
        assert_eq!(h.store.reload_of(texture), Some((0, Handle::NONE)));
    }

    #[test]
    fn the_estimate_keeps_one_level_more_than_one_texel_per_pixel() {
        assert_eq!(unneeded_levels(1024, 1024.0), 0);
        assert_eq!(unneeded_levels(1024, 256.0), 1);
        assert_eq!(unneeded_levels(1024, 128.0), 2);
        assert_eq!(unneeded_levels(1024, 16.0), MAX_DROPPED_LEVELS);
        assert_eq!(unneeded_levels(1024, 0.0), MAX_DROPPED_LEVELS, "unseen");
        let lens = Perspective {
            fov_degrees: 90.0,
            near: 0.1,
            far: 1000.0,
        };
        let projection = Lens::Perspective(lens).projection(1.0);
        let view = NeedView {
            camera: CellPosition {
                cell: [0; 3],
                local: [0.0; 3],
            },
            frustum: Frustum::from_view_projection(&projection),
            lens: Lens::Perspective(lens),
            height: 1000.0,
            frame: 1,
            parity: 0,
            background: Handle::NONE,
        };
        // A sphere of radius 1 at distance 10 straight ahead covers a tenth of the height.
        let ahead = view.pixels([0.0, 0.0, -10.0], 1.0);
        assert!((ahead - 100.0).abs() < 0.5, "{ahead}");
        assert_eq!(view.pixels([0.0, 0.0, 10.0], 1.0), 0.0, "behind the camera");
        assert_eq!(view.pixels([0.0, 0.0, -0.5], 1.0), INSIDE);
    }
}
