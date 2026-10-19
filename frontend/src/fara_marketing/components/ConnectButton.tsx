import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Button } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlugConnected } from '@tabler/icons-react';
import { useFormContext } from '@/components/Form/FormContext';
import { API_BASE_URL } from '@/services/baseQueryWithReauth';
import { selectCurrentSession } from '@/slices/authSlice';

// Типы каналов, которые подключаются по OAuth (routers/oauth.py)
const OAUTH_TYPES = ['youtube', 'instagram'];

/**
 * Кнопка тулбара формы канала YouTube / Instagram: открывает согласие
 * площадки в новом окне. Колбэк сохраняет доступ и перечитывает форму.
 */
export function ConnectButton() {
  const { t } = useTranslation('marketing');
  const form = useFormContext();
  const { id } = useParams<{ id: string }>();
  const session = useSelector(selectCurrentSession);
  const [loading, setLoading] = useState(false);
  const type = form.getValues()?.type;

  if (!id || !OAUTH_TYPES.includes(type)) return null;

  const handleConnect = async () => {
    setLoading(true);
    // Ручка приватная: бэк требует и Bearer, и guard-куку
    const data = await fetch(`${API_BASE_URL}/marketing/${type}/auth/${id}`, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${session?.token}` },
    })
      .then(response => response.json())
      .catch(() => ({ error: t('connect.network') }));
    setLoading(false);

    if (data.authorization_url) {
      window.open(data.authorization_url, '_blank', 'width=600,height=700');
      return;
    }
    notifications.show({
      title: t('connect.error'),
      message: data.error,
      color: 'red',
    });
  };

  return (
    <Button
      variant="light"
      leftSection={<IconPlugConnected size={16} />}
      loading={loading}
      onClick={handleConnect}>
      {t(`connect.${type}`)}
    </Button>
  );
}
