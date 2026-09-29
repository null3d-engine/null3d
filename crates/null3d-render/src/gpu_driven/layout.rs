//! The sources and buckets that every view culls and draws, and their uploads: the world matrices,
//! the bucket of every source, and the bucket records that the culling shader reads.

use std::collections::TryReserveError;

use null3d_core::handle::Handle;
use null3d_core::instances::BatchTable;
use null3d_core::scene::SceneStorage;
use null3d_core::snapshot::SCENE_TARGET;
use null3d_core::world::MATRIX_FLOATS;
use null3d_gpu::drawlist::{DrawList, Op, buffer_usage as usage};

use super::ids;
use crate::frame::{
    FrameInput, HIDDEN, RecordError, SceneSettings, UploadArena, address, bucket_of,
    collect_bucket_keys, drawn_rows, floats_as_bytes, grown_size, words_as_bytes,
};
use crate::materials::Shading;

/// Bytes of one bucket record in the culling shader: base, material, radius, padding.
pub(super) const BUCKET_BYTES: u32 = 16;
/// Bytes of one world matrix: three rows of four floats.
const MATRIX_BYTES: u32 = (MATRIX_FLOATS * 4) as u32;

/// What makes a bucket: its shading (the pipeline), its engine mesh id and its material id.
type BucketKey = (Shading, u32, u32);

/// One bucket: its draw, and its slice of each view's compacted instance buffer.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Bucket {
    pub(super) shading: Shading,
    pub(super) material: u32,
    pub(super) base: u32,
    pub(super) capacity: u32,
    pub(super) index_count: u32,
    pub(super) first_index: u32,
    pub(super) base_vertex: u32,
    pub(super) radius: f32,
}

/// A scene object's entry in the bucket table: its bucket, or `HIDDEN` while it is hidden, which
/// its world radius says.
fn scene_membership(home: u32, world_radius: f32) -> u32 {
    if world_radius == f32::NEG_INFINITY {
        HIDDEN
    } else {
        home
    }
}

/// Uploads the bucket table entries of sources `start..end`.
fn write_entries(
    list: &mut DrawList,
    arena: &mut UploadArena,
    table: &[u32],
    start: u32,
    end: u32,
) -> Result<(), RecordError> {
    let (at, bytes) = arena.push(words_as_bytes(&table[start as usize..end as usize]))?;
    list.push(
        Op::WriteBuffer,
        &[ids::INSTANCE_BUCKETS, start * 4, at, bytes],
    )?;
    Ok(())
}

/// The source layout and bucket tables, rebuilt when the structure changes.
#[derive(Default)]
pub(super) struct Layout {
    pub(super) sources: u32,
    /// Each batch's raw id and the first source of its rows.
    batch_bases: Vec<(u32, u32)>,
    pub(super) buckets: Vec<Bucket>,
    /// The bucket of every source, or `HIDDEN`.
    instance_buckets: Vec<u32>,
    /// The bucket of every scene slot whether it is shown or not, or `HIDDEN` for a slot with no
    /// mesh or material.
    home_buckets: Vec<u32>,
    /// Each batch's bucket and the active row count its table entries hold, in `batch_bases` order.
    batch_rows: Vec<(u32, u32)>,
    /// The per-frame reset of every bucket's indirect draw: instance counts at zero.
    pub(super) indirect_template: Vec<u32>,
    /// Bucket records in the culling shader's layout.
    bucket_records: Vec<u32>,
    /// Scratch for rebuilds: every bucket key with its source count, sorted and merged into one
    /// entry per bucket.
    key_counts: Vec<(BucketKey, u32)>,
    pub(super) built: bool,
    /// Sizes of the matrix buffer, the bucket table and the bucket records, 0 before they exist.
    buffer_sizes: [u32; 3],
}

impl Layout {
    fn base_of(&self, target: u32) -> Option<u32> {
        if target == SCENE_TARGET {
            return Some(0);
        }
        self.batch_bases
            .iter()
            .find(|(id, _)| *id == target)
            .map(|&(_, base)| base)
    }

    /// The sources that draw somewhere, which each view's compacted instance buffer holds.
    pub(super) fn drawable(&self) -> u32 {
        self.buckets.iter().map(|b| b.capacity).sum()
    }

    /// The most that one frame copies into its arena for the tables: the bucket table and the
    /// bucket records.
    pub(super) fn upload_bound(&self) -> usize {
        self.sources as usize * 4 + self.buckets.len() * BUCKET_BYTES as usize
    }

    /// Makes room for the bucket table of `sources` sources.
    pub(super) fn reserve(&mut self, sources: u32) -> Result<(), TryReserveError> {
        let table = &mut self.instance_buckets;
        table.try_reserve((sources as usize).saturating_sub(table.len()))
    }

    /// Forgets the buffers, so the next layout makes them again and uploads everything.
    pub(super) fn forget_gpu(&mut self) {
        self.built = false;
        self.buffer_sizes = [0; 3];
    }

    /// Assigns every source to a bucket and lays the buckets out, from the frame's world state. It
    /// reuses the layout's tables and scratch space, which grow only with the scene. A scene of
    /// more than `limit` sources fails.
    pub(super) fn rebuild(
        &mut self,
        settings: &SceneSettings,
        scene: &SceneStorage,
        batches: &BatchTable,
        parity: usize,
        limit: u32,
    ) -> Result<(), RecordError> {
        let scene_rows = scene.capacity() + 1;
        self.batch_bases.clear();
        let mut sources = scene_rows;
        for (id, batch) in batches.iter() {
            self.batch_bases.push((id.raw(), sources));
            sources += batch.capacity();
        }
        if sources > limit {
            return Err(RecordError::TooManySources { limit });
        }
        self.sources = sources;

        let key_of = |mesh: u32, material: u32| -> Option<BucketKey> {
            Some((settings.shading_of(mesh, material)?, mesh, material))
        };
        let world = scene.world(parity);
        let scene_key = |slot: usize| key_of(scene.meshes()[slot], scene.materials()[slot]);

        collect_bucket_keys(
            &mut self.key_counts,
            scene,
            batches,
            scene_key,
            |_, batch| key_of(batch.mesh(), batch.material()),
        );

        self.buckets.clear();
        let mut base = 0;
        for &((shading, mesh, material), count) in &self.key_counts {
            let slot = settings
                .meshes()
                .mesh(mesh - 1)
                .expect("keys name known meshes");
            self.buckets.push(Bucket {
                shading,
                material,
                base,
                capacity: count,
                index_count: slot.index_count,
                first_index: slot.first_index,
                base_vertex: slot.base_vertex,
                radius: slot.radius,
            });
            base += count;
        }

        let counts = &self.key_counts;
        let bucket_of = |key: Option<BucketKey>| bucket_of(counts, key).unwrap_or(HIDDEN);
        self.instance_buckets.clear();
        self.home_buckets.clear();
        for slot in 0..scene_rows as usize {
            let home = bucket_of(scene_key(slot));
            self.home_buckets.push(home);
            self.instance_buckets
                .push(scene_membership(home, world.radii()[slot]));
        }
        self.batch_rows.clear();
        for (_, batch) in batches.iter() {
            let bucket = bucket_of(key_of(batch.mesh(), batch.material()));
            let active = batch.frame_active_count(parity);
            self.batch_rows.push((bucket, active));
            self.instance_buckets.extend(
                (0..batch.capacity()).map(|row| if row < active { bucket } else { HIDDEN }),
            );
        }

        self.indirect_template.clear();
        self.bucket_records.clear();
        for bucket in &self.buckets {
            self.indirect_template.extend_from_slice(&[
                bucket.index_count,
                0,
                bucket.first_index,
                bucket.base_vertex,
                0,
            ]);
            self.bucket_records.extend_from_slice(&[
                bucket.base,
                bucket.material - 1,
                bucket.radius.to_bits(),
                0,
            ]);
        }
        self.built = true;
        Ok(())
    }

    /// Sizes the shared buffers for the layout, at most `binding_bytes` each, and uploads its
    /// tables. Returns true when it made a buffer again, which the views' culling groups bind.
    pub(super) fn apply(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        binding_bytes: u32,
    ) -> Result<bool, RecordError> {
        let needed = [
            (ids::MATRICES, self.sources * MATRIX_BYTES),
            (ids::INSTANCE_BUCKETS, self.sources * 4),
            (
                ids::BUCKETS,
                (self.buckets.len() as u32).max(1) * BUCKET_BYTES,
            ),
        ];
        let mut recreated = false;
        for ((id, size), made) in needed.into_iter().zip(&mut self.buffer_sizes) {
            if *made < size {
                *made = grown_size(size, binding_bytes);
                list.push(
                    Op::CreateBuffer,
                    &[id, *made, usage::STORAGE | usage::COPY_DST],
                )?;
                recreated = true;
            }
        }
        let (at, bytes) = arena.push(words_as_bytes(&self.instance_buckets))?;
        list.push(Op::WriteBuffer, &[ids::INSTANCE_BUCKETS, 0, at, bytes])?;
        if !self.buckets.is_empty() {
            let (at, bytes) = arena.push(words_as_bytes(&self.bucket_records))?;
            list.push(Op::WriteBuffer, &[ids::BUCKETS, 0, at, bytes])?;
        }
        Ok(recreated)
    }

    /// Rewrites the bucket table entries of the sources whose membership changed since the layout
    /// was built, without a rebuild: scene objects shown or hidden this frame, which the frame's
    /// uploads name, and the batch rows that a new active count added or removed.
    pub(super) fn update_membership(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        input: &FrameInput<'_>,
        parity: usize,
    ) -> Result<(), RecordError> {
        let radii = input.scene.world(parity).radii();
        let scene_rows = self.home_buckets.len() as u32;
        let (home_buckets, instance_buckets) = (&self.home_buckets, &mut self.instance_buckets);
        let mut check = |start: u32, count: u32| -> Result<(), RecordError> {
            let mut changed: Option<(u32, u32)> = None;
            for slot in start..(start + count).min(scene_rows) {
                let s = slot as usize;
                let wanted = scene_membership(home_buckets[s], radii[s]);
                if instance_buckets[s] != wanted {
                    instance_buckets[s] = wanted;
                    changed =
                        Some(changed.map_or((slot, slot + 1), |(first, _)| (first, slot + 1)));
                }
            }
            match changed {
                Some((first, end)) => write_entries(list, arena, instance_buckets, first, end),
                None => Ok(()),
            }
        };
        if input.snapshot.overflowed() {
            check(0, scene_rows)?;
        } else {
            for range in input.snapshot.uploads() {
                if range.target == SCENE_TARGET {
                    check(range.start, range.count)?;
                }
            }
        }
        for (index, (_, batch)) in input.batches.iter().enumerate() {
            let (bucket, was) = self.batch_rows[index];
            let now = batch.frame_active_count(parity);
            if now == was {
                continue;
            }
            let base = self.batch_bases[index].1;
            let (low, high) = (was.min(now), was.max(now));
            for row in low..high {
                self.instance_buckets[(base + row) as usize] =
                    if row < now { bucket } else { HIDDEN };
            }
            self.batch_rows[index].1 = now;
            write_entries(list, arena, &self.instance_buckets, base + low, base + high)?;
        }
        Ok(())
    }

    /// Uploads changed world matrices straight from the core's world buffers of this parity, or
    /// every matrix after the layout changed.
    pub(super) fn upload_matrices(
        &self,
        list: &mut DrawList,
        input: &FrameInput<'_>,
        parity: usize,
        everything: bool,
    ) -> Result<(), RecordError> {
        let mut upload = |base: u32, matrices: &[f32], start: u32, count: u32| {
            let floats =
                &matrices[start as usize * MATRIX_FLOATS..(start + count) as usize * MATRIX_FLOATS];
            list.push(
                Op::WriteBuffer,
                &[
                    ids::MATRICES,
                    (base + start) * MATRIX_BYTES,
                    address(floats_as_bytes(floats)),
                    count * MATRIX_BYTES,
                ],
            )
        };
        if everything || input.snapshot.overflowed() {
            // Slots past the highest one ever used, and rows past a batch's active count, draw
            // nothing; they upload when they change.
            let scene = input.scene.world(parity).matrices();
            upload(0, scene, 0, input.scene.slots().high_water())?;
            for ((_, batch), &(_, base)) in input.batches.iter().zip(&self.batch_bases) {
                let active = batch.frame_active_count(parity);
                upload(base, batch.world(parity).matrices(), 0, active)?;
            }
            return Ok(());
        }
        for range in input.snapshot.uploads() {
            let Some(base) = self.base_of(range.target) else {
                continue;
            };
            if range.target == SCENE_TARGET {
                let scene = input.scene.world(parity).matrices();
                if let Some((start, count)) =
                    drawn_rows(&self.home_buckets, range.start, range.count)
                {
                    upload(base, scene, start, count)?;
                }
                continue;
            }
            let Ok(batch) = input.batches.get(Handle::from_raw(range.target)) else {
                continue;
            };
            upload(
                base,
                batch.world(parity).matrices(),
                range.start,
                range.count,
            )?;
        }
        Ok(())
    }
}
