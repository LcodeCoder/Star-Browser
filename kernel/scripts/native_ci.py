#!/usr/bin/env python3
"""Real pinned native builds on disposable CI hosts; source checks are not acceptance."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import traceback

import kernel

PROJECT = kernel.ROOT.parent
DEPOT_REPOSITORY = 'https://chromium.googlesource.com/chromium/tools/depot_tools.git'


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def require_hosted_ci():
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted':
        raise RuntimeError('This provisioning entry is only for disposable GitHub-hosted runners')


class Pipeline:
    def __init__(self, root):
        self.root = root.resolve()
        self.source = self.root / 'chromium/src'
        self.depot = self.root / 'depot_tools'
        self.reports = PROJECT / 'macos/test-results/native-build'
        self.reports.mkdir(parents=True, exist_ok=True)
        self.report = {'schemaVersion': 1, 'startedAt': timestamp(),
                       'sourceCommit': kernel.LOCK['commit'], 'version': kernel.LOCK['version'],
                       'platform': sys.platform, 'architecture': platform.machine(),
                       'compiledChromium': False, 'nativeUnitTestsPassed': False,
                       'oopifPropagationRuntimeAccepted': False, 'p0Complete': False,
                       'phases': []}
        self.phase = None
        self.environment = ({key.upper(): value for key, value in os.environ.items()}
                            if os.name == 'nt' else dict(os.environ))
        self.environment.update(DEPOT_TOOLS_WIN_TOOLCHAIN='0', DEPOT_TOOLS_UPDATE='0',
                                PYTHONUTF8='1')
        self.environment['PATH'] = str(self.depot) + os.pathsep + self.environment['PATH']

    def save(self):
        self.report['updatedAt'] = timestamp()
        (self.reports / 'build.json').write_text(json.dumps(self.report, indent=2) + '\n', encoding='utf-8')

    def begin(self, name):
        self.phase = {'name': name, 'startedAt': timestamp(), 'status': 'running'}
        self.report['phases'].append(self.phase)
        self.report['status'] = 'running'
        self.save()
        print('Native build phase: ' + name, flush=True)

    def finish(self, **detail):
        self.phase.update(status='passed', finishedAt=timestamp(), **detail)
        self.save()

    def execute(self, args, cwd=None, capture=False):
        # No shell interpolation; credentials/environment values never enter the log.
        label = self.phase['name'] if self.phase else 'provision'
        logfile = self.reports / (label + '.log')
        if capture:
            result = subprocess.run([str(arg) for arg in args], cwd=cwd,
                                    env=self.environment, check=True, text=True,
                                    capture_output=True, timeout=120)
            return result.stdout
        with logfile.open('a', encoding='utf-8') as output:
            with subprocess.Popen([str(arg) for arg in args], cwd=cwd, env=self.environment,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                  text=True, encoding='utf-8', errors='replace') as child:
                for line in child.stdout:
                    output.write(line)
                    print(line, end='', flush=True)
                code = child.wait()
                if code:
                    raise subprocess.CalledProcessError(code, str(args[0]))

    def provision(self):
        require_hosted_ci()
        self.root.mkdir(parents=True, exist_ok=True)
        self.begin('provision')
        if sys.platform == 'darwin':
            active = Path(self.execute(['xcode-select', '-p'], capture=True).strip())
            selected = next((path for path in active.parents if path.suffix == '.app'), None)
            if not selected:
                raise RuntimeError('Full active Xcode is required')
            selected = selected.resolve()
            removed = []
            # Preserve the active bundle and every alias resolving to it. Only
            # unused Xcode bundles on this disposable hosted runner are removed.
            for candidate in sorted(Path('/Applications').glob('Xcode*.app')):
                if candidate.resolve() == selected:
                    continue
                self.execute(['sudo', 'rm', '-rf', '--', str(candidate)])
                removed.append(str(candidate))
            self.report['removedUnusedHostedXcodes'] = removed
            self.report['activeXcode'] = str(selected)
            self.report['xcodeVersion'] = self.execute(['xcodebuild', '-version'], capture=True).strip()
            self.report['sdkVersion'] = self.execute(['xcrun', '--sdk', 'macosx', '--show-sdk-version'], capture=True).strip()
        elif sys.platform == 'win32':
            vswhere = Path(os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)')) / 'Microsoft Visual Studio/Installer/vswhere.exe'
            installation = self.execute([vswhere, '-latest', '-products', '*', '-requires',
                                         'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
                                         '-property', 'installationPath'], capture=True).strip()
            if not installation:
                raise RuntimeError('Visual Studio C++ toolchain is unavailable')
            command = Path(installation) / 'Common7/Tools/VsDevCmd.bat'
            # Fixed compiler setup command on the disposable host; captured
            # environment is consumed privately and is never printed or saved.
            block = self.execute(['cmd.exe', '/d', '/s', '/c',
                                  '""' + str(command) + '" -arch=amd64 -host_arch=amd64 && set"'], capture=True)
            for line in block.splitlines():
                if '=' in line and not line.startswith('='):
                    key, value = line.split('=', 1)
                    self.environment[key.upper()] = value
            self.environment['DEPOT_TOOLS_WIN_TOOLCHAIN'] = '0'
            self.environment['DEPOT_TOOLS_UPDATE'] = '0'
            self.environment['PATH'] = str(self.depot) + os.pathsep + self.environment.get('PATH', '')
            self.environment['vs2026_install'] = installation
            self.report['visualStudio'] = installation
            sdk_root = Path(os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)')) / 'Windows Kits/10'
            sdks = sorted(path.name for path in (sdk_root / 'Include').glob('*') if path.is_dir())
            self.report['windowsSdks'] = sdks
            if '10.0.28000.0' not in sdks:
                raise RuntimeError('Pinned Chromium requires Windows SDK 10.0.28000.0; installed SDKs: ' + ', '.join(sdks))
            # Long paths also apply to gclient-created dependency repositories.
            self.execute(['git', 'config', '--global', 'core.longpaths', 'true'])
        else:
            raise RuntimeError('Native acceptance requires a Windows or macOS host')
        free = shutil.disk_usage(self.root).free // (1024 ** 3)
        self.report['freeGiBBeforeCheckout'] = free
        if free < 150:
            raise RuntimeError('At least 150 GiB free before native checkout is required; measured ' + str(free))
        self.finish(freeGiB=free)

    def checkout(self):
        self.begin('checkout')
        if self.depot.exists() or self.source.exists():
            raise RuntimeError('Use an empty CI build directory')
        self.execute(['git', 'clone', '--depth=1', DEPOT_REPOSITORY, self.depot])
        self.report['depotToolsCommit'] = self.execute(['git', 'rev-parse', 'HEAD'], self.depot, True).strip()
        parent = self.source.parent
        parent.mkdir(parents=True, exist_ok=True)
        configuration = [{'name': 'src', 'url': kernel.LOCK['repository'],
                          'deps_file': 'DEPS', 'managed': False,
                          'custom_deps': {}, 'custom_vars': {'checkout_configuration': 'small',
                                                          'checkout_pgo_profiles': False}}]
        (parent / '.gclient').write_text('solutions = ' + repr(configuration) + '\n', encoding='utf-8')
        self.execute(['git', 'init', self.source])
        self.execute(['git', 'remote', 'add', 'origin', kernel.LOCK['repository']], self.source)
        self.execute(['git', '-c', 'protocol.version=2', 'fetch', '--depth=1', 'origin', kernel.LOCK['commit']], self.source)
        self.execute(['git', 'checkout', '--detach', 'FETCH_HEAD'], self.source)
        gclient = self.depot / ('gclient.bat' if os.name == 'nt' else 'gclient')
        self.execute([gclient, 'sync', '--no-history', '--shallow', '--nohooks',
                      '--revision', 'src@' + kernel.LOCK['commit'], '-j', '4'], parent)
        self.execute([gclient, 'runhooks'], parent)
        revision = self.execute(['git', 'rev-parse', 'HEAD'], self.source, True).strip()
        if revision != kernel.LOCK['commit']:
            raise RuntimeError('Checkout revision differs from the source lock')
        self.finish(sourceCommit=revision, freeGiB=shutil.disk_usage(self.source).free // (1024 ** 3))

    def compile(self, arch, jobs):
        self.begin('preflight')
        # GN/autoninja lookup in kernel.py uses the active process environment.
        os.environ.update(self.environment)
        check = kernel.preflight(self.source, arch)
        (self.reports / 'preflight.json').write_text(json.dumps(check, indent=2) + '\n', encoding='utf-8')
        if check['blockers']:
            raise RuntimeError('; '.join(check['blockers']))
        self.finish()
        self.begin('apply-patches')
        kernel.apply(self.source)
        self.finish(patches=[item['path'] for item in kernel.LOCK['patches']])
        self.begin('generate')
        output = 'out/Star-native-' + arch
        args = ('is_debug=false is_component_build=false is_official_build=false '
                'symbol_level=0 blink_symbol_level=0 v8_symbol_level=0 '
                'use_remoteexec=false use_thin_lto=false target_cpu="' + arch + '"')
        if sys.platform == 'darwin':
            args += ' use_system_xcode=true'
        self.report['gnArgs'] = args
        self.execute([check['tools']['gn'], 'gen', output, '--args=' + args, '--check'], self.source)
        self.finish()
        self.begin('compile-chrome')
        self.execute([check['tools']['autoninja'], '-C', output, '-j' + str(jobs), 'chrome'], self.source)
        self.report['compiledChromium'] = True
        self.finish()
        return self.source / output, check['tools']

    def stage(self, output, tools):
        self.begin('stage-runtime')
        destination = self.root / 'runtime'
        destination.mkdir()
        if sys.platform == 'darwin':
            source_bundle = output / 'Chromium.app'
            shutil.copytree(source_bundle, destination / source_bundle.name, symlinks=True)
            executable = destination / 'Chromium.app/Contents/MacOS/Chromium'
        else:
            dependencies = self.execute([tools['gn'], 'desc', output, '//chrome:chrome', 'runtime_deps'], self.source, True)
            (self.reports / 'chrome-runtime-deps.txt').write_text(dependencies, encoding='utf-8')
            copied = set()
            for line in dependencies.splitlines():
                relative = Path(line.strip())
                if not str(relative) or not line.strip():
                    continue
                source = (output / relative).resolve()
                try:
                    target_relative = source.relative_to(output.resolve())
                except ValueError:
                    raise RuntimeError('Runtime dependency is outside the output directory: ' + line)
                if any(part in ('obj', 'gen') for part in target_relative.parts):
                    raise RuntimeError('Runtime list includes build intermediates: ' + line)
                if not source.exists():
                    raise RuntimeError('Missing runtime dependency: ' + line)
                target = destination / target_relative
                if str(target) in copied:
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                if source.is_dir():
                    shutil.copytree(source, target, dirs_exist_ok=True)
                else:
                    shutil.copy2(source, target)
                copied.add(str(target))
            executable = destination / 'chrome.exe'
        if not executable.is_file():
            raise RuntimeError('Staged browser executable is missing')
        shutil.copyfile(self.source / 'LICENSE', destination / 'CHROMIUM_LICENSE')
        if (kernel.ROOT / 'THIRD_PARTY_NOTICES.md').exists():
            shutil.copyfile(kernel.ROOT / 'THIRD_PARTY_NOTICES.md', destination / 'STAR_KERNEL_NOTICES.md')
        self.report['runtimeExecutable'] = str(executable)
        self.finish(executable=str(executable))
        return executable

    def acceptance(self, executable):
        self.begin('runtime-acceptance')
        outcomes = []
        for script, filename, accepted in [('oopif-device-metrics.cjs', 'oopif.json', 'oopif-accepted'),
                                           ('native-kernel.cjs', 'hardware.json', 'hardware-accepted'),
                                           ('native-display.cjs', 'display.json', 'display-accepted')]:
            try:
                self.execute(['node', PROJECT / 'macos/tests' / script, '--executable', executable,
                              '--output', self.reports / filename], PROJECT / 'macos')
                data = json.loads((self.reports / filename).read_text(encoding='utf-8'))
                binary = data.get('binary', {})
                if (data.get('status') != accepted or data.get('p0Complete') is not False or
                        binary.get('version') != kernel.LOCK['version'] or
                        binary.get('sourceCommit') != kernel.LOCK['commit'] or
                        len(binary.get('bundleSha256', '')) != 64):
                    raise RuntimeError('Missing exact native acceptance metadata: ' + filename)
                previous = self.report.get('bundleSha256')
                if previous and previous != binary['bundleSha256']:
                    raise RuntimeError('Native suites measured different browser bundles')
                self.report['bundleSha256'] = binary['bundleSha256']
                outcomes.append({'script': script, 'passed': True, 'status': accepted})
            except (subprocess.CalledProcessError, RuntimeError, OSError, ValueError) as error:
                outcomes.append({'script': script, 'passed': False,
                                 'exitCode': getattr(error, 'returncode', None), 'error': str(error)})
        self.report['runtimeChecks'] = outcomes
        oopif = self.reports / 'oopif.json'
        if oopif.is_file():
            self.report['oopifPropagationRuntimeAccepted'] = (
                bool(outcomes[0]['passed']) and
                json.loads(oopif.read_text(encoding='utf-8')).get('status') == 'oopif-accepted')
        self.save()
        if not all(item['passed'] for item in outcomes):
            raise RuntimeError('One or more native runtime acceptance suites rejected the candidate; see per-suite reports')
        self.finish()

    def unit_tests(self, output, tools, jobs):
        self.begin('native-unit-tests')
        self.execute([tools['autoninja'], '-C', output, '-j' + str(jobs),
                      'blink_common_unittests', 'content_unittests'], self.source)
        suffix = '.exe' if sys.platform == 'win32' else ''
        for test, pattern in [('blink_common_unittests', 'StarHardwarePolicyTest.*'),
                              ('content_unittests', 'StarDisplayPolicyTest.*')]:
            self.execute([output / (test + suffix), '--gtest_filter=' + pattern], self.source)
        self.report['nativeUnitTestsPassed'] = True
        self.finish()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--arch', choices=['arm64', 'x64'], required=True)
    parser.add_argument('--jobs', type=int, default=2)
    args = parser.parse_args()
    if not 1 <= args.jobs <= 8:
        parser.error('--jobs must be 1..8 for hosted builds')
    pipeline = Pipeline(args.root)
    try:
        pipeline.provision()
        pipeline.checkout()
        output, tools = pipeline.compile(args.arch, args.jobs)
        executable = pipeline.stage(output, tools)
        pipeline.acceptance(executable)
        pipeline.unit_tests(output, tools, args.jobs)
        pipeline.report['status'] = 'compiled-and-accepted-scopes'
        pipeline.save()
        return 0
    except Exception as error:
        if pipeline.phase:
            pipeline.phase.update(status='failed', finishedAt=timestamp(), error=str(error))
        pipeline.report.update(status='failed', error=str(error))
        pipeline.save()
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    sys.exit(main())
