// Copyright 2026 Star Browser contributors
// SPDX-License-Identifier: BSD-3-Clause
#ifndef THIRD_PARTY_BLINK_PUBLIC_COMMON_FINGERPRINTING_STAR_HARDWARE_POLICY_H_
#define THIRD_PARTY_BLINK_PUBLIC_COMMON_FINGERPRINTING_STAR_HARDWARE_POLICY_H_

#include <charconv>
#include <optional>
#include <string_view>
#include <system_error>

namespace blink::star {

inline constexpr char kHardwareSwitch[] = "star-fingerprint-hardware";

struct HardwarePolicy {
  unsigned concurrency;
  float memory_gb;
};

// One atomic CPU/RAM value prevents partially applying an invalid persona.
// Only device-memory buckets supported by Star's desktop profiles are accepted.
inline std::optional<HardwarePolicy> ParseHardwarePolicy(std::string_view value) {
  const auto comma = value.find(',');
  if (comma == std::string_view::npos || comma == 0 || comma > 2) {
    return std::nullopt;
  }
  const auto cpu = value.substr(0, comma);
  if (cpu.front() < '1' || cpu.front() > '9') {
    return std::nullopt;
  }
  unsigned concurrency = 0;
  const auto parsed = std::from_chars(cpu.data(), cpu.data() + cpu.size(),
                                      concurrency);
  if (parsed.ec != std::errc() || parsed.ptr != cpu.data() + cpu.size() ||
      concurrency == 0 || concurrency > 64) {
    return std::nullopt;
  }
  const auto memory = value.substr(comma + 1);
  const float memory_gb = memory == "2" ? 2.0f : memory == "4" ? 4.0f :
                          memory == "8" ? 8.0f : 0.0f;
  if (memory_gb == 0.0f) {
    return std::nullopt;
  }
  return HardwarePolicy{concurrency, memory_gb};
}

}  // namespace blink::star

#endif  // THIRD_PARTY_BLINK_PUBLIC_COMMON_FINGERPRINTING_STAR_HARDWARE_POLICY_H_
