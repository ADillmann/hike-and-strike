from collections import defaultdict
from typing import Any

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self.active: dict[int, list[tuple[WebSocket, int | None]]] = defaultdict(list)
        self.character_campaigns: dict[int, set[int]] = defaultdict(set)

    async def connect(self, campaign_id: int, websocket: WebSocket, user_id: int | None, character_id: int | None = None) -> None:
        await websocket.accept()
        self.active[campaign_id].append((websocket, user_id))
        if character_id:
            self.character_campaigns[character_id].add(campaign_id)

    def disconnect(self, campaign_id: int, websocket: WebSocket) -> None:
        self.active[campaign_id] = [(ws, uid) for ws, uid in self.active[campaign_id] if ws != websocket]

    async def broadcast(self, campaign_id: int, message: dict[str, Any]) -> None:
        dead: list[WebSocket] = []
        for ws, _ in self.active.get(campaign_id, []):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(campaign_id, ws)

    def campaign_ids_for_character(self, character_id: int) -> list[int]:
        return list(self.character_campaigns.get(character_id, set()))


ws_manager = ConnectionManager()
