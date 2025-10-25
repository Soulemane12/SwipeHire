import { Job } from '@/types/job';

export type ApplicationStatus = 'queued' | 'applying' | 'applied' | 'failed';

export interface ApplicationRecord {
  jobId: string;
  job: Job;
  profile: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    location: string;
    linkedin?: string;
    website?: string;
    github?: string;
    workAuth: string;
    coverLetter?: string;
    willingToRelocate: boolean;
    understandsAnchorDays: boolean;
    requiresSponsorship: boolean;
    resumePath: string;
  };
  status: ApplicationStatus;
  updatedAt: string;
  error?: string;
  appliedAt?: string;
}

const QUEUE_KEY = 'swipehire_applications';
export const APPLICATION_QUEUE_KEY = QUEUE_KEY;
const AUTO_SUBMIT_KEY = 'swipehire_auto_submit_enabled';

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getApplicationQueue(): ApplicationRecord[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ApplicationRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Failed to parse application queue from localStorage:', error);
    return [];
  }
}

function saveQueue(queue: ApplicationRecord[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.error('Failed to persist application queue:', error);
  }
}

export function enqueueApplication(record: ApplicationRecord): void {
  const queue = getApplicationQueue();
  const withoutDuplicate = queue.filter(item => item.jobId !== record.jobId);
  withoutDuplicate.push(record);
  saveQueue(withoutDuplicate);
}

export function updateApplicationRecord(jobId: string, updates: Partial<ApplicationRecord>): ApplicationRecord | undefined {
  const queue = getApplicationQueue();
  const idx = queue.findIndex(item => item.jobId === jobId);
  if (idx === -1) return undefined;

  queue[idx] = {
    ...queue[idx],
    ...updates,
    profile: {
      ...queue[idx].profile,
      ...(updates.profile ?? {})
    }
  };
  saveQueue(queue);
  return queue[idx];
}

export function removeApplication(jobId: string): void {
  const queue = getApplicationQueue().filter(item => item.jobId !== jobId);
  saveQueue(queue);
}

export function getNextQueuedApplication(): ApplicationRecord | undefined {
  const queue = getApplicationQueue();
  return queue.find(item => item.status === 'queued' || item.status === 'failed');
}

export function setAutoSubmitPreference(enabled: boolean): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(AUTO_SUBMIT_KEY, JSON.stringify(enabled));
  } catch (error) {
    console.error('Failed to store auto submit preference:', error);
  }
}

export function getAutoSubmitPreference(): boolean {
  if (!isBrowser()) return true;
  try {
    const raw = window.localStorage.getItem(AUTO_SUBMIT_KEY);
    if (raw === null) return true;
    return JSON.parse(raw) === true;
  } catch {
    return true;
  }
}

export function clearQueue(): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(QUEUE_KEY);
}
