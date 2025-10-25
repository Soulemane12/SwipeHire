'use client';

import { useState, useEffect, useMemo, useCallback, createRef } from 'react';
import TinderCard from 'react-tinder-card';
import JobCard from './JobCard';
import { Job } from '@/types/job';
import { Profile } from '@/types/profile';
import { ATS_COMPANIES, getJobSwipes, saveJobSwipe, getAppliedJobs, getSkippedJobs, deduplicateJobs } from '@/lib/jobs';
import { fetchJobsFromATS } from '@/services/ats';
import { enhanceJobsWithMatches, calculateJobMatch } from '@/services/matching';

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

export default function SwipeDeck({ profile, onJobAction }: SwipeDeckProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [lastDirection, setLastDirection] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [applyStatus, setApplyStatus] = useState<string | null>(null);
  const [isAutoApplying, setIsAutoApplying] = useState(false);

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

  const autoApply = useCallback(async (job: Job) => {
    if (job.atsProvider !== 'ashby') {
      saveJobSwipe(job.id, 'applied');
      onJobAction?.(job, 'applied');
      // Remove the job from the deck for non-Ashby jobs too
      setJobs(prevJobs => prevJobs.filter(j => j.id !== job.id));
      return;
    }

    const { firstName, lastName } = getNameParts(profile);
    const email = profile.email;
    const resumePath = profile.resumePath || FALLBACK_RESUME_PATH;

    if (!firstName || !lastName || !email || !resumePath) {
      setApplyStatus('Add your name, email, and resume path to auto-apply.');
      return;
    }

    if (isAutoApplying) {
      setApplyStatus('Finishing the previous application...');
      return;
    }

    setIsAutoApplying(true);
    setApplyStatus(`Applying to ${job.title} at ${job.company}...`);

    try {
      const payload = {
        jobUrl: job.atsUrl,
        profile: {
          firstName,
          lastName,
          email,
          phone: profile.phone,
          location: profile.location,
          linkedin: profile.linkedinUrl,
          website: profile.portfolioUrl,
          github: profile.githubUrl,
          workAuth: profile.workAuth,
          coverLetter: profile.coverLetter
        },
        resumePath,
        mode: 'auto' as const
      };

      const response = await fetch('/api/apply-ashby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok && data?.ok) {
        saveJobSwipe(job.id, 'applied');
        onJobAction?.(job, 'applied');
        // Remove the job from the deck after successful application
        setJobs(prevJobs => prevJobs.filter(j => j.id !== job.id));
        setApplyStatus(
          data.successText
            ? `Submitted: ${data.successText}`
            : `Submitted application to ${job.company}.`
        );
      } else {
        const message = data?.error || `HTTP ${response.status}`;
        setApplyStatus(`Failed to apply: ${message}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setApplyStatus(`Failed to apply: ${message}`);
    } finally {
      setIsAutoApplying(false);
    }
  }, [profile, isAutoApplying, onJobAction]);

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
    setLastDirection(direction);

    if (direction === 'right') {
      void autoApply(job);
    } else {
      saveJobSwipe(job.id, 'skipped');
      onJobAction?.(job, 'skipped');
    }

    // Remove the swiped job from the current jobs array immediately
    setJobs(prevJobs => prevJobs.filter(j => j.id !== job.id));

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

  const actionsDisabled = currentIndex < 0 || isAutoApplying;

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
      <div className="flex justify-center space-x-6 mb-6 text-sm text-gray-600">
        <div className="text-center">
          <div className="font-semibold text-gray-900">{getAppliedJobs().length}</div>
          <div>Applied</div>
        </div>
        <div className="text-center">
          <div className="font-semibold text-gray-900">{getSkippedJobs().length}</div>
          <div>Skipped</div>
        </div>
        <div className="text-center">
          <div className="font-semibold text-gray-900">{Math.max(currentIndex + 1, 0)}</div>
          <div>Remaining</div>
        </div>
      </div>

      {/* Instructions */}
      <div className="text-center mb-6">
        <p className="text-sm text-gray-600">
          Swipe right to auto-apply • Swipe left to skip
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
      {lastDirection && (
        <div className="text-center mt-4">
          <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
            lastDirection === 'right'
              ? 'bg-green-100 text-green-800'
              : 'bg-gray-100 text-gray-800'
          }`}>
            {lastDirection === 'right' ? (
              <>
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Applied
              </>
            ) : (
              <>
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Skipped
              </>
            )}
          </div>
        </div>
      )}

      {applyStatus && (
        <div
          className={`text-center mt-4 text-sm ${
            applyStatus.toLowerCase().includes('failed') ? 'text-red-600' : 'text-blue-600'
          }`}
        >
          {isAutoApplying && <span className="animate-pulse mr-1">•</span>}
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
