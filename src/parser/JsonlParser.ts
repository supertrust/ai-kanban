import * as fs from "fs";
import * as path from "path";
import {
  AssistantEvent,
  ClaudeSession,
  JsonlEvent,
  KanbanTask,
  ThinkingBlock,
  ToolCall,
  ToolUseBlock,
  UserEvent,
} from "../types";

// strips IDE context XML tags (e.g. <ide_selection>) from user text
function stripIdeContext(text: string): string {
  return text.replace(/<[a-z_]+>[\s\S]*?<\/[a-z_]+>/g, "").trim();
}

function extractFullInput(event: UserEvent): string {
  const content = event.message.content;
  if (typeof content === "string") {
    return stripIdeContext(content) || content;
  }
  return content
    .filter((b) => b.type === "text")
    .map((b) => stripIdeContext((b as { type: string; text: string }).text))
    .filter(Boolean)
    .join("\n");
}

function extractTitle(event: UserEvent): string {
  const content = event.message.content;
  if (typeof content === "string") {
    return stripIdeContext(content).slice(0, 80) || content.slice(0, 80);
  }
  // prefer blocks with actual user text
  for (const block of content) {
    if (block.type !== "text") continue;
    const stripped = stripIdeContext(
      (block as { type: string; text: string }).text,
    );
    if (stripped) return stripped.slice(0, 80);
  }
  return "Untitled Task";
}

function projectPathFromDir(dirName: string): string {
  // Convert "-Users-mac-Desktop-must-foo" → "/Users/mac/Desktop/must/foo"
  return dirName.replace(/^-/, "/").replace(/-/g, "/");
}

function projectNameFromPath(p: string): string {
  return p.split("/").filter(Boolean).pop() || p;
}

export function parseJsonlFile(filePath: string): ClaudeSession | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const lines = raw.split("\n").filter((l) => l.trim());
  const events: JsonlEvent[] = [];

  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as JsonlEvent);
    } catch {
      // skip malformed lines
    }
  }

  if (events.length === 0) {
    return null;
  }

  // Build session metadata from first event with cwd
  const metaEvent = events.find((e) => e.cwd) as JsonlEvent | undefined;
  const cwd = metaEvent?.cwd ?? "";
  const gitBranch = metaEvent?.gitBranch;
  const sessionId = metaEvent?.sessionId ?? path.basename(filePath, ".jsonl");
  const dirName = path.basename(path.dirname(filePath));
  // Prefer cwd from JSONL events (exact path, no encoding issues).
  // Fallback to dirName decoding for legacy files without cwd.
  const projectPath = cwd || projectPathFromDir(dirName);
  const projectName = projectNameFromPath(projectPath);

  // each user message starts a task; following assistant events build it out
  const tasks: KanbanTask[] = [];
  let currentTask: KanbanTask | null = null;
  let pendingToolCalls: Map<string, ToolCall> = new Map();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    if (event.type === "user") {
      const userEvent = event as UserEvent;
      const rawContent = userEvent.message.content;

      // Claude Code sends tool_results as user events; resolve before real-text check
      if (Array.isArray(rawContent) && currentTask) {
        for (const block of rawContent) {
          const b = block as {
            type: string;
            tool_use_id?: string;
            is_error?: boolean;
          };
          if (b.type === "tool_result" && b.tool_use_id) {
            const toolCall = pendingToolCalls.get(b.tool_use_id);
            if (toolCall) {
              toolCall.status = b.is_error ? "error" : "success";
              if (toolCall.startedAt && event.timestamp) {
                toolCall.durationMs =
                  new Date(event.timestamp).getTime() -
                  toolCall.startedAt.getTime();
              }
            }
          }
        }
      }

      // skip if message is only tool_results or IDE context
      let hasRealText: boolean;
      if (typeof rawContent === "string") {
        hasRealText = stripIdeContext(rawContent).length > 0;
      } else {
        hasRealText = rawContent.some(
          (b) =>
            b.type === "text" &&
            stripIdeContext((b as { type: string; text: string }).text).length >
              0,
        );
      }
      if (!hasRealText) {
        continue;
      }

      // Finalize previous task
      if (currentTask) {
        if (currentTask.status === "in_progress") {
          currentTask.status = "done";
        }
        tasks.push(currentTask);
      }

      const title = extractTitle(userEvent);
      const userInput = extractFullInput(userEvent);
      currentTask = {
        id: `task-${i}`,
        title,
        userInput,
        status: "in_progress",
        toolCalls: [],
        thinkingBlocks: [],
        responses: [],
        startedAt: event.timestamp ? new Date(event.timestamp) : new Date(),
        tokenUsage: { input: 0, output: 0 },
        sessionId,
        gitBranch,
        cwd,
      };
      pendingToolCalls = new Map();
      continue;
    }

    // Assistant message → extract tool_use, thinking, tokens
    if (event.type === "assistant") {
      const assistantEvent = event as AssistantEvent;
      if (!currentTask) {
        continue;
      }

      const usage = assistantEvent.message.usage;
      if (usage) {
        currentTask.tokenUsage.input += usage.input_tokens;
        currentTask.tokenUsage.output += usage.output_tokens;
        totalInputTokens += usage.input_tokens;
        totalOutputTokens += usage.output_tokens;
      }

      const textBlocks = assistantEvent.message.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: string; text: string }).text)
        .join("\n")
        .trim();
      if (textBlocks) {
        currentTask.responses.push(textBlocks);
      }

      for (const block of assistantEvent.message.content) {
        if (block.type === "thinking") {
          const thinkBlock = block as ThinkingBlock;
          currentTask.thinkingBlocks.push(thinkBlock.thinking);
        }
        if (block.type === "tool_use") {
          const toolBlock = block as ToolUseBlock;
          const toolCall: ToolCall = {
            id: toolBlock.id,
            name: toolBlock.name,
            input: toolBlock.input,
            status: "running",
            startedAt: event.timestamp ? new Date(event.timestamp) : new Date(),
          };
          currentTask.toolCalls.push(toolCall);
          pendingToolCalls.set(toolBlock.id, toolCall);
        }
      }
      continue;
    }

    if (event.type === "tool") {
      if (!currentTask) {
        continue;
      }
      const toolEvent = event as {
        type: string;
        content: { type: string; tool_use_id?: string; is_error?: boolean }[];
      };
      for (const block of toolEvent.content) {
        if (block.type === "tool_result" && block.tool_use_id) {
          const toolCall = pendingToolCalls.get(block.tool_use_id);
          if (toolCall) {
            toolCall.status = block.is_error ? "error" : "success";
            if (toolCall.startedAt) {
              toolCall.durationMs = Date.now() - toolCall.startedAt.getTime();
            }
          }
        }
      }
    }
  }

  // Push the last task
  if (currentTask) {
    tasks.push(currentTask);
  }

  // mark all done; last task remains in_progress until live status is confirmed below
  for (let i = 0; i < tasks.length; i++) {
    tasks[i].status = i < tasks.length - 1 ? "done" : "in_progress";
  }

  // Determine live status (modified within last 10 min)
  let lastUpdatedAt: Date | undefined;
  try {
    const stat = fs.statSync(filePath);
    lastUpdatedAt = stat.mtime;
  } catch {
    lastUpdatedAt = undefined;
  }
  const isLive = lastUpdatedAt
    ? Date.now() - lastUpdatedAt.getTime() < 10 * 60 * 1000
    : false;

  // if not live, finalize last task as done
  if (!isLive && tasks.length > 0) {
    tasks[tasks.length - 1].status = "done";
    // clean up any still-running tool calls
    for (const task of tasks) {
      for (const tc of task.toolCalls) {
        if (tc.status === "running") {
          tc.status = "success";
        }
      }
    }
  }

  // Get model from first assistant event
  const firstAssistant = events.find((e) => e.type === "assistant") as
    | AssistantEvent
    | undefined;
  const model = firstAssistant?.message?.model;

  // Get session start time
  const firstTimestamp = events.find((e) => e.timestamp)?.timestamp;
  const startedAt = firstTimestamp ? new Date(firstTimestamp) : undefined;

  return {
    id: path.basename(filePath, ".jsonl"),
    projectPath,
    projectName,
    gitBranch,
    model,
    tasks,
    isLive,
    totalTokens: { input: totalInputTokens, output: totalOutputTokens },
    startedAt,
    lastUpdatedAt,
    filePath,
  };
}

export function parseNewLines(
  filePath: string,
  offset: number,
): { events: JsonlEvent[]; newOffset: number } {
  let fd: number;
  try {
    fd = fs.openSync(filePath, "r");
  } catch {
    return { events: [], newOffset: offset };
  }

  const stat = fs.fstatSync(fd);
  const newOffset = stat.size;

  if (newOffset <= offset) {
    fs.closeSync(fd);
    return { events: [], newOffset: offset };
  }

  const length = newOffset - offset;
  const buffer = Buffer.alloc(length);
  fs.readSync(fd, buffer, 0, length, offset);
  fs.closeSync(fd);

  const chunk = buffer.toString("utf-8");
  const lines = chunk.split("\n").filter((l) => l.trim());
  const events: JsonlEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // skip
    }
  }

  return { events, newOffset };
}
