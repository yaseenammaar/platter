export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details: string[] = []) {
    super(message);
  }
}

// The team you're working in comes from the URL (/t/:team/...) and rides along on every request.
let currentTeam = '';
export const setTeam = (slug: string) => {
  currentTeam = slug;
  try { localStorage.setItem('platter_team', slug); } catch { /* private mode */ }
};
export const lastTeam = () => { try { return localStorage.getItem('platter_team') ?? ''; } catch { return ''; } };
/** Build an in-app link inside the current team. */
export const href = (p: string) => `/t/${currentTeam}${p === '/' ? '' : p}`;

async function request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-platter': '1', ...(currentTeam ? { 'x-team': currentTeam } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data.message ?? res.statusText, data.details ?? []);
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>('GET', p),
  post: <T = any>(p: string, b: unknown = {}) => request<T>('POST', p, b),
  patch: <T = any>(p: string, b: unknown) => request<T>('PATCH', p, b),
  del: <T = any>(p: string) => request<T>('DELETE', p),
};

export type Status = 'backlog' | 'ready' | 'in_progress' | 'blocked' | 'in_review' | 'done' | 'cancelled';
export type Role = 'owner' | 'admin' | 'member' | 'viewer';

export interface Member {
  id: string; name: string; email: string; role: Role; status?: string;
  active_agents?: number; agent_last_seen?: string | null;
  ready?: number; in_progress?: number; blocked?: number; to_review?: number; done_7d?: number; rework_30d?: number;
}
export interface Criterion { id: string; text: string }
export interface Task {
  id: string; key: string; number: number; project_key: string; project_name: string;
  title: string; description: string; context: string; acceptance_criteria: Criterion[];
  type: string; priority: string; status: Status; labels: string[]; depends_on: string[];
  assignee_id: string | null; assignee_name: string | null;
  reviewer_id: string | null; reviewer_name: string | null;
  reporter_id: string; reporter_name: string;
  claimed_by_agent_name: string | null; created_by_agent_name: string | null;
  last_heartbeat_at: string | null; blocked_reason: string | null;
  submission: any; review: any; rework_count: number; due_date: string | null;
  created_at: string; updated_at: string; completed_at: string | null;
  stale: boolean; needs_attention: boolean; version: number;
  handoff: { requested_at: string; from_member: string; from_agent: string | null; reason: string; notes: string } | null;
  handoff_open: boolean; contributors: string[]; claimed_agent_usage: number | null;
}
export interface ActivityItem {
  id: number; kind: string; message: string; data: any; created_at: string;
  member_name: string | null; agent_name: string | null; task_key: string | null; task_title: string | null;
}
export interface Project { id: string; key: string; name: string; agent_instructions: string; wip_limit: number; open_tasks: number }
export interface ContextPack {
  task: Task; project: { key: string; name: string; agent_instructions: string; wip_limit: number };
  dependencies: { key: string; title: string; status: Status }[];
  dependents: { key: string; title: string; status: Status }[];
  activity: ActivityItem[]; allowed_actions: string[]; definition_of_ready_gaps: string[]; your_role: string[];
}
export interface Ask {
  id: string; question: string; answer: string | null; status: 'open' | 'answered' | 'closed';
  from_member_id: string; from_name: string; from_agent_name: string | null;
  to_member_id: string; to_name: string;
  answered_by_name: string | null; answered_by_agent_name: string | null;
  task_key: string | null; task_title: string | null; created_at: string; answered_at: string | null;
}
export interface Team { slug: string; name: string; role: Role }
