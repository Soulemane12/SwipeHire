'use client';

import { useState, useEffect, useMemo, useCallback, useRef, createRef } from 'react';
import TinderCard from 'react-tinder-card';
import JobCard from './JobCard';
import { Job } from '@/types/job';
import { Profile } from '@/types/profile';
import { ATS_COMPANIES, getJobSwipes, saveJobSwipe, getSkippedJobs, deduplicateJobs } from '@/lib/jobs';
import { fetchJobsFromATS } from '@/services/ats';
import { enhanceJobsWithMatches, calculateJobMatch } from '@/services/matching';
import {
  enqueueApplication,
  getApplicationQueue,
  updateApplicationRecord,
  getNextQueuedApplication,
  getAutoSubmitPreference,
  setAutoSubmitPreference,
  ApplicationRecord,
  APPLICATION_QUEUE_KEY
} from '@/lib/applicationQueue';

const MATCH_SCORE_THRESHOLD = 60;
const FALLBACK_RESUME_PATH = process.env.NEXT_PUBLIC_RESUME_PATH ?? 'public/Soulemane Sow Resume.pdf';
type SwipeDirection = 'left' | 'right' | 'up' | 'down';
type TinderCardHandle = {
  swipe: (dir?: SwipeDirection) => Promise<void>;
  restoreCard: () => Promise<void>;
};

interface SwipeDeckProps {
  profile: Profile;
  onJobAction?: (job: Job, action: 'applied' | 'skipped') => void;
}

function getNameParts(profile: Profile): { firstName: string; lastName: string } {
  if (profile.firstName && profile.lastName) {
    return { firstName: profile.firstName, lastName: profile.lastName };
  }

  if (profile.name) {
    const segments = profile.name.trim().split(/\s+/).filter(Boolean);
    if (segments.length === 1) {
      return { firstName: segments[0], lastName: segments[0] };
    }
    const lastName = segments.pop() ?? '';
    const firstName = segments.join(' ') || lastName;
    return { firstName, lastName };
  }

  return { firstName: '', lastName: '' };
}

type LastStatus =
  | { type: 'queued'; message: string }
  | { type: 'applying'; message: string }
  | { type: 'applied'; message: string }
  | { type: 'skipped'; message: string }
  | { type: 'failed'; message: string }
  | { type: null; message: '' };

function StatCard({ label, value, description }: { label: string; value: number; description: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col items-center justify-center">
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-sm font-medium text-gray-700">{label}</div>
      <div className="text-xs text-gray-500 mt-1 text-center">{description}</div>
    </div>
  );
}

export default function SwipeDeck({ profile, onJobAction }: SwipeDeckProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(true);
  const [applyStatus, setApplyStatus] = useState<string | null>(null);
  const [queueRecords, setQueueRecords] = useState<ApplicationRecord[]>([]);
  const [autoSubmit, setAutoSubmit] = useState<boolean>(() => getAutoSubmitPreference());
  const [isProcessing, setIsProcessing] = useState(false);
  const [skippedCount, setSkippedCount] = useState<number>(() => getSkippedJobs().length);
  const [lastStatus, setLastStatus] = useState<LastStatus>({ type: null, message: '' });
  const processingRef = useRef(false);

  const hasProfileData = useMemo(() => {
    const skillCount = profile.skills?.length ?? 0;
    const experienceCount = profile.experience?.length ?? 0;
    const summaryLength = profile.summary ? profile.summary.trim().length : 0;
    return skillCount > 0 || experienceCount > 0 || summaryLength > 0;
  }, [profile]);

  // Enhanced jobs with match scores
  const scoredJobs = useMemo(() => {
    if (!hasProfileData || jobs.length === 0) return [];
    return enhanceJobsWithMatches(jobs, profile);
  }, [jobs, profile, hasProfileData]);

  const recommendedJobs = useMemo(
    () => scoredJobs.filter(job => (job.matchScore ?? 0) >= MATCH_SCORE_THRESHOLD),
    [scoredJobs]
  );

  const filteredJobs = useMemo(() => {
    return recommendedJobs.length > 0 ? recommendedJobs : scoredJobs;
  }, [recommendedJobs, scoredJobs]);

  const cardRefs = useMemo(
    () => filteredJobs.map(() => createRef<TinderCardHandle>()),
    [filteredJobs]
  );


  const submitApplicationRecord = useCallback(async (record: ApplicationRecord) => {
    if (record.job.atsProvider !== 'ashby') {
      throw new Error('Auto-submit currently supports Ashby jobs only.');
    }

    if (!record.job.atsUrl) {
      throw new Error('Missing ATS URL for job.');
    }

    const payload = {
      jobUrl: record.job.atsUrl,
      profile: {
        firstName: record.profile.firstName,
        lastName: record.profile.lastName,
        email: record.profile.email,
        phone: record.profile.phone,
        location: record.profile.location,
        linkedin: record.profile.linkedin,
        website: record.profile.website,
        github: record.profile.github,
        workAuth: record.profile.workAuth,
        coverLetter: record.profile.coverLetter,
        willingToRelocate: record.profile.willingToRelocate,
        understandsAnchorDays: record.profile.understandsAnchorDays,
        requiresSponsorship: record.profile.requiresSponsorship
      },
      resumePath: record.profile.resumePath,
      mode: 'auto' as const
    };

    const response = await fetch('/api/apply-ashby', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }
  }, []);

  const processQueue = useCallback(async (force = false) => {
    if ((!force && !autoSubmit) || processingRef.current) return;

    const next = getNextQueuedApplication();
    if (!next) return;

    processingRef.current = true;
    setIsProcessing(true);
    const startTime = new Date().toISOString();
    updateApplicationRecord(next.jobId, { status: 'applying', updatedAt: startTime, error: undefined });
    setQueueRecords(getApplicationQueue());
    setLastStatus({ type: 'applying', message: `Applying to ${next.job.title} at ${next.job.company}...` });
    setApplyStatus(`Applying to ${next.job.title} at ${next.job.company}...`);

    try {
      await submitApplicationRecord(next);
      const successTime = new Date().toISOString();
      updateApplicationRecord(next.jobId, {
        status: 'applied',
        appliedAt: successTime,
        updatedAt: successTime,
        error: undefined
      });
      setQueueRecords(getApplicationQueue());
      setLastStatus({ type: 'applied', message: `Applied to ${next.job.title} at ${next.job.company}.` });
      setApplyStatus(`Submitted application to ${next.job.company}.`);
      saveJobSwipe(next.jobId, 'applied');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failTime = new Date().toISOString();
      updateApplicationRecord(next.jobId, {
        status: 'failed',
        updatedAt: failTime,
        error: message
      });
      setQueueRecords(getApplicationQueue());
      setLastStatus({ type: 'failed', message: `Failed to apply to ${next.job.title}: ${message}` });
      setApplyStatus(`Failed to apply: ${message}`);
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
      const shouldContinue = getNextQueuedApplication() !== undefined;
      if ((autoSubmit || force) && shouldContinue) {
        setTimeout(() => processQueue(force && !autoSubmit ? true : false), 500);
      }
    }
  }, [autoSubmit, submitApplicationRecord]);

  const enqueueJobForApplication = useCallback((job: Job) => {
    if (job.atsProvider !== 'ashby') {
      saveJobSwipe(job.id, 'applied');
      onJobAction?.(job, 'applied');
      setJobs(prevJobs => prevJobs.filter(j => j.id !== job.id));
      setLastStatus({ type: 'applied', message: `Marked ${job.title} as applied.` });
      setApplyStatus(`Marked ${job.title} as applied.`);
      return;
    }

    const { firstName, lastName } = getNameParts(profile);
    const email = profile.email;
    const resumePath = profile.resumePath || FALLBACK_RESUME_PATH;

    if (!firstName || !lastName || !email || !resumePath) {
      const message = 'Add your name, email, and resume path to queue applications.';
      setApplyStatus(message);
      setLastStatus({ type: 'failed', message });
      return;
    }

    const record: ApplicationRecord = {
      jobId: job.id,
      job,
      profile: {
        firstName,
        lastName,
        email,
        phone: profile.phone || '(646) 555-0199',
        location: profile.location || 'New York, NY, USA',
        linkedin: profile.linkedinUrl,
        website: profile.portfolioUrl,
        github: profile.githubUrl,
        workAuth: profile.workAuth || 'Yes, I am authorized to work in the United States',
        coverLetter: profile.coverLetter,
        willingToRelocate: profile.willingToRelocate ?? true,
        understandsAnchorDays: profile.understandsAnchorDays ?? true,
        requiresSponsorship: profile.requiresSponsorship ?? false,
        resumePath
      },
      status: 'queued',
      updatedAt: new Date().toISOString()
    };

    enqueueApplication(record);
    setQueueRecords(getApplicationQueue());
    setJobs(prevJobs => prevJobs.filter(j => j.id !== job.id));
    setLastStatus({ type: 'queued', message: `Queued ${job.title} at ${job.company}.` });
    setApplyStatus(`Queued ${job.title} at ${job.company}.`);

    if (autoSubmit) {
      setTimeout(() => processQueue(), 50);
    }
  }, [profile, autoSubmit, processQueue, onJobAction]);

  const queueStats = useMemo(() => ({
    queued: queueRecords.filter(r => r.status === 'queued').length,
    applying: queueRecords.filter(r => r.status === 'applying').length,
    applied: queueRecords.filter(r => r.status === 'applied').length,
    failed: queueRecords.filter(r => r.status === 'failed').length
  }), [queueRecords]);

  const nextQueued = useMemo(
    () => queueRecords.find(record => record.status === 'queued'),
    [queueRecords]
  );

  const processingRecord = useMemo(
    () => queueRecords.find(record => record.status === 'applying'),
    [queueRecords]
  );

  const queuedList = useMemo(() => queueRecords.slice(0, 5), [queueRecords]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const loadQueue = () => {
      setQueueRecords(getApplicationQueue());
      setSkippedCount(getSkippedJobs().length);
    };
    loadQueue();
    const handler = (event: StorageEvent) => {
      if (event.key === APPLICATION_QUEUE_KEY) {
        loadQueue();
      }
    };
    window.addEventListener('storage', handler);
    const interval = window.setInterval(loadQueue, 1000);
    return () => {
      window.removeEventListener('storage', handler);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    setAutoSubmitPreference(autoSubmit);
    if (autoSubmit) {
      processQueue();
    }
  }, [autoSubmit, processQueue]);

  useEffect(() => {
    if (!autoSubmit) return;
    if (processingRef.current) return;
    if (getNextQueuedApplication()) {
      processQueue();
    }
  }, [queueRecords, autoSubmit, processQueue]);

  const loadJobs = useCallback(async () => {
    if (!hasProfileData) {
      setJobs([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setApplyStatus(null);
    setJobs([]);

    const swipedJobIds = new Set(getJobSwipes().map(swipe => swipe.jobId));

    const companyPromises = ATS_COMPANIES.map(async company => {
      try {
        console.log(`[Jobs] Fetching ${company.name} via ${company.atsProvider}`);
        const companyJobs = await fetchJobsFromATS(company);
        if (!companyJobs || companyJobs.length === 0) return;

        const scoredMatches = companyJobs
          .filter(job => !swipedJobIds.has(job.id))
          .map(job => {
            const match = calculateJobMatch(job, profile);
            return { ...job, matchScore: match.overall } as Job;
          })
          .filter(job => (job.matchScore ?? 0) >= MATCH_SCORE_THRESHOLD);

        if (scoredMatches.length === 0) return;

        setJobs(prev => {
          const combined = deduplicateJobs([...prev, ...scoredMatches]);
          return combined;
        });
      } catch (error) {
        console.error(`Error loading jobs for ${company.name}:`, error);
      }
    });

    await Promise.allSettled(companyPromises);
    setIsLoading(false);
  }, [hasProfileData]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    if (isLoading && jobs.length > 0) {
      setIsLoading(false);
    }
  }, [jobs, isLoading]);

  useEffect(() => {
    setCurrentIndex(filteredJobs.length - 1);
  }, [filteredJobs]);

  const swiped = (direction: string, job: Job, index: number) => {
    if (direction === 'right') {
      enqueueJobForApplication(job);
    } else {
      saveJobSwipe(job.id, 'skipped');
      onJobAction?.(job, 'skipped');
      setSkippedCount(getSkippedJobs().length);
      setLastStatus({ type: 'skipped', message: `Skipped ${job.title}.` });
      setJobs(prevJobs => prevJobs.filter(j => j.id !== job.id));
    }

    setCurrentIndex(Math.max(index - 1, -1));
    console.log(`Swiped ${direction} on ${job.title} at ${job.company}`);
  };

  const outOfFrame = (jobId: string) => {
    console.log(`${jobId} left the screen`);
  };

  const handleActionClick = useCallback(
    (action: 'apply' | 'skip') => {
      if (currentIndex < 0 || currentIndex >= cardRefs.length) return;

      const direction = action === 'apply' ? 'right' : 'left';
      const cardRef = cardRefs[currentIndex]?.current;

      if (cardRef && typeof cardRef.swipe === 'function') {
        cardRef.swipe(direction);
      }
    },
    [currentIndex, cardRefs]
  );

  const actionsDisabled = currentIndex < 0;

  if (!hasProfileData) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0-.667.333-4 4-4 2.22 0 4 1.78 4 4 0 1.314-.84 3-2.5 3.645M9 7H7a2 2 0 00-2 2v8a2 2 0 002 2h2m6 0h2a2 2 0 002-2v-2" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">Upload your resume to get matched</h3>
        <p className="text-gray-600 mb-4">
          Add your resume so we can learn your skills and surface the right roles for you.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading jobs...</p>
        </div>
      </div>
    );
  }

  if (filteredJobs.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2-2v2m8 0V6a2 2 0 00-2 2H8a2 2 0 00-2-2V6m8 0h4a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2h4" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">No matching roles yet</h3>
        <p className="text-gray-600 mb-4">
          Update your resume or refresh to check for new roles that align with your background.
        </p>
        <button
          onClick={loadJobs}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Refresh Jobs
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto">
      {/* Stats and Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6 text-sm text-gray-600">
        <StatCard label="Queued" value={queueStats.queued} description="Awaiting submission" />
        <StatCard label="Applying" value={queueStats.applying} description="Being processed" />
        <StatCard label="Applied" value={queueStats.applied} description="Completed submissions" />
        <StatCard label="Skipped" value={skippedCount} description="Jobs you skipped" />
      </div>

      {/* Controls */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Application Queue</h3>
            <p className="text-sm text-gray-600">
              Swipe right to queue a job. Applications are processed sequentially.
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setAutoSubmit(prev => !prev)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                autoSubmit ? 'bg-blue-600' : 'bg-gray-300'
              }`}
              aria-pressed={autoSubmit}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                  autoSubmit ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className="text-sm text-gray-700">Auto-submit {autoSubmit ? 'on' : 'off'}</span>
            <button
              onClick={() => processQueue(true)}
              disabled={isProcessing || !queueRecords.some(r => r.status === 'queued' || r.status === 'failed')}
              className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                isProcessing
                  ? 'border-gray-200 text-gray-400 cursor-not-allowed'
                  : 'border-blue-200 text-blue-600 hover:bg-blue-50'
              }`}
            >
              {isProcessing ? 'Processing…' : 'Process Next'}
            </button>
          </div>
        </div>

        {(processingRecord || nextQueued) && (
          <div className="mt-4 space-y-2 text-sm text-gray-700">
            {processingRecord && (
              <div>
                <strong>Current:</strong> {processingRecord.job.title} — {processingRecord.job.company}
              </div>
            )}
            {nextQueued && (
              <div>
                <strong>Next:</strong> {nextQueued.job.title} — {nextQueued.job.company}
              </div>
            )}
          </div>
        )}

        {queuedList.length > 0 && (
          <div className="mt-4 space-y-2">
            {queuedList.map(record => (
              <div
                key={record.jobId}
                className="flex items-center justify-between text-sm text-gray-600 border border-gray-200 rounded-lg px-3 py-2 bg-gray-50"
              >
                <div>
                  <div className="font-medium text-gray-900">{record.job.title}</div>
                  <div className="text-xs text-gray-500">{record.job.company}</div>
                </div>
                <span className="text-xs text-gray-500">{new Date(record.updatedAt).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="text-center mb-6">
        <p className="text-sm text-gray-600">
          Swipe right to queue an application • Swipe left to skip
        </p>
      </div>

      {/* Card Stack */}
      <div className="relative h-[600px]">
        {filteredJobs.map((job, index) => (
          <TinderCard
            key={job.id}
            ref={cardRefs[index]}
            onSwipe={(dir) => swiped(dir, job, index)}
            onCardLeftScreen={() => outOfFrame(job.id)}
            preventSwipe={['up', 'down']}
            swipeRequirementType="position"
            swipeThreshold={90}
            flickOnSwipe={false}
            className="absolute inset-0"
          >
            <div className="h-full">
              <JobCard job={job} />
            </div>
          </TinderCard>
        ))}
      </div>

      {/* Last Action Feedback */}
      {lastStatus.type && (
        <div className="text-center mt-4">
          <div
            className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
              lastStatus.type === 'applied'
                ? 'bg-green-100 text-green-800'
                : lastStatus.type === 'applying'
                ? 'bg-yellow-100 text-yellow-800'
                : lastStatus.type === 'failed'
                ? 'bg-red-100 text-red-800'
                : 'bg-gray-100 text-gray-800'
            }`}
          >
            {lastStatus.type === 'applying' && (
              <svg className="w-4 h-4 mr-1 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v4m0 8v4m8-8h4M4 12H0m16.24-5.76l2.83-2.83M4.93 19.07l-2.83 2.83m16.97 0l2.83-2.83M4.93 4.93 2.1 2.1" />
              </svg>
            )}
            {lastStatus.type === 'applied' && (
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
            {lastStatus.type === 'failed' && (
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
            {lastStatus.type === 'skipped' && (
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
            {lastStatus.message}
          </div>
        </div>
      )}

      {applyStatus && (
        <div
          className={`text-center mt-4 text-sm ${
            applyStatus.toLowerCase().includes('failed') ? 'text-red-600' : 'text-blue-600'
          }`}
        >
          {lastStatus.type === 'applying' && <span className="animate-pulse mr-1">•</span>}
          {applyStatus}
        </div>
      )}

      {/* Swipe Hints */}
      <div className="flex justify-between mt-6 px-8">
        <button
          type="button"
          onClick={() => handleActionClick('skip')}
          disabled={actionsDisabled}
          className={`text-center focus:outline-none ${
            actionsDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:scale-105 transition-transform'
          }`}
          aria-label="Skip job"
        >
          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-2">
            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <div className="text-xs text-gray-500">Skip</div>
        </button>
        <button
          type="button"
          onClick={() => handleActionClick('apply')}
          disabled={actionsDisabled}
          className={`text-center focus:outline-none ${
            actionsDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:scale-105 transition-transform'
          }`}
          aria-label="Apply to job"
        >
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-2">
            <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="text-xs text-gray-500">Apply</div>
        </button>
      </div>
    </div>
  );
}
