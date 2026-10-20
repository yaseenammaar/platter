// Regenerates RULES.md from the rulebook the server enforces (server/rules.ts).
import { writeFileSync } from 'node:fs';
import { ACTIONS, RULEBOOK, STATUS_LABELS } from '../server/rules.ts';

const out = [
  '# Platter team rules',
  '',
  '> Generated from `server/rules.ts` by `npm run rules:md` — these are the rules the server enforces for people and agents alike. Error messages cite the rule ID.',
  '',
  '## Workflow',
  '',
  '`Backlog → Ready → In progress → In review → Done` (plus Blocked, Cancelled, and agent handoffs).',
  '',
  '| Action | From | To | Who | Agents |',
  '|---|---|---|---|---|',
  ...Object.values(ACTIONS).map((a) =>
    `| ${a.label}${a.needsReason ? ' (reason required)' : ''} | ${a.from.map((s) => STATUS_LABELS[s]).join(', ')} | ${STATUS_LABELS[a.to]} | ${a.who.join(' / ')} | ${a.agents ? 'yes' : 'humans only'} |`),
  '',
  ...RULEBOOK.flatMap((s) => [`## ${s.section}`, '', ...s.rules.map((r) => `- **${r.id}** — ${r.text}`), '']),
];
writeFileSync(new URL('../RULES.md', import.meta.url), out.join('\n'));
console.log('RULES.md written');
