//! Calls the system clock, which fails on wasm32-unknown-unknown. The engine's Clippy settings
//! must reject this crate.
#![deny(clippy::disallowed_methods)]

pub fn now_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
