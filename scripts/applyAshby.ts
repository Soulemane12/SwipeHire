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
      console.log(`  ❌ Strategy ${i + 1} failed for ${label}:`, error.message);
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

async function autoAnswerFollowUps(page: Page, profile: ApplyPayload['profile'], mode: 'auto' | 'confirm', companyName: string, jobTitle: string) {
  console.log('🤝 Auto-answering follow-up questions...');
  const inputs = await page.locator('form input, form textarea, form select').all();
  console.log(`  🔍 Found ${inputs.length} form elements to examine`);

  let unfilledFields: string[] = [];

  for (const loc of inputs) {
    const visible = await loc.isVisible();
    if (!visible || (await loc.isDisabled())) {
      console.log(`  ⏭️ Skipping invisible/disabled field`);
      continue;
    }

    const label = await labelTextFor(page, loc);
    if (label && /EEO|Equal Employment Opportunity|Demographic|Veteran|Disability/i.test(label)) {
      console.log(`  ⏭️ Skipping EEO field: ${label}`);
      continue;
    }
    if (label && /(first|last) name|email|phone|resume|cv|linkedin|github|website|portfolio/i.test(label)) {
      console.log(`  ⏭️ Skipping basic field (already handled): ${label}`);
      continue;
    }

    const tag = await loc.evaluate((el) => el.tagName.toLowerCase());
    const typeAttr = await loc.getAttribute('type');
    const role = await loc.getAttribute('role');

    console.log(`  🔍 Found field: ${label} (${tag}, type: ${typeAttr})`);

    // Handle select dropdowns
    if (tag === 'select' || role === 'combobox') {
      console.log(`  📋 Selecting option for: ${label}`);
      await safeSelectFirstValidOption(loc);
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

      // Generate AI answer for complex questions
      let answer = '';
      if (label && label.length > 10) {
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
          console.log(`  ❌ Failed to fill "${label}":`, error.message);
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
      apiKey: process.env.GROQ_API_KEY,
    });

    const profileContext = `
Profile: ${profile.firstName} ${profile.lastName}
Email: ${profile.email}
Location: ${profile.location || 'Not specified'}
Skills and background: Software Engineer with experience in web development
`;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are helping someone apply for a ${jobTitle} position at ${companyName}. Generate a professional, genuine, and compelling answer to job application questions. Keep responses concise but meaningful (100-300 words unless specified otherwise). Focus on technical skills, problem-solving, and genuine interest in the role and company.`
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
    console.log(`  ⚠️ AI answer failed for "${question}":`, error.message);
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
    if (groupLabel.toLowerCase().includes('age') && lowerLabel.includes('yes')) {
      await radio.check();
      return;
    }

    if (groupLabel.toLowerCase().includes('apac') && lowerLabel.includes('yes')) {
      await radio.check();
      return;
    }

    if (groupLabel.toLowerCase().includes('region') && lowerLabel.includes('yes')) {
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

  // For source/referral checkboxes, check professional sources
  if (lowerLabel.includes('linkedin') || lowerLabel.includes('job board') || lowerLabel.includes('google')) {
    await locator.check();
    return;
  }

  // Default: don't check unless it's clearly required
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
    console.log('  ❌ Validation check failed:', error.message);
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
      await page.waitForTimeout(2000);
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
      console.log('⏳ Waiting for autofill to process...');
      await page.waitForTimeout(2000);
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
