import fs from 'node:fs';
import path from 'node:path';
import {safeWriteFile} from './util.js';

const MAX_HISTORY = 500;

export class CommandHistory {
  private entries: string[] = [];
  private cursor = -1;
  private draft = '';

  constructor(private readonly file: string) {
    this.entries = loadHistory(file);
  }

  add(text: string): void {
    const normalized = text.replace(/\s+$/g, '');
    if (!normalized.trim()) return;
    if (this.entries[this.entries.length - 1] === normalized) {
      this.reset();
      return;
    }
    this.entries.push(normalized);
    if (this.entries.length > MAX_HISTORY) {
      this.entries = this.entries.slice(this.entries.length - MAX_HISTORY);
    }
    safeWriteFile(this.file, `${this.entries.map(entry => JSON.stringify(entry)).join('\n')}\n`);
    this.reset();
  }

  previous(currentDraft: string): string {
    if (!this.entries.length) return currentDraft;
    if (this.cursor < 0) {
      this.draft = currentDraft;
      this.cursor = this.entries.length - 1;
    } else {
      this.cursor = Math.max(0, this.cursor - 1);
    }
    return this.entries[this.cursor] || currentDraft;
  }

  next(): string {
    if (this.cursor < 0) return '';
    if (this.cursor < this.entries.length - 1) {
      this.cursor += 1;
      return this.entries[this.cursor] || '';
    }
    const draft = this.draft;
    this.reset();
    return draft;
  }

  reset(): void {
    this.cursor = -1;
    this.draft = '';
  }
}

export function defaultHistoryFile(globalDir: string): string {
  return path.join(globalDir, 'history.jsonl');
}

function loadHistory(file: string): string[] {
  try {
    if (!fs.existsSync(file)) return [];
    const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    return rows.map(row => {
      try {
        return String(JSON.parse(row));
      } catch {
        return row;
      }
    }).filter(row => row.trim()).slice(-MAX_HISTORY);
  } catch {
    return [];
  }
}
