"use strict";
const {randomBytes}=require('node:crypto');
const createRuntime=require('../extension/fp-core');
const inject=require('../extension/inject');
const {metadata}=require('./fingerprint-protocol');
// Shared by preload, CDP, and the generated extension in this application process.
const eventType=randomBytes(24).toString('hex');
function fingerprintSource(config){
  const value={...config,userAgentMetadata:config.userAgentMetadata||metadata(config)};
  return '('+inject.toString()+')('+JSON.stringify(value)+','+JSON.stringify(eventType)+','+createRuntime.toString()+');';
}
module.exports={fingerprintSource};
