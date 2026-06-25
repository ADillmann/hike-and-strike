from types import SimpleNamespace

from app.services.character_stats import (
    active_item_effect_templates,
    effect_allsight_level,
    effective_stats,
    inventory_item_grants_effect,
    party_allsight_level_from_characters,
)


def _item(name, effect_id=None, passive=False, equipped=None):
    return SimpleNamespace(
        equipped_slot=equipped,
        item_template=SimpleNamespace(
            name=name,
            effect_template_id=effect_id,
            stats={"passive": passive} if passive else {},
        ),
    )


def _effect(label="", battle_modifiers=None, active_in_battle=True, stat_modifiers=None):
    return SimpleNamespace(
        label=label,
        battle_modifiers=battle_modifiers or {},
        active_in_battle=active_in_battle,
        stat_modifiers=stat_modifiers or {},
    )


class FakeDb:
    def __init__(self, templates):
        self.templates = templates

    def get(self, _model, tid):
        return self.templates.get(tid)


def test_inventory_item_grants_effect_when_equipped():
    inv = _item("Helm", effect_id=1, equipped="head")
    assert inventory_item_grants_effect(inv) is True


def test_inventory_item_grants_effect_when_passive_in_bag():
    inv = _item("Ring", effect_id=2, passive=True)
    assert inventory_item_grants_effect(inv) is True


def test_inventory_item_does_not_grant_when_unequipped_non_passive():
    inv = _item("Sword", effect_id=3)
    assert inventory_item_grants_effect(inv) is False


def test_effective_stats_includes_equipped_item_effect():
    db = FakeDb({1: _effect(stat_modifiers={"strength": 2})})
    inv = _item("Helm", effect_id=1, equipped="head")
    stats = effective_stats({"strength": 8}, [inv], [], active_item_effect_templates(db, [inv]))
    assert stats["strength"] == 10


def test_party_allsight_from_item_effect():
    db = FakeDb({5: _effect(label="Allsight I", battle_modifiers={"allsight": 1})})
    inv = _item("Lens", effect_id=5, equipped="necklace")
    character = SimpleNamespace(
        temporary_effects=[],
        inventory_items=[inv],
    )
    assert party_allsight_level_from_characters([character], db) == 1
    assert effect_allsight_level(db.get(None, 5)) == 1
