export function getApiErrorMessage(error: unknown, fallback: string): string {
  const normalized = error as { error?: { message?: string }; message?: string };
  return normalized.error?.message || normalized.message || fallback;
}

