// Claude Kanban — Webview Main Script
// Communicates with VS Code Extension via vscode.postMessage / window.addEventListener

(function () {
  "use strict";

  const vscode = acquireVsCodeApi();

  // ── State ──────────────────────────────────────────────────────
  let state = {
    projects: [],
    activeSessionId: null,
    activeSession: null,
    modalTask: null,
    taskStatusOverrides: {},
    drawerOpen: false,
  };

  // ── Init ───────────────────────────────────────────────────────
  function init() {
    buildShell();
    vscode.postMessage({ type: "ready" });
    setupKeyboard();
  }

  // ── Build static shell ─────────────────────────────────────────
  function buildShell() {
    document.getElementById("app").innerHTML = `
      <div id="loading" class="loading-screen">
        <div class="loading-logo">
          <div class="loading-orb"></div>
          <span>Claude Kanban</span>
        </div>
      </div>
      <div id="app-inner" class="hidden">
        <!-- Header -->
        <header class="header">
          <button class="history-toggle" id="history-toggle" title="Sessions">
            <span class="history-toggle-icon">☰</span>
            <span class="history-toggle-label">Sessions</span>
            <span class="history-toggle-count" id="count-plan">0</span>
          </button>
          <div class="header-logo">Claude Kanban</div>
          <div class="header-spacer"></div>
        </header>

        <!-- History Drawer -->
        <div class="history-drawer" id="history-drawer">
          <div class="drawer-header">
            <span class="drawer-title">💬 Sessions</span>
            <button class="drawer-close" id="drawer-close">✕</button>
          </div>
          <div class="drawer-cards" id="drawer-cards"></div>
        </div>
        <div class="drawer-backdrop hidden" id="drawer-backdrop"></div>

        <!-- Board (2 columns) -->
        <main class="board-container">
          <div class="board" id="board">
            <div class="column active" id="col-active">
              <div class="column-header">
                <div class="column-indicator"></div>
                <span class="column-title">🔄 In Progress</span>
                <span class="column-count" id="count-active">0</span>
              </div>
              <div class="cards-list" id="cards-active" data-status="in_progress"></div>
            </div>
            <div class="column done" id="col-done">
              <div class="column-header">
                <div class="column-indicator"></div>
                <span class="column-title">✅ Done</span>
                <span class="column-count" id="count-done">0</span>
              </div>
              <div class="cards-list" id="cards-done" data-status="done"></div>
            </div>
          </div>
        </main>

        <!-- Modal -->
        <div class="modal-overlay hidden" id="modal-overlay">
          <div class="modal" id="modal">
            <div class="modal-header">
              <div class="modal-title" id="modal-title"></div>
              <button class="modal-close" id="modal-close">✕</button>
            </div>
            <div class="modal-body" id="modal-body"></div>
          </div>
        </div>
      </div>
    `;

    document
      .getElementById("modal-close")
      .addEventListener("click", closeModal);
    document.getElementById("modal-overlay").addEventListener("click", (e) => {
      if (e.target === document.getElementById("modal-overlay")) closeModal();
    });
    document
      .getElementById("history-toggle")
      .addEventListener("click", toggleDrawer);
    document
      .getElementById("drawer-close")
      .addEventListener("click", closeDrawer);
    document
      .getElementById("drawer-backdrop")
      .addEventListener("click", closeDrawer);
  }

  // ── Drawer ─────────────────────────────────────────────────────
  function toggleDrawer() {
    state.drawerOpen ? closeDrawer() : openDrawer();
  }

  function openDrawer() {
    state.drawerOpen = true;
    document.getElementById("history-drawer").classList.add("open");
    document.getElementById("drawer-backdrop").classList.remove("hidden");
    document.getElementById("history-toggle").classList.add("active");
  }

  function closeDrawer() {
    state.drawerOpen = false;
    document.getElementById("history-drawer").classList.remove("open");
    document.getElementById("drawer-backdrop").classList.add("hidden");
    document.getElementById("history-toggle").classList.remove("active");
  }

  // ── Message from extension ─────────────────────────────────────
  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "init":
        state.projects = msg.projects || [];
        if (msg.activeSessionId) state.activeSessionId = msg.activeSessionId;
        hideLoading();
        if (state.activeSessionId) {
          const session = findSession(state.activeSessionId);
          if (session) {
            state.activeSession = session;
            renderBoard();
          }
        }
        renderHistory();
        break;

      case "sessionData":
        state.activeSession = msg.session;
        hideLoading();
        renderBoard();
        renderHistory();
        if (state.modalTask) {
          const updated = msg.session.tasks.find(
            (t) => t.id === state.modalTask.id,
          );
          if (updated) {
            state.modalTask = updated;
            const body = document.getElementById("modal-body");
            if (body) body.innerHTML = renderModalBody(updated, msg.session);
          }
        }
        break;

      case "sessionLive":
        break;
    }
  });

  // ── Hide loading ───────────────────────────────────────────────
  let loadingHidden = false;
  function hideLoading() {
    if (loadingHidden) return;
    loadingHidden = true;
    const loading = document.getElementById("loading");
    const inner = document.getElementById("app-inner");
    if (loading) loading.classList.add("hidden");
    if (inner) inner.classList.remove("hidden");
  }

  // ── Find session helper ────────────────────────────────────────
  function findSession(sessionId) {
    for (const group of state.projects) {
      const s = group.sessions.find((s) => s.id === sessionId);
      if (s) return s;
    }
    return null;
  }

  // ── Render history drawer ──────────────────────────────────────
  function renderHistory() {
    const drawerCards = document.getElementById("drawer-cards");
    if (!drawerCards) return;

    const activeProjectPath = state.activeSession?.projectPath;
    const sessions = [];
    for (const group of state.projects) {
      if (activeProjectPath && group.path !== activeProjectPath) continue;
      for (const sess of group.sessions) {
        if (sess.tasks.length > 0) sessions.push(sess);
      }
    }

    const countEl = document.getElementById("count-plan");
    if (countEl) countEl.textContent = sessions.length;

    if (sessions.length === 0) {
      drawerCards.innerHTML = '<div class="empty-column">—</div>';
      return;
    }

    drawerCards.innerHTML = sessions
      .map((sess) => {
        const isActive = sess.id === state.activeSessionId;
        const title = sess.tasks[0]?.title?.slice(0, 48) || sess.id.slice(0, 8);
        const time = sess.lastUpdatedAt
          ? relTime(new Date(sess.lastUpdatedAt))
          : "";
        const taskCount = sess.tasks.length;
        return `<div class="session-history-card ${isActive ? "is-active" : ""}" data-session="${escAttr(sess.id)}">
          <div class="session-history-header">
            <span class="session-history-icon">${sess.isLive ? "🔴" : "💬"}</span>
            <span class="session-history-title">${escHtml(title)}</span>
          </div>
          <div class="session-history-meta">
            ${taskCount > 0 ? `<span>${taskCount} turns</span>` : ""}
            ${time ? `<span>${escHtml(time)}</span>` : ""}
          </div>
        </div>`;
      })
      .join("");

    drawerCards.querySelectorAll(".session-history-card").forEach((el) => {
      el.addEventListener("click", () => {
        const sessionId = el.dataset.session;
        state.activeSessionId = sessionId;
        const session = findSession(sessionId);
        if (session) {
          state.activeSession = session;
          renderBoard();
          renderHistory();
        }
        vscode.postMessage({ type: "selectSession", sessionId });
        closeDrawer();
      });
    });
  }

  // ── Render board ───────────────────────────────────────────────
  function renderBoard() {
    const session = state.activeSession;
    const activeList = document.getElementById("cards-active");
    const doneList = document.getElementById("cards-done");

    if (!activeList || !doneList) return;

    if (!session || session.tasks.length === 0) {
      activeList.innerHTML = '<div class="empty-column">No tasks</div>';
      doneList.innerHTML = '<div class="empty-column">—</div>';
      updateCounts(0, 0);
      return;
    }

    const buckets = { in_progress: [], done: [] };
    for (const task of session.tasks) {
      const status = state.taskStatusOverrides[task.id] || task.status;
      if (status === "in_progress") buckets.in_progress.push(task);
      else buckets.done.push(task);
    }

    activeList.innerHTML = renderCards(buckets.in_progress, session, true);
    doneList.innerHTML = renderCards(buckets.done, session);

    updateCounts(buckets.in_progress.length, buckets.done.length);

    document.querySelectorAll(".task-card").forEach((el) => {
      el.addEventListener("click", () => {
        const taskId = el.dataset.taskId;
        const task = session.tasks.find((t) => t.id === taskId);
        if (task) openModal(task, session);
      });
    });

    setupDragDrop();
  }

  function renderCards(tasks, session, isLive = false) {
    if (tasks.length === 0) {
      return '<div class="empty-column">—</div>';
    }
    return tasks
      .map((task, i) => renderCard(task, session, isLive && i === 0))
      .join("");
  }

  function renderCard(task, session, isLiveCard = false) {
    const effectiveStatus = state.taskStatusOverrides[task.id] || task.status;
    const statusIcon = isLiveCard
      ? "🔴"
      : effectiveStatus === "done"
        ? "✅"
        : "🔵";
    const duration = task.durationMs ? formatDuration(task.durationMs) : "";

    const toolsHtml = task.toolCalls
      .slice(0, 4)
      .map((t) => {
        const arg = getToolArg(t);
        const icon =
          t.status === "success" ? "✓" : t.status === "error" ? "✗" : "⟳";
        const statusClass =
          t.status === "success"
            ? "status-ok"
            : t.status === "error"
              ? "status-err"
              : "status-run";
        const ms = t.durationMs ? `${t.durationMs}ms` : "";
        return `<div class="tool-item">
        <span class="tool-arrow">▸</span>
        <span class="tool-name">${escHtml(t.name)}</span>
        ${arg ? `<span class="tool-arg">${escHtml(arg)}</span>` : ""}
        <span class="tool-status-icon ${statusClass}">${icon}</span>
        ${ms ? `<span class="tool-ms">${ms}</span>` : ""}
      </div>`;
      })
      .join("");

    const moreTools =
      task.toolCalls.length > 4
        ? `<div class="tool-item" style="color:var(--text-muted);font-size:10px;padding-left:12px">+${task.toolCalls.length - 4} more</div>`
        : "";

    const thinkHtml =
      task.thinkingBlocks && task.thinkingBlocks.length > 0
        ? `<div class="thinking-bubble">
        <span class="thinking-label">🧠 Thinking${task.thinkingBlocks.length > 1 ? ` <span class="thinking-count">${task.thinkingBlocks.length}</span>` : ""}</span>
        <div class="thinking-text">${escHtml(task.thinkingBlocks[0].slice(0, 200))}${task.thinkingBlocks[0].length > 200 ? "…" : ""}</div>
      </div>`
        : "";

    const responseHtml = "";

    const tokens = task.tokenUsage.input + task.tokenUsage.output;
    const metaHtml = `<div class="card-meta">
      ${duration ? `<span>⏱ ${duration}</span><span class="meta-sep">·</span>` : ""}
      ${session.gitBranch ? `<span>🌿 ${escHtml(session.gitBranch)}</span><span class="meta-sep">·</span>` : ""}
      ${tokens > 0 ? `<span>📊 ${formatTokens(tokens)}</span>` : ""}
    </div>`;

    const hasDivider1 = task.toolCalls.length > 0;
    const hasDivider2 =
      (task.thinkingBlocks && task.thinkingBlocks.length > 0) || !!responseHtml;

    return `<div class="task-card ${isLiveCard ? "is-live" : ""}" data-task-id="${escAttr(task.id)}" draggable="true">
      <div class="card-header">
        <span class="card-status-icon">${statusIcon}</span>
        <span class="card-title">${escHtml(task.title)}</span>
        ${duration ? `<span class="card-duration">${duration}</span>` : ""}
      </div>
      ${hasDivider1 ? `<div class="card-divider"></div><div class="tool-list">${toolsHtml}${moreTools}</div>` : ""}
      ${hasDivider2 ? `<div class="card-divider"></div>` : ""}
      ${thinkHtml}
      ${responseHtml}
      <div class="card-divider"></div>
      ${metaHtml}
    </div>`;
  }

  // ── Drag & Drop ────────────────────────────────────────────────
  let draggedTaskId = null;

  function setupDragDrop() {
    document.querySelectorAll(".task-card").forEach((card) => {
      card.addEventListener("dragstart", (e) => {
        draggedTaskId = card.dataset.taskId;
        card.style.opacity = "0.5";
        e.dataTransfer.effectAllowed = "move";
      });
      card.addEventListener("dragend", () => {
        card.style.opacity = "";
        draggedTaskId = null;
        document
          .querySelectorAll(".column")
          .forEach((c) => c.classList.remove("drag-over"));
      });
    });

    document.querySelectorAll(".cards-list").forEach((list) => {
      list.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        list.closest(".column")?.classList.add("drag-over");
      });
      list.addEventListener("dragleave", (e) => {
        if (!list.contains(e.relatedTarget)) {
          list.closest(".column")?.classList.remove("drag-over");
        }
      });
      list.addEventListener("drop", (e) => {
        e.preventDefault();
        list.closest(".column")?.classList.remove("drag-over");
        const newStatus = list.dataset.status;
        if (draggedTaskId && newStatus) {
          state.taskStatusOverrides[draggedTaskId] = newStatus;
          vscode.postMessage({
            type: "moveTask",
            taskId: draggedTaskId,
            newStatus,
          });
          renderBoard();
        }
      });
    });
  }

  function updateCounts(active, done) {
    const activeEl = document.getElementById("count-active");
    if (activeEl) activeEl.textContent = active;
    const doneEl = document.getElementById("count-done");
    if (doneEl) doneEl.textContent = done;
  }

  // ── Modal ──────────────────────────────────────────────────────
  function openModal(task, session) {
    state.modalTask = task;
    document.getElementById("modal-title").textContent = "";
    const body = document.getElementById("modal-body");
    body.innerHTML = renderModalBody(task, session);
    document.getElementById("modal-overlay").classList.remove("hidden");
  }

  function closeModal() {
    document.getElementById("modal-overlay").classList.add("hidden");
    state.modalTask = null;
  }

  function renderModalBody(task, session) {
    let html = "";

    if (task.userInput) {
      html += `<div>
        <div class="modal-section-title">🙋 Request</div>
        <div class="modal-user-input">${escHtml(task.userInput)}</div>
      </div>`;
    }

    if (task.toolCalls.length > 0) {
      html += `<div>
        <div class="modal-section-title">🛠 Tool Call Timeline</div>
        <div class="timeline">
          ${task.toolCalls
            .map((t) => {
              const dotCls =
                t.status === "success"
                  ? "ok"
                  : t.status === "error"
                    ? "err"
                    : "run";
              const inputStr = formatToolInput(t.input);
              return `<div class="timeline-item">
              <div class="timeline-dot ${dotCls}"></div>
              <div class="timeline-content">
                <div class="timeline-tool-name">${escHtml(t.name)}</div>
                ${inputStr ? `<div class="timeline-tool-input">${escHtml(inputStr)}</div>` : ""}
                ${t.durationMs ? `<div class="timeline-tool-ms">⏱ ${t.durationMs}ms</div>` : ""}
              </div>
            </div>`;
            })
            .join("")}
        </div>
      </div>`;
    }

    if (task.thinkingBlocks && task.thinkingBlocks.length > 0) {
      const blocksHtml = task.thinkingBlocks
        .map(
          (t, idx) =>
            `${idx > 0 ? '<div class="thinking-block-divider"></div>' : ""}<div class="modal-thinking">${escHtml(t)}</div>`,
        )
        .join("");
      html += `<div>
        <div class="modal-section-title">🧠 Claude's Thinking${task.thinkingBlocks.length > 1 ? ` <span class="thinking-count">${task.thinkingBlocks.length}</span>` : ""}</div>
        ${blocksHtml}
      </div>`;
    }

    if (task.responses && task.responses.length > 0) {
      const blocksHtml = task.responses
        .map(
          (r, idx) =>
            `${idx > 0 ? '<div class="thinking-block-divider"></div>' : ""}<div class="modal-response">${escHtml(r)}</div>`,
        )
        .join("");
      html += `<div>
        <div class="modal-section-title">💬 Claude's Response${task.responses.length > 1 ? ` <span class="thinking-count">${task.responses.length}</span>` : ""}</div>
        ${blocksHtml}
      </div>`;
    }

    const tot = task.tokenUsage.input + task.tokenUsage.output;

    html += `<div style="font-size:11px;color:var(--text-muted);display:flex;gap:12px;flex-wrap:wrap">
      ${session.gitBranch ? `<span>🌿 ${escHtml(session.gitBranch)}</span>` : ""}
      ${session.model ? `<span>🤖 ${escHtml(session.model)}</span>` : ""}
      ${tot > 0 ? `<span>📊 ${tot.toLocaleString()}</span>` : ""}
      ${task.startedAt ? `<span>🕐 ${new Date(task.startedAt).toLocaleString()}</span>` : ""}
    </div>`;

    return html;
  }

  // ── Keyboard shortcuts ──────────────────────────────────────────
  function setupKeyboard() {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (state.modalTask) closeModal();
        else if (state.drawerOpen) closeDrawer();
      }
    });
  }

  // ── Helpers ────────────────────────────────────────────────────
  function escHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function escAttr(str) {
    return escHtml(str);
  }

  function relTime(date) {
    const diff = Date.now() - date.getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  function formatTokens(n) {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }

  function getToolArg(tool) {
    const inp = tool.input;
    if (!inp) return "";
    if (inp.path) return String(inp.path).split("/").pop();
    if (inp.file_path) return String(inp.file_path).split("/").pop();
    if (inp.command) return String(inp.command).slice(0, 30);
    if (inp.pattern) return String(inp.pattern).slice(0, 30);
    return "";
  }

  function formatToolInput(input) {
    if (!input) return "";
    const pairs = Object.entries(input)
      .filter(([, v]) => v && typeof v !== "object")
      .slice(0, 3)
      .map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`)
      .join(" | ");
    return pairs;
  }

  // ── Start ──────────────────────────────────────────────────────
  init();
})();
