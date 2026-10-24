// Порядок слоёв — до любых стилей библиотек
import './styles/layers.css';

// Стили Mantine — в слоях: в проде CSS чанков подключается раньше
// index-*.css, и без слоёв Mantine перебивал наши классы той же специфичности
import '@mantine/core/styles.layer.css';
import '@mantinex/mantine-header/styles.layer.css';
import 'mantine-datatable/styles.layer.css';
import '@mantine/dates/styles.layer.css';
import '@mantine/notifications/styles.layer.css';
import '@mantine/tiptap/styles.layer.css';

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
