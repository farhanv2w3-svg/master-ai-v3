import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeRequest,authorizeDataAccess,classifyText,enforceModelPolicy,providerAllowlist,redact} from '../src/security/policy.js';
import {preflight} from '../src/services/resource-manager.js';
import {analyzeEnergy} from '../src/agents/industrial.js';

const env={MASTER_API_TOKEN:'a-very-long-test-token-value-123456',DEFAULT_TENANT_ID:'tenant-a',PROVIDER_ALLOWLIST:'gemini,groq,mock',ALLOW_CLOUD_MODELS:'true',GEMINI_API_KEY:'',GROQ_API_KEY:''};
test('authentication requires bearer token and configured secret',()=>{
 assert.throws(()=>authorizeRequest(new Request('https://x/api'),env),/UNAUTHORIZED/);
 assert.equal(authorizeRequest(new Request('https://x/api',{headers:{authorization:`Bearer ${env.MASTER_API_TOKEN}`}}),env).tenantId,'tenant-a');
 assert.throws(()=>authorizeRequest(new Request('https://x/api',{headers:{authorization:'Bearer nope'}}),env),/UNAUTHORIZED/);
});
test('tenant access fails closed for cross-tenant rows',()=>{
 assert.equal(authorizeDataAccess({tenantId:'tenant-a'},'tenant-a'),true);
 assert.throws(()=>authorizeDataAccess({tenantId:'tenant-a'},'tenant-b'),/FORBIDDEN_TENANT/);
});
test('restricted data cannot leave through a cloud provider',()=>{
 assert.equal(classifyText('customer PII and patient record'),'restricted');
 assert.throws(()=>enforceModelPolicy({provider:'gemini',classification:'restricted',mode:'standard',approvedProviders:providerAllowlist(env),env}),/RESTRICTED_DATA_EXTERNAL_BLOCKED/);
 assert.equal(enforceModelPolicy({provider:'mock',classification:'restricted',mode:'local-only',approvedProviders:providerAllowlist(env),env}),true);
});
test('local-only mode blocks all external providers even when allowlisted',()=>{
 assert.throws(()=>enforceModelPolicy({provider:'groq',classification:'public',mode:'local-only',approvedProviders:providerAllowlist(env),env}),/LOCAL_ONLY_BLOCKED/);
 assert.equal(enforceModelPolicy({provider:'mock',classification:'public',mode:'local-only',approvedProviders:providerAllowlist(env),env}),true);
});
test('server-side provider allowlist blocks unapproved provider',()=>{
 assert.throws(()=>enforceModelPolicy({provider:'openai',classification:'public',mode:'standard',approvedProviders:providerAllowlist(env),env}),/PROVIDER_NOT_ALLOWED/);
});
test('secret-like values are redacted',()=>assert.equal(redact('api_key=supersecret'),'api_key=[REDACTED]'));
test('resource manager selects mock for local-only and estimates work',()=>{
 const p=preflight({goal:'write a poem',mode:'normal',env,privacyMode:'local-only'});
 assert.equal(p.provider,'mock'); assert.equal(p.estimatedCalls.clearlyEstimated,true);
});
test('industrial energy calculations validate input and return deterministic totals',()=>{
 const r=analyzeEnergy([{period:'A',kwh:10,costPerKwh:5},{period:'B',kwh:20,costPerKwh:4}]);
 assert.equal(r.totalKwh,30); assert.equal(r.estimatedTotalCost,130); assert.equal(r.highestConsumptionPeriod,'B');
 assert.throws(()=>analyzeEnergy([{kwh:-1,costPerKwh:2}]),/non-negative/);
});
