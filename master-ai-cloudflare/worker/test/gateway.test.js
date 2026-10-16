import test from 'node:test';
import assert from 'node:assert/strict';
import {guardedChat,guardedListModels} from '../src/security/model-gateway.js';
const env={PROVIDER_ALLOWLIST:'gemini,groq,mock',ALLOW_CLOUD_MODELS:'true'};
test('gateway permits mock calls without network access',async()=>{
 const r=await guardedChat({provider:'mock',model:'mock-reasoner',messages:[{role:'user',content:'hello'}],env,classification:'public',privacyMode:'local-only'});
 assert.equal(r.mock,true); assert.match(r.text,/MOCK MODE/);
});
test('gateway denies local-only cloud calls before network access',async()=>{
 await assert.rejects(()=>guardedChat({provider:'gemini',model:'any-model',messages:[{role:'user',content:'hello'}],env,classification:'public',privacyMode:'local-only'}),/LOCAL_ONLY_BLOCKED/);
});
test('gateway denies provider outside allowlist',async()=>{
 await assert.rejects(()=>guardedListModels({provider:'openai',env,classification:'public'}),/PROVIDER_NOT_ALLOWED/);
});
