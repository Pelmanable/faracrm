import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Button, Modal, PasswordInput, Stack, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBrandTelegram } from '@tabler/icons-react';
import { useFormContext } from '@/components/Form/FormContext';
import { API_BASE_URL } from '@/services/baseQueryWithReauth';
import { selectCurrentSession } from '@/slices/authSlice';

type Step = 'phone' | 'code' | 'password';

/**
 * Кнопка тулбара формы канала «Telegram (аккаунт)»: вход в аккаунт по
 * телефону, коду из Telegram и, если включена 2FA, паролю
 * (routers/telegram.py). После входа форма перечитывается («Подключён»).
 */
export function TelegramLoginButton() {
  const { t } = useTranslation('marketing');
  const form = useFormContext();
  const { id } = useParams<{ id: string }>();
  const session = useSelector(selectCurrentSession);
  const [opened, setOpened] = useState(false);
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  if (!id || form.getValues()?.type !== 'telegram_account') return null;

  // Ручки приватные: бэк требует и Bearer, и guard-куку
  const post = (path: string, body: object) =>
    fetch(`${API_BASE_URL}/marketing/telegram/${path}/${id}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${session?.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
      .then(response => response.json())
      .catch(() => ({ error: t('connect.network') }));

  const requests: Record<Step, () => Promise<any>> = {
    phone: () => post('code', { phone }),
    code: () => post('sign_in', { phone, code }),
    password: () => post('sign_in', { password }),
  };

  const handleOpen = () => {
    setStep('phone');
    setOpened(true);
  };

  const handleNext = async () => {
    setLoading(true);
    const data = await requests[step]();
    setLoading(false);

    if (data.error) {
      notifications.show({
        title: t('connect.error'),
        message: data.error,
        color: 'red',
      });
      return;
    }
    if (step === 'phone') {
      setStep('code');
      return;
    }
    if (data.password_required) {
      setStep('password');
      return;
    }
    // Вошли: «Подключён» перечитается из записи
    window.location.reload();
  };

  return (
    <>
      <Button
        variant="light"
        leftSection={<IconBrandTelegram size={16} />}
        onClick={handleOpen}>
        {t('telegram.login')}
      </Button>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={t('telegram.login')}>
        <Stack>
          {step === 'phone' && (
            <TextInput
              label={t('telegram.phone')}
              placeholder="+79991234567"
              value={phone}
              onChange={event => setPhone(event.currentTarget.value)}
            />
          )}
          {step === 'code' && (
            <TextInput
              label={t('telegram.code')}
              description={t('telegram.code_hint')}
              value={code}
              onChange={event => setCode(event.currentTarget.value)}
            />
          )}
          {step === 'password' && (
            <PasswordInput
              label={t('telegram.password')}
              value={password}
              onChange={event => setPassword(event.currentTarget.value)}
            />
          )}
          <Button loading={loading} onClick={handleNext}>
            {t(step === 'phone' ? 'telegram.send_code' : 'telegram.sign_in')}
          </Button>
        </Stack>
      </Modal>
    </>
  );
}
