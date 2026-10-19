import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Button, Modal, PasswordInput, Stack, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconLogin } from '@tabler/icons-react';
import { useFormContext } from '@/components/Form/FormContext';
import { API_BASE_URL } from '@/services/baseQueryWithReauth';
import { selectCurrentSession } from '@/slices/authSlice';

/**
 * Кнопка тулбара формы канала Rutube: вход логином и паролем Rutube
 * (routers/rutube.py). Сервер сохраняет только токен, пароль — нет.
 */
export function RutubeLoginButton() {
  const { t } = useTranslation('marketing');
  const form = useFormContext();
  const { id } = useParams<{ id: string }>();
  const session = useSelector(selectCurrentSession);
  const [opened, setOpened] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  if (!id || form.getValues()?.type !== 'rutube') return null;

  const handleLogin = async () => {
    setLoading(true);
    // Ручка приватная: бэк требует и Bearer, и guard-куку
    const data = await fetch(`${API_BASE_URL}/marketing/rutube/login/${id}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${session?.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    })
      .then(response => response.json())
      .catch(() => ({ error: t('connect.network') }));
    setLoading(false);

    if (data.error) {
      notifications.show({
        title: t('connect.error'),
        message: data.error,
        color: 'red',
      });
      return;
    }
    // Вошли: «Подключён» перечитается из записи
    window.location.reload();
  };

  return (
    <>
      <Button
        variant="light"
        leftSection={<IconLogin size={16} />}
        onClick={() => setOpened(true)}>
        {t('rutube.login')}
      </Button>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={t('rutube.login')}>
        <Stack>
          <TextInput
            label={t('rutube.username')}
            value={username}
            onChange={event => setUsername(event.currentTarget.value)}
          />
          <PasswordInput
            label={t('rutube.password')}
            description={t('rutube.password_hint')}
            value={password}
            onChange={event => setPassword(event.currentTarget.value)}
          />
          <Button loading={loading} onClick={handleLogin}>
            {t('rutube.sign_in')}
          </Button>
        </Stack>
      </Modal>
    </>
  );
}
