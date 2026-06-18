from sqlalchemy.orm import Session, joinedload

from app.models import Character, Skill, SkillTemplate, TemporaryEffect
from app.services.campaign_engine import get_active_campaign_for_character
from app.services.character_stats import effective_stats
from app.services.skill_effects import normalize_effect_type, skill_battle_meta


def can_use_skill_outside_battle(skill_meta: dict) -> bool:
    effect = normalize_effect_type(skill_meta.get("effect_type", "none"))
    if effect == "heal":
        return True
    if effect == "support":
        params = skill_meta.get("effect_params") or {}
        return params.get("support_mode") == "stat_boost"
    return False


def use_skill_outside_battle(
    db: Session,
    caster: Character,
    skill_id: int,
    target_character_id: int,
    *,
    share_group,
) -> tuple[Character, Character]:
    skill = (
        db.query(Skill)
        .options(joinedload(Skill.skill_template))
        .filter(Skill.id == skill_id, Skill.character_id == caster.id)
        .first()
    )
    if not skill:
        raise ValueError("Skill not found")
    if skill.uses_remaining <= 0:
        raise ValueError("No uses remaining")

    meta = skill_battle_meta(skill)
    if not can_use_skill_outside_battle(meta):
        raise ValueError("This skill can only be used in battle")

    target = db.get(Character, target_character_id)
    if not target:
        raise ValueError("Target not found")
    if caster.id != target.id and not share_group(caster.id, target.id):
        raise ValueError("You can only target members of your group")

    effect = normalize_effect_type(meta["effect_type"])
    params = meta.get("effect_params") or {}

    if effect == "heal":
        heal_base = int(params.get("heal_base", 5))
        db.refresh(caster, ["inventory_items", "temporary_effects"])
        for inv in caster.inventory_items:
            db.refresh(inv, ["item_template"])
        eff = effective_stats(caster.stats, caster.inventory_items, caster.temporary_effects)
        heal_amount = heal_base + eff.get("intelligence", 8) // 2
        target.current_hp = min(target.max_hp, target.current_hp + heal_amount)
        skill.uses_remaining -= 1
        return caster, target

    if effect == "support" and params.get("support_mode") == "stat_boost":
        campaign = get_active_campaign_for_character(db, caster.id)
        if not campaign or not campaign.current_node_id:
            raise ValueError("Stat boosts can only be used during an active campaign event")
        stat = params.get("stat", "strength")
        bonus = int(params.get("stat_bonus", 1))
        db.add(
            TemporaryEffect(
                character_id=target.id,
                label=skill.name,
                stat_modifiers={stat: bonus},
                cleared_on_rest=False,
                cleared_on_event=True,
            )
        )
        skill.uses_remaining -= 1
        return caster, target

    raise ValueError("This skill cannot be used outside battle")
