-- Platter schema (multi-team). Applied automatically by Netlify Database on deploy,
-- and by server/localdb.ts against an embedded Postgres when running locally.
--
-- Tenancy model: a USER is a login (email + password). A WORKSPACE is a team.
-- MEMBERSHIPS connect users to teams with a per-team role. Every piece of team data
-- carries workspace_id, and every query filters on it.

CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invites (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX invites_ws_idx ON invites (workspace_id);

-- An agent token lets one person's AI agent act for them inside ONE team.
CREATE TABLE agent_tokens (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  usage_remaining INTEGER CHECK (usage_remaining BETWEEN 0 AND 100),
  usage_resets_at TIMESTAMPTZ,
  usage_note TEXT,
  usage_reported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agent_tokens_ws_idx ON agent_tokens (workspace_id, member_id);

CREATE TABLE projects (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  agent_instructions TEXT NOT NULL DEFAULT '',
  wip_limit INTEGER NOT NULL DEFAULT 3,
  next_number INTEGER NOT NULL DEFAULT 1,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, key)
);

CREATE TABLE tasks (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id),
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT '',
  acceptance_criteria JSONB NOT NULL DEFAULT '[]',
  type TEXT NOT NULL DEFAULT 'feature' CHECK (type IN ('feature', 'bug', 'chore', 'research')),
  priority TEXT NOT NULL DEFAULT 'P2' CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
  status TEXT NOT NULL DEFAULT 'backlog'
    CHECK (status IN ('backlog', 'ready', 'in_progress', 'blocked', 'in_review', 'done', 'cancelled')),
  labels JSONB NOT NULL DEFAULT '[]',
  depends_on JSONB NOT NULL DEFAULT '[]',
  assignee_id UUID REFERENCES users(id),
  reviewer_id UUID REFERENCES users(id),
  reporter_id UUID NOT NULL REFERENCES users(id),
  created_by_agent_id UUID REFERENCES agent_tokens(id),
  claimed_by_agent_id UUID REFERENCES agent_tokens(id),
  last_heartbeat_at TIMESTAMPTZ,
  blocked_reason TEXT,
  submission JSONB,
  review JSONB,
  rework_count INTEGER NOT NULL DEFAULT 0,
  -- Open handoff request: { requested_at, from_member, from_agent, reason, notes }
  handoff JSONB,
  -- Everyone who worked the task before the current assignee (names), oldest first.
  contributors JSONB NOT NULL DEFAULT '[]',
  due_date DATE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (project_id, number)
);
CREATE INDEX tasks_ws_idx ON tasks (workspace_id, status);
CREATE INDEX tasks_assignee_idx ON tasks (workspace_id, assignee_id, status);
CREATE INDEX tasks_reviewer_idx ON tasks (workspace_id, reviewer_id, status);

-- Append-only audit trail: every transition, edit, comment and agent progress update.
CREATE TABLE activity (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id),
  project_id UUID REFERENCES projects(id),
  member_id UUID REFERENCES users(id),
  agent_id UUID REFERENCES agent_tokens(id),
  kind TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX activity_task_idx ON activity (task_id, id DESC);
CREATE INDEX activity_ws_idx ON activity (workspace_id, id DESC);

-- Check-ins: one person (or their agent) asks a teammate (or their agent) for an update.
CREATE TABLE asks (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  from_member_id UUID NOT NULL REFERENCES users(id),
  from_agent_id UUID REFERENCES agent_tokens(id),
  to_member_id UUID NOT NULL REFERENCES users(id),
  task_id UUID REFERENCES tasks(id),
  question TEXT NOT NULL,
  answer TEXT,
  answered_by_member_id UUID REFERENCES users(id),
  answered_by_agent_id UUID REFERENCES agent_tokens(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  asker_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ
);
CREATE INDEX asks_to_idx ON asks (workspace_id, to_member_id, status);
CREATE INDEX asks_from_idx ON asks (workspace_id, from_member_id, status);
