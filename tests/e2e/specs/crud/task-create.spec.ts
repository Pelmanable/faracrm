import { test, expect } from '../../fixtures';
import type { Page, Browser, BrowserContext } from '@playwright/test';
import { ApiHelper, Session } from '../../helpers/api.helper';

/**
 * E2E: создание задачи (task) под суперпользователем и под пользователем с
 * ролью «менеджер проектов» (project_manager). В каждом сценарии СНАЧАЛА
 * создаётся проект, ЗАТЕМ задача, привязанная к этому проекту.
 *
 * Зачем именно эти два актора. Открытие формы создания задачи дёргает
 * POST /auto/tasks/default_values. Дефолт task.user_id = текущий юзер ИЗ
 * СЕССИИ, и его role_ids сериализуются вместе с ним. Пока роли в сессии
 * клались как Role(code=...) без id, этот эндпоинт падал 500 на required
 * role_ids[].id — но ТОЛЬКО у актора, чья сессия несёт роли:
 *   - суперпользователь (admin) — обычно без ролей → базовый (не-регресс) путь;
 *   - project_manager — актор С ролями, именно он ловил 500.
 * Тест открывает форму задачи под обоими → покрывает фикс «роли несут id».
 *
 * Селекторы/хелперы — локальные копии из crud/complex-create.spec.ts
 * (data-path, pickCombobox), чтобы файл был самодостаточным.
 */

const API_URL = process.env.API_URL || 'http://127.0.0.1:8090';
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const PM_LOGIN = process.env.PM_LOGIN || 'e2e_pm';
const PM_PASSWORD = process.env.PM_PASSWORD || 'e2e_pm_pw';

// Форма создания сама по себе рендерится за ~1с. Но pm-сценарий гоняется
// на ВРУЧНУЮ поднятом BrowserContext внутри воркера, который параллельно
// тащит тяжёлые WS-тесты чата — под этим давлением холодный boot страницы
// иногда не укладывается в дефолтные 10с (у admin через storageState-фикстуру
// такого нет). Даём запас: рендер быстрый, поэтому большой таймаут почти
// всегда резолвится мгновенно и просто страхует worst-case под нагрузкой.
const FIELD_TIMEOUT = 30_000;

// ==================== Form helpers (копии из complex-create.spec.ts) ====================

/**
 * Открыть форму создания записи модели напрямую по URL `/<model>/create`.
 *
 * Намеренно НЕ идём через список + клик «Создать»: список рендерится через
 * ViewWrapper, чей контент гейтится готовностью запроса saved_filters
 * (filtersResolved). Под параллельной нагрузкой этот гейт иногда не
 * успевает за таймаут, и кнопка «Создать» на списке не появляется — тест
 * ловил флейк именно здесь. Форма создания — отдельный роут (create/*),
 * без ViewWrapper и без этого гейта, и она же дёргает default_values —
 * то, что мы и проверяем. Ждём появления первого поля формы (data-path).
 */
/**
 * Восстановить сессию в текущем контексте после разлогина.
 *
 * baseQueryWithReauth.ts: 401 при живой сессии → logOut() → localStorage
 * .session очищается, показывается экран логина. Под параллельной нагрузкой
 * suite на busts запросов вручную поднятого контекста иногда проскакивает
 * один спурьёзный 401 (сама сессия при этом валидна) — и контекст
 * разлогинивает. Кладём сессию обратно; полный reload (следующий goto)
 * нужен потому, что Redux берёт сессию из localStorage только при загрузке
 * страницы.
 */
async function reinjectSession(page: Page, session: Session) {
  const apiHost = new URL(API_URL).hostname;
  await page.context().addCookies([
    {
      name: 'session_cookie',
      value: session.cookieToken,
      domain: apiHost,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto('/');
  await page.evaluate((s) => {
    const { cookieToken, ...data } = s as Record<string, unknown>;
    localStorage.setItem('session', JSON.stringify(data));
  }, session as unknown as Record<string, unknown>);
}

async function gotoCreate(page: Page, model: string, session?: Session) {
  // Ждём именно поле `name` (есть у обеих форм — project и tasks), а не
  // любой [data-path]: так gotoCreate не «проскочит» на промежуточном
  // ре-рендере, и поле, которое сейчас будет заполнять fillByName, точно
  // на месте.
  const nameField = page.locator('[data-path="name"]').first();
  const loginField = page.locator('[data-path="login"]').first();

  // Если передана session (pm-контекст) — до 4 попыток: если после
  // навигации видим экран логина (контекст разлогинило спурьёзным 401),
  // восстанавливаем сессию и повторяем. Для admin (фикстура `page`)
  // session не нужна — там разлогина не бывает.
  const attempts = session ? 4 : 1;
  for (let i = 0; i < attempts; i++) {
    await page.goto(`/${model}/create`);
    await page.waitForLoadState('domcontentloaded');
    await nameField
      .or(loginField)
      .first()
      .waitFor({ state: 'visible', timeout: FIELD_TIMEOUT })
      .catch(() => {});
    if (await nameField.isVisible().catch(() => false)) return;
    if (session) await reinjectSession(page, session);
  }
  // Последний заход — пусть бросит понятную ошибку (с captureFailure), если
  // форма так и не отрисовалась.
  await page.goto(`/${model}/create`);
  await page.waitForLoadState('domcontentloaded');
  await nameField.waitFor({ state: 'visible', timeout: FIELD_TIMEOUT });
}

/**
 * Кликает по кнопке сохранения формы (Toolbar), пропуская кнопки внутри
 * O2M-виджетов и диалогов. Логика та же что в complex-create.spec.ts.
 */
async function clickSave(page: Page) {
  const btn = await page.evaluateHandle(() => {
    const texts = /^(сохранить|save|saving|создать|create|добавить|add)$/i;
    const allButtons = Array.from(document.querySelectorAll('button'));
    const candidates = allButtons.filter(b => {
      const text = (b.textContent || '').trim();
      if (!texts.test(text)) return false;
      const rect = b.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      if (b.closest('table, [class*="DataTable"], [class*="fieldRelation"]'))
        return false;
      if (b.closest('[role="dialog"]')) return false;
      return true;
    });
    return candidates[0] || null;
  });

  const element = btn.asElement();
  if (!element) {
    throw new Error('clickSave: не найдена кнопка сохранения формы (Toolbar)');
  }
  await element.scrollIntoViewIfNeeded();
  await element.click();
  await page.waitForTimeout(300);
}

async function fillByName(page: Page, name: string, value: string) {
  const input = page.locator(`[data-path="${name}"]`).first();
  await input.waitFor({ state: 'visible', timeout: FIELD_TIMEOUT });
  await input.fill(value);
}

/**
 * Выбор в Many2one Combobox по name-атрибуту поля. Копия из complex-create.
 */
async function pickCombobox(
  page: Page,
  name: string,
  search: string,
  scope?: ReturnType<Page['locator']>,
) {
  const root = scope ?? page;

  const hidden = root.locator(`[data-path="${name}"]`).first();
  await hidden.waitFor({ state: 'attached', timeout: FIELD_TIMEOUT });

  const targetHandle = await hidden.evaluateHandle((el) => {
    let node: HTMLElement | null = el as HTMLElement;
    for (let i = 0; i < 8 && node; i++) {
      const buttons = node.querySelectorAll('button[type="button"]');
      for (const btn of Array.from(buttons)) {
        const cls = btn.className || '';
        if (
          cls.includes('mantine-Input') ||
          cls.includes('InputBase') ||
          btn.hasAttribute('aria-haspopup')
        ) {
          const rect = (btn as HTMLElement).getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return btn;
          }
        }
      }
      node = node.parentElement;
    }
    return null;
  });

  const target = targetHandle.asElement();
  if (!target) {
    throw new Error(`Combobox target for "${name}" not found in DOM`);
  }

  await target.click();

  if (search) {
    const searchInput = page.getByPlaceholder(/поиск/i).first();
    if (await searchInput.isVisible({ timeout: 500 }).catch(() => false)) {
      await searchInput.fill(search);
    }
  }

  // Реальные записи, ИСКЛЮЧАЯ action-опции «Создать…»/«Создать и заполнить…».
  // Many2one с quickCreate рендерит «Создать и заполнить…» ВСЕГДА (без ввода) и
  // РАНЬШЕ, чем подгружаются async-записи. При пустом поиске .first() мог
  // схватить её → открывался попап-форма (с ContactsWidget), который порталом
  // перекрывал следующее поле и ронял клик. Отсекаем по префиксу i18n-текста
  // (ru/en) и ждём именно реальную запись, а не всегда-присутствующий action.
  const CREATE_OPTION = /^(Создать|Create)/;
  const visibleOptions = page
    .locator('[role="option"]:visible')
    .filter({ hasNotText: CREATE_OPTION });
  await visibleOptions.first().waitFor({ state: 'visible', timeout: 5_000 });

  const targetOption =
    search &&
    (await visibleOptions
      .filter({ hasText: new RegExp(search, 'i') })
      .count()) > 0
      ? visibleOptions.filter({ hasText: new RegExp(search, 'i') }).first()
      : visibleOptions.first();

  await targetOption.click({ timeout: 5_000 });

  await page
    .locator('[role="option"]:visible')
    .first()
    .waitFor({ state: 'hidden', timeout: 1_500 })
    .catch(() => {});
}

/** Дамп ошибок валидации формы — копия отладочного блока из complex-create. */
async function dumpFormState(page: Page, label: string) {
  const errors = await page
    .locator('.mantine-TextInput-error, [class*="error"], [data-error="true"]')
    .allTextContents();
  const values = await page.evaluate(() => {
    const inputs = document.querySelectorAll('[data-path]');
    return Array.from(inputs).map(el => ({
      path: el.getAttribute('data-path'),
      value: (el as HTMLInputElement).value,
    }));
  });
  console.log(`[${label}] form still on /create. Field errors:`, errors);
  console.log(`[${label}] field values:`, JSON.stringify(values, null, 2));
}

// ==================== Auth / API helpers ====================

function authHeaders(session: Session) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.token}`,
    Cookie: `session_cookie=${session.cookieToken}`,
  };
}

async function roleIdByCode(
  api: ApiHelper,
  session: Session,
  code: string,
): Promise<number | undefined> {
  const res = await api.searchRecords(session, 'roles', {
    fields: ['id'],
    filter: [['code', '=', code]],
    limit: 1,
  });
  return res.data[0]?.id;
}

async function assignRoles(session: Session, userId: number, roleIds: number[]) {
  const res = await fetch(`${API_URL}/auto/users/${userId}`, {
    method: 'PUT',
    headers: authHeaders(session),
    body: JSON.stringify({ role_ids: { selected: roleIds } }),
  });
  if (!res.ok) {
    throw new Error(`assignRoles failed: ${res.status} ${await res.text()}`);
  }
}

/**
 * Строит авторизованный BrowserContext (cookie session_cookie + localStorage
 * 'session'), ровно как fixtures/global-setup.ts для admin/user2.
 */
async function buildAuthContext(
  browser: Browser,
  session: Session,
): Promise<BrowserContext> {
  const apiHost = new URL(API_URL).hostname;
  const context = await browser.newContext({ baseURL: BASE_URL });
  await context.addCookies([
    {
      name: 'session_cookie',
      value: session.cookieToken,
      domain: apiHost,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const page = await context.newPage();
  await page.goto('/');
  await page.evaluate((s) => {
    const { cookieToken, ...data } = s as Record<string, unknown>;
    localStorage.setItem('session', JSON.stringify(data));
  }, session as unknown as Record<string, unknown>);
  await page.goto('/');
  await page.waitForTimeout(2000);
  await page.close();
  return context;
}

async function deleteByName(
  api: ApiHelper,
  session: Session,
  model: string,
  name: string,
) {
  const res = await api.searchRecords(session, model, {
    fields: ['id'],
    filter: [['name', '=', name]],
    limit: 10,
  });
  for (const rec of res.data) {
    await api.deleteRecord(session, model, rec.id);
  }
}

// ==================== Общий сценарий ====================

// Имена уникальны (timestamp) — по ним чистим записи в afterAll.
const createdProjects: string[] = [];
const createdTasks: string[] = [];

/**
 * pm-сценарий гоняется на вручную поднятом BrowserContext, для которого
 * Playwright НЕ снимает авто-скриншот/трейс (это делается только для
 * фикстуры `page`). Поэтому на падении сами выводим состояние страницы —
 * чтобы возможный флейк оставался диагностируемым по логу.
 */
async function captureFailure(page: Page, tag: string) {
  try {
    const state = await page.evaluate(() => ({
      href: location.href,
      hasSession: !!localStorage.getItem('session'),
      loaders: document.querySelectorAll(
        '.mantine-Loader-root, [class*="Loader-root"]',
      ).length,
      dataPaths: Array.from(document.querySelectorAll('[data-path]'))
        .map(e => e.getAttribute('data-path'))
        .slice(0, 20),
      body: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
    }));
    console.log(`[FAIL ${tag}] page state:`, JSON.stringify(state));
  } catch (e) {
    console.log(`[FAIL ${tag}] could not capture state:`, e);
  }
}

async function createProjectAndTask(
  page: Page,
  tag: string,
  session?: Session,
) {
  const stamp = Date.now();
  const projectName = `E2E-Proj-${tag}-${stamp}`;
  const taskName = `E2E-Task-${tag}-${stamp}`;
  createdProjects.push(projectName);
  createdTasks.push(taskName);

  // 1) Проект
  await gotoCreate(page, 'project', session);
  await fillByName(page, 'name', projectName);
  await clickSave(page);
  if (page.url().endsWith('/create')) await dumpFormState(page, `${tag}-project`);
  await expect(page).not.toHaveURL(/\/create$/, { timeout: FIELD_TIMEOUT });

  // 2) Задача в этом проекте.
  //    Открытие /tasks/create дёргает POST /auto/tasks/default_values —
  //    именно этот вызов падал 500 у актора с ролями до фикса «роли несут id».
  await gotoCreate(page, 'tasks', session);
  await fillByName(page, 'name', taskName);
  // stage_id / user_id имеют бэковые дефолты (первая стадия / текущий юзер) —
  // не трогаем. Привязываем задачу к только что созданному проекту.
  await pickCombobox(page, 'project_id', projectName);
  await clickSave(page);
  if (page.url().endsWith('/create')) await dumpFormState(page, `${tag}-task`);
  await expect(page).not.toHaveURL(/\/create$/, { timeout: FIELD_TIMEOUT });

  // Имя задачи персистировано — форма перешла на /tasks/<id>.
  const nameInput = page.locator('[data-path="name"]').first();
  await expect(nameInput).toHaveValue(taskName, { timeout: FIELD_TIMEOUT });
}

// ==================== Тесты ====================

test.describe('test_create_task', () => {
  // Таймаут на тест поднят: pm-сценарий поднимает холодный контекст и
  // рендерит формы под параллельной нагрузкой воркера (WS-тесты чата).
  // Рендер быстрый (~1с), запас нужен только под worst-case контеншена.
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  let pmContext: BrowserContext | undefined;
  let pmSession: Session | undefined;

  test.beforeAll(async ({ browser }) => {
    // beforeAll видит только worker-фикстуры (browser) — свои api/adminSession
    // здесь недоступны, поэтому поднимаем ApiHelper вручную.
    const api = new ApiHelper(API_URL);
    const adminSession = await api.login(ADMIN_LOGIN, ADMIN_PASSWORD);

    const userId = await api.ensureUser(adminSession, {
      login: PM_LOGIN,
      password: PM_PASSWORD,
      name: 'E2E Project Manager',
    });

    const pmRoleId = await roleIdByCode(api, adminSession, 'project_manager');
    if (typeof pmRoleId !== 'number') {
      throw new Error('роль project_manager не засеяна (task app post_init)');
    }
    // project_manager наследует base_user через based_role_ids — отдельно
    // base_user не назначаем. ROLE_ACL(project_manager): task/project = FULL.
    await assignRoles(adminSession, userId, [pmRoleId]);

    // Логинимся ПОСЛЕ назначения роли — свежая сессия несёт роли (именно
    // её сериализация под default_values и проверяется).
    pmSession = await api.login(PM_LOGIN, PM_PASSWORD);
    pmContext = await buildAuthContext(browser, pmSession);
  });

  test.afterAll(async () => {
    // Чистим созданное: СНАЧАЛА задачи (task.project_id ondelete=restrict —
    // проект нельзя удалить пока на него ссылается задача), потом проекты.
    try {
      const api = new ApiHelper(API_URL);
      const adminSession = await api.login(ADMIN_LOGIN, ADMIN_PASSWORD);
      for (const name of createdTasks) {
        await deleteByName(api, adminSession, 'tasks', name);
      }
      for (const name of createdProjects) {
        await deleteByName(api, adminSession, 'project', name);
      }
    } catch (e) {
      console.warn('cleanup failed:', e);
    }
    await pmContext?.close();
  });

  test('суперпользователь: создаёт проект и задачу в нём', async ({ page }) => {
    await createProjectAndTask(page, 'admin');
  });

  test('менеджер проектов: создаёт проект и задачу в нём', async () => {
    test.skip(!pmContext, 'контекст project_manager не готов (см. beforeAll)');
    const page = await pmContext!.newPage();
    try {
      await createProjectAndTask(page, 'pm', pmSession);
    } catch (e) {
      await captureFailure(page, 'pm');
      throw e;
    } finally {
      await page.close();
    }
  });
});
