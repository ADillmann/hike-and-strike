import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { Layout } from '../../components/Layout';
import { ShopModal } from '../../components/shop/ShopModal';
import { useCampaignSocket } from '../../hooks/useCampaignSocket';
import { useLocale } from '../../context/LocaleContext';
import type { Character } from '../../api/client';
import { formatBattleMods, formatStatMods } from '../../utils/effects';

interface CampaignView {
  active: boolean;
  name?: string;
  status?: string;
  current_node?: {
    event: {
      name: string;
      description: string;
      event_type: string;
      images: string[];
      shop_config?: { allowed_tiers: number[]; buy_modifier_percent: number };
    };
  };
  party?: { name: string; current_hp: number; max_hp: number }[];
}

export default function CampaignPage() {
  const navigate = useNavigate();
  const { t } = useLocale();
  const [data, setData] = useState<CampaignView>({ active: false });
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [myCharacter, setMyCharacter] = useState<Character | null>(null);
  const [shopOpen, setShopOpen] = useState(false);
  const [activeBattleId, setActiveBattleId] = useState<number | null>(null);

  const goToBattle = useCallback((battleId: number) => {
    navigate(`/battle/${battleId}`);
  }, [navigate]);

  const checkActiveBattle = useCallback(() => {
    if (!campaignId) return;
    api.get<{ active: boolean; battle_id?: number }>(`/battles/campaigns/${campaignId}/active`)
      .then((b) => setActiveBattleId(b.active && b.battle_id ? b.battle_id : null))
      .catch(() => setActiveBattleId(null));
  }, [campaignId]);

  const load = useCallback(() => {
    api.get<CampaignView & { campaign_id?: number }>('/player/campaign/active').then((d) => {
      setData(d);
      if (d.active && d.campaign_id) setCampaignId(d.campaign_id);
    });
    api.get<Character>('/characters/me').then(setMyCharacter).catch(() => setMyCharacter(null));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    checkActiveBattle();
  }, [checkActiveBattle]);

  useEffect(() => {
    if (data.current_node?.event.event_type === 'battle_hook' && activeBattleId) {
      goToBattle(activeBattleId);
    }
  }, [data.current_node?.event.event_type, activeBattleId, goToBattle]);

  useCampaignSocket(campaignId, (msg) => {
    if (msg.type === 'campaign_state' || msg.type === 'event_advanced') load();
    if (msg.type === 'character_updated') load();
    if (msg.type === 'battle_started' && msg.data && typeof msg.data === 'object' && 'battle_id' in (msg.data as object)) {
      const battleId = (msg.data as { battle_id: number }).battle_id;
      setActiveBattleId(battleId);
      goToBattle(battleId);
    }
    if (msg.type === 'battle_cancelled') {
      setActiveBattleId(null);
      checkActiveBattle();
    }
    if (msg.type === 'battle_updated' && msg.data && typeof msg.data === 'object' && 'battle_id' in (msg.data as object)) {
      const d = msg.data as { battle_id: number; state?: { status?: string } };
      const battleStatus = d.state?.status;
      if (battleStatus === 'active' || battleStatus === 'pending') {
        setActiveBattleId(d.battle_id);
        goToBattle(d.battle_id);
      } else if (battleStatus === 'completed') {
        setActiveBattleId(null);
        checkActiveBattle();
        load();
      }
    }
  });

  if (!data.active) {
    return (
      <Layout title={t('campaign.title')}>
        <div className="card text-center">
          <p className="text-stone-400">{t('campaign.no_campaign')}</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={t('campaign.title_named', { name: data.name || '' })}>
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
            <div className="mt-4 rounded border border-dungeon-500 p-3 text-dungeon-300">
              {activeBattleId ? (
                <>
                  <p className="mb-2">{t('campaign.battle_ready')}</p>
                  <button type="button" className="btn-primary text-sm" onClick={() => goToBattle(activeBattleId)}>
                    {t('campaign.join_battle')}
                  </button>
                </>
              ) : (
                <p>{t('campaign.battle_coming')}</p>
              )}
            </div>
          )}
          {data.current_node?.event.event_type === 'shop' && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="btn-primary" onClick={() => setShopOpen(true)}>{t('campaign.buy')}</button>
              <button type="button" className="btn-secondary" onClick={() => setShopOpen(true)}>{t('campaign.sell')}</button>
              {myCharacter?.wallet_display && (
                <span className="self-center text-sm text-stone-400">
                  {t('campaign.wallet', { amount: myCharacter.wallet_display })}
                </span>
              )}
            </div>
          )}
        </section>
        <section className="card">
          <h3 className="mb-2 font-semibold text-dungeon-300">{t('campaign.party')}</h3>
          {data.party?.map((p, i) => (
            <div key={i} className="mb-2 text-sm">
              {p.name} — HP {p.current_hp}/{p.max_hp}
            </div>
          ))}
          {myCharacter && myCharacter.temporary_effects.length > 0 && (
            <div className="mt-3 border-t border-dungeon-700 pt-2">
              <h4 className="text-xs text-stone-500">{t('campaign.your_effects')}</h4>
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
          <p className="mt-4 text-xs text-stone-500">{t('campaign.discuss_help')}</p>
        </section>
      </div>

      {shopOpen && (
        <ShopModal
          onClose={() => setShopOpen(false)}
          onUpdated={(character) => setMyCharacter(character)}
        />
      )}
    </Layout>
  );
}
