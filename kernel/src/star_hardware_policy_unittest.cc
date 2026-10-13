// Copyright 2026 Star Browser contributors
// SPDX-License-Identifier: BSD-3-Clause
#include "third_party/blink/public/common/fingerprinting/star_hardware_policy.h"

#include "testing/gtest/include/gtest/gtest.h"

namespace blink::star {

TEST(StarHardwarePolicyTest, ParsesDesktopPersona) {
  const auto policy = ParseHardwarePolicy("12,8");
  ASSERT_TRUE(policy);
  EXPECT_EQ(policy->concurrency, 12u);
  EXPECT_FLOAT_EQ(policy->memory_gb, 8.0f);
}

TEST(StarHardwarePolicyTest, RejectsInvalidPersonaAtomically) {
  for (const auto* value : {"", "4", "0,4", "65,4", "04,4", "-4,4",
                           "4,0", "4,16", "4,4.0", "4,4,4", "4,4 "}) {
    EXPECT_FALSE(ParseHardwarePolicy(value)) << value;
  }
}

}  // namespace blink::star
