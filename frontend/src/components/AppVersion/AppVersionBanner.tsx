import { useEffect, useState } from 'react';
import { ActionIcon, Button, Popover, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconExclamationMark } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { currentVersion, fetchServerVersion } from '@/utils/appVersion';

const CHECK_EVERY_MS = 10 * 60 * 1000;

/**
 * Сервер отдаёт другую сборку. Проверяем при монтировании (открыли
 * приложение, вошли) и при возврате на вкладку — не чаще раза в 10 минут.
 * Зовёт ModernLayout: от ответа зависит и плашка, и свёрнутость шапки.
 */
export function useIsOutdated(): boolean {
  const [outdated, setOutdated] = useState(false);

  useEffect(() => {
    let lastCheckAt = 0;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastCheckAt < CHECK_EVERY_MS) return;
      lastCheckAt = Date.now();
      try {
        const server = await fetchServerVersion();
        if (server) setOutdated(server !== currentVersion());
      } catch {
        // Нет сети — проверим в следующий раз.
      }
    };
    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, []);

  return outdated;
}

/**
 * Плашка в шапке рядом с меню пользователя: работает старый код. Сама
 * ничего не делает — по кнопке перезагрузка страницы (как F5). На телефоне
 * вместо надписи — значок «!».
 */
export function AppVersionBanner({ compact }: { compact: boolean }) {
  const { t } = useTranslation('common');
  const badge = t('appVersion.badge', 'Неактуальная версия');

  return (
    <Popover width={280} position="bottom-end" withArrow shadow="md">
      <Popover.Target>
        {compact ? (
          <ActionIcon
            variant="light"
            color="orange"
            radius="xl"
            aria-label={badge}>
            <IconExclamationMark size={18} />
          </ActionIcon>
        ) : (
          <Button
            size="compact-sm"
            variant="light"
            color="orange"
            leftSection={<IconAlertTriangle size={14} />}>
            {badge}
          </Button>
        )}
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm">
          <Text size="sm">
            {t(
              'appVersion.outdated',
              'Вы используете устаревшую версию интерфейса.',
            )}
          </Text>
          <Button
            size="xs"
            color="orange"
            onClick={() => window.location.reload()}>
            {t('appVersion.reload', 'Обновить страницу')}
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
