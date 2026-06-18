import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { Layout } from '../components/Layout';
import { useCampaignSocket } from '../hooks/useCampaignSocket';

interface Actor {
  id: string;
  type: 'player' | 'enemy';
  character_id?: number;
  name: string;
  current_hp: number;
  max_hp: number;
  alive: boolean;
  initiative_value: number;
  attack_bonus: number;
  shield_hp?: number;
  battle_stat_mods?: Record<string, number>;
  skills?: { id: number; name: string; uses_remaining: number; effect_type?: string }[];
}

function normalizeEffect(type?: string): string {
  if (type === 'power_strike') return 'melee';
  if (type === 'arcane_bolt') return 'range';
  return type || 'none';
}

function skillNeedsEnemyTarget(effectType?: string): boolean {
  const t = normalizeEffect(effectType);
  return t === 'melee' || t === 'range';
}

interface BattleState {
  status: string;
  actors: Actor[];
  active_actor_id: string | null;
  log: { message: string; timestamp: string }[];
  winner?: string;
  end_reason?: string;
}

interface BattleResponse {
  id: number;
  campaign_id: number;
  status: string;
  state: BattleState;
  my_character_id: number | null;
  is_master: boolean;
}

export default function BattlePage() {
  const { id } = useParams();
  const battleId = Number(id);
  const navigate = useNavigate();
  const [battle, setBattle] = useState<BattleResponse | null>(null);
  const [targetId, setTargetId] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    if (!battleId) return;
    api.get<BattleResponse>(`/battles/${battleId}`).then(setBattle).catch(() => setError('Battle not found'));
  };

  useEffect(() => { load(); }, [battleId]);

  useCampaignSocket(battle?.campaign_id ?? null, (msg: { type: string; data?: unknown }) => {
    if (msg.type === 'battle_updated' && msg.data && (msg.data as { battle_id: number }).battle_id === battleId) {
      load();
    }
  });

  if (!battle) return <Layout title="Battle">{error || 'Loading...'}</Layout>;

  const state = battle.state;
  const active = state.actors.find((a) => a.id === state.active_actor_id);
  const myActor = state.actors.find((a) => a.character_id === battle.my_character_id);
  const isMyTurn = myActor && state.active_actor_id === myActor.id;
  const enemies = state.actors.filter((a) => a.type === 'enemy' && a.alive);
  const players = state.actors.filter((a) => a.type === 'player');

  const doAction = async (action: string, skillId?: number) => {
    setError('');
    try {
      await api.post(`/battles/${battleId}/action`, {
        action,
        actor_id: state.active_actor_id,
        target_id: targetId || undefined,
        skill_id: skillId,
      });
      setTargetId('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const startBattle = async () => {
    await api.post(`/battles/${battleId}/start`);
    load();
  };

  const endBattle = async () => {
    await api.post(`/battles/${battleId}/end`);
    load();
  };

  return (
    <Layout title="Battle">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-1 text-sm capitalize ${state.status === 'active' ? 'bg-green-900/50 text-green-300' : 'bg-dungeon-700'}`}>
          {state.status}
        </span>
        {state.status === 'pending' && battle.is_master && (
          <button className="btn-primary text-sm" onClick={startBattle}>Start Battle</button>
        )}
        {state.status === 'active' && battle.is_master && (
          <button className="btn-danger text-sm" onClick={endBattle}>End Battle</button>
        )}
        {state.status === 'completed' && (
          <button className="btn-secondary text-sm" onClick={() => navigate(battle.is_master ? `/organizer/campaigns/${battle.campaign_id}/control` : '/campaign')}>
            Return
          </button>
        )}
      </div>

      {error && <p className="mb-2 text-red-400">{error}</p>}

      {state.status === 'active' && active && (
        <div className="card mb-4 border-dungeon-500">
          <p className="text-lg font-semibold text-dungeon-300">
            {isMyTurn ? 'Your turn!' : `${active.name}'s turn`}
          </p>
          {active.initiative_value !== undefined && (
            <p className="text-xs text-stone-500">Initiative: {active.initiative_value.toFixed(3)}</p>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <h2 className="mb-3 font-semibold text-dungeon-300">Combatants</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {players.map((a) => (
              <ActorCard key={a.id} actor={a} isActive={a.id === state.active_actor_id} isMe={a.character_id === battle.my_character_id} />
            ))}
            {state.actors.filter((a) => a.type === 'enemy').map((a) => (
              <ActorCard key={a.id} actor={a} isActive={a.id === state.active_actor_id} />
            ))}
          </div>

          {(isMyTurn || (battle.is_master && active?.type === 'enemy')) && state.status === 'active' && (
            <div className="mt-4 space-y-2 border-t border-dungeon-700 pt-4">
              <h3 className="font-medium text-dungeon-300">Actions</h3>
              {active?.type === 'enemy' && battle.is_master ? (
                <>
                  <select className="input" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                    <option value="">Auto-target</option>
                    {players.filter((p) => p.alive).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <button className="btn-primary" onClick={() => doAction('enemy_attack')}>Enemy Attacks</button>
                </>
              ) : isMyTurn && (
                <>
                  <select className="input" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                    <option value="">Select target...</option>
                    {enemies.map((e) => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                    {players.filter((p) => p.alive && p.id !== myActor?.id).map((p) => (
                      <option key={p.id} value={p.id}>{p.name} (ally)</option>
                    ))}
                  </select>
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-primary" onClick={() => doAction('attack')} disabled={!targetId || !enemies.some((e) => e.id === targetId)}>Attack</button>
                    {myActor?.skills
                      ?.filter((s) => s.uses_remaining > 0 && normalizeEffect(s.effect_type) !== 'none')
                      .map((s) => {
                        const effect = normalizeEffect(s.effect_type);
                        const disabled = skillNeedsEnemyTarget(effect)
                          ? !targetId || !enemies.some((e) => e.id === targetId)
                          : false;
                        return (
                          <button
                            key={s.id}
                            className="btn-secondary"
                            onClick={() => doAction('skill', s.id)}
                            disabled={disabled}
                          >
                            {s.name}
                          </button>
                        );
                      })}
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        <section className="card">
          <h2 className="mb-2 font-semibold text-dungeon-300">Battle Log</h2>
          <div className="max-h-64 space-y-1 overflow-y-auto text-sm">
            {[...(state.log || [])].reverse().map((entry, i) => (
              <p key={i} className="text-stone-400">{entry.message}</p>
            ))}
          </div>
          {state.status === 'completed' && (
            <p className="mt-3 text-dungeon-300">
              {state.winner === 'party' ? 'Victory!' : state.winner === 'enemies' ? 'Defeat...' : 'Battle ended.'}
            </p>
          )}
        </section>
      </div>
    </Layout>
  );
}

function ActorCard({ actor, isActive, isMe }: { actor: Actor; isActive?: boolean; isMe?: boolean }) {
  const mods = actor.battle_stat_mods || {};
  const modLines = Object.entries(mods).filter(([, v]) => v !== 0);

  return (
    <div className={`rounded border p-3 ${isActive ? 'border-dungeon-400 bg-dungeon-800' : 'border-dungeon-700'} ${!actor.alive ? 'opacity-50' : ''}`}>
      <div className="flex justify-between">
        <span className="font-medium">{actor.name}{isMe ? ' (you)' : ''}</span>
        <span className="text-xs text-stone-500">{actor.type}</span>
      </div>
      <p className="text-sm">HP {actor.current_hp}/{actor.max_hp}</p>
      {(actor.shield_hp ?? 0) > 0 && (
        <p className="text-xs text-dungeon-300">Shield {actor.shield_hp}</p>
      )}
      {modLines.length > 0 && (
        <p className="text-xs text-stone-500">
          {modLines.map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(', ')}
        </p>
      )}
      {!actor.alive && <p className="text-xs text-red-400">Down</p>}
    </div>
  );
}
