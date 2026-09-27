//! The WebAssembly entry point. The same source builds twice: the threaded build uses shared
//! memory and atomics, and the single-threaded build runs where the page is not cross-origin
//! isolated.

use wasm_bindgen::prelude::*;

/// The engine version, as the loader reports it.
#[wasm_bindgen(js_name = engineVersion)]
pub fn engine_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

/// True in the build compiled with atomics and shared memory.
#[wasm_bindgen(js_name = isThreadedBuild)]
pub fn is_threaded_build() -> bool {
    cfg!(target_feature = "atomics")
}
