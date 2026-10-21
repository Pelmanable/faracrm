// Базовые стили Mantine (ОБЯЗАТЕЛЬНО возвращаем)
import '@mantine/core/styles.css';
import '@mantinex/mantine-header/styles.css';

// Стили DataTable (ОСТАВЛЯЕМ ТОЛЬКО ОДИН ИМПОРТ, БЕЗ .layer)
import 'mantine-datatable/styles.css';

// Остальные стили компонентов
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/tiptap/styles.css';

// Ваши глобальные стили импортируются САМЫМИ ПОСЛЕДНИМИ,
// чтобы при необходимости перебивать стили библиотек
import './styles/global-mobile.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './i18n';
import { AppRenderErrorBoundary } from './components/AppRenderErrorBoundary';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppRenderErrorBoundary>
      <App />
    </AppRenderErrorBoundary>
  </React.StrictMode>,
);
