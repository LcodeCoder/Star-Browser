// Copyright 2026 Star Browser contributors
// SPDX-License-Identifier: BSD-3-Clause
#ifndef CONTENT_BROWSER_RENDERER_HOST_STAR_DISPLAY_POLICY_H_
#define CONTENT_BROWSER_RENDERER_HOST_STAR_DISPLAY_POLICY_H_

#include <array>
#include <charconv>
#include <optional>
#include <string_view>
#include <system_error>

namespace content::star {

inline constexpr char kDisplaySwitch[] = "star-fingerprint-display";

struct DisplayPolicy {
  int width;
  int height;
  int available_width;
  int available_height;
  int depth;
};

// CSS-pixel dimensions are atomic. No trimming, truncation or partial parsing.
// The scale factor is configured through Chromium's existing native switch.
inline std::optional<DisplayPolicy> ParseDisplayPolicy(std::string_view value) {
  if (value.size() > 32) {
    return std::nullopt;
  }
  std::array<int, 5> parts{};
  for (size_t index = 0; index < parts.size(); ++index) {
    const auto comma = value.find(',');
    if ((index + 1 < parts.size()) != (comma != std::string_view::npos)) {
      return std::nullopt;
    }
    const auto part = value.substr(0, comma);
    if (part.empty() || part.front() < '1' || part.front() > '9') {
      return std::nullopt;
    }
    const auto result = std::from_chars(part.data(), part.data() + part.size(),
                                        parts[index]);
    if (result.ec != std::errc() || result.ptr != part.data() + part.size()) {
      return std::nullopt;
    }
    if (comma != std::string_view::npos) {
      value.remove_prefix(comma + 1);
    }
  }
  if (parts[0] < 320 || parts[1] < 320 || parts[0] > 16384 || parts[1] > 16384 ||
      parts[2] > parts[0] || parts[3] > parts[1] ||
      (parts[4] != 24 && parts[4] != 30)) {
    return std::nullopt;
  }
  return DisplayPolicy{parts[0], parts[1], parts[2], parts[3], parts[4]};
}

// Share this transformation with a dependency-free test. ScreenInfos is copied:
// physical display state, widget dimensions and browser UI geometry stay native.
// Monitor identity, origins, topology, color spaces and scaling are preserved.
// This bounded policy changes only web-visible dimensions, depth and orientation.
template <typename ScreenInfos>
inline ScreenInfos ApplyDisplayPolicy(ScreenInfos infos,
                                      const DisplayPolicy& policy) {
  for (auto& info : infos.screen_infos) {
    info.rect.set_width(policy.width);
    info.rect.set_height(policy.height);
    info.available_rect = info.rect;
    info.available_rect.set_width(policy.available_width);
    info.available_rect.set_height(policy.available_height);
    info.depth = policy.depth;
    info.depth_per_component = policy.depth / 3;
    info.is_monochrome = false;
    using Orientation = decltype(info.orientation_type);
    info.orientation_type = policy.width >= policy.height
                                ? Orientation::kLandscapePrimary
                                : Orientation::kPortraitPrimary;
    info.orientation_angle = 0;
  }
  return infos;
}

}  // namespace content::star

#endif  // CONTENT_BROWSER_RENDERER_HOST_STAR_DISPLAY_POLICY_H_
