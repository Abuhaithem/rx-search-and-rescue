import { describe, expect, it } from "vitest";
import { Semaphore } from "./llm-limiter";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("Semaphore", () => {
  it("never exceeds the limit and completes every task", async () => {
    const semaphore = new Semaphore(3);
    let inFlight = 0;
    let peak = 0;
    let done = 0;

    const tasks = Array.from({ length: 10 }, () =>
      semaphore.run(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await tick();
        inFlight -= 1;
        done += 1;
      }),
    );
    await Promise.all(tasks);

    expect(peak).toBe(3);
    expect(done).toBe(10);
    expect(inFlight).toBe(0);
  });

  it("releases the slot when the task throws", async () => {
    const semaphore = new Semaphore(1);
    await expect(
      semaphore.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // The slot must be free again or this would hang.
    await expect(semaphore.run(async () => "ok")).resolves.toBe("ok");
  });

  it("serves waiters in arrival order", async () => {
    const semaphore = new Semaphore(1);
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) =>
        semaphore.run(async () => {
          order.push(n);
          await tick();
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3]);
  });
});
