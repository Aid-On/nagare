/**
 * @aid-on/nagare (流れ) - SSE (Server-Sent Events) Support
 *
 * Edge-native SSE consumer for streaming event sources
 */

import type { Stream } from "./types";
import { fromReadableStream } from "./create-stream";

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
        // Add chunk to buffer for incomplete line handling
        buffer += chunk;
        // Support all line endings: \r\n (Windows), \n (Unix), \r (Old Mac)
        const lines = buffer.split(/\r\n|\n|\r/);

        // Keep last incomplete line in buffer
        // Check if chunk ends with any line ending
        if (!buffer.match(/(\r\n|\n|\r)$/)) {
          buffer = lines.pop() || "";
        } else {
          buffer = "";
        }

        // Process complete lines
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue; // Skip empty lines

          if (trimmed.startsWith("data: ")) {
            const dataStr = trimmed.slice(6).trim();

            if (dataStr === "[DONE]") {
              controller.terminate();
              return;
            }

            if (dataStr) {
              try {
                const parsed = parser(dataStr);
                controller.enqueue(parsed);
              } catch { /* skip unparseable SSE data */ }
            }
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
