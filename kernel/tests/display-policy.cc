// Copyright 2026 Star Browser contributors
// SPDX-License-Identifier: BSD-3-Clause
#include "star_display_policy.h"
#include <iostream>
#include <string>
#include <vector>

struct Rect {
  int x = 0, y = 0, width = 0, height = 0;
  void set_width(int value) { width = value; }
  void set_height(int value) { height = value; }
  bool operator==(const Rect&) const = default;
};
enum class Orientation { kLandscapePrimary, kPortraitPrimary };
struct Info {
  Rect rect, available_rect;
  float device_scale_factor = 1.5f;
  int depth = 30, depth_per_component = 10, orientation_angle = 90;
  bool is_monochrome = true;
  Orientation orientation_type = Orientation::kPortraitPrimary;
  int display_id = 19;
  std::string color_space = "native-P3", label = "native-display";
  bool operator==(const Info&) const = default;
};
struct Infos {
  std::vector<Info> screen_infos;
  int current_display_id = 19;
  bool operator==(const Infos&) const = default;
};
int main() {
  unsigned checks = 0;
  for (const auto width : {320, 900, 1600, 16384}) {
    for (const auto height : {320, 900, 1600, 16384}) {
      for (const auto depth : {24, 30}) {
        const auto policy = content::star::ParseDisplayPolicy(
            std::to_string(width) + "," + std::to_string(height) + "," +
            std::to_string(width) + "," + std::to_string(height - 20) + "," +
            std::to_string(depth));
        if (!policy || policy->width != width || policy->height != height ||
            policy->depth != depth) { std::cerr << "valid display rejected\n"; return 1; }
        ++checks;
      }
    }
  }
  for (const std::string input : {
      "", "1600,900", ",900,1600,860,24", "01600,900,1600,860,24",
      "1600,0900,1600,860,24", "1600,900,01600,860,24", "1600,900,1600,0860,24",
      "1600,900,1600,860,024", "1600,900,1600,860,24,1", "1600,900,1600,860,24,",
      "1600,900,1600,860,24 ", "1600,900,1600,860,24\n", " 1600,900,1600,860,24",
      "1600,900,1600,860,24x", "1600,900,1600,860,+24", "1600,900,1600,860,-24",
      "1600,900,1600,860,NaN", "1600,900,1600,860,32", "1600,900,1600,860,0",
      "319,900,319,860,24", "1600,319,1600,299,24", "16385,900,1600,860,24",
      "1600,16385,1600,860,24", "1600,900,1601,860,24", "1600,900,1600,901,24",
      "1600,900,0,860,24", "1600,900,1600,0,24", "1600,900,1600,,24",
      "1.6e3,900,1600,860,24", "0x640,900,1600,860,24"}) {
    if (content::star::ParseDisplayPolicy(input)) { std::cerr << "invalid display accepted\n"; return 1; }
    ++checks;
  }
  if (content::star::ParseDisplayPolicy(std::string(65536, '9')) ||
      content::star::ParseDisplayPolicy(std::string("1600,900,1600,860,24\0tail", 24))) return 1;
  checks += 2;
  const auto policy = *content::star::ParseDisplayPolicy("1600,900,1600,860,24");
  Infos native{{{{-800, 25, 1470, 956}, {-800, 50, 1470, 880}},
                {{670, 0, 1920, 1080}, {670, 0, 1920, 1040}}}};
  const auto original = native;
  const auto effective = content::star::ApplyDisplayPolicy(native, policy);
  if (native != original || effective.screen_infos.size() != native.screen_infos.size() ||
      effective.current_display_id != native.current_display_id) return 1;
  ++checks;
  for (size_t index = 0; index < native.screen_infos.size(); ++index) {
    const auto& old = native.screen_infos[index];
    const auto& value = effective.screen_infos[index];
    if (value.rect.x != old.rect.x || value.rect.y != old.rect.y ||
        value.rect.width != 1600 || value.rect.height != 900 ||
        value.available_rect.width != 1600 || value.available_rect.height != 860 ||
        value.available_rect.x != value.rect.x || value.available_rect.y != value.rect.y ||
        value.device_scale_factor != old.device_scale_factor || value.display_id != old.display_id ||
        value.label != old.label || value.color_space != old.color_space ||
        value.depth != 24 || value.depth_per_component != 8 || value.is_monochrome ||
        value.orientation_type != Orientation::kLandscapePrimary || value.orientation_angle != 0) return 1;
    ++checks;
  }
  if (content::star::ApplyDisplayPolicy(effective, policy) != effective) return 1;
  ++checks;
  const auto portrait = content::star::ApplyDisplayPolicy(native,
      *content::star::ParseDisplayPolicy("900,1600,900,1550,30"));
  if (portrait.screen_infos[0].orientation_type != Orientation::kPortraitPrimary ||
      portrait.screen_infos[0].depth_per_component != 10) return 1;
  ++checks;
  std::cout << "PASS " << checks << " display policy checks (standalone only)\n";
}
