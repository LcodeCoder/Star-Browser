'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {displayMode, displaySnapshot, captureDisplay} = require('../src/main/display-settings');
const {generateFingerprint} = require('../src/main/fingerprint');
const {validateProfile} = require('../src/main/profile-validation');
const {applyDeviceMetrics} = require('../src/main/fingerprint-protocol');
const createRuntime = require('../src/extension/fp-core');

const display = {size:{width:1470,height:956},workAreaSize:{width:1470,height:918},colorDepth:24,scaleFactor:2};

test('新环境默认原生一致，已有尺寸或像素比继续使用自定义设置', () => {
  assert.equal(displayMode(), 'native');
  assert.equal(displayMode({hardwareConcurrency:4}), 'native');
  for (const old of [{screen:{width:1600,height:900}}, {devicePixelRatio:1.5}]) {
    assert.equal(displayMode(old), 'custom');
    assert.equal(displayMode({...old,displayMode:'native'}), 'native');
  }
  const native = generateFingerprint('display-test', {nativeDisplay:displaySnapshot(display)});
  assert.equal(native.displayMode,'native');
  assert.equal(native.nativeDisplayPending,false);
  assert.deepEqual(native.screen,displaySnapshot(display).screen);
  assert.equal(native.devicePixelRatio,2);
  assert.ok(native.nativeSignals.includes('screen'));
  const custom = generateFingerprint('display-test', {nativeDisplay:displaySnapshot(display),fingerprint:{devicePixelRatio:1.5,screen:{width:1600,height:900}}});
  assert.equal(custom.displayMode,'custom');
  assert.equal(custom.devicePixelRatio,1.5);
  assert.equal(custom.screen.width,1600);
});

test('显示策略持久化保留自定义值，拒绝非法模式且不会让旧配置自动转为原生', () => {
  const fingerprint={displayMode:'native',devicePixelRatio:1.5,screen:{width:1600,height:900}};
  const saved=validateProfile({fingerprint}).fingerprint;
  assert.equal(saved.displayMode,'native');
  assert.equal(saved.devicePixelRatio,1.5);
  assert.equal(saved.screen.width,1600);
  assert.equal(displayMode(validateProfile({fingerprint:{screen:fingerprint.screen}}).fingerprint),'custom');
  assert.throws(()=>validateProfile({fingerprint:{displayMode:'unknown'}}),error=>error.field==='fingerprint.displayMode');
});

test('原生显示清除顶层模拟，自定义显示继续发送真实 CDP 指标', async () => {
  const calls=[];
  const send=async(method,params)=>calls.push({method,params});
  await applyDeviceMetrics(send,{displayMode:'native'});
  assert.deepEqual(calls,[{method:'Emulation.clearDeviceMetricsOverride',params:{}}]);
  calls.length=0;
  await applyDeviceMetrics(send,{displayMode:'custom',screen:{width:1600,height:900},devicePixelRatio:1.5,os:'mac'});
  assert.equal(calls[0].method,'Emulation.setDeviceMetricsOverride');
  assert.equal(calls[0].params.deviceScaleFactor,1.5);
  assert.equal(calls[0].params.screenWidth,1600);
});

test('原生显示读取扣除页面缩放，失败不保存伪造或不完整的显示参数', async () => {
  const fp={displayMode:'native',nativeDisplayPending:true};
  const snapshot=displaySnapshot(display);
  await captureDisplay(async()=>({result:{value:{...snapshot,devicePixelRatio:2.5}}}),fp,1.25);
  assert.equal(fp.devicePixelRatio,2);
  assert.equal(fp.nativeDisplayPending,false);
  assert.deepEqual(fp.screen,snapshot.screen);
  const before=structuredClone(fp);
  for(const bad of [{devicePixelRatio:NaN,screen:snapshot.screen},{devicePixelRatio:2,screen:{width:0,height:900}},{devicePixelRatio:2}]) {
    await assert.rejects(()=>captureDisplay(async()=>({result:{value:bad}}),fp),/原生显示参数/);
    assert.deepEqual(fp,before);
  }
  assert.equal(displaySnapshot({size:display.size,scaleFactor:0}),null);
});

test('原生显示不安装 screen/DPR 覆盖，自定义转原生的已有包装也恢复原生读值', () => {
  const result=vm.runInNewContext(`
    class Navigator {get userAgent(){return 'native';}get platform(){return 'MacIntel';}get language(){return 'en-US';}get languages(){return Object.freeze(['en-US']);}}
    class Screen {get width(){if(!(this instanceof Screen))throw new TypeError('Illegal invocation');return 1470;}get height(){return 956;}get availWidth(){return 1470;}get availHeight(){return 918;}get colorDepth(){return 24;}get pixelDepth(){return 24;}}
    Object.assign(globalThis,{Navigator,Screen,navigator:new Navigator(),screen:new Screen()});
    Object.defineProperty(globalThis,'devicePixelRatio',{get(){return 2;},configurable:true});
    const original=Object.getOwnPropertyDescriptor(Screen.prototype,'width').get;
    const dpr=Object.getOwnPropertyDescriptor(globalThis,'devicePixelRatio').get;
    const cfg={displayMode:'native',nativeHardware:true,userAgent:'native',platform:'MacIntel',language:'en-US',languages:['en-US'],webrtc:'proxy',screen:{width:1600,height:900,availWidth:1600,availHeight:860,colorDepth:24,pixelDepth:24}};
    const runtime=(${createRuntime.toString()})(globalThis);
    runtime.installFingerprint(cfg);
    const untouched=Object.getOwnPropertyDescriptor(Screen.prototype,'width').get===original;
    runtime.installFingerprint({...cfg,displayMode:'custom'});
    const custom=screen.width;
    runtime.installFingerprint(cfg);
    ({untouched,custom,restored:screen.width,dprUntouched:Object.getOwnPropertyDescriptor(globalThis,'devicePixelRatio').get===dpr});
  `);
  assert.equal(result.untouched,true);
  assert.equal(result.custom,1600);
  assert.equal(result.restored,1470);
  assert.equal(result.dprUntouched,true);
});


test('原生显示诊断区分原生读值与跨框架/CSS 一致性，样式失败和未读取不会变成通过', () => {
  const {report}=require('../src/main/fingerprint-audit');
  const fp=generateFingerprint('native-display-audit',{nativeDisplay:displaySnapshot(display)});
  const page={ua:fp.userAgent,platform:fp.platform,language:fp.language,languages:fp.languages,locale:fp.language,numberLocale:fp.language,cpu:fp.hardwareConcurrency,memory:fp.deviceMemory,tz:fp.timezone,screen:'1920 × 1080',dpr:1.25,screenMedia:true,dprMedia:true,screenStyle:true,dprStyle:true};
  const observed={page,worker:page,contexts:[{type:'iframe',url:'https://frame.test/',value:{...page,dprStyle:false}}]};
  const failed=report(fp,observed,{engine:'test',url:'https://example.test/'});
  assert.equal(failed.differences,1);
  assert.equal(failed.rows.find(row=>row.context==='网页'&&row.label==='屏幕尺寸').state,'native');
  assert.equal(failed.rows.find(row=>row.context==='网页'&&row.label==='屏幕尺寸').expected,null);
  assert.equal(failed.rows.find(row=>row.context==='iframe 1'&&row.label==='CSS 像素比 @media 样式').state,'different');
  const blocked=report(fp,{...observed,page:{...page,screenStyle:null,dprStyle:null},contexts:[]},{engine:'test',url:'https://example.test/'});
  assert.equal(blocked.rows.find(row=>row.context==='CSS'&&row.label==='屏幕 @media 样式').state,'unknown');
  assert.equal(blocked.rows.find(row=>row.context==='CSS'&&row.label==='像素比 @media 样式').state,'unknown');
  assert.ok(blocked.unknown>=2);
});
