"""Regression checks for read-only upgrade reports and locked asset integrity."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/kernel.py'
spec = importlib.util.spec_from_file_location('star_kernel_tooling', SCRIPT)
kernel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kernel)


class CompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='star-compatibility-test-')
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        self.bundle = self.root / 'bundle'
        self.bundle.mkdir()
        self.original_root, self.original_lock = kernel.ROOT, kernel.LOCK
        version = b'MAJOR=155\nMINOR=0\nBUILD=8059\nPATCH=40\n'
        signal = b'int value() {\n  return 1;\n}\n'
        self.baseline = {'chrome/VERSION': version, 'signal.cc': signal}
        for path, data in self.baseline.items():
            target = self.source / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        self.overlay = b'#pragma once\n'
        (self.bundle / 'policy.h').write_bytes(self.overlay)
        self.patch = (b'diff --git a/signal.cc b/signal.cc\n--- a/signal.cc\n+++ b/signal.cc\n'
                      b'@@ -1,3 +1,3 @@\n int value() {\n-  return 1;\n+  return 2;\n }\n')
        (self.bundle / 'policy.patch').write_bytes(self.patch)
        self.git('init', '-q')
        self.commit()
        revision = self.git('rev-parse', 'HEAD').stdout.strip()
        kernel.ROOT = self.bundle
        kernel.LOCK = {
            'version': '155.0.8059.40', 'commit': revision,
            'repository': 'https://chromium.googlesource.com/chromium/src.git',
            'upstreamFiles': [{'path': path, 'sha256': self.hash(data)} for path, data in self.baseline.items()],
            'overlays': [{'source': 'policy.h', 'target': 'native/policy.h', 'sha256': self.hash(self.overlay)}],
            'patches': [{'path': 'policy.patch', 'sha256': self.hash(self.patch)}],
        }

    def tearDown(self):
        kernel.ROOT, kernel.LOCK = self.original_root, self.original_lock
        self.temp.cleanup()

    @staticmethod
    def hash(data):
        return hashlib.sha256(data).hexdigest()

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.source, check=True, text=True, capture_output=True)

    def commit(self):
        self.git('add', '.')
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture')

    def tree(self):
        return {str(path.relative_to(self.source)): path.read_bytes()
                for path in self.source.rglob('*') if path.is_file() and '.git' not in path.parts}

    def test_clean_check_preserves_source_and_does_not_claim_compilation(self):
        before = self.tree()
        report = kernel.check_compatibility(self.source)
        self.assertEqual(report['status'], 'source-compatible')
        self.assertTrue(report['patchApplies'])
        self.assertEqual(report['changedFiles'], [])
        self.assertEqual(report['candidateVersion'], '155.0.8059.40')
        self.assertFalse(report['compiledChromium'])
        self.assertFalse(report['p0Complete'])
        self.assertTrue(report['readOnly'])
        self.assertEqual(self.tree(), before)
        self.assertEqual(self.git('status', '--porcelain').stdout, '')

    def test_changed_version_can_apply_and_reports_actual_commit(self):
        (self.source / 'chrome/VERSION').write_text('MAJOR=157\nMINOR=0\nBUILD=8102\nPATCH=0\n')
        self.commit()
        report = kernel.check_compatibility(self.source)
        self.assertEqual(report['status'], 'source-compatible')
        self.assertEqual(report['changedFiles'], ['chrome/VERSION'])
        self.assertEqual(report['candidateVersion'], '157.0.8102.0')
        self.assertEqual(report['candidateCommit'], self.git('rev-parse', 'HEAD').stdout.strip())
        self.assertNotEqual(report['candidateCommit'], report['pinnedCommit'])

    def test_real_patch_conflict_names_file_without_modifying_it(self):
        (self.source / 'signal.cc').write_text('int value() {\n  return 99;\n}\n')
        before = self.tree()
        report = kernel.check_compatibility(self.source)
        self.assertEqual(report['status'], 'patch-conflict')
        self.assertEqual(report['conflictingFiles'], ['signal.cc'])
        self.assertFalse(report['patchApplies'])
        self.assertTrue(report['sourceModified'])
        self.assertEqual(self.tree(), before)

    def test_local_changes_are_distinguished_from_commit_compatibility(self):
        (self.source / 'signal.cc').write_bytes(self.baseline['signal.cc'] + b'\n// local change\n')
        report = kernel.check_compatibility(self.source)
        self.assertEqual(report['status'], 'source-compatible-with-local-changes')
        self.assertTrue(report['sourceModified'])
        self.assertTrue(report['patchApplies'])

    def test_overlay_collision_is_reported_and_never_overwritten(self):
        target = self.source / 'native/policy.h'
        target.parent.mkdir()
        target.write_text('existing file\n')
        report = kernel.check_compatibility(self.source)
        self.assertEqual(report['status'], 'patch-conflict')
        self.assertEqual(report['overlayCollisions'], ['native/policy.h'])
        self.assertEqual(report['conflictingFiles'], ['native/policy.h'])
        self.assertEqual(target.read_text(), 'existing file\n')

    def test_missing_source_is_unavailable_instead_of_a_false_conflict(self):
        (self.source / 'signal.cc').unlink()
        report = kernel.check_compatibility(self.source)
        self.assertEqual(report['status'], 'source-unavailable')
        self.assertIsNone(report['patchApplies'])
        self.assertEqual(report['unavailableFiles'][0]['path'], 'signal.cc')
        self.assertEqual(report['conflictingFiles'], [])

    def test_tampered_bundle_is_rejected_before_inspecting_source(self):
        (self.bundle / 'policy.patch').write_bytes(self.patch + b'\n')
        before = self.tree()
        with self.assertRaisesRegex(RuntimeError, 'Patch hash mismatch'):
            kernel.check_compatibility(self.source)
        self.assertEqual(self.tree(), before)

    def test_remote_ref_is_resolved_once_then_files_use_immutable_commit(self):
        revision = 'a' * 40
        seen = []
        def fetch(commit, path, optional=False):
            seen.append((commit, path))
            return self.baseline.get(path)
        with patch.object(kernel, 'resolve_revision', return_value=revision) as resolver, patch.object(kernel, 'fetch_revision_file', side_effect=fetch):
            report = kernel.check_compatibility(ref='main')
        resolver.assert_called_once_with('main')
        self.assertTrue(all(commit == revision for commit, _ in seen))
        self.assertEqual(report['candidateCommit'], revision)
        self.assertEqual(report['sourceKind'], 'upstream-commit')
        self.assertEqual(report['status'], 'source-compatible')

    def test_gitiles_ref_response_and_invalid_input(self):
        with patch.object(kernel, 'request_bytes', return_value=(")]}'\n" + json.dumps({'commit': 'a'*40})).encode()) as fetch:
            self.assertEqual(kernel.resolve_revision('refs/heads/main'), 'a'*40)
        self.assertIn('/+/refs/heads/main?format=JSON', fetch.call_args.args[0])
        self.assertEqual(kernel.resolve_revision('B'*40), 'b'*40)
        with self.assertRaises(ValueError):
            kernel.resolve_revision('main?format=TEXT')


if __name__ == '__main__':
    unittest.main()
