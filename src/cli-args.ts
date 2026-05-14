export type CommandName = 'setup' | 'doctor' | 'smoke' | 'logout' | 'help';

const COMMAND_ALIASES: Record<string, CommandName> = {
  setup: 'setup',
  configure: 'setup',
  config: 'setup',
  doctor: 'doctor',
  check: 'doctor',
  smoke: 'smoke',
  logout: 'logout',
  login: 'setup',
  help: 'help'
};

export interface Args {
  host?: string;
  port?: number;
  user?: string;
  session?: string;
  continue?: boolean;
  plan?: boolean;
  version?: boolean;
  help?: boolean;
  command?: CommandName;
}

export function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (COMMAND_ALIASES[a]) setCommand(out, COMMAND_ALIASES[a]!, a);
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--version' || a === '-v') out.version = true;
    else if (a === '--plan') out.plan = true;
    else if (a === '--continue' || a === '-c') out.continue = true;
    else if (a === '--host') out.host = nextValue(argv, ++i, '--host');
    else if (a.startsWith('--host=')) out.host = inlineValue(a, '--host');
    else if (a === '--port') out.port = parsePort(nextValue(argv, ++i, '--port'));
    else if (a.startsWith('--port=')) out.port = parsePort(inlineValue(a, '--port'));
    else if (a === '--user') out.user = nextValue(argv, ++i, '--user');
    else if (a.startsWith('--user=')) out.user = inlineValue(a, '--user');
    else if (a === '--session') out.session = nextValue(argv, ++i, '--session');
    else if (a.startsWith('--session=')) out.session = inlineValue(a, '--session');
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

export function helpText(version: string): string {
  return `spore ${version}

Usage:
  spore [options]
  spore setup [options]
  spore doctor [options]
  spore smoke [options]
  spore logout [options]

Commands:
  setup        Run or rerun first-time setup
  doctor       Check auth, WebSocket, and server capabilities without opening UI
  smoke        Run a live protocol smoke check and print the beta checklist
  logout       Clear the saved device token for the selected host/user
  help         Show this help

Aliases:
  config, configure, login -> setup
  check                    -> doctor

Options:
  -c, --continue          Resume this project's saved session
      --session <id>      Resume an explicit session id
      --plan              Start in plan mode
      --host <host>       Spore Core host or URL
      --port <port>       Spore Core port when host is not a URL
      --user <name>       Spore username
  -v, --version           Print version
  -h, --help              Show help
`;
}

function setCommand(out: Args, command: CommandName, raw: string): void {
  if (out.command && out.command !== command) {
    throw new Error(`multiple commands supplied: ${out.command} and ${raw}`);
  }
  out.command = command;
}

function nextValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('-')) throw new Error(`${flag} requires a value`);
  return value;
}

function inlineValue(arg: string, flag: string): string {
  const value = arg.slice(`${flag}=`.length);
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error('--port must be a number');
  const port = Number(value);
  if (port < 1 || port > 65535) throw new Error('--port must be between 1 and 65535');
  return port;
}
