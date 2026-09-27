//! Instance batches updated through the batch table, with and without job workers: world
//! matrices against a double-precision reference, and dirty ranges against the marked rows.

mod common;

use common::{Rng, Workers};
use sokko3d_core::bitset::Bitset;
use sokko3d_core::handle::Handle;
use sokko3d_core::instances::{BatchTable, RowRange};
use sokko3d_core::jobs::JobSystem;

/// The world matrix of a row, in double precision.
fn reference(p: &[f32], q: &[f32], s: &[f32]) -> [f64; 12] {
    let [x, y, z, w] = [q[0], q[1], q[2], q[3]].map(f64::from);
    let [sx, sy, sz] = [s[0], s[1], s[2]].map(f64::from);
    let (xx, yy, zz) = (2.0 * x * x, 2.0 * y * y, 2.0 * z * z);
    let (xy, xz, yz) = (2.0 * x * y, 2.0 * x * z, 2.0 * y * z);
    let (wx, wy, wz) = (2.0 * w * x, 2.0 * w * y, 2.0 * w * z);
    [
        (1.0 - yy - zz) * sx,
        (xy - wz) * sy,
        (xz + wy) * sz,
        f64::from(p[0]),
        (xy + wz) * sx,
        (1.0 - xx - zz) * sy,
        (yz - wx) * sz,
        f64::from(p[1]),
        (xz - wy) * sx,
        (yz + wx) * sy,
        (1.0 - xx - yy) * sz,
        f64::from(p[2]),
    ]
}

/// Writes random values to `rows` of a batch.
fn randomize(table: &mut BatchTable, id: Handle, rows: impl Iterator<Item = u32>, rng: &mut Rng) {
    let batch = table.get_mut(id).unwrap();
    let colors = batch.has_colors();
    for row in rows {
        let r = row as usize;
        let p = [
            rng.range(-50.0, 50.0),
            rng.range(-50.0, 50.0),
            rng.range(-50.0, 50.0),
        ];
        let q = rng.quaternion();
        let s = [
            rng.range(0.2, 3.0),
            rng.range(0.2, 3.0),
            rng.range(0.2, 3.0),
        ];
        batch.positions_mut()[r * 3..r * 3 + 3].copy_from_slice(&p);
        batch.rotations_mut()[r * 4..r * 4 + 4].copy_from_slice(&q);
        batch.scales_mut()[r * 3..r * 3 + 3].copy_from_slice(&s);
        if colors {
            let c = [rng.range(0.0, 1.0), 0.5, 0.25, 1.0];
            batch.colors_mut()[r * 4..r * 4 + 4].copy_from_slice(&c);
        }
    }
}

/// Checks every active row of a batch's current buffer against the reference.
fn check_rows(table: &BatchTable, id: Handle, frame: u32) {
    let batch = table.get(id).unwrap();
    let world = batch.current_world();
    for row in 0..batch.active_count() as usize {
        let expected = reference(
            &batch.positions()[row * 3..],
            &batch.rotations()[row * 4..],
            &batch.scales()[row * 3..],
        );
        let got = world.matrix(row);
        for k in 0..12 {
            let err = (f64::from(got[k]) - expected[k]).abs();
            assert!(
                err <= 1e-5 * (1.0 + expected[k].abs()),
                "frame {frame}, row {row}"
            );
        }
        let scale = (0..3)
            .map(|c| (0..3).map(|r| expected[r * 4 + c].powi(2)).sum::<f64>())
            .fold(0.0, f64::max)
            .sqrt();
        let radius = f64::from(batch.local_radius()) * scale;
        assert!((f64::from(world.radii()[row]) - radius).abs() <= 1e-5 * (1.0 + radius));
        if batch.has_colors() {
            assert_eq!(
                &world.colors()[row * 4..row * 4 + 4],
                &batch.colors()[row * 4..row * 4 + 4]
            );
        }
    }
}

struct Setup {
    table: BatchTable,
    dynamic: Handle,
    statics: Vec<Handle>,
}

fn setup(rng: &mut Rng) -> Setup {
    let mut table = BatchTable::with_capacity(64);
    let dynamic = table.create(100_000, true, false, 1, 1, 0.5).unwrap();
    let mut statics = vec![table.create(50_000, false, true, 2, 2, 1.5).unwrap()];
    for i in 0..50 {
        statics.push(table.create(100 + i, false, false, 3, 3, 1.0).unwrap());
    }
    for (id, capacity) in table
        .iter()
        .map(|(id, b)| (id, b.capacity()))
        .collect::<Vec<_>>()
    {
        randomize(&mut table, id, 0..capacity, rng);
    }
    Setup {
        table,
        dynamic,
        statics,
    }
}

#[test]
fn batches_match_the_reference_with_and_without_workers() {
    let pool = Workers::start(4);
    let serial = JobSystem::new(0);
    let mut rngs = [Rng::new(9), Rng::new(9)];
    let mut runs = [setup(&mut rngs[0]), setup(&mut rngs[1])];
    let mut rng = Rng::new(21);
    for frame in 1..=6 {
        // The same random edits go to both runs.
        let seed = u64::from(rng.next_u32());
        let mut marks: Vec<Vec<(u32, u32)>> = Vec::new();
        for statics in runs[0].statics.iter() {
            let capacity = runs[0].table.get(*statics).unwrap().capacity();
            let n = rng.below(6);
            marks.push(
                (0..n)
                    .map(|_| {
                        let start = rng.below(capacity);
                        (start, 1 + rng.below((capacity - start).min(300)))
                    })
                    .collect(),
            );
        }
        for (run, jobs) in runs.iter_mut().zip([pool.jobs(), &serial]) {
            let mut edit_rng = Rng::new(seed);
            let capacity = run.table.get(run.dynamic).unwrap().capacity();
            randomize(&mut run.table, run.dynamic, 0..capacity, &mut edit_rng);
            for (id, ranges) in run.statics.iter().zip(&marks) {
                for &(start, count) in ranges {
                    randomize(&mut run.table, *id, start..start + count, &mut edit_rng);
                    run.table
                        .get_mut(*id)
                        .unwrap()
                        .mark_dirty(start, count)
                        .unwrap();
                }
            }
            run.table.update(jobs, frame);
        }

        let (a, b) = (&runs[0].table, &runs[1].table);
        for ((id, x), (_, y)) in a.iter().zip(b.iter()) {
            assert_eq!(
                x.current_world().matrices(),
                y.current_world().matrices(),
                "{id:?}"
            );
            assert_eq!(
                x.current_world().radii(),
                y.current_world().radii(),
                "{id:?}"
            );
            assert_eq!(x.changed_ranges(), y.changed_ranges(), "{id:?}");
            check_rows(a, id, frame);
        }
        assert_eq!(
            a.get(runs[0].dynamic).unwrap().changed_ranges(),
            &[RowRange {
                start: 0,
                count: 100_000
            }]
        );
        if frame > 1 {
            // Upload ranges are exactly the marked rows, coalesced.
            for (id, ranges) in runs[0].statics.iter().zip(&marks) {
                let capacity = a.get(*id).unwrap().capacity();
                let mut model = Bitset::new(capacity);
                for &(start, count) in ranges {
                    model.set_range(start, count);
                }
                let expected: Vec<RowRange> = model
                    .runs()
                    .map(|(start, count)| RowRange { start, count })
                    .collect();
                assert_eq!(
                    a.get(*id).unwrap().changed_ranges(),
                    &expected[..],
                    "frame {frame}"
                );
            }
        }
    }
}
