'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ABI = 'star-hardware-v1';
const HARDWARE_SCOPE = Object.freeze(['hardwareConcurrency', 'deviceMemory', 'deviceMemoryHeaders']);
const REQUIRED_CHECKS = Object.freeze([
  'native.hardware.page-first-script', 'native.hardware.page',
  'native.hardware.same-origin-frame', 'native.hardware.cross-origin-frame',
  'native.hardware.dedicated-worker', 'native.hardware.blob-worker',
  'native.hardware.module-worker', 'native.hardware.shared-worker',
  'native.hardware.service-worker', 'native.hardware.headers',
  'native.hardware.native-getters', 'native.hardware.repeat',
  'native.hardware.new-tab', 'native.hardware.restart',
  'native.hardware.profile-isolation', 'native.hardware.invalid-policy-fallback',
  'control.stock-rejects-policy', 'control.no-injection',
]);

async function sha256File(filename) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

function bundleRoot(executable, platform = process.platform) {
  const absolute = fs.realpathSync(executable);
  if (platform === 'darwin') {
    let parent = path.dirname(absolute);
    while (parent !== path.dirname(parent)) {
      if (parent.endsWith('.app')) return parent;
      parent = path.dirname(parent);
    }
    throw new Error('原生内核必须提供完整的 Chromium .app 包');
  }
  return path.dirname(absolute);
}

// Hash the whole runtime, including Chrome Framework/DLLs; the launcher binary
// alone does not identify the Blink implementation. Never follow external links.
async function browserArtifact(executable, platform = process.platform) {
  const root = bundleRoot(executable, platform);
  if (fs.existsSync(path.join(root, 'obj')) || fs.existsSync(path.join(root, '.git'))) {
    throw new Error('请先将 Chromium 整理为发行包，再进行内核验收');
  }
  const entries = [];
  let totalBytes = 0;
  async function walk(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const filename = path.join(directory, entry.name);
      const relative = path.relative(root, filename).split(path.sep).join('/');
      if (entry.isSymbolicLink()) {
        const target = fs.realpathSync(filename);
        const distance = path.relative(root, target);
        if (distance === '..' || distance.startsWith('..' + path.sep) || path.isAbsolute(distance)) {
          throw new Error('内核包包含外部符号链接：' + relative);
        }
        entries.push({path: relative, type: 'symlink', target: fs.readlinkSync(filename)});
      } else if (entry.isDirectory()) {
        await walk(filename);
      } else if (entry.isFile()) {
        const size = fs.statSync(filename).size;
        totalBytes += size;
        if (totalBytes > 5 * 1024 ** 3 || entries.length >= 20000) throw new Error('内核目录包含过多构建文件');
        entries.push({path: relative, type: 'file', size, sha256: await sha256File(filename)});
      } else {
        throw new Error('内核包包含非常规文件：' + relative);
      }
    }
  }
  await walk(root);
  return {executable: fs.realpathSync(executable), root,
    executableSha256: await sha256File(executable), files: entries.length, bytes: totalBytes,
    bundleSha256: crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex')};
}

function hardwareArguments(fingerprint) {
  const cpu = fingerprint?.hardwareConcurrency, memory = fingerprint?.deviceMemory;
  if (!Number.isInteger(cpu) || cpu < 1 || cpu > 64 || ![2, 4, 8].includes(memory)) {
    throw new Error('原生内核 CPU/RAM 配置超出支持范围');
  }
  return [`--star-fingerprint-hardware=${cpu},${memory}`];
}

function assertAcceptanceMetadata(report) {
  if (report?.schemaVersion !== 1 || report.abi !== ABI || report.status !== 'hardware-accepted' ||
      report.p0Complete !== false || !Array.isArray(report.scope) ||
      HARDWARE_SCOPE.some(item => !report.scope.includes(item)) || report.scope.length !== HARDWARE_SCOPE.length ||
      !Array.isArray(report.checks) || report.checks.length > 128) {
    throw new Error('缺少有效的原生硬件验收报告；内核 P0 尚未完成');
  }
}

function validateAcceptance(report, artifact, host = {platform: process.platform, arch: process.arch}) {
  assertAcceptanceMetadata(report);
  if (report.binary?.platform !== host.platform || report.binary?.arch !== host.arch ||
      report.binary?.bundleSha256 !== artifact.bundleSha256 ||
      report.binary?.executableSha256 !== artifact.executableSha256) {
    throw new Error('原生内核包或平台与验收报告不一致，请重新验收');
  }
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(report.binary.version || '')) {
    throw new Error('验收报告缺少真实内核版本');
  }
  if (!/^[a-f\d]{40}$/.test(report.binary.sourceCommit || '') || report.binary.sourceCommit !== report.expectedSourceCommit) {
    throw new Error('验收报告的真实源码提交与版本锁不一致');
  }
  for (const id of REQUIRED_CHECKS) {
    const matches = (report.checks || []).filter(check => check.id === id);
    if (matches.length !== 1 || matches[0].status !== 'passed') {
      throw new Error('原生内核未通过必需检查：' + id);
    }
  }
  return {executable: artifact.executable, version: report.binary.version,
    abi: ABI, scope: [...HARDWARE_SCOPE], sourceCommit: report.binary.sourceCommit, p0Complete: false, artifact};
}

async function resolveNativeKernel(env = process.env) {
  if (!env.STAR_NATIVE_KERNEL_EXECUTABLE && !env.STAR_NATIVE_KERNEL_ACCEPTANCE) return null;
  if (!env.STAR_NATIVE_KERNEL_EXECUTABLE || !env.STAR_NATIVE_KERNEL_ACCEPTANCE) {
    throw new Error('原生内核路径和验收报告必须同时设置');
  }
  let report;
  try {
    if (fs.statSync(env.STAR_NATIVE_KERNEL_ACCEPTANCE).size > 5 * 1024 * 1024) throw new Error('验收报告过大');
    report = JSON.parse(fs.readFileSync(env.STAR_NATIVE_KERNEL_ACCEPTANCE, 'utf8'));
  } catch (error) {throw new Error('无法读取原生内核验收报告：' + error.message);}
  assertAcceptanceMetadata(report);
  const artifact = await browserArtifact(env.STAR_NATIVE_KERNEL_EXECUTABLE);
  return validateAcceptance(report, artifact);
}

module.exports = {ABI, HARDWARE_SCOPE, REQUIRED_CHECKS, sha256File, bundleRoot,
  browserArtifact, hardwareArguments, validateAcceptance, resolveNativeKernel};
