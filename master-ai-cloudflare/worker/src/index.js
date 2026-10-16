import { authorizeRequest, authorizeDataAccess, classifyText, redact, providerAllowlist } from './security/policy.js';
import { guardedListModels, guardedChat } from './security/model-gateway.js';
import { preflight } from './services/resource-manager.js';
import { createTask, getTask, listTasks, updateTask, audit, events } from './services/store.js';
import { executeTask, resumeTask } from './services/orchestrator.js';
import { AGENTS } from './agents/registry.js';
import { analyzeEnergy } from './agents/industrial.js';

const json=(data,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const errorResponse=(e)=>{
  const known={UNAUTHORIZED:401,AUTH_NOT_CONFIGURED:503,FORBIDDEN_TENANT:403,TASK_NOT_FOUND:404,TASK_NOT_RESUMABLE:409,NO_ELIGIBLE_PROVIDER:403,PROVIDER_NOT_ALLOWED:403,LOCAL_ONLY_BLOCKED:403,RESTRICTED_DATA_EXTERNAL_BLOCKED:403,CLOUD_MODELS_DISABLED:403};
  const code=e?.code||e?.message||'INTERNAL_ERROR';
  const status=known[code]||known[e?.message]||(code==='MISSING_KEY'?400:code==='RATE_LIMITED'?429:400);
  return json({error:{code,message:publicMessage(code,e?.message)}},status);
};
function publicMessage(code,message) {
  const safe={UNAUTHORIZED:'Valid bearer token required.',AUTH_NOT_CONFIGURED:'Set MASTER_API_TOKEN to a random secret of at least 24 characters.',FORBIDDEN_TENANT:'Access denied for this tenant.',TASK_NOT_FOUND:'Task not found.',TASK_NOT_RESUMABLE:'Task is not in a resumable state.',NO_ELIGIBLE_PROVIDER:'No provider is eligible under the current security policy.',PROVIDER_NOT_ALLOWED:'Provider is not allowed by the server policy.',LOCAL_ONLY_BLOCKED:'Local-only mode blocks external provider requests.',RESTRICTED_DATA_EXTERNAL_BLOCKED:'Restricted data cannot be sent to external model providers.',CLOUD_MODELS_DISABLED:'Cloud model providers are disabled.',MISSING_KEY:'The selected provider API key is not configured as a Worker secret.',MODEL_REQUIRED:'Select a model discovered from the provider or configure a model override.',RATE_LIMITED:'Provider rate limit reached. Pause and retry later.'};
  if(safe[code]) return safe[code];
  return redact(String(message||'Request failed.')).slice(0,300);
}
function cors(request, response, env) {
  const origin=request.headers.get('origin'); const headers=new Headers(response.headers);
  // Never reflect arbitrary origins; set PAGES_ORIGIN to the exact deployed Pages origin.
  const allowed=(env.PAGES_ORIGIN || '').replace(/\/$/,'');
  if(origin && allowed && origin===allowed) { headers.set('access-control-allow-origin',origin); headers.set('vary','Origin'); }
  headers.set('access-control-allow-methods','GET,POST,OPTIONS'); headers.set('access-control-allow-headers','Authorization,Content-Type'); headers.set('access-control-max-age','86400');
  return new Response(response.body,{status:response.status,headers});
}

async function handle(request,env,ctx) {
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers:{'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'Authorization,Content-Type','access-control-max-age':'86400'}});
  const url=new URL(request.url);
  try {
   if(url.pathname==='/health' && request.method==='GET') return json({ok:true,service:'master-ai-worker',version:'0.1.0',mode:env.APP_ENV||'development'});
   const principal=authorizeRequest(request,env);
   if(!env.DB) throw new Error('DATABASE_NOT_CONFIGURED');
   if(url.pathname==='/api/meta' && request.method==='GET') return json({modes:['normal','industrial'],agents:Object.values(AGENTS),providers:providerAllowlist(env),security:{tenantModel:'single tenant per Worker deployment',restrictedDataExternalCalls:false,industrialControl:'not available',mockModeAvailable:true}});
   if(url.pathname==='/api/providers/models' && request.method==='POST') {
    const body=await request.json(); const provider=String(body.provider||'mock');
    const models=await guardedListModels({provider,env,classification:'public',privacyMode:body.privacyMode||'standard'});
    return json({provider,models});
   }
   if(url.pathname==='/api/industrial/energy' && request.method==='POST') {
    const body=await request.json(); const result=analyzeEnergy(body.readings);
    return json({result,source:'deterministic-local-calculation'});
   }
   if(url.pathname==='/api/tasks' && request.method==='GET') return json({tasks:await listTasks(env.DB,principal.tenantId)});
   if(url.pathname==='/api/tasks' && request.method==='POST') {
    const body=await request.json(); const goal=String(body.goal||'').trim(); const mode=body.mode==='industrial'?'industrial':'normal';
    if(!goal || goal.length>12000) return json({error:{code:'INVALID_GOAL',message:'Goal must contain 1–12000 characters.'}},400);
    const privacyMode=['standard','local-only'].includes(body.privacyMode)?body.privacyMode:'standard';
    const plan=preflight({goal,mode,env,requestedProvider:body.provider,privacyMode});
    const requestedModel=typeof body.model==='string'?body.model.trim().slice(0,200):''; if(requestedModel) plan.model=requestedModel;
    const id=crypto.randomUUID(); const needsApproval=true; // Always show preflight and require explicit approval before execution.
    const safeGoal=redact(goal);
    const task={id,tenantId:principal.tenantId,mode,goal:safeGoal,status:needsApproval?'awaiting_approval':'queued',stage:needsApproval?'Awaiting user approval':'Preflight approved',provider:plan.provider,model:body.model||plan.model,checkpoint:{stage:'preflight',plan},usage:{calls:0}};
    await createTask(env.DB,task); await audit(env.DB,principal.tenantId,id,'resource.preflight','Resource preflight completed.',plan);
    if(needsApproval && body.approved!==true) return json({taskId:id,status:'awaiting_approval',preflight:plan,message:'Review the plan and explicitly approve execution.'},201);
    try { const result=await executeTask({db:env.DB,env,principal,taskId:id,goal:safeGoal,mode,provider:task.provider,model:task.model,privacyMode}); return json({taskId:id,status:'completed',preflight:plan,result},201); }
    catch(e) { await updateTask(env.DB,principal.tenantId,id,{status:e?.code==='RATE_LIMITED'?'paused_rate_limited':'failed',stage:'Paused or failed',error:redact(e?.message||'Execution failed')}); await audit(env.DB,principal.tenantId,id,'task.failed','Execution did not complete.',{code:e?.code||e?.message}); return errorResponse(e); }
   }
   const approve=url.pathname.match(/^\/api\/tasks\/([\w-]+)\/approve$/);
   if(approve && request.method==='POST') {
    const task=await getTask(env.DB,principal.tenantId,approve[1]); if(!task) throw new Error('TASK_NOT_FOUND');
    authorizeDataAccess(principal,task.tenant_id);
    if(task.status!=='awaiting_approval') throw new Error('TASK_NOT_AWAITING_APPROVAL');
    const body=await request.json().catch(()=>({}));
    if(body.approved!==true) return json({error:{code:'APPROVAL_REQUIRED',message:'Send {"approved":true} to proceed.'}},400);
    const cp=JSON.parse(task.checkpoint_json||'{}'); const privacyMode=cp.plan?.privacyMode||'standard';
    try {
     const result=await executeTask({db:env.DB,env,principal,taskId:task.id,goal:task.goal,mode:task.mode,provider:task.provider,model:task.model,privacyMode});
     return json({taskId:task.id,status:'completed',result});
    } catch(e) {
     await updateTask(env.DB,principal.tenantId,task.id,{status:e?.code==='RATE_LIMITED'?'paused_rate_limited':'failed',stage:'Paused or failed',error:redact(e?.message||'Execution failed')});
     await audit(env.DB,principal.tenantId,task.id,'task.failed','Approved execution did not complete.',{code:e?.code||e?.message});
     return errorResponse(e);
    }
   }
   const resume=url.pathname.match(/^\/api\/tasks\/([\w-]+)\/resume$/);
   if(resume && request.method==='POST') { const body=await request.json().catch(()=>({})); const result=await resumeTask({db:env.DB,env,principal,taskId:resume[1],provider:body.provider,model:body.model}); return json({taskId:resume[1],result}); }
   const agentHistory=url.pathname.match(/^\/api\/tasks\/([\w-]+)\/agent-messages$/);
   if(agentHistory && request.method==='GET') {
    const task=await getTask(env.DB,principal.tenantId,agentHistory[1]); if(!task) throw new Error('TASK_NOT_FOUND'); authorizeDataAccess(principal,task.tenant_id);
    const rows=await env.DB.prepare('SELECT agent_id,role,content,created_at FROM agent_messages WHERE tenant_id=? AND task_id=? ORDER BY created_at ASC LIMIT 100').bind(principal.tenantId,task.id).all();
    return json({messages:(rows.results||[]).map(m=>({...m,content:m.role==='assistant'?m.content:redact(m.content)}))});
   }
   const agentMessage=url.pathname.match(/^\/api\/tasks\/([\w-]+)\/agent-message$/);
   if(agentMessage && request.method==='POST') {
    const task=await getTask(env.DB,principal.tenantId,agentMessage[1]); if(!task) throw new Error('TASK_NOT_FOUND'); authorizeDataAccess(principal,task.tenant_id);
    const body=await request.json(); const message=String(body.message||'').trim(); if(!message||message.length>4000) return json({error:{code:'INVALID_MESSAGE',message:'Message must contain 1–4000 characters.'}},400);
    const checkpoint=JSON.parse(task.checkpoint_json||'{}'); const plan=checkpoint.plan||{}; const classification=plan.classification==='restricted'?'restricted':classifyText(`${task.goal}\n${message}`);
    const provider=task.provider||'mock'; const model=task.model||undefined;
    const answer=await guardedChat({provider,model,env,classification,privacyMode:plan.privacyMode||'standard',maxTokens:900,messages:[{role:'user',content:`You are a scoped specialist working only on this task. Original task: ${task.goal.slice(0,5000)}\nYour answer must address this user's scoped update and must not claim unperformed actions. Industrial tasks are read-only and must never direct machinery control.\nScoped user update: ${message}`} ]});
    await env.DB.prepare('INSERT INTO agent_messages (id,tenant_id,task_id,agent_id,role,content,created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),principal.tenantId,task.id,body.agentId||'assigned-specialist','user',redact(message),new Date().toISOString()).run();
    await env.DB.prepare('INSERT INTO agent_messages (id,tenant_id,task_id,agent_id,role,content,created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),principal.tenantId,task.id,body.agentId||'assigned-specialist','assistant',redact(answer.text),new Date().toISOString()).run();
    await audit(env.DB,principal.tenantId,task.id,'subagent.message','Scoped subagent follow-up processed.',{agentId:body.agentId||'assigned-specialist',provider:answer.provider,mock:answer.mock});
    return json({agentId:body.agentId||'assigned-specialist',response:redact(answer.text),provider:answer.provider,model:answer.model,mock:answer.mock});
   }
   const eventsMatch=url.pathname.match(/^\/api\/tasks\/([\w-]+)\/events$/);
   if(eventsMatch && request.method==='GET') { const task=await getTask(env.DB,principal.tenantId,eventsMatch[1]); if(!task) throw new Error('TASK_NOT_FOUND'); authorizeDataAccess(principal,task.tenant_id); return json({taskId:task.id,events:await events(env.DB,principal.tenantId,task.id)}); }
   const taskMatch=url.pathname.match(/^\/api\/tasks\/([\w-]+)$/);
   if(taskMatch && request.method==='GET') { const task=await getTask(env.DB,principal.tenantId,taskMatch[1]); if(!task) throw new Error('TASK_NOT_FOUND'); authorizeDataAccess(principal,task.tenant_id); return json({task:{...task,checkpoint:JSON.parse(task.checkpoint_json||'{}'),usage:JSON.parse(task.usage_json||'{}'),result:task.result?JSON.parse(task.result):null,error:task.error?redact(task.error):null}}); }
   return json({error:{code:'NOT_FOUND',message:'Route not found.'}},404);
  } catch(e) {
   const response=errorResponse(e);
   // Do not log raw prompts, credentials, or provider response bodies.
   console.error(JSON.stringify({event:'request.error',code:e?.code||e?.message||'INTERNAL_ERROR',path:url.pathname}));
   return response;
  }
}

export default { fetch: async (request, env, ctx) => cors(request, await handle(request, env, ctx), env) };
