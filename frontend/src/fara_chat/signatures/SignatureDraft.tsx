import { ActionIcon, Box, Group, Text, Textarea } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { EmailRichInput } from '../components/EmailRichInput';

interface Props {
  body: string;
  channel: string;
  isEmail: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  onRemove: () => void;
  onSend: () => void;
}

export function SignatureDraft({
  body,
  channel,
  isEmail,
  disabled,
  onChange,
  onRemove,
  onSend,
}: Props) {
  const { t } = useTranslation('chat');
  return (
    <Box
      mt="xs"
      p="xs"
      style={{
        border: '1px dashed var(--mantine-color-default-border)',
        borderRadius: 8,
      }}>
      <Group justify="space-between" mb="xs">
        <Text size="xs" c="dimmed">
          {t('signatures.draft', { channel })}
        </Text>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          disabled={disabled}
          aria-label={t('signatures.remove')}
          onClick={onRemove}>
          <IconX size={14} />
        </ActionIcon>
      </Group>
      {isEmail ? (
        <EmailRichInput
          value={body}
          initialHtml={body}
          onChange={onChange}
          onSend={onSend}
          disabled={disabled}
          ariaLabel={t('signatures.draftLabel')}
        />
      ) : (
        <Textarea
          value={body}
          onChange={event => onChange(event.currentTarget.value)}
          disabled={disabled}
          autosize
          minRows={2}
          aria-label={t('signatures.draftLabel')}
        />
      )}
    </Box>
  );
}
