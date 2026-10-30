import { registerHooks } from 'node:module';
const mock = `
export const ensureConfig = () => ({host:'127.0.0.1',port:Number(process.env.TEST_PORT),localToken:'test',requestTimeoutMs:1500,maxSessions:1,catalogRefreshMs:0});
export const updateConfig = () => ({});
export const authStatus = async () => ({status:'logged-in'});
export const needsRenewal = () => false;
export const login = async () => {};
export const resolveRetentionOk = async () => false;
export const loadCatalog = async () => ({catalog:[]});
export const buildRegistry = () => ({models:[{id:'test'}],selections:new Map()});
export const resolveSelection = () => ({id:'test'});
export const syncOpenCodeConfig = () => ({});
export const syncInstalledAgentConfigs = () => [];
export const catalogSummary = () => ({});
export const fetchCatalog = loadCatalog;
export const providerModels = () => ({});
export const Cursor = {};
export const Agent = {create: async () => ({
 close() {},
 async send(prompt, options) {
   let finish;
   const gate = new Promise(resolve => {finish=resolve});
   const listener = message => {if(message === 'finish') finish()};
   process.on('message', listener);
   process.send({env:options.mcpServers.client.env});
   return {id:'test-run',stream:async function*(){await gate;process.off('message',listener);yield {type:'assistant',message:{content:[{type:'text',text:'done'}]}}},wait:async()=>({status:'finished'}),cancel:async()=>finish()};
 }
})};
`;
registerHooks({resolve(specifier, context, next) {
 if (context.parentURL?.endsWith('/src/server.mjs') && ['@cursor/sdk','./config.mjs','./auth.mjs','./catalog.mjs','./clients.mjs','./retention.mjs'].includes(specifier)) return {url:'data:text/javascript,'+encodeURIComponent(mock),shortCircuit:true};
 return next(specifier,context);
}});
await import('../src/server.mjs');
