'use client';

import { Profile, ProfileCompletionStatus } from '@/types/profile';
import { getProfileCompletionStatus } from '@/utils/profile';

interface ProfileDisplayProps {
  profile: Profile;
  onEditProfile?: () => void;
  showCompletionStatus?: boolean;
}

export default function ProfileDisplay({
  profile,
  onEditProfile,
  showCompletionStatus = true
}: ProfileDisplayProps) {
  const completionStatus: ProfileCompletionStatus = getProfileCompletionStatus(profile);

  if (!profile || Object.keys(profile).length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">No profile data available</p>
        <p className="text-sm text-gray-400 mt-1">Upload a resume to get started</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
      {/* Header with completion status */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">Profile Overview</h2>
        {onEditProfile && (
          <button
            onClick={onEditProfile}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Edit Profile
          </button>
        )}
      </div>

      {/* Completion Status */}
      {showCompletionStatus && (
        <div className={`p-4 rounded-lg ${completionStatus.isComplete ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}>
          <div className="flex items-center">
            <div className={`w-2 h-2 rounded-full mr-2 ${completionStatus.isComplete ? 'bg-green-500' : 'bg-amber-500'}`}></div>
            <span className={`text-sm font-medium ${completionStatus.isComplete ? 'text-green-800' : 'text-amber-800'}`}>
              {completionStatus.isComplete ? 'Profile Complete' : 'Profile Incomplete'}
            </span>
          </div>
          {!completionStatus.isComplete && completionStatus.criticalFields.length > 0 && (
            <p className="text-sm text-amber-700 mt-1">
              Missing: {completionStatus.criticalFields.join(', ')}
            </p>
          )}
        </div>
      )}

      {/* Basic Information */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ProfileField label="Name" value={profile.name} />
        <ProfileField label="Email" value={profile.email} />
        <ProfileField label="Phone" value={profile.phone} />
        <ProfileField label="Location" value={profile.location} />
      </div>

      {/* Professional Summary */}
      {profile.summary && (
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">Summary</h3>
          <p className="text-gray-700 leading-relaxed">{profile.summary}</p>
        </div>
      )}

      {/* Skills */}
      {profile.skills && profile.skills.length > 0 && (
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-3">Skills</h3>
          <div className="flex flex-wrap gap-2">
            {profile.skills.map((skill, index) => (
              <span
                key={index}
                className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Experience */}
      {profile.experience && profile.experience.length > 0 && (
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-3">Experience</h3>
          <div className="space-y-4">
            {profile.experience.map((exp, index) => (
              <div key={index} className="border-l-2 border-gray-200 pl-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-medium text-gray-900">{exp.position}</h4>
                    <p className="text-blue-600 font-medium">{exp.company}</p>
                    {exp.location && (
                      <p className="text-sm text-gray-500">{exp.location}</p>
                    )}
                  </div>
                  <span className="text-sm text-gray-500 whitespace-nowrap ml-4">
                    {exp.startDate} - {exp.endDate}
                  </span>
                </div>
                {exp.description && (
                  <p className="text-gray-700 text-sm mt-2 leading-relaxed">
                    {exp.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Education */}
      {profile.education && profile.education.length > 0 && (
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-3">Education</h3>
          <div className="space-y-3">
            {profile.education.map((edu, index) => (
              <div key={index} className="border-l-2 border-gray-200 pl-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-medium text-gray-900">{edu.degree} in {edu.field}</h4>
                    <p className="text-blue-600">{edu.institution}</p>
                    {edu.gpa && (
                      <p className="text-sm text-gray-500">GPA: {edu.gpa}</p>
                    )}
                  </div>
                  <span className="text-sm text-gray-500 whitespace-nowrap ml-4">
                    {edu.startDate} - {edu.endDate}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Additional Information */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Languages */}
        {profile.languages && profile.languages.length > 0 && (
          <div>
            <h4 className="font-medium text-gray-900 mb-2">Languages</h4>
            <div className="flex flex-wrap gap-1">
              {profile.languages.map((lang, index) => (
                <span key={index} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-sm">
                  {lang}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Certifications */}
        {profile.certifications && profile.certifications.length > 0 && (
          <div>
            <h4 className="font-medium text-gray-900 mb-2">Certifications</h4>
            <div className="space-y-1">
              {profile.certifications.map((cert, index) => (
                <p key={index} className="text-sm text-gray-700">{cert}</p>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Links */}
      {(profile.linkedinUrl || profile.portfolioUrl) && (
        <div>
          <h4 className="font-medium text-gray-900 mb-2">Links</h4>
          <div className="flex flex-wrap gap-4">
            {profile.linkedinUrl && (
              <a
                href={profile.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 text-sm"
              >
                LinkedIn Profile
              </a>
            )}
            {profile.portfolioUrl && (
              <a
                href={profile.portfolioUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 text-sm"
              >
                Portfolio
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileField({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      <p className="text-gray-900">
        {value || <span className="text-gray-400 italic">Not provided</span>}
      </p>
    </div>
  );
}