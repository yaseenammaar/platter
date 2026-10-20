import { useMemo, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type Task, href } from '../api';
import type { SketchName } from '../sketch';
import { Avatar, Chip, COLUMNS, Empty, ErrorBox, Loading, Sketch, firstName, useApp, useLoad } from '../ui';

/** The one signal worth showing on a card, if any. */
function signal(t: Task): { icon: SketchName; text: string; tone: string } | null {
  if (t.handoff_open) return { icon: 'hand', text: 'Needs a hand', tone: 'handoff' };
  if (t.status === 'blocked') return { icon: 'stuck', text: 'Stuck', tone: 'stuck' };
  if (t.needs_attention) return { icon: 'refresh', text: 'Bouncing in review', tone: 'stuck' };
  if (t.status === 'in_progress' && t.review?.verdict === 'reject') return { icon: 'wrench', text: 'Fixing feedback', tone: 'review' };
  if (t.status === 'in_progress' && t.stale) return { icon: 'zzz', text: 'Gone quiet', tone: 'muted' };
  if (t.status === 'in_progress' && t.claimed_by_agent_name) return { icon: 'agent', text: 'Agent on it', tone: 'doing' };
  if (t.status === 'in_review') return { icon: 'eye', text: `${firstName(t.reviewer_name)} to check`, tone: 'review' };
  if (t.status === 'backlog') return { icon: 'pencil', text: 'Draft', tone: 'muted' };
  return null;
}

/** Give the clicked card's title a view-transition name so it morphs into the task page title. */
export const morphTitle = (e: MouseEvent<HTMLElement>) => {
  const el = e.currentTarget.querySelector<HTMLElement>('.card-title');
  if (el) el.style.viewTransitionName = 'task-title';
};

export function TaskCard({ t }: { t: Task }) {
  const s = signal(t);
  return (
    <Link to={href(`/tasks/${t.key}`)} viewTransition onClick={morphTitle} className={`card ${t.status === 'backlog' ? 'draft' : ''}`}>
      <div className="card-title">
        {t.priority === 'P0' && <span className="hot" title="Urgent"><Sketch name="flame" size={16} /></span>}
        {t.priority === 'P1' && <span className="hot high" title="High priority"><Sketch name="up" size={15} /></span>}
        {t.title}
      </div>
      <div className="card-foot">
        <Avatar name={t.assignee_name} size={22} />
        {s && <Chip icon={s.icon} tone={s.tone}>{s.text}</Chip>}
        <span className="key">{t.key}</span>
      </div>
    </Link>
  );
}

export function BoardPage() {
  const { me, projects, team } = useApp();
  const [project, setProject] = useState(() => localStorage.getItem(`platter_project:${team.slug}`) ?? '');
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState('');
  const { data, error } = useLoad(() => api.get<{ tasks: Task[] }>(`/tasks${project ? `?project=${project}` : ''}`), [project], 10_000);

  const tasks = useMemo(() => {
    let ts = data?.tasks ?? [];
    if (mine) ts = ts.filter((t) => t.assignee_id === me.id || t.reviewer_id === me.id);
    if (search.trim()) {
      const s = search.toLowerCase();
      ts = ts.filter((t) => t.title.toLowerCase().includes(s) || t.key.toLowerCase().includes(s));
    }
    return ts;
  }, [data, mine, search, me.id]);

  if (!data && !error) return <Loading />;

  return (
    <div className="page wide">
      <header className="head">
        <h1>Board</h1>
        <div className="tools">
          {projects.length > 1 && (
            <select value={project} onChange={(e) => { setProject(e.target.value); localStorage.setItem(`platter_project:${team.slug}`, e.target.value); }}>
              <option value="">All projects</option>
              {projects.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>
          )}
          <button className={`toggle ${mine ? 'on' : ''}`} onClick={() => setMine(!mine)}>Just mine</button>
          <label className="search surface"><Sketch name="review" size={16} /><input placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        </div>
      </header>
      <ErrorBox error={error} />
      {data && !data.tasks.length ? (
        <Empty mood="happy">An empty platter! Tap <b>New</b> below to serve up the first task.</Empty>
      ) : (
        <div className="board">
          {COLUMNS.map((c, ci) => {
            let items = tasks.filter((t) => (c.statuses as readonly string[]).includes(t.status));
            // Drafts sink to the bottom of To do; Done shows the most recent few.
            if (c.id === 'todo') items = [...items.filter((t) => t.status === 'ready'), ...items.filter((t) => t.status === 'backlog')];
            if (c.id === 'done') items = items.sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')).slice(0, 12);
            return (
              <section key={c.id} className={`col col-${c.id}`} style={{ ['--d' as any]: `${ci * 60}ms` }}>
                <h3><Sketch name={c.icon} size={18} />{c.title}<span className="n">{items.length}</span></h3>
                <div className="col-body">
                  {items.map((t, i) => <div key={t.id} className="rise" style={{ ['--d' as any]: `${ci * 60 + i * 35}ms` }}><TaskCard t={t} /></div>)}
                  {!items.length && <div className="col-empty hand">{c.id === 'done' ? 'nothing served yet' : 'empty plate'}</div>}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
