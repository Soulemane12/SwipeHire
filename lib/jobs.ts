import { Job, JobSwipeData, ATSCompany } from '@/types/job';

// Sample jobs removed - now using only real API data

export const ATS_COMPANIES: ATSCompany[] = [
  // Ashby companies (verified working APIs)
  { name: 'Notion', atsProvider: 'ashby', companyId: 'notion', baseUrl: 'https://jobs.ashbyhq.com/notion' },
  { name: 'Linear', atsProvider: 'ashby', companyId: 'linear', baseUrl: 'https://jobs.ashbyhq.com/linear' },
  { name: 'Vercel', atsProvider: 'ashby', companyId: 'vercel', baseUrl: 'https://jobs.ashbyhq.com/vercel' },
  { name: 'Supabase', atsProvider: 'ashby', companyId: 'supabase', baseUrl: 'https://jobs.ashbyhq.com/supabase' },
  { name: 'Retool', atsProvider: 'ashby', companyId: 'retool', baseUrl: 'https://jobs.ashbyhq.com/retool' },
  { name: 'Zapier', atsProvider: 'ashby', companyId: 'zapier', baseUrl: 'https://jobs.ashbyhq.com/zapier' },
  { name: 'Loom', atsProvider: 'ashby', companyId: 'loom', baseUrl: 'https://jobs.ashbyhq.com/loom' }
];

// Job swipe persistence
const SWIPE_STORAGE_KEY = 'swipe_hire_job_swipes';

export function getJobSwipes(): JobSwipeData[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(SWIPE_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Error reading job swipes from localStorage:', error);
    return [];
  }
}

export function saveJobSwipe(jobId: string, action: 'applied' | 'skipped'): void {
  if (typeof window === 'undefined') return;

  try {
    const existingSwipes = getJobSwipes();
    const newSwipe: JobSwipeData = {
      jobId,
      action,
      timestamp: new Date().toISOString()
    };

    // Remove any existing swipe for this job
    const filteredSwipes = existingSwipes.filter(swipe => swipe.jobId !== jobId);
    const updatedSwipes = [...filteredSwipes, newSwipe];

    localStorage.setItem(SWIPE_STORAGE_KEY, JSON.stringify(updatedSwipes));
  } catch (error) {
    console.error('Error saving job swipe to localStorage:', error);
  }
}

export function getAppliedJobs(): string[] {
  return getJobSwipes()
    .filter(swipe => swipe.action === 'applied')
    .map(swipe => swipe.jobId);
}

export function getSkippedJobs(): string[] {
  return getJobSwipes()
    .filter(swipe => swipe.action === 'skipped')
    .map(swipe => swipe.jobId);
}

export function deduplicateJobs(jobs: Job[]): Job[] {
  const seen = new Map<string, Job>();

  jobs.forEach(job => {
    const normalizedTitle = job.title.toLowerCase().replace(/\s+/g, ' ').trim();
    const normalizedCompany = job.company.toLowerCase().replace(/\s+/g, ' ').trim();
    const normalizedLocation = job.location.toLowerCase().replace(/\s+/g, ' ').trim();
    const fallbackKey = `${normalizedCompany}|${normalizedTitle}|${normalizedLocation}|${job.employmentType}`;
    const key = job.atsUrl || fallbackKey;

    if (!seen.has(key)) {
      seen.set(key, job);
    }
  });

  return Array.from(seen.values());
}

// Fetch real jobs from APIs
export async function fetchRealJobs(): Promise<Job[]> {
  const { fetchAllJobs } = await import('@/services/ats');

  try {
    const allJobs = await fetchAllJobs(ATS_COMPANIES);
    const uniqueJobs = deduplicateJobs(allJobs);
    console.log(`Fetched ${allJobs.length} real jobs from APIs`);
    console.log(`De-duplicated to ${uniqueJobs.length} unique jobs`);
    return uniqueJobs;
  } catch (error) {
    console.error('Error fetching real jobs:', error);
    return [];
  }
}

export function getAvailableJobs(allJobs: Job[]): Job[] {
  const swipedJobIds = new Set(getJobSwipes().map(swipe => swipe.jobId));
  return deduplicateJobs(allJobs).filter(job => !swipedJobIds.has(job.id));
}
