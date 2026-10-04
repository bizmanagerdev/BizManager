import { describe, it, expect } from "vitest";
import { uploadTogether } from "@/lib/upload-together";

const file = (name: string) => new File(["x"], name);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("uploadTogether", () => {
  it("returns results in the files' order, even when they finish out of order", async () => {
    const delays: Record<string, number> = { a: 30, b: 0, c: 10 };
    const result = await uploadTogether([file("a"), file("b"), file("c")], async (f) => {
      await new Promise((resolve) => setTimeout(resolve, delays[f.name]));
      return f.name;
    });
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("runs uploads at the same time, but never more than the limit", async () => {
    let running = 0;
    let peak = 0;
    await uploadTogether(
      ["1", "2", "3", "4", "5"].map(file),
      async () => {
        running++;
        peak = Math.max(peak, running);
        await tick();
        running--;
      },
      3
    );
    expect(peak).toBe(3);
  });

  it("attempts every file, then rethrows the first failure", async () => {
    const attempted: string[] = [];
    await expect(
      uploadTogether([file("a"), file("bad"), file("c")], async (f) => {
        attempted.push(f.name);
        if (f.name === "bad") throw new Error("upload failed");
        return f.name;
      })
    ).rejects.toThrow("upload failed");
    expect(attempted.sort()).toEqual(["a", "bad", "c"]);
  });

  it("does nothing for an empty list", async () => {
    expect(await uploadTogether([], async () => "never")).toEqual([]);
  });
});
