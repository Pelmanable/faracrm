import { useMemo, useState } from 'react';
import { Box, Button, Group, Text, Spoiler } from '@mantine/core';
import DOMPurify, { type Config } from 'dompurify';
import styles from './EmailMessageContent.module.css';

// Адрес из интернета: http(s) или без схемы («//host/…»). Относительные
// (наши вложения) и data: — не внешние
const REMOTE_URL = /^(?:https?:)?\/\//i;
const REMOTE_CSS_URL = /url\(\s*['"]?\s*(?:https?:)?\/\/[^)]*\)/gi;

interface EmailMessageContentProps {
  body: string;
  maxHeight?: number;
}

/**
 * Разобрать «email-формат» тела: JSON {subject, html} (по аналогии с тем, как
 * system хранит {event, params}). Фолбэк для старых писем — весь body как HTML.
 */
export function parseEmailBody(body: string): { subject?: string; html: string } {
  if (!body) return { html: '' };
  try {
    const data = JSON.parse(body);
    if (data && typeof data === 'object' && ('html' in data || 'subject' in data)) {
      return { subject: data.subject || undefined, html: data.html || '' };
    }
  } catch {
    // не наш JSON — старый формат (plain HTML)
  }
  return { html: body };
}

/**
 * Компонент для безопасного отображения HTML email сообщений.
 * 
 * Особенности:
 * - Санитизация HTML через DOMPurify (защита от XSS)
 * - Все ссылки открываются в новой вкладке
 * - Ссылки помечаются иконкой внешней ссылки
 * - Изображения отображаются inline
 * - Длинные сообщения сворачиваются
 */
export function EmailMessageContent({ 
  body,
  maxHeight = 300
}: EmailMessageContentProps) {
  // Тема и HTML едут внутри body (email-формат); тему рисуем хедером.
  const { subject, html } = useMemo(() => parseEmailBody(body), [body]);
  const [showImages, setShowImages] = useState(false);

  // Санитизация HTML
  const { sanitizedHtml, blocked } = useMemo(() => {
    // Настраиваем DOMPurify
    const config: Config = {
      ALLOWED_TAGS: [
        'p', 'br', 'b', 'i', 'u', 'strong', 'em', 'a', 'img',
        'div', 'span', 'blockquote', 'pre', 'code',
        'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'table', 'thead', 'tbody', 'tr', 'td', 'th',
        'hr', 'sub', 'sup', 'small',
      ],
      ALLOWED_ATTR: [
        'href', 'src', 'alt', 'title', 'style', 'class',
        'width', 'height', 'target', 'rel',
      ],
      ALLOW_DATA_ATTR: false,
      // Запрещаем опасные протоколы
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    };

    // Санитизируем (html из email-формата)
    let clean = DOMPurify.sanitize(html, config);

    // После санитизации модифицируем ссылки
    const div = document.createElement('div');
    div.innerHTML = clean as unknown as string;

    // Все ссылки открываем в новой вкладке и добавляем rel="noopener noreferrer"
    const links = div.querySelectorAll('a');
    links.forEach(link => {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer nofollow');
      // Добавляем класс для стилизации
      link.classList.add(styles.externalLink);
    });

    // Ограничиваем размер изображений
    const images = div.querySelectorAll('img');
    images.forEach(img => {
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
    });

    // Картинки из интернета — только по кнопке: загрузка сообщает
    // отправителю, что письмо открыли, когда и с какого IP
    let blocked = 0;
    if (!showImages) {
      images.forEach(img => {
        if (REMOTE_URL.test(img.getAttribute('src') ?? '')) {
          img.removeAttribute('src');
          blocked += 1;
        }
      });
      div.querySelectorAll('[style*="url("]').forEach(el => {
        const style = el.getAttribute('style') ?? '';
        const local = style.replace(REMOTE_CSS_URL, 'none');
        if (local !== style) {
          el.setAttribute('style', local);
          blocked += 1;
        }
      });
    }

    return { sanitizedHtml: div.innerHTML, blocked };
  }, [html, showImages]);

  const imagesNotice = blocked > 0 && (
    <Group gap="xs" px="xs" py={4}>
      <Text size="xs" c="dimmed">
        Картинки из интернета скрыты
      </Text>
      <Button
        size="compact-xs"
        variant="light"
        onClick={() => setShowImages(true)}>
        Показать картинки
      </Button>
    </Group>
  );

  // Проверяем, нужно ли сворачивание
  const isLongContent = html.length > 1000;

  if (isLongContent) {
    return (
      <Box className={styles.emailContent}>
        {subject && (
          <Box className={styles.emailHeader}>
            <Text size="xs" fw={600} lineClamp={1}>
              {subject}
            </Text>
          </Box>
        )}
        {imagesNotice}
        <Spoiler
          maxHeight={maxHeight} 
          showLabel="Показать полностью"
          hideLabel="Свернуть"
          styles={{
            control: {
              color: 'var(--mantine-color-blue-6)',
              fontSize: 'var(--mantine-font-size-xs)',
            }
          }}
        >
          <div 
            className={styles.emailBody}
            dangerouslySetInnerHTML={{ __html: sanitizedHtml }} 
          />
        </Spoiler>
      </Box>
    );
  }

  return (
    <Box className={styles.emailContent}>
      {subject && (
        <Box className={styles.emailHeader}>
          <Text size="xs" fw={600} lineClamp={1}>
            {subject}
          </Text>
        </Box>
      )}
      {imagesNotice}
      <div
        className={styles.emailBody}
        dangerouslySetInnerHTML={{ __html: sanitizedHtml }} 
      />
    </Box>
  );
}
