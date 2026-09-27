//! The output of a transform update: a 3 × 4 world matrix and a world bounding sphere per row,
//! plus an optional colour per row for instance batches.
//!
//! Scene storage and instance batches keep two [`WorldArrays`], one per frame parity: frame `f`
//! writes buffer `f & 1` while the render worker reads the other one.
//! Bounding spheres live in four separate arrays (x, y, z, radius), so culling loads four
//! spheres with one SIMD load per array.

use crate::math::Affine;

/// Floats per world matrix.
pub const MATRIX_FLOATS: usize = 12;
/// Floats per colour (red, green, blue, alpha).
pub const COLOR_FLOATS: usize = 4;
/// The world radius of a row that culling must always reject: a row with no live object, or an
/// object hidden by its own flag or an ancestor's.
pub const HIDDEN_RADIUS: f32 = f32::NEG_INFINITY;

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

/// One frame parity's world output. Every array is allocated at creation and never
/// reallocated, so TypeScript views on it stay valid.
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
        Self {
            matrices: vec![0.0; rows * MATRIX_FLOATS],
            xs: vec![0.0; rows],
            ys: vec![0.0; rows],
            zs: vec![0.0; rows],
            radii: vec![HIDDEN_RADIUS; rows],
            colors: if with_colors {
                vec![1.0; rows * COLOR_FLOATS]
            } else {
                Vec::new()
            },
        }
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

    /// Marks `row` hidden: a zero matrix and a sphere that culling rejects.
    pub(crate) fn hide_row(&mut self, row: usize) {
        self.matrices[row * MATRIX_FLOATS..(row + 1) * MATRIX_FLOATS].fill(0.0);
        self.xs[row] = 0.0;
        self.ys[row] = 0.0;
        self.zs[row] = 0.0;
        self.radii[row] = HIDDEN_RADIUS;
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
