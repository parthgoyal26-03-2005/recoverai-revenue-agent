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

export function createAiProviderFromEnv(): AIProvider | null {
  const explicit = process.env.AI_PROVIDER;
  if (explicit === "mock") return new MockAIProvider();

  const apiKey =
    process.env.OPENAI_API_KEY ?? process.env.AI_API_KEY ?? "";
  if (!apiKey && explicit !== "openai") return null;

  return new OpenAICompatibleProvider({
    apiKey,
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    model: process.env.AI_MODEL ?? "gpt-4o-mini",
  });
}
