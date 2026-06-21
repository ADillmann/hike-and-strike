export interface GridActor {
  id: string;
  name: string;
  type: 'player' | 'enemy';
  position: { x: number; y: number };
  alive?: boolean;
  character_id?: number;
}

export function BattleGrid({
  width,
  height,
  actors,
  blockedCells = [],
  highlightCells = [],
  rangeHighlightCells = [],
  targetHighlightCells = [],
  activeActorId,
  selectedActorId,
  onCellClick,
  draggable = false,
  onDragActor,
}: {
  width: number;
  height: number;
  actors: GridActor[];
  blockedCells?: { x: number; y: number }[];
  highlightCells?: { x: number; y: number }[];
  rangeHighlightCells?: { x: number; y: number }[];
  targetHighlightCells?: { x: number; y: number }[];
  activeActorId?: string | null;
  selectedActorId?: string | null;
  onCellClick?: (x: number, y: number) => void;
  draggable?: boolean;
  onDragActor?: (actorId: string, x: number, y: number) => void;
}) {
  const highlightSet = new Set(highlightCells.map((c) => `${c.x},${c.y}`));
  const blockedSet = new Set(blockedCells.map((c) => `${c.x},${c.y}`));
  const rangeSet = new Set(rangeHighlightCells.map((c) => `${c.x},${c.y}`));
  const targetSet = new Set(targetHighlightCells.map((c) => `${c.x},${c.y}`));
  const byCell = new Map<string, GridActor>();
  for (const a of actors) {
    byCell.set(`${a.position.x},${a.position.y}`, a);
  }

  const cells: JSX.Element[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const key = `${x},${y}`;
      const actor = byCell.get(key);
      const blocked = blockedSet.has(key);
      const highlighted = highlightSet.has(key);
      const inRange = rangeSet.has(key);
      const isTarget = targetSet.has(key);
      const isDead = actor && actor.alive === false;
      cells.push(
        <button
          key={key}
          type="button"
          className={`relative flex aspect-square items-center justify-center rounded border text-xs ${
            blocked
              ? 'border-stone-700 bg-stone-950/90'
              : isTarget
              ? 'border-green-500 bg-green-950/50 ring-2 ring-green-500/60'
              : highlighted
                ? 'border-dungeon-400 bg-dungeon-700/80 ring-1 ring-dungeon-400'
                : inRange
                  ? 'border-blue-900/80 bg-blue-950/30'
                  : 'border-dungeon-800 bg-dungeon-900/60'
          } ${onCellClick ? 'cursor-pointer hover:border-dungeon-500' : ''}`}
          onClick={() => onCellClick?.(x, y)}
          onDragOver={(e) => draggable && !blocked && e.preventDefault()}
          onDrop={(e) => {
            if (!draggable || !onDragActor || blocked) return;
            e.preventDefault();
            const aid = e.dataTransfer.getData('actorId');
            if (aid) onDragActor(aid, x, y);
          }}
        >
          {blocked && !actor && (
            <span className="text-stone-600 select-none" title="Obstacle">▪</span>
          )}
          {actor && (
            <span
              draggable={draggable && !isDead}
              onDragStart={(e) => {
                e.dataTransfer.setData('actorId', actor.id);
              }}
              className={`truncate px-0.5 text-center ${
                isDead
                  ? 'text-stone-600 line-through opacity-50'
                  : actor.type === 'player'
                    ? 'text-green-300'
                    : 'text-red-300'
              } ${!isDead && actor.id === activeActorId ? 'animate-pulse font-bold underline ring-1 ring-amber-400/80 rounded' : ''} ${
                actor.id === selectedActorId ? 'ring-1 ring-white' : ''
              }`}
              title={isDead ? `${actor.name} (defeated)` : actor.name}
            >
              {actor.name.split(' ')[0]}
            </span>
          )}
        </button>,
      );
    }
  }

  return (
    <div
      className="inline-grid gap-0.5"
      style={{ gridTemplateColumns: `repeat(${width}, minmax(2.5rem, 1fr))` }}
    >
      {cells}
    </div>
  );
}
