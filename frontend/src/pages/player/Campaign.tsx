import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Layout } from '../../components/Layout';
import { useCampaignSocket } from '../../hooks/useCampaignSocket';
import type { Character } from '../../api/client';
import { formatBattleMods, formatStatMods } from '../../utils/effects';

interface CampaignView {
  active: boolean;
  name?: string;
  status?: string;
  current_node?: {
    event: { name: string; description: string; event_type: string; images: string[] };
  };
  party?: { name: string; current_hp: number; max_hp: number }[];
}

export default function CampaignPage() {
  const [data, setData] = useState<CampaignView>({ active: false });
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [myCharacter, setMyCharacter] = useState<Character | null>(null);

  const load = useCallback(() => {
    api.get<CampaignView & { campaign_id?: number }>('/player/campaign/active').then((d) => {
      setData(d);
      if (d.active && d.campaign_id) setCampaignId(d.campaign_id);
    });
    api.get<Character>('/characters/me').then(setMyCharacter).catch(() => setMyCharacter(null));
  }, []);

  useEffect(() => { load(); }, [load]);

  useCampaignSocket(campaignId, (msg) => {
    if (msg.type === 'campaign_state' || msg.type === 'event_advanced') load();
    if (msg.type === 'character_updated') load();
    if (msg.type === 'battle_started' && msg.data && typeof msg.data === 'object' && 'battle_id' in (msg.data as object)) {
      const battleId = (msg.data as { battle_id: number }).battle_id;
      window.location.href = `/battle/${battleId}`;
    }
  });

  if (!data.active) {
    return (
      <Layout title="Campaign">
        <div className="card text-center">
          <p className="text-stone-400">No active campaign. Wait for your Master to start one.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={`Campaign: ${data.name}`}>
      <div className="grid gap-4 md:grid-cols-3">
        <section className="card md:col-span-2">
          <h2 className="mb-2 text-xl font-semibold text-dungeon-300">{data.current_node?.event.name}</h2>
          <p className="whitespace-pre-wrap text-stone-300">{data.current_node?.event.description}</p>
          {data.current_node?.event.images && data.current_node.event.images.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {data.current_node.event.images.map((img, i) => (
                <img key={i} src={img} alt="" className="max-h-48 rounded border border-dungeon-600 object-cover" />
              ))}
            </div>
          )}
          {data.current_node?.event.event_type === 'battle_hook' && (
            <p className="mt-4 rounded border border-dungeon-500 p-3 text-dungeon-300">
              A battle is coming — wait for the Master to start combat.
            </p>
          )}
        </section>
        <section className="card">
          <h3 className="mb-2 font-semibold text-dungeon-300">Party</h3>
          {data.party?.map((p, i) => (
            <div key={i} className="mb-2 text-sm">
              {p.name} — HP {p.current_hp}/{p.max_hp}
            </div>
          ))}
          {myCharacter && myCharacter.temporary_effects.length > 0 && (
            <div className="mt-3 border-t border-dungeon-700 pt-2">
              <h4 className="text-xs text-stone-500">Your effects</h4>
              <div className="mt-1 space-y-1">
                {myCharacter.temporary_effects.map((e) => {
                  const statLine = formatStatMods(e.stat_modifiers);
                  const battleLine = formatBattleMods(e.active_in_battle, e.battle_modifiers);
                  return (
                    <div key={e.id} className="rounded bg-red-900/50 px-2 py-0.5 text-xs">
                      <span className="font-medium">{e.label}</span>
                      {statLine && <span className="ml-1 text-stone-400">{statLine}</span>}
                      {battleLine && <span className="ml-1 text-dungeon-300">{battleLine}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <p className="mt-4 text-xs text-stone-500">Discuss with your group. The Master will advance the story.</p>
        </section>
      </div>
    </Layout>
  );
}
