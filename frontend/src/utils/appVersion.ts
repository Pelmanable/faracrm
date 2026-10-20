/**
 * Версия интерфейса — src единственного <script type="module"> в index.html:
 * в сборке это /assets/index-<хеш>.js, Vite меняет хеш при любой правке
 * кода. В dev строка постоянная — проверки молчат.
 *
 * Код ничего не делает за пользователя (ни выхода, ни перезагрузки): по
 * версии только решаем, показывать ли плашку (AppVersionBanner).
 */
const ENTRY_SCRIPT = 'script[type="module"][src]';

const entryOf = (doc: Document): string | null =>
  doc.querySelector(ENTRY_SCRIPT)?.getAttribute('src') ?? null;

export const currentVersion = (): string | null => entryOf(document);

/** Версия, которую сейчас отдаёт сервер — мимо любого кеша. */
export async function fetchServerVersion(): Promise<string | null> {
  const response = await fetch(
    `${import.meta.env.BASE_URL}index.html?t=${Date.now()}`,
    { cache: 'no-store' },
  );
  if (!response.ok) return null;
  const html = await response.text();
  return entryOf(new DOMParser().parseFromString(html, 'text/html'));
}
