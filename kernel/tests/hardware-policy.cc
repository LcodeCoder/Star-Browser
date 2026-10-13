// Copyright 2026 Star Browser contributors
// SPDX-License-Identifier: BSD-3-Clause
#include "star_hardware_policy.h"

#include <iostream>
#include <string>

int main() {
  unsigned checks = 0;
  for (const auto cpu : {1u, 2u, 4u, 8u, 12u, 16u, 24u, 32u, 64u}) {
    for (const auto memory : {2u, 4u, 8u}) {
      const auto value = blink::star::ParseHardwarePolicy(
          std::to_string(cpu) + "," + std::to_string(memory));
      if (!value || value->concurrency != cpu || value->memory_gb != memory) {
        std::cerr << "valid policy rejected\n";
        return 1;
      }
      ++checks;
    }
  }
  for (const std::string input : {
           "", "4", ",4", "4,", "0,4", "65,4", "-4,4", "+4,4", "04,4",
           "4.0,4", " 4,4", "4 ,4", "4, 4", "4,04", "4,4.0", "4,16",
           "4,0", "4,-4", "4,NaN", "4,Inf", "4,4,4", "4,4x",
           "999999999999999999999999,4", "4\n,4", "4,4\n"}) {
    if (blink::star::ParseHardwarePolicy(input)) {
      std::cerr << "invalid policy accepted: " << input << '\n';
      return 1;
    }
    ++checks;
  }
  const std::string embedded_nul("4,4\0suffix", 10);
  if (blink::star::ParseHardwarePolicy(embedded_nul)) {
    std::cerr << "embedded NUL accepted\n";
    return 1;
  }
  // Include oversized hostile input: no truncation, partial parse or overflow.
  if (blink::star::ParseHardwarePolicy(std::string(65536, '9') + ",4")) {
    std::cerr << "oversized policy accepted\n";
    return 1;
  }
  std::cout << "PASS " << checks + 2 << " native policy checks\n";
}
