import { db } from '../db.js';

/**
 * Base des giveaways (repris d Orbit) : giveaways, participations, programmation,
 * reclamations, roles temporaires et invitations. Tables creees au demarrage.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS giveaways (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id          TEXT NOT NULL,
  channel_id        TEXT NOT NULL,
  message_id        TEXT,
  host_id           TEXT NOT NULL,
  prize             TEXT NOT NULL,
  winners           INTEGER NOT NULL,
  min_level         INTEGER NOT NULL DEFAULT 0,
  required_role     TEXT,
  ends_at           INTEGER NOT NULL,
  ended             INTEGER NOT NULL DEFAULT 0,
  winner_ids        TEXT,
  description       TEXT NOT NULL DEFAULT '',
  options           TEXT NOT NULL DEFAULT '{}',
  ended_at          INTEGER,
  own_channel       INTEGER NOT NULL DEFAULT 0,
  reminded          INTEGER NOT NULL DEFAULT 0,
  delete_channel_at INTEGER,
  schedule_id       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_giveaways_due ON giveaways (ended, ends_at);
CREATE INDEX IF NOT EXISTS idx_giveaways_message ON giveaways (message_id);

CREATE TABLE IF NOT EXISTS giveaway_entries (
  giveaway_id INTEGER NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  PRIMARY KEY (giveaway_id, user_id)
);

CREATE TABLE IF NOT EXISTS giveaway_schedules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  host_id      TEXT NOT NULL,
  prize        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  winners      INTEGER NOT NULL,
  duration_ms  INTEGER NOT NULL,
  options      TEXT NOT NULL DEFAULT '{}',
  next_run_at  INTEGER NOT NULL,
  repeat_days  INTEGER NOT NULL DEFAULT 0,
  channel_id   TEXT NOT NULL DEFAULT '',
  channel_name TEXT NOT NULL DEFAULT '',
  category_id  TEXT NOT NULL DEFAULT '',
  read_only    INTEGER NOT NULL DEFAULT 1,
  runs         INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  last_error   TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedules_due ON giveaway_schedules (active, next_run_at);

CREATE TABLE IF NOT EXISTS giveaway_claims (
  giveaway_id INTEGER NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  deadline    INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  PRIMARY KEY (giveaway_id, user_id)
);

CREATE TABLE IF NOT EXISTS invite_joins (
  guild_id           TEXT NOT NULL,
  user_id            TEXT NOT NULL,
  inviter_id         TEXT,
  code               TEXT,
  account_created_at INTEGER NOT NULL,
  joined_at          INTEGER NOT NULL,
  left_at            INTEGER,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_invites_inviter ON invite_joins (guild_id, inviter_id);

CREATE TABLE IF NOT EXISTS temp_roles (
  guild_id  TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  role_id   TEXT NOT NULL,
  remove_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, role_id)
);
`);

export class GiveawayStore {
    db;
    schedules;
    claims;
    tempRoles;
    constructor(db) {
        this.db = db;
        this.schedules = new ScheduleStore(db);
        this.claims = new ClaimStore(db);
        this.tempRoles = new TempRoleStore(db);
    }
    create(data) {
        const options = data.options ?? {
            minLevel: data.minLevel ?? 0,
            requiredRoleIds: data.requiredRole ? [data.requiredRole] : [],
        };
        const o = options;
        const r = this.db
            .prepare(`INSERT INTO giveaways (guild_id, channel_id, host_id, prize, description, winners, min_level, required_role, options, ends_at, own_channel, schedule_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(data.guildId, data.channelId, data.hostId, data.prize, data.description ?? '', data.winners, o.minLevel ?? 0, o.requiredRoleIds?.[0] ?? null, JSON.stringify(options), data.endsAt, data.ownChannel ? 1 : 0, data.scheduleId ?? null);
        return this.get(Number(r.lastInsertRowid));
    }
    get(id) {
        return this.db.prepare('SELECT * FROM giveaways WHERE id = ?').get(id);
    }
    byMessage(messageId) {
        return this.db.prepare('SELECT * FROM giveaways WHERE message_id = ?').get(messageId);
    }
    setMessage(id, messageId) {
        this.db.prepare('UPDATE giveaways SET message_id = ? WHERE id = ?').run(messageId, id);
    }
    hasEntry(id, userId) {
        return !!this.db.prepare('SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?').get(id, userId);
    }
    /** Retourne false si la personne participait déjà. */
    addEntry(id, userId) {
        const r = this.db.prepare('INSERT OR IGNORE INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)').run(id, userId);
        return Number(r.changes) > 0;
    }
    /** Retourne false si la personne ne participait pas. */
    removeEntry(id, userId) {
        const r = this.db.prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?').run(id, userId);
        return Number(r.changes) > 0;
    }
    /** Inscrit ou désinscrit. Retourne true si la personne est maintenant inscrite. */
    toggleEntry(id, userId) {
        if (this.removeEntry(id, userId))
            return false;
        this.addEntry(id, userId);
        return true;
    }
    entries(id) {
        return this.db.prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?').all(id).map((r) => r.user_id);
    }
    entryCount(id) {
        return this.db.prepare('SELECT COUNT(*) AS c FROM giveaway_entries WHERE giveaway_id = ?').get(id).c;
    }
    due(now = Date.now()) {
        return this.db.prepare('SELECT * FROM giveaways WHERE ended = 0 AND ends_at <= ?').all(now);
    }
    /** Marque le giveaway terminé et enregistre la liste complète des gagnants. */
    finish(id, winnerIds) {
        this.db
            .prepare('UPDATE giveaways SET ended = 1, winner_ids = ?, ended_at = COALESCE(ended_at, ?) WHERE id = ?')
            .run(JSON.stringify(winnerIds), Date.now(), id);
    }
    /** Modification d'un giveaway (seuls les champs fournis changent). */
    update(id, f) {
        const sets = [];
        const values = [];
        if (f.prize !== undefined)
            sets.push('prize = ?'), values.push(f.prize);
        if (f.description !== undefined)
            sets.push('description = ?'), values.push(f.description);
        if (f.winners !== undefined)
            sets.push('winners = ?'), values.push(f.winners);
        if (f.endsAt !== undefined)
            sets.push('ends_at = ?', 'reminded = 0'), values.push(f.endsAt);
        if (f.hostId !== undefined)
            sets.push('host_id = ?'), values.push(f.hostId);
        if (f.options !== undefined)
            sets.push('options = ?'), values.push(JSON.stringify(f.options));
        if (!sets.length)
            return;
        this.db.prepare(`UPDATE giveaways SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
    }
    /** Gagnants d'un giveaway encore en cours (drops). */
    setWinnerIds(id, winnerIds) {
        this.db.prepare('UPDATE giveaways SET winner_ids = ? WHERE id = ?').run(JSON.stringify(winnerIds), id);
    }
    winners(row) {
        try {
            const list = JSON.parse(row.winner_ids ?? '[]');
            return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
        }
        catch {
            return [];
        }
    }
    delete(id) {
        this.db.prepare('DELETE FROM giveaways WHERE id = ?').run(id);
    }
    /** Giveaways en cours pas encore rappelés (le délai de rappel est dans les options). */
    notReminded() {
        return this.db.prepare('SELECT * FROM giveaways WHERE ended = 0 AND reminded = 0').all();
    }
    markReminded(id) {
        this.db.prepare('UPDATE giveaways SET reminded = 1 WHERE id = ?').run(id);
    }
    setDeleteChannelAt(id, at) {
        this.db.prepare('UPDATE giveaways SET delete_channel_at = ? WHERE id = ?').run(at, id);
    }
    dueChannelDeletes(now = Date.now()) {
        return this.db.prepare('SELECT * FROM giveaways WHERE delete_channel_at IS NOT NULL AND delete_channel_at <= ?').all(now);
    }
    /** Le salon du giveaway a été supprimé : on garde l'historique, sans message ni salon. */
    markChannelDeleted(id) {
        this.db.prepare('UPDATE giveaways SET message_id = NULL, own_channel = 0, delete_channel_at = NULL WHERE id = ?').run(id);
    }
    /** Tous les giveaways liés à un salon (quand le salon est supprimé à la main). */
    byChannel(channelId) {
        return this.db.prepare('SELECT * FROM giveaways WHERE channel_id = ?').all(channelId);
    }
    active(guildId) {
        return this.db.prepare('SELECT * FROM giveaways WHERE guild_id = ? AND ended = 0 ORDER BY ends_at ASC').all(guildId);
    }
    forGuild(guildId, limit = 20) {
        return this.db.prepare('SELECT * FROM giveaways WHERE guild_id = ? ORDER BY id DESC LIMIT ?').all(guildId, limit);
    }
}
export class ScheduleStore {
    db;
    constructor(db) {
        this.db = db;
    }
    create(data) {
        const r = this.db
            .prepare(`INSERT INTO giveaway_schedules
          (guild_id, host_id, prize, description, winners, duration_ms, options, next_run_at, repeat_days, channel_id, channel_name, category_id, read_only, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(data.guildId, data.hostId, data.prize, data.description, data.winners, data.durationMs, JSON.stringify(data.options ?? {}), data.startAt, data.repeatDays, data.channelId, data.channelName, data.categoryId, data.readOnly ? 1 : 0, Date.now());
        return this.get(Number(r.lastInsertRowid));
    }
    get(id) {
        return this.db.prepare('SELECT * FROM giveaway_schedules WHERE id = ?').get(id);
    }
    active(guildId) {
        return this.db.prepare('SELECT * FROM giveaway_schedules WHERE guild_id = ? AND active = 1 ORDER BY next_run_at ASC').all(guildId);
    }
    due(now = Date.now()) {
        return this.db.prepare('SELECT * FROM giveaway_schedules WHERE active = 1 AND next_run_at <= ?').all(now);
    }
    /** Après un lancement : prochaine date (récurrent) ou désactivation (une seule fois). */
    ran(id, nextRunAt) {
        if (nextRunAt)
            this.db.prepare('UPDATE giveaway_schedules SET runs = runs + 1, next_run_at = ?, last_error = NULL WHERE id = ?').run(nextRunAt, id);
        else
            this.db.prepare('UPDATE giveaway_schedules SET runs = runs + 1, active = 0, last_error = NULL WHERE id = ?').run(id);
    }
    failed(id, error, retryAt) {
        if (retryAt)
            this.db.prepare('UPDATE giveaway_schedules SET last_error = ?, next_run_at = ? WHERE id = ?').run(error, retryAt, id);
        else
            this.db.prepare('UPDATE giveaway_schedules SET last_error = ?, active = 0 WHERE id = ?').run(error, id);
    }
    cancel(id) {
        this.db.prepare('UPDATE giveaway_schedules SET active = 0 WHERE id = ?').run(id);
    }
}
export class ClaimStore {
    db;
    constructor(db) {
        this.db = db;
    }
    add(giveawayId, userId, deadline) {
        this.db
            .prepare(`INSERT OR REPLACE INTO giveaway_claims (giveaway_id, user_id, deadline, status) VALUES (?, ?, ?, 'pending')`)
            .run(giveawayId, userId, deadline);
    }
    get(giveawayId, userId) {
        return this.db.prepare('SELECT * FROM giveaway_claims WHERE giveaway_id = ? AND user_id = ?').get(giveawayId, userId);
    }
    forGiveaway(giveawayId) {
        return this.db.prepare('SELECT * FROM giveaway_claims WHERE giveaway_id = ?').all(giveawayId);
    }
    setStatus(giveawayId, userId, status) {
        this.db.prepare('UPDATE giveaway_claims SET status = ? WHERE giveaway_id = ? AND user_id = ?').run(status, giveawayId, userId);
    }
    expired(now = Date.now()) {
        return this.db.prepare(`SELECT * FROM giveaway_claims WHERE status = 'pending' AND deadline <= ?`).all(now);
    }
}
// ───────────────────────────── Rôles temporaires ─────────────────────────────
export class TempRoleStore {
    db;
    constructor(db) {
        this.db = db;
    }
    add(guildId, userId, roleId, removeAt) {
        this.db
            .prepare(`INSERT INTO temp_roles (guild_id, user_id, role_id, remove_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id, user_id, role_id) DO UPDATE SET remove_at = MAX(remove_at, excluded.remove_at)`)
            .run(guildId, userId, roleId, removeAt);
    }
    due(now = Date.now()) {
        return this.db.prepare('SELECT guild_id, user_id, role_id FROM temp_roles WHERE remove_at <= ?').all(now);
    }
    remove(guildId, userId, roleId) {
        this.db.prepare('DELETE FROM temp_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?').run(guildId, userId, roleId);
    }
}
export class InviteStore {
    db;
    constructor(db) {
        this.db = db;
    }
    /** Arrivée d'un membre (une seule ligne par membre : s'il revient, l'invitation est remplacée). */
    recordJoin(data) {
        this.db
            .prepare(`INSERT INTO invite_joins (guild_id, user_id, inviter_id, code, account_created_at, joined_at, left_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(guild_id, user_id) DO UPDATE SET
           inviter_id = excluded.inviter_id, code = excluded.code, joined_at = excluded.joined_at, left_at = NULL`)
            .run(data.guildId, data.userId, data.inviterId, data.code, data.accountCreatedAt, data.joinedAt);
    }
    recordLeave(guildId, userId, at = Date.now()) {
        this.db.prepare('UPDATE invite_joins SET left_at = ? WHERE guild_id = ? AND user_id = ? AND left_at IS NULL').run(at, guildId, userId);
    }
    /** `minAccountDays` : un invité dont le compte avait moins de X jours en arrivant ne compte pas. */
    counts(guildId, inviterId, minAccountDays) {
        const minAge = minAccountDays * 86_400_000;
        const r = this.db
            .prepare(`SELECT
           SUM(CASE WHEN left_at IS NULL AND joined_at - account_created_at >= ? THEN 1 ELSE 0 END) AS stayed,
           SUM(CASE WHEN left_at IS NOT NULL THEN 1 ELSE 0 END) AS left_count,
           SUM(CASE WHEN left_at IS NULL AND joined_at - account_created_at < ? THEN 1 ELSE 0 END) AS fake,
           COUNT(*) AS total
         FROM invite_joins WHERE guild_id = ? AND inviter_id = ? AND user_id != inviter_id`)
            .get(minAge, minAge, guildId, inviterId);
        return { stayed: r.stayed ?? 0, left: r.left_count ?? 0, fake: r.fake ?? 0, total: r.total };
    }
    top(guildId, minAccountDays, limit = 10) {
        return this.db
            .prepare(`SELECT inviter_id, COUNT(*) AS stayed FROM invite_joins
         WHERE guild_id = ? AND inviter_id IS NOT NULL AND user_id != inviter_id AND left_at IS NULL AND joined_at - account_created_at >= ?
         GROUP BY inviter_id ORDER BY stayed DESC LIMIT ?`)
            .all(guildId, minAccountDays * 86_400_000, limit);
    }
    inviterOf(guildId, userId) {
        const r = this.db.prepare('SELECT inviter_id FROM invite_joins WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
        return r?.inviter_id ?? null;
    }
}

export const giveaways = new GiveawayStore(db);
export const invites = new InviteStore(db);
