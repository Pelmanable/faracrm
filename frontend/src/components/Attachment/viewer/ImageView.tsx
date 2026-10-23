import type { Dispatch, SetStateAction } from 'react';
import { Box, Image, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCopy,
  IconRotate,
  IconRotateClockwise,
  IconZoomIn,
  IconZoomOut,
} from '@tabler/icons-react';
import { ToolbarButton } from './ToolbarButton';
import classes from './AttachmentViewerModal.module.css';

/** Картинка с масштабом и поворотом; кнопки — ImageControls в тулбаре. */
export function ImageView({
  src,
  name,
  zoom,
  rotation,
}: {
  src: string;
  name?: string | null;
  zoom: number;
  rotation: number;
}) {
  return (
    <Box
      className={classes.imageWrapper}
      style={{ transform: `rotate(${rotation}deg) scale(${zoom})` }}>
      <Image
        src={src}
        alt={name ?? ''}
        fit="contain"
        className={classes.image}
      />
    </Box>
  );
}

/** Кнопки картинки в тулбаре окна: масштаб, поворот, ссылка на файл. */
export function ImageControls({
  src,
  zoom,
  setZoom,
  setRotation,
}: {
  src: string;
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
  setRotation: Dispatch<SetStateAction<number>>;
}) {
  // Абсолютный URL картинки — например, вставить иконку в icons[].src
  // PWA-манифеста (форма компании). data:-ссылку ещё не сохранённого файла
  // копируем как есть.
  const handleCopyUrl = async () => {
    try {
      const url = src.startsWith('data:')
        ? src
        : new URL(src, window.location.origin).toString();
      await navigator.clipboard.writeText(url);
      notifications.show({ message: 'URL скопирован', color: 'green' });
    } catch {
      notifications.show({
        message: 'Не удалось скопировать URL',
        color: 'red',
      });
    }
  };

  return (
    <>
      <ToolbarButton
        label="Уменьшить"
        icon={IconZoomOut}
        onClick={() => setZoom(value => Math.max(value - 0.25, 0.5))}
      />
      <Text size="sm" c="white" w={50} ta="center">
        {Math.round(zoom * 100)}%
      </Text>
      <ToolbarButton
        label="Увеличить"
        icon={IconZoomIn}
        onClick={() => setZoom(value => Math.min(value + 0.25, 3))}
      />
      <Box w={16} />
      <ToolbarButton
        label="Повернуть влево"
        icon={IconRotate}
        onClick={() => setRotation(value => (value - 90 + 360) % 360)}
      />
      <ToolbarButton
        label="Повернуть вправо"
        icon={IconRotateClockwise}
        onClick={() => setRotation(value => (value + 90) % 360)}
      />
      <Box w={16} />
      <ToolbarButton
        label="Скопировать URL"
        icon={IconCopy}
        onClick={handleCopyUrl}
      />
    </>
  );
}
