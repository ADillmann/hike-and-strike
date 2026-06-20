import enum
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class UserRole(str, enum.Enum):
    master = "master"
    player = "player"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.player)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    character: Mapped["Character | None"] = relationship(back_populates="user", uselist=False)
    created_users: Mapped[list["User"]] = relationship("User", back_populates="creator", foreign_keys=[created_by_id])
    creator: Mapped["User | None"] = relationship("User", back_populates="created_users", remote_side=[id])
    groups: Mapped[list["Group"]] = relationship(back_populates="master")


class Character(Base):
    __tablename__ = "characters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    name: Mapped[str] = mapped_column(String(128))
    race: Mapped[str] = mapped_column(String(64))
    portrait_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    stats: Mapped[dict] = mapped_column(JSON, default=dict)
    max_hp: Mapped[int] = mapped_column(Integer, default=10)
    current_hp: Mapped[int] = mapped_column(Integer, default=10)
    level: Mapped[int] = mapped_column(Integer, default=1)
    xp: Mapped[int] = mapped_column(Integer, default=0)
    stat_points_free: Mapped[int] = mapped_column(Integer, default=0)
    level_stat_allocations: Mapped[dict] = mapped_column(JSON, default=dict)
    wallet_copper: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="character")
    group_memberships: Mapped[list["GroupMember"]] = relationship(back_populates="character")
    inventory_items: Mapped[list["InventoryItem"]] = relationship(back_populates="character")
    skills: Mapped[list["Skill"]] = relationship(back_populates="character")
    temporary_effects: Mapped[list["TemporaryEffect"]] = relationship(back_populates="character")
    stat_changes: Mapped[list["StatChangeLog"]] = relationship(back_populates="character")


class StatChangeLog(Base):
    __tablename__ = "stat_change_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id"))
    stat_name: Mapped[str] = mapped_column(String(64))
    old_value: Mapped[int] = mapped_column(Integer)
    new_value: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    changed_by_master_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    campaign_id: Mapped[int | None] = mapped_column(ForeignKey("campaigns.id"), nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    character: Mapped["Character"] = relationship(back_populates="stat_changes")


class Group(Base):
    __tablename__ = "groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    master_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    master: Mapped["User"] = relationship(back_populates="groups")
    members: Mapped[list["GroupMember"]] = relationship(back_populates="group", cascade="all, delete-orphan")
    campaigns: Mapped[list["Campaign"]] = relationship(back_populates="group")


class GroupMember(Base):
    __tablename__ = "group_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id"))
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id"))

    group: Mapped["Group"] = relationship(back_populates="members")
    character: Mapped["Character"] = relationship(back_populates="group_memberships")


class EventTemplate(Base):
    __tablename__ = "event_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    master_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str] = mapped_column(Text, default="")
    event_type: Mapped[str] = mapped_column(String(32), default="story")
    images: Mapped[list] = mapped_column(JSON, default=list)
    is_generic: Mapped[bool] = mapped_column(Boolean, default=False)
    branch_hints: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    shop_config: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    nodes: Mapped[list["CampaignEventNode"]] = relationship(back_populates="event_template")


class SecretTemplate(Base):
    __tablename__ = "secret_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    master_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str] = mapped_column(Text, default="")
    solver_type: Mapped[str] = mapped_column(String(32), default="codeword")
    solver_config: Mapped[dict] = mapped_column(JSON, default=dict)
    examine_stat: Mapped[str] = mapped_column(String(32), default="intelligence")
    examine_mode: Mapped[str] = mapped_column(String(32), default="d20_plus_stat")
    examine_dc: Mapped[int] = mapped_column(Integer, default=10)
    revealed_description: Mapped[str] = mapped_column(Text, default="")
    fail_message_examine: Mapped[str] = mapped_column(String(256), default="Nothing happens...")
    fail_message_solve: Mapped[str] = mapped_column(String(256), default="That doesn't work.")
    rewards: Mapped[dict] = mapped_column(JSON, default=dict)
    consume_on_solve: Mapped[bool] = mapped_column(Boolean, default=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    item_templates: Mapped[list["ItemTemplate"]] = relationship(back_populates="secret_template")


class ItemTemplate(Base):
    __tablename__ = "item_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    master_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(128))
    item_type: Mapped[str] = mapped_column(String(32))
    tier: Mapped[int] = mapped_column(Integer, default=1)
    stats: Mapped[dict] = mapped_column(JSON, default=dict)
    description: Mapped[str] = mapped_column(Text, default="")
    secret_template_id: Mapped[int | None] = mapped_column(ForeignKey("secret_templates.id"), nullable=True)
    base_price: Mapped[int] = mapped_column(Integer, default=0)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    secret_template: Mapped["SecretTemplate | None"] = relationship(back_populates="item_templates")
    inventory_items: Mapped[list["InventoryItem"]] = relationship(back_populates="item_template")


class SkillTemplate(Base):
    __tablename__ = "skill_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    master_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str] = mapped_column(Text, default="")
    max_uses_per_rest: Mapped[int] = mapped_column(Integer, default=1)
    effect_type: Mapped[str] = mapped_column(String(32), default="none")
    effect_params: Mapped[dict] = mapped_column(JSON, default=dict)
    selectable_at_creation: Mapped[bool] = mapped_column(Boolean, default=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)

    character_skills: Mapped[list["Skill"]] = relationship(back_populates="skill_template")


class EffectTemplate(Base):
    __tablename__ = "effect_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    master_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str] = mapped_column(Text, default="")
    label: Mapped[str] = mapped_column(String(128))
    is_buff: Mapped[bool] = mapped_column(Boolean, default=True)
    stat_modifiers: Mapped[dict] = mapped_column(JSON, default=dict)
    battle_modifiers: Mapped[dict] = mapped_column(JSON, default=dict)
    active_in_battle: Mapped[bool] = mapped_column(Boolean, default=False)
    cleared_on_rest: Mapped[bool] = mapped_column(Boolean, default=True)
    cleared_on_event: Mapped[bool] = mapped_column(Boolean, default=False)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Campaign(Base):
    __tablename__ = "campaigns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id"))
    master_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(32), default="draft")
    current_node_id: Mapped[int | None] = mapped_column(ForeignKey("campaign_event_nodes.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    group: Mapped["Group"] = relationship(back_populates="campaigns")
    nodes: Mapped[list["CampaignEventNode"]] = relationship(
        back_populates="campaign",
        foreign_keys="CampaignEventNode.campaign_id",
        cascade="all, delete-orphan",
    )
    history: Mapped[list["EventHistory"]] = relationship(back_populates="campaign", cascade="all, delete-orphan")
    current_node: Mapped["CampaignEventNode | None"] = relationship(
        foreign_keys=[current_node_id],
        post_update=True,
    )


class CampaignEventNode(Base):
    __tablename__ = "campaign_event_nodes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id"))
    event_template_id: Mapped[int] = mapped_column(ForeignKey("event_templates.id"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    label: Mapped[str | None] = mapped_column(String(128), nullable=True)

    campaign: Mapped["Campaign"] = relationship(back_populates="nodes", foreign_keys=[campaign_id])
    event_template: Mapped["EventTemplate"] = relationship(back_populates="nodes")


class EventHistory(Base):
    __tablename__ = "event_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id"))
    node_id: Mapped[int | None] = mapped_column(ForeignKey("campaign_event_nodes.id"), nullable=True)
    outcome: Mapped[str] = mapped_column(String(32))
    master_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    rewards_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    punishments_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    campaign: Mapped["Campaign"] = relationship(back_populates="history")


class InventoryItem(Base):
    __tablename__ = "inventory_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id"))
    item_template_id: Mapped[int] = mapped_column(ForeignKey("item_templates.id"))
    equipped_slot: Mapped[str | None] = mapped_column(String(32), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    secret_state: Mapped[dict] = mapped_column(JSON, default=dict)

    character: Mapped["Character"] = relationship(back_populates="inventory_items")
    item_template: Mapped["ItemTemplate"] = relationship(back_populates="inventory_items")


class Skill(Base):
    __tablename__ = "skills"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id"))
    skill_template_id: Mapped[int | None] = mapped_column(ForeignKey("skill_templates.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(64))
    max_uses_per_rest: Mapped[int] = mapped_column(Integer, default=1)
    uses_remaining: Mapped[int] = mapped_column(Integer, default=1)

    character: Mapped["Character"] = relationship(back_populates="skills")
    skill_template: Mapped["SkillTemplate | None"] = relationship(back_populates="character_skills")


class TemporaryEffect(Base):
    __tablename__ = "temporary_effects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id"))
    effect_template_id: Mapped[int | None] = mapped_column(ForeignKey("effect_templates.id"), nullable=True)
    label: Mapped[str] = mapped_column(String(128))
    stat_modifiers: Mapped[dict] = mapped_column(JSON, default=dict)
    battle_modifiers: Mapped[dict] = mapped_column(JSON, default=dict)
    active_in_battle: Mapped[bool] = mapped_column(Boolean, default=False)
    cleared_on_rest: Mapped[bool] = mapped_column(Boolean, default=True)
    cleared_on_event: Mapped[bool] = mapped_column(Boolean, default=False)

    character: Mapped["Character"] = relationship(back_populates="temporary_effects")


class EnemyTemplate(Base):
    __tablename__ = "enemy_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    master_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(128))
    stats: Mapped[dict] = mapped_column(JSON, default=dict)
    description: Mapped[str] = mapped_column(Text, default="")
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)


class BattlePreset(Base):
    __tablename__ = "battle_presets"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    master_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(128))
    enemies: Mapped[list] = mapped_column(JSON, default=list)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)


class CurrencySettings(Base):
    __tablename__ = "currency_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    master_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    tier1_name: Mapped[str] = mapped_column(String(64), default="Copper")
    tier2_name: Mapped[str] = mapped_column(String(64), default="Silver")
    tier3_name: Mapped[str] = mapped_column(String(64), default="Gold")
    copper_per_silver: Mapped[int] = mapped_column(Integer, default=100)
    silver_per_gold: Mapped[int] = mapped_column(Integer, default=10)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)


class Battle(Base):
    __tablename__ = "battles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id"))
    status: Mapped[str] = mapped_column(String(32), default="pending")
    state_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
