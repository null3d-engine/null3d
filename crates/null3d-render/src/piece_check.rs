//! The check of what each mesh's pieces cull, which draws a mesh whole while its pieces do not pay,
//! and tries its pieces again now and then.
//!
//! Pieces cost a test per copy and piece, and a draw per piece in every pass that draws the mesh
//! (decision record D-307). They pay only where the view leaves out enough of the mesh, or where
//! enough of it faces away. A mesh that every view takes in whole, such as a ground seen from above,
//! pays their draws for nothing. So the culling counts, for the camera's own view, the triangles
//! that each pieced mesh's copies would draw whole and those that their pieces draw, from counts that
//! the culling has already: on the CPU paths the entries that each piece keeps, and on WebGPU the
//! copies that each piece's draw takes, which the GPU reads into engine memory a few frames later.
//!
//! Each mesh with pieces runs in one mode, pieces or whole. With pieces, each window of
//! [`WINDOW`] frames that brought [`MIN_SAMPLES`] counts or more gives a verdict: the pieces stay
//! while they leave out at least [`MIN_CULLED_PERCENT`] of the triangles that the copies in view
//! would draw whole, and the mesh draws whole otherwise. A window in which no copy of the mesh was
//! in view says nothing, and the mode stays. Every [`PROBE`] frames a mesh drawn whole takes its
//! pieces again for a window, whose verdict sets its mode until the next probe. Each change of
//! mode rebuilds the draw tables, as any change of the scene's structure does, so probes of every
//! mesh drawn whole fall on the same frames.

/// Frames of counts that a verdict reads.
pub const WINDOW: u32 = 60;
/// Counts that a window needs at least for a verdict. WebGPU reads its counts every few frames.
pub const MIN_SAMPLES: u32 = 3;
/// The share of the triangles in view that a mesh's pieces must leave out, in percent, for the
/// mesh to keep them.
pub const MIN_CULLED_PERCENT: u64 = 20;
/// Frames between the probes of the meshes drawn whole.
pub const PROBE: u32 = 600;
/// Frames between the reads of the camera's counts of the pieces on WebGPU, which land a few
/// frames later.
pub const READ_FRAMES: u32 = 10;

/// One mesh's check.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct MeshCheck {
    /// True while the mesh draws whole.
    whole: bool,
    /// The triangles that the window's copies in view would draw whole, and those that their
    /// pieces drew.
    would: u64,
    drawn: u64,
    /// The counts that the window brought.
    samples: u32,
    /// The window's first frame, or `None` before the mesh's first count or mode change.
    since: Option<u32>,
}

/// What the check decided at its last verdict on a mesh, for tests and figures.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Verdict {
    /// The share of the triangles in view that the pieces left out, in percent.
    pub culled_percent: u64,
    /// True when the pieces paid.
    pub pays: bool,
}

/// Each mesh's check, by mesh id.
#[derive(Debug, Default)]
pub struct PieceCheck {
    meshes: Vec<MeshCheck>,
    /// The next frame at which the meshes drawn whole take their pieces again.
    next_probe: Option<u32>,
    /// The last verdict, on the mesh that it named.
    last: Option<(u32, Verdict)>,
}

impl PieceCheck {
    /// True while mesh `mesh` draws whole: its pieces did not pay at the last verdict.
    pub fn whole(&self, mesh: u32) -> bool {
        self.meshes
            .get(mesh as usize)
            .is_some_and(|check| check.whole)
    }

    /// The last verdict, and the mesh that it named.
    pub fn last_verdict(&self) -> Option<(u32, Verdict)> {
        self.last
    }

    /// Notes one count of frame `frame` for mesh `mesh`: the triangles that its copies in view
    /// would draw whole, and those that its pieces drew. Allocates only for a mesh id past the
    /// largest it has seen, as a layout rebuild brings it.
    pub fn count(&mut self, mesh: u32, frame: u32, would: u64, drawn: u64) {
        let at = mesh as usize;
        if self.meshes.len() <= at {
            self.meshes.resize(at + 1, MeshCheck::default());
        }
        let check = &mut self.meshes[at];
        if check.whole {
            return;
        }
        check.since.get_or_insert(frame);
        check.would += would;
        check.drawn += drawn.min(would);
        check.samples += 1;
    }

    /// Notes that mesh `mesh` went, so a later mesh of its id starts with its pieces.
    pub fn forget(&mut self, mesh: u32) {
        if let Some(check) = self.meshes.get_mut(mesh as usize) {
            *check = MeshCheck::default();
        }
    }

    /// Judges each mesh whose window has ended at frame `frame`, and starts the probes that fall
    /// on it. Returns true when a mesh changed its mode, which rebuilds the draw tables.
    pub fn step(&mut self, frame: u32) -> bool {
        let mut changed = false;
        for (mesh, check) in self.meshes.iter_mut().enumerate() {
            if check.whole {
                continue;
            }
            let Some(since) = check.since else { continue };
            if frame.wrapping_sub(since) < WINDOW {
                continue;
            }
            if check.samples >= MIN_SAMPLES && check.would > 0 {
                let culled_percent = (check.would - check.drawn) * 100 / check.would;
                let pays = culled_percent >= MIN_CULLED_PERCENT;
                self.last = Some((
                    mesh as u32,
                    Verdict {
                        culled_percent,
                        pays,
                    },
                ));
                if !pays {
                    check.whole = true;
                    changed = true;
                    self.next_probe.get_or_insert(frame.wrapping_add(PROBE));
                }
            }
            check.would = 0;
            check.drawn = 0;
            check.samples = 0;
            check.since = None;
        }
        if let Some(probe) = self.next_probe
            && frame >= probe
        {
            self.next_probe = None;
            for check in self.meshes.iter_mut().filter(|check| check.whole) {
                *check = MeshCheck::default();
                changed = true;
            }
        }
        changed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Counts `frames` frames from `first` on, each with `would` triangles in view and `drawn`
    /// drawn, and steps the check after each. Returns the frames at which a mode changed.
    fn run(check: &mut PieceCheck, first: u32, frames: u32, would: u64, drawn: u64) -> Vec<u32> {
        let mut changes = Vec::new();
        for frame in first..first + frames {
            check.count(1, frame, would, drawn);
            if check.step(frame) {
                changes.push(frame);
            }
        }
        changes
    }

    #[test]
    fn pieces_that_cull_enough_stay() {
        let mut check = PieceCheck::default();
        assert!(run(&mut check, 0, 3 * WINDOW, 1000, 500).is_empty());
        assert!(!check.whole(1));
        assert_eq!(
            check.last_verdict(),
            Some((
                1,
                Verdict {
                    culled_percent: 50,
                    pays: true
                }
            ))
        );
    }

    #[test]
    fn pieces_that_cull_too_little_draw_whole_until_the_probe() {
        let mut check = PieceCheck::default();
        let changes = run(&mut check, 0, WINDOW + 1, 1000, 900);
        assert_eq!(changes, [WINDOW]);
        assert!(check.whole(1));
        // Drawn whole, the mesh counts nothing, and the probe gives it its pieces again.
        let changes = run(&mut check, WINDOW + 1, PROBE, 1000, 1000);
        assert_eq!(changes, [WINDOW + PROBE]);
        assert!(!check.whole(1));
        // The probe's window judges again: pieces that now cull half stay.
        assert!(run(&mut check, WINDOW + PROBE + 1, 2 * WINDOW, 1000, 500).is_empty());
        assert!(!check.whole(1));
    }

    #[test]
    fn a_window_without_copies_in_view_keeps_the_mode() {
        let mut check = PieceCheck::default();
        assert!(run(&mut check, 0, 3 * WINDOW, 0, 0).is_empty());
        assert!(!check.whole(1));
        assert_eq!(check.last_verdict(), None);
    }

    #[test]
    fn a_window_with_too_few_counts_keeps_the_mode() {
        let mut check = PieceCheck::default();
        check.count(1, 0, 1000, 1000);
        for frame in 0..2 * WINDOW {
            assert!(!check.step(frame));
        }
        assert!(!check.whole(1));
    }

    #[test]
    fn a_forgotten_mesh_starts_again_with_its_pieces() {
        let mut check = PieceCheck::default();
        run(&mut check, 0, WINDOW + 1, 1000, 1000);
        assert!(check.whole(1));
        check.forget(1);
        assert!(!check.whole(1));
    }
}
