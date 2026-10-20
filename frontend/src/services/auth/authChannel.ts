/**
 * Вход и выход между вкладками одного браузера. Сессия лежит в общем
 * localStorage, но каждая вкладка держит её в Redux с момента загрузки и
 * сама об изменениях не узнаёт. Шлют запросы login и logout (ручные вход
 * и выход, auth.ts), слушает Layout: что именно случилось, неважно —
 * вкладка в любом случае начинает с нуля.
 */
const channel = new BroadcastChannel('fara-auth');

export const notifyAuthChange = () => channel.postMessage('changed');

export function onAuthChange(handler: () => void): () => void {
  channel.addEventListener('message', handler);
  return () => channel.removeEventListener('message', handler);
}
