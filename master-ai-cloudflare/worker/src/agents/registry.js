export const AGENTS = {
  planner: {id:'planner',name:'Master Planner',description:'Breaks a goal into bounded stages and selects an appropriate specialist.',modes:['normal','industrial']},
  coding: {id:'coding',name:'Coding & Debugging Agent',description:'Explains, drafts, and reviews code; does not execute arbitrary code in the Worker.',modes:['normal']},
  website: {id:'website',name:'Website Builder Agent',description:'Plans website structure, accessibility, components, and deployment.',modes:['normal']},
  research: {id:'research',name:'Research & Writing Agent',description:'Structures research questions and produces cited-source-ready summaries from supplied context.',modes:['normal']},
  data: {id:'data',name:'Data Analyst Agent',description:'Analyzes user-supplied data and explains assumptions.',modes:['normal','industrial']},
  energy: {id:'energy',name:'Industrial Energy Analyst',description:'Analyzes energy consumption/cost and proposes read-only improvements.',modes:['industrial']},
  maintenance: {id:'maintenance',name:'Maintenance Insight Agent',description:'Reviews provided machine/maintenance data and suggests inspection priorities.',modes:['industrial']},
  report: {id:'report',name:'Report Generator Agent',description:'Turns validated findings into an actionable report.',modes:['normal','industrial']}
};
export function chooseAgent(mode, goal) {
  const text=goal.toLowerCase();
  if (mode==='industrial' && /energy|electric|kwh|bill|power/.test(text)) return AGENTS.energy;
  if (mode==='industrial' && /machine|maintenance|downtime|failure|vibration/.test(text)) return AGENTS.maintenance;
  if (/website|landing page|frontend|ui|web app/.test(text)) return AGENTS.website;
  if (/debug|code|python|javascript|program/.test(text)) return AGENTS.coding;
  if (/data|csv|dataset|analysis|trend/.test(text)) return AGENTS.data;
  return AGENTS.research;
}
