export type AssistantFormDraftFields = Readonly<Record<string, unknown>>;
export type AssistantFormDraftAdapter = (
  fields: AssistantFormDraftFields
) => void | Promise<void>;

const formDraftAdapters = new Map<string, Set<AssistantFormDraftAdapter>>();
const adapterWaiters = new Map<string, Set<() => void>>();

function cleanAdapterId(adapterId: string) {
  const value = adapterId.trim();
  if (!value) throw new Error("Form adapter id lipsa.");
  return value;
}

function notifyAdapterReady(adapterId: string) {
  const waiters = adapterWaiters.get(adapterId);
  if (!waiters) return;
  adapterWaiters.delete(adapterId);
  waiters.forEach((resolve) => resolve());
}

export function registerAssistantFormDraftAdapter(
  adapterId: string,
  adapter: AssistantFormDraftAdapter
) {
  const id = cleanAdapterId(adapterId);
  const adapters = formDraftAdapters.get(id) || new Set<AssistantFormDraftAdapter>();
  adapters.add(adapter);
  formDraftAdapters.set(id, adapters);
  notifyAdapterReady(id);

  return () => {
    const current = formDraftAdapters.get(id);
    current?.delete(adapter);
    if (current?.size === 0) formDraftAdapters.delete(id);
  };
}

export function hasAssistantFormDraftAdapter(adapterId: string) {
  return (formDraftAdapters.get(adapterId.trim())?.size || 0) > 0;
}

export function waitForAssistantFormDraftAdapter(adapterId: string, timeoutMs = 2_500) {
  const id = cleanAdapterId(adapterId);
  if (hasAssistantFormDraftAdapter(id)) return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      const waiters = adapterWaiters.get(id);
      waiters?.delete(onReady);
      if (waiters?.size === 0) adapterWaiters.delete(id);
      resolve(ready);
    };
    const onReady = () => finish(true);
    const timeout = globalThis.setTimeout(() => finish(false), timeoutMs);
    const waiters = adapterWaiters.get(id) || new Set<() => void>();
    waiters.add(onReady);
    adapterWaiters.set(id, waiters);
  });
}

export async function dispatchAssistantFormDraft(
  adapterId: string,
  fields: Record<string, unknown>,
  timeoutMs = 2_500
) {
  const id = cleanAdapterId(adapterId);
  if (!(await waitForAssistantFormDraftAdapter(id, timeoutMs))) return false;
  const adapters = Array.from(formDraftAdapters.get(id) || []);
  if (adapters.length === 0) return false;
  const safeFields = Object.freeze({ ...fields });
  await Promise.all(adapters.map((adapter) => adapter(safeFields)));
  return true;
}
