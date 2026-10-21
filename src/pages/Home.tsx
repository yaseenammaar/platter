import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type Ask, type Task, href } from '../api';
import type { SketchName } from '../sketch';
import { Avatar, Battery, Copy, ErrorBox, Loading, PersonPicker, Pip, Sketch, firstName, timeAgo, toast, useAction, useApp, useLoad } from '../ui';
import { TaskCard } from './Board';

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

/** Pip's take on your day. */
function pipSays(todo: number, doing: number, handoffs: number): { mood: 'happy' | 'party' | 'thinking' | 'sleepy'; line: string } {
  if (todo >= 3) return { mood: 'thinking', line: `${todo} things want you. One at a time — I'll keep the rest warm.` };
  if (todo > 0) return { mood: 'happy', line: todo === 1 ? 'Just one thing needs you. Easy.' : 'A couple of things need you.' };
  if (handoffs > 0) return { mood: 'thinking', line: 'A teammate\'s agent ran out of energy. Want to pick up their plate?' };
  if (doing > 0) return { mood: 'party', line: 'Things are flying. Nothing needs you right now.' };
  return { mood: 'sleepy', line: 'Your plate is clear. Nothing to do but daydream.' };
}

export function HomePage({ onInboxChange }: { onInboxChange: () => void }) {
  const { me } = useApp();
  const { data, error, reload } = useLoad(async () => {
    const [assigned, reviewing, handoffs, asks, tokens, capacity] = await Promise.all([
      api.get<{ tasks: Task[] }>('/tasks?assignee=me&status=ready,in_progress,blocked,in_review'),
      api.get<{ tasks: Task[] }>('/tasks?reviewer=me&status=in_review'),
      api.get<{ tasks: Task[] }>('/handoffs'),
      api.get<{ for_me: Ask[]; my_questions: Ask[] }>('/asks?seen=1'),
      api.get<{ tokens: any[] }>('/agent-tokens'),
      api.get<{ agents: any[] }>('/capacity'),
    ]);
    return { assigned: assigned.tasks, reviewing: reviewing.tasks, handoffs: handoffs.tasks.filter((t) => t.assignee_id !== me.id), asks, tokens: tokens.tokens.filter((t) => t.member_id === me.id), capacity: capacity.agents };
  }, [], 15_000);
  useEffect(() => { if (data) onInboxChange(); }, [data, onInboxChange]);

  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data) return <Loading />;

  const doing = data.assigned.filter((t) => t.status === 'in_progress' || t.status === 'blocked');
  const upNext = data.assigned.filter((t) => t.status === 'ready');
  const waiting = data.assigned.filter((t) => t.status === 'in_review');
  const needsMe = [...data.reviewing, ...doing.filter((t) => t.status === 'blocked' || t.handoff_open)];
  const answers = data.asks.my_questions.filter((a) => a.status === 'answered');
  const pending = data.asks.my_questions.filter((a) => a.status === 'open');
  // Questions are for my agent; they only land on me when I have no agent connected (Q1).
  const agentAnswers = data.tokens.length > 0;
  const forMe = agentAnswers ? [] : data.asks.for_me;
  const forAgent = agentAnswers ? data.asks.for_me : [];
  const todo = needsMe.length + forMe.length;
  const pip = pipSays(todo, doing.length, data.handoffs.length);

  return (
    <div className="page">
      <header className="hello">
        <Pip mood={pip.mood} size={88} className="floaty" />
        <div>
          <h1>{greeting()}, <mark className="hl">{firstName(me.name)}</mark></h1>
          <p className="hand lead">{pip.line}</p>
        </div>
      </header>

      <CheckIn onSent={reload} />

      {!data.tokens.length && me.role !== 'viewer' && (
        <Link to={href('/settings')} viewTransition className="cta surface">
          <span className="cta-icon"><Sketch name="agent" size={30} /></span>
          <span><b>Give yourself a co-pilot</b><br /><span className="muted">Connect your AI agent — it picks up your tasks, shows its work, and checks teammates'.</span></span>
          <span className="cta-arrow"><Sketch name="back" size={20} /></span>
        </Link>
      )}

      {(forMe.length > 0 || needsMe.length > 0) && (
        <Section title="Needs you" icon="bell">
          {forMe.map((a) => <QuestionCard key={a.id} ask={a} onDone={reload} />)}
          {needsMe.length > 0 && <div className="cards">{needsMe.map((t) => <TaskCard key={t.id} t={t} />)}</div>}
        </Section>
      )}

      {forAgent.length > 0 && (
        <Section title="Your agent is on these" icon="agent" hint="Teammates asked your agent. It looks each one up and answers at its next check-in.">
          {forAgent.map((a) => <QuestionCard key={a.id} ask={a} onDone={reload} byAgent />)}
        </Section>
      )}

      {(answers.length > 0 || pending.length > 0) && (
        <Section title="Check-ins" icon="chat">
          <div className="surface panel-list">
            {answers.map((a) => (
              <div key={a.id} className="answer">
                <Avatar name={a.to_name} size={30} />
                <div>
                  <div className="muted small">You asked {firstName(a.to_name)}: “{a.question}”</div>
                  <div className="answer-text">{a.answer}</div>
                  <div className="muted small with-icon">{a.answered_by_agent_name ? <><Sketch name="agent" size={13} /> answered by {firstName(a.to_name)}'s agent</> : <><Sketch name="pencil" size={13} /> {firstName(a.answered_by_name)}</>} · {timeAgo(a.answered_at)}</div>
                </div>
              </div>
            ))}
            {pending.map((a) => (
              <div key={a.id} className="answer pending">
                <Avatar name={a.to_name} size={30} />
                <div><div className="muted small with-icon"><Sketch name="hourglass" size={13} /> Waiting on {firstName(a.to_name)}'s agent · {timeAgo(a.created_at)}</div><div>“{a.question}”</div></div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {doing.filter((t) => !needsMe.includes(t)).length > 0 && (
        <Section title="On the go" icon="bolt"><div className="cards">{doing.filter((t) => !needsMe.includes(t)).map((t) => <TaskCard key={t.id} t={t} />)}</div></Section>
      )}

      {upNext.length > 0 && (
        <Section title="Up next" icon="eye">
          <div className="cards">{upNext.map((t) => <TaskCard key={t.id} t={t} />)}</div>
          {data.tokens.length > 0 && (
            <div className="tip surface"><Sketch name="sparkle" size={16} /> Tell your agent: <code>Pick up my next Platter task</code> <Copy text="Pick up my next Platter task" /></div>
          )}
        </Section>
      )}

      {data.handoffs.length > 0 && (
        <Section title="Up for grabs" icon="hand" hint="A teammate's agent ran out of energy mid-task. Yours can pick up the plate.">
          <div className="cards">{data.handoffs.map((t) => <TaskCard key={t.id} t={t} />)}</div>
        </Section>
      )}

      {waiting.length > 0 && <Section title="Waiting for a check" icon="review"><div className="cards">{waiting.map((t) => <TaskCard key={t.id} t={t} />)}</div></Section>}

      {data.capacity.length > 0 && (
        <Section title="Team energy" icon="bolt">
          <div className="energy">
            {data.capacity.map((a) => (
              <div key={a.id} className="energy-item surface" title={a.name}>
                <Avatar name={a.member_name} size={28} />
                <span>{firstName(a.member_name)}</span>
                <Battery pct={a.usage_remaining} />
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, icon, hint, children }: { title: string; icon: SketchName; hint?: string; children: React.ReactNode }) {
  return (
    <section className="section rise">
      <h2><span className="h-icon"><Sketch name={icon} size={20} /></span>{title}</h2>
      {hint && <p className="hand hint-line">{hint}</p>}
      {children}
    </section>
  );
}

function QuestionCard({ ask, onDone, byAgent }: { ask: Ask; onDone: () => void; byAgent?: boolean }) {
  const [answer, setAnswer] = useState('');
  const [self, setSelf] = useState(!byAgent);
  const a = useAction();
  const send = (e: FormEvent) => {
    e.preventDefault();
    a.run(async () => { await api.post(`/asks/${ask.id}/answer`, { answer }); toast(`Sent to ${firstName(ask.from_name)}`); onDone(); });
  };
  return (
    <form className="question surface" onSubmit={send}>
      <div className="q-head">
        <Avatar name={ask.from_name} size={32} />
        <div>
          <b>{firstName(ask.from_name)}</b> <span className="muted small">asks{ask.from_agent_name ? ' via their agent' : ''} · {timeAgo(ask.created_at)}</span>
          <div className="q-text">“{ask.question}”</div>
          {ask.task_key && <Link to={href(`/tasks/${ask.task_key}`)} viewTransition className="small">about {ask.task_title}</Link>}
        </div>
      </div>
      {self ? (
        <div className="q-reply">
          <input placeholder="Type your answer…" value={answer} onChange={(e) => setAnswer(e.target.value)} autoFocus={byAgent} />
          <button className="btn primary" disabled={a.busy || !answer.trim()}>Reply</button>
        </div>
      ) : (
        <div className="q-agent muted small with-icon">
          <Sketch name="agent" size={14} /> Your agent will answer
          <span className="spacer" />
          <button type="button" className="link-btn small" onClick={() => setSelf(true)}>Answer it yourself</button>
        </div>
      )}
      <ErrorBox error={a.error} />
    </form>
  );
}

/** "Ask a teammate's agent…" — for humans; agents do the same with ask_teammate. */
function CheckIn({ onSent }: { onSent: () => void }) {
  const { me, members } = useApp();
  const others = members.filter((m) => m.id !== me.id && m.status === 'active');
  const [to, setTo] = useState('');
  const [question, setQuestion] = useState('');
  const [hints, setHints] = useState<any[] | null>(null);
  const a = useAction();
  if (!others.length || me.role === 'viewer') return null;
  const hasAgent = (id: string) => (members.find((m) => m.id === id)?.active_agents ?? 0) > 0;
  const options = others.map((m) => ({
    id: m.id, name: m.name,
    note: hasAgent(m.id)
      ? <span className="with-icon"><Sketch name="agent" size={13} /> their agent answers</span>
      : <span className="with-icon"><Sketch name="pencil" size={13} /> no agent yet, {firstName(m.name)} answers</span>,
  }));
  const send = (e: FormEvent) => {
    e.preventDefault();
    a.run(async () => {
      const r = await api.post('/asks', { to_member_id: to, question });
      toast(r.has_agent ? `Asked ${firstName(r.to)}'s agent. The answer comes back here` : `Asked ${firstName(r.to)}. The answer comes back here`);
      setHints(r.hints);
      setQuestion('');
      onSent();
    });
  };
  return (
    <form className="checkin surface" onSubmit={send} data-tour="ask">
      <span className="checkin-icon"><Sketch name="chat" size={20} /></span>
      <span className="checkin-label">Ask</span>
      <PersonPicker label="Who to ask" options={options} value={to} onChange={setTo}
        render={(o) => hasAgent(o.id) ? <>{firstName(o.name)}'s agent</> : firstName(o.name)} />
      <input placeholder="did you list the apps in the directory yet?" value={question} onChange={(e) => setQuestion(e.target.value)} required />
      <button className="btn primary" disabled={a.busy || !to || question.trim().length < 5}>Ask</button>
      <ErrorBox error={a.error} />
      {hints && hints.length > 0 && (
        <div className="hints">
          <div className="hand">Meanwhile, here's what I already know:</div>
          {hints.map((h) => (
            <Link key={h.key} to={href(`/tasks/${h.key}`)} viewTransition className="hint-row">
              <b>{h.title}</b>
              {h.last_update && <span className="muted"> — “{h.last_update.message}” · {timeAgo(h.last_update.created_at)}</span>}
            </Link>
          ))}
          <button type="button" className="link-btn small" onClick={() => setHints(null)}>dismiss</button>
        </div>
      )}
    </form>
  );
}
