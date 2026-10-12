'use strict';
const esbuild = require('esbuild');
const path = require('node:path');
esbuild.build({entryPoints:[path.join(__dirname,'../ui/workbench.jsx')],bundle:true,outfile:path.join(__dirname,'../src/renderer/workbench.js'),minify:true,sourcemap:false,target:'chrome152',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},legalComments:'linked'}).then(()=>console.log('Star workbench built.')).catch(()=>process.exit(1));
