import { describe, it, expect } from "vitest";
import { stream, operators, fromArray, type Stream } from "../src/index.js";

describe("Stream<T> - Universal Interface", () => {
  describe("Web Streams integration", () => {
    it("should work with native Web Streams", async () => {
      const result = await stream.array([1, 2, 3, 4, 5])
        .pipeThrough(operators.map(x => x * 2))
        .pipeThrough(operators.filter(x => x > 4))
        .collect();

      expect(result).toEqual([6, 8, 10]);
    });

    it("should create Response object", () => {
      const response = stream.array(["Hello", "World"])
        .toResponse({ headers: { "X-Test": "nagare" } });

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get("X-Test")).toBe("nagare");
      expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    });

    it("should convert to ReadableStream", async () => {
      const readable = await stream.array([1, 2, 3]).toReadableStream();
      expect(readable).toBeInstanceOf(ReadableStream);

      const reader = readable.getReader();
      const { value } = await reader.read();
      expect(value).toBe(1);
      reader.releaseLock();
    });
  });

  describe("Observer pattern", () => {
    it("should subscribe with Observer", async () => {
      const values: number[] = [];
      let completed = false;

      const subscription = stream.array([1, 2, 3]).subscribe({
        next: (value) => values.push(value),
        complete: () => { completed = true; }
      });

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(values).toEqual([1, 2, 3]);
      expect(completed).toBe(true);
      expect(subscription.closed).toBe(true);
    });

    it("should subscribe with function", async () => {
      const values: number[] = [];
      let completed = false;

      stream.array([1, 2, 3]).subscribe({
        next: value => values.push(value),
        complete: () => { completed = true; }
      });

      // Wait for completion
      while (!completed) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      expect(values).toEqual([1, 2, 3]);
    });

    it("should handle unsubscribe", () => {
      const subscription = stream.array([1, 2, 3]).subscribe(() => {});
      
      expect(subscription.closed).toBe(false);
      subscription.unsubscribe();
      expect(subscription.closed).toBe(true);
    });
  });

  describe("async iteration", () => {
    it("should work with for-await-of", async () => {
      const values: number[] = [];
      
      for await (const value of stream.array([1, 2, 3])) {
        values.push(value);
      }

      expect(values).toEqual([1, 2, 3]);
    });
  });

  describe("terminal operations", () => {
    it("should collect to array", async () => {
      const result = await stream.array([1, 2, 3, 4, 5]).collect();
      expect(result).toEqual([1, 2, 3, 4, 5]);
    });

    it("should reduce to single value", async () => {
      const sum = await stream.array([1, 2, 3, 4, 5])
        .reduce((acc, x) => acc + x, 0);
      
      expect(sum).toBe(15);
    });

    it("should take first N values", async () => {
      const result = await stream.array([1, 2, 3, 4, 5])
        .take(3)
        .collect();
      
      expect(result).toEqual([1, 2, 3]);
    });

    it("should take until condition", async () => {
      const result = await stream.array([1, 2, 3, 4, 5])
        .takeUntil(x => x >= 4)
        .collect();
      
      expect(result).toEqual([1, 2, 3]);
    });
  });

  describe("TransformStream operators", () => {
    it("should map values", async () => {
      const result = await stream.array([1, 2, 3])
        .pipeThrough(operators.map(x => x * 2))
        .collect();

      expect(result).toEqual([2, 4, 6]);
    });

    it("should filter values", async () => {
      const result = await stream.array([1, 2, 3, 4, 5])
        .pipeThrough(operators.filter(x => x % 2 === 0))
        .collect();

      expect(result).toEqual([2, 4]);
    });

    it("should chain multiple operators", async () => {
      const result = await stream.array([1, 2, 3, 4, 5])
        .pipeThrough(operators.map(x => x * 2))
        .pipeThrough(operators.filter(x => x > 4))
        .pipeThrough(operators.take(2))
        .collect();

      expect(result).toEqual([6, 8]);
    });
  });

  describe("edge-native features", () => {
    it("should handle buffer operator", async () => {
      const result = await stream.array([1, 2, 3, 4, 5])
        .pipeThrough(operators.buffer(2))
        .collect();

      expect(result).toEqual([[1, 2], [3, 4], [5]]);
    });

    it("should work with empty stream", async () => {
      const result = await stream.empty().collect();
      expect(result).toEqual([]);
    });

    it("should work with single value", async () => {
      const result = await stream.of(42).collect();
      expect(result).toEqual([42]);
    });
  });
});