'use client';

import { useState, useEffect } from 'react';
import ResumeUploader from '@/components/ResumeUploader';
import TextResumeInput from '@/components/TextResumeInput';
import ProfileDisplay from '@/components/ProfileDisplay';
import MissingFieldsModal from '@/components/MissingFieldsModal';
import SwipeDeck from '@/components/SwipeDeck';
import JobDashboard from '@/components/JobDashboard';
import { Profile } from '@/types/profile';
import { Job } from '@/types/job';
import { getProfile, getProfileCompletionStatus } from '@/utils/profile';

export default function Home() {
  const [profile, setProfile] = useState<Profile>({});
  const [showMissingFieldsModal, setShowMissingFieldsModal] = useState(false);
  const [hasUploadedResume, setHasUploadedResume] = useState(false);
  const [error, setError] = useState<string>('');
  const [activeView, setActiveView] = useState<'upload' | 'swipe' | 'dashboard'>('upload');

  useEffect(() => {
    // Load existing profile on mount
    const existingProfile = getProfile();
    setProfile(existingProfile);

    // Check if there's already a profile with basic info
    if (existingProfile.name || existingProfile.email) {
      setHasUploadedResume(true);
      setActiveView('swipe'); // Show job swipe by default if profile exists
    }
  }, []);

  const handleProfileExtracted = (extractedProfile: Profile) => {
    setProfile(extractedProfile);
    setHasUploadedResume(true);
    setActiveView('swipe'); // Switch to job swipe after profile upload

    // Check if profile needs completion
    const completionStatus = getProfileCompletionStatus(extractedProfile);
    if (!completionStatus.isComplete && completionStatus.criticalFields.length > 0) {
      setShowMissingFieldsModal(true);
    }
  };

  const handleUploadError = (errorMessage: string) => {
    setError(errorMessage);
    setTimeout(() => setError(''), 5000); // Clear error after 5 seconds
  };

  const handleProfileUpdated = (updatedProfile: Profile) => {
    setProfile(updatedProfile);
  };

  const handleEditProfile = () => {
    const completionStatus = getProfileCompletionStatus(profile);
    setShowMissingFieldsModal(true);
  };

  const handleJobAction = (job: Job, action: 'applied' | 'skipped') => {
    console.log(`Job ${action}: ${job.title} at ${job.company}`);
    // Additional handling can be added here
  };

  const handleViewJob = (job: Job) => {
    window.open(job.atsUrl, '_blank');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto py-8 px-4">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            SwipeHire
          </h1>
          <p className="text-gray-600">
            {activeView === 'upload'
              ? 'Upload your resume to get started with smart job matching'
              : activeView === 'swipe'
              ? 'Swipe through jobs matched to your profile'
              : 'Track your job applications and manage your pipeline'
            }
          </p>
        </div>

        {/* Navigation */}
        {hasUploadedResume && (
          <div className="flex justify-center mb-8">
            <nav className="bg-white rounded-lg border border-gray-200 p-1">
              <div className="flex space-x-1">
                <button
                  onClick={() => setActiveView('swipe')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    activeView === 'swipe'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Swipe Jobs
                </button>
                <button
                  onClick={() => setActiveView('dashboard')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    activeView === 'dashboard'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Dashboard
                </button>
                <button
                  onClick={() => setActiveView('upload')}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    activeView === 'upload'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Profile
                </button>
              </div>
            </nav>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        {/* Main Content */}
        <div className="space-y-8">
          {/* Job Swipe View */}
          {activeView === 'swipe' && hasUploadedResume && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
              <SwipeDeck
                profile={profile}
                onJobAction={handleJobAction}
              />
            </div>
          )}

          {/* Dashboard View */}
          {activeView === 'dashboard' && hasUploadedResume && (
            <JobDashboard onViewJob={handleViewJob} />
          )}

          {/* Profile/Upload View */}
          {activeView === 'upload' && (
            <div className="space-y-6">
              {!hasUploadedResume ? (
                <>
                  {/* File Upload */}
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
                    <div className="text-center mb-6">
                      <h2 className="text-xl font-semibold text-gray-900 mb-2">
                        Upload Resume File
                      </h2>
                      <p className="text-gray-600">
                        Upload your resume file for automatic parsing
                      </p>
                    </div>
                    <ResumeUploader
                      onProfileExtracted={handleProfileExtracted}
                      onError={handleUploadError}
                    />
                  </div>

                  {/* Text Input Alternative */}
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
                    <TextResumeInput
                      onProfileExtracted={handleProfileExtracted}
                      onError={handleUploadError}
                    />
                  </div>
                </>
              ) : (
                <>
                  {/* Profile Display */}
                  <ProfileDisplay
                    profile={profile}
                    onEditProfile={handleEditProfile}
                  />

                  {/* Upload Another Resume */}
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <div className="text-center">
                      <h3 className="text-lg font-medium text-gray-900 mb-2">
                        Upload Another Resume
                      </h3>
                      <p className="text-gray-600 mb-4">
                        Update your profile with a new resume
                      </p>
                      <ResumeUploader
                        onProfileExtracted={handleProfileExtracted}
                        onError={handleUploadError}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Missing Fields Modal */}
        <MissingFieldsModal
          isOpen={showMissingFieldsModal}
          onClose={() => setShowMissingFieldsModal(false)}
          profile={profile}
          missingFields={getProfileCompletionStatus(profile).missingFields}
          onProfileUpdated={handleProfileUpdated}
        />
      </div>
    </div>
  );
}
