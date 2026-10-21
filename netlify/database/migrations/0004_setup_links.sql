-- One-time setup links: connecting an agent is one short command instead of a long prompt
-- with the key in it. The agent token is kept only sealed with a key derived from the link
-- code itself, so the database alone can't recover it. Links work once, for 30 minutes.
CREATE TABLE setup_links (
  id_hash TEXT PRIMARY KEY,
  agent_token_id UUID NOT NULL REFERENCES agent_tokens(id) ON DELETE CASCADE,
  sealed TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX setup_links_token_idx ON setup_links (agent_token_id);
