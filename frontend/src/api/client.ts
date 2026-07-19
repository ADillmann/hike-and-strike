export const REWARDS_BLOCKED_DURING_BATTLE =
  'No rewards or punishments can be granted during an active battle. Finish the battle first.';

const API = '/api';

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

export interface SkillCapErrorDetail {
  code: 'skill_cap_reached';
  message: string;
  skills: { id: number; name: string; skill_template_id: number | null }[];
  skill_to_learn: { skill_template_id: number; name: string; effect_type?: string };
}

export function isSkillCapError(detail: unknown): detail is SkillCapErrorDetail {
  return (
    typeof detail === 'object'
    && detail !== null
    && (detail as SkillCapErrorDetail).code === 'skill_cap_reached'
  );
}

function errorMessage(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join('; ') || 'Request failed';
  }
  if (isSkillCapError(detail)) return detail.message;
  if (typeof detail === 'object' && detail !== null && 'message' in detail) {
    const msg = (detail as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return 'Request failed';
}

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
    const detail = err.detail;
    throw new ApiError(res.status, detail, errorMessage(detail));
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
  class_template_id?: number | null;
  portrait_path?: string;
  stats: Record<string, number>;
  max_hp: number;
  current_hp: number;
  level?: number;
  xp?: number;
  xp_to_next_level?: number;
  stat_points_free?: number;
  level_stat_allocations?: Record<string, number>;
  stat_raise_costs?: Record<string, number>;
  wallet_copper?: number;
  wallet_display?: string;
  in_active_battle?: boolean;
  effective_stats?: Record<string, number>;
  attack_bonus?: number;
  username?: string;
  skill_slots?: Record<string, { used: number; max: number }>;
  skills: {
    id: number;
    skill_template_id?: number | null;
    name: string;
    uses_remaining: number;
    max_uses_per_rest: number;
    effect_type?: string;
    description?: string;
    effect_params?: Record<string, string | number>;
    slot_kind?: string | null;
  }[];
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
    base_price?: number;
    price_display?: string | null;
    secret_template_id?: number | null;
    secret_state?: { examined: boolean; revealed: boolean };
    revealed_description?: string;
    secret_solver_type?: string;
    secret_solver_hints?: Record<string, unknown>;
    skill_template_id?: number | null;
    teaches_skill_name?: string | null;
    teaches_skill_effect_type?: string | null;
  }[];
  temporary_effects: {
    id: number;
    label: string;
    stat_modifiers: Record<string, number>;
    battle_modifiers?: Record<string, number>;
    active_in_battle?: boolean;
    cleared_on_rest?: boolean;
    cleared_on_event?: boolean;
  }[];
  item_effects?: {
    source_item: string;
    label: string;
    stat_modifiers: Record<string, number>;
    battle_modifiers?: Record<string, number>;
    active_in_battle?: boolean;
  }[];
}

export interface ClassTemplate {
  id: number;
  name: string;
  description: string;
  base_stats: Record<string, number>;
  is_system?: boolean;
}
