export interface GridActor {
  id: string;
  name: string;
  type: 'player' | 'enemy';
  position: { x: number; y: number };
  alive?: boolean;
  character_id?: number;
}

export type TerrainType = 'wall' | 'water' | 'forest';

export interface TerrainCell {
  x: number;
  y: number;
  type: TerrainType;
}

export function normalizeTerrainCells(grid: {
  terrain_cells?: TerrainCell[];
  blocked_cells?: { x: number; y: number }[];
}): TerrainCell[] {
  if (grid.terrain_cells?.length) return grid.terrain_cells;
  return (grid.blocked_cells || []).map((c) => ({ x: c.x, y: c.y, type: 'wall' as const }));
}

export function isImpassableTerrain(type: TerrainType): boolean {
  return type === 'wall' || type === 'water';
}

const TERRAIN_CYCLE: Record<TerrainType | 'empty', TerrainType | 'empty'> = {
  empty: 'wall',
  wall: 'water',
  water: 'forest',
  forest: 'empty',
};

export function cycleTerrainType(current: TerrainType | undefined): TerrainType | 'empty' {
  return TERRAIN_CYCLE[current ?? 'empty'];
}

export const MIN_BATTLE_GRID = 5;
export const MAX_BATTLE_GRID = 9;

export function suggestedGridSize(partySize: number): number {
  return Math.max(MIN_BATTLE_GRID, Math.min(MAX_BATTLE_GRID, partySize + 1));
}

/** Short label for grid cells (e.g. "Bandit A" → "Ban·A", "Goblin B" → "Gob·B"). */
export function gridTokenLabel(name: string): string {
  const letterMatch = name.match(/^(.+?)\s+([A-Z])$/);
  if (letterMatch) {
    const abbrev = _abbrevTokenBase(letterMatch[1].trim());
    return `${abbrev}·${letterMatch[2]}`;
  }
  const numMatch = name.match(/^(.+?)\s+(\d+)$/);
  if (numMatch) {
    const abbrev = _abbrevTokenBase(numMatch[1].trim());
    return `${abbrev}${numMatch[2]}`;
  }
  const first = name.split(' ')[0];
  return first.length <= 6 ? first : `${first.slice(0, 5)}…`;
}

function _abbrevTokenBase(baseName: string): string {
  const first = baseName.split(' ')[0];
  if (first.length <= 4) return first;
  return first.slice(0, 3);
}

function terrainCellClass(type: TerrainType): string {
  switch (type) {
    case 'wall':
      return 'border-stone-700 bg-stone-950/90';
    case 'water':
      return 'border-blue-800 bg-blue-950/70';
    case 'forest':
      return 'border-green-900 bg-green-950/50';
  }
}

function terrainGlyph(type: TerrainType): string {
  switch (type) {
    case 'wall':
      return '▪';
    case 'water':
      return '~';
    case 'forest':
      return '*';
  }
}

export function BattleGrid({
  width,
  height,
  actors,
  terrainCells = [],
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
  terrainCells?: TerrainCell[];
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
  const terrainByCell = new Map<string, TerrainType>();
  for (const c of terrainCells) {
    terrainByCell.set(`${c.x},${c.y}`, c.type);
  }
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
      const terrainType = terrainByCell.get(key);
      const impassable = terrainType !== undefined && isImpassableTerrain(terrainType);
      const highlighted = highlightSet.has(key);
      const inRange = rangeSet.has(key);
      const isTarget = targetSet.has(key);
      const isDead = actor && actor.alive === false;
      cells.push(
        <button
          key={key}
          type="button"
          className={`relative flex aspect-square items-center justify-center rounded border text-xs ${
            terrainType
              ? terrainCellClass(terrainType)
              : isTarget
              ? 'border-green-500 bg-green-950/50 ring-2 ring-green-500/60'
              : highlighted
                ? 'border-dungeon-400 bg-dungeon-700/80 ring-1 ring-dungeon-400'
                : inRange
                  ? 'border-blue-900/80 bg-blue-950/30'
                  : 'border-dungeon-800 bg-dungeon-900/60'
          } ${onCellClick ? 'cursor-pointer hover:border-dungeon-500' : ''}`}
          onClick={() => onCellClick?.(x, y)}
          onDragOver={(e) => draggable && !impassable && e.preventDefault()}
          onDrop={(e) => {
            if (!draggable || !onDragActor || impassable) return;
            e.preventDefault();
            const aid = e.dataTransfer.getData('actorId');
            if (aid) onDragActor(aid, x, y);
          }}
        >
          {terrainType && !actor && (
            <span
              className={`select-none ${
                terrainType === 'wall'
                  ? 'text-stone-600'
                  : terrainType === 'water'
                    ? 'text-blue-400/80'
                    : 'text-green-600/80'
              }`}
              title={terrainType}
            >
              {terrainGlyph(terrainType)}
            </span>
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
              {gridTokenLabel(actor.name)}
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
