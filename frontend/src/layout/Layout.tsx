import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Center, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import LoadingScreen from '@components/LoadingScreen/LoadingScreen';
import { useSelector } from 'react-redux';
import { selectIsLoggedIn } from '@/slices/authSlice';
import { SavedFiltersPreloader } from '@/components/SearchFilter';
import { LayoutThemeProvider, ModernLayout } from '@/components/ModernTheme';
import { useGetPublicConfigQuery } from '@/services/config/config';
import { notifyAuthChange, onAuthChange } from '@/services/auth/authChannel';

// Компонент выбора layout в зависимости от темы.
//
// ВРЕМЕННО: классическая тема (ProtectedLayout) СКРЫТА у всех — рендерим
// только ModernLayout. Импорты ProtectedLayout и useLayoutTheme здесь убраны;
// сам ProtectedLayout и его инфраструктура (NavbarMenu, SidebarContext/
// SidebarToggle) в коде сохранены, просто больше не используются из точки
// входа. LayoutThemeProvider оставлен — контекст темы всё ещё нужен UserMenu.
//
// Чтобы вернуть classic — восстановить импорты и ветвление:
//   import ProtectedLayout from './ProtectedLayout/ProtectedLayout';
//   import { useLayoutTheme } from '@/components/ModernTheme';
//   const { layoutTheme } = useLayoutTheme();
//   if (layoutTheme === 'classic') return (<><SavedFiltersPreloader/><ProtectedLayout/></>);
function ThemedLayout() {
  return (
    <>
      <SavedFiltersPreloader />
      <ModernLayout />
    </>
  );
}

function FullScreenLoader() {
  return (
    <div className="flex flex-auto flex-col h-[100vh]">
      <LoadingScreen />
    </div>
  );
}

// Публичные страницы — без входа: каталог маркетплейса (/market),
// регистрация (/register) и форма входа (/login). Всё остальное как раньше:
// авторизован → приложение, нет → форма входа.
const SignIn = lazy(() => import('@/fara_base/auth/SignIn'));
const MarketRoutes = lazy(
  () => import('@/fara_marketplace/public/MarketRoutes'),
);
const Register = lazy(() => import('@/fara_registration/Register'));

// Корень сайта для гостя. Куда вести — знает только сервер (public_home
// первого установленного модуля с публичной страницей), поэтому до ответа
// показываем экран загрузки, а не форму входа, которая тут же сменилась бы
// каталогом. Конфиг и так запрашивается при старте (BrandingHead), так что
// ждать почти нечего.
function PublicHome() {
  const { data, isLoading } = useGetPublicConfigQuery();
  if (isLoading) return <FullScreenLoader />;
  if (data?.public_home) return <Navigate to={data.public_home} replace />;
  return <SignIn />;
}

// Загружаем вкладку заново, только когда на неё смотрят: иначе после входа
// или выхода разом грузились бы все открытые вкладки. Обработчик один на
// модуль — повторно браузер его не добавит, слушатели не копятся.
function reloadIfVisible() {
  if (document.visibilityState !== 'visible') return;
  sessionStorage.clear();
  window.location.reload();
}

// Вместо приложения после входа/выхода в соседней вкладке. Без запросов:
// видно, пока вкладка в фоне (превью вкладки) и мгновение до перезагрузки.
function AuthChangedScreen() {
  const { t } = useTranslation('common');
  return (
    <Center h="100vh" px="md">
      <Stack align="center" gap="xs" maw={360}>
        <ThemeIcon variant="light" size={56} radius="xl">
          <IconRefresh size={28} />
        </ThemeIcon>
        <Text fw={500} ta="center">
          {t('auth.changedElsewhere', 'Вы вошли или вышли в другой вкладке')}
        </Text>
        <Text size="sm" c="dimmed" ta="center">
          {t(
            'auth.reloadOnReturn',
            'Страница обновится, когда вы на неё перейдёте',
          )}
        </Text>
      </Stack>
    </Center>
  );
}

export function Layout() {
  const authenticated = useSelector(selectIsLoggedIn);
  const [authChanged, setAuthChanged] = useState(false);

  // Вошли или вышли в соседней вкладке — тут только локально, без
  // запросов. logOut() не зовём: сброс кеша заставил бы BrandingHead
  // перезапросить конфиг.
  useEffect(
    () =>
      onAuthChange(() => {
        setAuthChanged(true);
        reloadIfVisible();
        document.addEventListener('visibilitychange', reloadIfVisible);
      }),
    [],
  );

  // Сессия сменилась в ЭТОЙ вкладке — вход, выход руками или по истёкшей
  // сессии (401, закрытый сокет) — сообщаем остальным. Петли нет: вкладка,
  // узнавшая о смене от соседей (authChanged), сама ничего не шлёт.
  const prevToken = useRef(authenticated);
  useEffect(() => {
    if (prevToken.current !== authenticated && !authChanged) {
      notifyAuthChange();
    }
    prevToken.current = authenticated;
  }, [authenticated, authChanged]);

  const AppLayout = useMemo(() => {
    if (authenticated) {
      // Возвращаем компонент с провайдером темы
      return () => (
        <LayoutThemeProvider>
          <ThemedLayout />
        </LayoutThemeProvider>
      );
    }
    return SignIn;
  }, [authenticated]);

  // Приложение убрано целиком: ни сокетов, ни таймеров, ни запросов, пока
  // вкладку не откроют.
  if (authChanged) return <AuthChangedScreen />;

  return (
    <Suspense fallback={<FullScreenLoader />}>
      <Routes>
        <Route path="/market/*" element={<MarketRoutes />} />
        <Route
          path="/register"
          element={authenticated ? <Navigate to="/" replace /> : <Register />}
        />
        <Route
          path="/login"
          element={authenticated ? <Navigate to="/" replace /> : <SignIn />}
        />
        {!authenticated && <Route index element={<PublicHome />} />}
        <Route path="*" element={<AppLayout />} />
      </Routes>
    </Suspense>
  );
}
