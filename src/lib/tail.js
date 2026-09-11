import { open, stat, mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { store } from '../db.js';

// Lecture incrementale d un fichier append-only, partagee par les flux que le
// bot en jeu alimente (paiements, soldes).
//
// Regle apprise a la dure : la derniere ligne peut etre en cours d ecriture.
// On ne la garde PAS en memoire, on laisse l offset avant elle et on la relit
// entiere au tour suivant. La memoriser tout en avancant l offset la comptait
// deux fois, et la memoriser sans persister la perdait au redemarrage.

export class Tailer {
  constructor({ file, key, pollMs = 2000, onLine }) {
    this.file = file;
    this.key = key;
    this.pollMs = pollMs;
    this.onLine = onLine;
    this.timer = null;
  }

  async start() {
    await mkdir(dirname(this.file), { recursive: true });
    await appendFile(this.file, '');
    this.timer = setInterval(() => this.tick().catch(() => {}), this.pollMs);
    this.timer.unref?.();
    await this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    const offset = Number(store.kvGet(this.key) ?? 0);
    let size;
    try {
      ({ size } = await stat(this.file));
    } catch {
      return;
    }
    const from = size < offset ? 0 : offset; // fichier tronque ou tourne
    if (size === from) return;

    const fh = await open(this.file, 'r');
    let chunk;
    try {
      const buf = Buffer.alloc(size - from);
      await fh.read(buf, 0, buf.length, from);
      chunk = buf.toString('utf8');
    } finally {
      await fh.close();
    }

    const lignes = chunk.split('\n');
    const partielle = lignes.pop() ?? '';
    store.kvSet(this.key, size - Buffer.byteLength(partielle, 'utf8'));

    for (const ligne of lignes) {
      const trimmed = ligne.trim();
      if (!trimmed) continue;
      let entree;
      try {
        entree = JSON.parse(trimmed);
      } catch {
        entree = trimmed;
      }
      try {
        this.onLine(entree);
      } catch (err) {
        console.error(`[tail] ${this.key} :`, err.message);
      }
    }
  }
}
