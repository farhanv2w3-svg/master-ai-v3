import { redact } from '../security/policy.js';

export class ProviderError extends Error {
  constructor(code, message, retryable = false, retryAfter = null) { super(message); this.name='ProviderError'; this.code=code; this.retryable=retryable; this.retryAfter=retryAfter; }
}

export async function listModels(provider, env) {
  if (provider === 'mock') return [{id:'mock-reasoner', name:'Mock Reasoner', capabilities:['text'], contextLimit:null}];
  if (provider === 'gemini') {
    requireKey(env.GEMINI_API_KEY, 'Gemini');
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', { headers: { 'x-goog-api-key': env.GEMINI_API_KEY } });
    const data = await readJson(response, 'gemini');
    return (data.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => ({id:m.name.replace(/^models\//,''),name:m.displayName || m.name,capabilities:['text'],contextLimit:m.inputTokenLimit || null}));
  }
  if (provider === 'openai' || provider === 'openrouter') {
    const key=env[provider==='openai'?'OPENAI_API_KEY':'OPENROUTER_API_KEY']; requireKey(key,provider);
    const base=provider==='openai'?'https://api.openai.com/v1':'https://openrouter.ai/api/v1';
    const response = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${key}` } });
    const data = await readJson(response, provider);
    return (data.data || []).map(m => ({id:m.id,name:m.name || m.id,capabilities:['text'],contextLimit:m.context_length || null}));
  }
  if (provider === 'anthropic') {
    requireKey(env.ANTHROPIC_API_KEY, 'Anthropic');
    // Anthropic does not provide the same generally available model-list endpoint here; use configured model fallback.
    return (env.ANTHROPIC_MODELS || '').split(',').map(x=>x.trim()).filter(Boolean).map(id=>({id,name:id,capabilities:['text'],contextLimit:null}));
  }
  if (provider === 'groq') {
    requireKey(env.GROQ_API_KEY, 'Groq');
    const response = await fetch('https://api.groq.com/openai/v1/models', { headers: { authorization: `Bearer ${env.GROQ_API_KEY}` } });
    const data = await readJson(response, 'groq');
    return (data.data || []).map(m => ({id:m.id,name:m.id,capabilities:['text'],contextLimit:m.context_window || null}));
  }
  throw new ProviderError('MODEL_DISCOVERY_UNSUPPORTED', `Model discovery is not implemented for ${provider}.`);
}

export async function chatCompletion({provider, model, messages, env, maxTokens = 1200}) {
  if (provider === 'mock') return {text:mockReply(messages), provider, model:model || 'mock-reasoner', usage:{calls:1, inputTokens:null, outputTokens:null}, mock:true};
  if (provider === 'gemini') {
    requireKey(env.GEMINI_API_KEY, 'Gemini');
    const chosen = model || env.GEMINI_MODEL;
    if (!chosen) throw new ProviderError('MODEL_REQUIRED','Choose a model from model discovery first.');
    const contents = messages.map(m => ({role:m.role === 'assistant' ? 'model' : 'user', parts:[{text:`${m.role.toUpperCase()}: ${m.content}` }]}));
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(chosen)}:generateContent`, {method:'POST',headers:{'content-type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},body:JSON.stringify({contents,generationConfig:{maxOutputTokens:maxTokens,temperature:0.2}})});
    const data = await readJson(response,'gemini');
    const text = data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('') || '';
    if (!text) throw new ProviderError('EMPTY_RESPONSE','Gemini returned an empty response.');
    return {text,provider,model:chosen,usage:{calls:1,inputTokens:data.usageMetadata?.promptTokenCount ?? null,outputTokens:data.usageMetadata?.candidatesTokenCount ?? null},mock:false};
  }
  if (provider === 'openai' || provider === 'openrouter') {
    const key=env[provider==='openai'?'OPENAI_API_KEY':'OPENROUTER_API_KEY']; requireKey(key,provider);
    const chosen=model || env[provider==='openai'?'OPENAI_MODEL':'OPENROUTER_MODEL'];
    if(!chosen) throw new ProviderError('MODEL_REQUIRED',`Choose a model for ${provider}.`);
    const base=provider==='openai'?'https://api.openai.com/v1':'https://openrouter.ai/api/v1';
    const response=await fetch(`${base}/chat/completions`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key}`},body:JSON.stringify({model:chosen,messages:messages.map(m=>({role:m.role,content:m.content})),max_tokens:maxTokens,temperature:0.2})});
    const data=await readJson(response,provider); const text=data.choices?.[0]?.message?.content||'';
    if(!text) throw new ProviderError('EMPTY_RESPONSE',`${provider} returned an empty response.`);
    return {text,provider,model:chosen,usage:{calls:1,inputTokens:data.usage?.prompt_tokens??null,outputTokens:data.usage?.completion_tokens??null},mock:false};
  }
  if (provider === 'anthropic') {
    requireKey(env.ANTHROPIC_API_KEY,'Anthropic'); const chosen=model||env.ANTHROPIC_MODEL;
    if(!chosen) throw new ProviderError('MODEL_REQUIRED','Choose an Anthropic model or configure ANTHROPIC_MODEL.');
    const system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
    const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:chosen,max_tokens:maxTokens,system,messages:messages.filter(m=>m.role!=='system').map(m=>({role:m.role==='assistant'?'assistant':'user',content:m.content}))})});
    const data=await readJson(response,'anthropic'); const text=(data.content||[]).map(c=>c.text||'').join('');
    if(!text) throw new ProviderError('EMPTY_RESPONSE','Anthropic returned an empty response.');
    return {text,provider,model:chosen,usage:{calls:1,inputTokens:data.usage?.input_tokens??null,outputTokens:data.usage?.output_tokens??null},mock:false};
  }
  if (provider === 'groq') {
    requireKey(env.GROQ_API_KEY, 'Groq');
    const chosen = model || env.GROQ_MODEL;
    if (!chosen) throw new ProviderError('MODEL_REQUIRED','Choose a model from model discovery first.');
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${env.GROQ_API_KEY}`},body:JSON.stringify({model:chosen,messages:messages.map(m=>({role:m.role,content:m.content})),max_tokens:maxTokens,temperature:0.2})});
    const data = await readJson(response,'groq');
    const text = data.choices?.[0]?.message?.content || '';
    if (!text) throw new ProviderError('EMPTY_RESPONSE','Groq returned an empty response.');
    return {text,provider,model:chosen,usage:{calls:1,inputTokens:data.usage?.prompt_tokens ?? null,outputTokens:data.usage?.completion_tokens ?? null},mock:false};
  }
  throw new ProviderError('PROVIDER_NOT_IMPLEMENTED',`Provider adapter for ${provider} is not implemented yet.`);
}

function mockReply(messages) {
  const prompt = messages.map(m=>m.content).join('\n').slice(-5000);
  return `MOCK MODE — no external AI provider was called.\n\nExecution summary\n- Request received and processed by the local mock adapter.\n- Recommended next step: break the goal into measurable stages and validate each output.\n\nInput excerpt:\n${prompt}\n\nThis is deterministic scaffolding output, not a genuine Gemini or Groq response.`;
}
function requireKey(key, name) { if (!key) throw new ProviderError('MISSING_KEY',`${name} API key is not configured in Worker secrets.`); }
async function readJson(response, provider) {
  let data; try { data = await response.json(); } catch { throw new ProviderError('INVALID_RESPONSE',`${provider} returned invalid JSON.`); }
  if (!response.ok) {
    const status=response.status; const retryAfter=response.headers.get('retry-after');
    const code = status===401 || status===403 ? 'INVALID_KEY' : status===429 ? 'RATE_LIMITED' : status===404 ? 'MODEL_UNAVAILABLE' : 'PROVIDER_ERROR';
    throw new ProviderError(code, redact(data.error?.message || `${provider} request failed (${status}).`), status===429 || status>=500, retryAfter ? Number(retryAfter) : null);
  }
  return data;
}
