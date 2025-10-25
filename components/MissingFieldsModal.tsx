'use client';

import { useState, useEffect } from 'react';
import { Profile } from '@/types/profile';
import { updateProfile } from '@/utils/profile';

interface MissingFieldsModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: Profile;
  missingFields: string[];
  onProfileUpdated?: (updatedProfile: Profile) => void;
}

export default function MissingFieldsModal({
  isOpen,
  onClose,
  profile,
  missingFields,
  onProfileUpdated
}: MissingFieldsModalProps) {
  const [formData, setFormData] = useState<Partial<Profile>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Initialize form with current profile data
      setFormData(profile);
    }
  }, [isOpen, profile]);

  if (!isOpen) return null;

  const handleInputChange = (field: keyof Profile, value: string | string[]) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSkillsChange = (value: string) => {
    const skills = value.split(',').map(skill => skill.trim()).filter(skill => skill.length > 0);
    handleInputChange('skills', skills);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updatedProfile = updateProfile(formData);
      onProfileUpdated?.(updatedProfile);
      onClose();
    } catch (error) {
      console.error('Error saving profile:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const renderField = (field: string) => {
    switch (field) {
      case 'name':
        return (
          <div key={field}>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Full Name *
            </label>
            <input
              type="text"
              value={formData.name || ''}
              onChange={(e) => handleInputChange('name', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Enter your full name"
              required
            />
          </div>
        );

      case 'email':
        return (
          <div key={field}>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email Address *
            </label>
            <input
              type="email"
              value={formData.email || ''}
              onChange={(e) => handleInputChange('email', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Enter your email address"
              required
            />
          </div>
        );

      case 'phone':
        return (
          <div key={field}>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Phone Number
            </label>
            <input
              type="tel"
              value={formData.phone || ''}
              onChange={(e) => handleInputChange('phone', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Enter your phone number"
            />
          </div>
        );

      case 'location':
        return (
          <div key={field}>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Location
            </label>
            <input
              type="text"
              value={formData.location || ''}
              onChange={(e) => handleInputChange('location', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="City, State/Country"
            />
          </div>
        );

      case 'skills':
        return (
          <div key={field}>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Skills
            </label>
            <textarea
              value={formData.skills?.join(', ') || ''}
              onChange={(e) => handleSkillsChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 h-20 resize-none"
              placeholder="Enter skills separated by commas (e.g., JavaScript, React, Node.js)"
            />
            <p className="text-xs text-gray-500 mt-1">
              Separate skills with commas
            </p>
          </div>
        );

      case 'summary':
        return (
          <div key={field}>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Professional Summary
            </label>
            <textarea
              value={formData.summary || ''}
              onChange={(e) => handleInputChange('summary', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 h-24 resize-none"
              placeholder="Brief professional summary..."
            />
          </div>
        );

      case 'linkedinUrl':
        return (
          <div key={field}>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              LinkedIn Profile
            </label>
            <input
              type="url"
              value={formData.linkedinUrl || ''}
              onChange={(e) => handleInputChange('linkedinUrl', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="https://linkedin.com/in/yourprofile"
            />
          </div>
        );

      case 'portfolioUrl':
        return (
          <div key={field}>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Portfolio/Website
            </label>
            <input
              type="url"
              value={formData.portfolioUrl || ''}
              onChange={(e) => handleInputChange('portfolioUrl', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="https://yourportfolio.com"
            />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">
              Complete Your Profile
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <p className="text-gray-600 text-sm mb-6">
            Please fill in the missing information to improve your job matching experience.
          </p>

          <div className="space-y-4">
            {missingFields.map(field => renderField(field))}
          </div>

          <div className="flex justify-end space-x-3 mt-6 pt-4 border-t border-gray-200">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
              disabled={isSaving}
            >
              Skip for Now
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isSaving}
            >
              {isSaving ? (
                <div className="flex items-center">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                  Saving...
                </div>
              ) : (
                'Save Profile'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}