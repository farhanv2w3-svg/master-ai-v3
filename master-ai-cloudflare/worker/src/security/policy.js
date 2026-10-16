const PROVIDERS = new Set(['gemini', 'groq', 'openai', 'openrouter', 'anthropic', 'mock']);
const SENSITIVE = /\b(password|api[_ -]?key|secret|token|authorization)(?:\s+(?:is|=))?\s*[:=]?\s*[^\s,;]+/gi;

export function redact(value) {
  return String(value ?? '').replace(SENSITIVE, '$1=[REDACTED]');
}

export function classifyText(text) {
  const s = String(text ?? '').toLowerCase();
  if (/patient|medical record|personal data|passport|ssn|customer pii|confidential industrial|proprietary machine|api[_ -]?key|password\s*(?:is|[:=])|access token|private key/.test(s)) return 'restricted';
  if (/factory|industrial|machine|production|energy bill|maintenance|downtime/.test(s)) return 'confidential';
  return 'public';
}

export function authorizeRequest(request, env) {
  // This first release is single-tenant per deployment. Tenant identity comes only
  // from server configuration, never from a caller-supplied tenant header/body.
  const expected = env.MASTER_API_TOKEN;
  if (!expected || expected.length < 24) throw new Error('AUTH_NOT_CONFIGURED');
  const auth = request.headers.get('authorization') || '';
  const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!constantTimeEqual(supplied, expected)) throw new Error('UNAUTHORIZED');
  return { tenantId: env.DEFAULT_TENANT_ID || 'primary-tenant', subject: 'deployment-owner' };
}

function constantTimeEqual(a, b) {
  const enc = new TextEncoder(); const aa = enc.encode(a); const bb = enc.encode(b);
  let diff = aa.length ^ bb.length; const n = Math.max(aa.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (aa[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

export function authorizeDataAccess(principal, rowTenantId) {
  if (!principal?.tenantId || !rowTenantId || principal.tenantId !== rowTenantId) throw new Error('FORBIDDEN_TENANT');
  return true;
}

export function enforceModelPolicy({ provider, classification, mode, approvedProviders, env }) {
  if (!PROVIDERS.has(provider)) throw new Error('PROVIDER_NOT_SUPPORTED');
  if (!approvedProviders.includes(provider)) throw new Error('PROVIDER_NOT_ALLOWED');
  if (mode === 'local-only' && provider !== 'mock') throw new Error('LOCAL_ONLY_BLOCKED');
  if (classification === 'restricted' && provider !== 'mock') throw new Error('RESTRICTED_DATA_EXTERNAL_BLOCKED');
  if (provider !== 'mock' && env.ALLOW_CLOUD_MODELS !== 'true') throw new Error('CLOUD_MODELS_DISABLED');
  if (provider !== 'mock' && mode === 'local-only') throw new Error('LOCAL_ONLY_BLOCKED');
  return true;
}

export function providerAllowlist(env) {
  const configured = (env.PROVIDER_ALLOWLIST || 'gemini,groq,mock').split(',').map(x => x.trim()).filter(Boolean);
  return configured;
}
