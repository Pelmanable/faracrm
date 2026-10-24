import { test, expect } from '../../fixtures';

/**
 * E2E: импорт партнёров из Excel через окно списка. Файл грузится частями
 * при выборе, разбор и импорт читают его по upload_id.
 *
 * Файл — выгрузка «Экспорт в Excel»: два партнёра с уникальными именами
 * выгружаются, удаляются и импортируются обратно (без библиотеки xlsx в
 * тестах).
 */

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

test.describe('Excel — импорт', () => {
  let names: string[] = [];

  test.afterEach(async ({ api, adminSession }) => {
    const found = await api.searchRecords(adminSession, 'partners', {
      fields: ['id'],
      filter: [['name', 'in', names]],
    });
    for (const partner of found.data) {
      await api.deleteRecord(adminSession, 'partners', partner.id);
    }
  });

  test('партнёры из xlsx: загрузка, разбор, импорт', async ({
    page,
    api,
    adminSession,
  }) => {
    const stamp = Date.now();
    names = [`E2E Импорт A ${stamp}`, `E2E Импорт B ${stamp}`];
    const ids: number[] = [];
    for (const name of names) {
      ids.push((await api.createRecord(adminSession, 'partners', { name })).id);
    }
    const file = await api.exportExcel(adminSession, 'partners', {
      fields: ['name'],
      ids,
    });
    for (const id of ids) await api.deleteRecord(adminSession, 'partners', id);

    await page.goto('/partners');
    await page.waitForLoadState('networkidle');
    // «⋮» в шапке списка → «Импорт из Excel»
    await page.locator('button:has(svg.tabler-icon-dots-vertical)').first().click();
    await page
      .getByRole('menuitem', { name: /импорт из excel|import from excel/i })
      .click();
    const dialog = page.getByRole('dialog', {
      name: /импорт из excel|import from excel/i,
    });

    const part = page.waitForResponse(
      r =>
        r.request().method() === 'PATCH' &&
        r.url().includes('/attachments/uploads/'),
    );
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'partners.xlsx',
      mimeType: XLSX_MIME,
      buffer: file,
    });
    expect((await part).ok()).toBe(true);

    // Разбор: колонка name сопоставилась сама
    await expect(
      dialog.getByText(/строк с данными: 2|data rows: 2/i),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: /^(импортировать|import)$/i })
      .click();
    await expect(
      dialog.getByText(/создано записей: 2|records created: 2/i),
    ).toBeVisible();

    const found = await api.searchRecords(adminSession, 'partners', {
      fields: ['name'],
      filter: [['name', 'in', names]],
    });
    expect(found.data.map(p => p.name).sort()).toEqual([...names].sort());
  });
});
