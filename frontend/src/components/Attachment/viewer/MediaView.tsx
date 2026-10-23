/**
 * Видео и аудио — плеером браузера. Из файлового хранилища превью-роут
 * отдаёт файл кусками (Range): работает перемотка, играет Safari на iPhone.
 * Формат, который браузер не умеет (avi, wmv, amr…), — сообщением.
 */
import { useState } from 'react';
import { Text } from '@mantine/core';
import classes from './AttachmentViewerModal.module.css';

function isUnsupported(element: HTMLMediaElement): boolean {
  return element.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED;
}

export function VideoView({ src }: { src: string }) {
  const [error, setError] = useState<string | null>(null);

  if (error) return <Text c="white">{error}</Text>;
  return (
    <video
      className={classes.video}
      src={src}
      controls
      autoPlay
      playsInline
      onError={e =>
        setError(
          isUnsupported(e.currentTarget)
            ? 'Формат видео не поддерживается браузером — скачайте файл'
            : 'Не удалось загрузить видео',
        )
      }
    />
  );
}

export function AudioView({ src }: { src: string }) {
  const [error, setError] = useState<string | null>(null);

  if (error) return <Text c="white">{error}</Text>;
  return (
    <audio
      className={classes.audio}
      src={src}
      controls
      autoPlay
      onError={e =>
        setError(
          isUnsupported(e.currentTarget)
            ? 'Формат записи не поддерживается браузером — скачайте файл'
            : 'Не удалось загрузить запись',
        )
      }
    />
  );
}
