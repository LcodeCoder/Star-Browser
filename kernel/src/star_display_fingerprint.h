// Copyright 2026 Star Browser contributors
// SPDX-License-Identifier: BSD-3-Clause
#ifndef CONTENT_BROWSER_RENDERER_HOST_STAR_DISPLAY_FINGERPRINT_H_
#define CONTENT_BROWSER_RENDERER_HOST_STAR_DISPLAY_FINGERPRINT_H_

#include "base/command_line.h"
#include "content/browser/renderer_host/star_display_policy.h"

namespace content::star {

inline const std::optional<DisplayPolicy>& GetDisplayPolicy() {
  static const auto policy = ParseDisplayPolicy(
      base::CommandLine::ForCurrentProcess()->GetSwitchValueASCII(kDisplaySwitch));
  return policy;
}

}  // namespace content::star

#endif  // CONTENT_BROWSER_RENDERER_HOST_STAR_DISPLAY_FINGERPRINT_H_
