import { guardedChat } from '../security/model-gateway.js';
import { chooseAgent } from '../agents/registry.js';
import { analyzeEnergy } from '../agents/industrial.js';
import { classifyText, enforceModelPolicy, providerAllowlist, redact } from '../security/policy.js';
import { audit, getTask, updateTask } from './store.js';

export async function executeTask({db,env,principal,taskId,goal,mode,provider,model,privacyMode='standard',resume=false}) {
  const tenantId=principal.tenantId;
  const existing=await getTask(db,tenantId,taskId);
  const checkpoint=existing?JSON.parse(existing.checkpoint_json||'{}'):{};
  const classification=checkpoint.plan?.classification || classifyText(goal);
  const effectivePrivacyMode=checkpoint.plan?.privacyMode || privacyMode;
  const approved=providerAllowlist(env);
  enforceModelPolicy({provider,classification,mode:effectivePrivacyMode,approvedProviders:approved,env});
  if (mode==='industrial' && /energy|electric|kwh|bill|power/.test(goal.toLowerCase())) {
    await updateTask(db,tenantId,taskId,{status:'running',stage:'Analyzing supplied energy readings'});
    await audit(db,tenantId,taskId,'stage.started','Running deterministic industrial energy calculations.');
    let data; try { data=JSON.parse(goal.match(/\{[\s\S]*\}/)?.[0]||''); } catch { data=null; }
    if (data?.readings || Array.isArray(data)) {
      const result=analyzeEnergy(data);
      await updateTask(db,tenantId,taskId,{status:'completed',stage:'Completed',result:JSON.stringify(result),checkpoint_json:JSON.stringify({stage:'completed',result})});
      await audit(db,tenantId,taskId,'task.completed','Industrial energy analysis completed without external model calls.');
      return {result,provider:'local-calculation',model:'deterministic-energy-v1',usage:{calls:0},mock:false};
    }
  }
  await updateTask(db,tenantId,taskId,{status:'running',stage:resume?'Resuming from checkpoint':'Preparing specialist agent'});
  await audit(db,tenantId,taskId,resume?'task.resumed':'agent.selected',resume?'Resuming from saved checkpoint.':'Selected specialist agent.',{agent:chooseAgent(mode,goal).id});
  const agent=chooseAgent(mode,goal);
  const minimizedGoal=redact(goal.slice(0,12000));
  const system=`You are Master AI, a practical assistant in ${mode} mode. You are executing as the ${agent.name}. Keep output useful and structured. Do not claim tool execution or external research that did not occur. For industrial work, analysis/recommendations only; never direct machinery control. Data classification is ${classification}.`;
  const messages=[{role:'user',content:`${system}\n\nTask:\n${minimizedGoal}\n\n${checkpoint.note?`Prior checkpoint (completed work; do not claim more than it contains): ${checkpoint.note}`:''}`}];
  await updateTask(db,tenantId,taskId,{stage:`Running ${agent.name}`,provider,model});
  await audit(db,tenantId,taskId,'provider.request','Submitting minimized task context through the policy-gated provider adapter.',{provider,model,classification,agent:agent.id});
  const response=await guardedChat({provider,model,messages,env,maxTokens:1200,classification,privacyMode:effectivePrivacyMode});
  const result={summary:redact(response.text),agent:{id:agent.id,name:agent.name},provider:response.provider,model:response.model,mock:response.mock,classification,industrialSafety:mode==='industrial'?'Analysis/recommendations only; human review required.':undefined};
  await updateTask(db,tenantId,taskId,{status:'completed',stage:'Completed',provider:response.provider,model:response.model,result:JSON.stringify(result),usage_json:JSON.stringify(response.usage),checkpoint_json:JSON.stringify({stage:'completed',note:redact(response.text).slice(0,3000)})});
  await audit(db,tenantId,taskId,'task.completed','Task completed.',{provider:response.provider,model:response.model,calls:response.usage.calls,mock:response.mock});
  return {...result,usage:response.usage};
}

export async function resumeTask({db,env,principal,taskId,provider,model}) {
  const row=await getTask(db,principal.tenantId,taskId); if(!row) throw new Error('TASK_NOT_FOUND');
  if(!['paused_rate_limited','paused_quota','paused_user','failed'].includes(row.status)) throw new Error('TASK_NOT_RESUMABLE');
  const checkpoint=JSON.parse(row.checkpoint_json||'{}');
  const privacyMode=checkpoint.plan?.privacyMode||'standard';
  const classification=checkpoint.plan?.classification||classifyText(row.goal);
  const chosenProvider=privacyMode==='local-only'||classification==='restricted'?'mock':(provider||row.provider||'mock');
  const result=await executeTask({db,env,principal,taskId,goal:row.goal,mode:row.mode,provider:chosenProvider,model:model||row.model,privacyMode,resume:true});
  return result;
}
