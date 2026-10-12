import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
});

it("validates scan inputs without probing dynamic code execution", async () => {
  const dynamicCode = vi
    .spyOn(globalThis, "Function")
    .mockImplementation(function () {
      throw new EvalError("Dynamic code is blocked by the page policy");
    });

  // Import the real browser entry, including its shared contract dependencies.
  await import("./scan-workspace");
  const { z } = await import("zod");
  const schema = z.object({ region: z.literal("dorsal_tongue") });

  expect(schema.safeParse({ region: "dorsal_tongue" }).success).toBe(true);
  expect(schema.safeParse({ region: "unknown" }).success).toBe(false);
  expect(dynamicCode).not.toHaveBeenCalled();
});
