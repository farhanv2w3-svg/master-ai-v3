const now=()=>new Date().toISOString();
export async function createTask(db, task) {
  await db.prepare('INSERT INTO tasks (id,tenant_id,mode,goal,status,stage,provider,model,result,error,checkpoint_json,usage_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(task.id,task.tenantId,task.mode,task.goal,task.status,task.stage,task.provider,task.model,null,null,JSON.stringify(task.checkpoint||{}),JSON.stringify(task.usage||{calls:0}),now(),now()).run();
  await audit(db,task.tenantId,task.id,'task.created','Task created; resource preflight completed.',{mode:task.mode,provider:task.provider});
}
export async function updateTask(db, tenantId, id, patch) {
  const allowed=['status','stage','provider','model','result','error','checkpoint_json','usage_json'];
  const keys=Object.keys(patch).filter(k=>allowed.includes(k)); if(!keys.length) return;
  const values=keys.map(k=>patch[k]); const sql=`UPDATE tasks SET ${keys.map(k=>`${k}=?`).join(',')}, updated_at=? WHERE id=? AND tenant_id=?`;
  await db.prepare(sql).bind(...values,now(),id,tenantId).run();
}
export async function getTask(db, tenantId, id) { return db.prepare('SELECT * FROM tasks WHERE id=? AND tenant_id=?').bind(id,tenantId).first(); }
export async function listTasks(db, tenantId) { const r=await db.prepare('SELECT id,mode,goal,status,stage,provider,model,created_at,updated_at FROM tasks WHERE tenant_id=? ORDER BY updated_at DESC LIMIT 50').bind(tenantId).all(); return r.results||[]; }
export async function audit(db, tenantId, taskId, eventType, message, metadata={}) { await db.prepare('INSERT INTO audit_events (id,tenant_id,task_id,event_type,message,metadata_json,created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),tenantId,taskId,eventType,String(message).slice(0,500),JSON.stringify(metadata),now()).run(); }
export async function events(db, tenantId, taskId) { const r=await db.prepare('SELECT event_type,message,metadata_json,created_at FROM audit_events WHERE tenant_id=? AND task_id=? ORDER BY created_at ASC').bind(tenantId,taskId).all(); return (r.results||[]).map(e=>({...e,metadata:JSON.parse(e.metadata_json||'{}')})); }
