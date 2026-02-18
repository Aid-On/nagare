/**
 * @aid-on/nagare (流れ) - SSE (Server-Sent Events) Support
 *
 * Edge-native SSE consumer for streaming event sources
 */

import type { Stream } from "./types";
import { fromReadableStream } from "./create-stream";

/**
 * Parse a single SSE data line and enqueue the parsed result.
 * Returns true if the stream should terminate ([DONE] received).
 */
function parseSSEDataLine<T>(
  dataStr: string,
  parser: (data: string) => T,
  controller: TransformStreamDefaultController<T>,
): boolean {
  if (dataStr === "[DONE]") {
    return true;
  }
  if (dataStr) {
    try {
      const parsed = parser(dataStr);
      controller.enqueue(parsed);
    } catch { /* skip unparseable SSE data */ }
  }
  return false;
}

/**
 * Split the buffer into complete lines, keeping any trailing incomplete line.
 * Returns [completeLines, remainingBuffer].
 */
function splitSSEBuffer(buffer: string): [string[], string] {
  const lines = buffer.split(/\r\n|\n|\r/);
  if (!buffer.match(/(\r\n|\n|\r)$/)) {
    const remaining = lines.pop() || "";
    return [lines, remaining];
  }
  return [lines, ""];
}

/**
 * Create stream from Server-Sent Events (Edge-native SSE consumer)
 * Fluent API for SSE streaming with automatic buffering & parsing
 *
 * @example
 * ```typescript
 * const events = await fromSSE("/api/chat", {
 *   method: "POST",
 *   body: { message: "Hello" },
 *   parser: data => JSON.parse(data) as ChatEvent
 * });
 *
 * events
 *   .filter(e => e.type === "chunk")
 *   .map(e => e.content)
 *   .subscribe({ next: content => console.log(content) });
 * ```
 */
export async function fromSSE<T = unknown>(
  url: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    headers?: Record<string, string>;
    parser?: (data: string) => T;
    signal?: AbortSignal;
    credentials?: RequestCredentials;
  } = {}
): Promise<Stream<T>> {
  const {
    method = "GET",
    body,
    headers = {},
    parser = (data) => JSON.parse(data) as T,
    signal,
    credentials = "include"
  } = options;

  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined,
    credentials,
    signal
  });

  // Check if response is SSE
  const contentType = response.headers.get("content-type");
  if (!response.ok || !contentType?.includes("text/event-stream")) {
    throw new Error(`Not an SSE response: ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error("No response body");
  }

  // Transform Response body to parsed SSE stream with proper buffering
  let buffer = "";

  const sseStream = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TransformStream<string, T>({
      transform(chunk, controller) {
        buffer += chunk;
        const [lines, remaining] = splitSSEBuffer(buffer);
        buffer = remaining;

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const dataStr = trimmed.slice(6).trim();
          const shouldTerminate = parseSSEDataLine(dataStr, parser, controller);
          if (shouldTerminate) {
            controller.terminate();
            return;
          }
        }
      },
      flush(controller) {
        // Process any remaining buffer on stream end
        if (buffer.trim().startsWith("data: ")) {
          const dataStr = buffer.slice(6).trim();
          if (dataStr && dataStr !== "[DONE]") {
            try {
              const parsed = parser(dataStr);
              controller.enqueue(parsed);
            } catch { /* ignore final parse errors */ }
          }
        }
      }
    }));

  return fromReadableStream(sseStream);
}
