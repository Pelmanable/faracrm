import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
} from 'react';
import {
  Box,
  Button,
  TextInput,
  Textarea,
  ActionIcon,
  Group,
  FileButton,
  Tooltip,
  Menu,
  Popover,
  SimpleGrid,
  Text,
} from '@mantine/core';
import {
  IconSend,
  IconPaperclip,
  IconMoodSmile,
  IconPhoto,
  IconFile,
  IconX,
  IconSignature,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import {
  useSendMessageMutation,
  useGetChatEmailSubjectQuery,
} from '@/services/api/chat';
import type { SendMessageAttachment } from '@/services/api/chat';
import {
  AttachmentPreview,
  VoiceRecorder,
  isImageMimetype,
  useAttachmentViewer,
} from '@/components/Attachment';
import type { RecordedVoice } from '@/components/Attachment';
import { useUploadFile } from '@/hooks/useUploadFile';
import { fileMimetype } from '@/hooks/useFileUploads';
import { EmojiPicker } from './EmojiPicker';
import { ConnectorSwitcher, ConnectorOption } from './ConnectorSwitcher';
import { EmailRichInput, normalizeEmailHtml } from './EmailRichInput';
import { useReadQuery } from '@/services/api/crudApi';
import type { ChatSignature } from '@/types/records';
import styles from './ChatInput.module.css';

/** Достать простой текст из HTML — для проверки «пусто ли письмо». */
function htmlToPlainText(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
  div
    .querySelectorAll('p, li, blockquote, pre')
    .forEach(node => node.append('\n'));
  return (div.textContent || '').trim();
}

function textToHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return `<p>${div.innerHTML.replace(/\n/g, '<br>')}</p>`;
}

// Файл до отправки — в памяти браузера (превью оттуда же); на сервер он уходит
// частями по «Отправить», как и голосовое
interface AttachmentFile {
  file: File;
  _localId: string;
}

interface ChatInputProps {
  chatId: number;
  currentUserId: number;
  currentUserName?: string;
  onTyping?: () => void;
  connectorId?: number;
  disabled?: boolean;
  // Для ConnectorSwitcher (иконка выбора канала)
  connectors?: ConnectorOption[];
  onConnectorSelect?: (connectorId: number | null) => void;
  // Коннектор по умолчанию (галочка в свитчере) + сохранение выбора default.
  defaultConnectorId?: number | null;
  onSetDefaultConnector?: (connectorId: number | null) => void;
  // Callback после отправки сообщения
  onMessageSent?: () => void;
  // Теги: к какому лиду/задаче привязать исходящее (панель чата партнёра на
  // форме лида/задачи проставляет автоматически). Уходят в message.lead_id/task_id.
  leadId?: number | null;
  taskId?: number | null;
}

const MAX_FILES = 10;

export function ChatInput(props: ChatInputProps) {
  return (
    <ChatComposer key={`${props.currentUserId}:${props.chatId}`} {...props} />
  );
}

function ChatComposer({
  chatId,
  currentUserId,
  currentUserName,
  onTyping,
  connectorId,
  disabled,
  connectors,
  onConnectorSelect,
  defaultConnectorId,
  onSetDefaultConnector,
  onMessageSent,
  leadId,
  taskId,
}: ChatInputProps) {
  const { t } = useTranslation('chat');
  const [message, setMessage] = useState('');
  // Тема письма (для email). Дефолт подтягивается из ручки (имя чата или тема
  // последнего письма); пользователь может переопределить.
  const [subject, setSubject] = useState('');
  // Ключ для ремонта rich-редактора письма после отправки (очистка контента).
  const [composerKey, setComposerKey] = useState(0);
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [emojiOpened, setEmojiOpened] = useState(false);
  const attachmentViewer = useAttachmentViewer();
  const [, setIsRecording] = useState(false);

  const [sendMessage] = useSendMessageMutation();
  const uploadFile = useUploadFile();
  // Идёт отправка: файлы грузятся, потом уходит сообщение
  const [sending, setSending] = useState(false);
  // Процент загрузки файла по _localId — пока идёт отправка
  const [progress, setProgress] = useState<Record<string, number>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cursor = useRef<[number, number] | null>(null);
  useLayoutEffect(() => {
    if (cursor.current) {
      inputRef.current?.setSelectionRange(...cursor.current);
      cursor.current = null;
    }
  }, [message]);
  const imageInputRef = useRef<() => void>(null);
  const fileInputRef = useRef<() => void>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Голосовое сообщение готово к отправке
  const [pendingVoice, setPendingVoice] = useState<RecordedVoice | null>(null);

  // Счётчик для сброса VoiceRecorder после отправки
  const [voiceResetKey, setVoiceResetKey] = useState(0);

  // Выбран ли email-коннектор — тогда показываем rich-редактор письма
  // (более высокое поле + форматирование), а не однострочный ввод.
  const selectedConnector = connectors?.find(
    c => c.connector_id === connectorId,
  );
  const isEmail = selectedConnector?.connector_type === 'email';
  // Тип коннектора для оптимистик-рендера (email → HTML сразу).
  const selectedConnectorType = selectedConnector?.connector_type;
  const isExternal =
    !!connectorId &&
    !!selectedConnector &&
    selectedConnectorType !== 'internal';
  const { currentData: user } = useReadQuery(
    { model: 'users', id: currentUserId, fields: ['chat_signatures'] },
    { skip: !currentUserId || !isExternal, refetchOnMountOrArgChange: true },
  );
  const signature = (
    user?.data.chat_signatures as ChatSignature[] | null
  )?.find(item => item.connector_id === connectorId);
  const body = signature?.body ?? '';
  const signatureBody = useMemo(
    () =>
      isEmail
        ? normalizeEmailHtml(
            signature?.format === 'html' ? body : textToHtml(body),
          )
        : signature?.format === 'html'
          ? htmlToPlainText(body)
          : body,
    [body, isEmail, signature?.format],
  );
  const hasSignature = !!(
    isEmail ? htmlToPlainText(signatureBody) : signatureBody
  ).trim();
  const inserted = useRef({ connectorId, isEmail, suffix: '', applied: false });
  const appendSignature = useCallback(
    (text: string) => {
      if (
        !hasSignature ||
        (inserted.current.suffix && text.endsWith(inserted.current.suffix))
      )
        return text;
      const head = (isEmail ? htmlToPlainText(text) : text.trim())
        ? text.trimEnd()
        : '';
      if (inputRef.current) {
        cursor.current = [
          Math.min(inputRef.current.selectionStart, head.length),
          Math.min(inputRef.current.selectionEnd, head.length),
        ];
      }
      const suffix =
        (head ? (isEmail ? '<p></p>' : '\n\n') : '') + signatureBody;
      inserted.current = { connectorId, isEmail, suffix, applied: true };
      return head + suffix;
    },
    [connectorId, isEmail, hasSignature, signatureBody],
  );

  useEffect(() => {
    let next = message;
    const previous = inserted.current;
    if (previous.connectorId !== connectorId || previous.isEmail !== isEmail) {
      const intact = !!previous.suffix && next.endsWith(previous.suffix);
      if (intact) next = next.slice(0, -previous.suffix.length);
      if (previous.isEmail !== isEmail && next) {
        next = isEmail ? textToHtml(next) : htmlToPlainText(next);
      }
      // Отредактированный текст сохраняем; автоматически вторую подпись не добавляем.
      inserted.current = {
        connectorId,
        isEmail,
        suffix: '',
        applied: previous.applied && !intact && !!next.trim(),
      };
    }
    if (
      !inserted.current.applied &&
      signature?.auto_insert &&
      isExternal &&
      !disabled &&
      !sending &&
      !pendingVoice &&
      (isEmail ? htmlToPlainText(next) : next.trim())
    ) {
      next = appendSignature(next);
    }
    if (next !== message) setMessage(next);
  }, [
    connectorId,
    isEmail,
    message,
    signature?.auto_insert,
    isExternal,
    disabled,
    sending,
    pendingVoice,
    appendSignature,
  ]);

  // Дефолтная тема письма (имя чата / тема последнего письма). Грузим только
  // для email. Подставляем в поле при смене чата/появлении данных; правки
  // пользователя не затираем, т.к. без инвалидации ручка не перезапрашивается.
  const { data: emailSubjectData } = useGetChatEmailSubjectQuery(
    { chatId },
    { skip: !isEmail },
  );
  const defaultSubject = emailSubjectData?.data?.subject;
  useEffect(() => {
    if (isEmail && defaultSubject !== undefined) {
      setSubject(defaultSubject);
    }
    // Сбрасываем к дефолту при смене чата и при первой загрузке данных.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, defaultSubject, isEmail]);

  // Есть ли что отправлять (для email проверяем текст письма без HTML-тегов).
  const hasText = isEmail
    ? htmlToPlainText(message).trim().length > 0
    : message.trim().length > 0;
  // Файл или запись — на сервер частями, в сообщение — его upload_id
  const upload = useCallback(
    async (
      {
        file,
        ...meta
      }: { file: Blob } & Omit<SendMessageAttachment, 'upload_id'>,
      onProgress?: (loaded: number, total: number) => void,
    ): Promise<SendMessageAttachment> => ({
      ...meta,
      upload_id: await uploadFile(file, {
        name: meta.name,
        mimetype: meta.mimetype,
        onProgress,
      }),
    }),
    [uploadFile],
  );

  const handleSend = useCallback(async () => {
    // Для письма тело — HTML; иначе обычный текст.
    const plain = isEmail ? htmlToPlainText(message).trim() : message.trim();

    // Отправка голосового сообщения
    if (pendingVoice) {
      try {
        await sendMessage({
          chatId,
          body: ' ',
          connector_id: connectorId,
          connector_type: selectedConnectorType,
          lead_id: leadId,
          task_id: taskId,
          currentUserId,
          currentUserName,
          attachments: [await upload(pendingVoice)],
        }).unwrap();
        setPendingVoice(null);
        setIsRecording(false);
        setVoiceResetKey(k => k + 1); // Сбрасываем VoiceRecorder
        onMessageSent?.();
      } catch (error) {
        console.error('Failed to send voice message:', error);
      }
      return;
    }

    // Обычное сообщение / письмо
    if ((!plain && attachments.length === 0) || disabled || sending) return;

    // Для email тело — «email-формат» {subject, html} (тема едет внутри body,
    // как system хранит JSON). Для остального — обычный plain-текст.
    const bodyToSend = isEmail
      ? JSON.stringify({ subject: subject.trim(), html: plain ? message : '' })
      : plain || ' ';

    setSending(true);
    try {
      // Файлы — на сервер, затем сообщение с их upload_id
      const uploaded = await Promise.all(
        attachments.map(({ file, _localId }) =>
          upload(
            {
              file,
              name: file.name,
              mimetype: fileMimetype(file),
              size: file.size,
            },
            (loaded, total) =>
              setProgress(prev => ({
                ...prev,
                [_localId]: (loaded / total) * 100,
              })),
          ).catch(error => {
            notifications.show({
              color: 'red',
              message: t('uploadFailed', { name: file.name }),
            });
            throw error;
          }),
        ),
      );
      await sendMessage({
        chatId,
        body: bodyToSend,
        connector_id: connectorId,
        connector_type: selectedConnectorType,
        currentUserId,
        currentUserName,
        attachments: uploaded.length > 0 ? uploaded : undefined,
      }).unwrap();

      setMessage('');
      inserted.current = { connectorId, isEmail, suffix: '', applied: false };
      setComposerKey(k => k + 1); // очистить rich-редактор письма
      setAttachments([]);
      inputRef.current?.focus();
      onMessageSent?.();
    } catch (error) {
      // Файлы остаются в поле — отправить можно ещё раз
      console.error('Failed to send message:', error);
    } finally {
      setSending(false);
      setProgress({});
    }
  }, [
    message,
    isEmail,
    attachments,
    sending,
    pendingVoice,
    upload,
    t,
    chatId,
    connectorId,
    currentUserId,
    currentUserName,
    disabled,
    sendMessage,
    onMessageSent,
    selectedConnectorType,
    subject,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);

    if (onTyping) {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      onTyping();
      typingTimeoutRef.current = setTimeout(() => {
        typingTimeoutRef.current = null;
      }, 2000);
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    if (disabled || sending) return;
    const start = inputRef.current?.selectionStart ?? message.length;
    const end = inputRef.current?.selectionEnd ?? start;
    cursor.current = [start + emoji.length, start + emoji.length];
    setMessage(prev => prev.slice(0, start) + emoji + prev.slice(end));
    setEmojiOpened(false);
    inputRef.current?.focus();
  };

  const handleFileSelect = (files: File[] | null) => {
    if (!files || files.length === 0) return;

    if (attachments.length + files.length > MAX_FILES) {
      console.warn(`Maximum ${MAX_FILES} files allowed`);
      return;
    }

    const added: AttachmentFile[] = files.map(file => ({
      file,
      _localId: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    }));
    setAttachments(prev => [...prev, ...added]);
  };

  const handleRemoveAttachment = (localId: string) => {
    setAttachments(prev => prev.filter(a => a._localId !== localId));
  };

  const handleVoiceRecorded = async (voice: RecordedVoice) => {
    // Отправляем голосовое сообщение сразу
    try {
      await sendMessage({
        chatId,
        body: '',
        connector_id: connectorId,
        connector_type: selectedConnectorType,
        currentUserId,
        currentUserName,
        attachments: [await upload(voice)],
      }).unwrap();
      setIsRecording(false);
    } catch (error) {
      console.error('Failed to send voice message:', error);
    }
  };

  // Ещё не отправленные картинки — из памяти браузера, со стрелками по
  // соседним картинкам (остальные файлы без id окну показать нечем)
  const handleViewAttachment = (index: number) => {
    const items = attachments.map(({ file }) => ({
      name: file.name,
      mimetype: fileMimetype(file),
      file,
    }));
    attachmentViewer.open(
      items[index],
      items.filter(item => isImageMimetype(item.mimetype)),
    );
  };

  const canAddMore = attachments.length < MAX_FILES;

  const handleClearAllAttachments = () => {
    setAttachments([]);
  };

  const hasContent = hasText || attachments.length > 0 || !!pendingVoice;
  // Пока идёт отправка, кнопка видна, но неактивна
  const canSend = hasContent && !sending;

  const signatureButton = isExternal && (
    <span
      title={t(
        hasSignature
          ? 'users:signatures.insert'
          : 'users:signatures.configureHint',
      )}>
      <Button
        variant="subtle"
        size="compact-sm"
        leftSection={<IconSignature size={16} />}
        disabled={!hasSignature || disabled || sending || !!pendingVoice}
        onClick={() => setMessage(appendSignature(message))}>
        {t('users:signatures.button')}
      </Button>
    </span>
  );

  // Кнопки, общие для письма и обычного сообщения.
  const attachMenu = (
    <Menu position="top-start" withArrow>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          size="lg"
          disabled={disabled || !canAddMore}
          title={t('attach')}>
          <IconPaperclip size={20} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          leftSection={<IconPhoto size={16} />}
          onClick={() => document.getElementById('image-input')?.click()}>
          {t('attachImage')}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconFile size={16} />}
          onClick={() => document.getElementById('file-input')?.click()}>
          {t('attachFile')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );

  // Переключатель коннектора — иконка канала (subtle, как скрепка).
  const connectorSwitcher = connectors &&
    connectors.length > 1 &&
    onConnectorSelect && (
      <ConnectorSwitcher
        connectors={connectors}
        selectedConnectorId={connectorId ?? null}
        onSelect={onConnectorSelect}
        defaultConnectorId={defaultConnectorId ?? null}
        onSetDefault={onSetDefaultConnector}
        disabled={disabled}
      />
    );

  const sendButton = (
    <Tooltip label={t('send')} position="top">
      <ActionIcon
        variant="filled"
        size="lg"
        radius="xl"
        onClick={handleSend}
        loading={sending}
        disabled={!canSend || disabled}>
        <IconSend size={18} />
      </ActionIcon>
    </Tooltip>
  );

  return (
    <Box className={styles.container}>
      {attachments.length > 0 && (
        <Box className={styles.attachmentsPreview}>
          <Group justify="space-between" mb="xs">
            <Text size="xs" c="dimmed">
              {t('attachedFiles', { count: attachments.length })}
            </Text>
            <ActionIcon
              variant="subtle"
              size="xs"
              color="gray"
              onClick={handleClearAllAttachments}
              title={t('clearAll')}>
              <IconX size={14} />
            </ActionIcon>
          </Group>
          <SimpleGrid cols={6} spacing="xs">
            {attachments.map(({ file, _localId }, index) => (
              <AttachmentPreview
                key={_localId}
                attachment={{
                  name: file.name,
                  mimetype: fileMimetype(file),
                  size: file.size,
                  file,
                }}
                progress={progress[_localId] ?? null}
                onDelete={() => handleRemoveAttachment(_localId)}
                onClick={
                  isImageMimetype(fileMimetype(file))
                    ? () => handleViewAttachment(index)
                    : undefined
                }
                showPreview={true}
                previewSize={60}
                compact
              />
            ))}
          </SimpleGrid>
        </Box>
      )}

      {/* Hidden FileButtons */}
      <FileButton
        onChange={handleFileSelect}
        accept="image/*"
        multiple
        resetRef={imageInputRef}>
        {props => (
          <button {...props} style={{ display: 'none' }} id="image-input" />
        )}
      </FileButton>
      <FileButton
        onChange={handleFileSelect}
        accept="*/*"
        multiple
        resetRef={fileInputRef}>
        {props => (
          <button {...props} style={{ display: 'none' }} id="file-input" />
        )}
      </FileButton>

      {isEmail ? (
        // Письмо — тема (хедер) + rich-редактор (жирный/курсив/списки).
        // key=composerKey ремонтит редактор после отправки для очистки.
        // Enter = перенос строки, Ctrl/Cmd+Enter = отправка.
        <Group gap="xs" wrap="nowrap" align="flex-end">
          {attachMenu}
          <Box style={{ flex: 1, minWidth: 0 }}>
            <TextInput
              value={subject}
              onChange={e => setSubject(e.currentTarget.value)}
              placeholder={t('emailSubject', 'Тема письма')}
              disabled={disabled}
              size="sm"
              mb={6}
            />
            <EmailRichInput
              key={composerKey}
              value={message}
              onChange={setMessage}
              onSend={handleSend}
              disabled={disabled || sending}
            />
          </Box>
          {signatureButton}
          {connectorSwitcher}
          {sendButton}
        </Group>
      ) : (
        // Как в Telegram: одно закруглённое поле, кнопки внутри него; справа
        // микрофон, пока отправлять нечего, иначе на его месте «Отправить».
        <Group gap="xs" wrap="nowrap">
          {/* Пока голосовое ждёт отправки, поля нет: уйдёт только запись, а
              на мобильном плееру и кнопке «Отправить» нужна вся строка (#40). */}
          {!pendingVoice && (
            <Box className={styles.field}>
              <Popover
                opened={emojiOpened}
                onChange={setEmojiOpened}
                position="top-start"
                withArrow
                shadow="md">
                <Popover.Target>
                  <ActionIcon
                    variant="subtle"
                    size="lg"
                    disabled={disabled}
                    title={t('emoji')}
                    onClick={() => setEmojiOpened(o => !o)}>
                    <IconMoodSmile size={20} />
                  </ActionIcon>
                </Popover.Target>
                <Popover.Dropdown p={0}>
                  <EmojiPicker onSelect={handleEmojiSelect} />
                </Popover.Dropdown>
              </Popover>
              <Textarea
                ref={inputRef}
                autosize
                minRows={1}
                maxRows={8}
                variant="unstyled"
                className={styles.input}
                placeholder={t('typeMessage')}
                value={message}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                disabled={disabled || sending}
              />
              {attachMenu}
              {signatureButton}
              {connectorSwitcher}
            </Box>
          )}
          {!hasText && attachments.length === 0 && (
            <VoiceRecorder
              key={voiceResetKey}
              onRecorded={handleVoiceRecorded}
              onRecordingReady={setPendingVoice}
              onCancel={() => {
                setIsRecording(false);
                setPendingVoice(null);
              }}
              disabled={disabled}
              showSendButton={false}
            />
          )}
          {hasContent && sendButton}
        </Group>
      )}

      {attachmentViewer.modal}
    </Box>
  );
}

export default ChatInput;
