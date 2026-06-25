from types import SimpleNamespace

from app.services.campaign_engine import random_item_pool


class FakeQuery:
    def __init__(self, items):
        self.items = items

    def filter(self, *args, **kwargs):
        return self

    def all(self):
        return self.items


class FakeDb:
    def __init__(self, items):
        self.items = items

    def query(self, _model):
        return FakeQuery(self.items)


def _template(name, tier, item_type, weapon_class=None):
    stats = {}
    if weapon_class:
        stats["weapon_class"] = weapon_class
    return SimpleNamespace(name=name, tier=tier, item_type=item_type, stats=stats)


def test_random_item_pool_filters_by_type():
    items = [
        _template("Leather Cap", 1, "head"),
        _template("Iron Helm", 1, "head"),
        _template("Rusty Sword", 1, "weapon", "melee"),
    ]
    db = FakeDb(items)
    pool = random_item_pool(db, 1, "head")
    assert {i.name for i in pool} == {"Leather Cap", "Iron Helm"}


def test_random_item_pool_weapon_melee_filter():
    items = [
        _template("Sword", 1, "weapon", "melee"),
        _template("Bow", 1, "weapon", "range"),
    ]
    db = FakeDb(items)
    pool = random_item_pool(db, 1, "weapon_melee")
    assert len(pool) == 1
    assert pool[0].name == "Sword"


def test_random_item_pool_empty_when_no_match():
    db = FakeDb([_template("Ring", 2, "ring")])
    assert random_item_pool(db, 1, "head") == []
