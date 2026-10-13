#!/usr/bin/env python3
"""Pinned Chromium patch preparation and native builds; no binary acceptance claims."""
import argparse
import base64
import concurrent.futures
import hashlib
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
LOCK = json.loads((ROOT / 'chromium.lock.json').read_text())


def digest(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def run(args, cwd=None, capture=False):
    return subprocess.run([str(value) for value in args], cwd=cwd, check=True,
                          text=True, capture_output=capture,
                          timeout=30 if capture else None)


def checked_assets():
    for item in LOCK['overlays']:
        if digest(ROOT / item['source']) != item['sha256']:
            raise RuntimeError('Overlay hash mismatch: ' + item['source'])
    for item in LOCK['patches']:
        if digest(ROOT / item['path']) != item['sha256']:
            raise RuntimeError('Patch hash mismatch: ' + item['path'])


def apply(source, verify_revision=True):
    checked_assets()
    if verify_revision:
        revision = run(['git', 'rev-parse', 'HEAD'], source, True).stdout.strip()
        if revision != LOCK['commit']:
            raise RuntimeError('Chromium HEAD must be ' + LOCK['commit'])
    # Verify every affected file before modifying any source.
    for item in LOCK['upstreamFiles']:
        target = source / item['path']
        if not target.is_file() or digest(target) != item['sha256']:
            raise RuntimeError('Upstream file differs: ' + item['path'])
    for item in LOCK['overlays']:
        if (source / item['target']).exists():
            raise RuntimeError('Overlay destination already exists: ' + item['target'])
    patches = [ROOT / item['path'] for item in LOCK['patches']]
    run(['git', 'apply', '--check', *patches], source)
    run(['git', 'apply', *patches], source)
    for item in LOCK['overlays']:
        target = source / item['target']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / item['source'], target)
    (source / '.star-kernel-applied.json').write_text(json.dumps(LOCK, indent=2) + '\n')


def native_policy_test(source=None):
    compiler = os.environ.get('CXX') or shutil.which('clang++') or shutil.which('g++')
    if not compiler:
        raise RuntimeError('A C++20 compiler is required for the standalone policy test')
    with tempfile.TemporaryDirectory(prefix='star-native-policy-') as temp:
        include = ROOT / 'src'
        if source:
            include = source / 'third_party/blink/public/common/fingerprinting'
        results = []
        for name, test_include in [('hardware', include), ('display',
                source / 'content/browser/renderer_host' if source else ROOT / 'src')]:
            binary = Path(temp) / (name + '-policy-test')
            run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror',
                 '-I' + str(test_include), ROOT / ('tests/' + name + '-policy.cc'), '-o', binary])
            results.append(run([binary], capture=True).stdout.strip())
        return '\n'.join(results)


def verify_patch_bundle():
    # Fetch only the pinned files touched by the patch, not a full Chromium tree.
    checked_assets()
    with tempfile.TemporaryDirectory(prefix='star-kernel-patch-check-') as temp:
        source = Path(temp)
        def fetch(item):
            data, provider = fetch_pinned_file(item)
            target = source / item['path']
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            return provider
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            providers = list(pool.map(fetch, LOCK['upstreamFiles']))
        apply(source, verify_revision=False)
        result = native_policy_test(source)
        return {'status': 'patch-preparation-verified', 'version': LOCK['version'],
                'sourceCommit': LOCK['commit'], 'upstreamFiles': len(LOCK['upstreamFiles']),
                'overlays': len(LOCK['overlays']), 'policyTest': result,
                'sourceProviders': {provider: providers.count(provider) for provider in sorted(set(providers))},
                'compiledChromium': False, 'p0Complete': False}



def request_bytes(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'Star-Browser-kernel'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                data = response.read(8 * 1024 * 1024 + 1)
            if len(data) > 8 * 1024 * 1024:
                raise RuntimeError('Upstream response exceeds 8 MiB')
            return data
        except (urllib.error.URLError, TimeoutError) as error:
            if isinstance(error, urllib.error.HTTPError) and error.code not in [408, 429, 500, 502, 503, 504]:
                raise
            if attempt == 2:
                raise
            delay = 1 + attempt
            try:
                delay = min(5, max(delay, float(getattr(error, 'headers', {}).get('Retry-After', 0))))
            except (AttributeError, TypeError, ValueError):
                pass
            time.sleep(delay)


def fetch_pinned_file(item):
    cache = os.environ.get('STAR_KERNEL_CACHE')
    target = Path(cache) / item['sha256'] if cache else None
    if target and target.is_file() and not target.is_symlink():
        with target.open('rb') as stream:
            cached = stream.read(8 * 1024 * 1024 + 1)
        if len(cached) <= 8 * 1024 * 1024 and hashlib.sha256(cached).hexdigest() == item['sha256']:
            return cached, 'verified-cache'
    url = ('https://raw.githubusercontent.com/chromium/chromium/' +
           LOCK['commit'] + '/' + urllib.parse.quote(item['path'], safe='/'))
    try:
        data = request_bytes(url)
        provider = 'github-mirror'
    except (urllib.error.URLError, TimeoutError):
        data = fetch_revision_file(LOCK['commit'], item['path'])
        provider = 'chromium-gitiles'
    if hashlib.sha256(data).hexdigest() != item['sha256']:
        raise RuntimeError('Downloaded source hash mismatch: ' + item['path'])
    if target:
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=target.parent, prefix='.star-upstream-', delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(data)
            temporary.replace(target)
        finally:
            if temporary and temporary.exists():
                temporary.unlink()
    return data, provider


def resolve_revision(ref):
    ref = str(ref).strip()
    if re.fullmatch(r'[0-9a-fA-F]{40}', ref):
        return ref.lower()
    if not ref or len(ref) > 240 or not re.fullmatch(r'[a-zA-Z0-9_./-]+', ref):
        raise ValueError('Use a Chromium commit SHA, branch or tag name')
    url = LOCK['repository'].removesuffix('.git') + '/+/' + urllib.parse.quote(ref, safe='/') + '?format=JSON'
    text = request_bytes(url).decode('utf-8')
    if text.startswith(")]}'"):
        text = text.split('\n', 1)[1]
    revision = json.loads(text).get('commit')
    if not revision or not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise RuntimeError('Upstream did not return an immutable Chromium commit')
    return revision


def fetch_revision_file(revision, relative_path, optional=False):
    url = (LOCK['repository'].removesuffix('.git') + '/+/' + revision + '/' +
           urllib.parse.quote(relative_path, safe='/') + '?format=TEXT')
    try:
        encoded = request_bytes(url)
    except urllib.error.HTTPError as error:
        if optional and error.code == 404:
            return None
        raise
    return base64.b64decode(b''.join(encoded.split()), validate=True)


def check_compatibility(source=None, ref=None):
    """Only copy/read affected files and run git apply --check in a temporary tree."""
    checked_assets()
    revision = (run(['git', 'rev-parse', 'HEAD'], source, True).stdout.strip()
                if source else resolve_revision(ref or LOCK['commit']))
    report = {
        'schemaVersion': 1, 'checkedAt': datetime.now(timezone.utc).isoformat(),
        'pinnedVersion': LOCK['version'], 'pinnedCommit': LOCK['commit'],
        'candidateCommit': revision, 'requestedRef': ref,
        'sourceKind': 'working-tree' if source else 'upstream-commit',
        'sourceModified': False, 'readOnly': True,
        'compiledChromium': False, 'p0Complete': False,
    }
    watched_paths = [item['path'] for item in LOCK['upstreamFiles']]
    overlay_paths = [item['target'] for item in LOCK['overlays']]
    if source:
        status = run(['git', 'status', '--porcelain', '--', *watched_paths, *overlay_paths], source, True)
        report['sourceModified'] = bool(status.stdout.strip())
    with tempfile.TemporaryDirectory(prefix='star-kernel-compatibility-') as temp:
        candidate = Path(temp)
        def inspect(item):
            path = item['path']
            value = {'path': path, 'pinnedSha256': item['sha256']}
            try:
                data = (source / path).read_bytes() if source else fetch_revision_file(revision, path)
                value.update(sha256=hashlib.sha256(data).hexdigest(), size=len(data))
                value['changed'] = value['sha256'] != item['sha256']
                target = candidate / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
            except (OSError, RuntimeError, ValueError) as error:
                value['error'] = str(error)
            return value
        def inspect_overlay(path):
            try:
                exists = (source / path).exists() if source else fetch_revision_file(revision, path, optional=True) is not None
                return {'path': path, 'exists': exists}
            except (OSError, RuntimeError, ValueError) as error:
                return {'path': path, 'error': str(error)}
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            files = list(pool.map(inspect, LOCK['upstreamFiles']))
            overlays = list(pool.map(inspect_overlay, overlay_paths))
        report['files'] = files
        report['changedFiles'] = [item['path'] for item in files if item.get('changed')]
        report['overlayCollisions'] = [item['path'] for item in overlays if item.get('exists')]
        report['unavailableFiles'] = [item for item in files + overlays if item.get('error')]
        version_path = candidate / 'chrome/VERSION'
        if version_path.is_file():
            fields = dict(line.split('=', 1) for line in version_path.read_text().splitlines() if '=' in line)
            report['candidateVersion'] = '.'.join(fields.get(key, '?') for key in ['MAJOR', 'MINOR', 'BUILD', 'PATCH'])
        if report['unavailableFiles']:
            report.update(status='source-unavailable', patchApplies=None, conflictingFiles=[])
            return report
        check = subprocess.run(['git', 'apply', '--check', '--verbose',
                                *[str(ROOT / item['path']) for item in LOCK['patches']]],
                               cwd=candidate, text=True, capture_output=True, timeout=30)
        report['patchCheck'] = {'exitCode': check.returncode, 'output': (check.stdout + check.stderr)[-32000:]}
        conflicts = re.findall(r'^error: (?:patch failed: )?(.+?)(?::\d+|: patch does not apply|: already exists in working directory)$', check.stderr, re.M)
        report['conflictingFiles'] = sorted(set(conflicts + report['overlayCollisions']))
        report['patchApplies'] = check.returncode == 0 and not report['overlayCollisions']
        report['status'] = 'source-compatible' if report['patchApplies'] else 'patch-conflict'
        if report['sourceModified'] and report['patchApplies']:
            report['status'] = 'source-compatible-with-local-changes'
        return report


def tool(name, source=None):
    found = shutil.which(name)
    if found:
        return found
    if name == 'gn' and source:
        directory = {'Darwin': 'mac', 'Windows': 'win', 'Linux': 'linux64'}.get(platform.system())
        candidate = source / 'buildtools' / directory / ('gn.exe' if os.name == 'nt' else 'gn')
        if candidate.is_file():
            return str(candidate)
    return None


def preflight(source, arch):
    blockers = []
    found = {name: tool(name, source) for name in ['git', 'gn', 'autoninja']}
    for name, value in found.items():
        if not value:
            blockers.append('Missing tool: ' + name)
    developer = None
    sdk = None
    if sys.platform == 'darwin':
        try:
            developer = run(['xcode-select', '-p'], capture=True).stdout.strip()
            run(['xcodebuild', '-version'], capture=True)
            sdk = run(['xcrun', '--show-sdk-version'], capture=True).stdout.strip()
        except (subprocess.CalledProcessError, OSError):
            blockers.append('Full Xcode with an active developer directory is required; Command Line Tools alone were found')
    elif sys.platform == 'win32':
        if not os.environ.get('VSINSTALLDIR'):
            blockers.append('Run in a Visual Studio 2022 developer shell with the Windows SDK')
    else:
        blockers.append('This initial build entry targets native Windows/macOS hosts')
    current_arch = 'arm64' if platform.machine().lower() in ['arm64', 'aarch64'] else 'x64'
    if arch != current_arch:
        blockers.append('Use a native ' + arch + ' host for build and runtime acceptance')
    if not source or not (source / '.gn').is_file():
        blockers.append('A complete pinned Chromium checkout with gclient dependencies is required')
    volume = source if source and source.exists() else ROOT
    free = shutil.disk_usage(volume).free // (1024 ** 3)
    if free < 120:
        blockers.append('At least 120 GiB free is required for this build entry')
    return {'status': 'ready' if not blockers else 'blocked', 'platform': sys.platform,
            'architecture': current_arch, 'targetArchitecture': arch, 'tools': found,
            'developerDirectory': developer, 'sdk': sdk, 'freeGiB': free,
            'blockers': blockers, 'p0Complete': False}


def build(source, arch, jobs):
    environment = preflight(source, arch)
    if environment['blockers']:
        print(json.dumps(environment, indent=2))
        return 2
    checked_assets()
    if json.loads((source / '.star-kernel-applied.json').read_text()) != LOCK:
        raise RuntimeError('Apply this exact patch lock before building')
    run(['git', 'apply', '--reverse', '--check',
         *[ROOT / item['path'] for item in LOCK['patches']]], source)
    for item in LOCK['overlays']:
        if digest(source / item['target']) != item['sha256']:
            raise RuntimeError('Modified overlay: ' + item['target'])
    out = 'out/Star-native-' + arch
    args = ('is_debug=false is_component_build=false is_official_build=false '
            'symbol_level=0 blink_symbol_level=0 v8_symbol_level=0 '
            'use_remoteexec=false target_cpu="' + arch + '"')
    if sys.platform == 'darwin':
        args += ' use_system_xcode=true'
    run([environment['tools']['gn'], 'gen', out, '--args=' + args, '--check'], source)
    run([environment['tools']['autoninja'], '-C', out, '-j' + str(jobs),
         'chrome', 'blink_common_unittests', 'content_unittests'], source)
    suffix = '.exe' if sys.platform == 'win32' else ''
    run([source / out / ('blink_common_unittests' + suffix),
         '--gtest_filter=StarHardwarePolicyTest.*'], source)
    run([source / out / ('content_unittests' + suffix),
         '--gtest_filter=StarDisplayPolicyTest.*'], source)
    print(json.dumps({'status': 'compiled-awaiting-runtime-acceptance',
                      'output': str(source / out), 'sourceCommit': LOCK['commit'],
                      'gnArgs': args, 'p0Complete': False}, indent=2))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['preflight', 'verify-patches', 'check-compatibility', 'test-policy', 'apply', 'build'])
    parser.add_argument('--source', type=Path)
    parser.add_argument('--ref', help='Chromium commit, branch or tag to inspect without a checkout')
    parser.add_argument('--arch', choices=['arm64', 'x64'],
                        default='arm64' if platform.machine().lower() in ['arm64', 'aarch64'] else 'x64')
    parser.add_argument('--jobs', type=int, default=4)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.source:
        args.source = args.source.resolve()
    if args.command in ['apply', 'build'] and not args.source:
        parser.error('--source is required')
    if args.ref and (args.command != 'check-compatibility' or args.source):
        parser.error('--ref is only used for remote check-compatibility; --source checks its working tree')
    if args.jobs < 1 or args.jobs > 64:
        parser.error('--jobs must be 1..64')
    result = None
    code = 0
    if args.command == 'preflight':
        result = preflight(args.source, args.arch)
        code = 0 if result['status'] == 'ready' else 2
    elif args.command == 'test-policy':
        checked_assets()
        print(native_policy_test())
    elif args.command == 'verify-patches':
        try:
            result = verify_patch_bundle()
        except (OSError, RuntimeError, subprocess.SubprocessError, ValueError) as error:
            result = {'status': 'patch-preparation-failed', 'version': LOCK['version'],
                      'sourceCommit': LOCK['commit'], 'error': str(error),
                      'compiledChromium': False, 'p0Complete': False}
            code = 1
    elif args.command == 'check-compatibility':
        result = check_compatibility(args.source, args.ref)
        code = 0 if result['patchApplies'] else 2
    elif args.command == 'apply':
        apply(args.source)
        print('Applied pinned hardware/display patches; Chromium is not compiled or accepted')
    elif args.command == 'build':
        code = build(args.source, args.arch, args.jobs)
    if result:
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result, indent=2))
    return code


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, RuntimeError, subprocess.SubprocessError, ValueError) as error:
        print('Kernel preparation failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
