"""CI provisioning guards and exact-bundle acceptance regression checks."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from collections import namedtuple
import subprocess

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location('star_native_ci', SCRIPTS / 'native_ci.py')
native_ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native_ci)
sys.path.remove(str(SCRIPTS))


class NativeCITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='star-native-ci-test-')
        self.root = Path(self.temp.name)
        self.project = self.root / 'project'
        self.project.mkdir()
        self.project_patch = patch.object(native_ci, 'PROJECT', self.project)
        self.project_patch.start()
        self.pipeline = native_ci.Pipeline(self.root / 'build')

    def tearDown(self):
        self.project_patch.stop()
        self.temp.cleanup()

    def test_local_provision_is_rejected_before_any_tool_or_delete(self):
        with patch.dict(os.environ, {'GITHUB_ACTIONS': 'false', 'RUNNER_ENVIRONMENT': 'github-hosted'}):
            with patch.object(self.pipeline, 'execute') as execute:
                with self.assertRaisesRegex(RuntimeError, 'disposable GitHub-hosted'):
                    self.pipeline.provision()
                execute.assert_not_called()
        self.assertFalse(self.pipeline.root.exists())
        self.assertFalse(self.pipeline.report['compiledChromium'])

    def test_self_hosted_machine_is_never_pruned(self):
        with patch.dict(os.environ, {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'self-hosted'}):
            with patch.object(self.pipeline, 'execute') as execute:
                with self.assertRaisesRegex(RuntimeError, 'disposable GitHub-hosted'):
                    self.pipeline.provision()
                execute.assert_not_called()

    def windows_provision_fixture(self, sdk_status='passed', fail_setup=False):
        files = self.root / 'program-files'
        (files / 'Windows Kits/10/Include/10.0.28000.0').mkdir(parents=True)
        installation = str(files / 'Microsoft Visual Studio/18/Enterprise')

        def execute(args, *unused, **kwargs):
            if Path(str(args[0])).name == 'vswhere.exe':
                return installation + '\n'
            if str(args[0]) == 'pwsh':
                if fail_setup:
                    raise subprocess.CalledProcessError(1, 'pwsh')
                (self.pipeline.reports / 'windows-sdk.json').write_text(
                    json.dumps({'status': sdk_status, 'kitVersion': '10.0.28000.0'}),
                    encoding='utf-8-sig')
            return ''

        return files, installation, execute

    def test_sdk_install_failure_stops_before_source_checkout(self):
        files, _, execute = self.windows_provision_fixture(fail_setup=True)
        with patch.dict(os.environ, {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
                                     'ProgramFiles(x86)': str(files)}):
            with patch.object(native_ci.sys, 'platform', 'win32'):
                with patch.object(self.pipeline, 'execute', side_effect=execute):
                    with self.assertRaises(subprocess.CalledProcessError):
                        self.pipeline.provision()
        self.assertFalse(self.pipeline.source.exists())
        self.assertFalse(self.pipeline.report['compiledChromium'])

    def test_nonpassing_sdk_report_stops_provision_even_after_zero_exit(self):
        files, _, execute = self.windows_provision_fixture(sdk_status='failed')
        with patch.dict(os.environ, {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
                                     'ProgramFiles(x86)': str(files)}):
            with patch.object(native_ci.sys, 'platform', 'win32'):
                with patch.object(self.pipeline, 'execute', side_effect=execute):
                    with self.assertRaisesRegex(RuntimeError, 'SDK setup did not pass'):
                        self.pipeline.provision()
        self.assertFalse(self.pipeline.source.exists())

    def test_actual_sdk_setup_preserves_verified_vs_path(self):
        files, installation, execute = self.windows_provision_fixture()
        usage = namedtuple('Usage', 'total used free')(300 * 1024**3, 100 * 1024**3, 200 * 1024**3)
        with patch.dict(os.environ, {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
                                     'ProgramFiles(x86)': str(files)}):
            with patch.object(native_ci.sys, 'platform', 'win32'):
                with patch.object(self.pipeline, 'execute', side_effect=execute):
                    with patch.object(native_ci.shutil, 'disk_usage', return_value=usage):
                        self.pipeline.provision()
        self.assertEqual(self.pipeline.environment['vs2026_install'], installation)
        self.assertEqual(self.pipeline.report['windowsSdks'], ['10.0.28000.0'])
        self.assertEqual(self.pipeline.report['windowsSdkSetup']['status'], 'passed')
        self.assertFalse(self.pipeline.report['compiledChromium'])

    def stage_fixture(self):
        output = self.pipeline.source / 'out/native'
        output.mkdir(parents=True)
        (output / 'chrome.exe').write_bytes(b'browser fixture')
        (output / 'chrome.dll').write_bytes(b'blink fixture')
        (self.pipeline.source / 'LICENSE').write_text('Chromium fixture license')
        return output

    def test_runtime_stage_keeps_browser_dll_and_blocks_outside_paths(self):
        output = self.stage_fixture()
        with patch.object(native_ci.sys, 'platform', 'win32'):
            with patch.object(self.pipeline, 'execute', return_value='chrome.exe\nchrome.dll\n'):
                executable = self.pipeline.stage(output, {'gn': 'fixture-gn'})
        self.assertEqual(executable.read_bytes(), b'browser fixture')
        self.assertEqual((executable.parent / 'chrome.dll').read_bytes(), b'blink fixture')
        self.assertFalse((executable.parent / 'obj').exists())
        self.assertFalse(self.pipeline.report['compiledChromium'])

    def test_outside_runtime_dependency_cannot_escape_bundle(self):
        output = self.stage_fixture()
        (output.parent / 'outside.dat').write_bytes(b'outside fixture')
        with patch.object(native_ci.sys, 'platform', 'win32'):
            with patch.object(self.pipeline, 'execute', return_value='../outside.dat\n'):
                with self.assertRaisesRegex(RuntimeError, 'outside the output'):
                    self.pipeline.stage(output, {'gn': 'fixture-gn'})
        self.assertFalse((self.pipeline.root / 'runtime/outside.dat').exists())

    def test_build_intermediates_are_never_called_runtime(self):
        output = self.stage_fixture()
        (output / 'obj').mkdir()
        (output / 'obj/chrome.o').write_bytes(b'build fixture')
        with patch.object(native_ci.sys, 'platform', 'win32'):
            with patch.object(self.pipeline, 'execute', return_value='obj/chrome.o\n'):
                with self.assertRaisesRegex(RuntimeError, 'build intermediates'):
                    self.pipeline.stage(output, {'gn': 'fixture-gn'})

    def acceptance_runner(self, reports):
        def execute(args, *unused, **kwargs):
            filename = Path(args[-1])
            filename.write_text(json.dumps(reports[filename.name]), encoding='utf-8')
        return execute

    def accepted_reports(self):
        return {filename: {'status': status, 'p0Complete': False, 'binary': {
            'version': native_ci.kernel.LOCK['version'], 'sourceCommit': native_ci.kernel.LOCK['commit'],
            'bundleSha256': 'a' * 64}}
            for filename, status in [('oopif.json', 'oopif-accepted'),
                                     ('hardware.json', 'hardware-accepted'),
                                     ('display.json', 'display-accepted')]}

    def test_zero_exit_control_report_is_not_native_acceptance(self):
        reports = {filename: {'status': 'control-only'} for filename in self.accepted_reports()}
        with patch.object(self.pipeline, 'execute', side_effect=self.acceptance_runner(reports)):
            with self.assertRaisesRegex(RuntimeError, 'rejected the candidate'):
                self.pipeline.acceptance(self.root / 'fixture.exe')
        self.assertFalse(self.pipeline.report['oopifPropagationRuntimeAccepted'])
        self.assertTrue(all(not outcome['passed'] for outcome in self.pipeline.report['runtimeChecks']))

    def test_accepted_reports_must_identify_the_same_runtime_bundle(self):
        reports = self.accepted_reports()
        reports['hardware.json']['binary']['bundleSha256'] = 'b' * 64
        with patch.object(self.pipeline, 'execute', side_effect=self.acceptance_runner(reports)):
            with self.assertRaisesRegex(RuntimeError, 'rejected the candidate'):
                self.pipeline.acceptance(self.root / 'fixture.exe')
        self.assertFalse(self.pipeline.report['runtimeChecks'][1]['passed'])
        self.assertIn('different browser bundles', self.pipeline.report['runtimeChecks'][1]['error'])

    def test_wrong_source_revision_never_accepts_oopif(self):
        reports = self.accepted_reports()
        reports['oopif.json']['binary']['sourceCommit'] = '0' * 40
        with patch.object(self.pipeline, 'execute', side_effect=self.acceptance_runner(reports)):
            with self.assertRaisesRegex(RuntimeError, 'rejected the candidate'):
                self.pipeline.acceptance(self.root / 'fixture.exe')
        self.assertFalse(self.pipeline.report['oopifPropagationRuntimeAccepted'])
        self.assertFalse(self.pipeline.report['p0Complete'])


if __name__ == '__main__':
    unittest.main()
