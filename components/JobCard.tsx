'use client';

import { Job } from '@/types/job';

interface JobCardProps {
  job: Job;
}

export default function JobCard({ job }: JobCardProps) {
  const getMatchScoreColor = (score?: number) => {
    if (!score) return 'text-gray-500';
    if (score >= 80) return 'text-green-500';
    if (score >= 60) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getMatchScoreText = (score?: number) => {
    if (!score) return 'No Score';
    if (score >= 80) return 'Great Match';
    if (score >= 60) return 'Good Match';
    if (score >= 40) return 'Partial Match';
    return 'Low Match';
  };

  return (
    <div
      className="bg-white rounded-xl shadow-lg border border-gray-200 h-full flex flex-col max-w-sm mx-auto cursor-pointer hover:shadow-xl transition-shadow duration-200"
      onClick={() => window.open(job.atsUrl, '_blank')}
    >
      {/* Header */}
      <div className="p-6 border-b border-gray-100">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <h3 className="text-xl font-bold text-gray-900 mb-1 line-clamp-2">
              {job.title}
            </h3>
            <p className="text-lg text-blue-600 font-medium mb-2">
              {job.company}
            </p>
          </div>
          {job.matchScore !== undefined && (
            <div className="text-right ml-3">
              <div className={`text-2xl font-bold ${getMatchScoreColor(job.matchScore)}`}>
                {job.matchScore}%
              </div>
              <div className={`text-xs ${getMatchScoreColor(job.matchScore)}`}>
                {getMatchScoreText(job.matchScore)}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2 text-sm text-gray-600">
          <div className="flex items-center">
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>{job.location}</span>
            {job.remote && (
              <span className="ml-2 px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                Remote
              </span>
            )}
          </div>

          <div className="flex items-center">
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2-2v2m8 0V6a2 2 0 00-2 2H8a2 2 0 00-2-2V6m8 0h4a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2h4" />
            </svg>
            <span className="capitalize">{job.employmentType.replace('-', ' ')}</span>
          </div>

          {job.salaryRange && (
            <div className="flex items-center">
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
              <span>{job.salaryRange}</span>
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="flex-1 p-6">
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-gray-900 mb-2">Job Description</h4>
          <p className="text-sm text-gray-600 line-clamp-4">
            {job.description}
          </p>
        </div>

        {job.requirements.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-gray-900 mb-2">Key Requirements</h4>
            <ul className="text-sm text-gray-600 space-y-1">
              {job.requirements.slice(0, 4).map((req, index) => (
                <li key={index} className="flex items-start">
                  <span className="text-blue-400 mr-2 mt-1">•</span>
                  <span className="line-clamp-1">{req}</span>
                </li>
              ))}
              {job.requirements.length > 4 && (
                <li className="text-gray-400 text-xs">
                  +{job.requirements.length - 4} more requirements
                </li>
              )}
            </ul>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-6 border-t border-gray-100">
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-500">
            Posted {new Date(job.postedDate).toLocaleDateString()}
          </div>
          <div className="flex items-center text-xs text-gray-500">
            <span className="capitalize">{job.atsProvider}</span>
            <svg className="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
