export interface JsonlEvent {
  type: "assistant" | "tool" | "file-history-snapshot" | "user" | "summary";
  parentUuid?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  timestamp?: string;
  version?: string;
  isSidechain?: boolean;
  userType?: string;
}

export interface AssistantEvent extends JsonlEvent {
  type: "assistant";
  message: {
    id: string;
    role: "assistant";
    model: string;
    content: ContentBlock[];
    stop_reason?: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

export interface UserEvent extends JsonlEvent {
  type: "user";
  message: {
    role: "user";
    content: string | ContentBlock[];
  };
}

export interface ToolEvent extends JsonlEvent {
  type: "tool";
  content: ContentBlock[];
}

export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock
  | ImageBlock;

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | ContentBlock[];
  is_error?: boolean;
}

export interface ImageBlock {
  type: "image";
  source: unknown;
}

// ── Kanban domain types ───────────────────────────────────────

export interface KanbanTask {
  id: string;
  title: string;
  userInput: string;
  status: "plan" | "in_progress" | "done";
  toolCalls: ToolCall[];
  thinkingBlocks: string[];
  responses: string[];
  startedAt: Date;
  durationMs?: number;
  tokenUsage: { input: number; output: number };
  sessionId: string;
  gitBranch?: string;
  cwd?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: "running" | "success" | "error";
  durationMs?: number;
  startedAt: Date;
}

export interface ClaudeSession {
  id: string;
  projectPath: string;
  projectName: string;
  gitBranch?: string;
  model?: string;
  tasks: KanbanTask[];
  isLive: boolean;
  totalTokens: { input: number; output: number };
  startedAt?: Date;
  lastUpdatedAt?: Date;
  filePath: string;
}

export interface ProjectGroup {
  name: string;
  path: string;
  sessions: ClaudeSession[];
  hasLiveSession: boolean;
}

// ── Extension ↔ Webview message types ───────────────────────

export type ExtensionMessage =
  | { type: "init"; projects: ProjectGroup[]; activeSessionId?: string }
  | { type: "sessionData"; session: ClaudeSession }
  | { type: "sessionLive"; sessionId: string };

export type WebviewMessage =
  | { type: "selectSession"; sessionId: string }
  | { type: "moveTask"; taskId: string; newStatus: KanbanTask["status"] }
  | { type: "ready" };
