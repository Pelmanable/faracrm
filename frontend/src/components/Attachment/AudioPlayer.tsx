import { useState, useRef, useEffect } from 'react';
import { Box, ActionIcon, Text, Group, Slider } from '@mantine/core';
import { IconPlayerPlay, IconPlayerPause } from '@tabler/icons-react';
import { attachmentContentUrl } from '@/utils/attachmentUrls';
import classes from './AudioPlayer.module.css';

interface AudioPlayerProps {
  /** ID вложения для загрузки с сервера */
  attachmentId?: number;
  /** Ссылка blob: на ещё не сохранённый файл */
  src?: string;
  /** Голосовое сообщение - показывать волновую форму */
  isVoice?: boolean;
  /** Компактный режим для чата */
  compact?: boolean;
}

function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Статическая волновая форма SVG
function Waveform({
  progress,
  isPlaying,
}: {
  progress: number;
  isPlaying: boolean;
}) {
  // Генерируем псевдо-случайные высоты баров
  const bars = [
    0.3, 0.5, 0.7, 0.4, 0.8, 0.6, 0.9, 0.5, 0.7, 0.3, 0.6, 0.8, 0.4, 0.7, 0.5,
    0.9, 0.6, 0.4, 0.7, 0.5, 0.8, 0.3, 0.6, 0.5, 0.4,
  ];
  const barWidth = 3;
  const gap = 2;
  const totalWidth = bars.length * (barWidth + gap);
  const progressX = (progress / 100) * totalWidth;

  return (
    <svg
      width="100%"
      height="24"
      viewBox={`0 0 ${totalWidth} 24`}
      preserveAspectRatio="none"
      className={classes.waveform}>
      {bars.map((height, i) => {
        const x = i * (barWidth + gap);
        const barHeight = height * 20;
        const y = (24 - barHeight) / 2;
        const isPast = x < progressX;

        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barWidth}
            height={barHeight}
            rx={1.5}
            className={`${classes.waveformBar} ${isPast ? classes.waveformBarActive : ''} ${isPlaying ? classes.waveformBarPlaying : ''}`}
          />
        );
      })}
    </svg>
  );
}

export function AudioPlayer({
  attachmentId,
  src,
  isVoice = false,
  compact = false,
}: AudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoading] = useState(false);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Загрузка аудио
  useEffect(() => {
    setAudioSrc(null);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setError(null);

    // Ещё не сохранённый файл — из памяти браузера (ссылкой владеет
    // вызывающий), сохранённый — с сервера через cookie auth
    if (src) {
      setAudioSrc(src);
    } else if (attachmentId) {
      setAudioSrc(attachmentContentUrl(attachmentId));
    }
  }, [attachmentId, src]);

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    // Иначе сбой не виден вообще: кнопка нажимается, ничего не происходит.
    const handleError = () => {
      const code = audio.error?.code;
      setIsPlaying(false);
      setError(
        code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
          ? 'Формат записи не поддерживается браузером'
          : 'Не удалось загрузить запись',
      );
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [audioSrc]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }
    // play() возвращает промис и может отклониться — без await иконка
    // переключалась на «паузу», а звука не было.
    try {
      await audio.play();
      setIsPlaying(true);
      setError(null);
    } catch {
      setIsPlaying(false);
      setError('Не удалось воспроизвести запись');
    }
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleSeek = (value: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = value;
      setCurrentTime(value);
    }
  };

  return (
    <Box className={`${classes.container} ${compact ? classes.compact : ''}`}>
      <audio ref={audioRef} src={audioSrc || undefined} preload="metadata" />

      <Group gap="xs" wrap="nowrap" style={{ width: '100%' }}>
        <ActionIcon
          variant="filled"
          size={compact ? 'md' : 'lg'}
          radius="xl"
          onClick={togglePlay}
          disabled={!audioSrc || isLoading}
          loading={isLoading}>
          {isPlaying ? (
            <IconPlayerPause size={18} />
          ) : (
            <IconPlayerPlay size={18} />
          )}
        </ActionIcon>

        <Box style={{ flex: 1, minWidth: 0 }}>
          {isVoice ? (
            <Box
              style={{ cursor: 'pointer' }}
              onClick={e => {
                if (audioRef.current && duration > 0) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const clickX = e.clientX - rect.left;
                  const percent = clickX / rect.width;
                  handleSeek(percent * duration);
                }
              }}>
              <Waveform progress={progress} isPlaying={isPlaying} />
            </Box>
          ) : (
            <Slider
              value={currentTime}
              onChange={handleSeek}
              min={0}
              max={duration || 100}
              step={0.1}
              size="xs"
              disabled={!audioSrc || duration === 0}
              label={null}
              className={classes.slider}
            />
          )}
        </Box>

        <Text size="xs" c="dimmed" style={{ minWidth: 45, textAlign: 'right' }}>
          {formatDuration(currentTime)} / {formatDuration(duration)}
        </Text>
      </Group>

      {error && (
        <Text size="xs" c="red" mt={4}>
          {error}
        </Text>
      )}
    </Box>
  );
}

export default AudioPlayer;
