-- Owner controls over team agents.
--
-- Focus lock ("monogamy"): the owner can lock a person's agents to the one task
-- assigned to them. While locked, Platter refuses every tool call about other work.
ALTER TABLE memberships ADD COLUMN agent_focus BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE memberships ADD COLUMN agent_focus_by UUID REFERENCES users(id);
ALTER TABLE memberships ADD COLUMN agent_focus_at TIMESTAMPTZ;

-- Action log: when the owner turns it on, every agent action is recorded as one tiny row
-- (tool + target). It is written by Platter and by a background hook, never by the model,
-- so it costs the agent no tokens.
ALTER TABLE workspaces ADD COLUMN agent_log BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE agent_actions (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agent_tokens(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  -- 'platter' = a Platter tool call; 'local' = the agent's own tool (Edit, Bash…) via hook.
  source TEXT NOT NULL CHECK (source IN ('platter', 'local')),
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  ok BOOLEAN NOT NULL DEFAULT true,
  -- Identical consecutive actions are folded into one row.
  n INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agent_actions_ws_idx ON agent_actions (workspace_id, id DESC);
CREATE INDEX agent_actions_agent_idx ON agent_actions (agent_id, id DESC);
