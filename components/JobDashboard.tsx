'use client';

import { useState, useEffect } from 'react';
import { Job } from '@/types/job';
import { getJobSwipes, getAppliedJobs, getSkippedJobs, fetchRealJobs } from '@/lib/jobs';

interface JobDashboardProps {
  onViewJob?: (job: Job) => void;
}

export default function JobDashboard({ onViewJob }: JobDashboardProps) {
  const [activeTab, setActiveTab] = useState<'applied' | 'skipped'>('applied');
  const [appliedJobIds, setAppliedJobIds] = useState<string[]>([]);
  const [skippedJobIds, setSkippedJobIds] = useState<string[]>([]);
  const [allJobs, setAllJobs] = useState<Job[]>([]);

  useEffect(() => {
    loadSwipeData();
    loadAllJobs();
  }, []);

  const loadSwipeData = () => {
    setAppliedJobIds(getAppliedJobs());
    setSkippedJobIds(getSkippedJobs());
  };

  const loadAllJobs = async () => {
    try {
      const realJobs = await fetchRealJobs();
      setAllJobs(realJobs);
    } catch (error) {
      console.error('Error loading jobs for dashboard:', error);
      setAllJobs([]);
    }
  };

  const getJobDetails = (jobId: string): Job | undefined => {
    return allJobs.find(job => job.id === jobId);
  };

  const appliedJobs = appliedJobIds.map(getJobDetails).filter(Boolean) as Job[];
  const skippedJobs = skippedJobIds.map(getJobDetails).filter(Boolean) as Job[];

  const JobList = ({ jobs, emptyMessage }: { jobs: Job[], emptyMessage: string }) => (
    <div className="space-y-4">
      {jobs.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-gray-600">{emptyMessage}</p>
        </div>
      ) : (
        jobs.map(job => (
          <div
            key={job.id}
            className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
            onClick={() => onViewJob?.(job)}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 mb-1">{job.title}</h3>
                <p className="text-blue-600 font-medium mb-2">{job.company}</p>
                <div className="flex items-center text-sm text-gray-600 space-x-4">
                  <div className="flex items-center">
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    {job.location}
                  </div>
                  {job.remote && (
                    <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                      Remote
                    </span>
                  )}
                  <div className="capitalize">{job.employmentType.replace('-', ' ')}</div>
                </div>
                {job.salaryRange && (
                  <div className="text-sm text-gray-600 mt-1">{job.salaryRange}</div>
                )}
                {job.matchScore && (
                  <div className="mt-2">
                    <span className={`text-sm font-medium ${
                      job.matchScore >= 80 ? 'text-green-600' :
                      job.matchScore >= 60 ? 'text-yellow-600' : 'text-red-600'
                    }`}>
                      {job.matchScore}% Match
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center space-x-2 ml-4">
                <a
                  href={job.atsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 text-gray-400 hover:text-blue-600 transition-colors"
                  onClick={e => e.stopPropagation()}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Job Applications</h2>
        <p className="text-gray-600">Track your job applications and manage your pipeline</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center mr-3">
              <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{appliedJobs.length}</div>
              <div className="text-sm text-gray-600">Applications Sent</div>
            </div>
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center mr-3">
              <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{skippedJobs.length}</div>
              <div className="text-sm text-gray-600">Jobs Skipped</div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="border-b border-gray-200">
          <nav className="flex">
            <button
              onClick={() => setActiveTab('applied')}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'applied'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Applied ({appliedJobs.length})
            </button>
            <button
              onClick={() => setActiveTab('skipped')}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'skipped'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Skipped ({skippedJobs.length})
            </button>
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'applied' && (
            <JobList
              jobs={appliedJobs}
              emptyMessage="No applications sent yet. Start swiping to apply to jobs!"
            />
          )}
          {activeTab === 'skipped' && (
            <JobList
              jobs={skippedJobs}
              emptyMessage="No jobs skipped yet."
            />
          )}
        </div>
      </div>

      {/* Refresh Button */}
      <div className="mt-6 text-center">
        <button
          onClick={loadSwipeData}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Refresh Data
        </button>
      </div>
    </div>
  );
}