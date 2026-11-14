//! Pieces of a mesh's triangle list: runs of the list's triangles that each face about one way and
//! lie close together, with a bounding sphere and a cone of facings each. The asset tool sorts a
//! large level's triangles into pieces (`NULL3D_pieces`), and a mesh made in code can take pieces
//! at any time after it is made. A mesh drawn by many copies picks a level per copy, as before,
//! and then culls each piece of that level per copy: a piece outside the view, or whose every
//! triangle faces away from the eye, draws nothing while the copy's other pieces draw.
//!
//! The pieces only order the list's triangles, so a mesh with pieces draws the same triangles as
//! one without. Each piece draws as one or more ranges of the mesh's parts ([`piece_parts`]): a
//! piece that crosses from one part into the next draws a range of each.
//!
//! The cone test is meshoptimizer's: a piece whose sphere's centre `c`, relative to the eye, and
//! radius `r` meet `dot(c, axis) >= cutoff * |c| + r` faces away from every point of the sphere
//! with every triangle. The test holds after a copy's matrix only where the matrix keeps angles: a
//! rotation and the same positive scale on every axis. A copy whose matrix stretches or mirrors
//! skips it, and so do views whose eye is not where their positions start, such as shadow views,
//! and orthographic views. A double-sided material draws back faces, so its pieces skip it too.
//! The frustum test needs none of these and runs for every piece of every copy.
//!
//! The pieces of a large list also split into groups of up to [`MAX_GROUP_TRIANGLES`] triangles
//! that lie close together, each with a sphere and a cone of its own, in the pieces' layout. The
//! groups of each piece hold its triangles and no other, in the list's order, so a viewer that
//! culls a near copy group by group still culls within its pieces.

use null3d_core::culling::Frustum;

use crate::meshes::MeshPart;

/// The words of one piece where TypeScript hands pieces to the core: its triangles, then its
/// sphere's centre and radius, then its cone's axis and cutoff, as the bits of 32-bit floats.
pub const PIECE_WORDS: usize = 9;

/// The most pieces of one mesh. A bucket's record names its pieces' count in the 7 bits above
/// the first piece's bucket, below the bit that marks a bucket with pieces.
pub const MAX_PIECES: usize = 127;

/// The most triangles of one group of a piece: what the file's byte of each group's triangles
/// holds.
pub const MAX_GROUP_TRIANGLES: u32 = u8::MAX as u32;

/// How much wider than its cutoff a cone counts, as a share of the distance to its piece, so that
/// the rounding of a copy's matrix and of the eye never culls a triangle that the GPU draws. It
/// widens each cone by about a twentieth of a degree.
pub const CONE_MARGIN: f32 = 1.0e-3;

/// How far a copy's matrix may stretch, or bend its axes from square, as a share of its scale,
/// for its pieces to take the cone test. The cone margin covers what such a stretch turns a facing.
pub const SIMILAR_TOLERANCE: f32 = 1.0e-4;

/// One piece of a mesh's triangle list, or one group of a piece: its triangles, which follow the
/// pieces or groups before it in the list, and its bounds in the mesh's own space.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Piece {
    pub triangles: u32,
    /// The bounding sphere's centre and radius.
    pub sphere: [f32; 4],
    /// The cone's unit axis and its cutoff: the sine of the widest angle between the axis and a
    /// triangle's facing. A cutoff of 1 or more never culls.
    pub cone: [f32; 4],
}

impl Piece {
    /// The piece that `words` hold, in the layout of [`PIECE_WORDS`].
    pub fn from_words(words: &[u32; PIECE_WORDS]) -> Self {
        let float = |k: usize| f32::from_bits(words[k]);
        Self {
            triangles: words[0],
            sphere: [float(1), float(2), float(3), float(4)],
            cone: [float(5), float(6), float(7), float(8)],
        }
    }
}

/// Why a mesh refused its pieces. It keeps the pieces it had then.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PieceError {
    /// The id names no live mesh.
    UnknownMesh,
    /// Fewer than two pieces, or more than [`MAX_PIECES`].
    Count,
    /// The pieces' triangles do not add up to the mesh's.
    Triangles,
    /// A bound is NaN or infinite, or a radius is below 0.
    Bounds,
}

/// One mesh's pieces, their groups, and the mesh that holds their triangle list where it is not
/// the mesh's own.
#[derive(Debug, Default)]
struct MeshPieces {
    pieces: Vec<Piece>,
    groups: Vec<Piece>,
    list: Option<u32>,
}

/// True when each bound of `run` is finite, and its radius is 0 or more.
fn finite(run: &Piece) -> bool {
    run.sphere.iter().chain(&run.cone).all(|v| v.is_finite()) && run.sphere[3] >= 0.0
}

/// True when `groups` split each of `pieces` in the list's order, with no group that crosses from
/// one piece into the next, each of 1 to [`MAX_GROUP_TRIANGLES`] triangles and with finite bounds.
pub fn groups_split(pieces: &[Piece], groups: &[Piece]) -> bool {
    let mut next = groups.iter();
    for piece in pieces {
        let mut left = piece.triangles;
        while left > 0 {
            let Some(group) = next.next() else {
                return false;
            };
            if group.triangles == 0
                || group.triangles > MAX_GROUP_TRIANGLES
                || group.triangles > left
                || !finite(group)
            {
                return false;
            }
            left -= group.triangles;
        }
    }
    next.next().is_none()
}

/// Each mesh's pieces, by mesh id: none for a mesh that draws its list whole.
#[derive(Debug, Default)]
pub struct PieceTable {
    by_mesh: Vec<MeshPieces>,
    /// The meshes that held lists of pieces of meshes that went, whose ids the next release
    /// frees with theirs.
    released: Vec<u32>,
}

impl PieceTable {
    /// Gives mesh `mesh`, whose list holds `triangles` triangles, the pieces `pieces`, with the
    /// groups `groups` where they split the pieces ([`groups_split`]) and none otherwise.
    pub fn set(
        &mut self,
        mesh: u32,
        triangles: u32,
        pieces: &[Piece],
        groups: &[Piece],
    ) -> Result<(), PieceError> {
        if pieces.len() < 2 || pieces.len() > MAX_PIECES {
            return Err(PieceError::Count);
        }
        let sum = pieces
            .iter()
            .try_fold(0u32, |sum, piece| sum.checked_add(piece.triangles));
        if sum != Some(triangles) || pieces.iter().any(|piece| piece.triangles == 0) {
            return Err(PieceError::Triangles);
        }
        if !pieces.iter().all(finite) {
            return Err(PieceError::Bounds);
        }
        let at = mesh as usize;
        if self.by_mesh.len() <= at {
            self.by_mesh.resize_with(at + 1, MeshPieces::default);
        }
        let entry = &mut self.by_mesh[at];
        entry.pieces.clear();
        entry.pieces.extend_from_slice(pieces);
        entry.groups.clear();
        if groups_split(pieces, groups) {
            entry.groups.extend_from_slice(groups);
        }
        Ok(())
    }

    /// Notes that mesh `list` holds the triangle list of mesh `mesh`'s pieces, in their order, in
    /// place of the mesh's own list. Returns the list it held before, if any.
    pub fn set_list(&mut self, mesh: u32, list: u32) -> Option<u32> {
        self.by_mesh
            .get_mut(mesh as usize)
            .and_then(|entry| entry.list.replace(list))
    }

    /// Takes away the triangle list of mesh `mesh`'s pieces, with the pieces, and returns the mesh
    /// that held it, which the caller removes.
    pub fn take_list(&mut self, mesh: u32) -> Option<u32> {
        let entry = self.by_mesh.get_mut(mesh as usize)?;
        let list = entry.list.take()?;
        entry.pieces = Vec::new();
        entry.groups = Vec::new();
        Some(list)
    }

    /// The pieces of mesh `mesh`, or none.
    pub fn of(&self, mesh: u32) -> &[Piece] {
        self.by_mesh
            .get(mesh as usize)
            .map_or(&[], |entry| entry.pieces.as_slice())
    }

    /// The groups of the pieces of mesh `mesh`, in the list's order, or none.
    pub fn groups(&self, mesh: u32) -> &[Piece] {
        self.by_mesh
            .get(mesh as usize)
            .map_or(&[], |entry| entry.groups.as_slice())
    }

    /// The mesh that holds the triangle list of mesh `mesh`'s pieces, or `None` where the pieces
    /// are runs of the mesh's own list.
    pub fn list(&self, mesh: u32) -> Option<u32> {
        self.by_mesh.get(mesh as usize).and_then(|entry| entry.list)
    }

    /// Drops the pieces of mesh `mesh`, whose list or vertices changed. A list of their own stays
    /// with the mesh, which takes it away when it goes.
    pub fn clear(&mut self, mesh: u32) {
        if let Some(entry) = self.by_mesh.get_mut(mesh as usize) {
            entry.pieces = Vec::new();
            entry.groups = Vec::new();
        }
    }

    /// Drops everything of mesh `mesh`, which went with its list of pieces, if it had one. The
    /// list's id goes free with the mesh's at their release ([`PieceTable::take_released`]).
    pub fn forget(&mut self, mesh: u32) {
        if let Some(entry) = self.by_mesh.get_mut(mesh as usize) {
            entry.pieces = Vec::new();
            entry.groups = Vec::new();
            if let Some(list) = entry.list.take() {
                self.released.push(list);
            }
        }
    }

    /// The ids of the lists of pieces whose meshes went, which go free now.
    pub fn take_released(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.released)
    }
}

/// The ranges of `parts`, a mesh's parts in triangle order, that each of `pieces` draws, in piece
/// order: `out` takes each range's piece and the range as a part of its own. A piece that crosses
/// from one part into the next draws a range of each.
pub fn piece_parts(parts: &[MeshPart], pieces: &[Piece], mut out: impl FnMut(u32, MeshPart)) {
    let mut part = 0usize;
    // The triangle of the current part where the next range starts.
    let mut within = 0u32;
    for (k, piece) in pieces.iter().enumerate() {
        let mut left = piece.triangles;
        while left > 0 {
            let Some(&whole) = parts.get(part) else {
                return;
            };
            let available = whole.index_count / 3 - within;
            let taken = left.min(available);
            if taken > 0 {
                out(
                    k as u32,
                    MeshPart {
                        first_index: whole.first_index + within * 3,
                        index_count: taken * 3,
                        ..whole
                    },
                );
            }
            left -= taken;
            within += taken;
            if within == whole.index_count / 3 {
                part += 1;
                within = 0;
            }
        }
    }
}

/// A copy's world matrix as its three rows, relative to the view's eye, and what its pieces read
/// of it: its largest axis scale, and whether it keeps angles, so that its pieces may take the
/// cone test.
#[derive(Clone, Copy, Debug)]
pub struct CopyFrame {
    rows: [[f32; 4]; 3],
    scale: f32,
    similar: bool,
}

impl CopyFrame {
    /// The frame of a copy whose matrix has the rows `rows`, relative to the view's eye.
    pub fn new(rows: [[f32; 4]; 3]) -> Self {
        let column = |c: usize| [rows[0][c], rows[1][c], rows[2][c]];
        let columns = [column(0), column(1), column(2)];
        let lengths = columns.map(|c| dot(c, c).sqrt());
        let scale = lengths[0].max(lengths[1]).max(lengths[2]);
        let least = lengths[0].min(lengths[1]).min(lengths[2]);
        let square = |a: usize, b: usize| {
            dot(columns[a], columns[b]).abs() <= SIMILAR_TOLERANCE * scale * scale
        };
        let turn = dot(cross(columns[0], columns[1]), columns[2]);
        let similar = least > 0.0
            && scale - least <= SIMILAR_TOLERANCE * scale
            && square(0, 1)
            && square(0, 2)
            && square(1, 2)
            && turn > 0.0;
        Self {
            rows,
            scale,
            similar,
        }
    }

    /// True when the copy's piece `piece` may draw in a view with `frustum`, relative to the
    /// view's eye: its sphere reaches into the frustum and, where `cone` allows the cone test, some
    /// triangle may face the eye.
    pub fn shows(&self, frustum: &Frustum, piece: &Piece, cone: bool) -> bool {
        let [x, y, z, radius] = piece.sphere;
        let local = [x, y, z, 1.0];
        let center = self.rows.map(|row| dot4(row, local));
        let radius = radius * self.scale;
        if !frustum.contains_sphere(center[0], center[1], center[2], radius) {
            return false;
        }
        !(cone && self.similar && faces_away(self.rows, center, radius, piece.cone))
    }
}

/// True when every triangle within the cone `cone`, in the space of a copy with matrix rows
/// `rows`, faces away from the eye wherever it lies in the sphere around `center` of `radius`,
/// relative to the eye.
fn faces_away(rows: [[f32; 4]; 3], center: [f32; 3], radius: f32, cone: [f32; 4]) -> bool {
    let [ax, ay, az, cutoff] = cone;
    if cutoff >= 1.0 {
        return false;
    }
    let turned = rows.map(|row| row[0] * ax + row[1] * ay + row[2] * az);
    let length = dot(turned, turned).sqrt();
    if length <= 0.0 {
        return false;
    }
    let distance = dot(center, center).sqrt();
    dot(center, turned) / length >= (cutoff + CONE_MARGIN) * distance + radius
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn dot4(a: [f32; 4], b: [f32; 4]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn part(first_index: u32, triangles: u32, base_vertex: u32) -> MeshPart {
        MeshPart {
            page: 0,
            first_index,
            index_count: triangles * 3,
            base_vertex,
            vertex_count: 3,
            first_vertex: base_vertex,
            shares_vertices: false,
        }
    }

    fn piece(triangles: u32) -> Piece {
        Piece {
            triangles,
            ..Piece::default()
        }
    }

    /// The culling shader runs the same tests as the CPU paths, so the two keep one margin and
    /// one tolerance.
    #[test]
    fn the_culling_shader_keeps_the_cpu_paths_margins() {
        let cull = include_str!("../../null3d-shaders/wgsl/cull.wgsl");
        let constant = |name: &str| -> f32 {
            let start = cull.find(&format!("const {name}: f32 = ")).expect(name) + name.len() + 14;
            let end = start + cull[start..].find(';').unwrap();
            cull[start..end].parse().unwrap()
        };
        assert_eq!(constant("CONE_MARGIN"), CONE_MARGIN);
        assert_eq!(constant("SIMILAR_TOLERANCE"), SIMILAR_TOLERANCE);
    }

    #[test]
    fn a_piece_that_crosses_parts_draws_a_range_of_each() {
        let parts = [part(0, 10, 0), part(30, 6, 100)];
        let mut ranges = Vec::new();
        piece_parts(&parts, &[piece(4), piece(8), piece(4)], |k, range| {
            ranges.push((k, range.first_index, range.index_count, range.base_vertex));
        });
        assert_eq!(
            ranges,
            [
                (0, 0, 12, 0),
                (1, 12, 18, 0),
                (1, 30, 6, 100),
                (2, 36, 12, 100)
            ]
        );
    }

    #[test]
    fn the_table_refuses_pieces_that_miss_the_meshs_triangles() {
        let mut table = PieceTable::default();
        assert_eq!(
            table.set(3, 10, &[piece(4), piece(5)], &[]),
            Err(PieceError::Triangles)
        );
        assert_eq!(table.set(3, 10, &[piece(10)], &[]), Err(PieceError::Count));
        assert_eq!(table.set(3, 10, &[piece(4), piece(6)], &[]), Ok(()));
        assert_eq!(table.of(3).len(), 2);
        assert!(table.of(2).is_empty());
        table.clear(3);
        assert!(table.of(3).is_empty());
    }

    /// Groups that split each piece stay with the pieces, and groups that cross from one piece
    /// into the next, miss a triangle or hold a bad bound leave the pieces without groups.
    #[test]
    fn the_table_keeps_only_groups_that_split_each_piece() {
        let pieces = [piece(4), piece(6)];
        let mut table = PieceTable::default();
        let split = [piece(3), piece(1), piece(2), piece(4)];
        assert_eq!(table.set(5, 10, &pieces, &split), Ok(()));
        assert_eq!(table.groups(5), split);
        let crossing = [piece(3), piece(3), piece(4)];
        let short = [piece(4), piece(5)];
        let empty = [piece(4), piece(0), piece(6)];
        let broken = [
            piece(4),
            Piece {
                triangles: 6,
                sphere: [f32::NAN, 0.0, 0.0, 1.0],
                cone: [0.0; 4],
            },
        ];
        let large = [piece(300), piece(6)];
        for groups in [&crossing[..], &short, &empty, &broken] {
            assert_eq!(table.set(5, 10, &pieces, groups), Ok(()));
            assert!(table.groups(5).is_empty(), "{groups:?}");
            assert_eq!(table.of(5).len(), 2);
        }
        let many = [piece(300), piece(6)];
        assert_eq!(table.set(6, 306, &many, &large), Ok(()));
        assert!(table.groups(6).is_empty());
        table.set(5, 10, &pieces, &split).unwrap();
        table.clear(5);
        assert!(table.groups(5).is_empty());
    }

    /// A piece of triangles that face +z, one metre across at the origin, seen by a copy turned a
    /// quarter turn about y and moved 10 m along -z from the eye.
    #[test]
    fn a_piece_turned_away_from_the_eye_is_culled_and_one_turned_toward_it_draws() {
        let frustum = Frustum::from_planes([
            [1.0, 0.0, -1.0, 0.0],
            [-1.0, 0.0, -1.0, 0.0],
            [0.0, 1.0, -1.0, 0.0],
            [0.0, -1.0, -1.0, 0.0],
            [0.0, 0.0, -1.0, -0.1],
            [0.0, 0.0, 1.0, 1000.0],
        ]);
        let facing_z = Piece {
            triangles: 1,
            sphere: [0.0, 0.0, 0.0, 0.5],
            cone: [0.0, 0.0, 1.0, 0.2],
        };
        // A copy with no turn: its piece faces +z, toward the eye at the origin, so it draws.
        let toward = CopyFrame::new([
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, -10.0],
        ]);
        assert!(toward.shows(&frustum, &facing_z, true));
        // A half turn about y: the piece faces -z, away from the eye.
        let away = CopyFrame::new([
            [-1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, -1.0, -10.0],
        ]);
        assert!(!away.shows(&frustum, &facing_z, true));
        // Without the cone test, or with a mirrored or stretched matrix, it draws.
        assert!(away.shows(&frustum, &facing_z, false));
        let mirrored = CopyFrame::new([
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, -1.0, -10.0],
        ]);
        assert!(mirrored.shows(&frustum, &facing_z, true));
        let stretched = CopyFrame::new([
            [-2.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, -1.0, -10.0],
        ]);
        assert!(stretched.shows(&frustum, &facing_z, true));
        // Behind the eye, the frustum culls it whatever it faces.
        let behind = CopyFrame::new([
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 10.0],
        ]);
        assert!(!behind.shows(&frustum, &facing_z, false));
    }
}
