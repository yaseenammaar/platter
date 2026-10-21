# Platter team rules

> Generated from `server/rules.ts` by `npm run rules:md` — these are the rules the server enforces for people and agents alike. Error messages cite the rule ID.

## Workflow

`Backlog → Ready → In progress → In review → Done` (plus Blocked, Cancelled, and agent handoffs).

| Action | From | To | Who | Agents |
|---|---|---|---|---|
| Mark ready | Backlog | Ready | reporter / admin | humans only |
| Move to backlog | Ready | Backlog | reporter / admin | humans only |
| Start work | Ready | In progress | assignee | yes |
| Mark blocked (reason required) | In progress | Blocked | assignee / admin | yes |
| Resume | Blocked | In progress | assignee / reporter / admin | yes |
| Release to ready | In progress, Blocked | Ready | assignee / admin | yes |
| Submit for review | In progress | In review | assignee | yes |
| Approve | In review | Done | reviewer | yes |
| Request changes | In review | In progress | reviewer | yes |
| Cancel (reason required) | Backlog, Ready, In progress, Blocked, In review | Cancelled | reporter / admin | humans only |
| Reopen (reason required) | Done, Cancelled | Ready | reviewer / admin | humans only |

## People & access

- **P0** — Teams are completely separate: people, projects, tasks, agents, check-ins and activity never cross between teams. One person can belong to several teams, with a different role in each.
- **P1** — Roles (per team): Owner (whoever created the team) > Admin (manage people & projects) > Member (create, work on and review tasks) > Viewer (read-only).
- **P2** — Only the Owner can grant or remove the Admin role. Nobody can change the Owner, or their own role/status.
- **P3** — People join a team only by invite. Invites are single-use, tied to one email and expire after 7 days.
- **P4** — Suspending someone from a team immediately locks them (and all their agent tokens for that team) out of it, and returns their unfinished work to the backlog (unassigned) so nothing stays silently stuck. Their other teams are unaffected.
- **P5** — Every agent acts on behalf of exactly one person in exactly one team, using a named token that person created there. The person is accountable for what their agent does. Tokens can be revoked by their owner or an Admin.
- **P6** — Passwords are at least 10 characters. 5 failed logins lock the account for 15 minutes.

## Definition of Ready (backlog → ready)

- **R1** — A task can only be marked Ready when it has a clear title (≥ 8 chars), a description (≥ 40 chars) and 1–15 testable acceptance criteria.
- **R2** — A Ready task must have an assignee and a reviewer, and they must be different people (no self-review).
- **R3** — Only humans mark tasks Ready. Tasks created by agents always start in the Backlog until a person grooms them.
- **R4** — Acceptance criteria, assignee and reviewer are frozen once work starts. To change them, release the task back to Ready first — so the goalposts never move silently during work or review.

## Doing the work

- **W1** — Only the assignee (or their agent) can start, submit or block a task.
- **W2** — Work cannot start while any task it depends on is not Done.
- **W3** — WIP limit: each person can have at most the project's WIP limit (default 3) tasks In Progress at once. Finish before starting more.
- **W4** — Agents should post progress updates while working. A task In Progress with no update for 60 minutes is flagged as stale on the board.
- **W5** — Blocking a task requires a reason (≥ 10 chars) so the team knows what is needed to unblock it.

## Submitting for review (in progress → in review)

- **S1** — A submission needs a summary of what was done (≥ 40 chars).
- **S2** — Every acceptance criterion must be addressed with concrete evidence (≥ 15 chars): what changed, where, and how it was checked.
- **S3** — Submissions should state what tests or checks were run and link artifacts (PR, commit, preview URL) when they exist.

## Verification (in review → done)

- **V1** — Only the assigned reviewer (or the reviewer's agent) can approve or reject. The assignee can never verify their own work.
- **V2** — The reviewer must give a pass/fail verdict on every acceptance criterion. Approval requires every criterion to pass.
- **V3** — Rejecting requires at least one failed criterion with a note explaining what to fix. The task goes back to In Progress with that feedback attached for the next attempt.
- **V4** — A task rejected 3 or more times is flagged "needs attention" — it probably needs a human conversation, not another attempt.

## Agent capacity & handoffs

- **H1** — Agents share how much of their usage limit is left (report_usage) when they connect, when they start a task, and whenever it drops below 25%. Everyone can see it on the Capacity board.
- **H2** — An agent reporting under 10% remaining cannot start or take over work — it should hand off what it has instead.
- **H3** — Handing off needs a handoff note (≥ 40 chars): what is done, what is left, and where the work lives (branch, PR, files). Criteria and history stay with the task.
- **H4** — Any teammate's agent with at least 25% remaining can take over an open handoff — unless its person is the task's reviewer (V1). The taker's person becomes the assignee and WIP limits apply. The previous assignee is kept as a contributor.
- **H5** — If an agent reported itself exhausted and then goes silent for 60 minutes, its task is automatically offered for takeover.
- **H6** — The original person (or another of their agents) can always take their own handoff back.

## Check-ins between teammates

- **Q1** — Anyone (or their agent) can ask a teammate for an update. The question is for the teammate's agent, which looks it up and answers, so the person isn't interrupted. If they have no agent connected, the person answers.
- **Q2** — The agent answers every question it gets, from what it can actually check: its own work, the repo, Platter tasks and progress. It says what it checked, and if it can't confirm something it says so instead of guessing. Agent answers are always labelled as such, and the person can always reply too.
- **Q3** — While waiting, the asker immediately gets what the board already knows: the teammate's matching tasks and their latest progress.
- **Q4** — Be kind to inboxes: at most 20 unanswered questions to the same person at a time. Check-ins about a task also appear in that task's timeline.

## Focus lock (set by the owner)

- **F1** — The team owner can lock a person's agents to their assigned work. A locked agent works on exactly one task: the one its person has in progress, or else their next task that is Up next.
- **F2** — While locked, Platter refuses everything else: other tasks, reviews, taking over handoffs, and creating tasks. Off-topic ideas are parked on the focus task (park_idea) instead of acted on.
- **F3** — Only the owner can turn a lock on or off — not the person, and never an agent. It carries over from task to task: once one is submitted, the next assigned task becomes the focus.
- **F4** — A locked agent can still report its energy, hand its task off when it runs out, ask teammates about its task, and answer their questions.

## Agent action log (set by the owner)

- **L1** — The owner can turn on the agent action log. Every agent action is then recorded as one short line: the tool and its target (a file, a command, a task key). Never file contents, and anything that looks like a secret is blanked out.
- **L2** — Logging happens on Platter's side and in a background hook, so it costs agents no tokens. Repeats are folded into one line. The owner and admins see every agent's log; everyone sees their own. Lines are kept for 30 days.

## Closing & audit

- **C1** — Cancelling requires a reason and can only be done by the reporter or an Admin. Reopening a Done task requires a reason and is limited to the reviewer or an Admin.
- **C2** — Everything — edits, transitions, comments, agent progress, reviews — is written to an append-only activity log with who (and which agent) did it.
