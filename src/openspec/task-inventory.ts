import { createHash } from "node:crypto";

const MAX_BYTES = 1024 * 1024;
const MAX_SECTIONS = 100;
const MAX_TASKS = 1_000;
const MAX_DESCRIPTION_BYTES = 500;
const headingPattern = /^##\s+(\d+(?:\.\d+)*)\.\s+(.+?)\s*$/u;
const taskPattern = /^\s*-\s+\[([ xX])\]\s+(\d+(?:\.\d+)+)\s+(.+?)\s*$/u;
const checkboxLikePattern = /^\s*-\s+\[[^\]]*\]/u;

export interface OpenSpecTask {
  id: string;
  description: string;
  status: "pending" | "complete";
  sectionId: string;
}

export interface OpenSpecTaskSection {
  id: string;
  title: string;
  tasks: OpenSpecTask[];
}

export interface OpenSpecTaskInventory {
  changeId: string;
  projectRoot: string;
  sections: OpenSpecTaskSection[];
  digest: string;
}

export interface ParseOpenSpecTaskInventoryContext {
  changeId: string;
  projectRoot: string;
  tasksPath: string;
}

function bounded(value: string, label: string, bytes: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized) throw new Error(`${label} is empty`);
  if (Buffer.byteLength(normalized, "utf8") > bytes) throw new Error(`${label} exceeds ${bytes} bytes`);
  return normalized;
}

export function parseOpenSpecTaskInventory(
  source: string,
  context: ParseOpenSpecTaskInventoryContext,
): OpenSpecTaskInventory {
  if (Buffer.byteLength(source, "utf8") > MAX_BYTES) throw new Error("OpenSpec tasks artifact exceeds 1 MiB");
  const sections: OpenSpecTaskSection[] = [];
  const seenSections = new Set<string>();
  const seenTasks = new Set<string>();
  let current: OpenSpecTaskSection | undefined;
  let taskCount = 0;

  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    const heading = headingPattern.exec(line);
    if (heading) {
      const id = heading[1]!;
      if (seenSections.has(id)) throw new Error(`Duplicate OpenSpec task section: ${id}`);
      if (sections.length >= MAX_SECTIONS) throw new Error(`OpenSpec task inventory permits at most ${MAX_SECTIONS} sections`);
      current = { id, title: bounded(heading[2]!, `OpenSpec section ${id} title`, MAX_DESCRIPTION_BYTES), tasks: [] };
      seenSections.add(id);
      sections.push(current);
      continue;
    }
    if (/^##\s+/u.test(line)) {
      current = undefined;
      throw new Error(`Unsupported OpenSpec task heading at line ${index + 1}`);
    }
    const task = taskPattern.exec(line);
    if (task) {
      if (!current) throw new Error(`OpenSpec task ${task[2]} is outside a numbered section at line ${index + 1}`);
      const id = task[2]!;
      if (seenTasks.has(id)) throw new Error(`Duplicate OpenSpec task ID: ${id}`);
      if (!id.startsWith(`${current.id}.`)) throw new Error(`OpenSpec task ${id} does not belong to section ${current.id}`);
      if (taskCount >= MAX_TASKS) throw new Error(`OpenSpec task inventory permits at most ${MAX_TASKS} tasks`);
      const item: OpenSpecTask = {
        id,
        description: bounded(task[3]!, `OpenSpec task ${id} description`, MAX_DESCRIPTION_BYTES),
        status: task[1]!.toLowerCase() === "x" ? "complete" : "pending",
        sectionId: current.id,
      };
      current.tasks.push(item);
      seenTasks.add(id);
      taskCount += 1;
      continue;
    }
    if (checkboxLikePattern.test(line)) throw new Error(`Malformed OpenSpec task line ${index + 1}`);
  }
  if (taskCount === 0) throw new Error("OpenSpec task inventory has no recognizable tasks");
  const digestInput = sections.map((section) => ({
    id: section.id,
    title: section.title,
    tasks: section.tasks.map((task) => ({ id: task.id, description: task.description, status: task.status, sectionId: task.sectionId })),
  }));
  return {
    changeId: context.changeId,
    projectRoot: context.projectRoot,
    sections,
    digest: createHash("sha256").update(JSON.stringify(digestInput)).digest("hex"),
  };
}
