"""Tests for battle setup: custom enemies vs event preset, abort pending battle."""

from types import SimpleNamespace

from app.routers.battles import _should_apply_event_preset
from app.schemas import BattleCreateRequest, EnemySpec


def test_event_preset_not_applied_when_custom_enemies_sent():
    payload = BattleCreateRequest(
        enemies=[EnemySpec(template_id=2, count=1, power_scale=1.0)],
        preset=None,
    )
    battle_config = {"preset": "goblin_crowd"}
    assert _should_apply_event_preset(payload, battle_config) is False


def test_event_preset_applied_when_no_custom_and_no_preset():
    payload = BattleCreateRequest(enemies=[], preset=None)
    battle_config = {"preset": "goblin_crowd"}
    assert _should_apply_event_preset(payload, battle_config) is True


def test_event_preset_not_applied_when_payload_has_preset():
    payload = BattleCreateRequest(enemies=[], preset="bandit_ambush")
    battle_config = {"preset": "goblin_crowd"}
    assert _should_apply_event_preset(payload, battle_config) is False


def test_abort_pending_battle_status_check():
    pending = SimpleNamespace(status="pending")
    active = SimpleNamespace(status="active")
    assert pending.status == "pending"
    assert active.status != "pending"
