const STATUSES = [
  { id: "todo", label: "To do", color: "#ff785a" },
  { id: "progress", label: "In progress", color: "#88aef4" },
  { id: "done", label: "Done", color: "#9bd14b" }
];
const STORAGE_KEY = "taskflow.tasks.v1";
const board = document.querySelector("#board");
const dialog = document.querySelector("#taskDialog");
const form = document.querySelector("#taskForm");
const fileInput = document.querySelector("#fileInput");
const toast = document.querySelector("#toast");
let editingId = null;
let draggedId = null;
let fileHandle = null;
let tasks = readLocalTasks();

function validateTasks(value) {
  if (!Array.isArray(value)) throw new Error("The file must contain a list of tasks.");
  const ids = new Set();
  return value.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`Task ${index + 1} is not valid.`);
    const task = {
      id: String(item.id ?? "").trim(),
      title: String(item.title ?? "").trim(),
      description: String(item.description ?? "").trim(),
      status: String(item.status ?? "todo")
    };
    if (!task.id || !task.title) throw new Error(`Task ${index + 1} needs an id and title.`);
    if (ids.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
    if (!STATUSES.some((status) => status.id === task.status)) throw new Error(`Unknown status: ${task.status}`);
    ids.add(task.id);
    return task;
  });
}

function escapeMarkdownInline(value) {
  return value.replace(/\\/g, "\\\\").replace(/([*_`\[\]])/g, "\\$1");
}

function unescapeMarkdownInline(value) {
  return value.replace(/\\([\\*_`\[\]])/g, "$1");
}

function escapeMarkdownDescription(value) {
  return value.replace(/^\\/gm, "\\\\").replace(/^##([ \t])/gm, "\\##$1");
}

function unescapeMarkdownDescription(value) {
  return value.replace(/^\\##([ \t])/gm, "##$1").replace(/^\\\\/gm, "\\");
}

function tasksToMarkdown(value) {
  const sections = value.map((task) => [
    `## ${escapeMarkdownInline(task.id)}`,
    "",
    `- **Title:** ${escapeMarkdownInline(task.title)}`,
    `- **Status:** \`${task.status}\``,
    "",
    task.description ? escapeMarkdownDescription(task.description) : "_No description._"
  ].join("\n"));
  return ["# Taskflow Tasks", ...sections].join("\n\n") + "\n";
}

function markdownToTasks(markdown) {
  const source = markdown.replace(/\r\n?/g, "\n");
  const blocks = [...source.matchAll(/^##[ \t]+(.+?)[ \t]*\n([\s\S]*?)(?=^##[ \t]+|(?![\s\S]))/gm)];
  if (!blocks.length && source.trim() !== "# Taskflow Tasks") {
    throw new Error("No tasks were found in this Markdown file.");
  }
  return validateTasks(blocks.map((match, index) => {
    const body = match[2];
    const titleMatch = body.match(/^[ \t]*-[ \t]+\*\*Title:\*\*[ \t]+(.+?)[ \t]*$/m);
    const statusMatch = body.match(/^[ \t]*-[ \t]+\*\*Status:\*\*[ \t]+`?([^`\s]+)`?[ \t]*$/m);
    if (!titleMatch || !statusMatch) throw new Error(`Task ${index + 1} needs a title and status.`);
    const description = body.slice(statusMatch.index + statusMatch[0].length).trim();
    return {
      id: unescapeMarkdownInline(match[1].trim()),
      title: unescapeMarkdownInline(titleMatch[1].trim()),
      status: statusMatch[1],
      description: description === "_No description._" ? "" : unescapeMarkdownDescription(description)
    };
  }));
}

function readLocalTasks() {
  try { return validateTasks(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")); }
  catch { return []; }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  document.querySelector("#saveState").textContent = "Saved locally";
}

function escapeHTML(value) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function render() {
  board.innerHTML = STATUSES.map((status) => {
    const statusTasks = tasks.filter((task) => task.status === status.id);
    const cards = statusTasks.length ? statusTasks.map((task) => `
      <article class="task-card" style="--accent:${status.color}" draggable="true" tabindex="0" data-id="${escapeHTML(task.id)}" aria-label="Edit ${escapeHTML(task.title)}">
        <div class="card-meta"><span class="task-id">#${escapeHTML(task.id)}</span><span class="grip" aria-hidden="true">⠿</span></div>
        <h3>${escapeHTML(task.title)}</h3>${task.description ? `<p>${escapeHTML(task.description)}</p>` : ""}
      </article>`).join("") : `<div class="empty">Drop a task here<br>or add a new one.</div>`;
    return `<section class="column" style="--accent:${status.color}" data-status="${status.id}">
      <div class="column-head"><div class="column-title"><span class="status-dot"></span>${status.label}</div><span class="count">${String(statusTasks.length).padStart(2, "0")}</span></div>
      <div class="card-list">${cards}</div></section>`;
  }).join("");
  const done = tasks.filter((task) => task.status === "done").length;
  document.querySelector("#totalCount").textContent = tasks.length;
  document.querySelector("#progressText").textContent = tasks.length ? `${Math.round(done / tasks.length * 100)}% complete` : "Nothing completed yet";
  bindBoardEvents();
}

function bindBoardEvents() {
  document.querySelectorAll(".task-card").forEach((card) => {
    card.addEventListener("click", () => openTask(card.dataset.id));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openTask(card.dataset.id); }
    });
    card.addEventListener("dragstart", (event) => {
      draggedId = card.dataset.id;
      card.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedId);
    });
    card.addEventListener("dragend", () => {
      draggedId = null;
      card.classList.remove("dragging");
      document.querySelectorAll(".column").forEach((column) => column.classList.remove("drag-over"));
    });
  });
  document.querySelectorAll(".column").forEach((column) => {
    column.addEventListener("dragover", (event) => { event.preventDefault(); column.classList.add("drag-over"); });
    column.addEventListener("dragleave", (event) => { if (!column.contains(event.relatedTarget)) column.classList.remove("drag-over"); });
    column.addEventListener("drop", (event) => {
      event.preventDefault();
      const task = tasks.find((item) => item.id === (draggedId || event.dataTransfer.getData("text/plain")));
      if (task && task.status !== column.dataset.status) {
        task.status = column.dataset.status;
        persist(); render();
        showToast(`Moved to ${STATUSES.find((item) => item.id === task.status).label}`);
      }
    });
  });
}

function makeId() {
  let id;
  do { id = `TASK-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }
  while (tasks.some((task) => task.id === id));
  return id;
}

function openTask(id = null) {
  editingId = id;
  const task = tasks.find((item) => item.id === id);
  document.querySelector("#dialogKicker").textContent = task ? "Edit task" : "New task";
  document.querySelector("#dialogTitle").textContent = task ? "Update the details" : "Add to your board";
  document.querySelector("#taskId").value = task?.id || makeId();
  document.querySelector("#taskTitle").value = task?.title || "";
  document.querySelector("#taskDescription").value = task?.description || "";
  document.querySelector("#taskStatus").value = task?.status || "todo";
  document.querySelector("#deleteTask").hidden = !task;
  document.querySelector("#formError").textContent = "";
  dialog.showModal();
  setTimeout(() => document.querySelector("#taskTitle").focus(), 0);
}

function closeTask() { dialog.close(); editingId = null; }

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const wasEditing = Boolean(editingId);
  const next = {
    id: document.querySelector("#taskId").value.trim(),
    title: document.querySelector("#taskTitle").value.trim(),
    description: document.querySelector("#taskDescription").value.trim(),
    status: document.querySelector("#taskStatus").value
  };
  if (tasks.some((task) => task.id === next.id && task.id !== editingId)) {
    document.querySelector("#formError").textContent = "That task ID is already in use.";
    return;
  }
  if (editingId) tasks = tasks.map((task) => task.id === editingId ? next : task);
  else tasks.push(next);
  persist(); render(); closeTask();
  showToast(wasEditing ? "Task updated" : "Task added");
});

document.querySelector("#deleteTask").addEventListener("click", () => {
  if (!editingId) return;
  tasks = tasks.filter((task) => task.id !== editingId);
  persist(); render(); closeTask(); showToast("Task deleted");
});
document.querySelector("#newTaskButton").addEventListener("click", () => openTask());
document.querySelector("#closeDialog").addEventListener("click", closeTask);
document.querySelector("#cancelTask").addEventListener("click", closeTask);
document.querySelector("#regenerateId").addEventListener("click", () => { document.querySelector("#taskId").value = makeId(); });
dialog.addEventListener("click", (event) => { if (event.target === dialog) closeTask(); });

document.querySelector("#saveButton").addEventListener("click", async () => {
  const contents = tasksToMarkdown(tasks);
  try {
    if ("showSaveFilePicker" in window) {
      fileHandle ||= await window.showSaveFilePicker({ suggestedName: "data.md", types: [{ description: "Markdown file", accept: { "text/markdown": [".md"] } }] });
      const writable = await fileHandle.createWritable();
      await writable.write(contents); await writable.close();
    } else {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([contents], { type: "text/markdown" }));
      link.download = "data.md"; link.click(); URL.revokeObjectURL(link.href);
    }
    showToast("Saved data.md");
  } catch (error) { if (error.name !== "AbortError") showToast("Could not save the file"); }
});

document.querySelector("#loadButton").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  try {
    tasks = markdownToTasks(await file.text());
    persist(); render(); showToast(`Loaded ${tasks.length} task${tasks.length === 1 ? "" : "s"}`);
  } catch (error) { showToast(error.message || "That Markdown file is not valid"); }
  finally { fileInput.value = ""; }
});

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer); toast.textContent = message; toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}
render();
