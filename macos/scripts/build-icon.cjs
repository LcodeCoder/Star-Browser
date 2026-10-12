'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,'..'),directory=path.join(root,'build/icon.iconset');fs.mkdirSync(directory,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-background-networking']});
 try{const page=await browser.newPage({viewport:{width:1024,height:1024},deviceScaleFactor:1});await page.setContent(`<html><body style="margin:0;background:transparent">${fs.readFileSync(path.join(root,'src/renderer/assets/star.svg'),'utf8')}</body></html>`);await page.screenshot({path:path.join(root,'build/icon.png'),omitBackground:true});}
 finally{await browser.close();}
 for(const size of [16,32,128,256,512])for(const scale of [1,2])execFileSync('sips',['-z',String(size*scale),String(size*scale),path.join(root,'build/icon.png'),'--out',path.join(directory,`icon_${size}x${size}${scale===2?'@2x':''}.png`)],{stdio:'pipe'});
 execFileSync('iconutil',['-c','icns',directory,'-o',path.join(root,'build/icon.icns')],{stdio:'pipe'});console.log('Star macOS icon built.');
})().catch(error=>{console.error(error);process.exitCode=1;});
