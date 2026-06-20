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


class SkillTemplateCreate(BaseModel):
    name: str
    description: str = ""
    max_uses_per_rest: int = 1
    effect_type: str = "none"
    effect_params: dict[str, Any] = Field(default_factory=dict)
    selectable_at_creation: bool = True


class SkillTemplateOut(BaseModel):
    id: int
    name: str
    description: str
    max_uses_per_rest: int
    effect_type: str
    effect_params: dict[str, Any]
    selectable_at_creation: bool
    is_system: bool

    class Config:
        from_attributes = True


class AssignSkillRequest(BaseModel):
    skill_template_id: int


class EffectTemplateCreate(BaseModel):
    name: str
    description: str = ""
    label: str = ""
    is_buff: bool = True
    stat_modifiers: dict[str, int] = Field(default_factory=dict)
    battle_modifiers: dict[str, int] = Field(default_factory=dict)
    active_in_battle: bool = False
    cleared_on_rest: bool = True
    cleared_on_event: bool = False


class EffectTemplateOut(BaseModel):
    id: int
    name: str
    description: str
    label: str
    is_buff: bool
    stat_modifiers: dict[str, int]
    battle_modifiers: dict[str, int]
    active_in_battle: bool
    cleared_on_rest: bool
    cleared_on_event: bool
    is_system: bool

    class Config:
        from_attributes = True


class CharacterCreate(BaseModel):
    name: str
    race: str
    stats: StatsDict
    skills: list[SkillCreate] = Field(default_factory=list)
    skill_template_ids: list[int] = Field(default_factory=list)


class CharacterOut(BaseModel):
    id: int
    user_id: int
    name: str
    race: str
    portrait_path: str | None
    stats: dict[str, int]
    max_hp: int
    current_hp: int
    level: int = 1
    xp: int = 0
    xp_to_next_level: int = 100
    stat_points_free: int = 0
    level_stat_allocations: dict[str, int] = Field(default_factory=dict)
    stat_raise_costs: dict[str, int] = Field(default_factory=dict)
    effective_stats: dict[str, int] | None = None
    attack_bonus: int | None = None
    username: str | None = None
    skills: list[dict[str, Any]] = []
    inventory: list[dict[str, Any]] = []
    temporary_effects: list[dict[str, Any]] = []

    class Config:
        from_attributes = True


class AllocateStatRequest(BaseModel):
    stat: str


class ReleaseStatRequest(BaseModel):
    stat: str
    campaign_id: int | None = None


class GrantXpRequest(BaseModel):
    amount: int
    campaign_id: int | None = None


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


class SecretTemplateCreate(BaseModel):
    name: str
    description: str = ""
    solver_type: str = "codeword"
    solver_config: dict[str, Any] = Field(default_factory=dict)
    examine_stat: str = "intelligence"
    examine_mode: str = "d20_plus_stat"
    examine_dc: int = 10
    revealed_description: str = ""
    fail_message_examine: str = "Nothing happens..."
    fail_message_solve: str = "That doesn't work."
    rewards: dict[str, Any] = Field(default_factory=dict)
    consume_on_solve: bool = True


class SecretTemplateOut(BaseModel):
    id: int
    name: str
    description: str
    solver_type: str
    solver_config: dict[str, Any]
    examine_stat: str
    examine_mode: str
    examine_dc: int
    revealed_description: str
    fail_message_examine: str
    fail_message_solve: str
    rewards: dict[str, Any]
    consume_on_solve: bool
    is_system: bool

    class Config:
        from_attributes = True


class ExamineSecretItemRequest(BaseModel):
    inventory_item_id: int


class SolveSecretItemRequest(BaseModel):
    inventory_item_id: int
    guess: str


class SecretInteractionOut(BaseModel):
    success: bool
    message: str
    revealed_description: str | None = None
    can_solve: bool | None = None
    roll: int | None = None
    dc: int | None = None


class SecretSolveResponse(BaseModel):
    success: bool
    message: str
    rewards_summary: list[str] = Field(default_factory=list)
    character: CharacterOut


class ItemTemplateCreate(BaseModel):
    name: str
    item_type: str
    tier: int = 1
    stats: dict[str, Any] = Field(default_factory=dict)
    description: str = ""
    secret_template_id: int | None = None


class ItemTemplateOut(BaseModel):
    id: int
    name: str
    item_type: str
    tier: int
    stats: dict[str, Any]
    description: str
    secret_template_id: int | None = None
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


class UseSkillRequest(BaseModel):
    skill_id: int
    target_character_id: int


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


class PresetEnemyEntry(BaseModel):
    template_name: str
    count: int = 1
    power_scale: float = 1.0


class BattlePresetCreate(BaseModel):
    name: str
    enemies: list[PresetEnemyEntry] = Field(default_factory=list)
    preset_id: str | None = None


class BattlePresetOut(BaseModel):
    id: str
    name: str
    enemies: list[dict[str, Any]]
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
