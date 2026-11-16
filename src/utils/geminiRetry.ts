export interface RetryOptions<T> {
  models: string[];
  run: (model: string) => Promise<T>;
  maxRetriesPerModel?: number;
  baseDelayMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

function getErrorText(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function isTransientGeminiError(err: unknown): boolean {
  const text = getErrorText(err).toLowerCase();
  return (
    text.includes('503') ||
    text.includes('unavailable') ||
    text.includes('high demand') ||
    text.includes('overloaded') ||
    text.includes('try again later') ||
    text.includes('429') ||
    text.includes('resource_exhausted') ||
    text.includes('econnreset') ||
    text.includes('etimedout') ||
    text.includes('fetch failed')
  );
}

export function extractFriendlyGeminiError(err: unknown): { status: number; message: string } {
  const raw = getErrorText(err);

  if (
    raw.includes('403') ||
    raw.includes('PERMISSION_DENIED') ||
    raw.includes('API_KEY_INVALID')
  ) {
    return {
      status: 403,
      message: 'Chave da API Gemini ausente ou inválida. Verifique Settings > Secrets.',
    };
  }

  if (raw.includes('503') || raw.includes('UNAVAILABLE') || raw.toLowerCase().includes('high demand')) {
    return {
      status: 503,
      message:
        'Os servidores de análise vocal estão com pico momentâneo de demanda (503). Tentamos automaticamente modelos alternativos, mas o serviço segue congestionado — aguarde alguns segundos e tente novamente.',
    };
  }

  if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message: 'Limite temporário de requisições atingido. Aguarde alguns segundos e tente novamente.',
    };
  }

  // Try extracting clean message if raw error is serialized JSON
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string }; message?: string };
    const cleanMsg = parsed?.error?.message || parsed?.message;
    if (cleanMsg) {
      return { status: 500, message: cleanMsg };
    }
  } catch {
    // Not raw JSON
  }

  return {
    status: 500,
    message: raw || 'Falha inesperada ao processar áudio no servidor.',
  };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Executes a Gemini operation with exponential backoff retries per model,
 * falling back to secondary models automatically if transient 503/429 errors persist.
 */
export async function executeWithRetryAndFallback<T>({
  models,
  run,
  maxRetriesPerModel = 2,
  baseDelayMs = 800,
  sleepFn = defaultSleep,
}: RetryOptions<T>): Promise<{ result: T; usedModel: string }> {
  if (models.length === 0) {
    throw new Error('Nenhum modelo especificado para execução.');
  }

  let lastError: unknown;

  for (let mIdx = 0; mIdx < models.length; mIdx++) {
    const model = models[mIdx];

    for (let attempt = 0; attempt <= maxRetriesPerModel; attempt++) {
      try {
        const result = await run(model);
        return { result, usedModel: model };
      } catch (err) {
        lastError = err;
        const transient = isTransientGeminiError(err);

        // Non-transient error (e.g. 400 bad request / 403 auth): fail fast without wasting retries
        if (!transient) {
          throw err;
        }

        const hasMoreAttemptsOnSameModel = attempt < maxRetriesPerModel;
        if (hasMoreAttemptsOnSameModel) {
          const delay = baseDelayMs * Math.pow(2, attempt);
          await sleepFn(delay);
        }
      }
    }
  }

  throw lastError;
}
