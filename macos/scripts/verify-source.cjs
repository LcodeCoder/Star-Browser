'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const asar=require('@electron/asar');
const root=path.resolve(__dirname,'..');
const original=path.join(root,'../ChangYiBrowser-electron-extract');
const sha=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const files=(dir,base=dir)=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
 const target=path.join(dir,entry.name);return entry.isDirectory()?files(target,base):[path.relative(base,target)];
});
const javascript=files(path.join(root,'src')).filter(name=>name.endsWith('.js'));
for(const name of javascript)execFileSync(process.execPath,['--check',path.join(root,'src',name)],{stdio:'pipe'});
const archive=path.join(original,'original/app.asar');
const installerReport=path.join(root,'test-results/installer-verification.json');
if(!fs.existsSync(archive)||!fs.existsSync(installerReport)){
 const result={status:'source-unavailable',checkedAt:new Date().toISOString(),reason:'原始安装包提取目录或 installer-verification.json 不在当前工作区；仅完成当前源码语法检查，不伪造逐文件溯源结果。',javascriptSyntaxPassed:javascript.length};
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});fs.writeFileSync(path.join(root,'test-results/source-verification.json'),JSON.stringify(result,null,2)+'\n');
 console.warn('Source provenance unavailable: original asar evidence is not present; current source syntax passed for '+javascript.length+' JavaScript files.');
 process.exit(0);
}
const raw=fs.mkdtempSync(path.join(os.tmpdir(),'star-asar-'));
try{
 asar.extractAll(archive,raw);
 const archived=files(raw),copied=[];
 const modifications=new Set(['package.json','src/main/main.js','src/main/launcher.js','src/main/store.js','src/main/local-proxy.js','src/main/proxy-parse.js','src/preload/preload.js','src/renderer/browser-shell.js','src/extension/background.js','src/main/fingerprint.js','src/extension/fp-core.js','src/extension/manifest.json','src/extension/config.js','src/extension/inject.js','src/main/browser-preload.js','src/renderer/index.html','src/renderer/browser-shell.html','src/renderer/home.html','src/renderer/tutorial.html']);
 for(const name of archived){const target=path.join(root,name);if(!fs.existsSync(target))throw new Error('缺失原始文件：'+name);const baseline=fs.readFileSync(path.join(original,'extracted',name));const current=fs.readFileSync(target),changed=!baseline.equals(current);if(changed&&!modifications.has(name))throw new Error('未记录的源码改动：'+name);copied.push({path:name,archivedSha256:sha(fs.readFileSync(path.join(raw,name))),baselineSha256:sha(baseline),macosSha256:sha(current),changedForMacOS:changed});}
 const installer=JSON.parse(fs.readFileSync(installerReport,'utf8'));
 if(!installer.matches||installer.installerAsarSha256!==sha(fs.readFileSync(archive)))throw new Error('Windows 安装包与保留资源包不一致');
 const result={status:'passed',checkedAt:new Date().toISOString(),skill:'baoyu-skills-main / baoyu-electron-extract 1.119.0',installerSha256:installer.installerSha256,sourceAsarSha256:sha(fs.readFileSync(archive)),originalFiles:archived.length,copiedOriginalFiles:copied.length,addedRuntimeFiles:files(path.join(root,'src')).map(name=>'src/'+name).filter(name=>!archived.includes(name)),javascriptSyntaxPassed:javascript.length,files:copied};
 fs.writeFileSync(path.join(root,'test-results/source-verification.json'),JSON.stringify(result,null,2)+'\n');console.log(`Source verified: all ${copied.length} original files present; ${javascript.length} JavaScript files passed syntax checks.`);
}finally{fs.rmSync(raw,{recursive:true,force:true});}
