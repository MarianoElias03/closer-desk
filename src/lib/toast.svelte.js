export const toasts = $state([]);
let id = 0;
export function toast(text, kind = 'ok') {
  const t = { id: ++id, text, kind };
  toasts.push(t);
  setTimeout(() => {
    const i = toasts.findIndex((x) => x.id === t.id);
    if (i >= 0) toasts.splice(i, 1);
  }, kind === 'error' ? 6000 : 3000);
}
