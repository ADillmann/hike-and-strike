from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    username: str
    has_character: bool = False


class LoginRequest(BaseModel):
    username: str
    password: str


class SetupMasterRequest(BaseModel):
    username: str
    password: str


class UserCreate(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    has_character: bool = False

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    password: str | None = None


class StatsDict(BaseModel):
    strength: int = 8
    dexterity: int = 8
    intelligence: int = 8
    durability: int = 8
    charisma: int = 8
    initiative: int = 8


class SkillCreate(BaseModel):
    name: str
    max_uses_per_rest: int = 1


class CharacterCreate(BaseModel):
    name: str
    race: str
    stats: StatsDict
    skills: list[SkillCreate] = Field(default_factory=list)


class CharacterOut(BaseModel):
    id: int
    user_id: int
    name: str
    race: str
    portrait_path: str | None
    stats: dict[str, int]
    max_hp: int
    current_hp: int
    effective_stats: dict[str, int] | None = None
    attack_bonus: int | None = None
    username: str | None = None
    skills: list[dict[str, Any]] = []
    inventory: list[dict[str, Any]] = []
    temporary_effects: list[dict[str, Any]] = []

    class Config:
        from_attributes = True


class StatEditRequest(BaseModel):
    changes: dict[str, int]
    reason: str | None = None
    campaign_id: int | None = None
    scale_hp_on_durability: bool = False


class StatChangeOut(BaseModel):
    id: int
    stat_name: str
    old_value: int
    new_value: int
    reason: str | None
    timestamp: datetime

    class Config:
        from_attributes = True


class GroupCreate(BaseModel):
    name: str
    character_ids: list[int] = Field(default_factory=list)


class GroupOut(BaseModel):
    id: int
    name: str
    members: list[dict[str, Any]] = []

    class Config:
        from_attributes = True


class EventTemplateCreate(BaseModel):
    name: str
    description: str = ""
    event_type: str = "story"
    images: list[str] = Field(default_factory=list)
    is_generic: bool = False
    branch_hints: dict | None = None


class EventTemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    event_type: str | None = None


class EventTemplateOut(BaseModel):
    id: int
    name: str
    description: str
    event_type: str
    images: list[str]
    is_generic: bool
    branch_hints: dict | None = None

    class Config:
        from_attributes = True


class ItemTemplateCreate(BaseModel):
    name: str
    item_type: str
    tier: int = 1
    stats: dict[str, Any] = Field(default_factory=dict)
    description: str = ""


class ItemTemplateOut(BaseModel):
    id: int
    name: str
    item_type: str
    tier: int
    stats: dict[str, Any]
    description: str
    is_system: bool

    class Config:
        from_attributes = True


class CampaignNodeCreate(BaseModel):
    event_template_id: int
    sort_order: int = 0
    label: str | None = None


class CampaignCreate(BaseModel):
    name: str
    group_id: int
    nodes: list[CampaignNodeCreate] = Field(default_factory=list)


class CampaignOut(BaseModel):
    id: int
    name: str
    group_id: int
    status: str
    current_node_id: int | None
    nodes: list[dict[str, Any]] = []

    class Config:
        from_attributes = True


class AdvanceCampaignRequest(BaseModel):
    node_id: int
    outcome: str
    master_notes: str | None = None
    apply_rest: bool = False
    rewards: dict[str, Any] | None = None
    punishments: dict[str, Any] | None = None


class RewardsRequest(BaseModel):
    rewards: dict[str, Any] | None = None
    punishments: dict[str, Any] | None = None


class EquipRequest(BaseModel):
    inventory_item_id: int
    slot: str | None = None


class GiveItemRequest(BaseModel):
    inventory_item_id: int
    target_character_id: int
    quantity: int = 1


class UseItemRequest(BaseModel):
    inventory_item_id: int


class DiscardItemRequest(BaseModel):
    inventory_item_id: int


class EnemyTemplateCreate(BaseModel):
    name: str
    stats: dict[str, Any] = Field(default_factory=dict)
    description: str = ""


class EnemyTemplateOut(BaseModel):
    id: int
    name: str
    stats: dict[str, Any]
    description: str
    is_system: bool

    class Config:
        from_attributes = True


class EnemySpec(BaseModel):
    template_id: int
    count: int = 1
    power_scale: float = 1.0


class BattleCreateRequest(BaseModel):
    enemies: list[EnemySpec] = Field(default_factory=list)
    preset: str | None = None
    group_initiative_bonus: float = 0.0
    enemy_initiative_bonus: float = 0.0


class BattleActionRequest(BaseModel):
    action: str
    actor_id: str | None = None
    target_id: str | None = None
    skill_id: int | None = None
