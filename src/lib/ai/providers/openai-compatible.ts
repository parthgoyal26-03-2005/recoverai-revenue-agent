import { MockAIProvider } from "@/lib/ai/providers/mock";
import { RECOVERY_SYSTEM_PROMPT } from "@/lib/ai/prompt";
import {
  recoveryAnalysisSchema,
  type AIProvider,
  type RecoveryAnalysis,
  type RecoveryContext,
} from "@/lib/ai/types";

export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}

type OpenAICompatibleConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  name?: string;
  timeoutMs?: number;
};

export class OpenAICompatibleProvider implements AIProvider {
  readonly name: string;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: OpenAICompatibleConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.model = config.model;
    this.name = config.name ?? "openai-compatible";
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  async analyzeRecoveryCase(context: RecoveryContext): Promise<RecoveryAnalysis> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: RECOVERY_SYSTEM_PROMPT },
            {
              role: "user",
              content: `Analyze this recovery case and return the JSON decision:\n${JSON.stringify(
                context
              )}`,
            },
          ],
        }),
      });
    } catch (error) {
      throw new AIProviderError("AI provider request failed.", error);
    }

    if (!response.ok) {
      throw new AIProviderError(
        `AI provider returned HTTP ${response.status}.`
      );
    }

    let payload: { choices?: { message?: { content?: string } }[] };
    try {
      payload = await response.json();
    } catch (error) {
      throw new AIProviderError("AI provider returned invalid JSON envelope.", error);
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new AIProviderError("AI provider returned an empty completion.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new AIProviderError("AI completion is not valid JSON.", error);
    }

    const validated = recoveryAnalysisSchema.safeParse(parsed);
    if (!validated.success) {
      throw new AIProviderError(
        `AI completion failed schema validation: ${validated.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`
      );
    }

    return validated.data;
  }
}

type ProviderSpec = {
  label: string;
  apiKeyEnv: string;
  baseUrlEnv: string;
  defaultBaseUrl: string;
  modelEnv: string;
  defaultModel: string;
};

export const PROVIDER_SPECS: Record<"gemini" | "groq", ProviderSpec> = {
  gemini: {
    label: "gemini",
    apiKeyEnv: "GEMINI_API_KEY",
    baseUrlEnv: "GEMINI_BASE_URL",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    modelEnv: "GEMINI_MODEL",
    defaultModel: "gemini-2.5-flash",
  },
  groq: {
    label: "groq",
    apiKeyEnv: "GROQ_API_KEY",
    baseUrlEnv: "GROQ_BASE_URL",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    modelEnv: "GROQ_MODEL",
    defaultModel: "llama-3.3-70b-versatile",
  },
};

function tryCreateProvider(id: "gemini" | "groq"): AIProvider | null {
  const spec = PROVIDER_SPECS[id];
  const apiKey = process.env[spec.apiKeyEnv];
  if (!apiKey) return null;
  return new OpenAICompatibleProvider({
    apiKey,
    baseUrl: process.env[spec.baseUrlEnv] || spec.defaultBaseUrl,
    model: process.env[spec.modelEnv] || spec.defaultModel,
    name: spec.label,
  });
}

export function createAiProviderFromEnv(): AIProvider | null {
  const selected = process.env.AI_PROVIDER?.trim().toLowerCase();

  if (selected === "mock") return new MockAIProvider();

  if (selected === "gemini" || selected === "groq") {
    return tryCreateProvider(selected);
  }

  if (!selected) {
    for (const id of ["gemini", "groq"] as const) {
      const provider = tryCreateProvider(id);
      if (provider) return provider;
    }
  }

  return null;
}
