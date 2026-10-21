-- First-run welcome tour: shown once per person (on any device) until they finish or skip it.
ALTER TABLE users ADD COLUMN onboarded_at TIMESTAMPTZ;
