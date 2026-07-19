import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, Character, REWARDS_BLOCKED_DURING_BATTLE } from '../../api/client';
import { Layout } from '../../components/Layout';
import { PartyCharacterEditModal } from '../../components/PartyCharacterEditModal';
import { BattleGrid, cycleTerrainType, GridActor, isImpassableTerrain, MAX_BATTLE_GRID, MIN_BATTLE_GRID, normalizeTerrainCells, suggestedGridSize, TerrainCell } from '../../components/BattleGrid';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DiceBox } from '../../components/DiceBox';
import { RewardsPanel, RewardsPayload, EffectTemplate } from '../../components/RewardsPanel';
import { useCampaignSocket } from '../../hooks/useCampaignSocket';
import { ITEM_TYPE_FILTER_OPTIONS, ItemTypeFilter } from '../../utils/itemTypes';
import { useLocale } from '../../context/LocaleContext';
import type { LayoutTheme } from '../../context/LayoutThemeContext';

interface CampaignState {
  campaign_id: number;
  name: string;
  status: string;
  layout_theme?: LayoutTheme;
  current_node: {
    node_id: number;
    event: { name: string; description: string; event_type: string; images: string[] };
  } | null;
  party: { id: number; name: string; username: string; stats: Record<string, number>; max_hp: number; current_hp: number }[];
}

interface Node {
  id: number;
  sort_order: number;
  event_name: string;
  event_type: string;
  label?: string | null;
}
interface EventTemplate { id: number; name: string; event_type: string }
interface Item { id: number; name: string; tier: number }
interface HistoryEntry {
  id: number;
  node_id?: number | null;
  event_name: string;
  outcome: string;
  master_notes: string;
  rewards_json: Record<string, unknown> | null;
  punishments_json: Record<string, unknown> | null;
  timestamp: string;
}

function formatNodeOption(n: Node, index: number): string {
  return `#${index + 1} ${n.event_name} (${n.event_type})`;
}

function buildLatestOutcomes(history: HistoryEntry[]): Map<number, { outcome: string; master_notes: string | null }> {
  const map = new Map<number, { outcome: string; master_notes: string | null }>();
  for (const entry of history) {
    if (entry.node_id != null && !map.has(entry.node_id)) {
      map.set(entry.node_id, { outcome: entry.outcome, master_notes: entry.master_notes || null });
    }
  }
  return map;
}

function outcomeBadgeClass(outcome: string): string {
  switch (outcome) {
    case 'success': return 'bg-green-900/50 text-green-400';
    case 'failure': return 'bg-red-900/50 text-red-400';
    case 'partial': return 'bg-yellow-900/50 text-yellow-400';
    default: return 'bg-dungeon-700 text-stone-400';
  }
}

export default function CampaignControlPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useLocale();
  const campaignId = Number(id);
  const [state, setState] = useState<CampaignState | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [events, setEvents] = useState<EventTemplate[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [effects, setEffects] = useState<EffectTemplate[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [nextNodeId, setNextNodeId] = useState(0);
  const [outcome, setOutcome] = useState('success');
  const [notes, setNotes] = useState('');
  const [applyRest, setApplyRest] = useState(false);
  const [advanceRewards, setAdvanceRewards] = useState<RewardsPayload>({});
  const [showBattleSetup, setShowBattleSetup] = useState(false);
  const [activeBattleId, setActiveBattleId] = useState<number | null>(null);
  const [battleOutcome, setBattleOutcome] = useState<'party' | 'enemies' | null>(null);
  const [editChar, setEditChar] = useState<Character | null>(null);
  const [advanceConfirmOpen, setAdvanceConfirmOpen] = useState(false);
  const [addEventTemplateId, setAddEventTemplateId] = useState(0);
  const [addEventLabel, setAddEventLabel] = useState('');
  const [insertPosition, setInsertPosition] = useState(1);
  const [addEventError, setAddEventError] = useState('');

  const loadCampaignNodes = useCallback(async (selectNodeId?: number) => {
    const campaigns = await api.get<{ id: number; nodes: Node[] }[]>('/campaigns');
    const c = campaigns.find((x) => x.id === campaignId);
    if (!c) return;
    const sorted = [...c.nodes].sort((a, b) => a.sort_order - b.sort_order);
    setNodes(sorted);
    if (selectNodeId) {
      setNextNodeId(selectNodeId);
    } else {
      setNextNodeId((prev) => prev || sorted[0]?.id || 0);
    }
  }, [campaignId]);

  const load = useCallback(() => {
    if (!campaignId) return;
    api.get<CampaignState>(`/campaigns/${campaignId}/state`).then(setState);
    loadCampaignNodes();
    api.get<HistoryEntry[]>(`/campaigns/${campaignId}/history`).then(setHistory);
    api.get<Item[]>('/items').then(setItems);
    api.get<EffectTemplate[]>('/effects').then(setEffects);
    api.get<EventTemplate[]>('/events').then((evs) => {
      setEvents(evs);
      if (evs[0]) setAddEventTemplateId(evs[0].id);
    });
    api.get<{ active: boolean; battle_id?: number }>(`/battles/campaigns/${campaignId}/active`).then((b) => {
      setActiveBattleId(b.active && b.battle_id ? b.battle_id : null);
    });
  }, [campaignId, loadCampaignNodes]);

  useEffect(() => { load(); }, [load]);

  useCampaignSocket(campaignId, (msg) => {
    if (msg.type === 'campaign_state') setState(msg.data as CampaignState);
    if (msg.type === 'history_added' || msg.type === 'character_updated') load();
    if (msg.type === 'battle_started' && msg.data && typeof msg.data === 'object') {
      const d = msg.data as { battle_id: number };
      setActiveBattleId(d.battle_id);
    }
    if (msg.type === 'battle_updated' && msg.data && typeof msg.data === 'object') {
      const d = msg.data as { battle_id: number; state?: { status?: string; winner?: string } };
      const battleStatus = d.state?.status;
      if (battleStatus === 'active' || battleStatus === 'pending') {
        setActiveBattleId(d.battle_id);
        setBattleOutcome(null);
      } else if (battleStatus === 'completed') {
        setActiveBattleId(null);
        const winner = d.state?.winner;
        if (winner === 'party' || winner === 'enemies') {
          setBattleOutcome(winner);
        }
        load();
      }
    }
    if (msg.type === 'battle_cancelled' && msg.data && typeof msg.data === 'object') {
      setActiveBattleId(null);
    }
  });

  useEffect(() => {
    const target = nodes.find((n) => n.id === nextNodeId);
    setApplyRest(target?.event_type === 'rest');
  }, [nextNodeId, nodes]);

  const advance = async () => {
    const payload: Record<string, unknown> = {
      node_id: nextNodeId || state?.current_node?.node_id,
      outcome,
      master_notes: notes,
      apply_rest: applyRest,
    };
    if (advanceRewards.rewards) payload.rewards = advanceRewards.rewards;
    if (advanceRewards.punishments) payload.punishments = advanceRewards.punishments;
    await api.post(`/campaigns/${campaignId}/advance`, payload);
    setNotes('');
    setAdvanceRewards({});
    setBattleOutcome(null);
    setAdvanceConfirmOpen(false);
    load();
  };

  const pauseCampaign = async () => {
    await api.post(`/campaigns/${campaignId}/pause`);
    load();
  };

  const completeCampaign = async () => {
    await api.post(`/campaigns/${campaignId}/complete`);
    navigate('/organizer/campaigns');
  };

  const resumeCampaign = async () => {
    await api.post(`/campaigns/${campaignId}/start`);
    load();
  };

  const updateLayoutTheme = async (theme: LayoutTheme) => {
    await api.patch(`/campaigns/${campaignId}/layout-theme`, { layout_theme: theme });
    load();
  };

  useEffect(() => {
    setInsertPosition(nodes.length + 1);
  }, [nodes.length]);

  const appendEvent = async () => {
    if (!addEventTemplateId) return;
    setAddEventError('');
    try {
      const res = await api.post<{ campaign: { nodes: Node[] }; new_node_id: number }>(`/campaigns/${campaignId}/nodes`, {
        event_template_id: addEventTemplateId,
        label: addEventLabel.trim() || null,
        insert_position: insertPosition,
      });
      const sorted = [...res.campaign.nodes].sort((a, b) => a.sort_order - b.sort_order);
      setNodes(sorted);
      setNextNodeId(res.new_node_id);
      setAddEventLabel('');
      setInsertPosition(sorted.length + 1);
    } catch (err) {
      setAddEventError(err instanceof Error ? err.message : 'Could not add event');
    }
  };

  const openCharacterEdit = async (charId: number) => {
    const c = await api.get<Character>(`/characters/${charId}`);
    setEditChar(c);
  };

  if (!state) return <Layout title="Campaign Control">Loading...</Layout>;

  const targetNode = nodes.find((n) => n.id === nextNodeId);
  const currentNodeId = state.current_node?.node_id;
  const sortedNodes = [...nodes].sort((a, b) => a.sort_order - b.sort_order);
  const canModifyEvents = state.status === 'active' || state.status === 'paused';
  const nodeOutcomes = buildLatestOutcomes(history);
  const advanceConfirmMessage = [
    `Record "${state.current_node?.event.name || 'current event'}" as ${outcome} and move the party to "${targetNode?.event_name || 'selected event'}"?`,
    applyRest && targetNode?.event_type === 'rest' ? 'Rest will be applied.' : null,
    advanceRewards.rewards || advanceRewards.punishments ? 'Attached rewards/punishments will also be applied.' : null,
  ].filter(Boolean).join(' ');

  return (
    <Layout title={`Campaign: ${state.name}`}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="rounded bg-dungeon-700 px-2 py-1 text-sm capitalize">{state.status}</span>
        {state.status === 'active' && (
          <>
            <button className="btn-secondary text-sm" onClick={pauseCampaign}>Pause</button>
            <button className="btn-danger text-sm" onClick={completeCampaign}>Complete</button>
          </>
        )}
        {state.status === 'paused' && (
          <button className="btn-primary text-sm" onClick={resumeCampaign}>Resume</button>
        )}
        <label className="ml-auto flex items-center gap-2 text-sm text-stone-400">
          <span>{t('layout.label')}</span>
          <select
            className="input w-auto py-1"
            value={state.layout_theme || 'default'}
            onChange={(e) => updateLayoutTheme(e.target.value as LayoutTheme)}
          >
            <option value="default">{t('layout.default')}</option>
            <option value="fantasy">{t('layout.fantasy')}</option>
            <option value="cyberpunk">{t('layout.cyberpunk')}</option>
            <option value="knight">{t('layout.knight')}</option>
          </select>
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <h2 className="mb-2 text-lg font-semibold text-dungeon-300">
            Current: {state.current_node?.event.name || '—'}
          </h2>
          <p className="mb-2 text-xs text-stone-500">{state.current_node?.event.event_type}</p>
          <p className="whitespace-pre-wrap text-stone-300">{state.current_node?.event.description}</p>
          {state.current_node?.event.images && state.current_node.event.images.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {state.current_node.event.images.map((img, i) => (
                <img key={i} src={img} alt="" className="max-h-48 rounded border border-dungeon-600 object-cover" />
              ))}
            </div>
          )}
          {state.current_node?.event.event_type === 'battle_hook' && (
            <div className="mt-3 rounded border border-dungeon-500 p-3">
              <p className="text-dungeon-300 mb-2">Battle encounter</p>
              {battleOutcome === 'party' && !activeBattleId && (
                <div className="mb-3 rounded border border-green-800 bg-green-950/30 p-2 text-sm">
                  <p className="text-green-400">Battle won — victory rewards were applied.</p>
                  <p className="mt-1 text-xs text-stone-400">Advance the campaign when the party is ready.</p>
                  <button type="button" className="btn-secondary mt-2 text-xs" onClick={() => setBattleOutcome(null)}>Dismiss</button>
                </div>
              )}
              {battleOutcome === 'enemies' && !activeBattleId && (
                <div className="mb-3 rounded border border-red-800 bg-red-950/30 p-2 text-sm">
                  <p className="text-red-400">The party was defeated — defeat consequences were applied.</p>
                  <p className="mt-1 text-xs text-stone-400">Advance or adjust the story when ready.</p>
                  <button type="button" className="btn-secondary mt-2 text-xs" onClick={() => setBattleOutcome(null)}>Dismiss</button>
                </div>
              )}
              {activeBattleId ? (
                <button className="btn-primary text-sm" onClick={() => navigate(`/battle/${activeBattleId}`)}>
                  Open Battle #{activeBattleId}
                </button>
              ) : (
                <button className="btn-primary text-sm" onClick={() => setShowBattleSetup(true)}>Start Battle</button>
              )}
            </div>
          )}
        </section>

        <section className="card">
          <h2 className="mb-2 font-semibold text-dungeon-300">Party</h2>
          {state.party.map((p) => (
            <div key={p.id} className="mb-2 rounded border border-dungeon-600 p-2 text-sm">
              <div className="flex justify-between">
                <span className="font-medium">{p.name}</span>
                <span>HP {p.current_hp}/{p.max_hp}</span>
              </div>
              <div className="mt-1">
                <button className="btn-secondary px-2 py-0.5 text-xs" onClick={() => openCharacterEdit(p.id)}>Edit</button>
              </div>
            </div>
          ))}
        </section>

        <RewardsPanel
          campaignId={campaignId}
          party={state.party}
          items={items}
          effects={effects}
          onApplied={load}
          rewardsBlocked={!!activeBattleId}
        />

        <DiceBox />

        <section className="card">
          <h2 className="mb-2 font-semibold text-dungeon-300">Advance Event</h2>
          <p className="mb-2 text-xs text-stone-500">
            Record how the party resolved <span className="text-dungeon-400">{state.current_node?.event.name || 'the current event'}</span>, then move to the next event.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="label">Next event</label>
              <select className="input" value={nextNodeId || state.current_node?.node_id || 0} onChange={(e) => setNextNodeId(+e.target.value)}>
                {sortedNodes.map((n, i) => (
                  <option key={n.id} value={n.id}>{formatNodeOption(n, i)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Outcome (current event)</label>
              <select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                <option value="success">Success</option>
                <option value="failure">Failure</option>
                <option value="partial">Partial</option>
              </select>
            </div>
          </div>
          <textarea className="input mt-2 min-h-16" placeholder="Master notes (current event)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          {targetNode?.event_type === 'rest' && (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={applyRest} onChange={(e) => setApplyRest(e.target.checked)} />
              Apply rest (refill skills, clear rest debuffs)
            </label>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-dungeon-400">Attach rewards/punishments to this advance</summary>
            <div className="mt-2 space-y-2 rounded border border-dungeon-600 p-2 text-sm">
              <p className="text-xs text-stone-500">These will be logged in event history when you advance.</p>
              <AdvanceRewardBuilder
                party={state.party}
                items={items}
                effects={effects}
                rewardsBlocked={!!activeBattleId}
                onChange={setAdvanceRewards}
              />
            </div>
          </details>
          <button className="btn-primary mt-2" disabled={!!activeBattleId} onClick={() => setAdvanceConfirmOpen(true)}>
            {activeBattleId ? 'Finish battle before advancing' : 'Go to Next Event'}
          </button>
          {activeBattleId && (
            <p className="mt-1 text-xs text-amber-400">A battle is in progress — resolve it before advancing the campaign.</p>
          )}
        </section>

        {canModifyEvents && (
          <section className="card lg:col-span-2">
            <h2 className="mb-2 font-semibold text-dungeon-300">Add Event to Campaign</h2>
            <p className="mb-2 text-xs text-stone-500">
              Append a template from your library so it appears in the next-event dropdown.
              {' '}<Link to="/organizer/events" className="text-dungeon-400 hover:underline">Create a new event first</Link>
            </p>
            {addEventError && (
              <p className="mb-2 rounded border border-red-800 bg-red-950/50 p-2 text-sm text-red-400">{addEventError}</p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="label">Event template</label>
                <select
                  className="input"
                  value={addEventTemplateId}
                  onChange={(e) => setAddEventTemplateId(+e.target.value)}
                >
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>{ev.name} ({ev.event_type})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Insert at position</label>
                <select
                  className="input"
                  value={insertPosition}
                  onChange={(e) => setInsertPosition(+e.target.value)}
                >
                  {sortedNodes.length === 0 ? (
                    <option value={1}>Position 1 (first event)</option>
                  ) : (
                    <>
                      <option value={1}>
                        At beginning (before #1 {sortedNodes[0].event_name})
                      </option>
                      {sortedNodes.slice(1).map((n, i) => (
                        <option key={n.id} value={i + 2}>
                          Before #{i + 2} {n.event_name}
                        </option>
                      ))}
                      <option value={sortedNodes.length + 1}>
                        At end (after #{sortedNodes.length} {sortedNodes[sortedNodes.length - 1].event_name})
                      </option>
                    </>
                  )}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="label">Label (optional)</label>
                <input
                  className="input"
                  placeholder="e.g. Side quest"
                  value={addEventLabel}
                  onChange={(e) => setAddEventLabel(e.target.value)}
                />
              </div>
            </div>
            <button
              className="btn-secondary mt-2"
              onClick={appendEvent}
              disabled={!addEventTemplateId || events.length === 0}
            >
              Add to campaign
            </button>

            <div className="mt-4 border-t border-dungeon-700 pt-3">
              <h3 className="mb-2 text-sm font-medium text-dungeon-300">Campaign roadmap</h3>
              <ol className="space-y-1 text-sm">
                {sortedNodes.map((n, i) => {
                  const visited = nodeOutcomes.get(n.id);
                  return (
                  <li
                    key={n.id}
                    className={`rounded px-2 py-1 ${n.id === currentNodeId ? 'bg-dungeon-700 text-dungeon-200' : 'text-stone-400'}`}
                  >
                    {i + 1}. {n.event_name} ({n.event_type})
                    {n.label && <span className="ml-1 text-stone-500">— {n.label}</span>}
                    {visited && (
                      <span
                        className={`ml-2 rounded px-1.5 py-0.5 text-xs capitalize ${outcomeBadgeClass(visited.outcome)}`}
                        title={visited.master_notes || undefined}
                      >
                        {visited.outcome}
                      </span>
                    )}
                    {n.id === currentNodeId && <span className="ml-2 text-xs text-dungeon-400">current</span>}
                    {n.id === nextNodeId && n.id !== currentNodeId && (
                      <span className="ml-2 text-xs text-green-400">next</span>
                    )}
                  </li>
                  );
                })}
              </ol>
            </div>
          </section>
        )}

        <section className="card lg:col-span-3">
          <h2 className="mb-2 font-semibold text-dungeon-300">Event History</h2>
          <div className="max-h-48 space-y-1 overflow-y-auto text-sm">
            {history.map((h) => (
              <div key={h.id} className="border-b border-dungeon-700 py-1">
                <span className="text-dungeon-400">{h.event_name}</span> — {h.outcome}
                {h.master_notes && <span className="text-stone-500"> — {h.master_notes}</span>}
                {h.rewards_json && <span className="ml-2 text-xs text-green-400">[+rewards]</span>}
                {h.punishments_json && <span className="ml-2 text-xs text-red-400">[-punishments]</span>}
              </div>
            ))}
          </div>
        </section>
      </div>

      {advanceConfirmOpen && (
        <ConfirmDialog
          title="Go to Next Event"
          message={advanceConfirmMessage}
          confirmLabel="Advance"
          onConfirm={advance}
          onCancel={() => setAdvanceConfirmOpen(false)}
        />
      )}

      {editChar && (
        <PartyCharacterEditModal
          character={editChar}
          campaignId={campaignId}
          onClose={() => setEditChar(null)}
          onSaved={load}
          onCharacterUpdated={setEditChar}
        />
      )}

      {showBattleSetup && (
        <BattleSetupModal
          campaignId={campaignId}
          partySize={state.party.length}
          onClose={() => setShowBattleSetup(false)}
          onAborted={() => setActiveBattleId(null)}
          onCreated={(battleId) => {
            setShowBattleSetup(false);
            setActiveBattleId(battleId);
            navigate(`/battle/${battleId}`);
          }}
        />
      )}
    </Layout>
  );
}

interface EnemyOption { id: number; name: string }
interface Preset { id: string; name: string }
interface CustomEntry {
  template_id: number;
  name: string;
  count: number;
  power_scale: number;
}

function BattleSetupModal({
  campaignId,
  partySize,
  onClose,
  onCreated,
  onAborted,
}: {
  campaignId: number;
  partySize: number;
  onClose: () => void;
  onCreated: (battleId: number) => void;
  onAborted: () => void;
}) {
  const suggested = suggestedGridSize(partySize);
  const [step, setStep] = useState<'config' | 'placement'>('config');
  const [configTab, setConfigTab] = useState<'encounter' | 'grid'>('encounter');
  const [battleId, setBattleId] = useState(0);
  const [battleState, setBattleState] = useState<{
    grid: { width: number; height: number; terrain_cells?: TerrainCell[]; blocked_cells?: { x: number; y: number }[] };
    actors: GridActor[];
  } | null>(null);
  const [paintObstacles, setPaintObstacles] = useState(false);
  const [encounterSummary, setEncounterSummary] = useState('');
  const [enemies, setEnemies] = useState<EnemyOption[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [mode, setMode] = useState<'preset' | 'custom'>('preset');
  const [preset, setPreset] = useState('goblin_crowd');
  const [enemyId, setEnemyId] = useState(0);
  const [count, setCount] = useState(1);
  const [powerScale, setPowerScale] = useState(1);
  const [customEntries, setCustomEntries] = useState<CustomEntry[]>([]);
  const [groupBonus, setGroupBonus] = useState(0);
  const [enemyBonus, setEnemyBonus] = useState(0);
  const [gridWidth, setGridWidth] = useState(suggested);
  const [gridHeight, setGridHeight] = useState(suggested);
  const [error, setError] = useState('');

  useEffect(() => {
    const size = suggestedGridSize(partySize);
    setGridWidth(size);
    setGridHeight(size);
  }, [partySize]);

  useEffect(() => {
    api.get<EnemyOption[]>('/enemies').then((e) => { setEnemies(e); if (e[0]) setEnemyId(e[0].id); });
    api.get<Preset[]>('/enemies/presets').then(setPresets);
  }, []);

  const addCustomEntry = () => {
    const picked = enemies.find((e) => e.id === enemyId);
    if (!picked || count < 1) return;
    setCustomEntries((prev) => [
      ...prev,
      { template_id: enemyId, name: picked.name, count, power_scale: powerScale },
    ]);
  };

  const removeCustomEntry = (index: number) => {
    setCustomEntries((prev) => prev.filter((_, i) => i !== index));
  };

  const formatEncounterSummary = (entries: CustomEntry[]) =>
    entries.map((e) => `${e.count}× ${e.name}${e.power_scale !== 1 ? ` (scale ${e.power_scale})` : ''}`).join(', ');

  const create = async () => {
    setError('');
    if (mode === 'custom' && customEntries.length === 0) {
      setError('Add at least one enemy to the encounter.');
      return;
    }
    const gridFields = { grid_width: gridWidth, grid_height: gridHeight };
    const payload = mode === 'preset'
      ? { preset, group_initiative_bonus: groupBonus, enemy_initiative_bonus: enemyBonus, ...gridFields }
      : {
          enemies: customEntries.map(({ template_id, count: c, power_scale: ps }) => ({
            template_id,
            count: c,
            power_scale: ps,
          })),
          group_initiative_bonus: groupBonus,
          enemy_initiative_bonus: enemyBonus,
          ...gridFields,
        };
    try {
      const res = await api.post<{ id: number; state: { grid: { width: number; height: number; terrain_cells?: TerrainCell[]; blocked_cells?: { x: number; y: number }[] }; actors: GridActor[] } }>(
        `/battles/campaigns/${campaignId}`,
        payload,
      );
      setBattleId(res.id);
      setBattleState({
        grid: {
          width: res.state.grid.width,
          height: res.state.grid.height,
          terrain_cells: normalizeTerrainCells(res.state.grid),
        },
        actors: res.state.actors.map((a) => ({ ...a, position: a.position })),
      });
      setEncounterSummary(
        mode === 'preset'
          ? (presets.find((p) => p.id === preset)?.name || preset)
          : formatEncounterSummary(customEntries),
      );
      setStep('placement');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create battle');
    }
  };

  const abortSetup = async () => {
    if (step === 'placement' && battleId) {
      try {
        await api.delete(`/battles/${battleId}`);
        onAborted();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not cancel battle');
        return;
      }
    }
    onClose();
  };

  const terrainCells = battleState?.grid.terrain_cells || [];

  const cycleTerrain = (x: number, y: number) => {
    if (!battleState) return;
    const occupied = battleState.actors.some((a) => a.position.x === x && a.position.y === y);
    if (occupied) return;
    const existing = terrainCells.find((c) => c.x === x && c.y === y);
    const nextType = cycleTerrainType(existing?.type);
    const next =
      nextType === 'empty'
        ? terrainCells.filter((c) => !(c.x === x && c.y === y))
        : existing
          ? terrainCells.map((c) => (c.x === x && c.y === y ? { x, y, type: nextType } : c))
          : [...terrainCells, { x, y, type: nextType }];
    setBattleState({
      ...battleState,
      grid: { ...battleState.grid, terrain_cells: next },
    });
  };

  const savePositions = async () => {
    if (!battleState || !battleId) return;
    const positions: Record<string, { x: number; y: number }> = {};
    for (const a of battleState.actors) {
      positions[a.id] = { x: a.position.x, y: a.position.y };
    }
    await api.patch(`/battles/${battleId}/positions`, {
      positions,
      terrain_cells: terrainCells,
    });
  };

  const onDragActor = (actorId: string, x: number, y: number) => {
    if (!battleState) return;
    const cell = terrainCells.find((c) => c.x === x && c.y === y);
    if (cell && isImpassableTerrain(cell.type)) return;
    const occupied = battleState.actors.some((a) => a.id !== actorId && a.position.x === x && a.position.y === y);
    if (occupied) return;
    setBattleState({
      ...battleState,
      actors: battleState.actors.map((a) => (a.id === actorId ? { ...a, position: { x, y } } : a)),
    });
  };

  const finish = async () => {
    try {
      await savePositions();
      onCreated(battleId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save positions');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="card max-h-[90vh] w-full max-w-lg overflow-y-auto space-y-3">
        <h3 className="font-semibold text-dungeon-300">Setup Battle</h3>
        {error && <p className="text-sm text-red-400">{error}</p>}

        {step === 'config' && (
          <>
            <div className="flex gap-2">
              <button type="button" className={`text-sm px-2 py-1 rounded ${configTab === 'encounter' ? 'bg-dungeon-600' : 'bg-dungeon-800'}`} onClick={() => setConfigTab('encounter')}>Encounter</button>
              <button type="button" className={`text-sm px-2 py-1 rounded ${configTab === 'grid' ? 'bg-dungeon-600' : 'bg-dungeon-800'}`} onClick={() => setConfigTab('grid')}>Grid</button>
            </div>
            {configTab === 'encounter' && (
              <>
                <div className="flex gap-2">
                  <button type="button" className={`text-sm px-2 py-1 rounded ${mode === 'preset' ? 'bg-dungeon-600' : 'bg-dungeon-800'}`} onClick={() => setMode('preset')}>Preset</button>
                  <button type="button" className={`text-sm px-2 py-1 rounded ${mode === 'custom' ? 'bg-dungeon-600' : 'bg-dungeon-800'}`} onClick={() => setMode('custom')}>Custom</button>
                </div>
                {mode === 'preset' ? (
                  <select className="input" value={preset} onChange={(e) => setPreset(e.target.value)}>
                    {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                ) : (
                  <>
                    <select className="input" value={enemyId} onChange={(e) => setEnemyId(+e.target.value)}>
                      {enemies.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="label">Count</label>
                        <input className="input" type="number" min={1} max={10} value={count} onChange={(e) => setCount(+e.target.value)} />
                      </div>
                      <div>
                        <label className="label">Power scale</label>
                        <input className="input" type="number" min={0.5} max={3} step={0.1} value={powerScale} onChange={(e) => setPowerScale(+e.target.value)} />
                      </div>
                    </div>
                    <button type="button" className="btn-secondary text-sm" onClick={addCustomEntry}>Add to encounter</button>
                    {customEntries.length > 0 && (
                      <ul className="space-y-1 rounded border border-dungeon-700 p-2 text-sm">
                        {customEntries.map((entry, i) => (
                          <li key={i} className="flex items-center justify-between gap-2">
                            <span>{entry.count}× {entry.name}{entry.power_scale !== 1 ? ` (scale ${entry.power_scale})` : ''}</span>
                            <button type="button" className="text-xs text-red-400 hover:underline" onClick={() => removeCustomEntry(i)}>Remove</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label">Group init. bonus</label>
                    <input className="input" type="number" step={0.1} value={groupBonus} onChange={(e) => setGroupBonus(+e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Enemy init. bonus</label>
                    <input className="input" type="number" step={0.1} value={enemyBonus} onChange={(e) => setEnemyBonus(+e.target.value)} />
                  </div>
                </div>
              </>
            )}
            {configTab === 'grid' && (
              <>
                <p className="text-sm text-stone-400">
                  Suggested for {partySize} player{partySize === 1 ? '' : 's'}: {suggested}×{suggested}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label">Width</label>
                    <input
                      className="input"
                      type="number"
                      min={MIN_BATTLE_GRID}
                      max={MAX_BATTLE_GRID}
                      value={gridWidth}
                      onChange={(e) => setGridWidth(+e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">Height</label>
                    <input
                      className="input"
                      type="number"
                      min={MIN_BATTLE_GRID}
                      max={MAX_BATTLE_GRID}
                      value={gridHeight}
                      onChange={(e) => setGridHeight(+e.target.value)}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  onClick={() => {
                    setGridWidth(suggested);
                    setGridHeight(suggested);
                  }}
                >
                  Reset to suggested
                </button>
              </>
            )}
            <div className="flex gap-2">
              <button type="button" className="btn-primary" onClick={create}>Next: Placement</button>
              <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {step === 'placement' && battleState && (
          <>
            {encounterSummary && (
              <p className="text-sm text-dungeon-300">Encounter: {encounterSummary}</p>
            )}
            <p className="text-sm text-stone-500">Grid: {battleState.grid.width}×{battleState.grid.height}</p>
            <p className="text-sm text-stone-400">
              Drag tokens to position the party and enemies. Toggle paint mode to place terrain, then continue.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={`text-sm px-2 py-1 rounded ${paintObstacles ? 'bg-stone-600 ring-1 ring-stone-400' : 'bg-dungeon-800'}`}
                onClick={() => setPaintObstacles((v) => !v)}
              >
                {paintObstacles ? 'Painting terrain (click cells)' : 'Paint terrain'}
              </button>
              {paintObstacles && (
                <span className="text-xs text-stone-500">Click cycles: Wall → Water → Forest → clear</span>
              )}
            </div>
            <BattleGrid
              width={battleState.grid.width}
              height={battleState.grid.height}
              actors={battleState.actors}
              terrainCells={terrainCells}
              draggable={!paintObstacles}
              onDragActor={onDragActor}
              onCellClick={paintObstacles ? cycleTerrain : undefined}
            />
            <div className="flex gap-2">
              <button type="button" className="btn-primary" onClick={finish}>Continue to Battle</button>
              <button type="button" className="btn-secondary" onClick={abortSetup}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AdvanceRewardBuilder({
  party,
  items,
  effects,
  onChange,
  rewardsBlocked = false,
}: {
  party: { id: number; name: string; current_hp?: number; max_hp?: number }[];
  items: Item[];
  effects: EffectTemplate[];
  onChange: (payload: RewardsPayload) => void;
  rewardsBlocked?: boolean;
}) {
  const [rewardType, setRewardType] = useState<'item' | 'random' | 'hp' | 'xp' | 'currency' | 'effect'>('item');
  const [charId, setCharId] = useState(party[0]?.id || 0);
  const [itemId, setItemId] = useState(items[0]?.id || 0);
  const [randomWholeParty, setRandomWholeParty] = useState(true);
  const [randomCharId, setRandomCharId] = useState(party[0]?.id || 0);
  const [tier, setTier] = useState(1);
  const [randomCount, setRandomCount] = useState(1);
  const [randomItemType, setRandomItemType] = useState<ItemTypeFilter>('all');
  const [hpWholeParty, setHpWholeParty] = useState(false);
  const [hpChange, setHpChange] = useState(-5);
  const [xpWholeParty, setXpWholeParty] = useState(true);
  const [xpCharId, setXpCharId] = useState(party[0]?.id || 0);
  const [xpAmount, setXpAmount] = useState(100);
  const [currencyWholeParty, setCurrencyWholeParty] = useState(true);
  const [currencyCharId, setCurrencyCharId] = useState(party[0]?.id || 0);
  const [currencyAmount, setCurrencyAmount] = useState(100);
  const [currencyReduce, setCurrencyReduce] = useState(false);
  const [effectWholeParty, setEffectWholeParty] = useState(false);
  const [effectCharId, setEffectCharId] = useState(party[0]?.id || 0);
  const [effectTemplateId, setEffectTemplateId] = useState(effects[0]?.id || 0);

  useEffect(() => {
    if (party[0]) {
      setCharId(party[0].id);
      setRandomCharId(party[0].id);
      setXpCharId(party[0].id);
      setCurrencyCharId(party[0].id);
      setEffectCharId(party[0].id);
    }
    if (items[0]) setItemId(items[0].id);
    if (effects[0]) setEffectTemplateId(effects[0].id);
  }, [party, items, effects]);

  const selectedMember = party.find((p) => p.id === charId);
  const selectedRandomMember = party.find((p) => p.id === randomCharId);

  useEffect(() => {
    if (rewardsBlocked) {
      onChange({});
      return;
    }
    if (rewardType === 'item' && charId && itemId) {
      onChange({ rewards: { items: [{ character_id: charId, item_template_id: itemId }] } });
      return;
    }
    if (rewardType === 'random') {
      const targets = randomWholeParty ? party.map((p) => p.id) : [randomCharId].filter(Boolean);
      if (targets.length) {
        const entry: Record<string, unknown> = { tier, count: randomCount, character_ids: targets };
        if (randomItemType !== 'all') entry.item_type = randomItemType;
        onChange({ rewards: { random_tier: [entry] } });
      } else {
        onChange({});
      }
      return;
    }
    if (rewardType === 'hp' && hpChange !== 0) {
      const targets = hpWholeParty ? party.map((p) => p.id) : [charId].filter(Boolean);
      if (targets.length) {
        onChange({
          punishments: {
            hp_reduction: targets.map((character_id) => ({ character_id, amount: hpChange })),
          },
        });
      } else {
        onChange({});
      }
      return;
    }
    if (rewardType === 'xp' && xpAmount > 0) {
      const targets = xpWholeParty ? party.map((p) => p.id) : [xpCharId].filter(Boolean);
      if (targets.length) {
        onChange({
          rewards: {
            xp: targets.map((character_id) => ({ character_id, amount: xpAmount })),
          },
        });
      } else {
        onChange({});
      }
      return;
    }
    if (rewardType === 'currency' && currencyAmount > 0) {
      const targets = currencyWholeParty ? party.map((p) => p.id) : [currencyCharId].filter(Boolean);
      if (targets.length) {
        if (currencyReduce) {
          onChange({
            punishments: {
              wallet_reduction: targets.map((character_id) => ({ character_id, amount: currencyAmount })),
            },
          });
        } else {
          onChange({
            rewards: {
              wallet: targets.map((character_id) => ({ character_id, amount: currencyAmount })),
            },
          });
        }
      } else {
        onChange({});
      }
      return;
    }
    if (rewardType === 'effect' && effectTemplateId) {
      const targets = effectWholeParty ? party.map((p) => p.id) : [effectCharId].filter(Boolean);
      if (targets.length) {
        onChange({
          rewards: {
            temp_effects: targets.map((character_id) => ({
              character_id,
              effect_template_id: effectTemplateId,
            })),
          },
        });
      } else {
        onChange({});
      }
      return;
    }
    onChange({});
  }, [
    rewardType,
    charId,
    itemId,
    tier,
    randomCount,
    randomWholeParty,
    randomCharId,
    randomItemType,
    hpWholeParty,
    hpChange,
    xpWholeParty,
    xpCharId,
    xpAmount,
    currencyWholeParty,
    currencyCharId,
    currencyAmount,
    currencyReduce,
    effectWholeParty,
    effectCharId,
    effectTemplateId,
    party,
    onChange,
    rewardsBlocked,
  ]);

  return (
    <div className="space-y-2">
      {rewardsBlocked && (
        <p className="text-sm text-amber-300">{REWARDS_BLOCKED_DURING_BATTLE}</p>
      )}
      <fieldset disabled={rewardsBlocked} className={`space-y-2 ${rewardsBlocked ? 'opacity-60' : ''}`}>
      <select className="input" value={rewardType} onChange={(e) => setRewardType(e.target.value as typeof rewardType)}>
        <option value="item">Grant item</option>
        <option value="random">Random tier loot</option>
        <option value="hp">HP change</option>
        <option value="xp">Grant XP</option>
        <option value="currency">Grant / reduce currency</option>
        <option value="effect">Apply effect</option>
      </select>

      {rewardType === 'item' && (
        <>
          <select className="input" value={charId} onChange={(e) => setCharId(+e.target.value)}>
            {party.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="input" value={itemId} onChange={(e) => setItemId(+e.target.value)}>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </>
      )}

      {rewardType === 'random' && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={randomWholeParty} onChange={(e) => setRandomWholeParty(e.target.checked)} />
            Whole party
          </label>
          {!randomWholeParty && (
            <select className="input" value={randomCharId} onChange={(e) => setRandomCharId(+e.target.value)}>
              {party.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {randomWholeParty && (
            <p className="text-xs text-stone-500">Each party member receives random loot.</p>
          )}
          {!randomWholeParty && selectedRandomMember && (
            <p className="text-xs text-stone-500">Only {selectedRandomMember.name} receives random loot.</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Tier</label>
              <input className="input" type="number" min={1} max={5} value={tier} onChange={(e) => setTier(+e.target.value)} />
            </div>
            <div>
              <label className="label">Count</label>
              <input className="input" type="number" min={1} max={5} value={randomCount} onChange={(e) => setRandomCount(+e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Item type</label>
            <select className="input" value={randomItemType} onChange={(e) => setRandomItemType(e.target.value as ItemTypeFilter)}>
              {ITEM_TYPE_FILTER_OPTIONS.map(({ id, label }) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </div>
        </>
      )}

      {rewardType === 'hp' && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={hpWholeParty} onChange={(e) => setHpWholeParty(e.target.checked)} />
            Whole party
          </label>
          {!hpWholeParty && (
            <>
              <select className="input" value={charId} onChange={(e) => setCharId(+e.target.value)}>
                {party.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.current_hp != null && p.max_hp != null ? ` (HP ${p.current_hp}/${p.max_hp})` : ''}
                  </option>
                ))}
              </select>
              {selectedMember?.current_hp != null && selectedMember.max_hp != null && (
                <p className="text-sm text-dungeon-300">
                  {selectedMember.name}: HP {selectedMember.current_hp} / {selectedMember.max_hp}
                </p>
              )}
            </>
          )}
          {hpWholeParty && (
            <div className="space-y-1 text-sm text-dungeon-300">
              {party.map((p) => (
                <p key={p.id}>
                  {p.name}
                  {p.current_hp != null && p.max_hp != null ? `: HP ${p.current_hp}/${p.max_hp}` : ''}
                </p>
              ))}
            </div>
          )}
          <div>
            <label className="label">HP change</label>
            <input
              className="input"
              type="number"
              value={hpChange}
              onChange={(e) => setHpChange(+e.target.value)}
              placeholder="e.g. -5 damage, +5 heal"
            />
            <p className="mt-1 text-xs text-stone-500">
              Negative reduces current HP; positive heals (capped at max). Does not change max HP.
            </p>
          </div>
        </>
      )}

      {rewardType === 'xp' && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={xpWholeParty} onChange={(e) => setXpWholeParty(e.target.checked)} />
            Whole party (same amount each)
          </label>
          {!xpWholeParty && (
            <select className="input" value={xpCharId} onChange={(e) => setXpCharId(+e.target.value)}>
              {party.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <div>
            <label className="label">XP amount</label>
            <input className="input" type="number" min={1} value={xpAmount} onChange={(e) => setXpAmount(+e.target.value)} />
          </div>
        </>
      )}

      {rewardType === 'currency' && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={currencyWholeParty} onChange={(e) => setCurrencyWholeParty(e.target.checked)} />
            Whole party (same amount each)
          </label>
          {!currencyWholeParty && (
            <select className="input" value={currencyCharId} onChange={(e) => setCurrencyCharId(+e.target.value)}>
              {party.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <div>
            <label className="label">Amount (copper)</label>
            <input className="input" type="number" min={1} value={currencyAmount} onChange={(e) => setCurrencyAmount(+e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={currencyReduce} onChange={(e) => setCurrencyReduce(e.target.checked)} />
            Reduce instead of grant
          </label>
        </>
      )}

      {rewardType === 'effect' && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={effectWholeParty} onChange={(e) => setEffectWholeParty(e.target.checked)} />
            Whole party
          </label>
          {!effectWholeParty && (
            <select className="input" value={effectCharId} onChange={(e) => setEffectCharId(+e.target.value)}>
              {party.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <select className="input" value={effectTemplateId} onChange={(e) => setEffectTemplateId(+e.target.value)}>
            {effects.filter((e) => e.is_buff).length > 0 && (
              <optgroup label="Buffs">
                {effects.filter((e) => e.is_buff).map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </optgroup>
            )}
            {effects.filter((e) => !e.is_buff).length > 0 && (
              <optgroup label="Debuffs">
                {effects.filter((e) => !e.is_buff).map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </optgroup>
            )}
          </select>
        </>
      )}
      </fieldset>
    </div>
  );
}
