import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type {AskUserFrame, ChatDone, ChatMessage, InboundFrame, JsonObject, ProjectContext, SporeConfig, ToolRequest} from './protocol.js';
import {buildProjectContext} from './project-context.js';
import {computeSessionId, listProjectSessions, saveApprovedPlan, saveProjectLastSession, SessionLog, writeDebugLog} from './session.js';
import {SporeTransport} from './transport.js';
import {saveConfig, saveLastSession} from './config.js';
import {defaultLogDir, ToolExecutor, type ApprovalDecision, type ApprovalRequest, type PermissionMode} from './tools/executor.js';
import {CommandHistory, defaultHistoryFile} from './history.js';
import {CLIENT_VERSION} from './version.js';

const PLAN_EXECUTE_MSG = `[The user has approved the plan above. Switch to execute mode and implement it now. Proceed step by step, executing all the changes you outlined.]`;

export interface QuestionState {
  qid: string;
  question: string;
  mode: string;
  multi: boolean;
  options: {label: string; description?: string}[];
  source: 'ask_user' | 'plan';
}

export interface ApprovalState extends ApprovalRequest {
  resolve: (decision: boolean | ApprovalDecision) => void;
}

export interface PlanApprovalState {
  text: string;
  awaitingFeedback: boolean;
}

export type ActivityKind = 'thinking' | 'tool' | 'file' | 'diff' | 'recall' | 'task' | 'subagent' | 'workflow' | 'status';

export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  title: string;
  detail?: string;
  preview?: string;
  status?: 'running' | 'done' | 'error';
  timestamp: number;
}

export interface OutputEntry {
  id: string;
  source: string;
  text: string;
  timestamp: number;
}

export interface ClientState {
  connected: boolean;
  status: string;
  generating: boolean;
  planMode: boolean;
  scope: 'strict' | 'expanded' | '';
  permissionMode: PermissionMode;
  messages: ChatMessage[];
  pendingQuestion: QuestionState | null;
  pendingApproval: ApprovalState | null;
  pendingPlan: PlanApprovalState | null;
  usageLine: string;
  activity: ActivityEntry[];
  outputLog: OutputEntry[];
  activityPanelOpen: boolean;
  outputLogOpen: boolean;
  workflowLabel: string;
  delegationMode: 'default' | 'off' | 'research' | 'code' | 'all';
  theme: string;
}

export class SporeController extends EventEmitter {
  readonly state: ClientState;
  private log: SessionLog;
  private readonly history: CommandHistory;
  private readonly transport: SporeTransport;
  private readonly executor: ToolExecutor;
  private streamIndex = -1;
  private capsProjectContext = true;
  private autoIndexStarted = false;
  private planResearchDoneSeen = false;

  constructor(
    private readonly cfg: SporeConfig,
    private readonly cwd: string,
    private sessionId: string,
    planMode: boolean,
    private readonly isContinue: boolean
  ) {
    super();
    this.log = new SessionLog(cfg, sessionId);
    this.history = new CommandHistory(defaultHistoryFile(cfg.globalDir));
    this.transport = new SporeTransport(cfg);
    this.executor = new ToolExecutor(cwd, defaultLogDir(cwd), '', {
      approve: req => this.requestApproval(req),
      onExecLine: line => {
        this.appendOutput('exec', line);
        this.setStatus(`exec: ${line.slice(0, 100)}`);
      },
      onIndexProgress: progress => {
        this.setStatus(`indexing ${progress.filesScanned}/${progress.totalFiles} files`);
        this.appendActivity({
          kind: 'status',
          title: 'indexing codebase',
          detail: `${progress.filesParsed}/${progress.totalFiles} files · ${progress.symbols} symbols`,
          status: progress.note === 'done' ? 'done' : 'running'
        });
      },
      onToolDone: (name, input, result, ms) => {
        this.log.writeTool(name, input, result, true, ms);
        this.recordToolDone(name, input, result, ms);
      }
    });
    this.state = {
      connected: false,
      status: 'starting',
      generating: false,
      planMode,
      scope: '',
      permissionMode: 'auto',
      messages: [],
      pendingQuestion: null,
      pendingApproval: null,
      pendingPlan: null,
      usageLine: '',
      activity: [],
      outputLog: [],
      activityPanelOpen: true,
      outputLogOpen: false,
      workflowLabel: '',
      delegationMode: 'default',
      theme: cfg.display.theme || 'dark'
    };
  }

  async start(): Promise<void> {
    if (this.isContinue) {
      this.state.messages.push(...this.log.load());
    }
    this.transport.on('open', () => this.onOpen());
    this.transport.on('close', () => {
      this.state.connected = false;
      this.setStatus('disconnected');
    });
    this.transport.on('reconnecting', attempt => this.setStatus(`reconnecting... attempt ${attempt}`));
    this.transport.on('error', err => this.push('system', `Connection error: ${err instanceof Error ? err.message : String(err)}`));
    this.transport.on('frame', frame => void this.handleFrame(frame as InboundFrame));
    await this.transport.authenticate();
    saveConfig(this.cfg);
    await this.transport.connect();
  }

  stop(): void {
    this.transport.send({type: 'chat:stop', sessionId: this.sessionId});
  }

  close(): void {
    this.transport.send({type: 'session:end', sessionId: this.sessionId, endedAt: new Date().toISOString()});
    this.transport.close();
  }

  sendUser(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.history.add(text);
    if (trimmed.startsWith('/')) {
      this.handleSlash(trimmed);
      return;
    }
    this.push('user', text);
    this.log.writeMessage({role: 'user', text, timestamp: Date.now()});
    const pc = this.projectContext();
    const payload: Record<string, unknown> = {
      type: 'chat:submit',
      sessionId: this.sessionId,
      userName: this.cfg.connection.user,
      content: text,
      displayText: text,
      cwd: this.cwd,
      projectContext: pc
    };
    if (!this.capsProjectContext) {
      payload.content = `${renderLegacyContext(pc)}\n\n${text}`;
    }
    this.state.generating = true;
    this.setStatus('thinking');
    this.transport.send(payload);
  }

  reportError(err: unknown): void {
    this.push('error', err instanceof Error ? err.message : String(err));
  }

  historyPrevious(draft: string): string {
    return this.history.previous(draft);
  }

  historyNext(): string {
    return this.history.next();
  }

  historyReset(): void {
    this.history.reset();
  }

  toggleActivityPanel(): void {
    this.state.activityPanelOpen = !this.state.activityPanelOpen;
    this.emitChange();
  }

  toggleOutputLog(): void {
    this.state.outputLogOpen = !this.state.outputLogOpen;
    this.emitChange();
  }

  answerQuestion(answer: string): void {
    const q = this.state.pendingQuestion;
    if (!q) return;
    const parsed = normalizeQuestionAnswer(answer, q.options, q.multi);
    this.state.pendingQuestion = null;
    if (q.source === 'plan') {
      const prefix = this.planResearchDoneSeen
        ? '[BUILD_PLAN] Follow-up answers — proceed to build the plan:'
        : '[RESEARCH] Interview answers — proceed to research+code phase:';
      this.sendUser(`${prefix}\n\n${parsed.answer}`);
    } else {
      this.transport.send({
        type: 'ask_user_answer',
        qid: q.qid,
        answer: parsed.answer,
        answers: parsed.answers
      });
    }
    this.setStatus('answered question');
    this.appendActivity({kind: 'workflow', title: 'question answered', detail: parsed.answer, status: 'done'});
    this.emitChange();
  }

  resolveApproval(ok: boolean, addRule = false): void {
    const pending = this.state.pendingApproval;
    if (!pending) return;
    this.transport.send({type: 'tool:approval-resolved', name: pending.name, allowed: ok, addRule});
    pending.resolve({allowed: ok, addRule});
    this.appendActivity({
      kind: 'tool',
      title: `${pending.name} ${ok ? 'approved' : 'denied'}`,
      detail: ok && addRule ? `session rule ${pending.rule}` : pending.summary,
      status: ok ? 'done' : 'error'
    });
    this.state.pendingApproval = null;
    this.emitChange();
  }

  resolvePlan(action: 'execute' | 'revise' | 'cancel', feedback = ''): void {
    const plan = this.state.pendingPlan;
    if (!plan) return;
    if (action === 'cancel') {
      this.state.pendingPlan = null;
      this.push('system', 'Plan cancelled.');
      this.transport.send({type: 'plan:decided', action: 'cancel'});
      return;
    }
    if (action === 'revise' && !feedback.trim()) {
      this.state.pendingPlan = {...plan, awaitingFeedback: true};
      this.setStatus('waiting for plan revision feedback');
      return;
    }
    this.state.pendingPlan = null;
    if (action === 'execute') {
      this.state.planMode = false;
      try {
        const file = saveApprovedPlan(this.cwd, plan.text);
        this.push('system', `Saved approved plan: ${file}`);
      } catch (err) {
        this.push('error', `Could not save approved plan: ${err instanceof Error ? err.message : String(err)}`);
      }
      this.transport.send({type: 'plan:set-mode', enabled: false});
      this.transport.send({type: 'plan:decided', action: 'execute'});
      this.sendUser(PLAN_EXECUTE_MSG);
      return;
    }
    this.transport.send({type: 'plan:decided', action: 'revise', feedback});
    this.sendUser(`[REVISE PLAN]\n${feedback}`);
  }

  private onOpen(): void {
    this.state.connected = true;
    this.setStatus('connected');
    this.push('system', logo());
    const pc = this.projectContext();
    this.transport.send({type: 'chat:history-request', sessionId: this.sessionId, userName: this.cfg.connection.user});
    this.transport.send({
      type: 'session:start',
      sessionId: this.sessionId,
      userName: this.cfg.connection.user,
      cwd: this.cwd,
      startedAt: new Date().toISOString(),
      clientVersion: CLIENT_VERSION,
      localTools: pc.localTools,
      projectContext: pc
    });
    this.appendActivity({kind: 'status', title: 'connected', detail: this.transport.baseUrl, status: 'done'});
    this.push('system', `Connected to ${this.transport.baseUrl} as ${this.cfg.connection.user} (session ${this.sessionId})`);
    if (!pc.hasCodeIndex) void this.autoIndexCodebase();
  }

  private async handleFrame(frame: InboundFrame): Promise<void> {
    switch (frame.type) {
      case 'capabilities':
        this.capsProjectContext = Boolean(frame.projectContext);
        break;
      case 'chat:history':
        if (Array.isArray(frame.messages) && !this.isContinue) {
          for (const m of frame.messages as Array<{role?: string; text?: string}>) {
            if (!m.text) continue;
            this.state.messages.push({role: m.role === 'assistant' ? 'assistant' : 'user', text: m.text, timestamp: Date.now()});
          }
          this.emitChange();
        }
        break;
      case 'chat:start':
        this.state.generating = true;
        this.streamIndex = -1;
        this.setStatus('thinking');
        break;
      case 'chat:delta':
        this.appendAssistant(String(frame.text || ''));
        break;
      case 'chat:thinking':
        this.setStatus(`thinking ${String(frame.text || '').length ? '...' : ''}`);
        if (frame.text) this.appendThinking(String(frame.text));
        break;
      case 'chat:status':
        this.handleStatus(frame);
        break;
      case 'chat:tool':
        this.appendActivity({
          kind: 'tool',
          title: String(frame.name || frame.tool || 'tool'),
          detail: String(frame.detail || ''),
          status: 'running'
        });
        this.setStatus(`tool: ${String(frame.name || frame.tool || 'tool')}`);
        break;
      case 'chat:done':
        this.finishAssistant(frame as ChatDone);
        break;
      case 'chat:error':
        this.state.generating = false;
        this.push('error', String(frame.error || 'Unknown error'));
        this.appendActivity({kind: 'status', title: 'chat error', detail: String(frame.error || 'Unknown error'), status: 'error'});
        break;
      case 'graph:event':
        this.handleGraphEvent(frame);
        break;
      case 'code:view':
        this.handleCodeView(frame);
        break;
      case 'code:diff':
        this.handleCodeDiff(frame);
        break;
      case 'ask_user':
        this.showQuestion(frame as AskUserFrame);
        break;
      case 'ask_user_cancelled':
        this.state.pendingQuestion = null;
        this.appendActivity({kind: 'workflow', title: 'question cancelled', status: 'done'});
        this.emitChange();
        break;
      case 'ask_user_answer_ack':
        if (frame.ok === false) {
          this.push('system', 'Question answer was not accepted; answer the prompt again.');
          this.setStatus('waiting for question answer');
          this.appendActivity({kind: 'workflow', title: 'question answer rejected', status: 'error'});
        }
        break;
      case 'workflow:state':
        this.handleWorkflowState(frame);
        break;
      case 'plan_proposal':
        this.push('system', `[plan] queued: ${String(frame.tool || 'tool')} - ${String(frame.summary || '')}`);
        break;
      case 'plan_applied':
        this.push('system', `[plan] applied ${Array.isArray(frame.results) ? frame.results.length : 0} action(s)`);
        break;
      case 'plan_rejected':
        this.push('system', '[plan] proposals rejected');
        break;
      case 'chat:busy':
        this.push('system', 'Server: session busy (another client may be running it)');
        break;
      case 'tool:approval-resolved':
        if (this.state.pendingApproval) this.resolveApproval(frame.allowed !== false, Boolean(frame.addRule));
        break;
      case 'plan:decision':
      case 'plan:decided':
        this.resolvePlan(String(frame.action || 'cancel') as 'execute' | 'revise' | 'cancel', String(frame.feedback || ''));
        break;
      case 'plan:set-mode':
        this.state.planMode = Boolean(frame.enabled);
        this.emitChange();
        break;
      case 'perm:set-mode':
        this.setPermissionMode(String(frame.mode || 'auto') as PermissionMode);
        break;
      case 'tool:request':
        await this.handleTool(frame as ToolRequest);
        break;
      default:
        this.handleAuxiliaryFrame(frame as JsonObject);
        break;
    }
  }

  private async handleTool(frame: ToolRequest): Promise<void> {
    this.transport.send({type: 'tool:ack', id: frame.id});
    this.appendActivity({kind: 'tool', title: frame.name, detail: summarizeInput(frame.input), status: 'running'});
    const result = await this.executor.execute(frame.name, frame.input || {});
    if (!result.claimed) {
      this.appendActivity({kind: 'tool', title: frame.name, detail: 'delegated to Core', status: 'done'});
    }
    // Always answer. A null result tells Core this client declined the server-side
    // tool, so Core can run it instead of waiting for a local result forever.
    this.transport.send({type: 'tool:result', id: frame.id, result: result.result});
  }

  private requestApproval(req: ApprovalRequest): Promise<boolean | ApprovalDecision> {
    return new Promise(resolve => {
      this.transport.send({type: 'tool:awaiting-approval', name: req.name, summary: req.summary, dangerous: req.dangerous, rule: req.rule});
      this.state.pendingApproval = {...req, resolve};
      this.emitChange();
    });
  }

  private showQuestion(frame: AskUserFrame): void {
    this.state.pendingQuestion = {
      qid: frame.qid,
      question: frame.question,
      mode: frame.mode || (frame.multi ? 'multi' : 'single'),
      multi: Boolean(frame.multi || frame.mode === 'multi'),
      options: frame.options || [],
      source: 'ask_user'
    };
    this.appendActivity({kind: 'workflow', title: 'question requested', detail: frame.question, status: 'running'});
    this.emitChange();
  }

  private appendAssistant(delta: string): void {
    if (this.streamIndex < 0 || !this.state.messages[this.streamIndex]) {
      this.state.messages.push({role: 'assistant', text: '', timestamp: Date.now(), streaming: true});
      this.streamIndex = this.state.messages.length - 1;
    }
    this.state.messages[this.streamIndex]!.text += delta;
    this.emitChange();
  }

  private finishAssistant(done: ChatDone): void {
    let finalText = '';
    if (done.text && (this.streamIndex < 0 || !this.state.messages[this.streamIndex]?.text)) {
      finalText = done.text;
      this.push('assistant', this.state.planMode ? cleanPlanControlText(done.text) : done.text);
    }
    if (this.streamIndex >= 0 && this.state.messages[this.streamIndex]) {
      const msg = this.state.messages[this.streamIndex]!;
      msg.streaming = false;
      finalText = msg.text;
      if (this.state.planMode) {
        msg.text = cleanPlanControlText(msg.text);
      }
      this.log.writeAssistant(msg.text, {usage: done.usage, iterations: done.iterations});
    }
    if (finalText) this.inspectPlanProtocol(finalText);
    this.state.generating = false;
    this.streamIndex = -1;
    const tools = done.toolUsage ? Object.entries(done.toolUsage).map(([k, v]) => `${k}x${v}`).join(', ') : '';
    this.state.usageLine = `Usage: ${done.usage?.input_tokens || 0} in · ${done.usage?.output_tokens || 0} out${done.iterations ? ` · ${done.iterations} iterations` : ''}${tools ? ` · tools ${tools}` : ''}`;
    if (done.hiddenWorkflowControl) this.appendActivity({kind: 'workflow', title: 'workflow control', detail: done.hiddenWorkflowControl, status: 'done'});
    if (this.state.usageLine) this.appendActivity({kind: 'status', title: 'turn complete', detail: this.state.usageLine, status: 'done'});
    this.setStatus('idle');
  }

  private handleSlash(command: string): void {
    const [name, ...args] = command.split(/\s+/);
    const arg = args.join(' ');
    switch (name) {
      case '/plan':
        this.state.planMode = !this.state.planMode;
        this.push('system', `Plan mode ${this.state.planMode ? 'on' : 'off'}.`);
        break;
      case '/new':
        this.startNewSession();
        break;
      case '/resume':
        this.resumeSession(arg);
        break;
      case '/sessions':
        this.showSessions();
        break;
      case '/status':
        this.push('system', this.statusSummary());
        break;
      case '/scope':
        if (arg === 'expanded' || arg === 'strict') {
          this.state.scope = arg === 'strict' ? '' : 'expanded';
          this.executor.setScope(this.state.scope);
          this.push('system', `Scope set to ${arg}.`);
        } else {
          this.push('system', 'Usage: /scope strict|expanded');
        }
        break;
      case '/mode':
        this.setPermissionMode((arg || 'auto') as PermissionMode);
        break;
      case '/stop':
        this.stop();
        break;
      case '/clear':
        this.state.messages = [];
        this.transport.send({type: 'chat:clear', sessionId: this.sessionId});
        break;
      case '/help':
        this.push('system', helpText());
        break;
      case '/panel':
        this.toggleActivityPanel();
        this.push('system', `Activity panel ${this.state.activityPanelOpen ? 'shown' : 'hidden'}.`);
        break;
      case '/output':
        this.toggleOutputLog();
        this.push('system', `Output log ${this.state.outputLogOpen ? 'shown' : 'hidden'}.`);
        break;
      case '/index':
        void this.runLocalTool('index_codebase', {});
        break;
      case '/context':
        this.showContext(arg);
        break;
      case '/tree':
        this.showTree(arg);
        break;
      case '/init':
        this.initProjectInstructions();
        break;
      case '/bg':
        void this.handleBg(arg);
        break;
      case '/delegate':
        this.handleDelegate(arg);
        break;
      case '/decisions':
        this.showDecisionsHint(arg);
        break;
      case '/architecture':
        void this.runLocalTool('architecture', {});
        break;
      case '/impact':
        void this.runLocalTool('impact', {query: arg || ''});
        break;
      case '/calls':
        void this.runLocalTool('trace_calls', {query: arg || ''});
        break;
      case '/models_preset':
        void this.handlePreset(arg || '');
        break;
      default:
        this.push('system', `Unknown command: ${command}`);
    }
    this.emitChange();
  }

  private async runLocalTool(name: string, input: Record<string, unknown>): Promise<void> {
    this.setStatus(`running ${name}`);
    const result = await this.executor.execute(name, input);
    this.push('system', `${name}\n${JSON.stringify(result.result, null, 2)}`);
    this.setStatus('idle');
  }

  private async autoIndexCodebase(): Promise<void> {
    if (this.autoIndexStarted) return;
    this.autoIndexStarted = true;
    this.push('system', 'Auto-indexing this project so the agent can use structural search.');
    this.appendActivity({kind: 'status', title: 'auto-index started', status: 'running'});
    const result = await this.executor.execute('index_codebase', {});
    if (result.claimed) {
      this.push('system', `index_codebase\n${JSON.stringify(result.result, null, 2)}`);
    }
    this.setStatus('idle');
  }

  private startNewSession(): void {
    const prev = this.sessionId;
    this.switchSession(computeSessionId(this.cfg.connection.user, this.cwd, true), false);
    this.push('system', `New session: ${this.sessionId}`);
    if (prev && prev !== this.sessionId) {
      this.push('system', `Previous session preserved: ${prev} (use /resume ${prev} to return)`);
    }
  }

  private resumeSession(ref: string): void {
    const resolved = this.resolveSessionRef(ref);
    if (!resolved) return;
    this.switchSession(resolved, true);
    this.transport.send({type: 'chat:history-request', sessionId: this.sessionId, userName: this.cfg.connection.user});
    this.push('system', `Resumed: ${this.sessionId}`);
  }

  private switchSession(sessionId: string, replay: boolean): void {
    this.sessionId = sessionId;
    this.log = new SessionLog(this.cfg, sessionId);
    this.state.messages = replay ? this.log.load() : [];
    this.streamIndex = -1;
    this.planResearchDoneSeen = false;
    this.state.pendingPlan = null;
    this.state.pendingQuestion = null;
    this.state.pendingApproval = null;
    saveLastSession(this.cfg, sessionId, this.cwd);
    saveProjectLastSession(this.cwd, sessionId);
    this.announceSessionStart();
    this.emitChange();
  }

  private resolveSessionRef(ref: string): string {
    const cleaned = ref.trim().replace(/^#/, '');
    if (!cleaned) {
      this.push('system', 'Usage: /resume <sessionId|number from /sessions>');
      return '';
    }
    if (/^\d+$/.test(cleaned)) {
      const sessions = listProjectSessions(this.cfg, this.cwd);
      const idx = Number(cleaned) - 1;
      const found = sessions[idx];
      if (!found) {
        this.push('system', `No session #${cleaned}. Run /sessions to see available sessions.`);
        return '';
      }
      return found.sessionId;
    }
    return cleaned;
  }

  private announceSessionStart(): void {
    const pc = this.projectContext();
    this.transport.send({
      type: 'session:start',
      sessionId: this.sessionId,
      userName: this.cfg.connection.user,
      cwd: this.cwd,
      startedAt: new Date().toISOString(),
      clientVersion: CLIENT_VERSION,
      localTools: pc.localTools,
      projectContext: pc
    });
  }

  private showSessions(): void {
    const sessions = listProjectSessions(this.cfg, this.cwd);
    if (!sessions.length) {
      this.push('system', 'No saved sessions for this project.');
      return;
    }
    const lines = [`Sessions for this project (${sessions.length}):`];
    sessions.forEach((session, i) => {
      lines.push(`${i + 1}. ${timeAgo(session.updatedAt)} · ${session.messageCount} msgs · ${session.preview || '(no preview)'}`);
      lines.push(`   id: ${session.sessionId}`);
    });
    lines.push('', 'Resume with /resume 1 or /resume <sessionId>.');
    this.push('system', lines.join('\n'));
  }

  private statusSummary(): string {
    const host = this.cfg.connection.host.includes('://')
      ? this.cfg.connection.host
      : `${this.cfg.connection.host}:${this.cfg.connection.port}`;
    return [
      `server=${host}`,
      `user=${this.cfg.connection.user}`,
      `session=${this.sessionId}`,
      `planMode=${this.state.planMode}`,
      `permission=${this.state.permissionMode}`,
      `scope=${this.state.scope || 'strict'}`,
      `workflow=${this.state.workflowLabel || 'idle'}`,
      `delegation=${this.state.delegationMode}`
    ].join(' ');
  }

  private showContext(arg: string): void {
    const pc = this.projectContext();
    this.push('system', `Project context\n${JSON.stringify(pc, null, 2)}`);
    if (arg.trim() === 'refresh') {
      this.push('system', 'Project context is rebuilt on every turn.');
    }
  }

  private showTree(arg: string): void {
    const depth = Math.max(1, Math.min(8, Number(arg.trim()) || 3));
    this.push('system', `Project tree (depth ${depth})\n${projectTreeString(this.cwd, depth, 240)}`);
  }

  private initProjectInstructions(): void {
    const file = path.join(this.cwd, 'SPORE.md');
    if (fs.existsSync(file)) {
      this.push('system', `SPORE.md already exists at ${file}`);
      return;
    }
    const body = '# Project Instructions for Spore Code\n\n## Overview\n\n## Conventions\n\n## Important files\n';
    fs.writeFileSync(file, body, 'utf8');
    const gitignore = path.join(this.cwd, '.gitignore');
    if (fs.existsSync(gitignore)) {
      const raw = fs.readFileSync(gitignore, 'utf8');
      if (!raw.includes('.spore-code/')) fs.appendFileSync(gitignore, '\n# Spore Code local data\n.spore-code/\n');
    }
    this.push('system', `Created ${file}`);
  }

  private async handleBg(arg: string): Promise<void> {
    const trimmed = arg.trim();
    if (!trimmed || trimmed === 'list') {
      await this.runLocalTool('bg_list', {});
      return;
    }
    if (trimmed.startsWith('run ')) {
      await this.runLocalTool('exec', {command: trimmed.slice(4), background: true});
      return;
    }
    if (trimmed.startsWith('kill ')) {
      await this.runLocalTool('bg_kill', {id: Number(trimmed.slice(5).trim())});
      return;
    }
    if (/^\d+$/.test(trimmed)) {
      await this.runLocalTool('bg_tail', {id: Number(trimmed)});
      return;
    }
    this.push('system', 'Usage: /bg [list|<id>|run <command>|kill <id>]');
  }

  private handleDelegate(arg: string): void {
    const value = arg.trim().toLowerCase();
    if (!value) {
      this.push('system', `Delegation mode: ${this.state.delegationMode}\n/delegate default|off|research|code|all`);
      return;
    }
    if (!['default', 'off', 'research', 'code', 'all'].includes(value)) {
      this.push('system', 'Usage: /delegate default|off|research|code|all');
      return;
    }
    this.state.delegationMode = value as ClientState['delegationMode'];
    this.transport.send({type: 'delegate:config', mode: value, sessionId: this.sessionId});
    this.push('system', `Delegation mode set to ${value}.`);
  }

  private showDecisionsHint(arg: string): void {
    const action = arg.trim() || 'list';
    this.push('system', `Project decisions live in the graph. Ask the agent to "${action} decisions for this project"; it will use the graph-backed decision tools.`);
  }

  private async handlePreset(arg: string): Promise<void> {
    try {
      if (!arg) {
        const data = await this.transport.routingPresets();
        const presets = Array.isArray(data.presets) ? data.presets : [];
        const names = presets.map((p: any) => p?.name || p?.id).filter(Boolean);
        this.push('system', names.length ? `Available presets: ${names.join(', ')}\nUsage: /models_preset <name> or /models_preset server` : 'No model routing presets found.');
        return;
      }
      if (arg === 'server' || arg === 'clear') {
        const data = await this.transport.clearRoutingPreset();
        this.push('system', `Device preset override cleared.\n${JSON.stringify(data, null, 2)}`);
        return;
      }
      const data = await this.transport.applyRoutingPreset(arg);
      this.push('system', `Preset ${arg} applied to this device.\n${JSON.stringify(data, null, 2)}`);
    } catch (err) {
      this.push('error', `Preset operation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private setPermissionMode(mode: PermissionMode): void {
    if (!['auto', 'ask', 'locked', 'yolo'].includes(mode)) {
      this.push('system', 'Usage: /mode auto|ask|locked|yolo');
      return;
    }
    this.state.permissionMode = mode;
    this.executor.setPermissionMode(mode);
    this.transport.send({type: 'perm:current-mode', mode, sessionId: this.sessionId});
    this.push('system', `Permission mode set to ${mode}.`);
    this.emitChange();
  }

  private inspectPlanProtocol(text: string): void {
    if (!this.state.planMode) return;
    const q = parsePlanQuestions(text);
    if (q) {
      this.state.pendingQuestion = q;
      this.appendActivity({kind: 'workflow', title: 'plan questions', detail: q.question, status: 'running'});
      this.transport.send({type: 'state:questions', sessionId: this.sessionId, questions: [{text: q.question, options: q.options.map(o => o.label), multi: q.multi}]});
      this.emitChange();
      return;
    }
    if (hasPlanControl(text, 'NO_INTERVIEW_NEEDED')) {
      this.appendActivity({kind: 'workflow', title: 'no interview needed', status: 'done'});
      this.sendUser('[RESEARCH] Proceed to research+code phase.');
      return;
    }
    if (hasPlanControl(text, 'RESEARCH_DONE')) {
      this.planResearchDoneSeen = true;
      this.appendActivity({kind: 'workflow', title: 'research complete', status: 'done'});
      this.sendUser('[REVIEW] Review the captured RESEARCH_DONE artifact in Runtime Workflow State and decide if any follow-up questions are needed.');
      return;
    }
    if (hasPlanControl(text, 'NO_FOLLOWUP_QUESTIONS')) {
      this.appendActivity({kind: 'workflow', title: 'no follow-up questions', status: 'done'});
      this.sendUser('[BUILD_PLAN] Build the plan from the captured RESEARCH_DONE artifact in Runtime Workflow State.');
      return;
    }
    if (isPlanReady(text)) {
      this.state.pendingPlan = {text, awaitingFeedback: false};
      this.appendActivity({kind: 'workflow', title: 'plan ready', status: 'running'});
      this.transport.send({type: 'plan:show-approval', sessionId: this.sessionId, text});
      this.emitChange();
    }
  }

  private handleStatus(frame: JsonObject): void {
    const status = String(frame.status || frame.detail || 'working');
    const tool = String(frame.tool || frame.name || '');
    const detail = String(frame.detail || '');
    switch (status) {
      case 'thinking_start':
        this.setStatus('thinking...');
        this.appendActivity({kind: 'thinking', title: 'thinking', status: 'running'});
        break;
      case 'thinking_done':
        this.setStatus('');
        this.appendActivity({kind: 'thinking', title: 'thinking done', status: 'done'});
        break;
      case 'tool_exec_start':
        this.setStatus(`tool: ${tool || 'tool'} ${detail}`.trim());
        this.appendActivity({kind: 'tool', title: tool || 'tool', detail, status: 'running'});
        break;
      case 'tool_exec_done':
        this.setStatus(`${tool || 'tool'} done`);
        this.appendActivity({kind: 'tool', title: tool || 'tool', detail: durationDetail(frame), status: 'done'});
        break;
      case 'ask_user_waiting':
        this.setStatus('waiting for question answer');
        break;
      case 'ask_user_answered':
        this.setStatus('');
        break;
      case 'compaction-start':
        this.setStatus(`compacting context${contextSuffix(frame)}...`);
        this.push('system', `Compacting earlier turns to free context space${contextSuffix(frame)}...`);
        this.appendActivity({kind: 'status', title: 'compacting context', detail: contextSuffix(frame), status: 'running'});
        break;
      case 'compaction-done':
        this.setStatus('');
        this.push('system', `Compaction done${contextSuffix(frame)}.`);
        this.appendActivity({kind: 'status', title: 'compaction done', detail: contextSuffix(frame), status: 'done'});
        break;
      case 'truncated':
        this.push('system', '[agent] response hit max_tokens - retrying with smaller output');
        break;
      default:
        this.setStatus(status);
    }
  }

  private handleGraphEvent(frame: JsonObject): void {
    const op = String(frame.op || frame.source || 'graph');
    const detail = String(frame.detail || '');
    if (op.startsWith('recall:') || frame.source === 'recall') {
      this.appendActivity({
        kind: 'recall',
        title: op.replace(/^recall:/, 'recall '),
        detail,
        preview: detail,
        status: op.endsWith(':done') ? 'done' : 'running'
      });
    }
  }

  private handleCodeView(frame: JsonObject): void {
    const path = String(frame.path || 'file');
    const content = String(frame.content || '');
    const lines = content ? content.split(/\r?\n/).length : 0;
    this.appendActivity({
      kind: 'file',
      title: path,
      detail: frame.isNew ? 'new file' : `${lines} lines`,
      preview: previewText(content),
      status: 'done'
    });
  }

  private handleCodeDiff(frame: JsonObject): void {
    const path = String(frame.path || 'file');
    const oldText = String(frame.oldText || '');
    const newText = String(frame.newText || '');
    this.appendActivity({
      kind: 'diff',
      title: path,
      detail: diffSummary(oldText, newText),
      preview: previewText(newText || oldText),
      status: 'done'
    });
  }

  private handleWorkflowState(frame: JsonObject): void {
    const phase = String(frame.phase || frame.state || '').trim();
    const detail = String(frame.detail || '').trim();
    this.state.workflowLabel = [phase, detail].filter(Boolean).join(' - ');
    if (phase) this.appendActivity({kind: 'workflow', title: phase, detail, status: phase === 'idle' ? 'done' : 'running'});
    this.emitChange();
  }

  private handleAuxiliaryFrame(frame: JsonObject): void {
    const type = String(frame.type || '');
    if (type.startsWith('subagent:')) {
      const verb = type.slice('subagent:'.length);
      this.appendActivity({
        kind: 'subagent',
        title: `subagent ${verb}`,
        detail: String(frame.taskId || frame.name || ''),
        preview: String(frame.line || frame.text || frame.error || frame.status || ''),
        status: verb === 'done' ? 'done' : verb === 'error' ? 'error' : 'running'
      });
      return;
    }
    if (type.startsWith('task:')) {
      const verb = type.slice('task:'.length);
      this.appendActivity({
        kind: 'task',
        title: `task ${verb}`,
        detail: String(frame.title || frame.name || frame.id || ''),
        preview: String(frame.status || frame.detail || frame.text || ''),
        status: verb === 'done' || frame.status === 'completed' ? 'done' : frame.status === 'error' ? 'error' : 'running'
      });
    }
  }

  private projectContext(): ProjectContext {
    return buildProjectContext(this.cwd, this.state.planMode ? 'plan' : 'execute', this.state.scope);
  }

  private push(role: ChatMessage['role'], text: string): void {
    if (!text) return;
    this.state.messages.push({role, text, timestamp: Date.now()});
    if (role === 'error') writeDebugLog(this.cfg, this.sessionId, text);
    this.emitChange();
  }

  private setStatus(status: string): void {
    this.state.status = status;
    this.emitChange();
  }

  private emitChange(): void {
    this.emit('change', this.state);
  }

  private appendThinking(text: string): void {
    if (!text) return;
    const last = this.state.activity[this.state.activity.length - 1];
    if (last?.kind === 'thinking' && last.status === 'running') {
      last.preview = `${last.preview || ''}${text}`.slice(-1200);
      last.detail = `${(last.preview || '').length} chars`;
      last.timestamp = Date.now();
      this.emitChange();
      return;
    }
    this.appendActivity({kind: 'thinking', title: 'thinking', preview: text, detail: `${text.length} chars`, status: 'running'});
  }

  private appendActivity(entry: Omit<ActivityEntry, 'id' | 'timestamp'>): void {
    this.state.activity.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: Date.now(),
      ...entry
    });
    if (this.state.activity.length > 120) this.state.activity.splice(0, this.state.activity.length - 120);
    this.emitChange();
  }

  private appendOutput(source: string, text: string): void {
    if (!text) return;
    this.state.outputLog.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      source,
      text,
      timestamp: Date.now()
    });
    if (this.state.outputLog.length > 400) this.state.outputLog.splice(0, this.state.outputLog.length - 400);
    this.emitChange();
  }

  private recordToolDone(name: string, input: unknown, result: unknown, ms: number): void {
    const status = resultLooksFailed(result) ? 'error' : 'done';
    const inputMap = isObject(input) ? input : {};
    this.appendActivity({
      kind: toolActivityKind(name),
      title: toolTitle(name, inputMap),
      detail: `${name} · ${ms}ms`,
      preview: previewResult(result),
      status
    });
    if (name === 'exec' || name === 'powershell_exec' || name === 'run_tests') {
      const output = isObject(result) ? String(result.output || result.error || '') : String(result || '');
      if (output) this.appendOutput(name, output);
    }
  }
}

export function isPlanReady(text: string): boolean {
  return /(^|\n)\s*PLAN_READY\s*($|\n)/.test(text);
}

export function parsePlanQuestions(text: string): QuestionState | null {
  const json = parseQuestionJsonBlock(text);
  if (json) return json;
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(line => /^\s*QUESTIONS:\s*$/i.test(line));
  if (start < 0) return null;
  const questionLines: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*PLAN_READY\s*$/i.test(line)) break;
    if (!line.trim() && questionLines.length) break;
    if (!line.trim()) continue;
    if (/^\s*\d+[.)]\s+/.test(line) || questionLines.length) questionLines.push(line.trim());
  }
  if (!questionLines.length) return null;
  const options: {label: string; description?: string}[] = [];
  const rendered = questionLines.map(line => {
    const m = line.match(/^\s*\d+[.)]\s*(.+)$/);
    const body = m ? m[1]! : line;
    const single = body.match(/\[([^\]]+)]\s*$/);
    const multi = body.match(/\{([^}]+)}\s*$/);
    const optRaw = single?.[1] || multi?.[1] || '';
    if (optRaw) {
      for (const label of optRaw.split('/').map(s => s.trim()).filter(Boolean)) {
        if (!options.some(o => o.label === label)) options.push({label});
      }
    }
    return body;
  }).join('\n');
  return {
    qid: `plan-${Date.now()}`,
    question: rendered,
    mode: options.length ? 'single' : 'open',
    multi: false,
    options,
    source: 'plan'
  };
}

function parseQuestionJsonBlock(text: string): QuestionState | null {
  const match = text.match(/QUESTIONS?\s*:\s*```(?:json)?\s*([\s\S]*?)```/i);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1] || '[]') as Array<Record<string, unknown>>;
    if (!Array.isArray(parsed) || !parsed.length) return null;
    const first = parsed[0]!;
    const mode = String(first.type || first.mode || 'open');
    const options = normalizeQuestionOptions(first.options);
    return {
      qid: `plan-${Date.now()}`,
      question: parsed.map((q, i) => `${i + 1}. ${String(q.text || q.question || '').trim()}`).join('\n'),
      mode,
      multi: mode === 'multi' || first.multi === true,
      options,
      source: 'plan'
    };
  } catch {
    return null;
  }
}

function normalizeQuestionOptions(raw: unknown): {label: string; description?: string}[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(item => {
    if (typeof item === 'string') return {label: item};
    if (isObject(item)) return {label: String(item.label || item.value || ''), description: typeof item.description === 'string' ? item.description : undefined};
    return {label: String(item)};
  }).filter(option => option.label.trim());
}

export function normalizeQuestionAnswer(
  raw: string,
  options: {label: string; description?: string}[],
  multi: boolean
): {answer: string; answers: string[]} {
  const trimmed = raw.trim();
  if (!options.length) return {answer: trimmed, answers: trimmed ? [trimmed] : []};
  const parts = multi ? trimmed.split(/[,\n]/).map(s => s.trim()).filter(Boolean) : [trimmed];
  const answers = parts.map(part => {
    const n = Number(part);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1]!.label;
    const exact = options.find(o => o.label.toLowerCase() === part.toLowerCase());
    return exact?.label || part;
  }).filter(Boolean);
  return {answer: answers.join(', '), answers};
}

function summarizeInput(input: unknown): string {
  if (!isObject(input)) return '';
  const path = firstString(input, ['path', 'file', 'dir', 'directory', 'cwd', 'url']);
  if (path) return path;
  const cmd = firstString(input, ['command', 'cmd', 'script']);
  if (cmd) return truncate(cmd, 160);
  return truncate(JSON.stringify(input), 160);
}

function durationDetail(frame: JsonObject): string {
  const ms = Number(frame.durationMs || frame.duration_ms || 0);
  return ms > 0 ? `${ms}ms` : '';
}

function contextSuffix(frame: JsonObject): string {
  const remaining = contextRemainingPercent(frame);
  return remaining === null ? '' : ` - context ${remaining}% left`;
}

function contextRemainingPercent(frame: JsonObject): number | null {
  const direct = Number(frame.remainingPercent || frame.remaining_percent || 0);
  if (direct > 0) return clampPercent(direct);
  const used = Number(frame.usedPercent || frame.used_percent || 0);
  if (used > 0) return clampPercent(100 - used);
  const after = Number(frame.afterTokens || frame.after_tokens || 0);
  const before = Number(frame.beforeTokens || frame.before_tokens || 0);
  const limit = Number(frame.limitTokens || frame.limit_tokens || 0);
  const basis = after || before;
  if (basis > 0 && limit > 0) return clampPercent(100 - Math.round((basis / limit) * 100));
  return null;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function previewText(text: string, max = 360): string {
  return truncate(text.split(/\r?\n/).filter(line => line.trim()).slice(0, 6).join('\n'), max);
}

function diffSummary(oldText: string, newText: string): string {
  const oldLines = oldText ? oldText.split(/\r?\n/).length : 0;
  const newLines = newText ? newText.split(/\r?\n/).length : 0;
  return `+${newLines} / -${oldLines} lines`;
}

function resultLooksFailed(result: unknown): boolean {
  if (!isObject(result)) return false;
  if (result.ok === false || result.blocked === true || result.error) return true;
  const exit = Number(result.exitCode ?? result.exit ?? 0);
  return Number.isFinite(exit) && exit !== 0;
}

function toolActivityKind(name: string): ActivityKind {
  if (name === 'read_file' || name === 'write_file' || name === 'read_many_files' || name === 'list_dir') return 'file';
  if (name === 'edit_file' || name === 'patch_file' || name === 'code_diff') return 'diff';
  return 'tool';
}

function toolTitle(name: string, input: JsonObject): string {
  const target = firstString(input, ['path', 'file', 'dir', 'directory', 'cwd']);
  if (target) return target;
  return name;
}

function previewResult(result: unknown): string {
  if (result === null || result === undefined) return '';
  if (typeof result === 'string') return truncate(result, 360);
  if (!isObject(result)) return truncate(String(result), 360);
  const output = String(result.output || result.content || result.error || result.note || '');
  if (output) return previewText(output);
  return truncate(JSON.stringify(result), 360);
}

function firstString(obj: JsonObject, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}...` : text;
}

function hasPlanControl(text: string, marker: string): boolean {
  return new RegExp(`(^|\\n)\\s*${marker}\\s*:?(\\s|$)`, 'i').test(text);
}

function cleanPlanControlText(text: string): string {
  const control = /^(?:\s*)(RESEARCH_DONE|NO_INTERVIEW_NEEDED|NO_FOLLOWUP_QUESTIONS)\s*:?.*$/i;
  return text.split(/\r?\n/).filter(line => !control.test(line)).join('\n').trim();
}

function helpText(): string {
  return [
    'Commands:',
    '/plan - toggle plan/execute mode',
    '/new - start a fresh session in this cwd',
    '/sessions - list saved sessions for this project',
    '/resume <id|n> - resume a saved session',
    '/context [refresh] - show structured project context',
    '/tree [depth] - show project tree',
    '/init - create SPORE.md and ignore .spore-code/',
    '/index, /architecture, /impact <symbol>, /calls <symbol> - code index tools',
    '/bg [list|<id>|run <command>|kill <id>] - background processes',
    '/models_preset [name|server] - device routing preset',
    '/mode auto|ask|locked|yolo - permission mode',
    '/scope strict|expanded - file tool scope',
    '/delegate default|off|research|code|all - delegation preference',
    '/panel, /output - toggle UI panels',
    '/status, /decisions, /stop, /clear, /quit'
  ].join('\n');
}

function projectTreeString(root: string, maxDepth: number, maxEntries: number): string {
  const skip = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.spore-code', 'target', '.next', '.cache']);
  const lines = [`${path.basename(root) || root}/`];
  let count = 0;
  const walk = (dir: string, prefix: string, depth: number): void => {
    if (depth > maxDepth || count >= maxEntries) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, {withFileTypes: true});
    } catch {
      return;
    }
    entries = entries
      .filter(entry => !(entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.gitignore'))
      .filter(entry => !(entry.isDirectory() && skip.has(entry.name)))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    entries.forEach((entry, index) => {
      if (count >= maxEntries) return;
      const last = index === entries.length - 1;
      lines.push(`${prefix}${last ? '`-- ' : '|-- '}${entry.name}${entry.isDirectory() ? '/' : ''}`);
      count++;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${prefix}${last ? '    ' : '|   '}`, depth + 1);
    });
  };
  walk(root, '', 1);
  if (count >= maxEntries) lines.push('...');
  return lines.join('\n');
}

function timeAgo(ts: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function renderLegacyContext(pc: ProjectContext): string {
  return `[Project Context]\n${JSON.stringify(pc, null, 2)}`;
}

function logo(): string {
  return `███████╗██████╗  ██████╗ ██████╗ ███████╗     ██████╗ ██████╗ ██████╗ ███████╗
██╔════╝██╔══██╗██╔═══██╗██╔══██╗██╔════╝    ██╔════╝██╔═══██╗██╔══██╗██╔════╝
███████╗██████╔╝██║   ██║██████╔╝█████╗      ██║     ██║   ██║██║  ██║█████╗
╚════██║██╔═══╝ ██║   ██║██╔══██╗██╔══╝      ██║     ██║   ██║██║  ██║██╔══╝
███████║██║     ╚██████╔╝██║  ██║███████╗    ╚██████╗╚██████╔╝██████╔╝███████╗
╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝╚══════╝     ╚═════╝ ╚═════╝ ╚═════╝╚══════╝`;
}
