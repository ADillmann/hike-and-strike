/** Format structured battle log entries for the active locale. */

type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

export interface BattleLogEntry {
  message: string;
  timestamp?: string;
  key?: string;
  params?: Record<string, unknown>;
}

function appendCombatExtras(msg: string, params: Record<string, unknown>, t: TranslateFn): string {
  let out = msg;
  const shield = Number(params.shield_abs || 0);
  const guard = Number(params.guard_red || 0);
  if (shield) out += ` ${t('battle_log.shield_abs', { n: shield })}`;
  if (guard) out += ` ${t('battle_log.guard_red', { n: guard })}`;
  if (params.defeated) {
    const name = String(params.target || params.name || '');
    out += ` ${t('battle_log.defeated', { name })}`;
  }
  const splash = params.splash;
  if (Array.isArray(splash)) {
    for (const event of splash) {
      if (!event || typeof event !== 'object') continue;
      const e = event as Record<string, unknown>;
      const key = String(e.key || 'battle_log.splash_hit');
      out += ` ${t(key, {
        name: String(e.name || ''),
        damage: Number(e.damage || 0),
        amount: Number(e.amount || 0),
      })}`;
      const sAbs = Number(e.shield_abs || 0);
      if (sAbs) out += ` ${t('battle_log.splash_shield', { n: sAbs })}`;
      if (e.defeated) out += ` ${t('battle_log.falls', { name: String(e.name || '') })}`;
    }
  }
  return out;
}

function formatSupportDetails(details: unknown, t: TranslateFn): string {
  if (!Array.isArray(details)) return '';
  return details
    .map((d) => {
      if (!d || typeof d !== 'object') return '';
      const row = d as Record<string, unknown>;
      const name = String(row.name || '');
      const detailKey = String(row.detail_key || '');
      const detailParams = (row.detail_params || {}) as Record<string, string | number>;
      const detail = detailKey ? t(detailKey, detailParams) : '';
      return t('battle_log.support_detail', { name, detail });
    })
    .filter(Boolean)
    .join('; ');
}

function translateLegacySplashSuffix(rest: string, t: TranslateFn): string {
  let out = '';
  let remaining = rest;
  const splashHit = /\s*Splash hits (.+?) for (\d+)!(?:\s*\((\d+) absorbed\))?(?:\s*(.+?) falls!)?/g;
  let m: RegExpExecArray | null;
  while ((m = splashHit.exec(rest)) !== null) {
    out += ` ${t('battle_log.splash_hit', { name: m[1], damage: Number(m[2]) })}`;
    if (m[3]) out += ` ${t('battle_log.splash_shield', { n: Number(m[3]) })}`;
    if (m[4]) out += ` ${t('battle_log.falls', { name: m[4] })}`;
  }
  const healSplash = /\s*(.+?) \+(\d+) HP \(splash\)!/g;
  while ((m = healSplash.exec(rest)) !== null) {
    out += ` ${t('battle_log.heal_splash', { name: m[1], amount: Number(m[2]) })}`;
  }
  // If nothing matched, keep original suffix
  if (!out && remaining.trim()) return remaining;
  return out;
}

/** Best-effort translation of English log lines saved before structured keys existed. */
function translateLegacyMessage(message: string, t: TranslateFn): string {
  let m: RegExpMatchArray | null;

  if (message === 'Pre-battle positioning skipped.') {
    return t('battle_log.prebattle_skipped');
  }
  if (message === 'The Master ended the battle.') {
    return t('battle_log.master_ended');
  }

  m = message.match(/^(.+?) repositions before battle\.$/);
  if (m) return t('battle_log.reposition', { actor: m[1] });

  m = message.match(/^Battle begins! (.+?) acts first\.$/);
  if (m) return t('battle_log.battle_begins', { actor: m[1] });

  m = message.match(/^(.+?)'s turn\.$/);
  if (m) return t('battle_log.turn', { actor: m[1] });

  m = message.match(/^(.+?) cannot reach anyone and waits\.$/);
  if (m) return t('battle_log.cannot_reach', { actor: m[1] });

  m = message.match(/^(.+?) waits\.$/);
  if (m) return t('battle_log.wait', { actor: m[1] });

  m = message.match(/^(.+?) moves to \((\d+), (\d+)\)\.$/);
  if (m) return t('battle_log.move', { actor: m[1], x: Number(m[2]), y: Number(m[3]) });

  m = message.match(/^(.+?) moves toward the party \((\d+), (\d+)\)\.$/);
  if (m) return t('battle_log.enemy_move', { actor: m[1], x: Number(m[2]), y: Number(m[3]) });

  m = message.match(/^(.+?) takes a guard stance \(−(\d+)% damage until next turn\)\.$/);
  if (m) return t('battle_log.guard', { actor: m[1], pct: Number(m[2]) });

  m = message.match(
    /^(.+?) charges (\d+) cell\(s\) and attacks (.+?) for (\d+) damage!(.*)$/,
  );
  if (m) {
    return appendCombatExtrasFromLegacyTail(
      t('battle_log.melee_charge', { actor: m[1], cells: Number(m[2]), target: m[3], damage: Number(m[4]) }),
      m[5],
      m[3],
      t,
    );
  }

  m = message.match(/^(.+?) attacks (.+?) for (\d+) damage!(.*)$/);
  if (m) {
    return appendCombatExtrasFromLegacyTail(
      t('battle_log.melee_attack', { actor: m[1], target: m[2], damage: Number(m[3]) }),
      m[4],
      m[2],
      t,
    );
  }

  m = message.match(/^(.+?) shoots (.+?) for (\d+) damage!(.*)$/);
  if (m) {
    return appendCombatExtrasFromLegacyTail(
      t('battle_log.ranged_attack', { actor: m[1], target: m[2], damage: Number(m[3]) }),
      m[4],
      m[2],
      t,
    );
  }

  m = message.match(
    /^(.+?) charges (\d+) cell\(s\) and uses (.+?) on (.+?) for (\d+) damage!(.*)$/,
  );
  if (m) {
    return appendCombatExtrasFromLegacyTail(
      t('battle_log.skill_melee_charge', {
        actor: m[1],
        cells: Number(m[2]),
        skill: m[3],
        target: m[4],
        damage: Number(m[5]),
      }),
      m[6],
      m[4],
      t,
    );
  }

  m = message.match(/^(.+?) uses (.+?) \(range\) on (.+?) for (\d+) damage!(.*)$/);
  if (m) {
    return appendCombatExtrasFromLegacyTail(
      t('battle_log.skill_range', {
        actor: m[1],
        skill: m[2],
        target: m[3],
        damage: Number(m[4]),
      }),
      m[5],
      m[3],
      t,
    );
  }

  m = message.match(/^(.+?) uses (.+?) on (.+?) for (\d+) HP!(.*)$/);
  if (m) {
    let out = t('battle_log.skill_heal', {
      actor: m[1],
      skill: m[2],
      target: m[3],
      heal: Number(m[4]),
    });
    out += translateLegacySplashSuffix(m[5] || '', t);
    return out;
  }

  m = message.match(/^(.+?) uses (.+?) on (.+?) for (\d+) damage!(.*)$/);
  if (m) {
    return appendCombatExtrasFromLegacyTail(
      t('battle_log.skill_melee', {
        actor: m[1],
        skill: m[2],
        target: m[3],
        damage: Number(m[4]),
      }),
      m[5],
      m[3],
      t,
    );
  }

  m = message.match(/^(.+?) uses (.+?) on (.+?) for (\d+) HP!(.*)$/);
  if (m) {
    // item use shares similar shape; prefer use_item wording when no splash of heal type
    return t('battle_log.use_item', {
      actor: m[1],
      item: m[2],
      target: m[3],
      heal: Number(m[4]),
    }) + translateLegacySplashSuffix(m[5] || '', t);
  }

  m = message.match(/^(.+?) heals (.+?) for (\d+) HP!$/);
  if (m) {
    return t('battle_log.enemy_heal', { actor: m[1], target: m[2], heal: Number(m[3]) });
  }

  m = message.match(
    /^(.+?) charges (\d+) cell\(s\) and casts (.+?) on (.+?) for (\d+) damage!(.*)$/,
  );
  if (m) {
    return appendCombatExtrasFromLegacyTail(
      t('battle_log.enemy_skill_melee_charge', {
        actor: m[1],
        cells: Number(m[2]),
        skill: m[3],
        target: m[4],
        damage: Number(m[5]),
      }),
      m[6],
      m[4],
      t,
    );
  }

  m = message.match(/^(.+?) casts (.+?) on (.+?) for (\d+) damage!(.*)$/);
  if (m) {
    return appendCombatExtrasFromLegacyTail(
      t('battle_log.enemy_skill_range', {
        actor: m[1],
        skill: m[2],
        target: m[3],
        damage: Number(m[4]),
      }),
      m[5],
      m[3],
      t,
    );
  }

  return message;
}

function appendCombatExtrasFromLegacyTail(
  base: string,
  tail: string,
  targetName: string,
  t: TranslateFn,
): string {
  let out = base;
  const shield = tail.match(/\((\d+) absorbed by shield\)/);
  if (shield) out += ` ${t('battle_log.shield_abs', { n: Number(shield[1]) })}`;
  const guard = tail.match(/\((\d+) reduced by guard\)/) || tail.match(/\(guard reduced (\d+)\)/);
  if (guard) out += ` ${t('battle_log.guard_red', { n: Number(guard[1]) })}`;
  if (tail.includes(`${targetName} is defeated!`)) {
    out += ` ${t('battle_log.defeated', { name: targetName })}`;
  }
  out += translateLegacySplashSuffix(tail, t);
  return out;
}

export function formatBattleLogMessage(entry: BattleLogEntry, t: TranslateFn): string {
  if (!entry.key) {
    return translateLegacyMessage(entry.message, t);
  }
  const params = { ...(entry.params || {}) };
  const flat: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      flat[k] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
    }
  }

  if (entry.key === 'battle_log.skill_support' || entry.key === 'battle_log.skill_support_party') {
    flat.details = formatSupportDetails(params.details, t);
  }

  let msg = t(entry.key, flat);
  msg = appendCombatExtras(msg, params, t);
  return msg;
}
