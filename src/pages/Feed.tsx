import { useState } from 'react';
import { api, type ActivityItem } from '../api';
import { Empty, ErrorBox, Loading, Sketch, useLoad } from '../ui';
import type { SketchName } from '../sketch';
import { StoryLine } from './Task';

const FILTERS: Record<string, { icon?: SketchName; test: (e: ActivityItem) => boolean }> = {
  Everything: { test: (e) => e.kind !== 'edited' },
  Agents: { icon: 'agent', test: (e) => !!e.agent_name },
  Talk: { icon: 'chat', test: (e) => ['comment', 'ask', 'answer'].includes(e.kind) },
  Wins: { icon: 'sparkle', test: (e) => e.kind === 'approve' },
};

const dayLabel = (d: string) => {
  const date = new Date(d);
  const today = new Date();
  const yest = new Date(Date.now() - 86400_000);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yest.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
};

export function FeedPage() {
  const [filter, setFilter] = useState('Everything');
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
    <div className="page narrow">
      <header className="head">
        <h1>Feed</h1>
        <div className="chips">
          {Object.entries(FILTERS).map(([f, v]) => <button key={f} className={`toggle ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>{v.icon && <Sketch name={v.icon} size={14} />}{f}</button>)}
        </div>
      </header>
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
    </div>
  );
}
