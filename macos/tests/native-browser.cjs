'use strict';
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {CdpPipe}=require('../src/main/cdp-pipe');

class NativeBrowser {
  constructor(executable,userData,switches=[]) {
    const args=['--user-data-dir='+userData,'--remote-debugging-pipe','--no-first-run','--no-default-browser-check',
      '--disable-background-networking','--disable-extensions'];
    args.push(...switches);
    args.push('about:blank');this.commands=[];this.stderr='';
    this.child=spawn(executable,args,{stdio:['ignore','ignore','pipe','pipe','pipe'],windowsHide:true});
    this.child.stderr.on('data',chunk=>{this.stderr=(this.stderr+chunk).slice(-4000);});
    this.pipe=new CdpPipe(this.child);
  }
  send(method,params={},sessionId,timeout) {
    this.commands.push(method);return this.pipe.send(method,params,sessionId,timeout);
  }
  async probe(url,targetId) {
    if(!targetId)targetId=(await this.send('Target.createTarget',{url:'about:blank'})).targetId;
    const {sessionId}=await this.send('Target.attachToTarget',{targetId,flatten:true});
    await this.send('Page.enable',{},sessionId);
    const navigation=await this.send('Page.navigate',{url},sessionId);
    if(navigation.errorText)throw new Error('Native probe navigation failed: '+navigation.errorText);
    const deadline=Date.now()+60000;
    while(Date.now()<deadline) {
      const result=await this.send('Runtime.evaluate',{expression:'location.href === '+JSON.stringify(url)+' ? window.__nativeResult || null : null',awaitPromise:true,returnByValue:true},sessionId,60000);
      if(result.exceptionDetails)throw new Error(result.exceptionDetails.text || 'Native probe execution failed');
      if(result.result?.value)return {targetId,value:result.result.value};
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw new Error('Native measurement timed out');
  }
  noInjection() {
    assert.ok(!this.commands.some(method=>method.startsWith('Emulation.')||method==='Page.addScriptToEvaluateOnNewDocument'||method==='Extensions.loadUnpacked'));
  }
  async close() {
    await this.send('Browser.close',{},undefined,3000).catch(()=>{});
    if(this.child.exitCode===null && this.child.signalCode===null) {
      await new Promise(resolve=>{
        const finish=()=>{clearTimeout(timer);this.child.removeListener('exit',finish);resolve();};
        const timer=setTimeout(()=>{this.child.kill();finish();},2500);this.child.once('exit',finish);
      });
    }
    this.pipe.close();
  }
}
module.exports={NativeBrowser};
