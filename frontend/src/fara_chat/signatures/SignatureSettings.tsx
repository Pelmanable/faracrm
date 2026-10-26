import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { selectCurrentSession } from '@/slices/authSlice';
import { EmailRichInput } from '../components/EmailRichInput';
import { canUseSignatures } from './access';
import { useGetChatSignaturesQuery, useSaveChatSignatureMutation } from './api';

interface Props {
  initialConnectorId?: number;
  onSaved?: () => void;
}

export function SignatureSettings(props: Props) {
  const user = useSelector(selectCurrentSession)?.user_id;
  return <SignatureSettingsForm key={user?.id ?? 0} {...props} />;
}

function SignatureSettingsForm({ initialConnectorId, onSaved }: Props) {
  const { t } = useTranslation('chat');
  const user = useSelector(selectCurrentSession)?.user_id;
  const allowed = canUseSignatures(user);
  const {
    currentData: data,
    isLoading,
    isError,
    refetch,
  } = useGetChatSignaturesQuery(user?.id ?? 0, { skip: !allowed });
  const [saveSignature, { isLoading: saving }] = useSaveChatSignatureMutation();
  const [connectorId, setConnectorId] = useState<string | null>(
    initialConnectorId ? String(initialConnectorId) : null,
  );
  const [body, setBody] = useState('');
  const [autoInsert, setAutoInsert] = useState(false);
  const [revision, setRevision] = useState('');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const connector = data?.connectors.find(
    item => String(item.id) === connectorId,
  );
  const current = data?.data.find(
    item => String(item.connector_id) === connectorId,
  );

  useEffect(() => {
    if (!connectorId && data?.connectors.length === 1) {
      setConnectorId(String(data.connectors[0].id));
    }
  }, [connectorId, data?.connectors]);

  useEffect(() => {
    if (!dirty) {
      setBody(current?.body ?? '');
      setAutoInsert(current?.auto_insert ?? false);
      setRevision(data?.revision ?? '');
    }
  }, [connectorId, current, data?.revision, dirty]);

  const handleSave = async () => {
    if (!user || !connector || saving) return;
    setError('');
    try {
      await saveSignature({
        userId: user.id,
        connectorId: connector.id,
        body,
        autoInsert,
        revision,
      }).unwrap();
      setDirty(false);
      notifications.show({ message: t('signatures.saved'), color: 'green' });
      onSaved?.();
    } catch (failure) {
      const status =
        failure && typeof failure === 'object' && 'status' in failure
          ? failure.status
          : undefined;
      setError(
        t(status === 409 ? 'signatures.conflict' : 'signatures.saveError'),
      );
    }
  };

  const discard = () => {
    setDirty(false);
    setError('');
    setBody(current?.body ?? '');
    setAutoInsert(current?.auto_insert ?? false);
    setRevision(data?.revision ?? '');
  };
  const editBody = (value: string) => {
    setBody(value);
    setDirty(true);
  };

  return (
    <Stack gap="sm">
      <Title order={4}>{t('signatures.title')}</Title>
      <Text size="sm" c="dimmed">
        {t('signatures.description')}
      </Text>
      {!allowed ? (
        <Alert>{t('signatures.staffOnly')}</Alert>
      ) : isLoading ? (
        <Group>
          <Loader size="sm" />
          <Text size="sm">{t('signatures.loading')}</Text>
        </Group>
      ) : isError ? (
        <Alert color="red" title={t('signatures.loadError')}>
          <Text size="sm" mb="sm">
            {t('signatures.loadErrorHint')}
          </Text>
          <Button size="xs" variant="light" onClick={() => refetch()}>
            {t('signatures.retry')}
          </Button>
        </Alert>
      ) : (
        <>
          <Select
            label={t('signatures.connector')}
            placeholder={t('signatures.choose')}
            searchable
            value={connectorId}
            disabled={dirty || saving}
            data={(data?.connectors ?? []).map(item => ({
              value: String(item.id),
              label: item.active
                ? item.name
                : `${item.name} (${t('signatures.inactive')})`,
            }))}
            onChange={value => {
              setConnectorId(value);
              setError('');
            }}
          />
          {data?.connectors.length === 0 && (
            <Text size="sm">{t('signatures.noConnectors')}</Text>
          )}
          {connector && (
            <>
              {connector.type === 'email' ? (
                <Stack gap="xs">
                  <Text size="sm" fw={500}>
                    {t('signatures.body')}
                  </Text>
                  <EmailRichInput
                    value={body}
                    initialHtml={body}
                    onChange={editBody}
                    onSend={handleSave}
                    disabled={!connector.active || saving}
                    ariaLabel={t('signatures.body')}
                  />
                  <Text size="xs" c="dimmed">
                    {t('signatures.emailHint')}
                  </Text>
                </Stack>
              ) : (
                <Textarea
                  label={t('signatures.body')}
                  value={body}
                  autosize
                  minRows={3}
                  maxLength={2000}
                  disabled={!connector.active || saving}
                  onChange={event => editBody(event.currentTarget.value)}
                />
              )}
              <Checkbox
                label={t('signatures.autoInsert')}
                checked={autoInsert}
                disabled={!connector.active || saving}
                onChange={event => {
                  setAutoInsert(event.currentTarget.checked);
                  setDirty(true);
                }}
              />
              <Text size="xs" c="dimmed">
                {t('signatures.hint')}
              </Text>
              {dirty && (
                <Text size="xs" c="dimmed">
                  {t('signatures.unsaved')}
                </Text>
              )}
              {error && <Alert color="red">{error}</Alert>}
              <Group>
                {dirty && (
                  <Button variant="default" onClick={discard} disabled={saving}>
                    {t('signatures.cancel')}
                  </Button>
                )}
                <Button
                  onClick={handleSave}
                  loading={saving}
                  disabled={!dirty || !connector.active}>
                  {t('signatures.save')}
                </Button>
              </Group>
            </>
          )}
        </>
      )}
    </Stack>
  );
}
