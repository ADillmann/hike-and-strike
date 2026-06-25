from types import SimpleNamespace

from app.services.battle_engine import redact_enemy_hp_for_player
from app.services.character_stats import (
    effect_allsight_level,
    party_allsight_level_from_characters,
)


def _effect(label="", battle_modifiers=None, active_in_battle=True):
    return SimpleNamespace(
        label=label,
        battle_modifiers=battle_modifiers or {},
        active_in_battle=active_in_battle,
    )


def _character(*effects):
    return SimpleNamespace(temporary_effects=list(effects))


def test_effect_allsight_level_from_modifier():
    assert effect_allsight_level(_effect(battle_modifiers={"allsight": 1})) == 1
    assert effect_allsight_level(_effect(battle_modifiers={"allsight": 2})) == 2


def test_effect_allsight_level_from_label():
    assert effect_allsight_level(_effect(label="Allsight I")) == 1
    assert effect_allsight_level(_effect(label="Allsight II")) == 2


def test_effect_allsight_level_ii_before_i():
    assert effect_allsight_level(_effect(label="Allsight II")) == 2


def test_effect_allsight_level_inactive():
    assert effect_allsight_level(_effect(label="Allsight II", active_in_battle=False)) == 0


def test_party_allsight_level_takes_max():
    chars = [
        _character(_effect(label="Allsight I")),
        _character(_effect(battle_modifiers={"allsight": 2})),
    ]
    assert party_allsight_level_from_characters(chars) == 2


def _enemy(name, is_boss=False, hp=20):
    return {
        "id": f"enemy_{name}",
        "type": "enemy",
        "name": name,
        "current_hp": hp,
        "max_hp": hp,
        "stats": {"is_boss": is_boss} if is_boss else {},
        "alive": True,
    }


def test_redact_hides_all_enemies_without_allsight():
    state = {
        "party_allsight_level": 0,
        "actors": [_enemy("goblin"), _enemy("king", is_boss=True)],
    }
    redacted = redact_enemy_hp_for_player(state)
    assert all(a["hp_hidden"] for a in redacted["actors"])


def test_redact_allsight_i_reveals_non_boss_only():
    state = {
        "party_allsight_level": 1,
        "actors": [_enemy("goblin"), _enemy("king", is_boss=True)],
    }
    redacted = redact_enemy_hp_for_player(state)
    by_name = {a["name"]: a for a in redacted["actors"]}
    assert by_name["goblin"]["hp_hidden"] is False
    assert by_name["king"]["hp_hidden"] is True


def test_redact_allsight_ii_reveals_all_enemies():
    state = {
        "party_allsight_level": 2,
        "actors": [_enemy("goblin"), _enemy("king", is_boss=True)],
    }
    redacted = redact_enemy_hp_for_player(state)
    assert all(not a.get("hp_hidden") for a in redacted["actors"])
