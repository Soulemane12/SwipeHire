import { chromium, Page, Locator, Browser, BrowserContext, FileChooser } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import Groq from 'groq-sdk';

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
    willingToRelocate?: boolean;
    understandsAnchorDays?: boolean;
  };
  resumePath: string;
  mode?: 'auto' | 'confirm';
};

type ApplyResult =
  | { ok: true; successText: string | null; screenshotPath: string }
  | { ok: false; error: string; screenshotPath?: string };

export async function applyAshby(payload: ApplyPayload): Promise<ApplyResult> {
  const { jobUrl, profile, resumePath, mode = 'auto' } = payload;

  console.log('🤖 Starting Ashby auto-apply for:', jobUrl);
  console.log('📄 Resume path:', resumePath);
  console.log('👤 Profile:', {
    name: `${profile.firstName} ${profile.lastName}`,
    email: profile.email,
    hasPhone: !!profile.phone,
    hasLocation: !!profile.location
  });

  // Extract company and job info from URL
  const urlParts = jobUrl.split('/');
  const companyName = urlParts[3] || 'Company';
  const jobTitle = 'Software Engineer'; // Default, could be extracted from page title later

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    console.log('🚀 Launching browser...');
    browser = await chromium.launch({ headless: false });
    context = await browser.newContext();
    page = await context.newPage();
    page.setDefaultTimeout(15_000);

    console.log('🌐 Navigating to job page...');
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded' });

    console.log('🔍 Looking for apply button...');
    const applyButton = page.getByRole('button', { name: /apply/i }).first();
    if ((await applyButton.count()) > 0) {
      console.log('✅ Found apply button, clicking...');
      const [newAppPage] = await Promise.all([
        context.waitForEvent('page').catch(() => null),
        applyButton.click()
      ]);
      if (newAppPage) {
        console.log('📱 New application page opened');
        page = newAppPage;
        await newAppPage.waitForLoadState('domcontentloaded');
      } else {
        console.log('📄 Staying on same page');
        await page.waitForLoadState('domcontentloaded');
      }
    } else {
      console.log('🔗 Looking for apply link instead...');
      const applyLink = page.getByRole('link', { name: /apply/i }).first();
      const [newAppPage] = await Promise.all([
        context.waitForEvent('page').catch(() => null),
        applyLink.click()
      ]);
      if (newAppPage) {
        console.log('📱 New application page opened from link');
        page = newAppPage;
        await newAppPage.waitForLoadState('domcontentloaded');
      } else {
        console.log('📄 Staying on same page from link');
        await page.waitForLoadState('domcontentloaded');
      }
    }

    console.log('⏳ Waiting for form to load...');
    await page.waitForSelector('input[type="file"], button:has-text("Upload"), form', {
      timeout: 20_000,
      state: 'attached'
    });

    console.log('📝 Filling out basic fields...');
    await fillIfVisible(page, 'First name', profile.firstName);
    await fillIfVisible(page, 'Last name', profile.lastName);
    await fillIfVisible(page, 'Email', profile.email);
    await fillIfVisible(page, 'Phone', profile.phone);
    await fillIfVisible(page, 'Location', profile.location);

    console.log('📎 Uploading resume...');
    await uploadByLikelyLabel(page, ['Resume', 'Résumé', 'CV'], resumePath);

    console.log('⏳ Waiting for autofill to complete...');
    await page.waitForTimeout(3000);

    console.log('🔗 Filling out additional fields...');
    await fillIfVisible(page, /LinkedIn Profile/i, profile.linkedin);
    await fillIfVisible(page, /Github.*website|Website|Portfolio/i, profile.website);
    await fillIfVisible(page, /Github.*website|GitHub/i, profile.github);

    if (profile.workAuth) {
      console.log('🛂 Setting work authorization...');
      await selectByLabelOrType(page, /Work Authorization|Work authorisation|Visa/i, profile.workAuth);
    }

    await ensureRequiredPolicyAnswers(page, {
      workAuthAnswer: profile.workAuth ?? 'Yes, I am authorized to work in the United States',
      inOfficePolicyConfirm: profile.understandsAnchorDays ?? true,
      willingToRelocate: profile.willingToRelocate ?? true
    });

    if (profile.coverLetter) {
      console.log('💌 Adding cover letter...');
      const coverLetterField = page.getByLabel(/Cover letter/i, { exact: false });
      if ((await coverLetterField.count()) > 0) {
        await coverLetterField.fill(profile.coverLetter);
      }
    }

    console.log('🤝 Auto-answering additional questions...');
    await autoAnswerFollowUps(page, profile, mode, companyName, jobTitle);

    console.log('✅ Checking terms and conditions...');
    await checkIfExists(page, /I agree|Terms|Privacy/i);

    console.log('🔍 Final validation before submission...');
    const emptyRequiredFields = await validateFormCompletion(page);
    if (emptyRequiredFields.length > 0) {
      console.log(`  ⚠️ Warning: ${emptyRequiredFields.length} required fields may be empty:`, emptyRequiredFields);
    }

    console.log('⏳ Final wait before submission...');
    await page.waitForTimeout(2000);

    console.log('🚀 Submitting application...');
    const submit = page.getByRole('button', { name: /submit|apply/i }).last();
    await submit.click();

    console.log('⏳ Waiting for submission confirmation...');
    await page.waitForTimeout(1_200);

    // Check for validation errors and retry until success
    console.log('🔍 Checking for validation errors...');
    let validationError = await findValidationErrors(page);
    let retryCount = 0;
    const maxRetries = 5; // Increased from 3 to 5

    while (validationError && retryCount < maxRetries) {
      console.log(`❌ Validation error found (attempt ${retryCount + 1}/${maxRetries}):`, validationError);

      // FIRST: Try to fix missing fields BEFORE submitting
      console.log('🔄 Attempting to fix ALL missing fields aggressively...');

      // Run the JavaScript fix multiple times to ensure all elements are handled
      for (let fixAttempt = 1; fixAttempt <= 3; fixAttempt++) {
        console.log(`  🔧 Fix attempt ${fixAttempt}/3`);
        const fixAttempted = await retryMissingFields(page, validationError, profile);
        console.log(`  📊 Fix attempt ${fixAttempt} result: ${fixAttempted ? 'SUCCESS' : 'NO CHANGES'}`);

        if (fixAttempted) {
          // Wait a bit for the page to process the changes
          await page.waitForTimeout(500);
        }
      }

      console.log('🚀 Re-attempting submission after fixes...');
      await page.waitForTimeout(1000); // Wait a bit before resubmitting

      // Find and click submit button
      const submit = page.getByRole('button', { name: /submit|apply/i }).last();
      await submit.click();
      await page.waitForTimeout(2000); // Increased wait time

      // Check for errors again
      const newValidationError = await findValidationErrors(page);

      if (!newValidationError) {
        const successText = await findSuccessText(page);
        console.log('🎉 Success text found after retry:', successText);
        const screenshotPath = await captureScreenshot(page, `ashby-${Date.now()}.png`);
        return { ok: true, successText, screenshotPath };
      } else {
        console.log(`🔄 Still have validation errors after attempt ${retryCount + 1}:`, newValidationError);
        validationError = newValidationError;
      }

      retryCount++;
    }

    // If we still have validation errors after all retries, return error
    if (validationError) {
      console.log(`❌ Still have validation errors after ${retryCount} retries:`, validationError);

      // Extract missing field suggestions for the user
      const missingFieldSuggestions = extractMissingFieldSuggestions(validationError);
      const errorMessage = missingFieldSuggestions.length > 0
        ? `Validation failed after ${retryCount} retry attempts. Please add the following to your profile: ${missingFieldSuggestions.join(', ')}. Full error: ${validationError}`
        : `Validation failed after ${retryCount} retry attempts: ${validationError}`;

      throw new Error(errorMessage);
    }

    const successText = await findSuccessText(page);
    console.log('🎉 Success text found:', successText);

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
  if (!value) {
    console.log(`  ⏭️ Skipping ${label} (no value)`);
    return;
  }

  // Try multiple strategies to find the right input field
  const strategies = [
    // Strategy 1: Text input with specific label
    () => page.locator('input[type="text"]').filter({ has: page.getByLabel(label, { exact: false }) }),
    // Strategy 2: Any input with specific label
    () => page.locator('input').filter({ has: page.getByLabel(label, { exact: false }) }),
    // Strategy 3: Text input near label text
    () => page.locator('input[type="text"]').filter({ hasText: label instanceof RegExp ? label.source : label }),
    // Strategy 4: Original getByLabel (fallback)
    () => page.getByLabel(label, { exact: false }).locator('input[type="text"]').first(),
    // Strategy 5: Simple getByLabel for text inputs only
    () => page.getByLabel(label, { exact: false }).and(page.locator('input[type="text"], input[type="url"], input[type="email"]'))
  ];

  for (let i = 0; i < strategies.length; i++) {
    try {
      const el = strategies[i]();
      const count = await el.count();

      if (count === 1) {
        console.log(`  ✏️ Filling ${label} (strategy ${i + 1}): ${value}`);
        await el.fill(value);
        return;
      } else if (count > 1) {
        console.log(`  ⚠️ Strategy ${i + 1} found ${count} matches for ${label}, trying next...`);
        continue;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  ❌ Strategy ${i + 1} failed for ${label}:`, message);
      continue;
    }
  }

  console.log(`  ❌ All strategies failed for field: ${label}`);
}

async function uploadByLikelyLabel(page: Page, labels: Array<string | RegExp>, filePath: string) {
  const absPath = path.resolve(filePath);
  console.log(`  📁 Resolved resume path: ${absPath}`);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Resume file not found at ${absPath}`);
  }

  const directInput = page.locator('input[type="file"]').first();
  if ((await directInput.count()) > 0) {
    try {
      await directInput.setInputFiles(absPath);
      await triggerAutofillFromResume(page);
      return;
    } catch {
      // element might require user interaction, continue to other strategies
    }
  }

  for (const label of labels) {
    const input = page.getByLabel(label, { exact: false });
    if ((await input.count()) > 0) {
      try {
        await input.setInputFiles(absPath);
        await triggerAutofillFromResume(page);
        return;
      } catch {
        // continue
      }
    }
  }

  const uploadButton = page.getByRole('button', { name: /upload file|upload/i }).first();
  if ((await uploadButton.count()) > 0) {
    const fileChooser = await listenForFileChooser(page, uploadButton);
    if (fileChooser) {
      await fileChooser.setFiles(absPath);
      await triggerAutofillFromResume(page);
      return;
    }

    const success = await setFileOnFirstChooser(page, absPath);
    if (success) {
      await triggerAutofillFromResume(page);
      return;
    }
  }

  if ((await directInput.count()) > 0) {
    try {
      await directInput.setInputFiles(absPath);
      await triggerAutofillFromResume(page);
    } catch {
      // give up silently; form may surface validation requiring manual input
    }
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

async function ensureRequiredPolicyAnswers(
  page: Page,
  opts: {
    workAuthAnswer: string;
    inOfficePolicyConfirm: boolean;
    willingToRelocate: boolean;
  }
) {
  const workAuthYes = /yes|authorized|eligible|citizen|lawfully/i.test(opts.workAuthAnswer);

  const tasks: Array<{ prompt: RegExp; kind: 'radio' | 'checkbox'; yes?: boolean } > = [
    {
      prompt: /authorized\s+to\s+work\s+lawfully.*united\s+states/i,
      kind: 'radio',
      yes: workAuthYes
    },
    {
      prompt: /(in[-\s]?office|anchor\s+days|in\s+person).*(confirm|understand|acknowledge)/i,
      kind: 'checkbox',
      yes: opts.inOfficePolicyConfirm
    },
    {
      prompt: /(willing\s+to\s+relocate|relocate\s+to\s+(new\s+york|nyc|sf|san\s+francisco)|relocation.*required)/i,
      kind: 'radio',
      yes: opts.willingToRelocate
    }
  ];

  for (const task of tasks) {
    const handled = await answerQuestionBlock(page, task.prompt, task.kind, task.yes ?? true);
    console.log(
      handled
        ? `  ✅ Targeted answer applied for question /${task.prompt.source}/`
        : `  ⚠️ Could not find targeted controls for /${task.prompt.source}/`
    );
  }
}

async function answerQuestionBlock(
  page: Page,
  questionRe: RegExp,
  kind: 'radio' | 'checkbox',
  preferYes: boolean
): Promise<boolean> {
  const containers = page
    .locator('section, fieldset, article, div, form')
    .filter({ hasText: questionRe });

  const count = await containers.count();
  for (let i = 0; i < count; i++) {
    const block = containers.nth(i);
    if (await answerWithinBlock(block, kind, preferYes)) {
      return true;
    }
  }

  // Fallbacks: search globally
  if (kind === 'checkbox') {
    const cb = page.getByRole('checkbox', { name: questionRe }).first();
    if ((await cb.count()) > 0) {
      await cb.check({ force: true });
      return true;
    }
    const raw = page.locator('input[type="checkbox"]').filter({ hasText: questionRe }).first();
    if ((await raw.count()) > 0) {
      await raw.check({ force: true });
      return true;
    }
  } else {
    const yesRegex = buildAffirmativeRegex(preferYes);
    const radio = page.getByRole('radio', { name: yesRegex }).first();
    if ((await radio.count()) > 0) {
      await radio.check({ force: true });
      return true;
    }
    const button = page.getByRole('button', { name: yesRegex }).first();
    if ((await button.count()) > 0) {
      await button.click({ force: true });
      return true;
    }
  }

  return false;
}

async function answerWithinBlock(block: Locator, kind: 'radio' | 'checkbox', preferYes: boolean): Promise<boolean> {
  try {
    if (kind === 'checkbox') {
      const checkbox = block.getByRole('checkbox').first();
      if ((await checkbox.count()) > 0) {
        await checkbox.check({ force: true });
        return true;
      }
      const raw = block.locator('input[type="checkbox"]').first();
      if ((await raw.count()) > 0) {
        await raw.check({ force: true });
        return true;
      }
      const button = block.getByRole('button', { name: buildAffirmativeRegex(true) }).first();
      if ((await button.count()) > 0) {
        await button.click({ force: true });
        return true;
      }
      return false;
    }

    const yesRegex = buildAffirmativeRegex(preferYes);
    const radioByRole = block.getByRole('radio', { name: yesRegex }).first();
    if ((await radioByRole.count()) > 0) {
      await radioByRole.check({ force: true });
      return true;
    }

    const button = block.getByRole('button', { name: yesRegex }).first();
    if ((await button.count()) > 0) {
      await button.click({ force: true });
      return true;
    }

    const labelMatch = block.getByText(yesRegex, { exact: false }).first();
    if ((await labelMatch.count()) > 0) {
      await labelMatch.click({ force: true });
      return true;
    }

    const rawRadio = block.locator('input[type="radio"]').first();
    if ((await rawRadio.count()) > 0) {
      await rawRadio.check({ force: true });
      return true;
    }
  } catch (error) {
    console.log('  ⚠️ Failed to answer targeted question block:', error);
  }
  return false;
}

function buildAffirmativeRegex(preferYes: boolean): RegExp {
  if (preferYes) {
    return /^(yes|i\s*(am|do|understand|acknowledge|agree|will|can)|agree|confirm|willing)/i;
  }
  return /^(no|not|unable|cannot|won't)/i;
}

async function autoAnswerFollowUps(page: Page, profile: ApplyPayload['profile'], mode: 'auto' | 'confirm', companyName: string, jobTitle: string) {
  console.log('🤝 Auto-answering follow-up questions...');
  // Wait for any dynamic content/autofill to complete
  console.log('⏳ Waiting for DOM updates after autofill...');
  await page.waitForTimeout(3000);

  // Look for ALL input elements, not just those inside forms
  const inputs = await page.locator('input, textarea, select').all();
  console.log(`  🔍 Found ${inputs.length} input elements to examine`);

  // Debug: Log what types of elements we found
  if (inputs.length > 0) {
    console.log(`  📋 Elements found: ${inputs.length} total`);
    for (let i = 0; i < Math.min(inputs.length, 10); i++) { // Log first 10
      const input = inputs[i];
      const tag = await input.evaluate((el) => el.tagName.toLowerCase());
      const type = await input.getAttribute('type');
      const label = await labelTextFor(page, input);
      console.log(`    ${i + 1}. ${tag}${type ? `[${type}]` : ''} - "${label || 'unlabeled'}"`);
    }
    if (inputs.length > 10) {
      console.log(`    ... and ${inputs.length - 10} more elements`);
    }
  }

  // Search specifically for missing required fields
  console.log('🔎 Searching for specific missing fields...');
  try {
    const workAuthText = await page.textContent('body');
    if (workAuthText?.includes('Are you authorized to work lawfully')) {
      console.log('  ✅ Found work authorization question in page text');

      // Try to find the corresponding input elements
      const workAuthElements = await page.locator('[aria-label*="authorized"], [aria-labelledby*="authorized"], text="authorized" >> xpath=following::input[1]').all();
      console.log(`  🔍 Found ${workAuthElements.length} potential work auth elements`);
    }

    if (workAuthText?.includes('office requirements')) {
      console.log('  ✅ Found office requirements question in page text');
    }

    if (workAuthText?.includes('relocate')) {
      console.log('  ✅ Found relocation question in page text');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log('  ❌ Error searching for specific fields:', message);
  }

  let unfilledFields: string[] = [];

  for (const loc of inputs) {
    const visible = await loc.isVisible();
    if (!visible || (await loc.isDisabled())) {
      console.log(`  ⏭️ Skipping invisible/disabled field`);
      continue;
    }

    const label = await labelTextFor(page, loc);
    if (label && /EEO|Equal Employment Opportunity|Demographic|Veteran|Disability|Race|Ethnicity|Hispanic|Latino|Gender|Sexual.*Orientation/i.test(label)) {
      console.log(`  ⏭️ Skipping EEO/demographic field: ${label}`);
      continue;
    }
    if (label && /(first|last) name|email|resume|cv|linkedin|github|website|portfolio/i.test(label)) {
      console.log(`  ⏭️ Skipping basic field (already handled): ${label}`);
      continue;
    }

    // Handle phone field specifically since it's required in many forms
    if (label && /phone/i.test(label)) {
      if (profile.phone) {
        console.log(`  📞 Filling phone: ${profile.phone}`);
        try {
          await loc.fill(profile.phone);
        } catch (error) {
          console.log(`  ❌ Failed to fill phone field: ${error}`);
          unfilledFields.push(label);
        }
        continue;
      } else {
        console.log(`  ⚠️ Phone field required but no phone number in profile`);
        unfilledFields.push(label);
        continue;
      }
    }

    const tag = await loc.evaluate((el) => el.tagName.toLowerCase());
    const typeAttr = await loc.getAttribute('type');
    const role = await loc.getAttribute('role');

    console.log(`  🔍 Found field: ${label} (${tag}, type: ${typeAttr})`);

    // Handle select dropdowns
    if (tag === 'select' || role === 'combobox') {
      console.log(`  📋 Selecting option for: ${label}`);
      await smartSelectOption(loc, label, jobTitle);
      continue;
    }

    // Handle radio buttons
    if (typeAttr === 'radio') {
      const radioName = await loc.getAttribute('name');
      if (radioName && label) {
        console.log(`  🔘 Handling radio group: ${radioName} (${label})`);
        await handleRadioGroup(page, radioName, label);
      }
      continue;
    }

    // Handle checkboxes
    if (typeAttr === 'checkbox') {
      console.log(`  ☑️ Handling checkbox: ${label}`);
      await handleCheckbox(loc, label);
      continue;
    }

    if (mode === 'confirm') continue;

    // Handle text inputs and textareas
    if (tag === 'textarea' || typeAttr === 'text' || typeAttr === null) {
      // Check if field is already filled
      const currentValue = await loc.inputValue().catch(() => '');
      if (currentValue && currentValue.trim().length > 0) {
        console.log(`  ✅ Field already filled: ${label}`);
        continue;
      }

      // Handle specific education fields
      let answer = '';
      if (label && /school/i.test(label)) {
        answer = 'Manhattan Center for Science and Mathematics';
        console.log(`  🏫 Filling school field: ${answer}`);
      } else if (label && (/graduation|grad.*date|pick.*date/i.test(label) || label.toLowerCase().includes('date'))) {
        answer = 'June 2025';
        console.log(`  📅 Filling graduation date: ${answer}`);
      } else if (label && /degree.*type|type.*degree/i.test(label)) {
        answer = 'High School Diploma';
        console.log(`  🎓 Filling degree type: ${answer}`);
      } else if (label && label.length > 10) {
        // Generate AI answer for complex questions
        console.log(`  🤖 Generating AI answer for: ${label}`);
        answer = await generateAIAnswer(label, jobTitle, companyName, profile);
      } else {
        answer = draftAnswer(label || 'question', profile);
      }

      if (answer) {
        console.log(`  ✏️ Filling text field "${label}": ${answer.slice(0, 50)}...`);
        try {
          await loc.fill(answer.slice(0, 500));
          // Verify it was filled
          const newValue = await loc.inputValue().catch(() => '');
          if (!newValue || newValue.trim().length === 0) {
            unfilledFields.push(label || 'Unknown field');
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`  ❌ Failed to fill "${label}":`, message);
          unfilledFields.push(label || 'Unknown field');
        }
      } else {
        unfilledFields.push(label || 'Unknown field');
      }
    }
  }

  // Report unfilled fields
  if (unfilledFields.length > 0) {
    console.log(`  ⚠️ ${unfilledFields.length} fields could not be filled:`, unfilledFields);
  } else {
    console.log(`  ✅ All form fields appear to be filled successfully`);
  }
}

// AI-powered answer generation using Groq
async function generateAIAnswer(question: string, jobTitle: string, companyName: string, profile: ApplyPayload['profile']): Promise<string> {
  try {
    const groq = new Groq({
      apiKey: process.env.NEXT_PUBLIC_GROQ_API_KEY,
    });

    const profileContext = `
Profile: ${profile.firstName} ${profile.lastName}
Email: ${profile.email}
Location: ${profile.location || 'New York City, NY'}
Background: High school student at Manhattan Center for Science and Mathematics interested in technology and software development, US citizen living in NYC
Education: Currently attending Manhattan Center for Science and Mathematics, expected graduation June 2025
`;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are helping someone apply for a ${jobTitle} position at ${companyName}.

For specific question types:
- Work authorization (US work, visa, etc): Answer "Yes, I am authorized to work in the United States"
- Relocation questions: For NYC positions answer "No relocation needed, I already live in NYC", for other locations answer "Yes, I am willing to relocate"
- Office/in-person requirements: Answer "Yes, I understand and agree to the office requirements"
- Education (School, Degree, etc): Use "Manhattan Center for Science and Mathematics" for school, "High School Diploma in Computer Science" for degree, "Expected graduation June 2025" for graduation date
- Role type/interest: Choose options related to "${jobTitle}" (e.g., "Engineering" for engineer roles)
- Yes/No confirmations: Answer "Yes"

For open-ended questions, provide professional answers (100-300 words) focusing on technical skills, problem-solving, and genuine interest.`
        },
        {
          role: "user",
          content: `Question: "${question}"

Context:
- Applying for: ${jobTitle} at ${companyName}
- Applicant profile: ${profileContext}

Please provide a professional answer that demonstrates:
1. Technical competence and experience
2. Genuine interest in the role and company
3. Problem-solving abilities
4. Collaborative mindset
5. Growth mindset and learning enthusiasm

Answer:`
        }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.7,
      max_completion_tokens: 500,
    });

    const answer = completion.choices[0]?.message?.content?.trim();
    return answer || draftAnswer(question, profile);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  ⚠️ AI answer failed for "${question}":`, message);
    return draftAnswer(question, profile);
  }
}

async function handleRadioGroup(page: Page, radioName: string, groupLabel: string) {
  const radios = await page.locator(`input[type="radio"][name="${radioName}"]`).all();

  for (const radio of radios) {
    const label = await labelTextFor(page, radio);
    const value = await radio.getAttribute('value');
    const lowerLabel = label.toLowerCase();

    // Smart selection based on question context
    const lowerGroupLabel = groupLabel.toLowerCase();

    // Work authorization questions - handle visa types
    if (/visa|authorization|work.*status/i.test(groupLabel) || /j1|f1|h1b|tn|opt|none|other/i.test(lowerLabel)) {
      // Select "None" for US citizens (no visa needed)
      if (lowerLabel === 'none' || lowerLabel.includes('none')) {
        console.log(`  ✅ Selected work authorization (US Citizen): ${label}`);
        await radio.check();
        return;
      }
    }

    // Work authorization yes/no questions
    if (/authorized.*work|work.*authorized|lawfully.*work|work.*lawfully/i.test(groupLabel) && lowerLabel.includes('yes')) {
      console.log(`  ✅ Selected work authorization: ${label}`);
      await radio.check();
      return;
    }

    // Experience level questions (0, 1, 2, 3+ years)
    if (/experience|years/i.test(groupLabel) || /^[0-3]$|3\+/.test(label)) {
      // Select "0" for high school student (no professional experience)
      if (label === '0' || lowerLabel === '0') {
        console.log(`  ✅ Selected experience level: ${label} years`);
        await radio.check();
        return;
      }
    }

    // Office/relocation requirements
    if (/office.*requirements|relocate.*role|willing.*relocate|understand.*policy/i.test(groupLabel) && lowerLabel.includes('yes')) {
      console.log(`  ✅ Selected office/relocation agreement: ${label}`);
      await radio.check();
      return;
    }

    // General yes/no questions - default to yes
    if (lowerGroupLabel.includes('age') && lowerLabel.includes('yes')) {
      await radio.check();
      return;
    }

    if (lowerGroupLabel.includes('apac') && lowerLabel.includes('yes')) {
      await radio.check();
      return;
    }

    if (lowerGroupLabel.includes('region') && lowerLabel.includes('yes')) {
      await radio.check();
      return;
    }

    // Default to "Yes" for yes/no questions
    if (lowerLabel.includes('yes') && !lowerLabel.includes('no')) {
      await radio.check();
      return;
    }
  }

  // Fallback: select first option if no smart match
  if (radios.length > 0) {
    await radios[0].check();
  }
}

async function handleCheckbox(locator: Locator, label: string) {
  const lowerLabel = label.toLowerCase();

  // Check boxes for terms, privacy, agreements
  if (/terms|privacy|agree|consent|acknowledge/i.test(label)) {
    await locator.check();
    return;
  }

  // Handle work authorization checkboxes
  if (/authorized.*work|work.*authorized|lawfully.*work|work.*lawfully|work.*united.*states|us.*work.*authorization/i.test(label)) {
    await locator.check();
    console.log(`  ✅ Checked work authorization: ${label}`);
    return;
  }

  // Handle office/in-person requirement confirmations
  if (/office.*requirements|in.*person|anchor.*days|understand.*policy|read.*understand|confirm.*read|office.*policy|in.*office|presence.*office/i.test(label)) {
    await locator.check();
    console.log(`  ✅ Checked office requirements: ${label}`);
    return;
  }

  // Handle relocation confirmations
  if (/willing.*relocate|relocate.*willing|confirm.*relocate|relocate.*role|role.*relocate|new.*york.*san.*francisco/i.test(label)) {
    await locator.check();
    console.log(`  ✅ Checked relocation agreement: ${label}`);
    return;
  }

  // Handle education level - only check undergraduate/bachelors for high school student
  if (/undergraduate|bachelors|bachelor/i.test(label)) {
    await locator.check();
    console.log(`  ✅ Checked education level: ${label}`);
    return;
  }

  // Skip higher education levels for high school student
  if (/master|phd|mba|doctorate|graduate/i.test(label)) {
    console.log(`  ⏭️ Skipping higher education level: ${label}`);
    return;
  }

  // Handle role interest areas for engineering positions
  if (/infra|infrastructure|product|engineering/i.test(label)) {
    await locator.check();
    console.log(`  ✅ Checked role interest: ${label}`);
    return;
  }

  // For source/referral checkboxes, check professional sources
  if (lowerLabel.includes('linkedin') || lowerLabel.includes('job board') || lowerLabel.includes('google')) {
    await locator.check();
    return;
  }

  // Default: don't check unless it's clearly required
  console.log(`  ⏭️ Skipping checkbox (no pattern match): ${label}`);
}

async function validateFormCompletion(page: Page): Promise<string[]> {
  const emptyFields: string[] = [];

  try {
    // Check all visible text inputs and textareas
    const textFields = await page.locator('form input[type="text"], form textarea').all();

    for (const field of textFields) {
      const visible = await field.isVisible();
      if (!visible) continue;

      const value = await field.inputValue().catch(() => '');
      const required = await field.getAttribute('required');
      const ariaRequired = await field.getAttribute('aria-required');

      if ((required !== null || ariaRequired === 'true') && (!value || value.trim().length === 0)) {
        const label = await labelTextFor(page, field);
        emptyFields.push(label || 'Unknown required field');
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log('  ❌ Validation check failed:', message);
  }

  return emptyFields;
}

async function labelTextFor(page: Page, locator: Locator): Promise<string> {
  // Try aria-labelledby first
  const labelledBy = await locator.getAttribute('aria-labelledby');
  if (labelledBy) {
    const id = labelledBy.split(' ')[0];
    const text = await page.locator(`#${id}`).first().innerText().catch(() => '');
    if (text) return text.trim();
  }

  // Try direct aria-label
  const ariaLabel = await locator.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  // Try label[for="id"]
  const idAttr = await locator.getAttribute('id');
  if (idAttr) {
    const label = page.locator(`label[for="${idAttr}"]`).first();
    if ((await label.count()) > 0) {
      return (await label.innerText()).trim();
    }
  }

  // Try ancestor label
  const ancestor = locator.locator('xpath=ancestor::label[1]');
  if ((await ancestor.count()) > 0) {
    return (await ancestor.innerText()).trim();
  }

  // Try placeholder text
  const placeholder = await locator.getAttribute('placeholder');
  if (placeholder && placeholder !== 'Type here...') {
    return placeholder.trim();
  }

  // Try nearest preceding text (within 100 characters)
  try {
    const precedingText = await locator.evaluate((el) => {
      let current = el.previousSibling;
      let text = '';
      while (current && text.length < 100) {
        if (current.nodeType === Node.TEXT_NODE) {
          text = (current.textContent || '') + text;
        } else if (current.nodeType === Node.ELEMENT_NODE) {
          const elementText = (current as Element).textContent || '';
          text = elementText + text;
        }
        current = current.previousSibling;
      }
      return text.trim();
    });
    if (precedingText && precedingText.length > 3) {
      return precedingText.slice(-100); // Last 100 chars
    }
  } catch {
    // ignore
  }

  return '';
}

async function smartSelectOption(locator: Locator, label: string | null, jobTitle: string) {
  const lowerLabel = (label || '').toLowerCase();

  try {
    const options = await locator.locator('option').all();
    const optionTexts = await Promise.all(options.map(opt => opt.innerText().catch(() => '')));

    console.log(`  📋 Found ${options.length} options for "${label}"`);

    // Look for smart selections based on field type and common patterns
    for (let i = 0; i < options.length; i++) {
      const option = options[i];
      const value = await option.getAttribute('value').catch(() => '');
      const text = optionTexts[i].trim().toLowerCase();

      // Skip placeholder options
      if (!value || /select|choose|--/i.test(text)) continue;

      // Location-specific selections for relocation fields
      if (/location|relocate|interested.*relocating/i.test(lowerLabel)) {
        // Prioritize NYC since user lives there
        if (text.includes('new york') || text.includes('ny') || text.includes('nyc')) {
          console.log(`  ✅ Selected location: ${optionTexts[i]}`);
          try {
            await locator.selectOption({ label: optionTexts[i] });
            return;
          } catch {
            await locator.selectOption(value);
            return;
          }
        }
      }

      // Role type selections based on job title
      if (/role|type.*role|what.*type/i.test(lowerLabel)) {
        const jobTitleLower = jobTitle.toLowerCase();
        if ((text.includes('engineering') || text.includes('engineer') || text.includes('software') || text.includes('technical')) &&
            (jobTitleLower.includes('engineer') || jobTitleLower.includes('developer') || jobTitleLower.includes('software'))) {
          console.log(`  ✅ Selected role type: ${optionTexts[i]}`);
          try {
            await locator.selectOption({ label: optionTexts[i] });
            return;
          } catch {
            await locator.selectOption(value);
            return;
          }
        }
      }

      // Smart selection for yes/no questions
      if (text.includes('yes') && !text.includes('no')) {
        console.log(`  ✅ Selected "Yes": ${optionTexts[i]}`);
        try {
          await locator.selectOption({ label: optionTexts[i] });
          return;
        } catch {
          await locator.selectOption(value);
          return;
        }
      }

      // For "How did you hear about us" questions, prefer professional sources
      if (text.includes('linkedin') || text.includes('job board') || text.includes('google jobs')) {
        console.log(`  ✅ Selected professional source: ${optionTexts[i]}`);
        try {
          await locator.selectOption({ label: optionTexts[i] });
          return;
        } catch {
          await locator.selectOption(value);
          return;
        }
      }

      // For location/region questions, look for relevant options
      if (text.includes('united states') || text.includes('us') || text.includes('america')) {
        console.log(`  ✅ Selected US location: ${optionTexts[i]}`);
        try {
          await locator.selectOption({ label: optionTexts[i] });
          return;
        } catch {
          await locator.selectOption(value);
          return;
        }
      }
    }

    // If no smart selection worked, fall back to first valid option
    await safeSelectFirstValidOption(locator);
  } catch (error) {
    console.log(`  ❌ Failed to select option: ${error}`);
  }
}

async function safeSelectFirstValidOption(locator: Locator) {
  try {
    const options = await locator.locator('option').all();
    const optionTexts = await Promise.all(options.map(opt => opt.innerText().catch(() => '')));

    // Look for smart selections based on common patterns
    for (let i = 0; i < options.length; i++) {
      const option = options[i];
      const value = await option.getAttribute('value').catch(() => '');
      const text = optionTexts[i].trim().toLowerCase();

      // Skip placeholder options
      if (!value || /select|choose|--/i.test(text)) continue;

      // Smart selection for common questions
      if (text.includes('yes') && !text.includes('no')) {
        try {
          await locator.selectOption({ label: optionTexts[i] });
          return;
        } catch {
          await locator.selectOption(value);
          return;
        }
      }

      // For "How did you hear about us" questions, prefer professional sources
      if (text.includes('linkedin') || text.includes('job board') || text.includes('google jobs')) {
        try {
          await locator.selectOption({ label: optionTexts[i] });
          return;
        } catch {
          await locator.selectOption(value);
          return;
        }
      }

      // For location/region questions, look for relevant options
      if (text.includes('yes') || text.includes('united states') || text.includes('us') || text.includes('america')) {
        try {
          await locator.selectOption({ label: optionTexts[i] });
          return;
        } catch {
          await locator.selectOption(value);
          return;
        }
      }
    }

    // Fallback: select first valid option
    for (let i = 0; i < options.length; i++) {
      const option = options[i];
      const value = await option.getAttribute('value').catch(() => '');
      const text = optionTexts[i].trim();

      if (!value || /select|choose|--/i.test(text)) continue;

      try {
        await locator.selectOption({ label: text });
        return;
      } catch {
        await locator.selectOption(value);
        return;
      }
    }
  } catch {
    // ignore
  }
}

function draftAnswer(label: string, profile: ApplyPayload['profile']): string {
  const lowerLabel = label.toLowerCase();

  // Cover letter / Why join team questions
  if (/cover.*letter|why.*join|join.*team|tell us why/i.test(label)) {
    return `I'm excited to join your team because I'm passionate about building exceptional products that solve real problems. I'm drawn to your company's commitment to innovation and quality, and I believe my technical expertise and collaborative approach would be a valuable addition to your team.`;
  }

  // Why do you want to work here / Motivation questions
  if (/why.*work|motivation|interest|why.*company|why.*role|about you/i.test(label)) {
    return `I'm genuinely excited about this opportunity because it aligns perfectly with my career goals and technical interests. I'm particularly drawn to the company's innovative approach and the chance to contribute to meaningful projects while continuing to grow my skills in a collaborative environment.`;
  }

  // What would you want to work on / Features to implement
  if (/what.*work on|features.*implement|first month|what.*build/i.test(label)) {
    return `In my first month, I'd focus on understanding the codebase and user needs, then contribute to key features like improving user experience, optimizing performance, and building robust, scalable components. I'm particularly interested in working on user-facing features that directly impact product usability and developer experience.`;
  }

  // PM/Product management questions
  if (/pm hat|product.*problem|product.*management|complex.*product/i.test(label)) {
    return `I once led the redesign of a complex user workflow by conducting user research, identifying pain points, and collaborating with design and engineering teams to create a more intuitive solution. I prioritized features based on user feedback and business impact, resulting in a 40% improvement in user satisfaction and reduced support tickets.`;
  }

  // Strengths / What are you good at
  if (/extremely.*good|what.*teach|strengths|expertise|skills.*bring/i.test(label)) {
    return `I excel at building scalable, maintainable software solutions and have deep expertise in modern web technologies. I could teach the team best practices in React architecture, performance optimization, and collaborative development workflows. I'm also strong at translating complex technical concepts into clear, actionable plans for cross-functional teams.`;
  }

  // Salary/Compensation questions
  if (/salary|compensation|expected.*pay|pay.*range/i.test(label)) {
    return 'I am open to discussing a competitive compensation package that aligns with market standards for this role and my experience level.';
  }

  // Start date/Availability/Notice period questions
  if (/start.*date|availability|when.*start|notice.*period|expected.*notice/i.test(label)) {
    return 'I am available to start within 2-4 weeks, with flexibility to accommodate the team\'s needs and project timelines.';
  }

  // Location/Remote work questions
  if (/location|remote|where.*located|timezone|region/i.test(label)) {
    return profile.location || 'I am flexible with location and comfortable working remotely or in-office as needed.';
  }

  // Age verification
  if (/age.*18|over.*18|18.*years/i.test(label)) {
    return 'Yes';
  }

  // Work authorization
  if (/work.*auth|visa|sponsor|legal.*work/i.test(label)) {
    return profile.workAuth || 'I am authorized to work and do not require sponsorship.';
  }

  // Country/Passport questions
  if (/passport.*country|country.*passport|what.*country|country.*based/i.test(label)) {
    return profile.location || 'United States';
  }
  if (/country.*residence|residence.*country|based.*country/i.test(label)) {
    return profile.location || 'United States';
  }

  // How did you hear about us questions
  if (/hear.*about|how.*find|source/i.test(label)) {
    return 'Through online job boards and professional networks';
  }

  // Experience/Background questions
  if (/experience|background|skills|previous.*work/i.test(label)) {
    return `I bring a strong technical background with experience in software development and a passion for building innovative solutions. I'm always eager to learn new technologies and contribute to team success.`;
  }

  // Portfolio/Projects questions
  if (/portfolio|projects|work.*samples/i.test(label)) {
    return profile.website || 'I have various projects showcased on my portfolio website and GitHub profile.';
  }

  // Additional comments/Other questions
  if (/additional.*comment|anything.*else|other.*information/i.test(label)) {
    return 'Thank you for considering my application. I look forward to discussing how I can contribute to the team.';
  }

  // Cover letter questions
  if (/cover.*letter|letter.*cover/i.test(label)) {
    return profile.coverLetter || `I am excited to apply for this position as it represents an excellent opportunity to contribute my skills while growing professionally. I am particularly interested in the innovative work being done and would love to be part of a team that values collaboration and continuous learning.`;
  }

  // Generic fallback for text fields
  if (lowerLabel.includes('type here') || lowerLabel.includes('tell us') || lowerLabel.includes('describe')) {
    return 'I am excited about this opportunity and believe my background and enthusiasm make me a strong candidate for this role.';
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

async function findValidationErrors(page: Page): Promise<string | null> {
  // Wait a bit longer for error messages to appear
  await page.waitForTimeout(2000);

  // Look for common error indicators
  const errorSelectors = [
    '[role="alert"]',
    '.error',
    '.alert-error',
    '.validation-error',
    '[class*="error"]',
    '[class*="invalid"]',
    '[aria-invalid="true"]'
  ];

  for (const selector of errorSelectors) {
    try {
      const errorElement = page.locator(selector).first();
      if (await errorElement.isVisible()) {
        const errorText = await errorElement.textContent();
        if (errorText && errorText.trim()) {
          return errorText.trim();
        }
      }
    } catch {
      // Continue to next selector
    }
  }

  // Also check for text-based error indicators in the page body
  const body = await page.textContent('body');
  if (body) {
    const errorPatterns = [
      /please (fill out|complete|fix|provide)/i,
      /required field/i,
      /missing required/i,
      /error.*occurred/i,
      /validation.*failed/i,
      /cannot be empty/i,
      /invalid.*format/i,
      /field.*required/i
    ];

    for (const pattern of errorPatterns) {
      const match = body.match(pattern);
      if (match) {
        // Extract surrounding context (50 chars before and after)
        const index = body.indexOf(match[0]);
        const start = Math.max(0, index - 50);
        const end = Math.min(body.length, index + match[0].length + 50);
        return body.substring(start, end).trim();
      }
    }
  }

  return null;
}

// Helper function to use JavaScript to check checkbox/radio elements
async function forceSetElementState(page: Page, element: any, elementType: 'checkbox' | 'radio', targetState: boolean | string): Promise<boolean> {
  try {
    // Method 1: Direct property setting via JavaScript
    const setByProperty = await element.evaluate((el: HTMLInputElement, state: boolean | string) => {
      if (el.type === 'checkbox') {
        el.checked = state as boolean;
        // Trigger change event
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('click', { bubbles: true }));
        return el.checked === state;
      } else if (el.type === 'radio') {
        el.checked = true;
        // Trigger change event
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('click', { bubbles: true }));
        return el.checked;
      }
      return false;
    }, targetState);

    if (setByProperty) {
      console.log('    ✅ JavaScript property setting succeeded');
      return true;
    }

    // Method 2: Click dispatch if property setting failed
    const clickDispatched = await element.evaluate((el: HTMLInputElement) => {
      el.click();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.type === 'checkbox' ? el.checked : true;
    });

    if (clickDispatched) {
      console.log('    ✅ JavaScript click dispatch succeeded');
      return true;
    }

    // Method 3: jQuery trigger if available
    const elementId = await element.getAttribute('id');
    const elementName = await element.getAttribute('name');
    const selector = elementId ? `#${elementId}` : elementName ? `input[name="${elementName}"]` : undefined;

    const jqueryTriggered = selector
      ? await page.evaluate((sel) => {
          const win = window as any;
          if (win && typeof win.$ === 'function') {
            win.$(sel).trigger('click');
            return true;
          }
          return false;
        }, selector)
      : false;

    if (jqueryTriggered) {
      console.log('    ✅ jQuery trigger succeeded');
      return true;
    }

    return false;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.log(`    ❌ All JavaScript methods failed: ${message}`);
    return false;
  }
}

async function retryMissingFields(page: Page, validationError: string, profile: ApplyPayload['profile']): Promise<boolean> {
  console.log('🔍 JAVASCRIPT EVALUATE APPROACH: Using direct DOM manipulation...');
  console.log('📝 Validation error:', validationError);
  let fixCount = 0;

  try {
    // STEP 0: Use pure JavaScript to find and manipulate ALL form elements at once
    console.log('🔧 Step 0: AGGRESSIVE - JavaScript scan of entire DOM...');
    const domManipulationResult = await page.evaluate(() => {
      let modifications = 0;

      // Find ALL form elements using multiple queries
      const allInputs = [
        ...Array.from(document.querySelectorAll('input')),
        ...Array.from(document.querySelectorAll('select')),
        ...Array.from(document.querySelectorAll('textarea'))
      ];

      console.log(`DOM scan found ${allInputs.length} total form elements`);

      for (const element of allInputs) {
        const el = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

        try {
          if (el instanceof HTMLInputElement && el.type === 'checkbox' && !el.checked) {
            // Check ALL unchecked checkboxes
            el.checked = true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('click', { bubbles: true }));
            console.log(`Checked checkbox: ${el.name || el.id}`);
            modifications++;
          } else if (el instanceof HTMLInputElement && el.type === 'radio' && !el.checked) {
            // Find label text to determine if this should be selected
            const labelText = (el.closest('label')?.textContent ||
                             document.querySelector(`label[for="${el.id}"]`)?.textContent ||
                             el.getAttribute('aria-label') || '').toLowerCase();

            // Select "Yes", pronoun, or "0" options
            if (/yes|true|willing|authorized|he\/him|she\/her|they\/them|^0$|none|zero/.test(labelText) ||
                /yes|true|willing|authorized|^0$|none|zero/.test(el.value.toLowerCase())) {
              el.checked = true;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              el.dispatchEvent(new Event('click', { bubbles: true }));
              console.log(`Selected radio: ${el.name}=${el.value} (${labelText})`);
              modifications++;
            }
          } else if (el instanceof HTMLSelectElement && (!el.value || el.value === '')) {
            // Handle dropdowns
            const options = Array.from(el.options);
            let selectedValue = '';

            for (const option of options) {
              const text = option.text.toLowerCase();
              if (/they|he|she/.test(text) || /0|none|zero/.test(text) ||
                  (option.value !== '' && !/(select|choose)/i.test(text))) {
                selectedValue = option.value;
                break;
              }
            }

            if (selectedValue) {
              el.value = selectedValue;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              console.log(`Selected dropdown: ${el.name}=${selectedValue}`);
              modifications++;
            }
          } else if ((el instanceof HTMLInputElement && ['text', 'number', 'email'].includes(el.type) && (!el.value || el.value.trim() === '')) ||
                     (el instanceof HTMLTextAreaElement && (!el.value || el.value.trim() === ''))) {
            // Fill empty text fields
            const labelText = (el.closest('label')?.textContent ||
                             document.querySelector(`label[for="${el.id}"]`)?.textContent ||
                             el.getAttribute('placeholder') ||
                             el.getAttribute('aria-label') || '').toLowerCase();

            let value = '';
            if (/school|university/.test(labelText)) value = 'Manhattan Center for Science and Mathematics';
            else if (/graduation|grad.*date/.test(labelText)) value = 'June 2025';
            else if (/first.*name/.test(labelText)) value = 'John';
            else if (/last.*name/.test(labelText)) value = 'Doe';
            else if (/email/.test(labelText)) value = 'test@example.com';
            else if (/phone/.test(labelText)) value = '(555) 123-4567';
            else if (/internship|how.*many/.test(labelText)) value = '0';
            else if (/gpa/.test(labelText)) value = '3.5';

            if (value) {
              el.value = value;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              console.log(`Filled text field: ${el.name}=${value}`);
              modifications++;
            }
          }
        } catch (e) {
          console.log(`Error manipulating element:`, e);
        }
      }

      return modifications;
    });

    console.log(`  🎯 DOM manipulation made ${domManipulationResult} changes`);
    fixCount += domManipulationResult;
    // STEP 1: Handle ALL dropdowns/selects with JavaScript
    console.log('🔧 Step 1: JavaScript handling of dropdowns...');
    const allSelects = await page.locator('select').all();
    console.log(`  Found ${allSelects.length} dropdown/select elements`);

    for (let i = 0; i < allSelects.length; i++) {
      const select = allSelects[i];
      const isVisible = await select.isVisible();
      if (!isVisible) continue;

      const currentValue = await select.inputValue();
      if (currentValue && currentValue.trim().length > 0) continue;

      const label = await labelTextFor(page, select);
      console.log(`  📋 Dropdown ${i + 1}: "${label}"`);

      // Use JavaScript to set the select value directly
      const setViaJS = await select.evaluate((el: HTMLSelectElement, lbl: string) => {
        const options = Array.from(el.options);
        let targetValue = '';

        // Smart selection logic
        for (const option of options) {
          const text = option.text.toLowerCase();
          const value = option.value.toLowerCase();

          if (/pronoun/i.test(lbl) && /they|he|she/i.test(text)) {
            targetValue = option.value;
            break;
          } else if (/internship|experience/i.test(lbl) && /0|none|zero|entry/i.test(text + value)) {
            targetValue = option.value;
            break;
          } else if (/year|grade/i.test(lbl) && /2025|current|senior/i.test(text)) {
            targetValue = option.value;
            break;
          } else if (option.value !== '' && !/(select|choose)/i.test(text)) {
            targetValue = option.value; // First non-empty option
            break;
          }
        }

        if (targetValue) {
          el.value = targetValue;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return targetValue;
        }
        return null;
      }, label);

      if (setViaJS) {
        console.log(`    ✅ JavaScript select set to: ${setViaJS}`);
        fixCount++;
      }
    }

    // STEP 2: Fill text inputs with JavaScript
    console.log('🔧 Step 2: JavaScript filling of text inputs...');
    const allInputs = await page.locator('input[type="text"], input[type="number"], input[type="email"], textarea, input:not([type])').all();
    console.log(`  Found ${allInputs.length} text/number inputs`);

    for (let i = 0; i < allInputs.length; i++) {
      const input = allInputs[i];
      const isVisible = await input.isVisible();
      const isEnabled = await input.isEnabled();
      if (!isVisible || !isEnabled) continue;

      const currentValue = await input.inputValue();
      if (currentValue && currentValue.trim().length > 0) continue;

      const label = await labelTextFor(page, input);
      console.log(`  📝 Empty input ${i + 1}: "${label}"`);

      let answer = '';
      if (/school/i.test(label)) answer = 'Manhattan Center for Science and Mathematics';
      else if (/graduation|grad.*date/i.test(label)) answer = 'June 2025';
      else if (/degree.*type/i.test(label)) answer = 'High School Diploma';
      else if (/first.*name/i.test(label)) answer = profile.firstName || 'John';
      else if (/last.*name/i.test(label)) answer = profile.lastName || 'Doe';
      else if (/email/i.test(label)) answer = profile.email || 'test@example.com';
      else if (/phone/i.test(label)) answer = profile.phone || '(555) 123-4567';
      else if (/internship|how.*many/i.test(label)) answer = '0';
      else if (/gpa/i.test(label)) answer = '3.5';

      if (answer) {
        const setViaJS = await input.evaluate((el: HTMLInputElement, val: string) => {
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return el.value === val;
        }, answer);

        if (setViaJS) {
          console.log(`    ✅ JavaScript filled "${label}" with: ${answer.slice(0, 30)}...`);
          fixCount++;
        }
      }
    }

    // STEP 3: JavaScript checkbox manipulation with multiple fallback methods
    console.log('🔧 Step 3: JavaScript checkbox state manipulation...');
    const allCheckboxes = await page.locator('input[type="checkbox"]').all();
    console.log(`  Found ${allCheckboxes.length} total checkboxes`);

    for (let i = 0; i < allCheckboxes.length; i++) {
      const checkbox = allCheckboxes[i];
      const isVisible = await checkbox.isVisible();
      const isEnabled = await checkbox.isEnabled();
      if (!isVisible || !isEnabled) continue;

      const isChecked = await checkbox.isChecked();
      if (isChecked) continue;

      const label = await labelTextFor(page, checkbox);
      const value = await checkbox.getAttribute('value') || '';
      console.log(`  📋 Checkbox ${i + 1}: "${label}" (value: "${value}") - JS MANIPULATION`);

      // Try multiple methods in waterfall approach
      let success = false;

      // Method 1: Standard Playwright check
      try {
        await checkbox.check({ force: true });
        await page.waitForTimeout(50);
        if (await checkbox.isChecked()) {
          console.log(`    ✅ Standard check succeeded`);
          success = true;
          fixCount++;
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.log(`    ⚠️ Standard check failed: ${message}`);
      }

      // Method 2: JavaScript evaluation fallback
      if (!success) {
        success = await forceSetElementState(page, checkbox, 'checkbox', true);
        if (success) fixCount++;
      }

      // Method 3: Raw DOM click fallback
      if (!success) {
        try {
          const clicked = await checkbox.evaluate((el: HTMLInputElement) => {
            // Find the actual clickable element (might be a label or wrapper)
            const label = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
            if (label) {
              label.click();
            } else {
              el.click();
            }
            return true;
          });

          await page.waitForTimeout(100);
          if (await checkbox.isChecked()) {
            console.log(`    ✅ DOM click succeeded`);
            fixCount++;
          }
        } catch (e) {
          console.log(`    ❌ All methods failed for checkbox`);
        }
      }
    }

    // STEP 4: JavaScript radio button manipulation
    console.log('🔧 Step 4: JavaScript radio button manipulation...');
    const allRadios = await page.locator('input[type="radio"]').all();
    console.log(`  Found ${allRadios.length} total radio buttons`);

    // Group radios by name
    const radioGroups = new Map<string, { element: any, value: string, label: string, isChecked: boolean }[]>();

    for (let i = 0; i < allRadios.length; i++) {
      const radio = allRadios[i];
      const isVisible = await radio.isVisible();
      const isEnabled = await radio.isEnabled();
      if (!isVisible || !isEnabled) continue;

      const name = await radio.getAttribute('name') || `unnamed_${i}`;
      const value = await radio.getAttribute('value') || '';
      const label = await labelTextFor(page, radio);
      const isChecked = await radio.isChecked();

      if (!radioGroups.has(name)) {
        radioGroups.set(name, []);
      }
      radioGroups.get(name)!.push({ element: radio, value, label, isChecked });
    }

    for (const [groupName, radios] of radioGroups) {
      console.log(`  📻 Radio group "${groupName}" has ${radios.length} options`);

      const hasSelection = radios.some(r => r.isChecked);
      if (hasSelection) {
        const selected = radios.find(r => r.isChecked);
        console.log(`    ✓ Already selected: "${selected?.label}" (${selected?.value})`);
        continue;
      }

      // Smart selection priority
      let selectedOption =
        radios.find(r => /yes/i.test(r.value) || /yes/i.test(r.label) || /true/i.test(r.value) || /willing/i.test(r.label) || /authorized/i.test(r.label)) ||
        radios.find(r => /he\/him|she\/her|they\/them/i.test(r.label + r.value)) ||
        radios.find(r => /^0$|none|zero/i.test(r.value + r.label)) ||
        radios[0];

      if (selectedOption) {
        console.log(`    ✅ Selecting: "${selectedOption.label}" (${selectedOption.value})`);

        let success = false;

        // Method 1: Standard check
        try {
          await selectedOption.element.check({ force: true });
          await page.waitForTimeout(50);
          if (await selectedOption.element.isChecked()) {
            console.log(`    ✅ Standard radio check succeeded`);
            success = true;
            fixCount++;
          }
        } catch (e) {
          console.log(`    ⚠️ Standard radio check failed`);
        }

        // Method 2: JavaScript evaluation
        if (!success) {
          success = await forceSetElementState(page, selectedOption.element, 'radio', selectedOption.value);
          if (success) fixCount++;
        }

        // Method 3: Find and click label
        if (!success) {
          try {
            await selectedOption.element.evaluate((el: HTMLInputElement) => {
              const label = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
              if (label) {
                label.click();
              } else {
                el.click();
              }
            });

            await page.waitForTimeout(100);
            if (await selectedOption.element.isChecked()) {
              console.log(`    ✅ Label click succeeded`);
              fixCount++;
            }
          } catch (e) {
            console.log(`    ❌ All radio methods failed`);
          }
        }
      }
    }

    console.log(`🔧 JAVASCRIPT EVALUATE APPROACH COMPLETE: Fixed ${fixCount} elements`);
    return fixCount > 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log('❌ Error in JavaScript evaluate approach:', message);
    return false;
  }
}

function extractMissingFieldSuggestions(validationError: string): string[] {
  const suggestions: string[] = [];

  if (validationError.includes('Phone')) {
    suggestions.push('phone number');
  }
  if (validationError.includes('School')) {
    suggestions.push('education (school name)');
  }
  if (validationError.includes('Graduation Date')) {
    suggestions.push('graduation date');
  }
  if (validationError.includes('Degree Type')) {
    suggestions.push('degree type (Bachelor\'s, Master\'s, etc.)');
  }
  if (validationError.includes('work lawfully') || validationError.includes('authorized to work')) {
    suggestions.push('work authorization status');
  }
  if (validationError.includes('relocate') || validationError.includes('relocation')) {
    suggestions.push('willingness to relocate');
  }

  return suggestions;
}

async function findSuccessText(page: Page): Promise<string | null> {
  const body = await page.content();
  const match = body.match(/(Thank you|received|submitted|success)/i);
  return match ? match[0] : null;
}

async function triggerAutofillFromResume(page: Page) {
  console.log('🔍 Looking for autofill button...');
  const autofillButton = page.getByRole('button', { name: /autofill from resume/i }).first();
  if ((await autofillButton.count()) > 0) {
    try {
      console.log('🎯 Found autofill button, clicking...');
      await autofillButton.click();
      console.log('⏳ Waiting for autofill to process...');
      await page.waitForTimeout(5000); // Increased from 2s to 5s
      return;
    } catch {
      // ignore and fall back
    }
  }

  const autofillTextButton = page.getByText(/Autofill from resume/i, { exact: false }).first();
  if ((await autofillTextButton.count()) > 0) {
    try {
      console.log('🎯 Found autofill text button, clicking...');
      await autofillTextButton.click();
      console.log('⏳ Waiting for autofill to complete...');
      await page.waitForTimeout(5000); // Increased from 2s to 5s
    } catch {
      // ignore
    }
  } else {
    console.log('❌ No autofill button found');
  }
}

async function listenForFileChooser(page: Page, button: Locator): Promise<FileChooser | null> {
  try {
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      button.click()
    ]);
    return fileChooser;
  } catch {
    await button.click();
    return null;
  }
}

async function setFileOnFirstChooser(page: Page, filePath: string): Promise<boolean> {
  try {
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 3_000 }).catch(() => null);
    const fileChooser = await chooserPromise;
    if (fileChooser) {
      await fileChooser.setFiles(filePath);
      return true;
    }
  } catch {
    // ignore
  }

  const firstInput = page.locator('input[type="file"]').first();
  if ((await firstInput.count()) > 0) {
    await firstInput.setInputFiles(filePath);
    return true;
  }
  return false;
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
