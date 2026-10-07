//! The output of a transform update: a 3 × 4 world matrix and a world bounding sphere per row,
//! plus an optional colour per row for instance batches. Matrices and sphere centers are relative
//! to the center of the row's grid cell (see [`crate::cells`]).
//!
//! Scene storage and instance batches keep two [`WorldArrays`], one per frame parity: frame `f`
//! writes buffer `f & 1` while the render worker reads the other one through a [`WorldView`] (see
//! [`crate::snapshot`] for the protocol). Bounding spheres live in four separate arrays (x, y, z,
//! radius), so culling loads four spheres with one SIMD load per array.

use std::collections::TryReserveError;
use std::simd::f32x4;

use crate::alloc::filled;
use crate::math::{Affine, Affine4, transpose4};

/// Floats per world matrix.
pub const MATRIX_FLOATS: usize = 12;
/// Floats per colour (red, green, blue, alpha).
pub const COLOR_FLOATS: usize = 4;
/// The world radius of a row that culling must always reject: a row with no live object, or an
/// object hidden by its own flag or an ancestor's.
pub const HIDDEN_RADIUS: f32 = f32::NEG_INFINITY;
/// The world radius of an object that culling must never reject: a sphere wider than any scene.
/// It is finite, so sums of spheres and GPU shaders, which need not keep infinities, stay exact.
pub const UNBOUNDED_RADIUS: f32 = 1.0e30;

/// Four parallel arrays of sphere centres and radii, all of the same length.
#[derive(Clone, Copy, Debug)]
pub struct SphereArrays<'a> {
    /// Centre x coordinates.
    pub xs: &'a [f32],
    /// Centre y coordinates.
    pub ys: &'a [f32],
    /// Centre z coordinates.
    pub zs: &'a [f32],
    /// Radii. A negative infinite radius marks a sphere that is never visible.
    pub radii: &'a [f32],
}

impl<'a> SphereArrays<'a> {
    /// Bundles four arrays.
    ///
    /// # Panics
    /// When the arrays differ in length.
    pub fn new(xs: &'a [f32], ys: &'a [f32], zs: &'a [f32], radii: &'a [f32]) -> Self {
        assert!(
            xs.len() == ys.len() && xs.len() == zs.len() && xs.len() == radii.len(),
            "sphere arrays differ in length"
        );
        Self { xs, ys, zs, radii }
    }

    /// The number of spheres.
    pub fn len(&self) -> usize {
        self.xs.len()
    }

    /// True when there are no spheres.
    pub fn is_empty(&self) -> bool {
        self.xs.is_empty()
    }
}

/// One frame parity's world output. Its arrays never reallocate: an owner that needs more rows
/// makes new arrays with [`WorldArrays::try_grown`], so readers of the old ones stay valid.
#[derive(Clone, Debug)]
pub struct WorldArrays {
    matrices: Vec<f32>,
    xs: Vec<f32>,
    ys: Vec<f32>,
    zs: Vec<f32>,
    radii: Vec<f32>,
    colors: Vec<f32>,
}

impl WorldArrays {
    /// Arrays for `rows` rows, every row hidden, with colours when `with_colors` is set.
    pub(crate) fn new(rows: usize, with_colors: bool) -> Self {
        let Ok(arrays) = Self::try_new(rows, with_colors) else {
            panic!("no memory for world arrays")
        };
        arrays
    }

    /// As [`WorldArrays::new`], or an error when memory cannot grow for the arrays.
    pub(crate) fn try_new(rows: usize, with_colors: bool) -> Result<Self, TryReserveError> {
        Ok(Self {
            matrices: filled(rows * MATRIX_FLOATS, 0.0)?,
            xs: filled(rows, 0.0)?,
            ys: filled(rows, 0.0)?,
            zs: filled(rows, 0.0)?,
            radii: filled(rows, HIDDEN_RADIUS)?,
            colors: filled(if with_colors { rows * COLOR_FLOATS } else { 0 }, 1.0)?,
        })
    }

    /// A copy with `rows` rows: these rows, then hidden ones. It is a new allocation, so these
    /// arrays stay where they are for a reader that still holds their addresses.
    pub(crate) fn try_grown(&self, rows: usize) -> Result<Self, TryReserveError> {
        let mut grown = Self::try_new(rows.max(self.rows()), !self.colors.is_empty())?;
        let copy = |to: &mut Vec<f32>, from: &[f32]| to[..from.len()].copy_from_slice(from);
        copy(&mut grown.matrices, &self.matrices);
        copy(&mut grown.xs, &self.xs);
        copy(&mut grown.ys, &self.ys);
        copy(&mut grown.zs, &self.zs);
        copy(&mut grown.radii, &self.radii);
        copy(&mut grown.colors, &self.colors);
        Ok(grown)
    }

    /// The number of rows.
    pub fn rows(&self) -> usize {
        self.xs.len()
    }

    /// Every matrix, 12 floats per row.
    pub fn matrices(&self) -> &[f32] {
        &self.matrices
    }

    /// The matrix of `row`.
    pub fn matrix(&self, row: usize) -> &Affine {
        self.matrices[row * MATRIX_FLOATS..(row + 1) * MATRIX_FLOATS]
            .try_into()
            .expect("a matrix is 12 floats")
    }

    /// Sphere centres, x coordinates.
    pub fn xs(&self) -> &[f32] {
        &self.xs
    }

    /// Sphere centres, y coordinates.
    pub fn ys(&self) -> &[f32] {
        &self.ys
    }

    /// Sphere centres, z coordinates.
    pub fn zs(&self) -> &[f32] {
        &self.zs
    }

    /// Sphere radii; [`HIDDEN_RADIUS`] marks rows culling must skip.
    pub fn radii(&self) -> &[f32] {
        &self.radii
    }

    /// Colours, 4 floats per row, or an empty slice when the owner has no colours.
    pub fn colors(&self) -> &[f32] {
        &self.colors
    }

    /// The sphere of `row` as `(x, y, z, radius)`.
    pub fn sphere(&self, row: usize) -> [f32; 4] {
        [self.xs[row], self.ys[row], self.zs[row], self.radii[row]]
    }

    /// The four sphere arrays, for culling.
    pub fn spheres(&self) -> SphereArrays<'_> {
        SphereArrays::new(&self.xs, &self.ys, &self.zs, &self.radii)
    }

    /// Read-only pointers to these arrays for a reader on another thread. The addresses stay
    /// valid while these arrays live, because they never reallocate.
    pub fn view(&self) -> WorldView {
        WorldView {
            matrices: self.matrices.as_ptr(),
            xs: self.xs.as_ptr(),
            ys: self.ys.as_ptr(),
            zs: self.zs.as_ptr(),
            radii: self.radii.as_ptr(),
            colors: self.colors.as_ptr(),
            rows: self.rows(),
            color_rows: self.colors.len() / COLOR_FLOATS,
        }
    }

    /// Marks `row` hidden: a zero matrix and a sphere that culling rejects.
    pub(crate) fn hide_row(&mut self, row: usize) {
        self.matrices[row * MATRIX_FLOATS..(row + 1) * MATRIX_FLOATS].fill(0.0);
        self.xs[row] = 0.0;
        self.ys[row] = 0.0;
        self.zs[row] = 0.0;
        self.radii[row] = HIDDEN_RADIUS;
    }

    /// Marks every row hidden, as [`WorldArrays::hide_row`] does each one.
    pub(crate) fn hide_all(&mut self) {
        self.matrices.fill(0.0);
        self.xs.fill(0.0);
        self.ys.fill(0.0);
        self.zs.fill(0.0);
        self.radii.fill(HIDDEN_RADIUS);
    }

    /// Moves the translation and sphere center of `row` by `delta`: the row's matrix becomes
    /// relative to a point `delta` away from the one it was relative to.
    pub(crate) fn shift_row(&mut self, row: usize, delta: [f32; 3]) {
        let m = &mut self.matrices[row * MATRIX_FLOATS..(row + 1) * MATRIX_FLOATS];
        m[3] += delta[0];
        m[7] += delta[1];
        m[11] += delta[2];
        self.xs[row] += delta[0];
        self.ys[row] += delta[1];
        self.zs[row] += delta[2];
    }

    /// Raw pointers for parallel writers.
    pub(crate) fn ptrs(&mut self) -> WorldPtrs {
        WorldPtrs {
            matrices: self.matrices.as_mut_ptr(),
            xs: self.xs.as_mut_ptr(),
            ys: self.ys.as_mut_ptr(),
            zs: self.zs.as_mut_ptr(),
            radii: self.radii.as_mut_ptr(),
            colors: self.colors.as_mut_ptr(),
            rows: self.xs.len(),
            has_colors: !self.colors.is_empty(),
        }
    }
}

/// Read-only access to one frame parity's world arrays from another thread, such as the render
/// worker. Reading is `unsafe`: the frame handoff in [`crate::snapshot`] decides when this
/// parity is safe to read.
#[derive(Clone, Copy, Debug)]
pub struct WorldView {
    matrices: *const f32,
    xs: *const f32,
    ys: *const f32,
    zs: *const f32,
    radii: *const f32,
    colors: *const f32,
    rows: usize,
    color_rows: usize,
}

// SAFETY: the view only reads, and its `unsafe` accessors make the caller prove no thread writes
// the arrays meanwhile.
unsafe impl Send for WorldView {}
// SAFETY: as above.
unsafe impl Sync for WorldView {}

impl WorldView {
    /// The number of rows.
    pub fn rows(&self) -> usize {
        self.rows
    }

    /// Every matrix, 12 floats per row.
    ///
    /// # Safety
    /// The owner is alive, and no thread writes this parity while the slice is in use: the
    /// caller holds a frame of this parity between [`crate::snapshot::FrameHandoff::next_readable`]
    /// and its acknowledgement.
    pub unsafe fn matrices<'a>(&self) -> &'a [f32] {
        // SAFETY: the pointer and length come from a live array, as the caller guarantees.
        unsafe { std::slice::from_raw_parts(self.matrices, self.rows * MATRIX_FLOATS) }
    }

    /// The four sphere arrays.
    ///
    /// # Safety
    /// As for [`WorldView::matrices`].
    pub unsafe fn spheres<'a>(&self) -> SphereArrays<'a> {
        // SAFETY: as the caller guarantees.
        unsafe {
            SphereArrays::new(
                std::slice::from_raw_parts(self.xs, self.rows),
                std::slice::from_raw_parts(self.ys, self.rows),
                std::slice::from_raw_parts(self.zs, self.rows),
                std::slice::from_raw_parts(self.radii, self.rows),
            )
        }
    }

    /// The colours, 4 floats per row, or an empty slice without colours.
    ///
    /// # Safety
    /// As for [`WorldView::matrices`].
    pub unsafe fn colors<'a>(&self) -> &'a [f32] {
        // SAFETY: as the caller guarantees.
        unsafe { std::slice::from_raw_parts(self.colors, self.color_rows * COLOR_FLOATS) }
    }
}

/// Raw pointers into one [`WorldArrays`], shared by the chunks of a parallel update. Each chunk
/// writes only its own rows, and reads rows no chunk writes during the same loop.
#[derive(Clone, Copy)]
pub(crate) struct WorldPtrs {
    matrices: *mut f32,
    xs: *mut f32,
    ys: *mut f32,
    zs: *mut f32,
    radii: *mut f32,
    colors: *mut f32,
    rows: usize,
    has_colors: bool,
}

// SAFETY: the pointers are only dereferenced through the `unsafe` methods below, whose callers
// guarantee that rows being written are touched by one thread only.
unsafe impl Send for WorldPtrs {}
// SAFETY: as above.
unsafe impl Sync for WorldPtrs {}

impl WorldPtrs {
    /// Writes the matrix and sphere of `row`.
    ///
    /// # Safety
    /// `row` is in bounds, and no other thread accesses `row` during the call.
    #[inline(always)]
    pub(crate) unsafe fn write(&self, row: usize, matrix: &Affine, sphere: [f32; 4]) {
        debug_assert!(row < self.rows);
        // SAFETY: in bounds and exclusive, as the caller guarantees.
        unsafe {
            self.matrices
                .add(row * MATRIX_FLOATS)
                .cast::<Affine>()
                .write_unaligned(*matrix);
            self.xs.add(row).write(sphere[0]);
            self.ys.add(row).write(sphere[1]);
            self.zs.add(row).write(sphere[2]);
            self.radii.add(row).write(sphere[3]);
        }
    }

    /// Writes the matrices and spheres of rows `row..row + 4`, one row per lane. `radii` holds
    /// the four sphere radii; the sphere centres are the matrices' translations.
    ///
    /// # Safety
    /// Rows `row..row + 4` are in bounds, and no other thread accesses them during the call.
    #[inline(always)]
    pub(crate) unsafe fn write4(&self, row: usize, matrices: &Affine4, radii: f32x4) {
        debug_assert!(row + 4 <= self.rows);
        let rows = matrices.map(transpose4);
        let store = |p: *mut f32, v: f32x4| {
            // SAFETY: in bounds and exclusive, as the caller guarantees.
            unsafe { p.cast::<[f32; 4]>().write_unaligned(v.to_array()) };
        };
        // SAFETY: the offsets stay inside rows `row..row + 4`, as the caller guarantees.
        unsafe {
            for lane in 0..4 {
                let m = self.matrices.add((row + lane) * MATRIX_FLOATS);
                for (r, row_vectors) in rows.iter().enumerate() {
                    store(m.add(r * 4), row_vectors[lane]);
                }
            }
            store(self.xs.add(row), matrices[0][3]);
            store(self.ys.add(row), matrices[1][3]);
            store(self.zs.add(row), matrices[2][3]);
            store(self.radii.add(row), radii);
        }
    }

    /// Copies the colours of rows `row..row + 4` (16 floats) from `colors`. Does nothing when
    /// the arrays have no colours.
    ///
    /// # Safety
    /// As for [`WorldPtrs::write4`], and `colors` points at 16 readable floats.
    #[inline(always)]
    pub(crate) unsafe fn write_colors4(&self, row: usize, colors: *const f32) {
        debug_assert!(row + 4 <= self.rows);
        if self.has_colors {
            // SAFETY: in bounds and exclusive, as the caller guarantees.
            unsafe {
                std::ptr::copy_nonoverlapping(colors, self.colors.add(row * COLOR_FLOATS), 16);
            }
        }
    }

    /// Writes the colour of `row`. Does nothing when the arrays have no colours.
    ///
    /// # Safety
    /// As for [`WorldPtrs::write`].
    #[inline(always)]
    pub(crate) unsafe fn write_color(&self, row: usize, color: [f32; 4]) {
        debug_assert!(row < self.rows);
        if self.has_colors {
            // SAFETY: in bounds and exclusive, as the caller guarantees.
            unsafe {
                self.colors
                    .add(row * COLOR_FLOATS)
                    .cast::<[f32; 4]>()
                    .write_unaligned(color);
            }
        }
    }

    /// The matrix of `row`.
    ///
    /// # Safety
    /// `row` is in bounds, and no thread writes it during the call.
    #[inline(always)]
    pub(crate) unsafe fn matrix(&self, row: usize) -> Affine {
        debug_assert!(row < self.rows);
        // SAFETY: in bounds and not being written, as the caller guarantees.
        unsafe {
            self.matrices
                .add(row * MATRIX_FLOATS)
                .cast::<Affine>()
                .read_unaligned()
        }
    }

    /// The radius of `row`.
    ///
    /// # Safety
    /// As for [`WorldPtrs::matrix`].
    #[inline(always)]
    pub(crate) unsafe fn radius(&self, row: usize) -> f32 {
        debug_assert!(row < self.rows);
        // SAFETY: in bounds and not being written, as the caller guarantees.
        unsafe { self.radii.add(row).read() }
    }

    /// Copies the matrix, sphere and colour of `row` from `source`.
    ///
    /// # Safety
    /// `row` is in bounds of both, no thread writes `row` of `source`, and no other thread
    /// accesses `row` of `self` during the call.
    #[inline(always)]
    pub(crate) unsafe fn copy_row(&self, source: &WorldPtrs, row: usize) {
        debug_assert!(row < self.rows && row < source.rows);
        // SAFETY: as the caller guarantees.
        unsafe {
            let matrix = source.matrix(row);
            let sphere = [
                source.xs.add(row).read(),
                source.ys.add(row).read(),
                source.zs.add(row).read(),
                source.radii.add(row).read(),
            ];
            self.write(row, &matrix, sphere);
            if self.has_colors && source.has_colors {
                let color = source
                    .colors
                    .add(row * COLOR_FLOATS)
                    .cast::<[f32; 4]>()
                    .read_unaligned();
                self.write_color(row, color);
            }
        }
    }
}
