const API = '/api';

export function getToken(): string | null {
  return localStorage.getItem('token');
}

export function setToken(token: string) {
  localStorage.setItem('token', token);
}

export function clearToken() {
  localStorage.removeItem('token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
  ...(options.headers as Record<string, string> || {}),
  };
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Request failed');
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export interface UserInfo {
  id: number;
  username: string;
  role: string;
  has_character: boolean;
}

export interface Character {
  id: number;
  name: string;
  race: string;
  portrait_path?: string;
  stats: Record<string, number>;
  max_hp: number;
  current_hp: number;
  effective_stats?: Record<string, number>;
  attack_bonus?: number;
  username?: string;
  skills: { id: number; name: string; uses_remaining: number; max_uses_per_rest: number }[];
  inventory: {
    id: number;
    name: string;
    item_type: string;
    tier: number;
    description: string;
    stats: Record<string, number | boolean>;
    equipped_slot: string | null;
    quantity: number;
    item_template_id: number;
    equippable: boolean;
    bag_only: boolean;
    equip_slots: string[];
  }[];
  temporary_effects: { id: number; label: string; stat_modifiers: Record<string, number> }[];
}
