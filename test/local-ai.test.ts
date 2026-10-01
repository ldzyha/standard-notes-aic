import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_AI_MAX_TEXT,
  localAIAvailability,
  localAIProtectedRanges,
  reviewLocalText,
  validateLocalReplacement,
} from "../src/core/local-ai.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function model(reply: (input: string) => string | Promise<string>) {
  const destroy = vi.fn();
  const prompt = vi.fn(reply);
  const create = vi.fn(async () => ({ prompt, destroy }));
  const availability = vi.fn(async () => "available");
  vi.stubGlobal("LanguageModel", { create, availability });
  return { create, prompt, destroy, availability };
}
function review(
  text = "I is writing a note.",
  mode: "grammar" | "improve" = "grammar",
  signal = new AbortController().signal,
) {
  return reviewLocalText({ text, mode, signal });
}

describe("browser-owned local writing assistance", () => {
  it("detects availability without creating or downloading a model", async () => {
    const api = model(() => "unused");
    expect(await localAIAvailability()).toBe("available");
    expect(api.availability).toHaveBeenCalledWith({
      expectedInputs: [{ type: "text" }],
      expectedOutputs: [{ type: "text" }],
    });
    expect(api.create).not.toHaveBeenCalled();
    vi.stubGlobal("LanguageModel", undefined);
    expect(await localAIAvailability()).toBe("unavailable");
    await expect(review()).rejects.toThrow("Editing still works offline");
  });

  it.each(["downloadable", "downloading", "unavailable", "future-unknown"])(
    "bounds the availability state %s",
    async (state) => {
      vi.stubGlobal("LanguageModel", {
        create: vi.fn(),
        availability: async () => state,
      });
      expect(await localAIAvailability()).toBe(
        state === "future-unknown" ? "unavailable" : state,
      );
    },
  );

  it("uses constrained grammar output, abort signals and destroys the session without logging", async () => {
    const api = model((source) =>
      JSON.stringify({
        text: JSON.parse(source).text.replace("I is", "I am"),
        notes: ["Verb agreement corrected."],
      }),
    );
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const logs = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "info"),
      vi.spyOn(console, "groupCollapsed"),
    ];
    const signal = new AbortController().signal;
    expect(await review(undefined, "grammar", signal)).toEqual({
      text: "I am writing a note.",
      notes: ["Verb agreement corrected."],
      changed: true,
    });
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({
        signal,
        initialPrompts: [
          {
            role: "system",
            content: expect.stringContaining("grammar and punctuation only"),
          },
        ],
      }),
    );
    expect(api.prompt).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        signal,
        responseConstraint: expect.objectContaining({
          additionalProperties: false,
          required: ["text", "notes"],
        }),
      }),
    );
    expect(api.destroy).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it("reports model download progress only during preparation", async () => {
    const progress = vi.fn();
    let download: ((event: { loaded: number }) => void) | undefined;
    const destroy = vi.fn();
    vi.stubGlobal("LanguageModel", {
      create: async (options: { monitor(value: unknown): void }) => {
        options.monitor({
          addEventListener(_name: string, listener: typeof download) {
            download = listener;
          },
        });
        download?.({ loaded: 0.42 });
        download?.({ loaded: 1 });
        return {
          destroy,
          async prompt() {
            download?.({ loaded: 0.9 });
            return JSON.stringify({ text: "I am writing a note.", notes: [] });
          },
        };
      },
    });
    await reviewLocalText({
      text: "I is writing a note.",
      mode: "improve",
      signal: new AbortController().signal,
      onProgress: progress,
    });
    expect(progress.mock.calls.map(([value]) => value)).toEqual([
      "Preparing local AI…",
      "Downloading local AI · 42%",
      "Starting local AI…",
      "Improving prose locally…",
    ]);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it.each([
    "not json",
    JSON.stringify({ text: "New prose", notes: [], extra: true }),
    JSON.stringify({ edits: [], notes: [] }),
    JSON.stringify({ text: "New prose", notes: [1] }),
    JSON.stringify({ text: "New prose", notes: Array(5).fill("note") }),
    JSON.stringify({ text: "New prose", notes: ["n".repeat(501)] }),
    JSON.stringify({ text: "n".repeat(24001), notes: [] }),
  ])(
    "rejects invalid structured output and always destroys its session",
    async (raw) => {
      const api = model(() => raw);
      await expect(review()).rejects.toThrow("invalid suggestion");
      expect(api.destroy).toHaveBeenCalledOnce();
    },
  );

  it("rejects empty output but accepts unchanged prose", async () => {
    const api = model(() => JSON.stringify({ text: "", notes: [] }));
    await expect(review()).rejects.toThrow("empty text");
    expect(api.destroy).toHaveBeenCalledOnce();
    api.prompt.mockImplementation((source) =>
      JSON.stringify({ text: JSON.parse(source).text, notes: [] }),
    );
    expect(await review()).toEqual({
      text: "I is writing a note.",
      notes: [],
      changed: false,
    });
  });

  it("bounds input before creating the model", async () => {
    const api = model(() => "unused");
    await expect(review("x".repeat(LOCAL_AI_MAX_TEXT + 1))).rejects.toThrow(
      "14,000",
    );
    await expect(review("  ")).rejects.toThrow("write some prose");
    expect(api.create).not.toHaveBeenCalled();
  });

  it("does not create an already-cancelled request", async () => {
    const api = model(() => "unused");
    const controller = new AbortController();
    controller.abort();
    await expect(
      review(undefined, "grammar", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(api.create).not.toHaveBeenCalled();
  });

  it("destroys a session that completes creation after cancellation", async () => {
    let release: (session: unknown) => void = () => {};
    const destroy = vi.fn(),
      prompt = vi.fn();
    vi.stubGlobal("LanguageModel", {
      create: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    const controller = new AbortController();
    const task = review(undefined, "grammar", controller.signal);
    controller.abort();
    release({ destroy, prompt });
    await expect(task).rejects.toMatchObject({ name: "AbortError" });
    expect(destroy).toHaveBeenCalledOnce();
    expect(prompt).not.toHaveBeenCalled();
  });

  it("rejects late prompt results after cancellation and destroys their session", async () => {
    let release: (value: string) => void = () => {};
    const api = model(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const controller = new AbortController();
    const task = review(undefined, "grammar", controller.signal);
    await vi.waitFor(() => expect(api.prompt).toHaveBeenCalledOnce());
    controller.abort();
    release(JSON.stringify({ text: "Changed", notes: [] }));
    await expect(task).rejects.toMatchObject({ name: "AbortError" });
    expect(api.destroy).toHaveBeenCalledOnce();
  });

  it("does not expose arbitrary model error text in its UI error", async () => {
    const api = model(() => {
      throw new Error("The synthetic confidential text echoed by a model");
    });
    await expect(review()).rejects.toThrow("Local AI could not finish");
    expect(api.destroy).toHaveBeenCalledOnce();
  });
});

describe("opaque Markdown and AIC secret preservation", () => {
  const source = [
    "---",
    "legacy-key: synthetic confidential property",
    "---",
    "",
    "I is writing a note with [link](https://example.test/private) and `code`.",
    "",
    "```aic",
    "Secret | password: synthetic confidential value",
    "```",
    "",
    "    indented code",
    "",
    "<div>Original HTML</div>",
    "",
    "I is adding <em>more</em> prose.",
  ].join("\n");

  it("hides code, links, HTML and Properties before inference and restores them exactly", async () => {
    const api = model((input) => {
      expect(input).not.toContain("synthetic confidential");
      expect(input).not.toContain("https://example.test");
      expect(input).not.toContain("Original HTML");
      return JSON.stringify({
        text: JSON.parse(input).text.replaceAll("I is", "I am"),
        notes: [],
      });
    });
    const result = await review(source);
    expect(result.text).toBe(source.replaceAll("I is", "I am"));
    expect(localAIProtectedRanges(source).length).toBeGreaterThan(5);
    expect(api.destroy).toHaveBeenCalledOnce();
  });

  it.each(["drop", "duplicate", "reorder"])(
    "rejects a model that tries to %s protected placeholders",
    async (action) => {
      model((input) => {
        let text = JSON.parse(input).text as string;
        const tokens = text.match(/AIC_KEEP_[a-f\d]+_\d+_END/g)!;
        if (action === "drop") text = text.replace(tokens[0]!, "changed");
        else if (action === "duplicate") text += tokens[0];
        else
          text = text
            .replace(tokens[0]!, "TEMP_PLACEHOLDER")
            .replace(tokens[1]!, tokens[0]!)
            .replace("TEMP_PLACEHOLDER", tokens[1]!);
        return JSON.stringify({ text, notes: [] });
      });
      await expect(review(source)).rejects.toThrow("protected part");
    },
  );

  it.each([
    (text: string) =>
      text.replace("https://example.test/private", "https://attacker.test"),
    (text: string) => text.replace("`code`", "`changed`"),
    (text: string) =>
      text.replace("synthetic confidential value", "changed secret"),
    (text: string) => text.replace("Original HTML", "Changed HTML"),
    (text: string) => text + "\n\n```js\nnew code\n```",
  ])("rejects altered or newly introduced protected Markdown", (change) => {
    expect(() => validateLocalReplacement(source, change(source))).toThrow(
      "protected code",
    );
  });

  it.each([
    "https://example.test/private?token=synthetic",
    "www.example.test/private",
    "synthetic.person@example.test",
    "<synthetic.person@example.test>",
  ])(
    "redacts GFM destination %s and restores it exactly",
    async (destination) => {
      const original = `I is writing about ${destination}.`;
      const api = model((input) => {
        expect(input).not.toContain(destination);
        return JSON.stringify({
          text: JSON.parse(input).text.replace("I is", "I am"),
          notes: [],
        });
      });
      expect((await review(original)).text).toBe(
        original.replace("I is", "I am"),
      );
      expect(api.destroy).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["https://example.test/private", "https://attacker.test/private"],
    ["www.example.test/private", "www.attacker.test/private"],
    ["synthetic.person@example.test", "another.person@example.test"],
    ["<synthetic.person@example.test>", "<another.person@example.test>"],
  ])("rejects a changed GFM destination %s", (original, replacement) => {
    expect(() =>
      validateLocalReplacement(
        `Original prose ${original}.`,
        `Improved prose ${replacement}.`,
      ),
    ).toThrow("protected code");
  });

  it("recognizes BOM-prefixed Properties with their original source offsets and redacts secrets", async () => {
    const original =
      "\uFEFF---\nsecret: synthetic-password\n---\n\nI is writing prose.";
    const ranges = localAIProtectedRanges(original);
    expect(ranges).toContainEqual({ from: 0, to: 1 });
    expect(ranges).toContainEqual({
      from: 1,
      to: original.indexOf("\n\nI is"),
    });
    model((input) => {
      expect(input).not.toContain("synthetic-password");
      return JSON.stringify({
        text: JSON.parse(input).text.replace("I is", "I am"),
        notes: [],
      });
    });
    expect((await review(original)).text).toBe(
      original.replace("I is", "I am"),
    );
    expect(() =>
      validateLocalReplacement(
        original,
        original.replace("synthetic-password", "changed-password"),
      ),
    ).toThrow("protected code");
    expect(() => validateLocalReplacement(original, original.slice(1))).toThrow(
      "protected code",
    );
  });
});
