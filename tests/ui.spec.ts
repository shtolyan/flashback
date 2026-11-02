import { test, expect } from "@playwright/test";
const api = "/api/bugs/v1";
test("list, pagination, drawer, back/forward and exact scroll restoration", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByTestId("bug-list").getByRole("button")).toHaveCount(
    24,
  );
  await page.getByRole("button", { name: "Следующая страница" }).click();
  await expect(page).toHaveURL(/page=2/);
  const list = page.getByTestId("bug-list");
  await list.evaluate((el) => {
    el.scrollTop = 300;
  });
  const row = list.getByRole("button").nth(5);
  const rowId = await row.getAttribute("data-testid");
  await row.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const saved = await list.evaluate((el) => el.scrollTop);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(saved);
  await page.goForward();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/page=2/);
  expect(errors).toEqual([]);
  await page.goto("/");
  await expect(page.getByTestId("bug-list").getByRole("button")).toHaveCount(
    24,
  );
  await page.screenshot({ path: "test-results/desktop.png" });
});
test("create, edit, comment, confirm, archive and delete through UI", async ({
  page,
  request,
}) => {
  let id: number | undefined;
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Новый баг", exact: true }).click();
    await page
      .getByLabel("Описание нового бага")
      .fill("Flashback UI acceptance " + Date.now());
    await page
      .getByRole("button", { name: "Создать баг", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveAttribute(
      "aria-label",
      /Баг #/,
    );
    id = Number(new URL(page.url()).searchParams.get("bug"));
    await page
      .getByRole("button", { name: "Редактировать описание", exact: true })
      .click();
    await page
      .getByLabel("Описание бага", { exact: true })
      .fill("Flashback проверка редактирования");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(
      page
        .getByText("Flashback проверка редактирования", { exact: true })
        .last(),
    ).toBeVisible();
    await page
      .getByLabel("Комментарий", { exact: true })
      .fill("Комментарий пользователя");
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await expect(
      page.getByText("Комментарий пользователя", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Статус: На проверке", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Всё исправлено", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).not.toHaveURL(/bug=/);
    await page.goto("/?view=fixed&bug=" + id);
    await page.getByRole("button", { name: "В архив", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Восстановить из архива" }),
    ).toBeVisible();
    const report = await (await request.get(api + "/reports/" + id)).json();
    expect(report.status).toBe("fixed");
    expect(report.archived).toBe(true);
    expect(report.comments.length).toBe(2);
    await page.getByRole("button", { name: "Удалить", exact: true }).click();
    await page
      .getByRole("button", { name: "Удалить навсегда", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await request.get(api + "/reports/" + id)).status()).toBe(404);
    id = undefined;
  } finally {
    if (id) await request.delete(api + "/reports/" + id);
  }
});
test("live updates, unsaved text preserved and conflict explicitly resolved", async ({
  page,
  context,
  request,
}) => {
  const r = await (
    await request.post(api + "/reports", {
      data: { text: "Realtime draft fixture" },
    })
  ).json();
  try {
    await page.goto("/?bug=" + r.id);
    await page.getByRole("button", { name: "Редактировать описание" }).click();
    await page
      .getByLabel("Описание бага", { exact: true })
      .fill("Мой незавершённый текст");
    const other = await context.newPage();
    await other.goto("/?q=%23" + r.id);
    await request.post(api + "/reports/" + r.id, {
      data: {
        text: "Агент обновил описание",
        status: "in_progress",
        expectedRevision: r.revision,
      },
    });
    await expect(
      other.getByTestId("bug-" + r.id).getByText("В работе", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Описание бага", { exact: true })).toHaveValue(
      "Мой незавершённый текст",
    );
    await expect(
      page.getByText("Баг изменился во время редактирования. Текущий текст:", {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Сохранить мой вариант" }).click();
    await expect(
      page.getByRole("button", { name: "Редактировать описание" }),
    ).toBeVisible();
    expect(
      (await (await request.get(api + "/reports/" + r.id)).json()).text,
    ).toBe("Мой незавершённый текст");
    await other.close();
  } finally {
    await request.delete(api + "/reports/" + r.id);
  }
});
test("mobile menu, search, detail and no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("bug-list").getByRole("button")).toHaveCount(
    24,
  );
  await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page.getByRole("button", { name: "Исправленные", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/view=fixed/);
  await page.getByLabel("Поиск багов").fill("zzzz-not-existing");
  await expect(page.getByText("Здесь пока нет багов")).toBeVisible();
  await page.getByRole("button", { name: "Очистить поиск" }).click();
  await expect(page.getByTestId("bug-list").getByRole("button")).toHaveCount(
    24,
  );
  await page.getByTestId("bug-list").getByRole("button").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/mobile-detail.png" });
  await page.getByRole("button", { name: "Назад к списку" }).click();
  await page.screenshot({ path: "test-results/mobile.png" });
});
test("offline shell and reconnect show missed updates", async ({
  page,
  context,
  request,
}) => {
  const r = await (
    await request.post(api + "/reports", { data: { text: "Offline fixture" } })
  ).json();
  try {
    await page.goto("/?q=%23" + r.id);
    await expect(page.getByTestId("bug-" + r.id)).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload();
    await expect(page.getByTestId("bug-" + r.id)).toBeVisible();
    await context.setOffline(true);
    await request.post(api + "/reports/" + r.id, {
      data: { text: "After reconnect", status: "in_progress" },
    });
    await page.reload();
    await expect(
      page.getByText("Нет соединения с трекером. Повторите подключение."),
    ).toBeVisible();
    await context.setOffline(false);
    await page.getByRole("button", { name: "Повторить подключение" }).click();
    await expect(
      page.getByTestId("bug-" + r.id).getByText("After reconnect"),
    ).toBeVisible({ timeout: 20000 });
  } finally {
    await context.setOffline(false);
    await request.delete(api + "/reports/" + r.id);
  }
});

test("access-key UI, persistent login, restricted statuses and remote revocation", async ({
  page,
  request,
  browser,
}) => {
  let keyId: string | undefined, reportId: number | undefined;
  const member = await browser.newContext({
    baseURL: "http://localhost:4310",
    storageState: { cookies: [], origins: [] },
  });
  const memberPage = await member.newPage();
  try {
    await page.goto("/");
    await page
      .getByRole("button", { name: "Ключи доступа", exact: true })
      .click();
    const name = "UI Agent " + Date.now();
    await page.getByLabel("Название ключа").fill(name);
    await page
      .getByRole("button", { name: "Создать ключ", exact: true })
      .click();
    const secretField = page.getByLabel("Созданный токен");
    await expect(secretField).toBeVisible();
    const secret = await secretField.inputValue();
    const keys = await (await request.get("/api/access-keys")).json();
    keyId = keys.find((k: any) => k.name === name).id;
    await page.getByRole("button", { name: "Готово, скрыть ключ" }).click();
    await expect(secretField).toHaveCount(0);
    await memberPage.goto("/");
    await expect(
      memberPage.getByRole("heading", { name: "Вход по ключу" }),
    ).toBeVisible();
    await memberPage.getByLabel("Ключ доступа", { exact: true }).fill(secret);
    await memberPage
      .getByRole("button", { name: "Войти", exact: true })
      .click();
    await expect(memberPage.getByTestId("bug-list")).toBeVisible();
    await memberPage.reload();
    await expect(memberPage.getByTestId("bug-list")).toBeVisible();
    await expect(
      memberPage.getByRole("button", { name: "Ключи доступа", exact: true }),
    ).toHaveCount(0);
    await memberPage
      .getByRole("button", { name: "Выйти", exact: true })
      .click();
    await expect(
      memberPage.getByRole("heading", { name: "Вход по ключу" }),
    ).toBeVisible();
    await memberPage.reload();
    await expect(
      memberPage.getByRole("heading", { name: "Вход по ключу" }),
    ).toBeVisible();
    await memberPage.getByLabel("Ключ доступа", { exact: true }).fill(secret);
    await memberPage
      .getByRole("button", { name: "Войти", exact: true })
      .click();
    await expect(memberPage.getByTestId("bug-list")).toBeVisible();

    await memberPage
      .getByRole("button", { name: "Новый баг", exact: true })
      .click();
    await memberPage
      .getByLabel("Описание нового бага")
      .fill("Access UI fixture");
    await memberPage
      .getByRole("button", { name: "Создать баг", exact: true })
      .click();
    await expect(memberPage.getByRole("dialog")).toHaveAttribute(
      "aria-label",
      /Баг #/,
    );
    reportId = Number(new URL(memberPage.url()).searchParams.get("bug"));
    await expect(
      memberPage.getByRole("button", {
        name: "Статус: Исправлен",
        exact: true,
      }),
    ).toBeDisabled();
    const attribution = await (
      await request.get(api + "/reports/" + reportId + "/access")
    ).json();
    expect(attribution.created.name).toBe(name);
    await page
      .getByRole("button", { name: "Отозвать ключ " + name, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Да, отозвать", exact: true })
      .click();
    await expect(
      memberPage.getByRole("heading", { name: "Вход по ключу" }),
    ).toBeVisible({ timeout: 10000 });
    keyId = undefined;
    await memberPage.screenshot({ path: "test-results/login.png" });
  } finally {
    await member.close();
    if (keyId) await request.post("/api/access-keys/" + keyId + "/revoke");
    if (reportId) await request.delete(api + "/reports/" + reportId);
  }
});

test("First Signal project, private screenshot preview and attachment upload", async ({
  page,
  request,
}) => {
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=",
    "base64",
  );
  const created = await request.post(api + "/reports", {
    headers: { "X-Flashback-Project": "first-signal" },
    data: {
      text: "Screenshot browser fixture",
      attachments: [
        {
          filename: "scene.png",
          contentType: "image/png",
          dataBase64: image.toString("base64"),
        },
      ],
    },
  });
  expect(created.ok()).toBeTruthy();
  const r = await created.json();
  try {
    await page.goto("/?project=first-signal&bug=" + r.id);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Открыть scene.png" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Открыть scene.png" }).click();
    await expect(
      page.getByRole("dialog", { name: "Скриншот бага" }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/first-signal-screenshot-preview.png",
    });
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    const chooser = page.waitForEvent("filechooser");
    await page
      .getByRole("button", { name: "Прикрепить скриншот", exact: true })
      .click();
    await (
      await chooser
    ).setFiles({ name: "another.png", mimeType: "image/png", buffer: image });
    await expect(
      page.getByRole("button", { name: "Открыть another.png" }),
    ).toBeVisible();
    const detail = await request.get(api + "/reports/" + r.id, {
      headers: { "X-Flashback-Project": "first-signal" },
    });
    expect((await detail.json()).attachments).toHaveLength(2);
    await page.goto("/?project=hexlive");
    await expect(page.getByTestId("bug-" + r.id)).toHaveCount(0);
    await page
      .getByRole("button", { name: "First Signal", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/project=first-signal/);
    await expect(page.getByTestId("bug-" + r.id)).toBeVisible();
    await page.screenshot({ path: "test-results/first-signal-project.png" });
  } finally {
    await request.delete(api + "/reports/" + r.id, {
      headers: { "X-Flashback-Project": "first-signal" },
    });
  }
});
