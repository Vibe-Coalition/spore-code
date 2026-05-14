import {spawn, type ChildProcess} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {ensureDir} from '../util.js';
import {truncateOutput} from './common.js';

export interface Proc {
  id: number;
  command: string;
  cwd: string;
  child: ChildProcess;
  logFile: string;
  startedAt: number;
  running: boolean;
  exitCode: number | null;
  output: string[];
}

export class BackgroundManager {
  private nextId = 1;
  private readonly procs = new Map<number, Proc>();

  constructor(private readonly logDir: string) {}

  launch(command: string, cwd: string): Proc {
    ensureDir(this.logDir);
    const id = this.nextId++;
    const logFile = path.join(this.logDir, `bg-${id}-${Date.now()}.log`);
    const shell = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
    const child = spawn(command, {cwd, shell, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    const proc = this.track(id, command, cwd, child, logFile, [], true);
    return proc;
  }

  adopt(command: string, cwd: string, child: ChildProcess, logFile: string, initialOutput: string[] = []): Proc {
    ensureDir(this.logDir);
    const id = this.nextId++;
    const resolvedLog = logFile || path.join(this.logDir, `bg-${id}-${Date.now()}.log`);
    return this.track(id, command, cwd, child, resolvedLog, initialOutput, false);
  }

  private track(id: number, command: string, cwd: string, child: ChildProcess, logFile: string, initialOutput: string[], attachStreams: boolean): Proc {
    const proc: Proc = {
      id,
      command,
      cwd,
      child,
      logFile,
      startedAt: Date.now(),
      running: child.exitCode === null,
      exitCode: typeof child.exitCode === 'number' ? child.exitCode : null,
      output: [...initialOutput].slice(-500)
    };
    if (attachStreams) {
      const append = (chunk: Buffer) => this.recordOutput(proc, chunk.toString());
      child.stdout?.on('data', append);
      child.stderr?.on('data', append);
    }
    child.on('exit', code => {
      proc.running = false;
      proc.exitCode = code ?? -1;
      fs.appendFileSync(logFile, `\n# Exit: ${proc.exitCode}\n`);
    });
    this.procs.set(id, proc);
    return proc;
  }

  recordOutput(proc: Proc, text: string, writeLog = true): void {
    if (writeLog) fs.appendFileSync(proc.logFile, text);
    for (const line of text.split(/\r?\n/)) {
      if (line) proc.output.push(line);
    }
    if (proc.output.length > 500) proc.output.splice(0, proc.output.length - 500);
  }

  list(): Record<string, unknown>[] {
    return [...this.procs.values()].map(p => ({
      id: p.id,
      command: p.command,
      running: p.running,
      exitCode: p.exitCode,
      elapsedMs: Date.now() - p.startedAt,
      logFile: p.logFile
    }));
  }

  tail(id: number, lines = 80): Record<string, unknown> {
    const proc = this.procs.get(id);
    if (!proc) return {error: `Process #${id} not found`};
    return {
      ok: true,
      id,
      running: proc.running,
      exitCode: proc.exitCode,
      output: truncateOutput(proc.output.slice(-lines).join('\n'), 12_000),
      logFile: proc.logFile
    };
  }

  kill(id: number): Record<string, unknown> {
    const proc = this.procs.get(id);
    if (!proc) return {error: `Process #${id} not found`};
    if (proc.running) proc.child.kill('SIGTERM');
    return {ok: true, id, killed: true};
  }
}
