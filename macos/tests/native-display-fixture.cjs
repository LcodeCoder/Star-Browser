'use strict';
const http=require('node:http');

// This is a measuring page: it reads native APIs and never replaces a getter,
// installs a preload script, changes an API prototype or calls CDP Emulation.
function displayProbe(query) {
  const fields=['width','height','availWidth','availHeight','colorDepth','pixelDepth'];
  const values=Object.fromEntries(fields.map(key=>[key,screen[key]]));
  const descriptors={};
  for(const key of fields){
    const descriptor=Object.getOwnPropertyDescriptor(Screen.prototype,key);let illegalReceiver=false;
    try{descriptor.get.call({});}catch(error){illegalReceiver=error instanceof TypeError;}
    descriptors[key]={native:/\[native code\]/.test(Function.prototype.toString.call(descriptor.get)),name:descriptor.get.name,length:descriptor.get.length,illegalReceiver};
  }
  const dprGetter=Object.getOwnPropertyDescriptor(window,'devicePixelRatio')?.get;
  let illegalDprReceiver=false;try{dprGetter.call({});}catch(error){illegalDprReceiver=error instanceof TypeError;}
  const box=document.createElement('div');box.style.cssText='width:120px;height:30px;position:fixed;left:0;top:0';document.documentElement.append(box);const layoutWidth=box.getBoundingClientRect().width;box.remove();
  return {screen:values,dpr:devicePixelRatio,orientation:{type:screen.orientation.type,angle:screen.orientation.angle},descriptors,
    dprGetter:{native:/\[native code\]/.test(Function.prototype.toString.call(dprGetter)),illegalReceiver:illegalDprReceiver},
    functionToStringNative:/\[native code\]/.test(Function.prototype.toString.call(Function.prototype.toString)),
    css:{width:matchMedia('(device-width:'+query.width+'px)').matches,height:matchMedia('(device-height:'+query.height+'px)').matches,
      aspectRatio:matchMedia('(device-aspect-ratio:'+query.width+'/'+query.height+')').matches,
      resolution:matchMedia('(resolution:'+query.scale+'dppx)').matches,color:matchMedia('(color:'+query.depth/3+')').matches},
    viewport:{width:innerWidth,height:innerHeight},layoutWidth};
}
function measuringScript(query){return '('+displayProbe.toString()+')('+JSON.stringify(query)+')';}
function framePage(query){return '<!doctype html><title>Native display frame</title><script>window.__displayFrame='+measuringScript(query)+';<\/script>';
}
async function startDisplayOrigin(){
 const server=http.createServer((request,response)=>{
  const url=new URL(request.url,'http://localhost');
  const query={width:Number(url.searchParams.get('width'))||1600,height:Number(url.searchParams.get('height'))||900,depth:Number(url.searchParams.get('depth'))||24,scale:Number(url.searchParams.get('scale'))||1.5};
  response.setHeader('Content-Type','text/html; charset=utf-8');response.setHeader('Cache-Control','no-store');
  if(url.pathname==='/frame'){const html=framePage(query).replace('<\/script>',';parent.postMessage({type:"star-native-display-frame",value:window.__displayFrame},"*");<\/script>');response.end(html);return;}
  if(url.pathname!=='/probe'){response.statusCode=404;response.end('Not found');return;}
  const port=server.address().port,params=new URLSearchParams(query).toString(),cross='http://127.0.0.1:'+port+'/frame?'+params;
  const html='<!doctype html><title>Star native display measurement</title><script>'+`
    const first=${measuringScript(query)};
    const read=()=>${measuringScript(query)};
    const sampleSource=${JSON.stringify(measuringScript(query))};
    const crossUrl=${JSON.stringify(cross)};
    const localUrl=${JSON.stringify('http://localhost:'+port+'/frame?'+params)};
    async function run(){
      const scopes={page:read()};
      async function frame(name,src,srcdoc){
        const element=document.createElement('iframe');element.style.cssText='width:300px;height:200px';
        let timer;const result=new Promise((resolve,reject)=>{
          timer=setTimeout(()=>reject(new Error(name+' frame timeout')),15000);
          if(name==='crossOrigin'){
            const receive=event=>{if(event.source!==element.contentWindow||event.origin!==new URL(crossUrl).origin||event.data?.type!=='star-native-display-frame')return;window.removeEventListener('message',receive);clearTimeout(timer);resolve(event.data.value);};window.addEventListener('message',receive);
          }else element.onload=()=>{clearTimeout(timer);try{resolve(element.contentWindow.__displayFrame);}catch(error){reject(error);}};
        });
        if(srcdoc)element.srcdoc=srcdoc;else element.src=src;document.documentElement.append(element);scopes[name]=await result;
      }
      await frame('sameOrigin',localUrl);
      await frame('crossOrigin',crossUrl);
      await frame('srcdoc',null,${JSON.stringify(framePage(query)).replaceAll('<','\\u003c')});
      const blank=document.createElement('iframe');document.documentElement.append(blank);scopes.aboutBlank=blank.contentWindow.eval(sampleSource);
      return {first,scopes,repeat:read(),location:location.origin};
    }
    run().then(value=>window.__nativeResult=value).catch(error=>window.__nativeResult={error:error.stack});
  `+'<\/script>';
  response.end(html);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:'http://localhost:'+server.address().port+'/probe',port:server.address().port,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}
module.exports={startDisplayOrigin,displayProbe};
