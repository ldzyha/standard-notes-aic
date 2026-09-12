export function makeMermaidRenderQueue(options?: {
  concurrency?: number;
  maxPending?: number;
}): Readonly<{
  state(): Readonly<{ active: number; pending: number }>;
  schedule<T>(
    task: () => Promise<T> | T,
    options?: { signal?: AbortSignal | null },
  ): Promise<T>;
}>;
