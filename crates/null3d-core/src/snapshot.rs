//! The frame handoff: the sketch worker computes frame `f + 1` while the render worker reads frame
//! `f`, and neither ever touches memory the other is writing.
//!
//! # What is double-buffered
//!
//! Frame `f` writes world buffer `f & 1` of the scene and of every instance batch (see
//! [`crate::world`]) and snapshot slot `f & 1`, which holds the frame's upload list: which rows of
//! which world arrays changed. Dynamic objects and dynamic batches are recomputed into the frame's
//! buffer every frame. A static change is written into the frame's buffer when it happens, and
//! into the other buffer by the next frame, which copies each row that changed in the previous
//! frame and did not change again. So both buffers always hold every change, each changed matrix
//! is written once into each buffer, and nothing else is copied. Input arrays (positions,
//! rotations, scales, colours) are never read by the render worker, so they are not buffered.
//!
//! # Protocol
//!
//! Frames are numbered from 1, and step and compare as [`crate::frames`] says, so the count goes
//! round. Below, `f - 1` is the frame before `f`, and "at least" compares by that order. Two atomic
//! words, each on its own cache line, carry the handoff: `published` holds the newest finished
//! frame, and `acknowledged` the newest frame the render worker finished reading. Both start at 0.
//!
//! Sketch worker (producer), frame `f`:
//!
//! 1. Wait until [`FrameHandoff::can_write`]: `published` is `f - 1`, and `acknowledged` (loaded
//!    with acquire ordering) is at least `f - 2`. Frame `f - 2` was the last reader of buffer
//!    and slot `f & 1`, so the render worker no longer touches them. The sketch worker waits with
//!    `Atomics.waitAsync` on `acknowledged`, never with a blocking wait.
//! 2. Run the frame: apply commands, update transforms and batches, cull, and record the upload
//!    list into slot `f & 1`.
//! 3. [`FrameHandoff::publish`]: store `f` into `published` with release ordering, then notify
//!    waiters on that word.
//!
//! Render worker (consumer):
//!
//! 1. [`FrameHandoff::next_readable`]: load `published` with acquire ordering. When it is past
//!    `acknowledged`, frame `g = acknowledged + 1` is complete: the acquire pairs with the
//!    producer's release store, so every write of frame `g` is visible.
//! 2. Read slot `g & 1`, and for each upload range the rows of world buffer `g & 1`; upload them.
//! 3. [`FrameHandoff::acknowledge`]: store `g` into `acknowledged` with release ordering, then
//!    notify waiters. The release pairs with the producer's acquire load in step 1, so the
//!    producer's next writes to buffer `g & 1` (in frame `g + 2`) come after every read.
//!
//! The render worker takes frames strictly in order and never skips one: upload lists hold only
//! what changed, so every list must reach the GPU. The producer can be at most one frame ahead of
//! the frame being read. In the single-threaded and low-latency modes one thread publishes a frame
//! and reads it at once.
//!
//! [`FrameHandoff::split`] gives Rust code a safe producer and consumer pair. The WebAssembly
//! layer, where the two workers are separate instances sharing memory, uses the atomic methods
//! and the `unsafe` slot accessors directly, under the same rules.

use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicU32, Ordering};

use crate::arena::Pod;
use crate::frames::{frame_after, next_frame, previous_frame};
use crate::instances::BatchTable;
use crate::scene::SceneStorage;
use crate::shared::CachePadded;
use crate::wait;

/// The upload target of scene objects. Instance batches use their raw batch id.
pub const SCENE_TARGET: u32 = 0;

/// Rows `start..start + count` of one target's world arrays changed in a frame.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct UploadRange {
    /// [`SCENE_TARGET`] for scene objects, or a batch id's raw value.
    pub target: u32,
    /// The first row (slot for scene objects).
    pub start: u32,
    /// The number of rows.
    pub count: u32,
}

// SAFETY: three `u32` fields in a `repr(C)` struct have no padding, and any bits are valid.
unsafe impl Pod for UploadRange {}

/// What one frame hands to the render worker: its number and its upload list.
#[derive(Clone, Debug)]
pub struct FrameSnapshot {
    frame: u32,
    uploads: Vec<UploadRange>,
    overflowed: bool,
}

impl FrameSnapshot {
    /// An empty snapshot with room for `capacity` upload ranges.
    pub fn with_capacity(capacity: u32) -> Self {
        Self {
            frame: 0,
            uploads: Vec::with_capacity(capacity as usize),
            overflowed: false,
        }
    }

    /// The frame this snapshot belongs to.
    pub fn frame(&self) -> u32 {
        self.frame
    }

    /// The changed row ranges, in the order they were recorded.
    pub fn uploads(&self) -> &[UploadRange] {
        &self.uploads
    }

    /// True when the list ran out of room for a target's range. The reader must then upload
    /// every row of every target for this frame. A range of the last range's target never
    /// overflows the list: it widens the last range instead.
    pub fn overflowed(&self) -> bool {
        self.overflowed
    }

    /// Empties the snapshot and labels it with `frame`.
    pub fn clear(&mut self, frame: u32) {
        self.frame = frame;
        self.uploads.clear();
        self.overflowed = false;
    }

    /// Appends a changed range, merging it with the previous one when they touch. Never
    /// allocates. Past the capacity, a range of the last range's target that starts after it
    /// widens it to cover both, with the rows between them, so the list holds what changed and
    /// some rows that did not. Both world buffers hold the latest matrix of every row that
    /// draws, so such rows upload unchanged. Any other range past the capacity sets
    /// [`FrameSnapshot::overflowed`].
    pub fn push_upload(&mut self, target: u32, start: u32, count: u32) {
        self.push_within(target, start, count, self.uploads.capacity());
    }

    /// [`FrameSnapshot::push_upload`] with room for `room` ranges, at most the capacity.
    fn push_within(&mut self, target: u32, start: u32, count: u32, room: usize) {
        if count == 0 {
            return;
        }
        let full = self.uploads.len() >= room;
        if let Some(last) = self.uploads.last_mut()
            && last.target == target
            && (last.start + last.count == start || full && last.start <= start)
        {
            last.count = (start + count).max(last.start + last.count) - last.start;
            return;
        }
        if !full {
            self.uploads.push(UploadRange {
                target,
                start,
                count,
            });
        } else {
            self.overflowed = true;
        }
    }

    /// Records frame `frame`'s uploads: the scene's changed slots, then each batch's changed
    /// ranges, in batch id order.
    /// The scene's ranges leave room for every batch's, so only batch ranges past the capacity
    /// overflow the list.
    pub fn record(&mut self, frame: u32, scene: &SceneStorage, batches: &BatchTable) {
        self.clear(frame);
        let capacity = self.uploads.capacity();
        let batch_ranges: usize = batches.iter().map(|(_, b)| b.changed_ranges().len()).sum();
        let scene_room = capacity.saturating_sub(batch_ranges).max(1);
        for (start, count) in scene.changed().runs() {
            self.push_within(SCENE_TARGET, start, count, scene_room);
        }
        for (id, batch) in batches.iter() {
            for range in batch.changed_ranges() {
                self.push_upload(id.raw(), range.start, range.count);
            }
        }
    }
}

/// The shared state of the handoff: the two atomic words and the two snapshot slots. See the
/// module documentation for the protocol.
pub struct FrameHandoff {
    published: CachePadded<AtomicU32>,
    acknowledged: CachePadded<AtomicU32>,
    slots: [UnsafeCell<FrameSnapshot>; 2],
}

// SAFETY: slot `f & 1` is written only by the producer while `can_write(f)` holds and before it
// publishes `f`, and read only by the consumer after `next_readable` returned `f` and before it
// acknowledges `f`. The release and acquire pairs on the two words order these accesses.
unsafe impl Sync for FrameHandoff {}

impl FrameHandoff {
    /// A handoff whose snapshots hold up to `upload_capacity` upload ranges each.
    pub fn new(upload_capacity: u32) -> Self {
        Self {
            published: CachePadded(AtomicU32::new(0)),
            acknowledged: CachePadded(AtomicU32::new(0)),
            slots: [
                UnsafeCell::new(FrameSnapshot::with_capacity(upload_capacity)),
                UnsafeCell::new(FrameSnapshot::with_capacity(upload_capacity)),
            ],
        }
    }

    /// The newest published frame, 0 before the first.
    pub fn published(&self) -> u32 {
        self.published.0.load(Ordering::Acquire)
    }

    /// The newest acknowledged frame, 0 before the first.
    pub fn acknowledged(&self) -> u32 {
        self.acknowledged.0.load(Ordering::Acquire)
    }

    /// The word the render worker waits on for new frames.
    pub fn published_word(&self) -> &AtomicU32 {
        &self.published.0
    }

    /// The word the sketch worker waits on for acknowledgements.
    pub fn acknowledged_word(&self) -> &AtomicU32 {
        &self.acknowledged.0
    }

    /// Producer: true when frame `frame` may start writing its buffers and slot. It is the frame
    /// after the last published one, and the render worker has finished frame `frame - 2`.
    pub fn can_write(&self, frame: u32) -> bool {
        next_frame(self.published.0.load(Ordering::Relaxed)) == frame
            && !frame_after(
                previous_frame(previous_frame(frame)),
                self.acknowledged.0.load(Ordering::Acquire),
            )
    }

    /// Producer: the snapshot slot of `frame`.
    ///
    /// # Safety
    /// Only the producer calls it, [`FrameHandoff::can_write`] returned true for `frame`, and
    /// the frame is not published yet. No other reference to the slot is alive.
    #[allow(clippy::mut_from_ref)]
    pub unsafe fn slot_mut(&self, frame: u32) -> &mut FrameSnapshot {
        // SAFETY: the protocol gives the producer sole access to this slot, as the caller
        // guarantees.
        unsafe { &mut *self.slots[(frame & 1) as usize].get() }
    }

    /// Producer: publishes `frame` (release store) and wakes the render worker.
    pub fn publish(&self, frame: u32) {
        self.published.0.store(frame, Ordering::Release);
        wait::wake_all(&self.published.0);
    }

    /// Consumer: the next frame to read, when it is published: the one after the last
    /// acknowledged frame. Frames are never skipped.
    pub fn next_readable(&self) -> Option<u32> {
        let published = self.published.0.load(Ordering::Acquire);
        let next = next_frame(self.acknowledged.0.load(Ordering::Relaxed));
        (!frame_after(next, published)).then_some(next)
    }

    /// Consumer: the snapshot slot of `frame`.
    ///
    /// # Safety
    /// Only the consumer calls it, [`FrameHandoff::next_readable`] returned `frame`, and the
    /// frame is not acknowledged yet.
    pub unsafe fn slot(&self, frame: u32) -> &FrameSnapshot {
        // SAFETY: the producer does not write this slot until the frame is acknowledged, as the
        // caller guarantees.
        unsafe { &*self.slots[(frame & 1) as usize].get() }
    }

    /// Consumer: acknowledges `frame` (release store) and wakes the sketch worker.
    pub fn acknowledge(&self, frame: u32) {
        self.acknowledged.0.store(frame, Ordering::Release);
        wait::wake_all(&self.acknowledged.0);
    }

    /// The producer and the consumer. Borrowing the handoff mutably ensures only one of each
    /// exists, which makes their slot access safe.
    pub fn split(&mut self) -> (FrameProducer<'_>, FrameConsumer<'_>) {
        let handoff = &*self;
        (FrameProducer { handoff }, FrameConsumer { handoff })
    }
}

/// The sketch worker's side of a [`FrameHandoff`].
pub struct FrameProducer<'a> {
    handoff: &'a FrameHandoff,
}

impl FrameProducer<'_> {
    /// Starts the next frame when its buffers are free, or returns `None` while the render
    /// worker still reads them.
    pub fn try_begin(&mut self) -> Option<FrameWrite<'_>> {
        let frame = next_frame(self.handoff.published());
        self.handoff.can_write(frame).then_some(FrameWrite {
            handoff: self.handoff,
            frame,
        })
    }
}

/// A frame being written. Dropping it without [`FrameWrite::publish`] abandons the frame.
pub struct FrameWrite<'a> {
    handoff: &'a FrameHandoff,
    frame: u32,
}

impl FrameWrite<'_> {
    /// The frame number.
    pub fn frame(&self) -> u32 {
        self.frame
    }

    /// The frame's snapshot slot.
    pub fn snapshot_mut(&mut self) -> &mut FrameSnapshot {
        // SAFETY: `try_begin` checked `can_write`, the only producer holds this write, and the
        // frame is not published until `publish` consumes it.
        unsafe { self.handoff.slot_mut(self.frame) }
    }

    /// Publishes the frame to the render worker.
    pub fn publish(self) {
        self.handoff.publish(self.frame);
    }
}

/// The render worker's side of a [`FrameHandoff`].
pub struct FrameConsumer<'a> {
    handoff: &'a FrameHandoff,
}

impl FrameConsumer<'_> {
    /// The next published frame, in order, or `None` when none is ready.
    pub fn try_read(&mut self) -> Option<FrameRead<'_>> {
        let frame = self.handoff.next_readable()?;
        Some(FrameRead {
            handoff: self.handoff,
            frame,
        })
    }
}

/// A frame being read. Dropping it acknowledges the frame, which lets the producer reuse its
/// buffers.
pub struct FrameRead<'a> {
    handoff: &'a FrameHandoff,
    frame: u32,
}

impl FrameRead<'_> {
    /// The frame number.
    pub fn frame(&self) -> u32 {
        self.frame
    }

    /// The world buffer and slot parity of this frame: `frame & 1`.
    pub fn parity(&self) -> usize {
        (self.frame & 1) as usize
    }

    /// The frame's snapshot.
    pub fn snapshot(&self) -> &FrameSnapshot {
        // SAFETY: `try_read` got this frame from `next_readable`, and it is acknowledged only
        // when this read is dropped.
        unsafe { self.handoff.slot(self.frame) }
    }
}

impl Drop for FrameRead<'_> {
    fn drop(&mut self) {
        self.handoff.acknowledge(self.frame);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frames::FIRST_FRAME;

    #[test]
    fn upload_ranges_merge_and_overflow() {
        let mut snapshot = FrameSnapshot::with_capacity(3);
        snapshot.clear(4);
        snapshot.push_upload(0, 0, 2);
        snapshot.push_upload(0, 2, 3);
        snapshot.push_upload(7, 5, 1);
        snapshot.push_upload(0, 10, 0);
        snapshot.push_upload(0, 10, 1);
        assert_eq!(snapshot.frame(), 4);
        assert_eq!(
            snapshot.uploads(),
            &[
                UploadRange {
                    target: 0,
                    start: 0,
                    count: 5
                },
                UploadRange {
                    target: 7,
                    start: 5,
                    count: 1
                },
                UploadRange {
                    target: 0,
                    start: 10,
                    count: 1
                },
            ]
        );
        assert!(!snapshot.overflowed());
        // Past the capacity, a range of the last range's target widens it.
        snapshot.push_upload(0, 20, 1);
        snapshot.push_upload(0, 14, 2);
        assert!(!snapshot.overflowed());
        assert_eq!(
            snapshot.uploads()[2],
            UploadRange {
                target: 0,
                start: 10,
                count: 11
            }
        );
        // Another target's range has no room left.
        snapshot.push_upload(7, 30, 1);
        assert!(snapshot.overflowed());
        assert_eq!(snapshot.uploads().len(), 3);
    }

    #[test]
    fn a_frame_with_more_scene_runs_than_room_widens_its_last_and_keeps_room_for_batches() {
        use crate::handle::Handle;
        use crate::instances::BatchTable;
        use crate::jobs::JobSystem;
        use crate::scene::{Command, SceneStorage, flags};

        let jobs = JobSystem::new(0);
        let mut scene = SceneStorage::with_capacity(32);
        // Moving and still objects take turns, so each moving one is a run of its own.
        let commands: Vec<Command> = (0..20)
            .map(|k| {
                let h = scene.reserve().unwrap();
                let moving = if k % 2 == 0 { flags::DYNAMIC } else { 0 };
                Command::create(h, Handle::NONE, 1, flags::VISIBLE | moving)
            })
            .collect();
        let mut table = BatchTable::with_capacity(1);
        let batch = table.create(8, true, false, 1, 1, 1.0).unwrap();
        let mut snapshot = FrameSnapshot::with_capacity(4);
        for frame in 1..=3 {
            let initial: &[Command] = if frame == 1 { &commands } else { &[] };
            scene.apply_commands(initial, frame).unwrap();
            scene.update_transforms(&jobs);
            table.update(&jobs, frame, scene.cell_table_mut());
            snapshot.record(frame, &scene, &table);
        }
        assert!(!snapshot.overflowed());
        let uploads = snapshot.uploads();
        assert_eq!(uploads.len(), 4);
        // Ten runs of one slot: two exactly, then one that covers the rest.
        let runs: Vec<(u32, u32)> = uploads[..3].iter().map(|u| (u.start, u.count)).collect();
        assert_eq!(runs, [(1, 1), (3, 1), (5, 15)]);
        assert!(uploads[..3].iter().all(|u| u.target == SCENE_TARGET));
        assert_eq!(uploads[3].target, batch.raw());
    }

    #[test]
    fn the_producer_stays_at_most_one_frame_ahead() {
        let mut handoff = FrameHandoff::new(4);
        let (mut producer, mut consumer) = handoff.split();
        assert!(consumer.try_read().is_none());
        let mut w = producer.try_begin().unwrap();
        assert_eq!(w.frame(), 1);
        w.snapshot_mut().clear(1);
        w.publish();
        // Frame 2 writes the other buffer, so it may start before frame 1 is read.
        let w = producer.try_begin().unwrap();
        assert_eq!(w.frame(), 2);
        w.publish();
        // Frame 3 reuses frame 1's buffer: it waits for the render worker.
        assert!(producer.try_begin().is_none());
        let read = consumer.try_read().unwrap();
        assert_eq!(
            (read.frame(), read.parity(), read.snapshot().frame()),
            (1, 1, 1)
        );
        assert!(producer.try_begin().is_none());
        drop(read);
        assert_eq!(producer.try_begin().map(|w| w.frame()), Some(3));
        // Frames are read in order, never skipped.
        assert_eq!(consumer.try_read().map(|r| r.frame()), Some(2));
        assert!(consumer.try_read().is_none());
    }

    #[test]
    fn one_thread_can_publish_and_read_each_frame() {
        let mut handoff = FrameHandoff::new(1);
        let (mut producer, mut consumer) = handoff.split();
        for frame in 1..10 {
            let w = producer.try_begin().unwrap();
            assert_eq!(w.frame(), frame);
            w.publish();
            assert_eq!(consumer.try_read().unwrap().frame(), frame);
        }
    }

    #[test]
    fn the_handoff_keeps_its_order_where_the_frame_count_goes_round() {
        let mut handoff = FrameHandoff::new(1);
        let last = u32::MAX - 1;
        handoff.published_word().store(last - 1, Ordering::Relaxed);
        handoff
            .acknowledged_word()
            .store(last - 1, Ordering::Relaxed);
        let (mut producer, mut consumer) = handoff.split();
        let w = producer.try_begin().unwrap();
        assert_eq!(w.frame(), last);
        w.publish();
        // The frame after the last is the first, which writes the other buffer.
        let w = producer.try_begin().unwrap();
        assert_eq!(w.frame(), FIRST_FRAME);
        w.publish();
        // Frame 2 reuses the last frame's buffer: it waits for the render worker.
        assert!(producer.try_begin().is_none());
        assert_eq!(consumer.try_read().map(|r| r.frame()), Some(last));
        assert_eq!(producer.try_begin().map(|w| w.frame()), Some(2));
        assert_eq!(consumer.try_read().map(|r| r.frame()), Some(FIRST_FRAME));
        assert!(consumer.try_read().is_none());
    }
}
