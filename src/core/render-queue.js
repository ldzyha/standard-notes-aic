function abortError() {
  const error = new Error("Mermaid render was superseded");
  error.name = "AbortError";
  return error;
}

/** Canceling a caller removes its pending payload immediately. An active task
 * retains its slot until the engine actually finishes; abort is not a mutex release. */
export function makeMermaidRenderQueue({
  concurrency = 1,
  maxPending = 128,
} = {}) {
  if (
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    !Number.isSafeInteger(maxPending) ||
    maxPending < 1
  )
    throw new TypeError("Render queue limits must be positive integers");
  const pending = [];
  let active = 0;
  const drain = () => {
    while (active < concurrency && pending.length) {
      const job = pending.shift();
      active++;
      job.active = true;
      Promise.resolve()
        .then(() => {
          if (!job.settled) return job.task();
        })
        .then(
          (value) => job.finish(true, value),
          (error) => job.finish(false, error),
        )
        .finally(() => {
          active--;
          drain();
        });
    }
  };
  return Object.freeze({
    state: () => Object.freeze({ active, pending: pending.length }),
    schedule(task, { signal = null } = {}) {
      if (signal?.aborted) return Promise.reject(abortError());
      if (pending.length >= maxPending)
        return Promise.reject(
          new Error(
            `Mermaid render queue is limited to ${maxPending} pending diagrams.`,
          ),
        );
      return new Promise((resolve, reject) => {
        const job = { task, active: false, settled: false, finish: null };
        const abort = () => {
          if (!job.active) {
            const index = pending.indexOf(job);
            if (index >= 0) pending.splice(index, 1);
          }
          job.finish(false, abortError());
        };
        job.finish = (success, value) => {
          if (job.settled) return;
          job.settled = true;
          job.task = null;
          signal?.removeEventListener("abort", abort);
          if (success) resolve(value);
          else reject(value);
        };
        signal?.addEventListener("abort", abort, { once: true });
        pending.push(job);
        drain();
      });
    },
  });
}
