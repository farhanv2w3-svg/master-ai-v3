import { classifyText, enforceModelPolicy, providerAllowlist } from '../security/policy.js';

export function preflight({goal, mode, env, requestedProvider, privacyMode='standard'}) {
  const classification = classifyText(goal);
  const allowlist = providerAllowlist(env);
  const candidateOrder = requestedProvider ? [requestedProvider, ...allowlist.filter(p=>p!==requestedProvider)] : ['gemini','groq','mock'];
  const hasConfiguredKey = p => p==='mock' || Boolean(env[({gemini:'GEMINI_API_KEY',groq:'GROQ_API_KEY',openai:'OPENAI_API_KEY',openrouter:'OPENROUTER_API_KEY',anthropic:'ANTHROPIC_API_KEY'})[p]]);
  const eligible = candidateOrder.filter(p => allowlist.includes(p)).filter(p => {
    try { enforceModelPolicy({provider:p,classification,mode:privacyMode,approvedProviders:allowlist,env}); return hasConfiguredKey(p); } catch { return false; }
  });
  if (!eligible.length) throw new Error('NO_ELIGIBLE_PROVIDER');
  const provider = eligible[0];
  const modelEnv = {gemini:'GEMINI_MODEL',groq:'GROQ_MODEL',openai:'OPENAI_MODEL',openrouter:'OPENROUTER_MODEL',anthropic:'ANTHROPIC_MODEL'};
  const stages = mode === 'industrial' ? ['Validate input data','Analyze energy/operations patterns','Generate recommendations','Safety and assumptions review'] : ['Understand request','Plan execution','Execute specialist workflow','Review result'];
  const warnings = requestedProvider && provider !== requestedProvider ? [`Requested provider '${requestedProvider}' was not eligible or had no configured key; selected '${provider}' instead.`] : [];
  return {classification, provider, model: provider==='mock'?'mock-reasoner':(env[modelEnv[provider]]||null), estimatedCalls:{min:1,max:mode==='industrial'?2:3,clearlyEstimated:true}, stages, constraints:[classification==='restricted'?'Restricted content: external model calls blocked.':'Data classification checked before provider selection.',mode==='industrial'?'Industrial mode is read-only; no machinery control is available.':'Task execution is bounded; generated code is not executed by the Worker.'], approvalRequired:classification!=='public' || mode==='industrial', privacyMode, warnings};
}
