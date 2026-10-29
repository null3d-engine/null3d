//! The two lookup tables that the moment layer's anti-aliasing reads, made at its first use as the
//! engine's other built-in assets are: the engine's package ships no file of them.
//!
//! The tables come from the SMAA reference implementation (https://github.com/iryoku/smaa), by
//! Jorge Jimenez, Jose I. Echevarria, Belen Masia, Fernando Navarro and Diego Gutierrez, under the
//! MIT licence:
//!
//! Copyright (C) 2013 Jorge Jimenez (jorge@iryoku.com)
//! Copyright (C) 2013 Jose I. Echevarria (joseignacioechevarria@gmail.com)
//! Copyright (C) 2013 Belen Masia (bmasia@unizar.es)
//! Copyright (C) 2013 Fernando Navarro (fernandn@microsoft.com)
//! Copyright (C) 2013 Diego Gutierrez (diegog@unizar.es)
//!
//! Permission is hereby granted, free of charge, to any person obtaining a copy of this software
//! and associated documentation files (the "Software"), to deal in the Software without
//! restriction, including without limitation the rights to use, copy, modify, merge, publish,
//! distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
//! Software is furnished to do so, subject to the following conditions:
//!
//! The above copyright notice and this permission notice shall be included in all copies or
//! substantial portions of the Software.
//!
//! THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
//! BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
//! NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
//! DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//! OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//!
//! The area table holds the share of a pixel that each pattern covers at each distance to the
//! edge's ends, for the horizontal and vertical patterns in its left half and the diagonal
//! patterns, which the method computes by sampling, in its right half. Each of the seven slots
//! that the rows hold serves one subpixel offset. The search table holds the distances that the
//! searches' last step adds, the left cases in its first half of the columns and the right cases in
//! the second, flipped so a linear fetch reads the pair it needs.

/// One point of the plane that the diagonal areas sample.
#[derive(Clone, Copy, Default, PartialEq)]
struct Point {
    x: f64,
    y: f64,
}

impl Point {
    const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    fn add(self, other: Self) -> Self {
        Self::new(self.x + other.x, self.y + other.y)
    }

    fn sub(self, other: Self) -> Self {
        Self::new(self.x - other.x, self.y - other.y)
    }

    fn div(self, divisor: f64) -> Self {
        Self::new(self.x / divisor, self.y / divisor)
    }

}

/// The subsample offsets that the area table's seven slots serve, and the five of the diagonal
/// patterns.
const ORTHO_OFFSETS: [f64; 7] = [0.0, -0.25, 0.25, -0.125, 0.125, -0.375, 0.375];
const DIAG_OFFSETS: [Point; 5] = [
    Point::new(0.0, 0.0),
    Point::new(0.25, -0.25),
    Point::new(-0.25, 0.25),
    Point::new(0.125, -0.125),
    Point::new(-0.125, 0.125),
];
/// The width and height of the table, and the sizes of the pattern slots within it.
pub(crate) const AREA_WIDTH: u32 = 160;
pub(crate) const AREA_HEIGHT: u32 = 560;
const SIZE_ORTHO: usize = 16;
const SIZE_DIAG: usize = 20;
/// The samples on each side of a diagonal area's square.
const SAMPLES_DIAG: usize = 30;
/// The distance over which a small u-shaped pattern's area eases into its square corner.
const SMOOTH_MAX_DISTANCE: f64 = 32.0;

/// The place of each orthogonal pattern's slot by its column and row in its block.
const EDGES_ORTHO: [(usize, usize); 16] = [
    (0, 0),
    (3, 0),
    (0, 3),
    (3, 3),
    (1, 0),
    (4, 0),
    (1, 3),
    (4, 3),
    (0, 1),
    (3, 1),
    (0, 4),
    (3, 4),
    (1, 1),
    (4, 1),
    (1, 4),
    (4, 4),
];
/// The place of each diagonal pattern's slot.
const EDGES_DIAG: [(usize, usize); 16] = [
    (0, 0),
    (1, 0),
    (0, 2),
    (1, 2),
    (2, 0),
    (3, 0),
    (2, 2),
    (3, 2),
    (0, 1),
    (1, 1),
    (0, 3),
    (1, 3),
    (2, 1),
    (3, 1),
    (2, 3),
    (3, 3),
];

/// `a` increased toward `b` by `p`.
fn lerp(a: f64, b: f64, p: f64) -> f64 {
    a + (b - a) * p
}

/// `a` kept within 0 and 1.
fn saturate(a: f64) -> f64 {
    a.clamp(0.0, 1.0)
}

/// Eases a small u-shaped pattern's area into its square corner with the distance from the edge.
fn smooth_area(d: f64, a1: Point, a2: Point) -> (Point, Point) {
    let b1 = Point::new((2.0 * a1.x).sqrt() * 0.5, (2.0 * a1.y).sqrt() * 0.5);
    let b2 = Point::new((2.0 * a2.x).sqrt() * 0.5, (2.0 * a2.y).sqrt() * 0.5);
    let p = saturate(d / SMOOTH_MAX_DISTANCE);
    (
        Point::new(lerp(b1.x, a1.x, p), lerp(b1.y, a1.y, p)),
        Point::new(lerp(b2.x, a2.x, p), lerp(b2.y, a2.y, p)),
    )
}

/// The area under the line from `p1` to `p2` in the pixel column `x`, on each side of it: the area
/// below the line in the first, and above it in the second.
fn ortho_area(p1: Point, p2: Point, x: usize) -> (f64, f64) {
    let d = p2.sub(p1);
    let x1 = x as f64;
    let x2 = x1 + 1.0;
    let y1 = p1.y + d.y * (x1 - p1.x) / d.x;
    let y2 = p1.y + d.y * (x2 - p1.x) / d.x;
    let inside = (x1 >= p1.x && x1 < p2.x) || (x2 > p1.x && x2 <= p2.x);
    if !inside {
        return (0.0, 0.0);
    }
    let trapezoid =
        y1.is_sign_positive() == y2.is_sign_positive() || y1.abs() < 1e-4 || y2.abs() < 1e-4;
    if trapezoid {
        let a = (y1 + y2) / 2.0;
        return if a < 0.0 { (a.abs(), 0.0) } else { (0.0, a.abs()) };
    }
    let cross = -p1.y * d.x / d.y + p1.x;
    let fraction = cross.fract();
    let a1 = if cross > p1.x { y1 * fraction / 2.0 } else { 0.0 };
    let a2 = if cross < p2.x {
        y2 * (1.0 - fraction) / 2.0
    } else {
        0.0
    };
    let a = if a1.abs() > a2.abs() { a1 } else { -a2 };
    if a < 0.0 {
        (a1.abs(), a2.abs())
    } else {
        (a2.abs(), a1.abs())
    }
}

/// The area on each side of the orthogonal pattern `pattern` at distances `left` and `right` from
/// the edge's ends, biased by `offset`.
fn area_ortho(pattern: usize, left: usize, right: usize, offset: f64) -> (f64, f64) {
    let d = (left + right + 1) as f64;
    let o1 = 0.5 + offset;
    let o2 = 0.5 + offset - 1.0;
    let a = |x: usize| ortho_area(Point::new(0.0, o2), Point::new(d / 2.0, 0.0), x);
    let b = |x: usize| ortho_area(Point::new(d / 2.0, 0.0), Point::new(d, o2), x);
    let c = |x: usize| ortho_area(Point::new(0.0, o1), Point::new(d / 2.0, 0.0), x);
    let e = |x: usize| ortho_area(Point::new(d / 2.0, 0.0), Point::new(d, o1), x);
    let full = |p1, p2, x| ortho_area(p1, p2, x);
    match pattern {
        0 | 5 | 10 | 15 => (0.0, 0.0),
        1 => {
            if left <= right {
                a(left)
            } else {
                (0.0, 0.0)
            }
        }
        2 => {
            if left >= right {
                b(left)
            } else {
                (0.0, 0.0)
            }
        }
        3 => {
            let (a1, a2) = (Point::new(a(left).0, a(left).1), Point::new(b(left).0, b(left).1));
            let (a1, a2) = smooth_area(d, a1, a2);
            (a1.x + a2.x, a1.y + a2.y)
        }
        4 => {
            if left <= right {
                c(left)
            } else {
                (0.0, 0.0)
            }
        }
        6 => {
            if offset.abs() > 0.0 {
                let line = full(Point::new(0.0, o1), Point::new(d, o2), left);
                let (x, y) = c(left);
                let (x2, y2) = b(left);
                (
                    (line.0 + x + x2) / 2.0,
                    (line.1 + y + y2) / 2.0,
                )
            } else {
                full(Point::new(0.0, o1), Point::new(d, o2), left)
            }
        }
        7 => full(Point::new(0.0, o1), Point::new(d, o2), left),
        11 | 13 => full(Point::new(0.0, o2), Point::new(d, o1), left),
        8 => {
            if left >= right {
                e(left)
            } else {
                (0.0, 0.0)
            }
        }
        9 => {
            if offset.abs() > 0.0 {
                let line = full(Point::new(0.0, o2), Point::new(d, o1), left);
                let (x, y) = a(left);
                let (x2, y2) = e(left);
                ((line.0 + x + x2) / 2.0, (line.1 + y + y2) / 2.0)
            } else {
                full(Point::new(0.0, o2), Point::new(d, o1), left)
            }
        }
        12 => {
            let (a1, a2) = (Point::new(c(left).0, c(left).1), Point::new(e(left).0, e(left).1));
            let (a1, a2) = smooth_area(d, a1, a2);
            (a1.x + a2.x, a1.y + a2.y)
        }
        14 => full(Point::new(0.0, o1), Point::new(d, o2), left),
        _ => (0.0, 0.0),
    }
}

/// The share of a pixel that lies on one side of the line through `p1` and `p2`, sampling a square
/// of `SAMPLES_DIAG` points on each side.
fn diag_fraction(p1: Point, p2: Point, pixel: Point) -> f64 {
    if p1 == p2 {
        return 1.0;
    }
    let middle = p1.add(p2).div(2.0);
    let a = p2.y - p1.y;
    let b = p1.x - p2.x;
    let c = a * (pixel.x - middle.x) + b * (pixel.y - middle.y);
    let n = SAMPLES_DIAG as f64;
    let step = 1.0 / (n - 1.0);
    // Each sample row j counts the columns i whose value a*i + b*j + c is above zero.
    let mut inside = 0u32;
    for j in 0..SAMPLES_DIAG {
        let constant = c + b * j as f64 * step;
        if a > 0.0 {
            let least = -constant / (a * step);
            // The columns i > least, from 0 to n - 1.
            let first = if least < 0.0 {
                0
            } else {
                (least.floor() as i64 + 1).clamp(0, SAMPLES_DIAG as i64) as usize
            };
            inside += (SAMPLES_DIAG - first) as u32;
        } else if a < 0.0 {
            let most = -constant / (a * step);
            // The columns i < most.
            let last = (most.ceil() as i64).clamp(0, SAMPLES_DIAG as i64) as usize;
            inside += last as u32;
        } else if constant > 0.0 {
            inside += SAMPLES_DIAG as u32;
        }
    }
    f64::from(inside) / (n * n)
}

/// The area on each side of the diagonal pattern `pattern` at distances `left` and `right`, biased
/// by `offset`.
fn area_diag(pattern: usize, left: usize, right: usize, offset: Point) -> (f64, f64) {
    let area = |p1: Point, p2: Point| {
        let (e1, e2) = EDGES_DIAG[pattern];
        let p1 = if e1 > 0 { p1.add(offset) } else { p1 };
        let p2 = if e2 > 0 { p2.add(offset) } else { p2 };
        let shift = Point::new(left as f64, left as f64);
        let a1 = diag_fraction(p1, p2, Point::new(1.0, 0.0).add(shift));
        let a2 = diag_fraction(p1, p2, Point::new(1.0, 1.0).add(shift));
        (1.0 - a1, a2)
    };
    let d = (left + right + 1) as f64;
    let far = Point::new(d, d);
    let average = |a: (f64, f64), b: (f64, f64)| ((a.0 + b.0) / 2.0, (a.1 + b.1) / 2.0);
    let origin = Point::new(1.0, 1.0);
    match pattern {
        0 => average(
            area(origin, origin.add(far)),
            area(Point::new(1.0, 0.0), Point::new(1.0, 0.0).add(far)),
        ),
        1 => average(
            area(Point::new(1.0, 0.0), Point::new(0.0, 0.0).add(far)),
            area(Point::new(1.0, 0.0), Point::new(1.0, 0.0).add(far)),
        ),
        2 => average(
            area(Point::new(0.0, 0.0), Point::new(1.0, 0.0).add(far)),
            area(Point::new(1.0, 0.0), Point::new(1.0, 0.0).add(far)),
        ),
        3 => area(Point::new(1.0, 0.0), Point::new(1.0, 0.0).add(far)),
        4 => average(
            area(origin, Point::new(0.0, 0.0).add(far)),
            area(origin, Point::new(1.0, 0.0).add(far)),
        ),
        5 => average(
            area(origin, Point::new(0.0, 0.0).add(far)),
            area(Point::new(1.0, 0.0), Point::new(1.0, 0.0).add(far)),
        ),
        6 => area(origin, Point::new(1.0, 0.0).add(far)),
        7 => average(
            area(origin, Point::new(1.0, 0.0).add(far)),
            area(Point::new(1.0, 0.0), Point::new(1.0, 0.0).add(far)),
        ),
        8 => average(
            area(Point::new(0.0, 0.0), origin.add(far)),
            area(Point::new(1.0, 0.0), origin.add(far)),
        ),
        9 => area(Point::new(1.0, 0.0), origin.add(far)),
        10 => average(
            area(Point::new(0.0, 0.0), origin.add(far)),
            area(Point::new(1.0, 0.0), Point::new(1.0, 0.0).add(far)),
        ),
        11 => average(
            area(Point::new(1.0, 0.0), origin.add(far)),
            area(Point::new(1.0, 0.0), Point::new(1.0, 0.0).add(far)),
        ),
        12 => area(origin, origin.add(far)),
        13 => average(area(origin, origin.add(far)), area(Point::new(1.0, 0.0), origin.add(far))),
        14 => average(
            area(origin, origin.add(far)),
            area(origin, Point::new(1.0, 0.0).add(far)),
        ),
        15 => average(
            area(origin, origin.add(far)),
            area(Point::new(1.0, 0.0), Point::new(1.0, 0.0).add(far)),
        ),
        _ => (0.0, 0.0),
    }
}

/// The area table's texels, four bytes each, row after row from the top: the two areas as the red
/// and green channels, quantized as the engine's copy of the reference quantizes them.
pub(crate) fn areas() -> Vec<u8> {
    let (width, height) = (AREA_WIDTH as usize, AREA_HEIGHT as usize);
    let mut texels = vec![0u8; width * height * 4];
    let mut put = |x: usize, y: usize, value: (f64, f64)| {
        let at = 4 * (y * width + x);
        texels[at] = (255.0 * value.0) as u8;
        texels[at + 1] = (255.0 * value.1) as u8;
        texels[at + 2] = 0;
        texels[at + 3] = 0;
    };
    for (slot, offset) in ORTHO_OFFSETS.iter().enumerate() {
        for pattern in 0..16 {
            let (edge_x, edge_y) = EDGES_ORTHO[pattern];
            for right in 0..SIZE_ORTHO {
                for left in 0..SIZE_ORTHO {
                    let value = area_ortho(pattern, left * left, right * right, *offset);
                    let x = left + SIZE_ORTHO * edge_x;
                    let y = 5 * SIZE_ORTHO * slot + right + SIZE_ORTHO * edge_y;
                    put(x, y, value);
                }
            }
        }
    }
    for (slot, offset) in DIAG_OFFSETS.iter().enumerate() {
        for pattern in 0..16 {
            let (edge_x, edge_y) = EDGES_DIAG[pattern];
            for right in 0..SIZE_DIAG {
                for left in 0..SIZE_DIAG {
                    let value = area_diag(pattern, left, right, *offset);
                    let x = 5 * SIZE_ORTHO + left + SIZE_DIAG * edge_x;
                    let y = 4 * SIZE_DIAG * slot + right + SIZE_DIAG * edge_y;
                    put(x, y, value);
                }
            }
        }
    }
    texels
}

/// The search table's width and height.
pub(crate) const SEARCH_WIDTH: u32 = 64;
pub(crate) const SEARCH_HEIGHT: u32 = 16;

/// The bilinear fetch of an edge pair, which the table's rows index.
fn bilinear(e: [f64; 4]) -> f64 {
    let a = lerp(e[0], e[1], 1.0 - 0.25);
    let b = lerp(e[2], e[3], 1.0 - 0.25);
    lerp(a, b, 1.0 - 0.125)
}

/// The edges that a bilinear fetch reads, by its value.
fn edges_of(value: f64) -> [f64; 4] {
    let corners = [
        [0.0, 0.0, 0.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0, 1.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 1.0],
        [0.0, 1.0, 1.0, 0.0],
        [0.0, 1.0, 1.0, 1.0],
        [1.0, 0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0, 1.0],
        [1.0, 0.0, 1.0, 0.0],
        [1.0, 0.0, 1.0, 1.0],
        [1.0, 1.0, 0.0, 0.0],
        [1.0, 1.0, 0.0, 1.0],
        [1.0, 1.0, 1.0, 0.0],
        [1.0, 1.0, 1.0, 1.0],
    ];
    corners
        .into_iter()
        .find(|&corner| bilinear(corner) == value)
        .unwrap_or([0.0; 4])
}

/// The extra distance that a search to the left adds past its last fetch.
fn delta_left(left: [f64; 4], top: [f64; 4]) -> f64 {
    let mut d = 0.0;
    if top[3] == 1.0 {
        d += 1.0;
    }
    if d == 1.0 && top[2] == 1.0 && left[1] != 1.0 && left[3] != 1.0 {
        d += 1.0;
    }
    d
}

/// The extra distance that a search to the right adds past its last fetch.
fn delta_right(left: [f64; 4], top: [f64; 4]) -> f64 {
    let mut d = 0.0;
    if top[3] == 1.0 && left[1] != 1.0 && left[3] != 1.0 {
        d += 1.0;
    }
    if d == 1.0 && top[2] == 1.0 && left[0] != 1.0 && left[2] != 1.0 {
        d += 1.0;
    }
    d
}

/// The search table's texels, one byte each in the red channel, row after row from the top: the
/// left cases in the first half of the columns and the right cases in the second.
pub(crate) fn searches() -> Vec<u8> {
    let mut texels = vec![0u8; (SEARCH_WIDTH * SEARCH_HEIGHT * 4) as usize];
    // The reference lays the cases out in 33 by 33 texels, crops them to 64 by 16 from the row
    // below the middle, and flips the rows.
    let mut cases = [[0u8; 66]; 33];
    for x in 0..33 {
        for y in 0..33 {
            let left = edges_of(0.03125 * x as f64);
            let top = edges_of(0.03125 * y as f64);
            if bilinear(left) != 0.03125 * x as f64 || bilinear(top) != 0.03125 * y as f64 {
                continue;
            }
            let edges = [left, top];
            cases[y][x] = (127.0 * delta_left(edges[0], edges[1])) as u8;
            cases[y][33 + x] = (127.0 * delta_right(edges[0], edges[1])) as u8;
        }
    }
    for y in 0..SEARCH_HEIGHT as usize {
        for x in 0..SEARCH_WIDTH as usize {
            let value = cases[32 - y][x];
            let at = 4 * (y * SEARCH_WIDTH as usize + x);
            texels[at] = value;
        }
    }
    texels
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_area_table_has_the_sizes_that_the_shader_reads() {
        let texels = areas();
        assert_eq!(texels.len(), (AREA_WIDTH * AREA_HEIGHT * 4) as usize);
        // The middle of an unfiltered pattern covers nothing.
        let at = 4 * ((5 * SIZE_ORTHO + 0) * AREA_WIDTH as usize + 0);
        assert_eq!((texels[at], texels[at + 1]), (0, 0));
    }

    #[test]
    fn a_covered_edge_puts_its_area_on_the_side_that_the_line_enters() {
        // Pattern 1 at no distance from its left end: the line enters the pixel's left half.
        let (below, above) = area_ortho(1, 0, 0, 0.0);
        assert!(below + above > 0.0, "the pixel is partly covered");
        // Pattern 0 covers nothing.
        assert_eq!(area_ortho(0, 5, 5, 0.0), (0.0, 0.0));
    }

    #[test]
    fn the_search_table_carries_distances_to_the_left_and_to_the_right() {
        let texels = searches();
        assert_eq!(texels.len(), (SEARCH_WIDTH * SEARCH_HEIGHT * 4) as usize);
        assert!(texels.iter().step_by(4).any(|&value| value > 0));
    }
}
