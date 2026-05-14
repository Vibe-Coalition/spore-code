import path from 'node:path';
import {commandExists} from '../util.js';
import type {JsonObject} from '../protocol.js';
import {BackgroundManager} from './background.js';
import {
  architectureTool,
  codeDiffTool,
  codeOverviewTool,
  getSnippetTool,
  type IndexProgress,
  impactTool,
  indexCodebaseTool,
  searchSymbolsTool,
  traceCallsTool,
  tracePathTool,
  verifyImplementationTool
} from './code-index.js';
import {asInt, type ToolInput, type ToolResult} from './common.js';
import {editFileTool, globTool, grepTool, listDirTool, patchFileTool, readFileTool, readManyFilesTool, writeFileTool} from './file-tools.js';
import {gitDiffTool, gitStatusTool, runTestsTool} from './git-tools.js';
import {execTool, powershellExecTool} from './shell.js';

const serverTools = new Set([
  'graph_query', 'graph_update', 'graph_delete', 'query_about',
  'message_send', 'message_react', 'message_edit', 'message_read',
  'delegate_task', 'task_status', 'task_cancel', 'task_update',
  'save_tool', 'skill_lookup', 'skill_update',
  'session_status', 'sessions_list', 'env_manage',
  'notify_user', 'web_search', 'web_fetch',
  'anima_list', 'anima_message', 'anima_graph', 'anima_manage',
  'browser', 'startup_tasks', 'data_poller',
  'remote_exec', 'remote_read_file', 'remote_write_file', 'ssh_tunnel',
  'list_custom_tools', 'schedule_wakeup', 'list_wakeups', 'cancel_wakeup',
  'task_create', 'task_progress', 'task_list', 'task_get',
  'log_watch', 'log_watch_list', 'log_watch_stop', 'ask_user'
]);

const baseLocalTools = [
  'exec', 'read_file', 'write_file', 'edit_file', 'glob', 'grep',
  'index_codebase', 'search_symbols', 'get_snippet', 'architecture',
  'trace_calls', 'impact', 'verify_implementation', 'list_dir',
  'read_many_files', 'git_status', 'git_diff', 'patch_file', 'run_tests',
  'bg_list', 'bg_tail', 'bg_kill', 'code_overview', 'trace_path', 'code_diff'
];

export function localToolNames(): string[] {
  const tools = [...baseLocalTools];
  if (commandExists(process.platform === 'win32' ? 'powershell.exe' : 'pwsh') || commandExists('powershell')) {
    tools.push('powershell_exec');
  }
  return tools.sort();
}

export interface ApprovalRequest {
  id?: string;
  name: string;
  input: ToolInput;
  dangerous: boolean;
  summary: string;
  rule: string;
}

export interface ApprovalDecision {
  allowed: boolean;
  addRule?: boolean;
}

export interface ToolExecutorHooks {
  approve?: (req: ApprovalRequest) => Promise<boolean | ApprovalDecision>;
  onExecLine?: (line: string) => void;
  onIndexProgress?: (progress: IndexProgress) => void;
  onToolDone?: (name: string, input: ToolInput, result: unknown, ms: number) => void;
}

export type PermissionMode = 'auto' | 'ask' | 'locked' | 'yolo';

const readOnlyTools = new Set([
  'read_file', 'glob', 'grep', 'list_dir', 'read_many_files', 'git_status', 'git_diff',
  'search_symbols', 'get_snippet', 'architecture', 'trace_calls', 'impact',
  'verify_implementation', 'code_overview', 'trace_path', 'code_diff', 'bg_list', 'bg_tail'
]);

export class ToolExecutor {
  readonly bg: BackgroundManager;
  private permissionMode: PermissionMode = 'auto';
  private readonly approvalRules: string[] = [];

  constructor(
    private readonly cwd: string,
    private readonly logDir: string,
    private scope: 'strict' | 'expanded' | '' = '',
    private readonly hooks: ToolExecutorHooks = {}
  ) {
    this.bg = new BackgroundManager(logDir);
  }

  setScope(scope: 'strict' | 'expanded' | ''): void {
    this.scope = scope;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.permissionMode = mode;
  }

  addApprovalRule(rule: string): void {
    if (rule && !this.approvalRules.includes(rule)) this.approvalRules.push(rule);
  }

  approvalRuleList(): string[] {
    return [...this.approvalRules];
  }

  owns(name: string): boolean {
    return localToolNames().includes(name);
  }

  isServerTool(name: string): boolean {
    return serverTools.has(name) || !this.owns(name);
  }

  async execute(name: string, input: JsonObject = {}): Promise<{claimed: boolean; result: ToolResult}> {
    if (this.isServerTool(name)) return {claimed: false, result: null};
    const toolInput = input as ToolInput;
    const dangerous = isDangerous(name, toolInput);
    if (this.permissionMode === 'locked' && !readOnlyTools.has(name)) {
      return {claimed: true, result: {error: `Tool ${name} blocked by permission mode locked`, blocked: true, permissionMode: 'locked'}};
    }
    const shouldAsk = this.permissionMode === 'ask' || (this.permissionMode === 'auto' && dangerous);
    const rule = approvalRuleFor(name, toolInput);
    const coveredBySessionRule = this.approvalRules.some(r => approvalRuleMatches(r, name, toolInput));
    if (this.permissionMode !== 'yolo' && shouldAsk && !coveredBySessionRule && this.hooks.approve) {
      const decision = await this.hooks.approve({name, input: toolInput, dangerous, summary: summarizeTool(name, toolInput), rule});
      const allowed = typeof decision === 'boolean' ? decision : decision.allowed;
      if (!allowed) return {claimed: true, result: {error: 'Denied by user'}};
      if (typeof decision === 'object' && decision.addRule) this.addApprovalRule(rule);
    }
    const started = Date.now();
    let result: ToolResult;
    switch (name) {
      case 'read_file': result = readFileTool(toolInput, this.cwd, this.scope); break;
      case 'write_file': result = writeFileTool(toolInput, this.cwd, this.scope); break;
      case 'edit_file': result = editFileTool(toolInput, this.cwd, this.scope); break;
      case 'glob': result = await globTool(toolInput, this.cwd, this.scope); break;
      case 'grep': result = await grepTool(toolInput, this.cwd, this.scope); break;
      case 'exec': result = await execTool(toolInput, this.cwd, this.logDir, this.bg, this.hooks.onExecLine, this.scope); break;
      case 'powershell_exec': result = await powershellExecTool(toolInput, this.cwd, this.logDir, this.scope); break;
      case 'list_dir': result = listDirTool(toolInput, this.cwd, this.scope); break;
      case 'read_many_files': result = readManyFilesTool(toolInput, this.cwd, this.scope); break;
      case 'git_status': result = await gitStatusTool(toolInput, this.cwd); break;
      case 'git_diff': result = await gitDiffTool(toolInput, this.cwd); break;
      case 'run_tests': result = await runTestsTool(toolInput, this.cwd, this.scope); break;
      case 'bg_list': result = {ok: true, processes: this.bg.list()}; break;
      case 'bg_tail': result = this.bg.tail(asInt(toolInput.id ?? toolInput.processId, 0), asInt(toolInput.lines, 80)); break;
      case 'bg_kill': result = this.bg.kill(asInt(toolInput.id ?? toolInput.processId, 0)); break;
      case 'index_codebase': result = await indexCodebaseTool(toolInput, this.cwd, this.hooks.onIndexProgress); break;
      case 'search_symbols': result = searchSymbolsTool(toolInput, this.cwd); break;
      case 'get_snippet': result = getSnippetTool(toolInput, this.cwd); break;
      case 'architecture': result = architectureTool(toolInput, this.cwd); break;
      case 'trace_calls': result = traceCallsTool(toolInput, this.cwd); break;
      case 'impact': result = impactTool(toolInput, this.cwd); break;
      case 'verify_implementation': result = verifyImplementationTool(toolInput, this.cwd); break;
      case 'code_overview': result = codeOverviewTool(toolInput, this.cwd); break;
      case 'trace_path': result = tracePathTool(); break;
      case 'code_diff': result = await codeDiffTool(toolInput, this.cwd); break;
      case 'patch_file': result = patchFileTool(toolInput, this.cwd, this.scope); break;
      default: result = {error: `Unknown local tool: ${name}`};
    }
    this.hooks.onToolDone?.(name, toolInput, result, Date.now() - started);
    return {claimed: true, result};
  }
}

function isDangerous(name: string, input: ToolInput): boolean {
  if (['write_file', 'edit_file', 'patch_file', 'exec', 'powershell_exec', 'run_tests', 'bg_kill'].includes(name)) return true;
  const command = String(input.command || input.cmd || '');
  return /rm\s+-rf|del\s+\/|format\s+|mkfs|sudo|chmod\s+-R/i.test(command);
}

function summarizeTool(name: string, input: ToolInput): string {
  if (name === 'exec' || name === 'powershell_exec') return String(input.command || input.cmd || '').slice(0, 160);
  if (name.includes('file')) return String(input.path || input.file || '').slice(0, 160);
  return JSON.stringify(input).slice(0, 160);
}

function approvalRuleFor(name: string, input: ToolInput): string {
  if (name === 'exec' || name === 'powershell_exec') {
    const command = String(input.command || input.cmd || '').trim();
    return `${name}:${commandHead(command)}*`;
  }
  if (name === 'run_tests') {
    const command = String(input.command || input.cmd || 'standard-tests').trim();
    return `${name}:${commandHead(command)}*`;
  }
  if (['write_file', 'edit_file', 'patch_file'].includes(name)) {
    const file = String(input.path || input.file || input.file_path || input.filePath || '').trim();
    const dir = path.dirname(file || '.').replace(/\\/g, '/');
    return `${name}:${dir === '.' ? '*' : `${dir}/*`}`;
  }
  return `${name}:*`;
}

function approvalRuleMatches(rule: string, name: string, input: ToolInput): boolean {
  const [ruleName, rawPattern = '*'] = rule.split(/:(.*)/s);
  if (ruleName !== name) return false;
  const candidate = approvalRuleFor(name, input).slice(name.length + 1);
  const pattern = rawPattern.endsWith('*') ? rawPattern.slice(0, -1) : rawPattern;
  return rawPattern === '*' || rawPattern === candidate || candidate.startsWith(pattern);
}

function commandHead(command: string): string {
  const head = command.match(/"[^"]+"|'[^']+'|[^\s]+/)?.[0] || 'command';
  return head.replace(/^['"]|['"]$/g, '');
}

export function defaultLogDir(cwd: string): string {
  return path.join(cwd, '.spore-code', 'logs');
}
