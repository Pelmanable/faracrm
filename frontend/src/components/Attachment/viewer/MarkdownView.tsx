import { Box, Center, Loader, Text, Typography } from '@mantine/core';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAttachmentText } from './useAttachmentText';
import classes from './AttachmentViewerModal.module.css';

// Ссылки — в новой вкладке: переход в этой ушёл бы из приложения.
// Сырой HTML внутри .md react-markdown не выполняет.
const markdownComponents: Components = {
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
};

const remarkPlugins = [remarkGfm];

/** Markdown — отрисованным документом. */
export function MarkdownView({ attachmentId }: { attachmentId: number }) {
  const { text, error } = useAttachmentText(attachmentId);

  return (
    <Box className={classes.sheet}>
      {error ? (
        <Text c="red">Не удалось загрузить файл — скачайте его</Text>
      ) : text === null ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : (
        <Typography>
          <Markdown
            remarkPlugins={remarkPlugins}
            components={markdownComponents}>
            {text}
          </Markdown>
        </Typography>
      )}
    </Box>
  );
}
