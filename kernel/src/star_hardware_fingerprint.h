// Copyright 2026 Star Browser contributors
// SPDX-License-Identifier: BSD-3-Clause
#ifndef THIRD_PARTY_BLINK_PUBLIC_COMMON_FINGERPRINTING_STAR_HARDWARE_FINGERPRINT_H_
#define THIRD_PARTY_BLINK_PUBLIC_COMMON_FINGERPRINTING_STAR_HARDWARE_FINGERPRINT_H_

#include "base/command_line.h"
#include "third_party/blink/public/common/fingerprinting/star_hardware_policy.h"

namespace blink::star {

inline const std::optional<HardwarePolicy>& GetHardwarePolicy() {
  // Browser switches are fixed before Blink initialization. The immutable value
  // is shared by the browser's Client Hints and every window/worker renderer.
  static const auto policy = ParseHardwarePolicy(
      base::CommandLine::ForCurrentProcess()->GetSwitchValueASCII(kHardwareSwitch));
  return policy;
}

}  // namespace blink::star

#endif  // THIRD_PARTY_BLINK_PUBLIC_COMMON_FINGERPRINTING_STAR_HARDWARE_FINGERPRINT_H_
