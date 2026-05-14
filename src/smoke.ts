import path from 'node:path';
import type {ServerCapabilities, SporeConfig} from './protocol.js';
import {saveConfig} from './config.js';
import {buildProjectContext} from './project-context.js';
import {SporeTransport} from './transport.js';
import {CLIENT_VERSION} from './version.js';

export interface SmokeResult {
  baseUrl: string;
  sessionId: string;
  capabilities: ServerCapabilities | null;
  historySeen: boolean;
}

export async function runSmoke(cfg: SporeConfig, cwd: string, opts: {
  timeoutMs?: number;
  write?: (line: string) => void;
} = {}): Promise<SmokeResult> {
  const write = opts.write || console.log;
  const timeoutMs = opts.timeoutMs ?? 2500;
  const transport = new SporeTransport(cfg);
  const sessionId = `cli-smoke:${cfg.connection.user}@${Date.now().toString(36)}`;

  try {
    write(`Smoke checking ${transport.baseUrl} as ${cfg.connection.user}...`);
    const capabilities = waitForFrame<ServerCapabilities>(transport, 'capabilities', timeoutMs);
    const history = waitForFrame(transport, 'chat:history', timeoutMs);

    await transport.authenticate();
    saveConfig(cfg);
    await transport.connect();
    write('Auth: ok');
    write('WebSocket: ok');

    const projectContext = buildProjectContext(cwd, 'execute', '');
    transport.send({
      type: 'session:start',
      sessionId,
      userName: cfg.connection.user,
      cwd,
      startedAt: new Date().toISOString(),
      clientVersion: CLIENT_VERSION,
      localTools: projectContext.localTools,
      projectContext
    });
    transport.send({type: 'chat:history-request', sessionId, userName: cfg.connection.user});

    const caps = await capabilities;
    write(caps ? `Capabilities: projectContext=${caps.projectContext ? 'yes' : 'no'} sporeVersion=${caps.sporeVersion || 'unknown'}` : 'Capabilities: not received before timeout');
    const historyFrame = await history;
    write(historyFrame ? 'Session/history frames: ok' : 'Session/history frames: no history response before timeout');

    write('');
    write('Manual beta checklist for a real agent turn:');
    write('  1. Start: npm run dev');
    write('  2. Send a short chat and confirm streamed assistant text + usage line.');
    write('  3. Ask for local tools: read_file, edit_file, exec, bg_list, bg_tail.');
    write('  4. Ask for a server-owned tool and confirm Core handles fallback.');
    write('  5. Ask the agent to use ask_user with open, single, and multi responses.');
    write('  6. Run /plan, approve/revise a plan, then execute it.');
    write('  7. Trigger approval and test y/Enter, a, and n/Esc.');
    write('  8. Run a long command and confirm bg_tail follows the adopted process.');

    return {baseUrl: transport.baseUrl, sessionId, capabilities: caps, historySeen: Boolean(historyFrame)};
  } finally {
    transport.close();
  }
}

function waitForFrame<T extends {type: string} = {type: string}>(transport: SporeTransport, type: string, timeoutMs: number): Promise<T | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      transport.off('frame', onFrame);
      resolve(null);
    }, timeoutMs);
    const onFrame = (frame: {type: string}) => {
      if (frame.type !== type) return;
      clearTimeout(timer);
      transport.off('frame', onFrame);
      resolve(frame as T);
    };
    transport.on('frame', onFrame);
  });
}

export function smokeChecklistMarkdown(packageName = '@vibe-coalition/spore-code'): string {
  return [
    '# Spore Code npm Beta Smoke',
    '',
    'Local dev:',
    '',
    '```sh',
    'npm run dev -- doctor',
    'npm run dev -- smoke',
    'npm run dev',
    '```',
    '',
    'Package smoke:',
    '',
    '```sh',
    'npm run build',
    'npm pack',
    `npm install -g ./${packageName.replace('/', '-')}-*.tgz`,
    'spore --version',
    'spore doctor',
    'spore smoke',
    '```',
    '',
    `One-off beta: \`npx ${packageName}@beta\``,
    '',
    `Run from: \`${path.basename(process.cwd()) || process.cwd()}\``
  ].join('\n');
}
