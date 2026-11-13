// A bounded long poll wakes on a committed revision, not on a polling interval.
// Only metadata leaves this listener; the normal API still filters each view.
export function waitForSessionUpdate(ref, revision, student, signal, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    let unsubscribe, timer, settled = false;
    const finish = (value, error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); unsubscribe?.();
      signal?.removeEventListener('abort', aborted);
      if (error) reject(error); else resolve(value);
    };
    const aborted = () => finish({ cancelled: true });
    if (signal?.aborted) { aborted(); return; }
    signal?.addEventListener('abort', aborted, { once: true });
    timer = setTimeout(() => finish({ revision }), timeoutMs);
    try {
      unsubscribe = ref.onSnapshot(doc => {
        const data = doc.exists ? doc.data() : null;
        if (!data || data.status === 'deleted' || (student && (data.status === 'completed' || data.studentAccess === false))) {
          finish({ closed: true });
        } else if (data.revision !== revision) finish({ revision: data.revision });
      }, error => finish(null, error));
      if (settled) unsubscribe();
    } catch (error) { finish(null, error); }
  });
}
