"""Compile patched native methods with shims and inspect the IPC wiring.

This deliberately reports source preparation, never native browser acceptance.
"""
from pathlib import Path
import subprocess
import tempfile


def method(source, signature):
    start = source.find(signature)
    if start < 0:
        raise RuntimeError('Missing Chromium method: ' + signature)
    opening = source.index('{', start)
    depth = 1
    end = opening + 1
    while depth:
        if source[end] == '{':
            depth += 1
        elif source[end] == '}':
            depth -= 1
        end += 1
    return source[start:end]


def verify_wiring(source):
    checks = []
    def check(path, text):
        if text not in (source / path).read_text():
            raise RuntimeError('Missing OOPIF wiring in ' + path + ': ' + text)
        checks.append(path)
    for group, typename in [('frame', 'FrameVisualProperties'), ('widget', 'VisualProperties')]:
        check('third_party/blink/public/mojom/' + group + '/' +
              ('frame_visual_properties' if group == 'frame' else 'visual_properties') + '.mojom',
              'display.mojom.ScreenInfos? emulated_screen_infos;')
        basename = 'frame_visual_properties' if group == 'frame' else 'visual_properties'
        check('third_party/blink/public/common/' + group + '/' + basename + '.h',
              'std::optional<display::ScreenInfos> emulated_screen_infos;')
        check('third_party/blink/public/common/' + group + '/' + basename + '_mojom_traits.h',
              'return r.emulated_screen_infos;')
        check('third_party/blink/common/' + group + '/' + basename + '_mojom_traits.cc',
              '!data.ReadEmulatedScreenInfos(&out->emulated_screen_infos)')
    check('third_party/blink/common/widget/visual_properties.cc',
          'emulated_screen_infos == other.emulated_screen_infos')
    check('third_party/blink/renderer/core/frame/remote_frame.cc',
          'sent_visual_properties_->emulated_screen_infos !=\n          pending_visual_properties_.emulated_screen_infos')
    check('content/browser/renderer_host/cross_process_frame_connector.cc',
          'visual_properties.root_widget_viewport_segments,\n      visual_properties.emulated_screen_infos)')
    host = 'content/browser/renderer_host/render_widget_host_impl.cc'
    check(host, 'visual_properties.screen_infos = GetScreenInfos();')
    check(host, 'visual_properties.emulated_screen_infos =\n      properties_from_parent_local_root_.emulated_screen_infos')
    check(host, 'old_visual_properties->emulated_screen_infos !=\n             new_visual_properties.emulated_screen_infos')
    check(host, 'properties_from_parent_local_root_.emulated_screen_infos =\n      emulated_screen_infos')
    widget = 'third_party/blink/renderer/core/frame/web_frame_widget_impl.cc'
    check(widget, 'inherited_emulated_screen_infos_ = visual_properties.emulated_screen_infos;')
    check(widget, 'new_compositor_viewport_pixel_rect, visual_properties.screen_infos)')
    return len(checks)


def verify(source, compiler):
    root = Path(__file__).resolve().parents[1]
    frame = source / 'third_party/blink/renderer/core/frame'
    widget_source = (frame / 'web_frame_widget_impl.cc').read_text()
    methods = [method(widget_source, signature) for signature in [
        'const display::ScreenInfos& WebFrameWidgetImpl::GetWebExposedScreenInfos()',
        'std::optional<display::ScreenInfos> WebFrameWidgetImpl::GetEmulatedScreenInfos()',
        'void WebFrameWidgetImpl::DidUpdateSurfaceAndScreen(']]
    remote = method((frame / 'web_remote_frame_impl.cc').read_text(),
                    'void WebRemoteFrameImpl::InitializeFrameVisualProperties(')
    remote = remote.replace('WebView* web_view)', 'WebView*)')
    methods.extend([remote,
        method((frame / 'remote_frame.cc').read_text(), 'void RemoteFrame::DidChangeScreenInfos('),
        method((frame / 'local_frame.cc').read_text(), 'double LocalFrame::DevicePixelRatio() const'),
    ])
    chrome_client = (source / 'third_party/blink/renderer/core/page/chrome_client_impl.cc').read_text()
    methods.extend(method(chrome_client, signature) for signature in [
        'const display::ScreenInfo& ChromeClientImpl::GetScreenInfo(',
        'const display::ScreenInfos& ChromeClientImpl::GetScreenInfos('])
    fixture = (root / 'tests/oopif-source-check.cc').read_text()
    wiring_count = verify_wiring(source)
    with tempfile.TemporaryDirectory(prefix='star-oopif-source-') as temporary:
        file = Path(temporary) / 'source-check.cc'
        binary = Path(temporary) / 'source-check'
        file.write_text(fixture.replace('// ACTUAL_METHODS', '\n'.join(methods)))
        subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror',
                        str(file), '-o', str(binary)], check=True, timeout=30)
        result = subprocess.run([str(binary)], check=True, text=True,
                                capture_output=True, timeout=10).stdout.strip()
        return result + '\nPASS ' + str(wiring_count) + ' source IPC wiring checks'
