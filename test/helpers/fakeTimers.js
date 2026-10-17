// -----------------------------------------------------------------------------
// Timers the tests fire by hand: nothing runs on its own (no real timer is
// ever armed, so nothing keeps the test process alive on Node 22 or 24).
// -----------------------------------------------------------------------------

export function createFakeTimers(clock) {
  const pending = new Map();
  let next = 1;
  return {
    pending,
    setTimeout(fn, ms) {
      const id = next++;
      pending.set(id, { fn, ms, at: clock.now + ms });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    /** The pending timers, soonest first. */
    list() {
      return [...pending.entries()].map(([id, t]) => ({ id, ...t })).sort((a, b) => a.at - b.at);
    },
    /** Move the clock to the soonest timer matching `filter` and run it. */
    async fire(filter = () => true) {
      const timer = this.list().find(filter);
      if (!timer) {
        throw new Error('No pending timer to fire');
      }
      pending.delete(timer.id);
      clock.now = Math.max(clock.now, timer.at);
      await timer.fn();
      return timer;
    },
  };
}
