import { Box, Center, Loader, Text } from '@mantine/core';
import { useAttachmentText } from './useAttachmentText';
import classes from './AttachmentViewerModal.module.css';

/** JSON — с отступами; обрезанный или битый — как есть. */
function formatText(text: string, isJson: boolean): string {
  if (!isJson) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Текст и код — исходником, как есть (HTML и XML тоже: это текст). */
export function TextView({
  attachmentId,
  mimetype,
  name,
}: {
  attachmentId: number;
  mimetype?: string | null;
  name?: string | null;
}) {
  const { text, truncated, error } = useAttachmentText(attachmentId);
  const isJson =
    mimetype === 'application/json' || !!name?.toLowerCase().endsWith('.json');

  return (
    <Box className={classes.sheet}>
      {error ? (
        <Text c="red">Не удалось загрузить файл — скачайте его</Text>
      ) : text === null ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : (
        <>
          <pre className={classes.pre}>{formatText(text, isJson)}</pre>
          {truncated && (
            <Text size="sm" c="dimmed" mt="xs">
              Показан первый миллион символов — весь файл во вкладке или в
              скачанном
            </Text>
          )}
        </>
      )}
    </Box>
  );
}
