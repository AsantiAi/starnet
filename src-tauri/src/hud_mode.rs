//! HUD MODE — the main StarNet window as a small always-on-top corner panel.
//!
//! For the Commander who is gaming or watching something: the frontend (app/hudmode.js) folds the
//! station down to the live-activity deck + the real COMMS panel, and these commands turn the
//! SAME `main` window into a compact panel pinned above other windows. It is deliberately not a
//! second window: the API token, the streaming run, the roster and the group chats all live in the
//! one page, and a second copy of the app would fight it over the same saved state.
//!
//! Entering records exactly what the window was (normal bounds, maximized, fullscreen) and exiting
//! puts all of it back. The HUD's own rect is handed to the page on exit so it can remember where
//! the Commander parked it; on the next entry that rect is honoured only while it is still on a
//! connected monitor (an unplugged screen never swallows the HUD).
//!
//! Honest limits: always-on-top floats over normal and borderless-windowed apps. An
//! exclusive-fullscreen game owns the display and draws over every window, this one included.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, State};

/// Event the page listens for (hudmode.js) when the tray asks for the HUD / the full station.
pub(crate) const HUD_EVENT: &str = "starnet-hud";

/// Default HUD footprint in logical px, and its distance from the work-area corner.
const HUD_DEFAULT_W: f64 = 400.0;
const HUD_DEFAULT_H: f64 = 640.0;
const HUD_MARGIN: f64 = 16.0;
/// The HUD's own floor: narrow enough for a corner, tall enough for the folded deck.
const HUD_MIN_W: f64 = 300.0;
const HUD_MIN_H: f64 = 72.0;
/// The smallest the HUD folds to: the widget (one agent at its desk, its clock). Only a fold with an
/// explicit width goes below HUD_MIN_W; a remembered or default rect never does.
const HUD_WIDGET_MIN_W: f64 = 160.0;
/// A folded HUD never grows past this (logical px) whatever height the page asks for.
const HUD_FOLD_MAX_H: f64 = 480.0;
/// The widget (a fold that carries a width) is the Commander's to size: it may stand taller than a folded feed.
const HUD_WIDGET_MAX_H: f64 = 1000.0;
/// The station's normal floor — mirrors `.min_inner_size(960.0, 600.0)` in build_main_window
/// (test/desktop-hud-mode.test.js keeps the two in step).
const MAIN_MIN_W: f64 = 960.0;
const MAIN_MIN_H: f64 = 600.0;
/// A window wider than this (logical) while the HUD is on is not a HUD any more (a WebView2 crash
/// rebuild re-creates `main` at the station's floor size): put it back in the corner.
const HUD_SANE_MAX_W: f64 = 720.0;

/// A window rect in PHYSICAL px: outer position + inner size (what set_position/set_size take).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct HudRect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// A monitor's usable area (taskbar excluded) in physical px, plus its scale factor.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WorkArea {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub scale: f64,
}

#[derive(Clone, Copy)]
struct Restore {
    maximized: bool,
    fullscreen: bool,
    position: Option<PhysicalPosition<i32>>,
    size: Option<PhysicalSize<u32>>,
}

#[derive(Default)]
struct Inner {
    active: bool,
    pinned: bool,
    folded: bool,
    restore: Option<Restore>,
    unfolded_h: Option<u32>,
    unfolded_w: Option<u32>,
}

/// Managed state: the HUD's lifecycle for the one `main` window.
#[derive(Default)]
pub struct HudState(Mutex<Inner>);

/// What the page is told — always read back from the window, never echoed from the request.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HudView {
    active: bool,
    pinned: bool,
    folded: bool,
    rect: Option<HudRect>,
}

/// The default HUD rect: top-right corner of `area`, clamped to fit inside it.
pub fn default_rect(area: WorkArea) -> HudRect {
    let s = if area.scale.is_finite() && area.scale > 0.0 { area.scale } else { 1.0 };
    let margin = (HUD_MARGIN * s).round() as i64;
    let min_w = (HUD_MIN_W * s).round() as i64;
    let min_h = (HUD_MIN_H * s).round() as i64;
    let avail_w = (area.w as i64 - 2 * margin).max(min_w);
    let avail_h = (area.h as i64 - 2 * margin).max(min_h);
    let w = ((HUD_DEFAULT_W * s).round() as i64).clamp(min_w, avail_w);
    let h = ((HUD_DEFAULT_H * s).round() as i64).clamp(min_h, avail_h);
    let x = area.x as i64 + area.w as i64 - w - margin;
    let y = area.y as i64 + margin;
    HudRect { x: x as i32, y: y as i32, w: w as u32, h: h as u32 }
}

/// A remembered rect is usable only while its grab strip (the point 16px below the middle of its
/// top edge) sits on a connected monitor's work area — otherwise the Commander could not reach
/// the drag bar to bring it back.
pub fn rect_reachable(rect: &HudRect, areas: &[WorkArea]) -> bool {
    if rect.w == 0 || rect.h == 0 {
        return false;
    }
    let gx = rect.x as i64 + rect.w as i64 / 2;
    let gy = rect.y as i64 + 16;
    areas.iter().any(|a| {
        gx >= a.x as i64 && gx < a.x as i64 + a.w as i64 && gy >= a.y as i64 && gy < a.y as i64 + a.h as i64
    })
}

/// Clamp a remembered rect's size into the HUD's floor and the monitor it lands on.
pub fn fit_rect(rect: HudRect, area: WorkArea) -> HudRect {
    let s = if area.scale.is_finite() && area.scale > 0.0 { area.scale } else { 1.0 };
    let min_w = (HUD_MIN_W * s).round() as u32;
    let min_h = (HUD_MIN_H * s).round() as u32;
    HudRect {
        x: rect.x,
        y: rect.y,
        w: rect.w.clamp(min_w, area.w.max(min_w)),
        h: rect.h.clamp(min_h, area.h.max(min_h)),
    }
}

/// The physical height a folded HUD should take for a page-measured deck height (logical px).
/// A folded width: the page's logical width for the widget (its default, or the size the Commander dragged it
/// to — which may be WIDER than the HUD it folds from), within the HUD's sane bounds; no width asked = the
/// full width it folds from.
pub fn folded_width(logical: Option<f64>, scale: f64, full: u32) -> u32 {
    let s = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    match logical.filter(|v| v.is_finite() && *v > 0.0) {
        Some(w) => (w.clamp(HUD_WIDGET_MIN_W, HUD_SANE_MAX_W) * s).round() as u32,
        None => full,
    }
}

pub fn folded_height(deck_logical: Option<f64>, scale: f64) -> u32 {
    folded_height_max(deck_logical, scale, HUD_FOLD_MAX_H)
}

pub fn folded_height_max(deck_logical: Option<f64>, scale: f64, max: f64) -> u32 {
    let s = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    let h = deck_logical.filter(|v| v.is_finite() && *v > 0.0).unwrap_or(140.0);
    (h.clamp(HUD_MIN_H, max) * s).round() as u32
}

fn main_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "main window unavailable".to_string())
}

fn lock(state: &HudState) -> std::sync::MutexGuard<'_, Inner> {
    match state.0.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn work_area_of(m: &tauri::Monitor) -> WorkArea {
    let wa = m.work_area();
    WorkArea {
        x: wa.position.x,
        y: wa.position.y,
        w: wa.size.width,
        h: wa.size.height,
        scale: m.scale_factor(),
    }
}

fn current_rect(win: &tauri::WebviewWindow) -> Option<HudRect> {
    let p = win.outer_position().ok()?;
    let s = win.inner_size().ok()?;
    Some(HudRect { x: p.x, y: p.y, w: s.width, h: s.height })
}

fn apply_rect(win: &tauri::WebviewWindow, r: HudRect) {
    let _ = win.set_size(PhysicalSize::new(r.w, r.h));
    let _ = win.set_position(PhysicalPosition::new(r.x, r.y));
}

/// The rect to open the HUD at: the remembered one if it is still reachable (`true`: it is exactly
/// where the Commander left it), else the default corner of the monitor the window is on (`false`).
fn target_rect(win: &tauri::WebviewWindow, remembered: Option<HudRect>) -> Option<(HudRect, bool)> {
    let areas: Vec<WorkArea> = win
        .available_monitors()
        .map(|ms| ms.iter().map(work_area_of).collect())
        .unwrap_or_default();
    if let Some(r) = remembered {
        if let Some(area) = areas.iter().find(|a| rect_reachable(&r, std::slice::from_ref(*a))) {
            return Some((fit_rect(r, *area), true));
        }
    }
    let here = win
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| win.primary_monitor().ok().flatten())
        .map(|m| work_area_of(&m))
        .or_else(|| areas.first().copied())?;
    Some((default_rect(here), false))
}

/// The default corner is computed for the page (inner) width, but an undecorated Windows window
/// keeps invisible resize borders on its left/right, so its outer rect is wider. Shift left by the
/// border so the VISIBLE panel, not the invisible frame, sits HUD_MARGIN from the screen edge.
fn corner_x(r: HudRect, outer_w: u32, inner_w: u32) -> i32 {
    r.x - (outer_w.saturating_sub(inner_w) / 2) as i32
}

fn view(win: Option<&tauri::WebviewWindow>, g: &Inner) -> HudView {
    let pinned = match win {
        Some(w) if g.active => w.is_always_on_top().unwrap_or(g.pinned),
        _ => false,
    };
    let mut rect = win.and_then(current_rect);
    if let (Some(r), Some(h)) = (rect.as_mut(), g.unfolded_h) {
        if g.folded {
            r.h = h; // a folded HUD remembers the size it will unfold to
            if let Some(w) = g.unfolded_w {
                r.w = w;
            }
        }
    }
    HudView { active: g.active, pinned, folded: g.folded, rect }
}

/// The HUD's current state (a reloaded page asks this to put its HUD layout back).
#[tauri::command]
pub fn starnet_hud_status(app: AppHandle, state: State<'_, HudState>) -> HudView {
    let g = lock(&state);
    let win = app.get_webview_window("main");
    view(win.as_ref(), &g)
}

/// Enter (`active: true`) or leave (`active: false`) HUD mode on the main window.
#[tauri::command]
pub fn starnet_hud_set(
    app: AppHandle,
    state: State<'_, HudState>,
    active: bool,
    pinned: Option<bool>,
    rect: Option<HudRect>,
) -> Result<HudView, String> {
    let win = main_window(&app)?;
    let mut g = lock(&state);
    if active {
        let fresh = !g.active;
        if fresh {
            // Leave fullscreen/maximized FIRST so the bounds recorded are the windowed ones the
            // station returns to; the flags themselves are restored on exit.
            let fullscreen = win.is_fullscreen().unwrap_or(false);
            if fullscreen {
                let _ = win.set_fullscreen(false);
            }
            let maximized = win.is_maximized().unwrap_or(false);
            if maximized {
                let _ = win.unmaximize();
            }
            g.restore = Some(Restore {
                maximized,
                fullscreen,
                position: win.outer_position().ok(),
                size: win.inner_size().ok(),
            });
            g.folded = false;
            g.unfolded_h = None;
            g.unfolded_w = None;
            g.pinned = pinned.unwrap_or(true);
            g.active = true;
        } else if let Some(p) = pinned {
            g.pinned = p;
        }
        let _ = win.set_min_size(Some(LogicalSize::new(HUD_WIDGET_MIN_W, HUD_MIN_H)));
        let _ = win.set_always_on_top(g.pinned);
        let oversized = win
            .inner_size()
            .ok()
            .zip(win.scale_factor().ok())
            .is_some_and(|(s, f)| (s.width as f64) / f > HUD_SANE_MAX_W);
        if fresh || oversized {
            if let Some((r, remembered)) = target_rect(&win, if fresh { rect } else { None }) {
                apply_rect(&win, r);
                if !remembered {
                    if let (Ok(outer), Ok(inner)) = (win.outer_size(), win.inner_size()) {
                        let _ = win.set_position(PhysicalPosition::new(corner_x(r, outer.width, inner.width), r.y));
                    }
                }
            }
        }
        let _ = win.unminimize();
        return Ok(view(Some(&win), &g));
    }

    if !g.active {
        return Ok(view(Some(&win), &g));
    }
    // The HUD rect the page should remember (unfolded height if it was folded).
    let hud_rect = view(Some(&win), &g).rect;
    g.active = false;
    g.folded = false;
    g.unfolded_h = None;
    g.unfolded_w = None;
    let _ = win.set_always_on_top(false);
    let _ = win.set_min_size(Some(LogicalSize::new(MAIN_MIN_W, MAIN_MIN_H)));
    if let Some(r) = g.restore.take() {
        if let Some(size) = r.size {
            let _ = win.set_size(size);
        }
        if let Some(position) = r.position {
            let _ = win.set_position(position);
        }
        if r.maximized {
            let _ = win.maximize();
        }
        if r.fullscreen {
            let _ = win.set_fullscreen(true);
        }
    }
    let _ = win.unminimize();
    let _ = win.set_focus();
    Ok(HudView { active: false, pinned: false, folded: false, rect: hud_rect })
}

/// Keep the HUD above other windows (or not). The answer is the window's read-back.
#[tauri::command]
pub fn starnet_hud_pin(
    app: AppHandle,
    state: State<'_, HudState>,
    pinned: bool,
) -> Result<HudView, String> {
    let win = main_window(&app)?;
    let mut g = lock(&state);
    if !g.active {
        return Err("HUD mode is not on".to_string());
    }
    g.pinned = pinned;
    win.set_always_on_top(pinned).map_err(|e| e.to_string())?;
    Ok(view(Some(&win), &g))
}

/// Fold the HUD down to its activity deck (`height` = the deck's measured logical height), re-fit a
/// folded HUD to a new deck height, or unfold it back to the height it had before folding.
#[tauri::command]
pub fn starnet_hud_fold(
    app: AppHandle,
    state: State<'_, HudState>,
    folded: bool,
    height: Option<f64>,
    width: Option<f64>,
) -> Result<HudView, String> {
    let win = main_window(&app)?;
    let mut g = lock(&state);
    if !g.active {
        return Err("HUD mode is not on".to_string());
    }
    let size = win.inner_size().map_err(|e| e.to_string())?;
    let scale = win.scale_factor().unwrap_or(1.0);
    let pos = win.outer_position().ok();
    // The HUD lives in a corner: a width change keeps the RIGHT edge where it is.
    let keep_right = |new_w: u32| {
        if new_w != size.width {
            if let Some(p) = pos {
                let _ = win.set_position(PhysicalPosition::new(p.x + size.width as i32 - new_w as i32, p.y));
            }
        }
    };
    if folded {
        if !g.folded {
            g.unfolded_h = Some(size.height);
            g.unfolded_w = Some(size.width);
            g.folded = true;
        }
        // (re-)fit: the widget or the feed grew or shrank while folded
        let w = folded_width(width, scale, g.unfolded_w.unwrap_or(size.width));
        let max_h = if width.is_some() { HUD_WIDGET_MAX_H } else { HUD_FOLD_MAX_H };
        let _ = win.set_size(PhysicalSize::new(w, folded_height_max(height, scale, max_h)));
        keep_right(w);
    } else if g.folded {
        let back_h = g
            .unfolded_h
            .take()
            .unwrap_or_else(|| (HUD_DEFAULT_H * scale).round() as u32);
        let back_w = g.unfolded_w.take().unwrap_or(size.width);
        g.folded = false;
        let _ = win.set_size(PhysicalSize::new(back_w, back_h));
        keep_right(back_w);
    }
    Ok(view(Some(&win), &g))
}

/// Whether the HUD currently owns the main window (other window commands defer to it).
pub(crate) fn is_active(app: &AppHandle) -> bool {
    app.try_state::<HudState>().map(|s| lock(&s).active).unwrap_or(false)
}

/// Tray entry points: ask the page to switch (it owns the layout and calls starnet_hud_set).
/// `false` is only sent while the HUD is actually on, so Open StarNet stays a plain reveal otherwise.
pub(crate) fn request(app: &AppHandle, active: bool) {
    if active || is_active(app) {
        let _ = app.emit_to("main", HUD_EVENT, serde_json::json!({ "active": active }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn area(x: i32, y: i32, w: u32, h: u32, scale: f64) -> WorkArea {
        WorkArea { x, y, w, h, scale }
    }

    #[test]
    fn default_rect_sits_in_the_top_right_corner() {
        let r = default_rect(area(0, 0, 1920, 1040, 1.0));
        assert_eq!(r, HudRect { x: 1920 - 400 - 16, y: 16, w: 400, h: 640 });
    }

    #[test]
    fn default_rect_scales_with_the_monitor_and_follows_its_origin() {
        let r = default_rect(area(1920, -200, 2560, 1400, 1.5));
        assert_eq!(r.w, 600);
        assert_eq!(r.h, 960);
        assert_eq!(r.x, 1920 + 2560 - 600 - 24);
        assert_eq!(r.y, -200 + 24);
    }

    #[test]
    fn default_rect_never_exceeds_a_short_screen() {
        let r = default_rect(area(0, 0, 1280, 500, 1.0));
        assert_eq!(r.h, 500 - 32);
        assert!(r.y as i64 + r.h as i64 <= 500);
    }

    #[test]
    fn a_rect_on_an_unplugged_monitor_is_not_reachable() {
        let areas = [area(0, 0, 1920, 1040, 1.0)];
        assert!(rect_reachable(&HudRect { x: 1500, y: 20, w: 400, h: 600 }, &areas));
        assert!(!rect_reachable(&HudRect { x: 2400, y: 20, w: 400, h: 600 }, &areas));
        // grab strip above the top edge: unreachable even though most of the body is on screen
        assert!(!rect_reachable(&HudRect { x: 100, y: -40, w: 400, h: 600 }, &areas));
        assert!(!rect_reachable(&HudRect { x: 100, y: 100, w: 0, h: 600 }, &areas));
    }

    #[test]
    fn fit_rect_respects_the_floor_and_the_monitor() {
        let a = area(0, 0, 1920, 1040, 1.0);
        assert_eq!(fit_rect(HudRect { x: 10, y: 10, w: 100, h: 20 }, a), HudRect { x: 10, y: 10, w: 300, h: 72 });
        assert_eq!(fit_rect(HudRect { x: 10, y: 10, w: 5000, h: 5000 }, a), HudRect { x: 10, y: 10, w: 1920, h: 1040 });
    }

    #[test]
    fn the_corner_accounts_for_invisible_resize_borders() {
        let r = HudRect { x: 1504, y: 16, w: 400, h: 640 };
        assert_eq!(corner_x(r, 416, 400), 1496); // 8px border each side: visible edge lands 16px in
        assert_eq!(corner_x(r, 400, 400), 1504); // no border (macOS / decorated): unchanged
        assert_eq!(corner_x(r, 390, 400), 1504); // a smaller outer never pushes it right
    }

    #[test]
    fn folded_width_fits_the_widget_within_sane_bounds() {
        assert_eq!(folded_width(Some(250.0), 1.0, 400), 250);
        assert_eq!(folded_width(Some(250.0), 1.5, 600), 375);
        assert_eq!(folded_width(Some(40.0), 1.0, 400), 160);
        assert_eq!(folded_width(Some(593.0), 1.0, 400), 593); // a widget dragged wider than the HUD keeps its width
        assert_eq!(folded_width(Some(900.0), 1.0, 400), 720); // never past the sane HUD width
        assert_eq!(folded_width(None, 1.0, 400), 400);
        assert_eq!(folded_width(Some(f64::NAN), 2.0, 800), 800);
    }

    #[test]
    fn a_widget_may_stand_taller_than_a_folded_feed() {
        assert_eq!(folded_height_max(Some(700.0), 1.0, HUD_WIDGET_MAX_H), 700);
        assert_eq!(folded_height_max(Some(5000.0), 1.0, HUD_WIDGET_MAX_H), 1000);
        assert_eq!(folded_height(Some(700.0), 1.0), 480);
    }

    #[test]
    fn folded_height_clamps_and_scales() {
        assert_eq!(folded_height(Some(120.0), 1.0), 120);
        assert_eq!(folded_height(Some(120.0), 1.5), 180);
        assert_eq!(folded_height(Some(10.0), 1.0), 72);
        assert_eq!(folded_height(Some(9000.0), 1.0), 480);
        assert_eq!(folded_height(None, 1.0), 140);
        assert_eq!(folded_height(Some(f64::NAN), 2.0), 280);
    }
}
