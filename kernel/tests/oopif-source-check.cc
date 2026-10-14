// Copyright 2026 Star Browser contributors
// SPDX-License-Identifier: BSD-3-Clause
// Compile actual patched methods with interface shims. This is not a browser
// build and cannot validate first-script IPC ordering, pixels or routed input.
#include <cstdlib>
#include <iostream>
#include <optional>
#include <vector>
namespace display {
struct ScreenInfo {
  int width = 1470, height = 956, display_id = 1, gamut = 0;
  float device_scale_factor = 2, text_scale_multiplier = 1;
  bool operator==(const ScreenInfo&) const = default;
};
struct ScreenInfos {
  std::vector<ScreenInfo> screen_infos{ScreenInfo{}};
  const ScreenInfo& current() const { return screen_infos.front(); }
  bool operator==(const ScreenInfos&) const = default;
};
}
namespace gfx { struct Rect { int width = 300; bool operator==(const Rect&) const = default; }; }
enum class MediaValueChange { kOther };
namespace event_type_names { constexpr int kChange = 1; }
struct Event { static Event* Create(int) { static Event e; return &e; } };
struct Screen {
  int display_id = 0, changes = 0;
  void UpdateDisplayId(int id) { display_id = id; }
  void DispatchEvent(const Event&) { ++changes; }
  static bool AreWebExposedScreenPropertiesEqual(const display::ScreenInfo& a,
                                                const display::ScreenInfo& b) {
    return a.width == b.width && a.height == b.height && a.display_id == b.display_id;
  }
};
namespace color_space_utilities {
int GetColorSpaceGamut(const display::ScreenInfo& s) { return s.gamut; }
}
struct Document {
  int media_changes = 0;
  void MediaQueryAffectingValueChanged(MediaValueChange) { ++media_changes; }
};
struct DomWindow { Screen screen_; Screen* screen() { return &screen_; } };
struct FrameWidget {
  virtual ~FrameWidget() = default;
  virtual const display::ScreenInfo& GetScreenInfo() = 0;
  virtual const display::ScreenInfos& GetScreenInfos() = 0;
  virtual const display::ScreenInfos& GetWebExposedScreenInfos() = 0;
};
struct Page {
  double inspector_scale = 1;
  double InspectorDeviceScaleFactorOverride() const { return inspector_scale; }
};
struct LocalFrame {
  DomWindow dom; Document document; display::ScreenInfos details;
  FrameWidget* widget = nullptr; Page page; Page* page_ = &page;
  double layout_zoom_factor = 2;
  DomWindow* DomWindow() { return &dom; }
  Document* GetDocument() { return &document; }
  FrameWidget* GetWidgetForLocalRoot() { return widget; }
  double LayoutZoomFactor() const { return layout_zoom_factor; }
  double DevicePixelRatio() const;
};
struct WebLocalFrameImpl {
  LocalFrame frame; LocalFrame* GetFrame() { return &frame; }
};
struct CoreInitializer {
  static CoreInitializer& GetInstance() { static CoreInitializer c; return c; }
  void DidUpdateScreens(LocalFrame& frame, const display::ScreenInfos& infos) {
    frame.details = infos;
  }
};
struct FrameVisualProperties {
  double zoom_level = 0, css_zoom_factor = 1, page_scale_factor = 1;
  bool is_pinch_gesture_active = false;
  display::ScreenInfos screen_infos;
  std::optional<display::ScreenInfos> emulated_screen_infos;
  gfx::Rect visible_viewport_size;
  std::vector<gfx::Rect> root_widget_viewport_segments;
};
struct RemoteFrame {
  int updates = 0; FrameVisualProperties pending_visual_properties_;
  FrameVisualProperties sent;
  void SynchronizeVisualProperties() { ++updates; sent = pending_visual_properties_; }
  void DidChangeScreenInfos(const display::ScreenInfos&,
                           const std::optional<display::ScreenInfos>&);
};
struct WidgetBase {
  display::ScreenInfos effective;
  const display::ScreenInfo& GetScreenInfo() { return effective.current(); }
  int ComputeLCDTextPreference() { return 0; }
};
struct ViewSettings { void SetLCDTextPreference(int) {} };
struct WebView {
  float zoom_factor = 0; int popup_cancels = 0; ViewSettings settings;
  void SetZoomFactorForDeviceScaleFactor(float value, float) { zoom_factor = value; }
  ViewSettings* GetSettings() { return &settings; }
  void CancelPagePopup() { ++popup_cancels; }
};
struct WebFrameWidgetImpl : FrameWidget {
  WidgetBase storage; WidgetBase* widget_base_ = &storage;
  WebView view; display::ScreenInfos original;
  WebLocalFrameImpl local;
  std::vector<WebLocalFrameImpl*> locals{&local};
  std::vector<RemoteFrame*> remotes;
  std::optional<display::ScreenInfos> inherited_emulated_screen_infos_;
  std::optional<display::ScreenInfos> last_web_exposed_screen_infos_;
  const display::ScreenInfo& GetScreenInfo() override { return storage.effective.current(); }
  const display::ScreenInfos& GetScreenInfos() override { return storage.effective; }
  const display::ScreenInfos& GetWebExposedScreenInfos() override;
  std::optional<display::ScreenInfos> GetEmulatedScreenInfos();
  const display::ScreenInfos& GetOriginalScreenInfos() { return original; }
  WebView* View() { return &view; }
  bool ShouldAutoDetermineCompositingToLCDTextSetting() { return false; }
  WebLocalFrameImpl* LocalRootImpl() { return &local; }
  template<class F> void ForEachRemoteFrameControlledByWidget(F run) {
    for (auto* remote : remotes) run(remote);
  }
  double GetZoomLevel() { return 0; }
  double GetCSSZoomFactor() { return 1; }
  double PageScaleInMainFrame() { return 1; }
  bool PinchGestureActiveInMainFrame() { return false; }
  gfx::Rect VisibleViewportSize() { return {300}; }
  std::vector<gfx::Rect> segments{{300}};
  const std::vector<gfx::Rect>& ViewportSegments() { return segments; }
  void DidUpdateSurfaceAndScreen(const display::ScreenInfos&);
};
WebFrameWidgetImpl* owner;
template<class F> void ForEachLocalFrameControlledByWidget(LocalFrame*, F run) {
  for (auto* local : owner->locals) run(local);
}
struct CoreRemoteFrame {
  FrameVisualProperties properties;
  void InitializeFrameVisualProperties(const FrameVisualProperties& p) { properties = p; }
};
struct WebRemoteFrameImpl {
  CoreRemoteFrame frame;
  CoreRemoteFrame* GetFrame() { return &frame; }
  void InitializeFrameVisualProperties(WebFrameWidgetImpl*, WebView*);
};
struct ChromeClientImpl {
  const display::ScreenInfo& GetScreenInfo(LocalFrame&) const;
  const display::ScreenInfos& GetScreenInfos(LocalFrame&) const;
};
// ACTUAL_METHODS
int main() {
  int checks = 0;
  auto expect = [&checks](bool value) { if (!value) { std::cerr << "OOPIF source check " << checks + 1 << " failed\n"; std::exit(1); } ++checks; };
  WebFrameWidgetImpl top; owner = &top;
  const auto physical = top.original;
  auto synthetic = physical;
  synthetic.screen_infos[0].width = 1600; synthetic.screen_infos[0].height = 900;
  synthetic.screen_infos[0].device_scale_factor = 1.5;
  synthetic.screen_infos[0].display_id = 7;
  top.storage.effective = synthetic;
  top.local.frame.widget = &top; top.local.frame.page.inspector_scale = 0.75;
  RemoteFrame remote; top.remotes.push_back(&remote);
  WebLocalFrameImpl same_origin; same_origin.frame.widget = &top;
  top.locals.push_back(&same_origin);
  top.DidUpdateSurfaceAndScreen(physical);
  expect(remote.sent.screen_infos == physical);
  expect(remote.sent.emulated_screen_infos == synthetic); expect(remote.updates == 1);
  expect(top.local.frame.details == synthetic); expect(same_origin.frame.details == synthetic);
  expect(top.local.frame.dom.screen_.display_id == 7);
  expect(top.local.frame.dom.screen_.changes == 1);
  expect(top.view.popup_cancels == 0); expect(top.original == physical);
  expect(top.view.zoom_factor == 1.5); expect(top.local.frame.DevicePixelRatio() == 1.5);
  WebRemoteFrameImpl created;
  created.InitializeFrameVisualProperties(&top, &top.view);
  expect(created.frame.properties.screen_infos == physical);
  expect(created.frame.properties.emulated_screen_infos == synthetic);
  expect(created.frame.properties.visible_viewport_size.width == 300);
  expect(created.frame.properties.css_zoom_factor == 1);
  top.DidUpdateSurfaceAndScreen(physical);
  expect(remote.updates == 1); expect(top.local.frame.dom.screen_.changes == 1);
  expect(top.local.frame.document.media_changes == 1);

  // A child keeps physical screen/layout/compositor state and exposes inherited
  // native Screen/CSS/DPR metrics. The main-frame emulator remains unchanged.
  WebFrameWidgetImpl child; child.inherited_emulated_screen_infos_ = remote.sent.emulated_screen_infos;
  child.local.frame.widget = &child;
  RemoteFrame nested; child.remotes.push_back(&nested); owner = &child;
  child.DidUpdateSurfaceAndScreen(physical);
  expect(child.storage.effective == physical); expect(child.original == physical);
  expect(child.view.zoom_factor == 2); expect(child.local.frame.layout_zoom_factor == 2);
  expect(child.local.frame.DevicePixelRatio() == 1.5);
  expect(child.local.frame.details == synthetic);
  expect(nested.sent.screen_infos == physical); expect(nested.sent.emulated_screen_infos == synthetic);
  ChromeClientImpl client;
  expect(client.GetScreenInfo(child.local.frame).width == 1600);
  expect(client.GetScreenInfos(child.local.frame) == synthetic);
  WebRemoteFrameImpl nested_created;
  nested_created.InitializeFrameVisualProperties(&child, &child.view);
  expect(nested_created.frame.properties.screen_infos == physical);
  expect(nested_created.frame.properties.emulated_screen_infos == synthetic);
  child.local.frame.layout_zoom_factor = 2.5;
  expect(child.local.frame.DevicePixelRatio() == 1.875);
  child.local.frame.layout_zoom_factor = 2;

  // Native query invalidation and nested propagation on emulated-only changes.
  auto changed = synthetic; changed.screen_infos[0].device_scale_factor = 1.25;
  child.inherited_emulated_screen_infos_ = changed; child.DidUpdateSurfaceAndScreen(physical);
  expect(nested.sent.screen_infos == physical); expect(nested.sent.emulated_screen_infos == changed);
  expect(child.local.frame.DevicePixelRatio() == 1.25); expect(child.view.zoom_factor == 2);
  expect(child.view.popup_cancels == 0); expect(child.local.frame.document.media_changes == 2);
  changed.screen_infos[0].gamut = 2; child.inherited_emulated_screen_infos_ = changed;
  child.DidUpdateSurfaceAndScreen(physical);
  expect(child.local.frame.document.media_changes == 3);
  expect(nested.sent.emulated_screen_infos == changed);

  // Clearing emulation propagates a null override while retaining physical data.
  child.inherited_emulated_screen_infos_.reset(); child.DidUpdateSurfaceAndScreen(physical);
  expect(nested.sent.screen_infos == physical); expect(!nested.sent.emulated_screen_infos);
  expect(child.local.frame.details == physical); expect(child.local.frame.DevicePixelRatio() == 2);
  expect(child.view.popup_cancels == 0); expect(child.local.frame.document.media_changes == 4);
  child.DidUpdateSurfaceAndScreen(physical); expect(child.local.frame.document.media_changes == 4);
  expect(client.GetScreenInfo(child.local.frame).width == 1470);

  // A real display transition retains the upstream popup/compositor behavior.
  auto moved = physical; moved.screen_infos[0].device_scale_factor = 1;
  child.original = moved; child.storage.effective = moved;
  child.local.frame.layout_zoom_factor = 1; child.DidUpdateSurfaceAndScreen(physical);
  expect(child.view.popup_cancels == 1); expect(nested.sent.screen_infos == moved);
  expect(!nested.sent.emulated_screen_infos); expect(child.local.frame.DevicePixelRatio() == 1);
  LocalFrame detached; detached.page_ = nullptr; expect(detached.DevicePixelRatio() == 0);
  std::cout << "PASS " << checks << " OOPIF source-method checks (interface shim; not browser runtime)\n";
}
