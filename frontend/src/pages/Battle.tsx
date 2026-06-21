import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { BattleGrid, GridActor } from '../components/BattleGrid';
import { Layout } from '../components/Layout';
import { formatOutcomeSummary } from '../components/RewardsPanel';
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
  guarding?: boolean;
  guard_reduction?: number;
  has_shield?: boolean;
  prebattle_eligible?: boolean;
  prebattle_moved?: boolean;
  position: { x: number; y: number };
  battle_stat_mods?: Record<string, number>;
  battle_modifiers?: Record<string, number>;
  skills?: { id: number; name: string; uses_remaining: number; effect_type?: string }[];
  consumables?: { inventory_item_id: number; name: string; heal: number; quantity: number }[];
  weapon_profile?: {
    can_melee: boolean;
    can_ranged: boolean;
    melee_attack_bonus: number;
    ranged_attack_bonus: number;
    weapon_range: number;
  };
}

interface ActionHints {
  move_cells: { x: number; y: number }[];
  guard_cells: { x: number; y: number }[];
  melee_targets: { id: string; charge_cells: { x: number; y: number }[] }[];
  range_targets: string[];
  skill_range_targets?: string[];
  ally_targets?: { id: string; name: string; current_hp: number; max_hp: number }[];
  can_melee?: boolean;
  can_ranged?: boolean;
}

interface BattleState {
  status: string;
  phase?: string | null;
  grid: { width: number; height: number };
  actors: Actor[];
  active_actor_id: string | null;
  log: { message: string; timestamp: string }[];
  winner?: string;
  end_reason?: string;
  prebattle_pending?: string[];
  victory_rewards?: Record<string, unknown>;
  defeat_punishments?: Record<string, unknown>;
  outcome_rewards_applied?: boolean;
}

interface PrebattleHints {
  pending?: string[];
  actors?: Record<string, { x: number; y: number }[]>;
  actor_id?: string;
  cells?: { x: number; y: number }[];
}

interface BattleResponse {
  id: number;
  campaign_id: number;
  status: string;
  state: BattleState;
  my_character_id: number | null;
  is_master: boolean;
  action_hints?: ActionHints | null;
  prebattle_hints?: PrebattleHints | null;
}

type ActionMode = 'idle' | 'attack' | 'attack_charge' | 'skill_charge' | 'ranged_attack' | 'move' | 'guard' | 'skill' | 'ally_skill' | 'item';

function normalizeEffect(type?: string): string {
  if (type === 'power_strike') return 'melee';
  if (type === 'arcane_bolt') return 'range';
  return type || 'none';
}

export default function BattlePage() {
  const { id } = useParams();
  const battleId = Number(id);
  const navigate = useNavigate();
  const [battle, setBattle] = useState<BattleResponse | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<ActionMode>('idle');
  const [targetId, setTargetId] = useState('');
  const [skillId, setSkillId] = useState<number | null>(null);
  const [pendingItemId, setPendingItemId] = useState<number | null>(null);
  const [selectedPrebattleActorId, setSelectedPrebattleActorId] = useState('');

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

  const resetAction = () => {
    setMode('idle');
    setTargetId('');
    setSkillId(null);
    setPendingItemId(null);
  };

  const postAction = async (body: Record<string, unknown>) => {
    setError('');
    try {
      await api.post(`/battles/${battleId}/action`, body);
      resetAction();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  };

  if (!battle) return <Layout title="Battle">{error || 'Loading...'}</Layout>;

  const state = battle.state;
  const grid = state.grid || { width: 5, height: 5 };
  const active = state.actors.find((a) => a.id === state.active_actor_id);
  const myActor = state.actors.find((a) => a.character_id === battle.my_character_id);
  const isMyTurn = myActor && state.active_actor_id === myActor.id;
  const hints = battle.action_hints;
  const wp = myActor?.weapon_profile;
  const canMelee = hints?.can_melee ?? wp?.can_melee ?? true;
  const canRanged = hints?.can_ranged ?? wp?.can_ranged ?? false;
  const isPending = state.status === 'pending' || battle.status === 'pending';
  const isPrebattle = state.phase === 'prebattle';
  const prebattlePending = state.prebattle_pending || battle.prebattle_hints?.pending || [];
  const canStartBattle = isPending && battle.is_master && (!isPrebattle || prebattlePending.length === 0);

  const prebattleActorId = battle.is_master
    ? (selectedPrebattleActorId || prebattlePending[0] || '')
    : (battle.prebattle_hints?.actor_id || (myActor?.prebattle_eligible && !myActor.prebattle_moved ? myActor.id : ''));

  let prebattleHighlightCells: { x: number; y: number }[] = [];
  if (isPrebattle && prebattleActorId) {
    if (battle.is_master && battle.prebattle_hints?.actors?.[prebattleActorId]) {
      prebattleHighlightCells = battle.prebattle_hints.actors[prebattleActorId];
    } else if (battle.prebattle_hints?.cells) {
      prebattleHighlightCells = battle.prebattle_hints.cells;
    }
  }

  const doPrebattleMove = async (actorId: string, x: number, y: number) => {
    setError('');
    try {
      await api.post(`/battles/${battleId}/prebattle-move`, {
        actor_id: actorId,
        cell: { x, y },
      });
      setSelectedPrebattleActorId('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Move failed');
    }
  };

  const gridActors: GridActor[] = state.actors.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    position: a.position,
    alive: a.alive,
    character_id: a.character_id,
  }));

  let highlightCells: { x: number; y: number }[] = [];
  if (isPrebattle) {
    highlightCells = prebattleHighlightCells;
  } else if (mode === 'move' && hints) highlightCells = hints.move_cells;
  if (mode === 'guard' && hints) highlightCells = hints.guard_cells;
  if (mode === 'attack_charge' && targetId && hints) {
    const t = hints.melee_targets.find((m) => m.id === targetId);
    if (t) highlightCells = t.charge_cells;
  }
  if (mode === 'skill_charge' && targetId && hints) {
    const t = hints.melee_targets.find((m) => m.id === targetId);
    if (t) highlightCells = t.charge_cells;
  }

  const onCellClick = async (x: number, y: number) => {
    if (isPrebattle && prebattleActorId) {
      const actor = state.actors.find((a) => a.id === prebattleActorId);
      if (actor && actor.prebattle_eligible && !actor.prebattle_moved && prebattlePending.includes(prebattleActorId)) {
        await doPrebattleMove(prebattleActorId, x, y);
      }
      return;
    }
    if (!isMyTurn) return;
    if (mode === 'move') {
      await postAction({ action: 'move', actor_id: state.active_actor_id, move_cell: { x, y } });
    } else if (mode === 'guard') {
      await postAction({ action: 'guard', actor_id: state.active_actor_id, guard_cell: { x, y } });
    } else if (mode === 'attack_charge' && targetId) {
      await postAction({
        action: 'attack',
        actor_id: state.active_actor_id,
        target_id: targetId,
        charge_cell: { x, y },
      });
    } else if (mode === 'skill_charge' && targetId && skillId) {
      await postAction({
        action: 'skill',
        actor_id: state.active_actor_id,
        target_id: targetId,
        skill_id: skillId,
        charge_cell: { x, y },
      });
    }
  };

  const startAttack = (tid: string) => {
    const entry = hints?.melee_targets.find((m) => m.id === tid);
    if (entry && entry.charge_cells.length > 0) {
      setTargetId(tid);
      setMode('attack_charge');
    } else {
      postAction({ action: 'attack', actor_id: state.active_actor_id, target_id: tid });
    }
  };

  const startBattle = async (skipPrebattle = false) => {
    const qs = skipPrebattle ? '?skip_prebattle=true' : '';
    await api.post(`/battles/${battleId}/start${qs}`);
    load();
  };

  const endBattle = async () => {
    await api.post(`/battles/${battleId}/end`);
    load();
  };

  const sortedByInitiative = [...state.actors]
    .filter((a) => a.alive)
    .sort((a, b) => b.initiative_value - a.initiative_value);

  return (
    <Layout title="Battle">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-1 text-sm capitalize ${state.status === 'active' ? 'bg-green-900/50 text-green-300' : 'bg-dungeon-700'}`}>
          {isPrebattle ? 'pre-battle positioning' : state.status}
        </span>
        {canStartBattle && (
          <button type="button" className="btn-primary text-sm" onClick={() => startBattle(false)}>Start Battle</button>
        )}
        {isPrebattle && battle.is_master && prebattlePending.length > 0 && (
          <button type="button" className="btn-secondary text-sm" onClick={() => startBattle(true)}>
            Skip pre-battle &amp; start
          </button>
        )}
        {state.status === 'active' && battle.is_master && (
          <button type="button" className="btn-danger text-sm" onClick={endBattle}>End Battle</button>
        )}
        {state.status === 'completed' && (
          <button type="button" className="btn-secondary text-sm" onClick={() => navigate(battle.is_master ? `/organizer/campaigns/${battle.campaign_id}/control` : '/campaign')}>
            Return
          </button>
        )}
      </div>

      {error && <p className="mb-2 text-red-400">{error}</p>}

      {isPrebattle && (
        <div className="mb-4 rounded border border-dungeon-600 p-3 space-y-2">
          <p className="text-sm text-dungeon-300">
            High-initiative characters may move 1–2 cells before battle.
          </p>
          {prebattlePending.length > 0 ? (
            <>
              <p className="text-sm text-stone-400">
                Waiting for reposition:
                {' '}
                {prebattlePending.map((id) => state.actors.find((a) => a.id === id)?.name || id).join(', ')}
              </p>
              {battle.is_master && (
                <div className="space-y-2">
                  <p className="text-xs text-stone-500">Select a character, then click a highlighted cell to move them (or ask the player to do it on their device).</p>
                  <div className="flex flex-wrap gap-2">
                    {prebattlePending.map((id) => {
                      const actor = state.actors.find((a) => a.id === id);
                      return (
                        <button
                          key={id}
                          type="button"
                          className={`btn-secondary text-xs ${prebattleActorId === id ? 'ring-1 ring-dungeon-400' : ''}`}
                          onClick={() => setSelectedPrebattleActorId(id)}
                        >
                          Move {actor?.name || id}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {!battle.is_master && myActor && prebattlePending.includes(myActor.id) && (
                <p className="text-sm text-green-300">Click a highlighted cell on the grid to reposition your character.</p>
              )}
              {!battle.is_master && myActor && !prebattlePending.includes(myActor.id) && (
                <p className="text-sm text-stone-500">Waiting for teammates with high initiative to reposition…</p>
              )}
            </>
          ) : (
            <p className="text-sm text-green-300">Pre-battle moves complete. Master can start the battle.</p>
          )}
        </div>
      )}

      {state.status === 'active' && active && (
        <div className="card mb-4 border-dungeon-500">
          <p className="text-lg font-semibold text-dungeon-300">
            {isMyTurn ? 'Your turn!' : active.type === 'enemy' ? `${active.name} is acting…` : `${active.name}'s turn`}
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2 space-y-4">
          <h2 className="font-semibold text-dungeon-300">Battlefield</h2>
          <BattleGrid
            width={grid.width}
            height={grid.height}
            actors={gridActors}
            highlightCells={highlightCells}
            activeActorId={state.active_actor_id}
            onCellClick={onCellClick}
          />

          {isMyTurn && state.status === 'active' && (
            <div className="space-y-2 border-t border-dungeon-700 pt-4">
              <h3 className="font-medium text-dungeon-300">Actions</h3>
              {mode === 'idle' && (
                <div className="flex flex-wrap gap-2">
                  {canMelee && (
                    <button type="button" className="btn-primary" onClick={() => setMode('attack')}>Melee Attack</button>
                  )}
                  {canRanged && (
                    <button type="button" className="btn-primary" onClick={() => setMode('ranged_attack')}>Ranged Attack</button>
                  )}
                  <button type="button" className="btn-secondary" onClick={() => setMode('move')}>Move (6)</button>
                  <button type="button" className="btn-secondary" onClick={() => setMode('guard')}>Guard</button>
                  {myActor?.consumables?.filter((c) => c.quantity > 0 && c.heal > 0).map((c) => (
                    <button
                      key={c.inventory_item_id}
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => {
                        const allies = hints?.ally_targets || [];
                        if (allies.length <= 1) {
                          postAction({
                            action: 'use_item',
                            actor_id: state.active_actor_id,
                            inventory_item_id: c.inventory_item_id,
                            target_id: allies[0]?.id,
                          });
                        } else {
                          setPendingItemId(c.inventory_item_id);
                          setMode('item');
                        }
                      }}
                    >
                      {c.name}
                    </button>
                  ))}
                  {myActor?.skills?.filter((s) => s.uses_remaining > 0 && normalizeEffect(s.effect_type) !== 'none').map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => {
                        const eff = normalizeEffect(s.effect_type);
                        if (eff === 'heal' || eff === 'support') {
                          const allies = hints?.ally_targets || [];
                          if (allies.length <= 1) {
                            postAction({ action: 'skill', actor_id: state.active_actor_id, skill_id: s.id });
                          } else {
                            setSkillId(s.id);
                            setMode('ally_skill');
                          }
                        } else {
                          setSkillId(s.id);
                          setMode('skill');
                        }
                      }}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
              {mode === 'attack' && hints && (
                <div className="space-y-2">
                  <p className="text-sm text-stone-400">Select melee target:</p>
                  <div className="flex flex-wrap gap-2">
                    {hints.melee_targets.map((t) => {
                      const enemy = state.actors.find((a) => a.id === t.id);
                      return (
                        <button key={t.id} type="button" className="btn-primary text-xs" onClick={() => startAttack(t.id)}>
                          {enemy?.name}{t.charge_cells.length ? ' (charge)' : ''}
                        </button>
                      );
                    })}
                  </div>
                  <button type="button" className="btn-secondary text-xs" onClick={resetAction}>Cancel</button>
                </div>
              )}
              {mode === 'ranged_attack' && hints && (
                <div className="space-y-2">
                  <p className="text-sm text-stone-400">Select ranged target:</p>
                  <div className="flex flex-wrap gap-2">
                    {hints.range_targets.map((tid) => (
                      <button
                        key={tid}
                        type="button"
                        className="btn-primary text-xs"
                        onClick={() => postAction({
                          action: 'ranged_attack',
                          actor_id: state.active_actor_id,
                          target_id: tid,
                        })}
                      >
                        Shoot {state.actors.find((a) => a.id === tid)?.name}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="btn-secondary text-xs" onClick={resetAction}>Cancel</button>
                </div>
              )}
              {mode === 'attack_charge' && (
                <p className="text-sm text-stone-400">Click a highlighted cell beside your target to charge.</p>
              )}
              {mode === 'skill_charge' && (
                <p className="text-sm text-stone-400">Click a highlighted cell beside your target to charge with your skill.</p>
              )}
              {(mode === 'move' || mode === 'guard') && (
                <p className="text-sm text-stone-400">Click a highlighted cell to {mode === 'move' ? 'move' : 'guard'}.</p>
              )}
              {mode === 'ally_skill' && skillId && (
                <div className="space-y-2">
                  <p className="text-sm text-stone-400">Select ally to target:</p>
                  <div className="flex flex-wrap gap-2">
                    {(hints?.ally_targets || []).map((ally) => (
                      <button
                        key={ally.id}
                        type="button"
                        className="btn-primary text-xs"
                        onClick={() => postAction({
                          action: 'skill',
                          actor_id: state.active_actor_id,
                          skill_id: skillId,
                          target_id: ally.id,
                        })}
                      >
                        {ally.name} ({ally.current_hp}/{ally.max_hp})
                        {ally.id === state.active_actor_id ? ' — you' : ''}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="btn-secondary text-xs" onClick={resetAction}>Cancel</button>
                </div>
              )}
              {mode === 'item' && pendingItemId && (
                <div className="space-y-2">
                  <p className="text-sm text-stone-400">Select ally to heal:</p>
                  <div className="flex flex-wrap gap-2">
                    {(hints?.ally_targets || []).map((ally) => (
                      <button
                        key={ally.id}
                        type="button"
                        className="btn-primary text-xs"
                        onClick={() => postAction({
                          action: 'use_item',
                          actor_id: state.active_actor_id,
                          inventory_item_id: pendingItemId,
                          target_id: ally.id,
                        })}
                      >
                        {ally.name} ({ally.current_hp}/{ally.max_hp})
                        {ally.id === state.active_actor_id ? ' — you' : ''}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="btn-secondary text-xs" onClick={resetAction}>Cancel</button>
                </div>
              )}
              {mode === 'skill' && skillId && (
                <div className="space-y-2">
                  <p className="text-sm text-stone-400">Select target:</p>
                  {(() => {
                    const skill = myActor?.skills?.find((s) => s.id === skillId);
                    const eff = normalizeEffect(skill?.effect_type);
                    if (eff === 'range') {
                      return (hints?.skill_range_targets || []).map((tid) => (
                        <button
                          key={tid}
                          type="button"
                          className="btn-primary mr-2 text-xs"
                          onClick={() => postAction({ action: 'skill', actor_id: state.active_actor_id, target_id: tid, skill_id: skillId })}
                        >
                          {state.actors.find((a) => a.id === tid)?.name}
                        </button>
                      ));
                    }
                    return hints?.melee_targets.map((t) => (
                      <button key={t.id} type="button" className="btn-primary mr-2 text-xs" onClick={() => {
                        if (t.charge_cells.length) {
                          setTargetId(t.id);
                          setMode('skill_charge');
                        } else {
                          postAction({ action: 'skill', actor_id: state.active_actor_id, target_id: t.id, skill_id: skillId });
                        }
                      }}>
                        {state.actors.find((a) => a.id === t.id)?.name}
                      </button>
                    ));
                  })()}
                  <button type="button" className="btn-secondary text-xs" onClick={resetAction}>Cancel</button>
                </div>
              )}
              {mode !== 'idle' && mode !== 'attack' && mode !== 'ranged_attack' && mode !== 'attack_charge' && mode !== 'skill_charge' && mode !== 'ally_skill' && mode !== 'item' && (
                <button type="button" className="btn-secondary text-xs" onClick={resetAction}>Cancel</button>
              )}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="card">
            <h2 className="mb-2 font-semibold text-dungeon-300">Turn order</h2>
            <ul className="space-y-1 text-sm">
              {sortedByInitiative.map((a) => (
                <li key={a.id} className={a.id === state.active_actor_id ? 'text-dungeon-300 font-medium' : 'text-stone-500'}>
                  {a.name} ({a.initiative_value.toFixed(2)})
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2 className="mb-2 font-semibold text-dungeon-300">Combatants</h2>
            <div className="max-h-48 space-y-2 overflow-y-auto">
              {state.actors.map((a) => (
                <ActorCard key={a.id} actor={a} isActive={a.id === state.active_actor_id} isMe={a.character_id === battle.my_character_id} />
              ))}
            </div>
          </section>

          <section className="card">
            <h2 className="mb-2 font-semibold text-dungeon-300">Battle Log</h2>
            <div className="max-h-48 space-y-1 overflow-y-auto text-sm">
              {[...(state.log || [])].reverse().map((entry, i) => (
                <p key={i} className="text-stone-400">{entry.message}</p>
              ))}
            </div>
            {state.status === 'completed' && (
              <div className="mt-3 text-dungeon-300">
                <p>{state.winner === 'party' ? 'Victory!' : state.winner === 'enemies' ? 'Defeat...' : 'Battle ended.'}</p>
                {state.winner === 'party' && state.victory_rewards && formatOutcomeSummary(state.victory_rewards).length > 0 && (
                  <div className="mt-2 rounded border border-green-900/50 bg-green-950/30 p-2 text-sm">
                    <p className="text-green-400">Victory rewards applied</p>
                    <ul className="mt-1 list-inside list-disc text-xs text-stone-400">
                      {formatOutcomeSummary(state.victory_rewards).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {state.winner === 'enemies' && state.defeat_punishments && formatOutcomeSummary(state.defeat_punishments).length > 0 && (
                  <div className="mt-2 rounded border border-red-900/50 bg-red-950/30 p-2 text-sm">
                    <p className="text-red-400">Defeat consequences applied</p>
                    <ul className="mt-1 list-inside list-disc text-xs text-stone-400">
                      {formatOutcomeSummary(state.defeat_punishments).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>
        </aside>
      </div>
    </Layout>
  );
}

function ActorCard({ actor, isActive, isMe }: { actor: Actor; isActive?: boolean; isMe?: boolean }) {
  return (
    <div className={`rounded border p-2 text-sm ${isActive ? 'border-dungeon-400 bg-dungeon-800' : 'border-dungeon-700'} ${!actor.alive ? 'opacity-50' : ''}`}>
      <div className="flex justify-between">
        <span className="font-medium">{actor.name}{isMe ? ' (you)' : ''}</span>
        <span className="text-xs text-stone-500">{actor.type}</span>
      </div>
      <p>HP {actor.current_hp}/{actor.max_hp}</p>
      {(actor.shield_hp ?? 0) > 0 && <p className="text-xs text-dungeon-300">Shield {actor.shield_hp}</p>}
      {actor.guarding && (
        <p className="text-xs text-blue-300">Guarding (−{Math.round((actor.guard_reduction || 0.3) * 100)}% dmg)</p>
      )}
      {!actor.alive && <p className="text-xs text-red-400">Down</p>}
    </div>
  );
}
