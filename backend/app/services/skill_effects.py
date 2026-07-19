from app.game.constants import LEGACY_EFFECT_ALIASES, LEGACY_SKILL_EFFECTS
from app.models import Skill, SkillTemplate


def normalize_effect_type(effect_type: str) -> str:
    return LEGACY_EFFECT_ALIASES.get(effect_type, effect_type)


def skill_battle_meta(skill: Skill) -> dict:
    template = skill.skill_template
    if template:
        return {
            "effect_type": normalize_effect_type(template.effect_type),
            "effect_params": template.effect_params or {},
            "description": template.description,
        }
    effect_type = LEGACY_SKILL_EFFECTS.get(skill.name, "none")
    return {
        "effect_type": normalize_effect_type(effect_type),
        "effect_params": _legacy_params(skill.name, effect_type),
        "description": "",
    }


def _legacy_params(name: str, effect_type: str) -> dict:
    effect_type = normalize_effect_type(effect_type)
    if effect_type == "heal":
        return {"heal_base": 5}
    if effect_type == "melee":
        return {"bonus_damage": 3}
    if effect_type == "range":
        if name == "Arcane Bolt":
            return {"bonus_damage": 0, "range_stat": "intelligence"}
        return {"bonus_damage": 0, "range_stat": "dexterity"}
    if effect_type == "support":
        if name == "Dodge":
            return {"support_mode": "shield", "shield_amount": 8}
        if name == "Inspire":
            return {"support_mode": "stat_boost", "stat": "charisma", "stat_bonus": 2}
    return {}


def skill_from_template(
    character_id: int,
    template: SkillTemplate,
    slot_kind: str | None = None,
) -> Skill:
    return Skill(
        character_id=character_id,
        skill_template_id=template.id,
        name=template.name,
        max_uses_per_rest=template.max_uses_per_rest,
        uses_remaining=template.max_uses_per_rest,
        slot_kind=slot_kind,
    )
