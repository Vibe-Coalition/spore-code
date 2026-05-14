export type JsonObject = Record<string, unknown>;

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface ProjectContext {
  cwd: string;
  project: string;
  gitBranch?: string;
  gitStatus?: string;
  gitHash?: string;
  projectType?: string;
  sporeMd?: string;
  tree?: string[];
  tools?: string[];
  localTools?: string[];
  toolGuidance?: string[];
  mode?: 'plan' | 'execute';
  os?: string;
  arch?: string;
  defaultShell?: string;
  shellFlag?: string;
  shellFamily?: string;
  availableShells?: string[];
  pathSeparator?: string;
  pathListSeparator?: string;
  scope?: 'strict' | 'expanded' | '';
  hasCodeIndex?: boolean;
  indexHead?: string;
  hardware?: {
    kernel?: string;
    cpuModel?: string;
    cpuCores?: number;
    ramGi?: number;
    gpu?: string[];
  };
}

export interface ServerCapabilities {
  type: 'capabilities';
  projectContext?: boolean;
  sporeVersion?: string;
  agentName?: string;
  agentDisplayName?: string;
  assistantName?: string;
}

export interface ToolRequest {
  type: 'tool:request';
  id: string;
  name: string;
  input?: JsonObject;
}

export interface AskUserOption {
  label: string;
  description?: string;
}

export interface AskUserFrame {
  type: 'ask_user';
  qid: string;
  question: string;
  mode?: 'single' | 'multi' | 'open' | string;
  options?: AskUserOption[];
  multi?: boolean;
}

export type InboundFrame =
  | ServerCapabilities
  | ToolRequest
  | AskUserFrame
  | ({ type: string } & JsonObject);

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'error';
  text: string;
  timestamp: number;
  streaming?: boolean;
}

export interface ChatDone {
  type: 'chat:done';
  text?: string;
  usage?: Usage;
  iterations?: number;
  toolUsage?: Record<string, number>;
  hiddenWorkflowControl?: string;
}

export interface ConnectionConfig {
  host: string;
  port: number;
  user: string;
  auth_method: 'device' | 'password' | 'invite';
  key?: string;
  password?: string;
  device_id?: string;
}

export interface DisplayConfig {
  theme: 'dark' | 'light' | 'oled' | string;
  show_thinking: boolean;
  show_tools: boolean;
  show_usage: boolean;
}

export interface SessionConfig {
  auto_resume: boolean;
}

export interface SporeConfig {
  connection: ConnectionConfig;
  display: DisplayConfig;
  session: SessionConfig;
  globalDir: string;
  localDir: string;
}
