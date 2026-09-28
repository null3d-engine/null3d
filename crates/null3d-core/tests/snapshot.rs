//! The frame handoff under two threads: a producer computes and publishes real frames while a
//! consumer reads them, and the consumer checks that it never sees a half-written frame.
//!
//! Every value the producer writes encodes the frame that wrote it. A dynamic object's x
//! coordinate is the frame number; a static object's is the last frame that moved it. If the
//! consumer ever read a buffer while the producer wrote a later frame into it, some value would
//! belong to that later frame and a check would fail.

mod common;

use std::sync::atomic::{AtomicBool, Ordering};

use common::Rng;
use null3d_core::handle::Handle;
use null3d_core::instances::BatchTable;
use null3d_core::jobs::JobSystem;
use null3d_core::scene::{Command, SceneStorage, flags};
use null3d_core::snapshot::{FrameHandoff, SCENE_TARGET, UploadRange};
use null3d_core::world::WorldView;

const FRAMES: u32 = 100_000;
const DYNAMIC: u32 = 16;
const STATIC: u32 = 16;
const ROWS: u32 = 64;

/// The last frame at or before `frame` that moved item `k`, when item `k` moves every `period`
/// frames starting at frame `k` (or frame `period` for item 0); 0 when it has not moved yet.
fn last_move(frame: u32, k: u32, period: u32) -> u32 {
    let first = if k == 0 { period } else { k };
    if frame < first {
        0
    } else {
        frame - (frame - k) % period
    }
}

fn pause(rng: &mut Rng) {
    if rng.below(64) == 0 {
        for _ in 0..rng.below(20_000) {
            std::hint::spin_loop();
        }
    }
}

/// Sets the flag when its thread unwinds, so the other thread stops waiting for it.
struct FailFlag<'a>(&'a AtomicBool);

impl Drop for FailFlag<'_> {
    fn drop(&mut self) {
        if std::thread::panicking() {
            self.0.store(true, Ordering::SeqCst);
        }
    }
}

fn covered(uploads: &[UploadRange], target: u32, row: u32) -> bool {
    uploads
        .iter()
        .any(|u| u.target == target && (u.start..u.start + u.count).contains(&row))
}

#[test]
fn the_consumer_never_sees_a_half_written_frame() {
    let jobs = JobSystem::new(0);
    let mut scene = SceneStorage::with_capacity(64);
    let mut commands = Vec::new();
    let mut create = |scene: &mut SceneStorage, parent: Handle, x: f32, f: u32| {
        let h = scene.reserve().unwrap();
        scene.set_position(h, [x, 0.0, 0.0]).unwrap();
        scene.set_local_radius(h, 1.0).unwrap();
        commands.push(Command::create(h, parent, 1, f | flags::VISIBLE));
        h
    };
    let dynamic: Vec<Handle> = (0..DYNAMIC)
        .map(|_| create(&mut scene, Handle::NONE, 0.0, flags::DYNAMIC))
        .collect();
    let statics: Vec<Handle> = (0..STATIC)
        .map(|_| create(&mut scene, Handle::NONE, 0.0, 0))
        .collect();
    // Each static root has a static child one unit along x.
    let children: Vec<Handle> = statics
        .iter()
        .map(|&p| create(&mut scene, p, 1.0, 0))
        .collect();
    let mut table = BatchTable::with_capacity(2);
    let moving = table.create(ROWS, true, false, 1, 1, 1.0).unwrap();
    let still = table.create(ROWS, false, false, 2, 2, 1.0).unwrap();

    let slot = |h: Handle| scene.resolve(h).unwrap() as usize;
    let dynamic_slots: Vec<usize> = dynamic.iter().map(|&h| slot(h)).collect();
    let static_slots: Vec<usize> = statics.iter().map(|&h| slot(h)).collect();
    let child_slots: Vec<usize> = children.iter().map(|&h| slot(h)).collect();
    let scene_views: [WorldView; 2] = [scene.world(0).view(), scene.world(1).view()];
    let batch_views: [[WorldView; 2]; 2] = [moving, still].map(|id| {
        let b = table.get(id).unwrap();
        [b.world(0).view(), b.world(1).view()]
    });

    let mut handoff = FrameHandoff::new(256);
    let failed = AtomicBool::new(false);
    let (mut producer, mut consumer) = handoff.split();
    std::thread::scope(|s| {
        s.spawn(|| {
            let _flag = FailFlag(&failed);
            let mut rng = Rng::new(1);
            for frame in 1..=FRAMES {
                let mut write = loop {
                    if let Some(w) = producer.try_begin() {
                        break w;
                    }
                    assert!(!failed.load(Ordering::SeqCst), "the consumer failed");
                    std::hint::spin_loop();
                };
                assert_eq!(write.frame(), frame);
                let x = frame as f32;
                for &s in &dynamic_slots {
                    scene.positions_mut()[s * 3] = x;
                }
                let k = (frame % STATIC) as usize;
                scene.set_position(statics[k], [x, 0.0, 0.0]).unwrap();
                let batch = table.get_mut(moving).unwrap();
                for row in 0..ROWS as usize {
                    batch.positions_mut()[row * 3] = x;
                }
                let batch = table.get_mut(still).unwrap();
                let row = frame % ROWS;
                batch.positions_mut()[row as usize * 3] = x;
                batch.mark_dirty(row, 1).unwrap();

                let initial: &[Command] = if frame == 1 { &commands } else { &[] };
                scene.apply_commands(initial, frame).unwrap();
                scene.update_transforms(&jobs);
                table.update(&jobs, frame);
                write.snapshot_mut().record(frame, &scene, &table);
                pause(&mut rng);
                write.publish();
            }
        });
        s.spawn(|| {
            let _flag = FailFlag(&failed);
            let mut rng = Rng::new(2);
            let mut expected = 1;
            while expected <= FRAMES {
                let Some(read) = consumer.try_read() else {
                    assert!(!failed.load(Ordering::SeqCst), "the producer failed");
                    std::hint::spin_loop();
                    continue;
                };
                let g = read.frame();
                assert_eq!(g, expected, "frames arrive in order");
                assert_eq!(read.snapshot().frame(), g);
                let p = read.parity();
                // SAFETY: `read` holds frame `g`, whose parity is `p`, until it is dropped.
                let (m, moving_m, still_m) = unsafe {
                    (
                        scene_views[p].matrices(),
                        batch_views[0][p].matrices(),
                        batch_views[1][p].matrices(),
                    )
                };
                let x = |m: &[f32], row: usize| m[row * 12 + 3];
                for &s in &dynamic_slots {
                    assert_eq!(x(m, s), g as f32, "frame {g}: dynamic slot {s}");
                }
                for k in 0..STATIC as usize {
                    let want = last_move(g, k as u32, STATIC) as f32;
                    assert_eq!(x(m, static_slots[k]), want, "frame {g}: static root {k}");
                    assert_eq!(x(m, child_slots[k]), want + 1.0, "frame {g}: child {k}");
                }
                for row in 0..ROWS {
                    assert_eq!(x(moving_m, row as usize), g as f32, "frame {g}: row {row}");
                    let want = last_move(g, row, ROWS) as f32;
                    assert_eq!(
                        x(still_m, row as usize),
                        want,
                        "frame {g}: static row {row}"
                    );
                }

                let uploads = read.snapshot().uploads();
                assert!(!read.snapshot().overflowed());
                for &s in &dynamic_slots {
                    assert!(covered(uploads, SCENE_TARGET, s as u32));
                }
                let k = (g % STATIC) as usize;
                assert!(covered(uploads, SCENE_TARGET, static_slots[k] as u32));
                assert!(covered(uploads, SCENE_TARGET, child_slots[k] as u32));
                assert!((0..ROWS).all(|row| covered(uploads, moving.raw(), row)));
                if g > 1 {
                    let still_uploads: Vec<&UploadRange> =
                        uploads.iter().filter(|u| u.target == still.raw()).collect();
                    assert_eq!(
                        still_uploads,
                        [&UploadRange {
                            target: still.raw(),
                            start: g % ROWS,
                            count: 1
                        }],
                        "frame {g}"
                    );
                }
                pause(&mut rng);
                drop(read);
                expected += 1;
            }
        });
    });
    assert_eq!(handoff.acknowledged(), FRAMES);
}
