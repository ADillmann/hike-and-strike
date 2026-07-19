import { useId, useState } from 'react';

const DICE_SIDES = [4, 6, 8, 10, 12, 20, 100] as const;
type DiceSides = (typeof DICE_SIDES)[number];

interface DiceGroup {
  id: string;
  sides: DiceSides;
  count: number;
}

interface GroupResult {
  sides: DiceSides;
  count: number;
  rolls: number[];
}

interface RollResult {
  id: string;
  expression: string;
  groups: GroupResult[];
  total: number;
}

const MAX_COUNT = 20;
const MAX_HISTORY = 5;

function newGroupId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultGroups(): DiceGroup[] {
  return [{ id: newGroupId(), sides: 20, count: 1 }];
}

function formatExpression(groups: { sides: number; count: number }[]): string {
  return groups.map((g) => `${g.count}d${g.sides}`).join(' + ');
}

function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

function rollGroups(groups: DiceGroup[]): RollResult {
  const results: GroupResult[] = groups.map((g) => ({
    sides: g.sides,
    count: g.count,
    rolls: Array.from({ length: g.count }, () => rollDie(g.sides)),
  }));
  const total = results.reduce((sum, g) => sum + g.rolls.reduce((a, b) => a + b, 0), 0);
  return {
    id: newGroupId(),
    expression: formatExpression(groups),
    groups: results,
    total,
  };
}

export function DiceBox({ className = '' }: { className?: string }) {
  const baseId = useId();
  const [groups, setGroups] = useState<DiceGroup[]>(defaultGroups);
  const [latest, setLatest] = useState<RollResult | null>(null);
  const [history, setHistory] = useState<RollResult[]>([]);

  const updateGroup = (id: string, patch: Partial<Pick<DiceGroup, 'sides' | 'count'>>) => {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== id) return g;
        const next = { ...g, ...patch };
        if (patch.count != null) {
          next.count = Math.min(MAX_COUNT, Math.max(1, patch.count));
        }
        return next;
      }),
    );
  };

  const addGroup = () => {
    setGroups((prev) => [...prev, { id: newGroupId(), sides: 6, count: 1 }]);
  };

  const removeGroup = (id: string) => {
    setGroups((prev) => (prev.length <= 1 ? prev : prev.filter((g) => g.id !== id)));
  };

  const onRoll = () => {
    const result = rollGroups(groups);
    setLatest(result);
    setHistory((prev) => [result, ...prev].slice(0, MAX_HISTORY));
  };

  return (
    <section className={`card ${className}`.trim()}>
      <h2 className="mb-2 font-semibold text-dungeon-300">Dice</h2>
      <p className="mb-3 text-xs text-stone-500">
        Master-only roller. Combine dice types (e.g. 3d6 + 1d10). Default is 1d20.
      </p>

      <div className="space-y-2">
        {groups.map((g, index) => (
          <div key={g.id} className="flex flex-wrap items-end gap-2">
            <div className="min-w-[4.5rem]">
              <label className="label" htmlFor={`${baseId}-count-${g.id}`}>
                {index === 0 ? 'Count' : '\u00a0'}
              </label>
              <input
                id={`${baseId}-count-${g.id}`}
                type="number"
                min={1}
                max={MAX_COUNT}
                className="input"
                value={g.count}
                onChange={(e) => updateGroup(g.id, { count: Number(e.target.value) || 1 })}
              />
            </div>
            <div className="min-w-[5.5rem] flex-1">
              <label className="label" htmlFor={`${baseId}-sides-${g.id}`}>
                {index === 0 ? 'Die' : '\u00a0'}
              </label>
              <select
                id={`${baseId}-sides-${g.id}`}
                className="input"
                value={g.sides}
                onChange={(e) => updateGroup(g.id, { sides: Number(e.target.value) as DiceSides })}
              >
                {DICE_SIDES.map((sides) => (
                  <option key={sides} value={sides}>
                    d{sides}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn-secondary px-2 py-1.5 text-xs"
              disabled={groups.length <= 1}
              onClick={() => removeGroup(g.id)}
              title="Remove this dice group"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <p className="mt-2 text-sm text-dungeon-300">{formatExpression(groups)}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-secondary text-sm" onClick={addGroup}>
          Add dice
        </button>
        <button type="button" className="btn-primary text-sm" onClick={onRoll}>
          Roll
        </button>
      </div>

      {latest && (
        <div className="mt-3 rounded border border-dungeon-600 bg-dungeon-900/40 p-3">
          <p className="text-xs text-stone-500">{latest.expression}</p>
          <div className="mt-2 space-y-1 text-sm">
            {latest.groups.map((g, i) => (
              <p key={`${latest.id}-${i}`}>
                <span className="text-stone-400">{g.count}d{g.sides}: </span>
                <span className="text-stone-200">{g.rolls.join(', ')}</span>
              </p>
            ))}
          </div>
          <p className="mt-2 text-lg font-semibold text-dungeon-200">
            Total: {latest.total}
          </p>
        </div>
      )}

      {history.length > 1 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-stone-500">Recent rolls</p>
          <ul className="space-y-1 text-xs text-stone-400">
            {history.slice(1).map((h) => (
              <li key={h.id}>
                {h.expression} → {h.total}
                <span className="text-stone-600">
                  {' '}
                  ({h.groups.map((g) => g.rolls.join('+')).join(' · ')})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
