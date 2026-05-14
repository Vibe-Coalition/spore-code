import type {ServerCapabilities, SporeConfig} from './protocol.js';
import {saveConfig} from './config.js';
import {SporeTransport} from './transport.js';

export interface DoctorResult {
  baseUrl: string;
  capabilities: ServerCapabilities | null;
}

export async function runDoctor(cfg: SporeConfig, opts: {
  timeoutMs?: number;
  write?: (line: string) => void;
} = {}): Promise<DoctorResult> {
  const write = opts.write || console.log;
  const transport = new SporeTransport(cfg);
  try {
    write(`Checking ${transport.baseUrl} as ${cfg.connection.user}...`);
    const capabilities = waitForCapabilities(transport, opts.timeoutMs ?? 2500);
    await transport.authenticate();
    saveConfig(cfg);
    await transport.connect();
    const caps = await capabilities;
    write('Auth: ok');
    write('WebSocket: ok');
    if (caps) {
      write(`Capabilities: projectContext=${caps.projectContext ? 'yes' : 'no'} sporeVersion=${caps.sporeVersion || 'unknown'}`);
    } else {
      write('Capabilities: not received before timeout');
    }
    return {baseUrl: transport.baseUrl, capabilities: caps};
  } finally {
    transport.close();
  }
}

function waitForCapabilities(transport: SporeTransport, timeoutMs: number): Promise<ServerCapabilities | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      transport.off('frame', onFrame);
      resolve(null);
    }, timeoutMs);
    const onFrame = (frame: {type: string}) => {
      if (frame.type !== 'capabilities') return;
      clearTimeout(timer);
      transport.off('frame', onFrame);
      resolve(frame as ServerCapabilities);
    };
    transport.on('frame', onFrame);
  });
}
