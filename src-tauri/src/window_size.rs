//! The main window's opening size.
//!
//! The layout is drawn for 1300x830 CSS pixels: below about 1270 wide the project header no
//! longer fits and the page scrolls sideways. On Linux, WebKitGTK zooms every page by the
//! desktop's font DPI, so a window of 1300x830 screen pixels holds only 866x553 CSS pixels
//! under Xft.dpi 144. The window is therefore sized for the layout at the zoom the page will
//! get, and never larger than most of the monitor.

use tauri::{LogicalSize, WebviewWindow};

/// What the layout is drawn for, in CSS pixels.
const LAYOUT: (f64, f64) = (1300.0, 830.0);
/// The most of the monitor's work area the window opens on.
const MAX_SHARE: f64 = 0.9;

/// Opening size in logical pixels, for the page zoom and the monitor's work area (logical).
pub fn opening_size(page_zoom: f64, work_area: LogicalSize<f64>) -> LogicalSize<f64> {
    LogicalSize::new(
        (LAYOUT.0 * page_zoom)
            .min(work_area.width * MAX_SHARE)
            .round(),
        (LAYOUT.1 * page_zoom)
            .min(work_area.height * MAX_SHARE)
            .round(),
    )
}

/// The zoom WebKitGTK gives pages: GDK's screen resolution over the 96 DPI of a CSS pixel.
/// Measured on WebKitGTK 2.50 under X11 with Xft.dpi 144: a 1300 px wide window has an
/// innerWidth of 866, and GDK_DPI_SCALE=0.667 brings it back to 1300.
#[cfg(target_os = "linux")]
fn page_zoom() -> f64 {
    let dpi = gtk::gdk::Screen::default().map_or(-1.0, |screen| screen.resolution());
    // GDK answers -1 when no resolution is set
    if dpi > 0.0 {
        dpi / 96.0
    } else {
        1.0
    }
}

/// WebView2 and WKWebView scale pages by the monitor's scale factor, which logical pixels
/// already carry.
#[cfg(not(target_os = "linux"))]
fn page_zoom() -> f64 {
    1.0
}

/// Sizes the window for the monitor it opens on, and centres it there, with room for the
/// layout at the platform's zoom times the user's own (`user_zoom`). Anything missing (no
/// monitor reported) leaves the size from tauri.conf.json.
pub fn fit_to_monitor(window: &WebviewWindow, user_zoom: f64) {
    let monitor = match window.current_monitor() {
        Ok(Some(monitor)) => monitor,
        _ => match window.primary_monitor() {
            Ok(Some(monitor)) => monitor,
            _ => return,
        },
    };
    let area = monitor
        .work_area()
        .size
        .to_logical::<f64>(monitor.scale_factor());
    let _ = window.set_size(opening_size(page_zoom() * user_zoom, area));
    let _ = window.center();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn area(w: f64, h: f64) -> LogicalSize<f64> {
        LogicalSize::new(w, h)
    }

    #[test]
    fn unzoomed_page_opens_at_the_layout_size() {
        // 1080p, 96 DPI: what the fixed config size gave until now
        assert_eq!(opening_size(1.0, area(1920.0, 1050.0)), area(1300.0, 830.0));
    }

    #[test]
    fn zoomed_page_gets_room_for_the_whole_layout() {
        // 4K under X11 with Xft.dpi 144: WebKitGTK zooms pages by 1.5
        assert_eq!(
            opening_size(1.5, area(3840.0, 2160.0)),
            area(1950.0, 1245.0)
        );
    }

    #[test]
    fn never_opens_larger_than_ninety_percent_of_the_work_area() {
        // 1080p with Xft.dpi 144: the zoomed layout is wider and taller than the screen
        assert_eq!(opening_size(1.5, area(1920.0, 1050.0)), area(1728.0, 945.0));
        // A small laptop at no zoom
        assert_eq!(opening_size(1.0, area(1366.0, 740.0)), area(1229.0, 666.0));
    }

    #[test]
    fn scaled_monitors_count_in_logical_pixels() {
        // Windows 4K at 150%: the work area is 2560x1400 logical, and WebView2 scales the
        // page itself, so the page zoom stays 1 and the layout size is enough
        assert_eq!(opening_size(1.0, area(2560.0, 1400.0)), area(1300.0, 830.0));
    }
}
