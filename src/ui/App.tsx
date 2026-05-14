import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useApp, useInput, useStdout} from 'ink';
import {
  slashCommandCompletion,
  slashCommandSuggestions,
  type ActivityEntry,
  type ClientState,
  type OutputEntry,
  type SporeController
} from '../controller.js';

interface Props {
  controller: SporeController;
}

type PanelFocus = 'chat' | 'activity' | 'output';

interface ScrollState {
  chat: number;
  activity: number;
  output: number;
}

interface Palette {
  accent: string;
  border: string;
  muted: string;
  success: string;
  warning: string;
  error: string;
  assistant: string;
  user: string;
  system: string;
  tool: string;
  panel: string;
}

const COMPOSER_LINES = 10;

export function App({controller}: Props) {
  const {stdout} = useStdout();
  const [state, setState] = useState<ClientState>({...controller.state, messages: [...controller.state.messages]});
  const [focus, setFocus] = useState<PanelFocus>('chat');
  const [scroll, setScroll] = useState<ScrollState>({chat: 0, activity: 0, output: 0});

  const columns = Math.max(80, stdout.columns || 100);
  const rows = Math.max(24, stdout.rows || 32);
  const palette = useMemo(() => paletteFor(state.theme), [state.theme]);
  const activitySide = state.activityPanelOpen && columns >= 94;
  const artifact = latestArtifact(state.activity);
  const safeRows = Math.max(18, rows - 1);
  const modalHeight = state.pendingApproval ? 5 : state.pendingQuestion ? Math.min(6, 3 + state.pendingQuestion.options.length) : state.pendingPlan ? 3 : 0;
  const usageHeight = state.usageLine ? 1 : 0;
  let panelRows = Math.max(3, safeRows - 1 - COMPOSER_LINES - modalHeight - usageHeight);
  const outputPanelHeight = state.outputLogOpen && panelRows >= 10 ? Math.min(6, Math.max(3, Math.floor(panelRows * 0.25))) : 0;
  panelRows -= outputPanelHeight;
  const artifactPanelHeight = artifact && panelRows >= 10 ? Math.min(5, Math.max(3, Math.floor(panelRows * 0.25))) : 0;
  panelRows -= artifactPanelHeight;
  const stackedActivityHeight = !activitySide && state.activityPanelOpen && panelRows >= 9 ? Math.min(5, Math.max(3, Math.floor(panelRows * 0.35))) : 0;
  const chatPanelHeight = Math.max(3, panelRows - stackedActivityHeight);
  const activityPanelHeight = activitySide ? chatPanelHeight : stackedActivityHeight;
  const chatVisibleCount = Math.max(1, Math.floor((chatPanelHeight - 2) / 3));
  const chatTextLineLimit = Math.max(1, Math.min(6, chatPanelHeight - 3));
  const activityVisibleCount = Math.max(1, Math.floor((activityPanelHeight - 2) / 3));
  const outputVisibleCount = Math.max(1, outputPanelHeight - 2);
  const artifactVisibleCount = Math.max(1, artifactPanelHeight - 2);

  useEffect(() => {
    const onChange = (next: ClientState) => setState({...next, messages: [...next.messages]});
    controller.on('change', onChange);
    void controller.start().catch(err => controller.reportError(err));
    return () => {
      controller.off('change', onChange);
      controller.close();
    };
  }, [controller]);

  useEffect(() => {
    setScroll(prev => ({
      chat: clamp(prev.chat, 0, maxScroll('chat', state, chatVisibleCount, activityVisibleCount, outputVisibleCount)),
      activity: clamp(prev.activity, 0, maxScroll('activity', state, chatVisibleCount, activityVisibleCount, outputVisibleCount)),
      output: clamp(prev.output, 0, maxScroll('output', state, chatVisibleCount, activityVisibleCount, outputVisibleCount))
    }));
  }, [state.messages.length, state.activity.length, state.outputLog.length, chatVisibleCount, activityVisibleCount, outputVisibleCount]);

  const scrollPanel = (target: PanelFocus, delta: number) => {
    setScroll(prev => {
      const next = {...prev};
      next[target] = clamp(next[target] + delta, 0, maxScroll(target, state, chatVisibleCount, activityVisibleCount, outputVisibleCount));
      return next;
    });
  };

  const scrollTo = (target: PanelFocus, value: number) => {
    setScroll(prev => ({
      ...prev,
      [target]: clamp(value, 0, maxScroll(target, state, chatVisibleCount, activityVisibleCount, outputVisibleCount))
    }));
  };

  const visibleMessages = sliceFromEnd(state.messages, chatVisibleCount, scroll.chat);
  return (
    <Box flexDirection="column" height={safeRows} overflow="hidden">
      <Box justifyContent="space-between">
        <Text color={state.connected ? palette.success : palette.warning}>spore code npm</Text>
        <Text color={palette.muted}>
          {state.planMode ? 'PLAN' : 'EXEC'} · {state.scope || 'strict'} · perm:{state.permissionMode}
          {state.workflowLabel ? ` · ${state.workflowLabel}` : ''} · {state.status}
        </Text>
      </Box>
      <Box flexDirection="row" height={chatPanelHeight} overflow="hidden">
        <Box borderStyle="single" borderColor={focus === 'chat' ? palette.accent : palette.border} flexDirection="column" paddingX={1} flexGrow={1} height={chatPanelHeight} overflow="hidden">
          <PanelHeader label="Chat" count={state.messages.length} scroll={scroll.chat} palette={palette} focused={focus === 'chat'} />
          {visibleMessages.map((m, i) => (
            <Box key={`${m.timestamp}-${i}`} flexDirection="column">
              <Text color={roleColor(m.role, palette)}>{m.role}{m.streaming ? ' streaming' : ''}</Text>
              {m.text.split('\n').slice(0, chatTextLineLimit).map((line, j) => <Text key={j}>{clip(line || ' ', activitySide ? columns - 58 : columns - 6)}</Text>)}
            </Box>
          ))}
          {visibleMessages.length === 0 && <Text color={palette.muted}>Connecting...</Text>}
        </Box>
        {activitySide && <ActivityPanel entries={state.activity} offset={scroll.activity} visibleCount={activityVisibleCount} focused={focus === 'activity'} palette={palette} height={activityPanelHeight} />}
      </Box>
      {state.activityPanelOpen && !activitySide && activityPanelHeight > 0 && <ActivityPanel entries={state.activity} offset={scroll.activity} visibleCount={activityVisibleCount} focused={focus === 'activity'} palette={palette} height={activityPanelHeight} />}
      {artifact && artifactPanelHeight > 0 && <ArtifactPanel entry={artifact} palette={palette} visibleCount={artifactVisibleCount} height={artifactPanelHeight} />}
      {state.outputLogOpen && outputPanelHeight > 0 && <OutputPanel entries={state.outputLog} offset={scroll.output} visibleCount={outputVisibleCount} focused={focus === 'output'} palette={palette} height={outputPanelHeight} />}
      {state.pendingApproval && (
        <Box borderStyle="round" borderColor={palette.warning} flexDirection="column" paddingX={1} height={modalHeight} overflow="hidden">
          <Text color={palette.warning}>Allow {state.pendingApproval.name}?</Text>
          <Text>{state.pendingApproval.summary}</Text>
          <Text color={palette.muted}>Session rule: {state.pendingApproval.rule}</Text>
          <Text color={palette.muted}>y/Enter allow once · a allow session · n/Esc deny</Text>
        </Box>
      )}
      {state.pendingQuestion && (
        <Box borderStyle="round" borderColor={palette.panel} flexDirection="column" paddingX={1} height={modalHeight} overflow="hidden">
          <Text color={palette.panel}>{state.pendingQuestion.question}</Text>
          {state.pendingQuestion.options.map((o, i) => <Text key={o.label}>{i + 1}. {o.label}{o.description ? ` - ${o.description}` : ''}</Text>)}
          <Text color={palette.muted}>{state.pendingQuestion.multi ? 'Type numbers or labels separated by commas, then Enter.' : 'Type an answer or option number and press Enter.'}</Text>
        </Box>
      )}
      {state.pendingPlan && (
        <Box borderStyle="round" borderColor={palette.panel} flexDirection="column" paddingX={1} height={modalHeight} overflow="hidden">
          <Text color={palette.panel}>Plan ready</Text>
          <Text>{state.pendingPlan.awaitingFeedback ? 'Type revision feedback and press Enter.' : 'Press e/Enter to execute, r to revise, c/Esc to cancel.'}</Text>
        </Box>
      )}
      {state.usageLine && <Text color={palette.muted}>{state.usageLine}</Text>}
      <Composer
        controller={controller}
        state={state}
        focus={focus}
        setFocus={setFocus}
        scrollPanel={scrollPanel}
        scrollTo={scrollTo}
      />
    </Box>
  );
}

interface ComposerProps {
  controller: SporeController;
  state: ClientState;
  focus: PanelFocus;
  setFocus: React.Dispatch<React.SetStateAction<PanelFocus>>;
  scrollPanel: (target: PanelFocus, delta: number) => void;
  scrollTo: (target: PanelFocus, value: number) => void;
}

function Composer({controller, state, focus, setFocus, scrollPanel, scrollTo}: ComposerProps) {
  const app = useApp();
  const inputRef = useRef('');
  const suggestionIndexRef = useRef(0);
  const previousComposerLinesRef = useRef(COMPOSER_LINES);

  const drawComposer = () => {
    if (!process.stdout.isTTY) return;
    const lines = renderComposerLines({
      input: inputRef.current,
      suggestionIndex: suggestionIndexRef.current,
      state,
      focus,
      width: process.stdout.columns || 100
    });
    process.stdout.write(erasePreviousLines(previousComposerLinesRef.current) + lines.join('\n') + '\n');
    previousComposerLinesRef.current = lines.length;
  };

  useEffect(() => {
    previousComposerLinesRef.current = COMPOSER_LINES;
    drawComposer();
  });

  useInput((chunk, key) => {
    const isTab = Boolean((key as {tab?: boolean}).tab || chunk === '\t');
    const input = inputRef.current;
    const slashSuggestions = slashCommandSuggestions(input, 8);
    const showSlashSuggestions = input.startsWith('/') && slashSuggestions.length > 0 && !state.pendingApproval && !state.pendingPlan && !state.pendingQuestion;
    if (key.ctrl && chunk === 'c') {
      if (state.generating) controller.stop();
      else {
        controller.close();
        app.exit();
      }
      return;
    }
    if (key.ctrl && chunk === 'p') {
      controller.toggleActivityPanel();
      setFocus('activity');
      return;
    }
    if (key.ctrl && chunk === 'o') {
      controller.toggleOutputLog();
      setFocus('output');
      return;
    }
    if (isTab && !state.pendingApproval && !state.pendingPlan && !state.pendingQuestion) {
      if (showSlashSuggestions) {
        inputRef.current = slashCommandCompletion(inputRef.current, suggestionIndexRef.current);
        suggestionIndexRef.current = 0;
        drawComposer();
        return;
      }
      setFocus(prev => nextFocus(prev, state));
      return;
    }
    if ((key as {pageUp?: boolean}).pageUp || (key.ctrl && chunk === 'u')) {
      scrollPanel(focus, 5);
      return;
    }
    if ((key as {pageDown?: boolean}).pageDown || (key.ctrl && chunk === 'd')) {
      scrollPanel(focus, -5);
      return;
    }
    if ((key as {home?: boolean}).home) {
      scrollTo(focus, Number.MAX_SAFE_INTEGER);
      return;
    }
    if ((key as {end?: boolean}).end) {
      scrollTo(focus, 0);
      return;
    }
    if (state.pendingApproval) {
      if (chunk.toLowerCase() === 'a') controller.resolveApproval(true, true);
      if (chunk.toLowerCase() === 'y' || key.return) controller.resolveApproval(true);
      if (chunk.toLowerCase() === 'n' || key.escape) controller.resolveApproval(false);
      return;
    }
    if (state.pendingPlan) {
      if (state.pendingPlan.awaitingFeedback) {
        if (key.ctrl && (chunk === 'j' || chunk === '\n')) {
          inputRef.current = `${inputRef.current}\n`;
          drawComposer();
        } else if (key.return) {
          controller.resolvePlan('revise', inputRef.current.trim());
          inputRef.current = '';
          suggestionIndexRef.current = 0;
          drawComposer();
        } else if (key.backspace || key.delete) {
          inputRef.current = inputRef.current.slice(0, -1);
          drawComposer();
        } else if (chunk && !key.ctrl && !key.meta) {
          inputRef.current += chunk;
          drawComposer();
        }
        return;
      }
      if (chunk.toLowerCase() === 'e' || key.return) controller.resolvePlan('execute');
      if (chunk.toLowerCase() === 'r') controller.resolvePlan('revise');
      if (chunk.toLowerCase() === 'c' || key.escape) controller.resolvePlan('cancel');
      return;
    }
    if (state.pendingQuestion) {
      if (key.ctrl && (chunk === 'j' || chunk === '\n')) {
        inputRef.current = `${inputRef.current}\n`;
        drawComposer();
      } else if (key.return) {
        controller.answerQuestion(inputRef.current.trim());
        inputRef.current = '';
        suggestionIndexRef.current = 0;
        drawComposer();
      } else if (key.backspace || key.delete) {
        inputRef.current = inputRef.current.slice(0, -1);
        drawComposer();
      } else if (chunk && !key.ctrl && !key.meta) {
        inputRef.current += chunk;
        drawComposer();
      }
      return;
    }
    if (showSlashSuggestions && key.upArrow) {
      suggestionIndexRef.current = clamp(suggestionIndexRef.current - 1, 0, slashSuggestions.length - 1);
      drawComposer();
      return;
    }
    if (showSlashSuggestions && key.downArrow) {
      suggestionIndexRef.current = clamp(suggestionIndexRef.current + 1, 0, slashSuggestions.length - 1);
      drawComposer();
      return;
    }
    if (key.upArrow) {
      inputRef.current = controller.historyPrevious(inputRef.current);
      suggestionIndexRef.current = 0;
      drawComposer();
      return;
    }
    if (key.downArrow) {
      inputRef.current = controller.historyNext();
      suggestionIndexRef.current = 0;
      drawComposer();
      return;
    }
    if (key.ctrl && (chunk === 'j' || chunk === '\n')) {
      inputRef.current = `${inputRef.current}\n`;
      drawComposer();
      return;
    }
    if (key.return) {
      const text = inputRef.current;
      inputRef.current = '';
      suggestionIndexRef.current = 0;
      drawComposer();
      controller.historyReset();
      if (text.trim() === '/quit' || text.trim() === '/exit') {
        controller.close();
        app.exit();
      } else {
        controller.sendUser(text);
      }
      return;
    }
    if (key.backspace || key.delete) {
      inputRef.current = inputRef.current.slice(0, -1);
      drawComposer();
      return;
    }
    if (chunk && !key.ctrl && !key.meta) {
      inputRef.current += chunk;
      suggestionIndexRef.current = 0;
      drawComposer();
    }
  });

  return (
    <Box flexDirection="column">
      {Array.from({length: COMPOSER_LINES}, (_, index) => <Text key={index}> </Text>)}
    </Box>
  );
}

function renderComposerLines({
  input,
  suggestionIndex,
  state,
  focus,
  width
}: {
  input: string;
  suggestionIndex: number;
  state: ClientState;
  focus: PanelFocus;
  width: number;
}): string[] {
  const safeWidth = Math.max(40, width);
  const innerWidth = safeWidth - 2;
  const border = `+${'-'.repeat(innerWidth)}+`;
  const lines: string[] = [border];
  const inputLines = input.split('\n').slice(-3);
  const visibleInput = inputLines.length ? inputLines : [''];
  for (let i = 0; i < 3; i++) {
    const prefix = i === 0 ? '> ' : '. ';
    lines.push(frameLine(`${prefix}${visibleInput[i] || ''}`, innerWidth));
  }
  lines.push(border);

  const suggestions = slashCommandSuggestions(input, 8);
  const showSuggestions = input.startsWith('/') && suggestions.length > 0 && !state.pendingApproval && !state.pendingPlan && !state.pendingQuestion;
  if (showSuggestions) {
    lines.push(rawLine('Tab complete - Up/Down choose - Enter runs command', safeWidth));
    suggestions.slice(0, 4).forEach((command, index) => {
      const marker = index === suggestionIndex ? '> ' : '  ';
      lines.push(rawLine(`${marker}${command.usage} - ${command.description}`, safeWidth));
    });
  } else {
    const hint = state.generating
      ? 'working; Ctrl+C stops'
      : 'Ctrl+P activity - Ctrl+O output - Tab focus - PgUp/PgDn scroll';
    lines.push(rawLine(`${hint} - focus:${focus}`, safeWidth));
    if (state.pendingPlan?.awaitingFeedback) lines.push(rawLine('Type revision feedback and press Enter.', safeWidth));
    else if (state.pendingQuestion) lines.push(rawLine('Type an answer or option number and press Enter.', safeWidth));
    else if (input.includes('\n')) lines.push(rawLine('multiline - Enter sends - Ctrl+J inserts another line', safeWidth));
  }

  while (lines.length < COMPOSER_LINES) lines.push(' '.repeat(safeWidth));
  return lines.slice(0, COMPOSER_LINES).map(line => rawLine(line, safeWidth));
}

function erasePreviousLines(count: number): string {
  if (count <= 0) return '';
  let out = '';
  for (let i = 0; i < count; i++) out += '\x1b[1A\x1b[2K';
  return `${out}\r`;
}

function frameLine(text: string, innerWidth: number): string {
  const fitted = fitPlain(text, innerWidth - 2);
  return `| ${fitted}${' '.repeat(Math.max(0, innerWidth - 2 - fitted.length))} |`;
}

function rawLine(text: string, width: number): string {
  const fitted = fitPlain(text, width);
  return `${fitted}${' '.repeat(Math.max(0, width - fitted.length))}`;
}

function fitPlain(text: string, width: number): string {
  if (text.length <= width) return text;
  if (width <= 3) return '.'.repeat(Math.max(0, width));
  return `${text.slice(0, width - 3)}...`;
}

function PanelHeader({label, count, scroll, palette, focused}: {label: string; count: number; scroll: number; palette: Palette; focused: boolean}) {
  return (
    <Text color={focused ? palette.accent : palette.muted}>
      {label} · {count}{scroll ? ` · scrolled ${scroll}` : ''}
    </Text>
  );
}

function ActivityPanel({entries, offset, visibleCount, focused, palette, height}: {entries: ActivityEntry[]; offset: number; visibleCount: number; focused: boolean; palette: Palette; height: number}) {
  const visible = sliceFromEnd(entries, visibleCount, offset);
  return (
    <Box borderStyle="single" borderColor={focused ? palette.accent : palette.panel} flexDirection="column" paddingX={1} width={focused ? 48 : 44} height={height} overflow="hidden">
      <PanelHeader label="Activity" count={entries.length} scroll={offset} palette={palette} focused={focused} />
      {visible.length === 0 && <Text color={palette.muted}>No activity yet.</Text>}
      {visible.map(entry => (
        <Box key={entry.id} flexDirection="column">
          <Text color={activityColor(entry, palette)}>
            {activityIcon(entry)} {entry.title}{entry.detail ? ` · ${entry.detail}` : ''}
          </Text>
          {entry.preview && <Text color={palette.muted}>{clip(entry.preview.replace(/\r?\n/g, ' | '), 86)}</Text>}
        </Box>
      ))}
      {entries.length > visible.length && <Text color={palette.muted}>PgUp/PgDn scroll · Ctrl+P hides</Text>}
    </Box>
  );
}

function ArtifactPanel({entry, palette, visibleCount, height}: {entry: ActivityEntry; palette: Palette; visibleCount: number; height: number}) {
  const lines = (entry.preview || '').split(/\r?\n/).slice(0, visibleCount);
  return (
    <Box borderStyle="single" borderColor={entry.kind === 'diff' ? palette.warning : palette.panel} flexDirection="column" paddingX={1} height={height} overflow="hidden">
      <Text color={entry.kind === 'diff' ? palette.warning : palette.panel}>{entry.kind === 'diff' ? 'Diff' : 'File'} · {entry.title}{entry.detail ? ` · ${entry.detail}` : ''}</Text>
      {lines.length ? lines.map((line, i) => <Text key={i} color={palette.muted}>{clip(line || ' ', 180)}</Text>) : <Text color={palette.muted}>No preview available.</Text>}
    </Box>
  );
}

function OutputPanel({entries, offset, visibleCount, focused, palette, height}: {entries: OutputEntry[]; offset: number; visibleCount: number; focused: boolean; palette: Palette; height: number}) {
  const visible = sliceFromEnd(entries, visibleCount, offset);
  return (
    <Box borderStyle="single" borderColor={focused ? palette.accent : palette.warning} flexDirection="column" paddingX={1} height={height} overflow="hidden">
      <PanelHeader label="Output Log" count={entries.length} scroll={offset} palette={palette} focused={focused} />
      {visible.length === 0 && <Text color={palette.muted}>No command output captured yet.</Text>}
      {visible.map(entry => (
        <Text key={entry.id} color={palette.muted}>
          {formatTime(entry.timestamp)} {entry.source}: {clip(entry.text.replace(/\r?\n/g, ' | '), 180)}
        </Text>
      ))}
    </Box>
  );
}

function activityIcon(entry: ActivityEntry): string {
  if (entry.status === 'error') return '!';
  if (entry.status === 'done') return '✓';
  switch (entry.kind) {
    case 'thinking': return '...';
    case 'recall': return 'recall';
    case 'task': return 'task';
    case 'subagent': return 'agent';
    default: return '>';
  }
}

function activityColor(entry: ActivityEntry, palette: Palette): string {
  if (entry.status === 'error') return palette.error;
  if (entry.status === 'done') return palette.success;
  if (entry.kind === 'thinking') return palette.panel;
  if (entry.kind === 'recall') return palette.accent;
  if (entry.kind === 'task' || entry.kind === 'subagent') return palette.warning;
  return palette.panel;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}...` : text;
}

function roleColor(role: string, palette: Palette): string {
  if (role === 'assistant') return palette.assistant;
  if (role === 'user') return palette.user;
  if (role === 'error') return palette.error;
  if (role === 'tool') return palette.tool;
  if (role === 'system') return palette.system;
  return palette.muted;
}

function nextFocus(current: PanelFocus, state: ClientState): PanelFocus {
  const order: PanelFocus[] = ['chat'];
  if (state.activityPanelOpen) order.push('activity');
  if (state.outputLogOpen) order.push('output');
  const index = order.indexOf(current);
  return order[(index + 1) % order.length] || 'chat';
}

function maxScroll(target: PanelFocus, state: ClientState, chatCount: number, activityCount: number, outputCount: number): number {
  const count = target === 'chat' ? state.messages.length : target === 'activity' ? state.activity.length : state.outputLog.length;
  const visible = target === 'chat' ? chatCount : target === 'activity' ? activityCount : outputCount;
  return Math.max(0, count - visible);
}

function sliceFromEnd<T>(items: T[], count: number, offset: number): T[] {
  const end = Math.max(0, items.length - offset);
  const start = Math.max(0, end - count);
  return items.slice(start, end);
}

function latestArtifact(entries: ActivityEntry[]): ActivityEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if ((entry.kind === 'file' || entry.kind === 'diff') && entry.preview) return entry;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function paletteFor(theme: string): Palette {
  const normalized = theme.toLowerCase();
  if (normalized.includes('light')) {
    return {
      accent: '#f97316',
      border: '#cbd5e1',
      muted: '#64748b',
      success: '#15803d',
      warning: '#c2410c',
      error: '#dc2626',
      assistant: '#0369a1',
      user: '#15803d',
      system: '#475569',
      tool: '#b45309',
      panel: '#7c3aed'
    };
  }
  if (normalized.includes('oled')) {
    return {
      accent: '#22c55e',
      border: '#404040',
      muted: '#a3a3a3',
      success: '#22c55e',
      warning: '#f59e0b',
      error: '#ef4444',
      assistant: '#38bdf8',
      user: '#22c55e',
      system: '#a3a3a3',
      tool: '#f59e0b',
      panel: '#c084fc'
    };
  }
  return {
    accent: '#8b5cf6',
    border: '#475569',
    muted: '#94a3b8',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#f87171',
    assistant: '#22d3ee',
    user: '#4ade80',
    system: '#94a3b8',
    tool: '#fbbf24',
    panel: '#c084fc'
  };
}
