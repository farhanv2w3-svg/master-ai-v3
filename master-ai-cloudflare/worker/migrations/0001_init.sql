PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('normal','industrial')),
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  result TEXT,
  error TEXT,
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  usage_json TEXT NOT NULL DEFAULT '{"calls":0}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_updated ON tasks(tenant_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  task_id TEXT,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_task ON audit_events(tenant_id, task_id, created_at);
CREATE TABLE IF NOT EXISTS provider_configs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  model_override TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_agent_messages_tenant_task ON agent_messages(tenant_id,task_id,created_at);
