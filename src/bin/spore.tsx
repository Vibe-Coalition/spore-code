import {render} from 'ink';
import type {SporeConfig} from '../protocol.js';
import {helpText, parseArgs, type Args} from '../cli-args.js';
import {authMissingReason, authReady, defaultConfig, ensureProjectDirs, loadConfig, loadGlobalConfig, loadLastSession, NoGlobalConfigError, resetAuth, runSetupWizard, saveConfig} from '../config.js';
import {SporeController} from '../controller.js';
import {resolveSessionId, saveProjectLastSession} from '../session.js';
import {saveLastSession} from '../config.js';
import {runDoctor} from '../doctor.js';
import {runSmoke} from '../smoke.js';
import {App} from '../ui/App.js';
import {VERSION} from '../version.js';

async function main(): Promise<void> {
  const args = parseArgsOrExit(process.argv.slice(2));
  if (args.help || args.command === 'help') {
    console.log(helpText(VERSION));
    return;
  }
  if (args.version) {
    console.log(`spore ${VERSION}`);
    return;
  }
  if (args.command === 'logout') {
    await logout(args);
    return;
  }

  const cwd = process.cwd();
  let cfg: SporeConfig;
  if (args.command === 'setup') {
    cfg = loadOrDefaultConfig(cwd);
    applyConnectionArgs(cfg, args);
    await runSetupWizard(cwd, cfg);
    console.log('Spore Code setup saved.');
    return;
  }

  try {
    cfg = loadConfig(cwd);
  } catch (err) {
    if (!(err instanceof NoGlobalConfigError)) throw err;
    console.error('no global config at ~/.spore-code/config.toml — running first-time setup');
    cfg = defaultConfig(cwd);
    applyConnectionArgs(cfg, args);
    cfg = await runSetupWizard(cwd, cfg);
  }
  applyConnectionArgs(cfg, args);
  if (!authReady(cfg)) {
    console.error(`${authMissingReason(cfg)} — running setup wizard`);
    cfg = await runSetupWizard(cwd, cfg);
  }
  if (args.command === 'doctor') {
    await runDoctor(cfg);
    return;
  }
  if (args.command === 'smoke') {
    await runSmoke(cfg, cwd);
    return;
  }
  ensureProjectDirs(cwd);

  const resolved = resolveSessionId(cfg.connection.user, cwd, {
    explicitSessionId: args.session,
    continueRequested: args.continue,
    autoResume: cfg.session.auto_resume,
    globalLast: loadLastSession(cfg)
  });
  const controller = new SporeController(cfg, cwd, resolved.sessionId, Boolean(args.plan), resolved.isContinue);
  saveLastSession(cfg, resolved.sessionId, cwd);
  saveProjectLastSession(cwd, resolved.sessionId);
  renderApp(controller);
}

function parseArgsOrExit(argv: string[]): Args {
  try {
    return parseArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error('Run `spore help` for usage.');
    process.exit(2);
  }
}

function renderApp(controller: SporeController): void {
  render(<App controller={controller} />);
}

async function logout(args: Args): Promise<void> {
  try {
    const cfg = loadGlobalConfig();
    applyConnectionArgs(cfg, args);
    resetAuth(cfg);
    saveConfig(cfg);
    console.log('Logged out — cleared saved Spore Code device token.');
  } catch (err) {
    if (err instanceof NoGlobalConfigError) {
      console.log('No Spore Code config found at ~/.spore-code/config.toml.');
      return;
    }
    throw err;
  }
}

function loadOrDefaultConfig(cwd: string): SporeConfig {
  try {
    return loadConfig(cwd);
  } catch (err) {
    if (err instanceof NoGlobalConfigError) return defaultConfig(cwd);
    throw err;
  }
}

function applyConnectionArgs(cfg: SporeConfig, args: Args): void {
  if (args.host) cfg.connection.host = args.host;
  if (args.port) cfg.connection.port = args.port;
  if (args.user) cfg.connection.user = args.user;
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
