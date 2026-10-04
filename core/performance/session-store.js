const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const MAX_SAMPLES = 7200;
const MAX_EVENTS = 500;
const SAMPLE_INTERVAL = 10000;

class SessionStore {
  constructor({ directory, appVersion, now = Date.now, onChange = () => {} }) {
    this.directory = directory;
    this.appVersion = appVersion;
    this.now = now;
    this.onChange = onChange;
    this.records = new Map();
    this.active = null;
    this.pending = new Map();
    this.queue = Promise.resolve();
    this.error = null;
    this.ready = false;
    this.lastSampleAt = 0;
    this.seenEvents = new Set();
  }
  async init() {
    await fs.mkdir(this.directory, { recursive: true });
    const names = await fs.readdir(this.directory);
    for (const name of names.filter(name => /^[0-9a-f-]{36}\.json$/.test(name))) {
      try {
        const data = JSON.parse(await fs.readFile(path.join(this.directory, name), 'utf8'));
        if (data.schemaVersion !== 1 || `${data.id}.json` !== name || !data.game || !data.stats || !Array.isArray(data.samples) || !Array.isArray(data.events)) {
          throw new Error('Invalid session format');
        }
        // A running record left by a crash is closed at the last known sample,
        // not extended across the period when VoidCore was not running.
        if (data.status === 'active') {
          data.status = 'interrupted';
          data.endedAt = data.lastSeenAt;
          data.endReason = 'unexpected-exit';
          this.markDirty(data);
        }
        this.records.set(data.id, this.summary(data));
      } catch (error) {
        // Preserve invalid files for recovery; never silently overwrite them.
        this.error = 'Некоторые записи истории не удалось прочитать. Исходные файлы сохранены.';
      }
    }
    await this.flush();
    this.ready = true;
  }
  summary(data) {
    const count = data.stats.validSamples;
    return { id: data.id, game: data.game, appVersion: data.appVersion, status: data.status,
      startedAt: data.startedAt, endedAt: data.endedAt, lastSeenAt: data.lastSeenAt,
      durationMs: Math.max(0, (data.endedAt ?? data.lastSeenAt) - data.startedAt),
      validSamples: count, averageSampledFps: count ? data.stats.fpsSum / count : null,
      minSampledFps: count ? data.stats.fpsMin : null, maxSampledFps: count ? data.stats.fpsMax : null,
      averageSampledFrameTime: data.stats.frameTimeCount ? data.stats.frameTimeSum / data.stats.frameTimeCount : null,
      drops: data.stats.drops, suppressed: data.stats.suppressed, endReason: data.endReason };
  }
  markDirty(data) {
    this.pending.set(data.id, { data, revision: randomUUID() });
    this.records.set(data.id, this.summary(data));
  }
  begin(game) {
    const timestamp = this.now();
    this.active = { schemaVersion: 1, id: randomUUID(), appVersion: this.appVersion,
      game: { name: game.name, pid: game.pid, platform: game.platform || null, processStartedAt: game.startedAt || null },
      status: 'active', startedAt: timestamp, endedAt: null, lastSeenAt: timestamp, endReason: null,
      computer: null, stats: { validSamples: 0, fpsSum: 0, fpsMin: null, fpsMax: null,
        frameTimeSum: 0, frameTimeCount: 0, drops: 0, suppressed: 0 }, samples: [], events: [] };
    this.lastSampleAt = 0;
    this.seenEvents.clear();
    this.markDirty(this.active);
  }
  finish(reason = 'game-closed', timestamp = this.now()) {
    if (!this.active) return;
    this.active.status = 'completed';
    this.active.endedAt = timestamp;
    this.active.endReason = reason;
    this.markDirty(this.active);
    this.active = null;
    this.seenEvents.clear();
  }
  async ingest(result) {
    if (!this.ready) return;
    const game = result.active ? result.game : null;
    const current = this.active;
    const switched = current && game && (current.game.pid !== game.pid || current.game.name !== game.name ||
      (game.startedAt && current.game.processStartedAt !== game.startedAt));
    const ended = current && (!game || switched);
    if (ended) this.finish(switched ? 'game-switched' : 'game-closed');
    const started = game && !this.active;
    if (started) this.begin(game);
    if (this.active) {
      const data = this.active;
      data.lastSeenAt = this.now();
      if (!data.computer && result.computerProfile) data.computer = result.computerProfile;
      const sample = result.sample;
      const valid = sample && sample.game?.pid === game.pid && Number.isFinite(sample.fps) && sample.fps > 0 &&
        sample.capture?.running === true && !sample.capture?.stale;
      if (valid) {
        data.stats.validSamples++;
        data.stats.fpsSum += sample.fps;
        data.stats.fpsMin = data.stats.fpsMin === null ? sample.fps : Math.min(data.stats.fpsMin, sample.fps);
        data.stats.fpsMax = data.stats.fpsMax === null ? sample.fps : Math.max(data.stats.fpsMax, sample.fps);
        if (Number.isFinite(sample.frameTime) && sample.frameTime > 0) {
          data.stats.frameTimeSum += sample.frameTime;
          data.stats.frameTimeCount++;
        }
      }
      if (sample && this.now() - this.lastSampleAt >= SAMPLE_INTERVAL) {
        data.samples.push(sample);
        if (data.samples.length > MAX_SAMPLES) data.samples.shift();
        this.lastSampleAt = this.now();
      }
      for (const [type, events] of [['drop', result.diagnostics || []], ['suppressed', result.suppressedEvents || []]]) {
        for (const event of events) {
          if (!event.id || event.game?.pid !== game.pid || event.timestamp < data.startedAt) continue;
          const key = `${type}:${event.id}`;
          if (this.seenEvents.has(key)) continue;
          this.seenEvents.add(key);
          if (this.seenEvents.size > 1000) this.seenEvents.delete(this.seenEvents.values().next().value);
          data.stats[type === 'drop' ? 'drops' : 'suppressed']++;
          data.events.push({ type, ...event });
          if (data.events.length > MAX_EVENTS) data.events.shift();
        }
      }
      this.markDirty(data);
    }
    // Session boundaries are persisted immediately; ordinary updates flush on a timer.
    if (started || ended) await this.flush();
  }
  flush() {
    this.queue = this.queue.then(async () => {
      for (const [id, entry] of [...this.pending]) {
        const serialized = JSON.stringify(entry.data);
        const destination = path.join(this.directory, `${id}.json`);
        const temporary = `${destination}.tmp`;
        try {
          const file = await fs.open(temporary, 'w');
          try { await file.writeFile(serialized, 'utf8'); await file.sync(); }
          finally { await file.close(); }
          await fs.rename(temporary, destination);
          if (this.pending.get(id) === entry) this.pending.delete(id);
        } catch (error) {
          this.error = 'Историю не удалось сохранить. Проверьте свободное место и права доступа.';
        }
      }
      this.onChange({ error: this.error });
    });
    return this.queue;
  }
  list({ offset = 0, limit = 20 } = {}) {
    offset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
    limit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 50)) : 20;
    const items = [...this.records.values()].sort((a,b) => b.startedAt - a.startedAt);
    return { items: items.slice(offset, offset + limit), total: items.length, offset, limit, error: this.error };
  }
  async get(id) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id) || !this.records.has(id)) throw new Error('Сессия не найдена.');
    if (this.active?.id === id) return { ...JSON.parse(JSON.stringify(this.active)), summary: this.summary(this.active) };
    const data = JSON.parse(await fs.readFile(path.join(this.directory, `${id}.json`), 'utf8'));
    return { ...data, summary: this.summary(data) };
  }
  async close() { this.finish('app-closed'); await this.flush(); }
}
module.exports = { SessionStore };
