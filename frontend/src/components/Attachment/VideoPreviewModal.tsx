/**
 * Просмотр видео-вложения без скачивания (issue #39): полноэкранное окно с
 * плеером браузера, как у картинок. Из файлового хранилища превью-роут
 * отдаёт видео кусками (Range) — работает перемотка, играет Safari на
 * iPhone; из облачного — целиком, без перемотки. Пока окно закрыто, видео
 * не грузится. Формат, который браузер не умеет (avi, wmv…), — сообщение и
 * кнопка «Скачать».
 */
import { useState } from 'react';
import { ActionIcon, Box, Group, Modal, Text, Tooltip } from '@mantine/core';
import { IconDownload, IconX } from '@tabler/icons-react';
import {
  attachmentPreviewUrl,
  downloadAttachment,
} from '@/utils/attachmentUrls';
import classes from './VideoPreviewModal.module.css';

interface VideoPreviewModalProps {
  opened: boolean;
  onClose: () => void;
  attachmentId: number;
  checksum?: string | null;
  filename?: string | null;
}

export function VideoPreviewModal({
  opened,
  onClose,
  attachmentId,
  checksum,
  filename,
}: VideoPreviewModalProps) {
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    setError(null);
    onClose();
  };

  const handleError = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    setError(
      e.currentTarget.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        ? 'Формат видео не поддерживается браузером — скачайте файл'
        : 'Не удалось загрузить видео',
    );
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      fullScreen
      padding={0}
      withCloseButton={false}
      classNames={{ body: classes.body, content: classes.content }}>
      <Group className={classes.toolbar} justify="space-between" wrap="nowrap">
        <Text size="sm" c="white" truncate>
          {filename}
        </Text>
        <Group gap="xs" wrap="nowrap">
          <Tooltip label="Скачать">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              onClick={() =>
                downloadAttachment(attachmentId, filename ?? undefined)
              }>
              <IconDownload size={20} color="white" />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Закрыть">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              onClick={handleClose}>
              <IconX size={20} color="white" />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Box className={classes.player}>
        {error ? (
          <Text c="white">{error}</Text>
        ) : (
          <video
            className={classes.video}
            src={attachmentPreviewUrl(
              attachmentId,
              undefined,
              undefined,
              checksum,
            )}
            controls
            autoPlay
            playsInline
            onError={handleError}
          />
        )}
      </Box>
    </Modal>
  );
}
