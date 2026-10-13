'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {findChrome}=require('../src/main/launcher');
const {browserArtifact}=require('../src/main/native-kernel');
const {NativeBrowser}=require('./native-browser.cjs');
const {startDisplayOrigin}=require('./native-display-fixture.cjs');
const lock=require('../../kernel/chromium.lock.json');
const ABI='star-display-v1';
const REQUIRED=[
 'control.stock-rejects-display-policy','control.native-scale','control.native-getters','control.oopif','control.no-injection',
 'native.display.first-script','native.display.page','native.display.same-origin-frame','native.display.cross-origin-frame',
 'native.display.srcdoc','native.display.about-blank','native.display.native-getters','native.display.css','native.display.layout',
 'native.display.repeat','native.display.new-tab','native.display.navigation','native.display.restart',
 'native.display.profile-isolation','native.display.invalid-policy-fallback','native.display.default-native'
];
const FIELD_NAMES=['width','height','availWidth','availHeight','colorDepth','pixelDepth'];
const all=probe=>({first:probe.first,...probe.scopes,repeat:probe.repeat});
function valid(probe){assert.ok(probe&&!probe.error,probe?.error||'No native display measurement');return probe;}
function screenMatches(value,expected,label){
 assert.ok(value&&!value.error,label+': no native result');
 const wanted=expected.screen||{width:expected.width,height:expected.height,availWidth:expected.availableWidth,availHeight:expected.availableHeight,colorDepth:expected.depth,pixelDepth:expected.depth};
 for(const field of FIELD_NAMES)assert.equal(value.screen[field],wanted[field],label+' screen.'+field);
 if(expected.orientation)assert.deepEqual(value.orientation,expected.orientation,label+' orientation');
 else assert.deepEqual(value.orientation,{type:expected.width>=expected.height?'landscape-primary':'portrait-primary',angle:0},label+' orientation');
 assert.equal(value.dpr,expected.dpr||expected.scale,label+' DPR');
}
function nativeGetters(probe){for(const [scope,value] of Object.entries(all(valid(probe)))){
 assert.ok(value.functionToStringNative,scope+' native toString');assert.ok(value.dprGetter.native,scope+' native DPR getter');assert.ok(value.dprGetter.illegalReceiver,scope+' DPR receiver');
 for(const key of FIELD_NAMES){const getter=value.descriptors[key];assert.ok(getter.native,scope+' '+key+' native getter');assert.ok(getter.illegalReceiver,scope+' '+key+' receiver');assert.equal(getter.name,'get '+key);assert.equal(getter.length,0);}
}}
function allScreens(probe,expected){for(const [scope,value] of Object.entries(all(valid(probe))))screenMatches(value,expected,scope);}
function cssMatches(probe){for(const [scope,value] of Object.entries(all(valid(probe))))for(const [key,matched] of Object.entries(value.css))assert.equal(matched,true,scope+' CSS '+key);}
function layoutMatches(probe){for(const [scope,value] of Object.entries(all(valid(probe))))assert.equal(value.layoutWidth,120,scope+' CSS layout width');}
function settings(){const opts={stock:findChrome(),executable:null,controlsOnly:false,output:path.resolve('test-results/native-display-controls.json')};const args=process.argv.slice(2);
 for(let i=0;i<args.length;i++){const key=args[i];if(key==='--controls-only')opts.controlsOnly=true;else if(['--stock','--executable','--output'].includes(key)&&args[i+1])opts[key.slice(2)]=path.resolve(args[++i]);else throw new Error('Usage: native-display.cjs [--controls-only] [--stock Chrome] [--executable Chromium] [--output report.json]');}
 if(!opts.stock)throw new Error('Stock Chrome is required');if(!opts.executable)opts.controlsOnly=true;
 if(opts.executable&&!fs.existsSync(opts.executable))throw new Error('Native Chromium executable does not exist');
 if(opts.executable&&!args.includes('--output'))opts.output=path.resolve('test-results/native-display-acceptance.json');return opts;
}
(async()=>{
 let opts,origin,root;const browsers=[],checks=[];
 const report={schemaVersion:1,abi:ABI,scope:[...lock.preparedDisplayScope],p0Complete:false,buildPerformed:false,displayAccepted:false,checks};
 async function check(id,run){try{const detail=await run();checks.push({id,status:'passed',detail});console.log('PASS',id);}catch(error){checks.push({id,status:'failed',error:error.stack});console.error('FAIL',id,error.message);}}
 try{
  opts=settings();root=fs.mkdtempSync(path.join(os.tmpdir(),'star-native-display-'));origin=await startDisplayOrigin();
  function launch(executable,name,policy,scale){const switches=['--site-per-process','--force-device-scale-factor='+scale];if(policy)switches.push('--star-fingerprint-display='+[policy.width,policy.height,policy.availableWidth,policy.availableHeight,policy.depth].join(','));const browser=new NativeBrowser(executable,path.join(root,name),switches);browsers.push(browser);return browser;}
  const url=(policy,extra='')=>origin.url+'?'+new URLSearchParams({width:policy.width,height:policy.height,depth:policy.depth,scale:policy.scale})+extra;
  const requested={width:1600,height:900,availableWidth:1600,availableHeight:860,depth:24,scale:1.5};
  const plain=launch(opts.stock,'stock-baseline',null,requested.scale);const baseline=valid((await plain.probe(url(requested))).value);const version=await plain.send('Browser.getVersion');
  if(baseline.first.screen.width===requested.width)requested.width=requested.availableWidth=1280;
  const stock=launch(opts.stock,'stock-policy',requested,requested.scale),withPolicy=valid((await stock.probe(url(requested))).value);
  report.control={version:version.product,requested,baseline,withPolicy};
  await check('control.stock-rejects-display-policy',()=>{allScreens(withPolicy,baseline.first);assert.notEqual(withPolicy.first.screen.width,requested.width);return {actual:withPolicy.first.screen,requested};});
  await check('control.native-scale',()=>{for(const [scope,value] of Object.entries(all(withPolicy))){assert.equal(value.dpr,requested.scale,scope+' DPR');assert.equal(value.css.resolution,true,scope+' CSS resolution');}layoutMatches(withPolicy);return {dpr:requested.scale,layout:120};});
  await check('control.native-getters',()=>nativeGetters(withPolicy));
  await check('control.oopif',async()=>{const targets=(await stock.send('Target.getTargets')).targetInfos;const frames=targets.filter(target=>target.type==='iframe'&&target.url.startsWith('http://127.0.0.1:'+origin.port+'/frame'));assert.ok(frames.length>0,'Cross-origin measurement must use a real OOPIF');return frames.map(({type,url})=>({type,url}));});
  await plain.close();await stock.close();
  if(opts.controlsOnly){
   await check('control.no-injection',()=>{for(const browser of browsers)browser.noInjection();return {commands:[...new Set(browsers.flatMap(browser=>browser.commands))],extensions:false,emulationOverrides:false,preloadScripts:false};});
   report.status=checks.every(check=>check.status==='passed')?'stock-display-controls-verified':'stock-display-controls-failed';
  }else{
   const noPolicy=launch(opts.executable,'native-default',null,requested.scale);const normal=valid((await noPolicy.probe(url(requested)+'&default=1')).value);await noPolicy.close();report.nativeReference=normal;
   const candidate=launch(opts.executable,'native-persona',requested,requested.scale),runtime=await candidate.send('Browser.getVersion');
   report.binary={executable:fs.realpathSync(opts.executable),version:runtime.product.split('/').pop(),sourceCommit:runtime.revision?.replace(/^@/,''),platform:process.platform,arch:process.arch};
   assert.equal(report.binary.version,lock.version);assert.equal(report.binary.sourceCommit,lock.commit);
   const first=await candidate.probe(url(requested));const probe=valid(first.value);report.native={requested,probe};
   await check('native.display.first-script',()=>screenMatches(probe.first,requested,'First script'));
   for(const [scope,id] of Object.entries({page:'page',sameOrigin:'same-origin-frame',crossOrigin:'cross-origin-frame',srcdoc:'srcdoc',aboutBlank:'about-blank'}))await check('native.display.'+id,()=>screenMatches(probe.scopes[scope],requested,scope));
   await check('native.display.native-getters',()=>nativeGetters(probe));await check('native.display.css',()=>cssMatches(probe));await check('native.display.layout',()=>layoutMatches(probe));await check('native.display.repeat',()=>screenMatches(probe.repeat,requested,'Repeat'));
   await check('native.display.new-tab',async()=>{const value=(await candidate.probe(url(requested)+'&new-tab=1')).value;allScreens(value,requested);cssMatches(value);nativeGetters(value);});
   await check('native.display.navigation',async()=>{const value=(await candidate.probe(url(requested)+'&navigation=1',first.targetId)).value;allScreens(value,requested);cssMatches(value);});
   await candidate.close();const restart=launch(opts.executable,'native-persona',requested,requested.scale);const restarted=valid((await restart.probe(url(requested)+'&restart=1')).value);
   await check('native.display.restart',()=>{allScreens(restarted,requested);cssMatches(restarted);nativeGetters(restarted);});
   const portrait={width:1080,height:1920,availableWidth:1080,availableHeight:1860,depth:24,scale:1.25};const other=launch(opts.executable,'native-other',portrait,portrait.scale);const second=valid((await other.probe(url(portrait))).value);
   await check('native.display.profile-isolation',async()=>{allScreens(second,portrait);cssMatches(second);allScreens((await restart.probe(url(requested)+'&isolation=1')).value,requested);return {first:requested,second:portrait};});await other.close();await restart.close();
   const bad={...requested,availableWidth:requested.width+1};const invalid=launch(opts.executable,'native-invalid',bad,requested.scale);const fallback=valid((await invalid.probe(url(requested)+'&invalid=1')).value);
   await check('native.display.invalid-policy-fallback',()=>{allScreens(fallback,normal.first);nativeGetters(fallback);});
   await check('native.display.default-native',()=>{nativeGetters(normal);layoutMatches(normal);allScreens(normal,normal.first);});
   await check('control.no-injection',()=>{for(const browser of browsers)browser.noInjection();return {commands:[...new Set(browsers.flatMap(browser=>browser.commands))],extensions:false,emulationOverrides:false,preloadScripts:false};});
   report.status=REQUIRED.every(id=>checks.filter(check=>check.id===id&&check.status==='passed').length===1)?'display-accepted':'display-rejected';report.displayAccepted=report.status==='display-accepted';
   if(report.displayAccepted){const artifact=await browserArtifact(opts.executable);Object.assign(report.binary,{bundleSha256:artifact.bundleSha256,executableSha256:artifact.executableSha256,files:artifact.files,bytes:artifact.bytes});}
  }
  if(!['stock-display-controls-verified','display-accepted'].includes(report.status))process.exitCode=1;
 }catch(error){console.error(error);report.status='display-acceptance-error';report.error=error.stack;report.displayAccepted=false;process.exitCode=1;}
 finally{await Promise.allSettled(browsers.map(browser=>browser.close()));if(origin)await origin.close();report.testedAt=new Date().toISOString();report.platform=process.platform;report.arch=process.arch;const output=opts?.output||path.resolve('test-results/native-display-error.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');if(root)fs.rmSync(root,{recursive:true,force:true});console.log('Native display report:',report.status,output);}
})();
