/**
 * Runs `task` now and then every `intervalMs`, inside the API process.
 *
 * - A run that's still going when the next one is due is skipped, not stacked.
 * - A failing run is reported and the schedule carries on; it never crashes
 *   the server that's answering players.
 * - The timer doesn't keep Node alive on its own, so shutdown isn't delayed.
 *
 * Returns a function that stops the schedule.
 */
export function startScheduler(
  task: () => Promise<void>,
  intervalMs: number,
  onError: (error: unknown) => void,
): () => void {
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      await task();
    } catch (error) {
      onError(error);
    } finally {
      running = false;
    }
  }

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
