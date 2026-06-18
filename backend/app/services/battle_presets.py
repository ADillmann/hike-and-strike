from sqlalchemy.orm import Session

from app.models import BattlePreset, EnemyTemplate

DEFAULT_BATTLE_PRESETS = {
    "goblin_crowd": {
        "name": "Goblin Crowd with Goblin King",
        "enemies": [
            {"template_name": "Goblin", "count": 4, "power_scale": 1.0},
            {"template_name": "Goblin King", "count": 1, "power_scale": 1.0},
        ],
    },
    "bandit_ambush": {
        "name": "Bandit Ambush",
        "enemies": [
            {"template_name": "Bandit", "count": 3, "power_scale": 1.0},
        ],
    },
}


def resolve_preset_enemy_specs(db: Session, preset_id: str) -> list[dict]:
    preset = db.get(BattlePreset, preset_id)
    if not preset:
        return []
    specs = []
    for entry in preset.enemies:
        template = db.query(EnemyTemplate).filter(EnemyTemplate.name == entry["template_name"]).first()
        if template:
            specs.append({
                "template_id": template.id,
                "count": entry.get("count", 1),
                "power_scale": entry.get("power_scale", 1.0),
            })
    return specs
