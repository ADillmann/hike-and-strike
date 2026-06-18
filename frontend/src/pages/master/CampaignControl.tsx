import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, Character } from '../../api/client';
import { Layout, StatEditor } from '../../components/Layout';
import { useCampaignSocket } from '../../hooks/useCampaignSocket';

interface CampaignState {
  campaign_id: number;
  name: string;
  status: string;
  current_node: {
    node_id: number;
    event: { name: string; description: string; event_type: string; images: string[] };
  } | null;
  party: { id: number; name: string; username: string; stats: Record<string, number>; max_hp: number; current_hp: number }[];
}

interface Node { id: number; sort_order: number; event_name: string; event_type: string }
interface Item { id: number; name: string; tier: number }
interface HistoryEntry { id: number; event_name: string; outcome: string; master_notes: string; timestamp: string }

export default function CampaignControlPage() {
  const { id } = useParams();
  const campaignId = Number(id);
  const [state, setState] = useState<CampaignState | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [nextNodeId, setNextNodeId] = useState(0);
  const [outcome, setOutcome] = useState('success');
  const [notes, setNotes] = useState('');
  const [applyRest, setApplyRest] = useState(false);
  const [rewardItemId, setRewardItemId] = useState(0);
  const [rewardCharId, setRewardCharId] = useState(0);
  const [editChar, setEditChar] = useState<Character | null>(null);
  const [editStats, setEditStats] = useState<Record<string, number>>({});

  const load = useCallback(() => {
    if (!campaignId) return;
    api.get<CampaignState>(`/campaigns/${campaignId}/state`).then(setState);
    api.get<{ id: number; nodes: Node[] }[]>('/campaigns').then((campaigns) => {
      const c = campaigns.find((x) => x.id === campaignId);
      if (c) {
        setNodes(c.nodes);
        if (!nextNodeId && c.nodes[0]) setNextNodeId(c.nodes[0].id);
      }
    });
    api.get<HistoryEntry[]>(`/campaigns/${campaignId}/history`).then(setHistory);
    api.get<Item[]>('/items').then((its) => { setItems(its); if (its[0]) setRewardItemId(its[0].id); });
  }, [campaignId, nextNodeId]);

  useEffect(() => { load(); }, [load]);

  useCampaignSocket(campaignId, (msg) => {
    if (msg.type === 'campaign_state') setState(msg.data as CampaignState);
    if (msg.type === 'history_added' || msg.type === 'character_updated') load();
  });

  useEffect(() => {
    if (state?.party[0]) setRewardCharId(state.party[0].id);
  }, [state]);

  const advance = async () => {
    await api.post(`/campaigns/${campaignId}/advance`, {
      node_id: nextNodeId || state?.current_node?.node_id,
      outcome,
      master_notes: notes,
      apply_rest: applyRest,
    });
    setNotes('');
    load();
  };

  const grantItem = async () => {
    await api.post(`/campaigns/${campaignId}/rewards`, {
      rewards: { items: [{ character_id: rewardCharId, item_template_id: rewardItemId }] },
    });
    load();
  };

  const punishHalfHp = async (charId: number) => {
    await api.post(`/campaigns/${campaignId}/rewards`, {
      punishments: { hp_reduction: [{ character_id: charId, half: true }] },
    });
    load();
  };

  const openStatEdit = async (charId: number) => {
    const c = await api.get<Character>(`/characters/${charId}`);
    setEditChar(c);
    setEditStats({ ...c.stats, current_hp: c.current_hp, max_hp: c.max_hp });
  };

  const saveStatEdit = async () => {
    if (!editChar) return;
    const changes: Record<string, number> = {};
    for (const [k, v] of Object.entries(editStats)) {
      const old = k === 'current_hp' || k === 'max_hp' ? (editChar as unknown as Record<string, number>)[k] : editChar.stats[k];
      if (v !== old) changes[k] = v;
    }
    await api.patch(`/characters/${editChar.id}/stats`, { changes, campaign_id: campaignId });
    setEditChar(null);
    load();
  };

  if (!state) return <Layout title="Campaign Control">Loading...</Layout>;

  return (
    <Layout title={`Campaign: ${state.name}`}>
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <h2 className="mb-2 text-lg font-semibold text-dungeon-300">
            Current: {state.current_node?.event.name || '—'}
          </h2>
          <p className="mb-2 text-xs text-stone-500">{state.current_node?.event.event_type}</p>
          <p className="whitespace-pre-wrap text-stone-300">{state.current_node?.event.description}</p>
          {state.current_node?.event.event_type === 'battle_hook' && (
            <p className="mt-3 rounded border border-dungeon-500 p-2 text-dungeon-300">Battle system — Phase 2</p>
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
              <div className="mt-1 flex flex-wrap gap-1">
                <button className="btn-secondary px-2 py-0.5 text-xs" onClick={() => openStatEdit(p.id)}>Edit Stats</button>
                <button className="btn-danger px-2 py-0.5 text-xs" onClick={() => punishHalfHp(p.id)}>Half HP</button>
              </div>
            </div>
          ))}
        </section>

        <section className="card lg:col-span-2">
          <h2 className="mb-2 font-semibold text-dungeon-300">Advance Event</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <select className="input" value={nextNodeId || state.current_node?.node_id || 0} onChange={(e) => setNextNodeId(+e.target.value)}>
              {nodes.map((n) => <option key={n.id} value={n.id}>{n.event_name} ({n.event_type})</option>)}
            </select>
            <select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
              <option value="partial">Partial</option>
            </select>
          </div>
          <textarea className="input mt-2 min-h-16" placeholder="Master notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={applyRest} onChange={(e) => setApplyRest(e.target.checked)} />
            Apply rest (refill skills, clear rest debuffs)
          </label>
          <button className="btn-primary mt-2" onClick={advance}>Go to Next Event</button>
        </section>

        <section className="card">
          <h2 className="mb-2 font-semibold text-dungeon-300">Quick Reward</h2>
          <select className="input mb-2" value={rewardCharId} onChange={(e) => setRewardCharId(+e.target.value)}>
            {state.party.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="input mb-2" value={rewardItemId} onChange={(e) => setRewardItemId(+e.target.value)}>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name} (T{i.tier})</option>)}
          </select>
          <button className="btn-secondary w-full" onClick={grantItem}>Grant Item</button>
        </section>

        <section className="card lg:col-span-3">
          <h2 className="mb-2 font-semibold text-dungeon-300">Event History</h2>
          <div className="max-h-48 space-y-1 overflow-y-auto text-sm">
            {history.map((h) => (
              <div key={h.id} className="border-b border-dungeon-700 py-1">
                <span className="text-dungeon-400">{h.event_name}</span> — {h.outcome}
                {h.master_notes && <span className="text-stone-500"> — {h.master_notes}</span>}
              </div>
            ))}
          </div>
        </section>
      </div>

      {editChar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card max-w-md w-full">
            <h3 className="mb-3 font-semibold">Edit {editChar.name}</h3>
            <StatEditor stats={editStats} onChange={(s, v) => setEditStats({ ...editStats, [s]: Math.max(1, v) })} />
            <div className="mt-3 flex gap-2">
              <button className="btn-primary" onClick={saveStatEdit}>Save</button>
              <button className="btn-secondary" onClick={() => setEditChar(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
