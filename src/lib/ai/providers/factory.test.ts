import { afterEach, describe, expect, it } from "vitest";
import {
  PROVIDER_SPECS,
  createAiProviderFromEnv,
  OpenAICompatibleProvider,
} from "@/lib/ai/providers/openai-compatible";
import { MockAIProvider } from "@/lib/ai/providers/mock";

const ENV_KEYS = [
  "AI_PROVIDER",
  "GEMINI_API_KEY",
  "GEMINI_BASE_URL",
  "GEMINI_MODEL",
  "GROQ_API_KEY",
  "GROQ_BASE_URL",
  "GROQ_MODEL",
] as const;

const savedEnv: Record<string, string | undefined> = {};
afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function withEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) {
    savedEnv[key] ??= process.env[key];
    const next = values[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
}

describe("AI provider factory", () => {
  it("returns the mock provider when AI_PROVIDER=mock", () => {
    withEnv({ AI_PROVIDER: "mock", GEMINI_API_KEY: "would-be-ignored" });
    expect(createAiProviderFromEnv()).toBeInstanceOf(MockAIProvider);
  });

  it("creates a gemini provider pointing at its OpenAI-compatible endpoint", () => {
    withEnv({
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "g-key",
      GEMINI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
      GEMINI_MODEL: "gemini-2.5-flash",
    });
    const provider = createAiProviderFromEnv();
    expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
    expect(provider?.name).toBe("gemini");
    expect(provider?.model).toBe("gemini-2.5-flash");
  });

  it("creates a groq provider with its own credentials and defaults", () => {
    withEnv({ AI_PROVIDER: "groq", GROQ_API_KEY: "gq-key" });
    const provider = createAiProviderFromEnv();
    expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
    expect(provider?.name).toBe("groq");
    expect(provider?.model).toBe(PROVIDER_SPECS.groq.defaultModel);
  });

  it("returns null (caller falls back to mock) when the selected provider has no API key", () => {
    withEnv({ AI_PROVIDER: "gemini" });
    expect(createAiProviderFromEnv()).toBeNull();

    withEnv({ AI_PROVIDER: "groq" });
    expect(createAiProviderFromEnv()).toBeNull();
  });

  it("auto-detects gemini/groq keys when AI_PROVIDER is unset, otherwise null", () => {
    withEnv({});
    expect(createAiProviderFromEnv()).toBeNull();

    withEnv({ GEMINI_API_KEY: "g-key" });
    expect(createAiProviderFromEnv()?.name).toBe("gemini");

    withEnv({ GEMINI_API_KEY: undefined, GROQ_API_KEY: "gq-key" });
    expect(createAiProviderFromEnv()?.name).toBe("groq");
  });
});
