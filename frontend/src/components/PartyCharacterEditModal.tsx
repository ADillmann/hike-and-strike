import { useState } from 'react';
import { api, Character } from '../api/client';
import { ConfirmDialog } from './ConfirmDialog';
import { StatEditor } from './Layout';
import { formatBattleMods, formatStatMods } from '../utils/effects';

function effectRowClass(effect: Character['temporary_effects'][number]): string {
  const statSum = Object.values(effect.stat_modifiers || {}).reduce((a, b) => a + b, 0);
  const battleSum = Object.values(effect.battle_modifiers || {}).reduce((a, b) => a + b, 0);
  if (statSum < 0 || battleSum < 0) return 'border-red-800/60 bg-red-950/30';
  if (statSum > 0 || battleSum > 0) return 'border-green-800/60 bg-green-950/20';
  return 'border-dungeon-600 bg-dungeon-900/50';
}

export function PartyCharacterEditModal({
  character: initialCharacter,
  campaignId,
  onClose,
  onSaved,
  onCharacterUpdated,
}: {
  character: Character;
  campaignId: number;
  onClose: () => void;
  onSaved: () => void;
  onCharacterUpdated: (character: Character) => void;
}) {
  const [character, setCharacter] = useState(initialCharacter);
  const [editStats, setEditStats] = useState<Record<string, number>>({
    ...initialCharacter.stats,
    current_hp: initialCharacter.current_hp,
    max_hp: initialCharacter.max_hp,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<{ id: number; label: string } | null>(null);

  const saveStats = async () => {
    setError('');
    setBusy(true);
    try {
      const changes: Record<string, number> = {};
      for (const [k, v] of Object.entries(editStats)) {
        const old = k === 'current_hp' || k === 'max_hp'
          ? (character as unknown as Record<string, number>)[k]
          : character.stats[k];
        if (v !== old) changes[k] = v;
      }
      if (Object.keys(changes).length === 0) {
        onClose();
        return;
      }
      const updated = await api.patch<Character>(`/characters/${character.id}/stats`, {
        changes,
        campaign_id: campaignId,
      });
      setCharacter(updated);
      onCharacterUpdated(updated);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save stats');
    } finally {
      setBusy(false);
    }
  };

  const removeEffect = async (effectId: number) => {
    setError('');
    setBusy(true);
    try {
      const updated = await api.delete<Character>(
        `/characters/${character.id}/effects/${effectId}?campaign_id=${campaignId}`,
      );
      setCharacter(updated);
      onCharacterUpdated(updated);
      onSaved();
      setPendingRemove(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove effect');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="card max-h-[90vh] w-full max-w-lg overflow-y-auto">
        <h3 className="mb-3 font-semibold text-dungeon-300">Edit {character.name}</h3>

        {error && (
          <p className="mb-3 rounded border border-red-800 bg-red-950/50 p-2 text-sm text-red-400">{error}</p>
        )}

        <section className="mb-4">
          <h4 className="label mb-1">Wallet</h4>
          <p className="text-lg text-dungeon-200">{character.wallet_display || '0 copper'}</p>
          {character.wallet_copper != null && (
            <p className="text-xs text-stone-500">{character.wallet_copper} copper</p>
          )}
        </section>

        <section className="mb-4">
          <h4 className="label mb-2">Stats &amp; HP</h4>
          <StatEditor
            stats={editStats}
            onChange={(s, v) => setEditStats({ ...editStats, [s]: Math.max(1, v) })}
          />
        </section>

        <section className="mb-4">
          <h4 className="label mb-2">Active effects</h4>
          {character.temporary_effects.length === 0 ? (
            <p className="text-sm text-stone-500">No active effects</p>
          ) : (
            <ul className="space-y-2">
              {character.temporary_effects.map((effect) => {
                const statLine = formatStatMods(effect.stat_modifiers);
                const battleLine = formatBattleMods(effect.active_in_battle, effect.battle_modifiers);
                return (
                  <li
                    key={effect.id}
                    className={`rounded border p-2 text-sm ${effectRowClass(effect)}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-medium text-dungeon-200">{effect.label}</span>
                        {statLine && <p className="text-xs text-stone-400">{statLine}</p>}
                        {battleLine && <p className="text-xs text-dungeon-300">{battleLine}</p>}
                        <div className="mt-1 flex flex-wrap gap-1">
                          {effect.active_in_battle && (
                            <span className="rounded bg-dungeon-700 px-1.5 py-0.5 text-xs text-stone-400">in battle</span>
                          )}
                          {effect.cleared_on_rest && (
                            <span className="rounded bg-dungeon-700 px-1.5 py-0.5 text-xs text-stone-400">clears on rest</span>
                          )}
                          {effect.cleared_on_event && (
                            <span className="rounded bg-dungeon-700 px-1.5 py-0.5 text-xs text-stone-400">clears on event</span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn-danger shrink-0 px-2 py-0.5 text-xs"
                        disabled={busy}
                        onClick={() => setPendingRemove({ id: effect.id, label: effect.label })}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="flex gap-2">
          <button type="button" className="btn-primary" disabled={busy} onClick={saveStats}>Save</button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>

    {pendingRemove && (
      <ConfirmDialog
        title="Remove effect"
        message={`Remove "${pendingRemove.label}" from ${character.name}?`}
        confirmLabel="Remove"
        onConfirm={() => removeEffect(pendingRemove.id)}
        onCancel={() => setPendingRemove(null)}
      />
    )}
    </>
  );
}
