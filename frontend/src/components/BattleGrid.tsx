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
  highlightCells = [],
  activeActorId,
  selectedActorId,
  onCellClick,
  draggable = false,
  onDragActor,
}: {
  width: number;
  height: number;
  actors: GridActor[];
  highlightCells?: { x: number; y: number }[];
  activeActorId?: string | null;
  selectedActorId?: string | null;
  onCellClick?: (x: number, y: number) => void;
  draggable?: boolean;
  onDragActor?: (actorId: string, x: number, y: number) => void;
}) {
  const highlightSet = new Set(highlightCells.map((c) => `${c.x},${c.y}`));
  const byCell = new Map<string, GridActor>();
  for (const a of actors) {
    if (a.alive === false) continue;
    byCell.set(`${a.position.x},${a.position.y}`, a);
  }

  const cells: JSX.Element[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const key = `${x},${y}`;
      const actor = byCell.get(key);
      const highlighted = highlightSet.has(key);
      cells.push(
        <button
          key={key}
          type="button"
          className={`relative flex aspect-square items-center justify-center rounded border text-xs ${
            highlighted ? 'border-dungeon-400 bg-dungeon-700/80 ring-1 ring-dungeon-400' : 'border-dungeon-800 bg-dungeon-900/60'
          } ${onCellClick ? 'cursor-pointer hover:border-dungeon-500' : ''}`}
          onClick={() => onCellClick?.(x, y)}
          onDragOver={(e) => draggable && e.preventDefault()}
          onDrop={(e) => {
            if (!draggable || !onDragActor) return;
            e.preventDefault();
            const aid = e.dataTransfer.getData('actorId');
            if (aid) onDragActor(aid, x, y);
          }}
        >
          {actor && (
            <span
              draggable={draggable}
              onDragStart={(e) => {
                e.dataTransfer.setData('actorId', actor.id);
              }}
              className={`truncate px-0.5 text-center ${
                actor.type === 'player' ? 'text-green-300' : 'text-red-300'
              } ${actor.id === activeActorId ? 'font-bold underline' : ''} ${
                actor.id === selectedActorId ? 'ring-1 ring-white' : ''
              }`}
              title={actor.name}
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
