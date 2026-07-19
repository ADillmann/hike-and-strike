import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { Layout } from '../../components/Layout';
import type { Character } from '../../api/client';

interface PartyMember {
  character_id: number;
  name: string;
  is_self?: boolean;
}

type SkillItem = Character['skills'][number] & {
  effect_params?: Record<string, string | number>;
};

function normalizeEffect(type?: string): string {
  if (type === 'power_strike') return 'melee';
  if (type === 'arcane_bolt') return 'range';
  return type || 'none';
}

function canUseOutsideBattle(skill: SkillItem): boolean {
  const effect = normalizeEffect(skill.effect_type);
  if (effect === 'heal') return true;
  if (effect === 'support' && skill.effect_params?.support_mode === 'stat_boost') return true;
  return false;
}

function useSkillHint(skill: SkillItem): string {
  const effect = normalizeEffect(skill.effect_type);
  if (effect === 'heal') return 'Restore HP on yourself or a party member.';
  if (effect === 'support') return 'Boost an ally\'s stats until the next event or battle.';
  return 'Usable in battle only.';
}

export default function SkillsPage() {
  const [character, setCharacter] = useState<Character | null>(null);
  const [party, setParty] = useState<PartyMember[]>([]);
  const [pendingSkill, setPendingSkill] = useState<SkillItem | null>(null);
  const [targetId, setTargetId] = useState(0);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const load = () => {
    api.get<Character>('/characters/me').then(setCharacter).catch(() => navigate('/character/create'));
    api.get<PartyMember[]>('/characters/me/party').then((members) => {
      setParty(members);
      if (members[0]) setTargetId(members[0].character_id);
    });
  };

  useEffect(() => { load(); }, [navigate]);

  const confirmUse = async () => {
    if (!pendingSkill || !targetId) return;
    setError('');
    try {
      await api.post('/characters/me/use-skill', {
        skill_id: pendingSkill.id,
        target_character_id: targetId,
      });
      setPendingSkill(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not use skill');
      setPendingSkill(null);
    }
  };

  if (!character) return <Layout title="Skills">Loading...</Layout>;

  const slotLine = character.skill_slots
    ? `Melee ${character.skill_slots.melee?.used ?? 0}/${character.skill_slots.melee?.max ?? 0} · Range ${character.skill_slots.range?.used ?? 0}/${character.skill_slots.range?.max ?? 0} · Support ${character.skill_slots.support?.used ?? 0}/${character.skill_slots.support?.max ?? 0}`
    : null;

  return (
    <Layout title="Skills">
      {error && <p className="mb-3 text-red-400">{error}</p>}
      {slotLine && (
        <p className="mb-3 text-sm text-dungeon-300">
          Skill slots: {slotLine}
          <span className="ml-2 text-xs text-stone-500">(heal uses range or support)</span>
        </p>
      )}
      <div className="card space-y-3">
        {character.skills.length === 0 && (
          <p className="text-stone-500">No skills yet.</p>
        )}
        {character.skills.map((s) => {
          const skill = s as SkillItem;
          const usable = canUseOutsideBattle(skill) && skill.uses_remaining > 0;
          return (
            <div key={skill.id} className="rounded border border-dungeon-600 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{skill.name}</div>
                  <p className="text-xs capitalize text-stone-500">
                    {normalizeEffect(skill.effect_type)}
                    {skill.slot_kind ? ` · ${skill.slot_kind} slot` : ''}
                  </p>
                  {skill.description && <p className="mt-1 text-sm text-stone-500">{skill.description}</p>}
                  <p className="mt-1 text-xs text-stone-500">{useSkillHint(skill)}</p>
                </div>
                <span className="shrink-0 text-dungeon-300">{skill.uses_remaining} / {skill.max_uses_per_rest} uses</span>
              </div>
              {usable && (
                <button
                  type="button"
                  className="btn-primary mt-2 text-xs"
                  onClick={() => {
                    setTargetId(party[0]?.character_id || character.id);
                    setPendingSkill(skill);
                  }}
                >
                  Use skill…
                </button>
              )}
            </div>
          );
        })}
        <p className="text-sm text-stone-500">Uses refill after rest at bonfire or house events. New slots appear when STR/DEX/INT/CHA rise.</p>
      </div>

      {pendingSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card max-w-sm w-full space-y-3">
            <h3 className="font-semibold text-dungeon-300">Use {pendingSkill.name}</h3>
            <p className="text-sm text-stone-400">{useSkillHint(pendingSkill)}</p>
            <div>
              <label className="label">Target</label>
              <select className="input" value={targetId} onChange={(e) => setTargetId(+e.target.value)}>
                {party.map((p) => (
                  <option key={p.character_id} value={p.character_id}>
                    {p.name}{p.is_self ? ' (you)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-primary" onClick={confirmUse}>Confirm</button>
              <button type="button" className="btn-secondary" onClick={() => setPendingSkill(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
