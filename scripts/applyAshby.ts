import { chromium, Page, Locator, Browser, BrowserContext, FileChooser } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

export type ApplyPayload = {
  jobUrl: string;
  profile: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    location?: string;
    linkedin?: string;
    website?: string;
    github?: string;
    workAuth?: string;
    coverLetter?: string;
  };
  resumePath: string;
  mode?: 'auto' | 'confirm';
};

type ApplyResult =
  | { ok: true; successText: string | null; screenshotPath: string }
  | { ok: false; error: string; screenshotPath?: string };

export async function applyAshby(payload: ApplyPayload): Promise<ApplyResult> {
  const { jobUrl, profile, resumePath, mode = 'auto' } = payload;

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    browser = await chromium.launch({ headless: false });
    context = await browser.newContext();
    page = await context.newPage();
    page.setDefaultTimeout(15_000);

    await page.goto(jobUrl, { waitUntil: 'domcontentloaded' });

    const applyButton = page.getByRole('button', { name: /apply/i }).first();
    if ((await applyButton.count()) > 0) {
      const [newAppPage] = await Promise.all([
        context.waitForEvent('page').catch(() => null),
        applyButton.click()
      ]);
      if (newAppPage) {
        page = newAppPage;
        await newAppPage.waitForLoadState('domcontentloaded');
      } else {
        await page.waitForLoadState('domcontentloaded');
      }
    } else {
      const applyLink = page.getByRole('link', { name: /apply/i }).first();
      const [newAppPage] = await Promise.all([
        context.waitForEvent('page').catch(() => null),
        applyLink.click()
      ]);
      if (newAppPage) {
        page = newAppPage;
        await newAppPage.waitForLoadState('domcontentloaded');
      } else {
        await page.waitForLoadState('domcontentloaded');
      }
    }

    await page.waitForSelector('input[type="file"], button:has-text("Upload"), form', {
      timeout: 20_000
    });

    await fillIfVisible(page, 'First name', profile.firstName);
    await fillIfVisible(page, 'Last name', profile.lastName);
    await fillIfVisible(page, 'Email', profile.email);
    await fillIfVisible(page, 'Phone', profile.phone);
    await fillIfVisible(page, 'Location', profile.location);

    await uploadByLikelyLabel(page, ['Resume', 'Résumé', 'CV'], resumePath);

    await fillIfVisible(page, /LinkedIn/i, profile.linkedin);
    await fillIfVisible(page, /Website|Portfolio/i, profile.website);
    await fillIfVisible(page, /GitHub/i, profile.github);

    if (profile.workAuth) {
      await selectByLabelOrType(page, /Work Authorization|Work authorisation|Visa/i, profile.workAuth);
    }

    if (profile.coverLetter) {
      const coverLetterField = page.getByLabel(/Cover letter/i, { exact: false });
      if ((await coverLetterField.count()) > 0) {
        await coverLetterField.fill(profile.coverLetter);
      }
    }

    await autoAnswerFollowUps(page, profile, mode);
    await checkIfExists(page, /I agree|Terms|Privacy/i);

    const submit = page.getByRole('button', { name: /submit|apply/i }).last();
    await submit.click();

    await page.waitForTimeout(1_200);
    const successText = await findSuccessText(page);

    const screenshotPath = await captureScreenshot(page, `ashby-${Date.now()}.png`);
    return { ok: true, successText, screenshotPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failShot = page ? await captureScreenshot(page, `ashby-fail-${Date.now()}.png`) : undefined;
    return { ok: false, error: message, screenshotPath: failShot };
  } finally {
    await context?.close();
    await browser?.close();
  }
}

async function fillIfVisible(page: Page, label: string | RegExp, value?: string) {
  if (!value) return;
  const el = page.getByLabel(label, { exact: false });
  if ((await el.count()) > 0) {
    await el.fill(value);
  }
}

async function uploadByLikelyLabel(page: Page, labels: Array<string | RegExp>, filePath: string) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Resume file not found at ${absPath}`);
  }

  const uploadButton = page.getByRole('button', { name: /upload file/i }).first();
  if ((await uploadButton.count()) > 0) {
    const fileChooser = await listenForFileChooser(page, uploadButton);
    await fileChooser.setFiles(absPath);
    await triggerAutofillFromResume(page);
    return;
  }

  for (const label of labels) {
    const input = page.getByLabel(label, { exact: false });
    if ((await input.count()) > 0) {
      await input.setInputFiles(absPath);
      await triggerAutofillFromResume(page);
      return;
    }
  }

  const firstFileInput = page.locator('input[type="file"]').first();
  if ((await firstFileInput.count()) > 0) {
    await firstFileInput.setInputFiles(absPath);
    await triggerAutofillFromResume(page);
  }
}

async function selectByLabelOrType(page: Page, label: RegExp, value: string) {
  const select = page.getByLabel(label, { exact: false });
  if ((await select.count()) > 0) {
    try {
      await select.selectOption({ label: value });
      return;
    } catch {
      // ignore and fall back
    }
    try {
      await select.selectOption({ value });
    } catch {
      await select.fill(value);
    }
  }
}

async function autoAnswerFollowUps(page: Page, profile: ApplyPayload['profile'], mode: 'auto' | 'confirm') {
  const inputs = await page.locator('form input, form textarea, form select').all();

  for (const loc of inputs) {
    const visible = await loc.isVisible();
    if (!visible || (await loc.isDisabled())) continue;

    const label = await labelTextFor(page, loc);
    if (label && /EEO|Equal Employment Opportunity|Demographic|Veteran|Disability/i.test(label)) continue;
    if (label && /(first|last) name|email|phone|resume|cv|linkedin|github|website|portfolio/i.test(label)) continue;

    const tag = await loc.evaluate((el) => el.tagName.toLowerCase());
    const typeAttr = await loc.getAttribute('type');
    const role = await loc.getAttribute('role');

    if (tag === 'select' || role === 'combobox') {
      await safeSelectFirstValidOption(loc);
      continue;
    }

    if (mode === 'confirm') continue;

    if (tag === 'textarea' || typeAttr === 'text' || typeAttr === null) {
      const draft = draftAnswer(label || 'question', profile);
      if (draft) {
        try {
          await loc.fill(draft.slice(0, 500));
        } catch {
          // ignore
        }
      }
    }
  }
}

async function labelTextFor(page: Page, locator: Locator): Promise<string> {
  const labelledBy = await locator.getAttribute('aria-labelledby');
  if (labelledBy) {
    const id = labelledBy.split(' ')[0];
    const text = await page.locator(`#${id}`).first().innerText().catch(() => '');
    if (text) return text.trim();
  }

  const idAttr = await locator.getAttribute('id');
  if (idAttr) {
    const label = page.locator(`label[for="${idAttr}"]`).first();
    if ((await label.count()) > 0) {
      return (await label.innerText()).trim();
    }
  }

  const ancestor = locator.locator('xpath=ancestor::label[1]');
  if ((await ancestor.count()) > 0) {
    return (await ancestor.innerText()).trim();
  }

  return '';
}

async function safeSelectFirstValidOption(locator: Locator) {
  try {
    const options = await locator.locator('option').all();
    for (const option of options) {
      const value = await option.getAttribute('value');
      const text = (await option.innerText()).trim();
      if (!value || /select|choose|--/i.test(text)) continue;
      try {
        await locator.selectOption({ label: text });
      } catch {
        await locator.selectOption(value);
      }
      return;
    }
  } catch {
    // ignore
  }
}

function draftAnswer(label: string, profile: ApplyPayload['profile']): string {
  if (/why.*company|motivation|cover/i.test(label)) {
    return `I'm excited about this opportunity and believe my background aligns well with the role. Happy to discuss the details further.`;
  }
  if (/salary/i.test(label)) {
    return 'Open to discussing a market-competitive range aligned with the role and experience.';
  }
  if (/start date|availability/i.test(label)) {
    return 'Available to start within two weeks of accepting an offer.';
  }

  return '';
}

async function checkIfExists(page: Page, label: RegExp) {
  const checkbox = page.getByLabel(label, { exact: false });
  if ((await checkbox.count()) > 0) {
    try {
      await checkbox.check();
    } catch {
      // ignore
    }
  }
}

async function findSuccessText(page: Page): Promise<string | null> {
  const body = await page.content();
  const match = body.match(/(Thank you|received|submitted|success)/i);
  return match ? match[0] : null;
}

async function triggerAutofillFromResume(page: Page) {
  const autofillButton = page.getByRole('button', { name: /autofill from resume/i }).first();
  if ((await autofillButton.count()) > 0) {
    try {
      await autofillButton.click();
      await page.waitForTimeout(700);
      return;
    } catch {
      // ignore and fall back
    }
  }

  const autofillTextButton = page.getByText(/Autofill from resume/i, { exact: false }).first();
  if ((await autofillTextButton.count()) > 0) {
    try {
      await autofillTextButton.click();
      await page.waitForTimeout(700);
    } catch {
      // ignore
    }
  }
}

async function listenForFileChooser(page: Page, button: Locator): Promise<FileChooser> {
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    button.click()
  ]);
  return fileChooser;
}

async function captureScreenshot(page: Page, filename: string): Promise<string> {
  const shotsDir = path.resolve('.runshots');
  if (!fs.existsSync(shotsDir)) {
    fs.mkdirSync(shotsDir, { recursive: true });
  }
  const outputPath = path.join(shotsDir, filename);
  await page.screenshot({ path: outputPath, fullPage: true });
  return outputPath;
}
