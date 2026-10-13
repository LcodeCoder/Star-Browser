// Copyright 2026 Star Browser contributors
// SPDX-License-Identifier: BSD-3-Clause
#include "content/browser/renderer_host/star_display_policy.h"

#include "testing/gtest/include/gtest/gtest.h"
#include "ui/display/screen_infos.h"

namespace content::star {

TEST(StarDisplayPolicyTest, StrictAtomicParsing) {
  const auto policy = ParseDisplayPolicy("1600,900,1600,860,24");
  ASSERT_TRUE(policy);
  EXPECT_EQ(1600, policy->width);
  EXPECT_EQ(860, policy->available_height);
  EXPECT_FALSE(ParseDisplayPolicy("1600,900,1600,901,24"));
  EXPECT_FALSE(ParseDisplayPolicy("1600,900,1600,860,24,1"));
  EXPECT_FALSE(ParseDisplayPolicy("01600,900,1600,860,24"));
  EXPECT_FALSE(ParseDisplayPolicy("1600,900,1600,860,24 "));
  EXPECT_FALSE(ParseDisplayPolicy("1600,900,0,860,24"));
}

TEST(StarDisplayPolicyTest, CopiesMetadataPreservesPhysicalStateAndScale) {
  display::ScreenInfo screen;
  screen.rect = gfx::Rect(-800, 0, 1470, 956);
  screen.available_rect = gfx::Rect(-800, 25, 1470, 900);
  screen.device_scale_factor = 1.5f;
  screen.display_id = 7;
  screen.depth = 30;
  const display::ScreenInfos native(screen);
  const auto policy = ParseDisplayPolicy("1600,900,1600,860,24");
  ASSERT_TRUE(policy);
  const auto effective = ApplyDisplayPolicy(native, *policy);
  EXPECT_EQ(gfx::Rect(-800, 0, 1600, 900), effective.current().rect);
  EXPECT_EQ(gfx::Rect(-800, 0, 1600, 860), effective.current().available_rect);
  EXPECT_EQ(1.5f, effective.current().device_scale_factor);
  EXPECT_EQ(7, effective.current().display_id);
  EXPECT_EQ(24, effective.current().depth);
  EXPECT_EQ(8, effective.current().depth_per_component);
  EXPECT_EQ(gfx::Rect(-800, 0, 1470, 956), native.current().rect);
  EXPECT_EQ(30, native.current().depth);
}

TEST(StarDisplayPolicyTest, AllWidgetsReceiveSameDimensions) {
  display::ScreenInfo screen;
  screen.display_id = 9;
  display::ScreenInfos parent(screen);
  const auto policy = ParseDisplayPolicy("900,1600,900,1550,30");
  ASSERT_TRUE(policy);
  const auto parent_effective = ApplyDisplayPolicy(parent, *policy);
  const auto child_effective = ApplyDisplayPolicy(parent_effective, *policy);
  EXPECT_EQ(parent_effective, child_effective);
  EXPECT_EQ(display::mojom::ScreenOrientation::kPortraitPrimary,
            child_effective.current().orientation_type);
  EXPECT_EQ(0, child_effective.current().orientation_angle);
  EXPECT_EQ(10, child_effective.current().depth_per_component);
}

}  // namespace content::star
