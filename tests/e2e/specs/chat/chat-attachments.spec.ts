import { test, expect } from '../../fixtures';
import { ChatPage } from '../../pages/ChatPage';

/**
 * E2E: файл и голосовое в чате. Файл грузится частями сразу при выборе
 * (PATCH /attachments/uploads/{id}), в сообщение уходит его upload_id;
 * голосовое пишется с фейкового микрофона Chromium и уходит так же.
 */

// Фейковый микрофон: разрешение без окна, звук — тестовый сигнал
test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  },
  permissions: ['microphone'],
});

const isPart = (method: string, url: string) =>
  method === 'PATCH' && url.includes('/attachments/uploads/');

test.describe('Чат — файлы и голосовые', () => {
  let chatId: number;
  let chatName: string;

  test.beforeEach(async ({ api, adminSession }) => {
    chatName = `E2E Files ${Date.now()}`;
    chatId = (await api.createChat(adminSession, { name: chatName })).id;
  });

  test.afterEach(async ({ api, adminSession }) => {
    if (chatId) await api.deleteChat(adminSession, chatId).catch(() => {});
  });

  test('файл: загрузка частями при выборе и отправка', async ({
    page,
    api,
    adminSession,
  }) => {
    const chat = new ChatPage(page);
    await chat.goto();
    await chat.openChat(chatName);

    const content = Buffer.from(`E2E chat file ${Date.now()}`);
    const part = page.waitForResponse(r =>
      isPart(r.request().method(), r.url()),
    );
    // Скрытый input пункта «Файл» скрепки
    await page
      .locator('input[type="file"][accept="*/*"]')
      .first()
      .setInputFiles({
        name: 'e2e-chat.txt',
        mimeType: 'text/plain',
        buffer: content,
      });
    expect((await part).ok()).toBe(true);

    // «Отправить» активна, когда файл загружен
    const sendButton = page.locator('button:has(svg.tabler-icon-send)').last();
    await expect(sendButton).toBeEnabled({ timeout: 10_000 });
    const sent = page.waitForResponse(
      r =>
        r.request().method() === 'POST' &&
        r.url().includes(`/chats/${chatId}/messages`),
    );
    await sendButton.click();
    const response = await sent;
    expect(response.ok()).toBe(true);

    const [attachment] = (await response.json()).data.attachments;
    expect(attachment.name).toBe('e2e-chat.txt');
    const downloaded = await api.fetchAttachmentContent(
      adminSession,
      attachment.id,
    );
    expect(Buffer.from(downloaded).equals(content)).toBe(true);
  });

  test('голосовое: запись с микрофона и отправка', async ({
    page,
    api,
    adminSession,
  }) => {
    const chat = new ChatPage(page);
    await chat.goto();
    await chat.openChat(chatName);

    await page.locator('button:has(svg.tabler-icon-microphone)').click();
    await page.waitForTimeout(1_500);
    await page.locator('button:has(svg.tabler-icon-player-stop)').click();
    // Запись готова: плеер с ней и кнопка отправки
    await expect(page.locator('audio[controls]')).toBeVisible();

    const part = page.waitForResponse(r =>
      isPart(r.request().method(), r.url()),
    );
    const sent = page.waitForResponse(
      r =>
        r.request().method() === 'POST' &&
        r.url().includes(`/chats/${chatId}/messages`),
    );
    await page.locator('button:has(svg.tabler-icon-send)').last().click();
    expect((await part).ok()).toBe(true);
    const response = await sent;
    expect(response.ok()).toBe(true);

    const [voice] = (await response.json()).data.attachments;
    expect(voice.is_voice).toBe(true);
    expect(voice.mimetype).toBe('audio/webm');
    expect(voice.size).toBeGreaterThan(0);
    const downloaded = await api.fetchAttachmentContent(adminSession, voice.id);
    expect(downloaded.length).toBe(voice.size);
  });
});
