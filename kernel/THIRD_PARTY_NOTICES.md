# Native kernel sources and references

The patches apply to the pinned Chromium source. Chromium and its dependencies retain their original licenses and copyright notices. The native CI staging process includes Chromium's LICENSE; generated browser resources and dependency notices must remain with the runtime.

Star's added policy files carry BSD-3-Clause headers. The OOPIF changes use a separate optional web-exposed screen state while retaining Chromium's physical widget state.

The implementation was informed by public screen/OOPIF analyses and patches in Simprint/schromix (commit c3790fe987af8c949d67d60879b15631ac0df7d6) and Chromium's historical device-emulation revert (commit 33ce7de78d85aacdb69bc5e122b9e86e53e1a696). The schromix attribution and full license are retained below. This does not imply that its publisher validated this browser, or that its published binaries contain this patch.

The AGPL Simprint desktop and m144 kernel sources were reviewed as references; their source code was not copied into this patch bundle.

## schromix reference license

BSD 3-Clause License

Copyright (c) 2026, xiaozhou26
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
