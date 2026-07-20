export interface WorkerEvent {
  cursor: number;
  type: string;
  timestamp: number;
  messageId?: string;
  text?: string;
  error?: string;
  details?: unknown;
}

interface BufferedWorkerEvent extends WorkerEvent {
  bytes: number;
  detailed: boolean;
}

export interface EventStreamReadOptions {
  afterCursor?: number;
  includeDetails?: boolean;
  limit?: number;
}

export interface EventStreamReadResult {
  events: WorkerEvent[];
  oldestCursor: number;
  nextCursor: number;
  hasMore: boolean;
  truncated: boolean;
}

export interface EventStream {
  append(event: Omit<WorkerEvent, "cursor">, detailed?: boolean): number;
  read(options?: EventStreamReadOptions): EventStreamReadResult;
  stats(): { retainedBytes: number; droppedRangeCount: number };
}

export function createEventStream(options: { byteLimit?: number } = {}): EventStream {
  const byteLimit = options.byteLimit ?? 10 * 1024 * 1024;
  const events: BufferedWorkerEvent[] = [];
  let eventBytes = 0;
  let cursor = 0;
  let droppedThrough = 0;

  function recordDropped(dropped: number): void {
    droppedThrough = Math.max(droppedThrough, dropped);
  }

  return {
    append(event, detailed = false) {
      cursor += 1;
      const buffered = { ...event, cursor, detailed };
      const bytes = Buffer.byteLength(JSON.stringify(buffered), "utf8");
      if (bytes <= byteLimit) {
        events.push({ ...buffered, bytes });
        eventBytes += bytes;
      } else {
        recordDropped(cursor);
      }
      while (eventBytes > byteLimit) {
        const removed = events.shift();
        if (removed) {
          eventBytes -= removed.bytes;
          recordDropped(removed.cursor);
        }
      }
      return cursor;
    },
    read(options = {}) {
      const afterCursor = options.afterCursor ?? 0;
      const oldestCursor = events[0]?.cursor ?? cursor + 1;
      const eligible = events.filter((event) =>
        event.cursor > afterCursor && (options.includeDetails === true || !event.detailed)
      );
      const selected = eligible.slice(0, Math.max(1, options.limit ?? 500));
      const hasMore = eligible.length > selected.length;
      const nextCursor = hasMore ? selected.at(-1)!.cursor : Math.max(afterCursor, cursor);
      return {
        events: selected.map(({ bytes: _bytes, detailed: _detailed, ...event }) => structuredClone(event)),
        oldestCursor,
        nextCursor,
        hasMore,
        truncated: afterCursor < oldestCursor - 1 || droppedThrough > afterCursor,
      };
    },
    stats() {
      return { retainedBytes: eventBytes, droppedRangeCount: droppedThrough === 0 ? 0 : 1 };
    },
  };
}
