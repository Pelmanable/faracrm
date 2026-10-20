/**
 * Вход и выход между вкладками одного браузера. Сессия лежит в общем
 * localStorage, но каждая вкладка держит её в Redux с момента загрузки и
 * сама об изменениях не узнаёт. Шлёт и слушает Layout: при любой смене
 * сессии во вкладке (вход, выход, истёкшая сессия) — что именно случилось,
 * неважно, соседи в любом случае начинают с нуля.
 */
const channel = new BroadcastChannel('fara-auth');

export const notifyAuthChange = () => channel.postMessage('changed');

export function onAuthChange(handler: () => void): () => void {
  channel.addEventListener('message', handler);
  return () => channel.removeEventListener('message', handler);
}
