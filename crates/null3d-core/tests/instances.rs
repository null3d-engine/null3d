//! Instance batches updated through the batch table, with and without job workers: world
//! matrices against a double-precision reference, and dirty ranges against the marked rows.

mod common;

use common::{Rng, Workers, compose64, max_axis_scale64};
use null3d_core::bitset::Bitset;
use null3d_core::cells::CellTable;
use null3d_core::handle::Handle;
use null3d_core::instances::{BatchTable, RowRange};
use null3d_core::jobs::JobSystem;

/// Writes random values to `rows` of a batch.
fn randomize(table: &mut BatchTable, id: Handle, rows: impl Iterator<Item = u32>, rng: &mut Rng) {
    let batch = table.get_mut(id).unwrap();
    let row_values = batch.has_row_values();
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
        if row_values {
            let c = [rng.range(0.0, 1.0), 0.5, 0.25, 1.0];
            batch.colors_mut()[r * 4..r * 4 + 4].copy_from_slice(&c);
            let v = [rng.range(-1.0, 1.0), 2.0, 3.0, row as f32];
            batch.values_mut()[r * 4..r * 4 + 4].copy_from_slice(&v);
        }
    }
}

/// Checks every active row of a batch's current buffer against the reference.
fn check_rows(table: &BatchTable, id: Handle, frame: u32) {
    let batch = table.get(id).unwrap();
    let world = batch.current_world();
    for row in 0..batch.active_count() as usize {
        let triple = |a: &[f32]| [a[row * 3], a[row * 3 + 1], a[row * 3 + 2]];
        let q = &batch.rotations()[row * 4..row * 4 + 4];
        let expected = compose64(
            triple(batch.positions()),
            [q[0], q[1], q[2], q[3]],
            triple(batch.scales()),
        );
        let got = world.matrix(row);
        for k in 0..12 {
            let err = (f64::from(got[k]) - expected[k]).abs();
            assert!(
                err <= 1e-5 * (1.0 + expected[k].abs()),
                "frame {frame}, row {row}"
            );
        }
        let radius = f64::from(batch.local_radius()) * max_axis_scale64(&expected);
        assert!((f64::from(world.radii()[row]) - radius).abs() <= 1e-5 * (1.0 + radius));
        if batch.has_row_values() {
            let out = &world.row_values()[row * 8..row * 8 + 8];
            assert_eq!(&out[..4], &batch.colors()[row * 4..row * 4 + 4]);
            assert_eq!(&out[4..], &batch.values()[row * 4..row * 4 + 4]);
        }
    }
}

struct Setup {
    table: BatchTable,
    cells: CellTable,
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
        cells: CellTable::new(),
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
            run.table.update(jobs, frame, &mut run.cells);
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
