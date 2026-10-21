// Граница ошибок рендера всего приложения (встроенный механизм React):
// сообщение вместо белого экрана. Без неё React 19 при такой ошибке размонтирует всё.
//
// Ловит ошибки, брошенные, пока React рисует дерево:
//   - при отрисовке компонента (в т.ч. не загрузился чанк React.lazy после
//     деплоя — lazy бросает ошибку прямо в рендере);
//   - в useEffect/useLayoutEffect, конструкторах и методах жизненного цикла.
// НЕ ловит (React тут не в своём обходе дерева): обработчики событий
// (onClick…), асинхронный код (промисы, setTimeout, запросы — их разбирает
// baseQueryWithReauth) и сбой загрузки главного скрипта до старта React.
//
// Стоит снаружи провайдеров (main.tsx), поэтому разметка и стили без Mantine.

import { Component, CSSProperties, ReactNode } from 'react';

const messageStyle: CSSProperties = {
  padding: '48px 16px',
  fontFamily: 'system-ui, sans-serif',
  textAlign: 'center',
};

export class AppRenderErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[app] интерфейс упал:', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div style={messageStyle}>
        <p>Не удалось загрузить интерфейс. Обновите страницу (Ctrl+F5).</p>
        <p>Если не помогло — очистите данные сайта в настройках браузера.</p>
      </div>
    );
  }
}
