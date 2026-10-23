import {
  Box,
  Center,
  Divider,
  Loader,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { EmailMessageContent } from '@/fara_chat/components/EmailMessageContent';
import { useGetAttachmentEmailQuery } from '@/services/api/attachments';
import classes from './AttachmentViewerModal.module.css';

// Письмо в окне не сворачиваем: высота «Показать полностью» — с запасом
const NO_COLLAPSE_HEIGHT = 100_000;

/**
 * Письмо .eml: заголовки и тело, как письмо в чате (HTML санитизирует
 * EmailMessageContent). Вложения письма — только именами.
 */
export function EmailView({ attachmentId }: { attachmentId: number }) {
  const { data, isError } = useGetAttachmentEmailQuery(attachmentId);

  return (
    <Box className={classes.sheet}>
      {isError ? (
        <Text c="red">Не удалось прочитать письмо — скачайте файл</Text>
      ) : !data ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : (
        <Stack gap="xs">
          <Title order={4}>{data.subject || 'Без темы'}</Title>
          <Text size="sm">От: {data.from}</Text>
          <Text size="sm">Кому: {data.to}</Text>
          <Text size="sm" c="dimmed">
            {data.date}
          </Text>
          {data.attachments.length > 0 && (
            <Text size="sm">Вложения: {data.attachments.join(', ')}</Text>
          )}
          <Divider />
          {data.html ? (
            <EmailMessageContent
              body={JSON.stringify({ html: data.html })}
              maxHeight={NO_COLLAPSE_HEIGHT}
            />
          ) : (
            <pre className={classes.pre}>{data.text}</pre>
          )}
        </Stack>
      )}
    </Box>
  );
}
