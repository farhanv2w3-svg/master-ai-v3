import { chatCompletion as providerChat, listModels as providerModels } from '../providers/adapters.js';
import { enforceModelPolicy, providerAllowlist } from './policy.js';

// All outbound AI-provider calls must go through this module. Do not import provider
// adapters directly from API handlers or agents.
export async function guardedChat({provider,model,messages,env,classification,privacyMode='standard',maxTokens=1200}) {
  enforceModelPolicy({provider,classification,mode:privacyMode,approvedProviders:providerAllowlist(env),env});
  return providerChat({provider,model,messages,env,maxTokens});
}
export async function guardedListModels({provider,env,classification='public',privacyMode='standard'}) {
  enforceModelPolicy({provider,classification,mode:privacyMode,approvedProviders:providerAllowlist(env),env});
  return providerModels(provider,env);
}
