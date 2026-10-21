import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, href, type ActivityItem, type AgentAction } from '../api';
import { Avatar, Empty, ErrorBox, Loading, PersonPicker, Sketch, firstName, isAdmin, useApp, useLoad } from '../ui';
import type { SketchName } from '../sketch';
import { StoryLine } from './Task';

const FILTERS: Record<string, { icon?: SketchName; test: (e: ActivityItem) => boolean }> = {
  Everything: { test: (e) => e.kind !== 'edited' },
  Agents: { icon: 'agent', test: (e) => !!e.agent_name },
  Talk: { icon: 'chat', test: (e) => ['comment', 'ask', 'answer'].includes(e.kind) },
  Wins: { icon: 'sparkle', test: (e) => e.kind === 'approve' },
};
const LOG = 'Agent log';

const dayLabel = (d: string) => {
  const date = new Date(d);
  const today = new Date();
  const yest = new Date(Date.now() - 86400_000);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yest.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
};

export function FeedPage() {
  const { me, policy } = useApp();
  const [params, setParams] = useSearchParams();
  const showLog = policy.agent_log || isAdmin(me);
  const [filter, setFilterState] = useState(params.get('view') === 'log' && showLog ? LOG : 'Everything');
  const setFilter = (f: string) => { setFilterState(f); setParams(f === LOG ? { view: 'log' } : {}, { replace: true }); };
  return (
    <div className="page narrow">
      <header className="head">
        <h1>Feed</h1>
        <div className="chips">
          {Object.entries(FILTERS).map(([f, v]) => <button key={f} className={`toggle ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>{v.icon && <Sketch name={v.icon} size={14} />}{f}</button>)}
          {showLog && <button className={`toggle ${filter === LOG ? 'on' : ''}`} onClick={() => setFilter(LOG)}><Sketch name="feed" size={14} />{LOG}</button>}
        </div>
      </header>
      {filter === LOG ? <AgentLog /> : <Activity filter={filter} />}
    </div>
  );
}

function Activity({ filter }: { filter: string }) {
  const [older, setOlder] = useState<ActivityItem[]>([]);
  const { data, error } = useLoad(() => api.get<{ activity: ActivityItem[] }>('/activity?limit=100'), [], 10_000);
  const latest = data?.activity ?? [];
  const all = [...latest, ...older.filter((o) => !latest.some((d) => d.id === o.id))];
  const items = all.filter(FILTERS[filter].test);
  const loadMore = async () => {
    const last = all[all.length - 1];
    if (!last) return;
    setOlder([...older, ...(await api.get<{ activity: ActivityItem[] }>(`/activity?limit=100&before=${last.id}`)).activity]);
  };
  if (!data && !error) return <Loading text="Catching up on the gossip…" />;
  let lastDay = '';
  return (
    <>
      <ErrorBox error={error} />
      <div className="feed">
        {items.map((e) => {
          const day = dayLabel(e.created_at);
          const header = day !== lastDay ? <div className="day">{(lastDay = day)}</div> : null;
          return <div key={e.id}>{header}<StoryLine e={e} showTask /></div>;
        })}
      </div>
      {data && !items.length && <Empty>Quiet skies so far.</Empty>}
      {all.length >= 100 && <button className="link-btn" onClick={loadMore}>Load older</button>}
    </>
  );
}

const time = (d: string) => new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** One line per agent action (L1). Admins can narrow it to one person. */
function AgentLog() {
  const { me, members, policy } = useApp();
  const [who, setWho] = useState('');
  const { data, error } = useLoad(() => api.get<{ actions: AgentAction[] }>(`/agent-actions?limit=300${who ? `&member=${who}` : ''}`), [who], 10_000);
  const people = [{ id: '', name: 'Everyone', icon: 'team' as const }, ...members.filter((m) => (m.active_agents ?? 0) > 0).map((m) => ({ id: m.id, name: m.name }))];
  if (!data && !error) return <Loading text="Reading the logbook…" />;
  const rows = data?.actions ?? [];
  let lastDay = '';
  return (
    <>
      <div className="log-bar">
        <p className="muted small">
          {policy.agent_log ? 'Every agent action, one line each. Repeats are folded together.' : "The owner hasn't turned the action log on, so nothing new is recorded."}
        </p>
        {isAdmin(me) && <PersonPicker label="Whose agents" options={people} value={who} onChange={setWho}
          render={(o) => (o.id ? `${firstName(o.name)}'s agents` : 'Everyone')} />}
      </div>
      <ErrorBox error={error} />
      <div className="log">
        {rows.map((r) => {
          const day = dayLabel(r.created_at);
          const header = day !== lastDay ? <div className="day">{(lastDay = day)}</div> : null;
          return (
            <div key={r.id}>
              {header}
              <div className={`log-line ${r.ok ? '' : 'failed'}`} title={`${r.agent_name} · ${r.source === 'platter' ? 'Platter tool' : 'its own tool'}`}>
                <span className="log-time">{time(r.last_at)}</span>
                <Avatar name={r.member_name} size={18} />
                <span className="log-who">{firstName(r.member_name)}</span>
                <span className={`log-act ${r.source}`}>{r.action}</span>
                <span className="log-target">{r.target}</span>
                {r.n > 1 && <span className="log-n">×{r.n}</span>}
                {!r.ok && <span className="log-fail"><Sketch name="cross" size={12} /></span>}
                {r.task_key && <Link to={href(`/tasks/${r.task_key}`)} viewTransition className="key">{r.task_key}</Link>}
              </div>
            </div>
          );
        })}
      </div>
      {!rows.length && <Empty mood="sleepy">{policy.agent_log ? 'No agent has done anything yet.' : 'Nothing logged.'}</Empty>}
    </>
  );
}
