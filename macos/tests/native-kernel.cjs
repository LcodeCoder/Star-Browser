'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {NativeBrowser}=require('./native-browser.cjs');
const {findChrome} = require('../src/main/launcher');
const {ABI,HARDWARE_SCOPE,REQUIRED_CHECKS,browserArtifact,hardwareArguments,validateAcceptance} = require('../src/main/native-kernel');
const {startNativeOrigin} = require('./native-kernel-fixture.cjs');
const lock = require('../../kernel/chromium.lock.json');
const SCOPE_KEYS = ['page','sameOrigin','crossOrigin','dedicated','blob','module','shared','service'];
const memoryHeaders = headers => Object.fromEntries(Object.entries(headers || {}).filter(([key]) => ['device-memory','sec-ch-device-memory'].includes(key)));
function values(probe) {
  assert.ok(probe && !probe.error,probe?.error || 'Probe did not return a result');
  return {first:probe.first,...probe.scopes,repeat:probe.repeat};
}
function hardware(value,expected,label) {
  assert.ok(value && !value.error,label+': '+(value?.error || 'No hardware result'));
  assert.equal(value.cpu,expected.cpu,label+' CPU');assert.equal(value.memory,expected.memory,label+' RAM');
}
function allHardware(probe,expected) {for(const [key,value] of Object.entries(values(probe)))hardware(value,expected,key);}
function nativeGetters(probe) {
  for(const [scope,value] of Object.entries(values(probe))) {
    assert.ok(value&&!value.error,scope+': '+(value?.error||'No native result'));
    assert.ok(value.functionToStringNative,scope+' Function.prototype.toString');
    for(const key of ['hardwareConcurrency','deviceMemory']) {
      const getter=value.descriptors?.[key];assert.ok(getter,scope+' '+key);
      assert.equal(getter.native,true);assert.equal(getter.illegalReceiver,true);
      assert.equal(getter.name,'get '+key);assert.equal(getter.length,0);assert.equal(getter.enumerable,true);assert.equal(getter.configurable,true);
      assert.equal(getter.owner,['dedicated','blob','module','shared','service'].includes(scope)?'WorkerNavigator':'Navigator');
    }
  }
}
function compareHeaders(actual,baseline,memory) {
  const observed=memoryHeaders(actual),reference=memoryHeaders(baseline);
  assert.deepEqual(Object.keys(observed).sort(),Object.keys(reference).sort(),'Native emission decisions must be preserved');
  for(const [name,value] of Object.entries(observed))assert.equal(Number(value),memory,name);
  return observed;
}
function options() {
  const out={output:path.resolve('test-results/native-kernel-controls.json'),stock:findChrome(),executable:null,controlsOnly:false};
  const args=process.argv.slice(2);
  for(let i=0;i<args.length;i++) {
    const key=args[i];if(key==='--controls-only')out.controlsOnly=true;
    else if(['--executable','--stock','--output'].includes(key)&&args[i+1])out[key.slice(2)]=path.resolve(args[++i]);
    else throw new Error('Usage: node tests/native-kernel.cjs [--controls-only] [--executable Chromium] [--stock Chrome] [--output report.json]');
  }
  if(!out.stock)throw new Error('Stock Chrome is required for the control');
  if(!out.executable)out.controlsOnly=true;
  if(!out.controlsOnly&&!args.includes('--output'))out.output=path.resolve('test-results/native-kernel-acceptance.json');
  if(out.executable&&!fs.existsSync(out.executable))throw new Error('Native executable does not exist');
  return out;
}
(async()=>{
 let origin,root;const browsers=[],checks=[];
 const report={schemaVersion:1,abi:ABI,scope:[...HARDWARE_SCOPE],p0Complete:false,buildPerformed:false,checks};
 async function check(id,run) {
   const started=Date.now();
   try {const detail=await run();checks.push({id,status:'passed',durationMs:Date.now()-started,detail});console.log('PASS',id);return true;}
   catch(error){checks.push({id,status:'failed',durationMs:Date.now()-started,error:error.stack});console.error('FAIL',id,error.message);return false;}
 }
 let opts;
 try {
  opts=options();root=fs.mkdtempSync(path.join(os.tmpdir(),'star-native-acceptance-'));origin=await startNativeOrigin();
  function launch(executable,name,policy) {const browser=new NativeBrowser(executable,path.join(root,name),policy?['--star-fingerprint-hardware='+policy]:[]);browsers.push(browser);return browser;}
  const plain=launch(opts.stock,'stock-baseline');const stockVersion=await plain.send('Browser.getVersion');const baseline=(await plain.probe(origin.url)).value;nativeGetters(baseline);
  const reference={cpu:baseline.first.cpu,memory:baseline.first.memory};
  const persona={hardwareConcurrency:reference.cpu===4?8:4,deviceMemory:reference.memory===2?4:2};
  const policy=hardwareArguments(persona)[0].split('=')[1];
  const stock=launch(opts.stock,'stock-policy',policy);const stockProbe=(await stock.probe(origin.url)).value;
  report.control={version:stockVersion.product,baseline,withPolicy:stockProbe,requested:{cpu:persona.hardwareConcurrency,memory:persona.deviceMemory}};
  await check('control.stock-rejects-policy',()=>{allHardware(stockProbe,reference);nativeGetters(stockProbe);assert.notEqual(stockProbe.first.cpu,persona.hardwareConcurrency);assert.notEqual(stockProbe.first.memory,persona.deviceMemory);assert.ok(Object.keys(memoryHeaders(baseline.headers)).length>0,'Stock control must actually emit memory headers');compareHeaders(stockProbe.headers,baseline.headers,reference.memory);return {actual:reference,requested:report.control.requested};});
  await plain.close();await stock.close();
  if(opts.controlsOnly) {
    await check('control.no-injection',()=>{for(const browser of browsers)browser.noInjection();return {commands:[...new Set(browsers.flatMap(browser=>browser.commands))],extensions:false,emulationOverrides:false,preloadScripts:false};});
    report.status=checks.every(item=>item.status==='passed')?'stock-controls-verified':'stock-controls-failed';
    report.hardwareAccepted=false;
  } else {
    report.expectedSourceCommit=lock.commit;
    const noPolicy=launch(opts.executable,'native-default');
    const normal=(await noPolicy.probe(origin.url+'?default')).value;nativeGetters(normal);await noPolicy.close();
    report.nativeReference={cpu:normal.first.cpu,memory:normal.first.memory};
    const candidate=launch(opts.executable,'native-persona',policy);const version=await candidate.send('Browser.getVersion');
    const hints=normal.first.hints;
    const arch=hints?.architecture==='arm'&&hints.bitness==='64'?'arm64':hints?.architecture==='x86'&&hints.bitness==='64'?'x64':null;
    assert.ok(arch,'Native architecture must be read from unmodified Client Hints');
    assert.equal(arch,process.arch,'Run native acceptance on the matching host architecture');
    report.binary={executable:fs.realpathSync(opts.executable),version:version.product.split('/').pop(),sourceCommit:version.revision?.replace(/^@/,''),platform:process.platform,arch};
    assert.equal(report.binary.version,lock.version,'Native build must match the pinned version');
    assert.equal(report.binary.sourceCommit,lock.commit,'Browser runtime revision must match the source lock');
    const expected={cpu:persona.hardwareConcurrency,memory:persona.deviceMemory};const probe=(await candidate.probe(origin.url)).value;report.native={requested:expected,probe};
    await check('native.hardware.page-first-script',()=>hardware(probe.first,expected,'First page script'));
    const ids={page:'page',sameOrigin:'same-origin-frame',crossOrigin:'cross-origin-frame',dedicated:'dedicated-worker',blob:'blob-worker',module:'module-worker',shared:'shared-worker',service:'service-worker'};
    for(const [scope,id] of Object.entries(ids))await check('native.hardware.'+id,()=>hardware(probe.scopes[scope],expected,scope));
    await check('native.hardware.headers',()=>{assert.ok(Object.keys(memoryHeaders(probe.headers)).length>0);const observed={page:compareHeaders(probe.headers,normal.headers,expected.memory)};for(const key of SCOPE_KEYS)if(normal.scopes[key]?.headers)observed[key]=compareHeaders(probe.scopes[key]?.headers,normal.scopes[key].headers,expected.memory);return observed;});
    await check('native.hardware.native-getters',()=>nativeGetters(probe));
    await check('native.hardware.repeat',()=>hardware(probe.repeat,expected,'Repeat'));
    await check('native.hardware.new-tab',async()=>{const value=(await candidate.probe(origin.url+'?new-tab')).value;allHardware(value,expected);return {first:value.first.cpu,memory:value.first.memory};});
    await candidate.close();
    const restart=launch(opts.executable,'native-persona',policy);const restarted=(await restart.probe(origin.url+'?restart')).value;
    await check('native.hardware.restart',()=>{allHardware(restarted,expected);compareHeaders(restarted.headers,normal.headers,expected.memory);return {cpu:restarted.first.cpu,memory:restarted.first.memory};});
    const other=launch(opts.executable,'native-other',hardwareArguments({hardwareConcurrency:expected.cpu===8?4:8,deviceMemory:expected.memory===4?2:4})[0].split('=')[1]);
    const second=(await other.probe(origin.url+'?second')).value;
    await check('native.hardware.profile-isolation',async()=>{const another={cpu:expected.cpu===8?4:8,memory:expected.memory===4?2:4};allHardware(second,another);const original=(await restart.probe(origin.url+'?isolation')).value;allHardware(original,expected);return {first:expected,second:another};});
    await restart.close();await other.close();
    const invalid=launch(opts.executable,'native-invalid','8,0');const fallback=(await invalid.probe(origin.url+'?invalid')).value;
    await check('native.hardware.invalid-policy-fallback',()=>{const actual={cpu:normal.first.cpu,memory:normal.first.memory};allHardware(fallback,actual);nativeGetters(fallback);compareHeaders(fallback.headers,normal.headers,actual.memory);return actual;});
    await check('control.no-injection',()=>{for(const browser of browsers)browser.noInjection();return {commands:[...new Set(browsers.flatMap(browser=>browser.commands))],extensions:false,emulationOverrides:false,preloadScripts:false};});
    report.status=REQUIRED_CHECKS.every(id=>checks.filter(check=>check.id===id&&check.status==='passed').length===1)?'hardware-accepted':'hardware-rejected';
    report.hardwareAccepted=report.status==='hardware-accepted';
    if(report.hardwareAccepted){const artifact=await browserArtifact(opts.executable);Object.assign(report.binary,{bundleSha256:artifact.bundleSha256,executableSha256:artifact.executableSha256,files:artifact.files,bytes:artifact.bytes});validateAcceptance(report,artifact);}
  }
  if(!['stock-controls-verified','hardware-accepted'].includes(report.status))process.exitCode=1;
 }catch(error){console.error(error);report.status='acceptance-error';report.hardwareAccepted=false;report.error=error.stack;process.exitCode=1;}
 finally{
  await Promise.allSettled(browsers.map(browser=>browser.close()));if(origin)await origin.close();
  report.testedAt=new Date().toISOString();report.platform=process.platform;report.arch=process.arch;
  const output=opts?.output||path.resolve('test-results/native-kernel-error.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  if(root)fs.rmSync(root,{recursive:true,force:true});console.log('Native report:',report.status,output);
 }
})();
