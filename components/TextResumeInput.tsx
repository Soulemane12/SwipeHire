'use client';

import { useState } from 'react';
import { extractProfileFromText } from '@/services/groq';
import { updateProfile } from '@/utils/profile';
import { Profile } from '@/types/profile';

interface TextResumeInputProps {
  onProfileExtracted?: (profile: Profile) => void;
  onError?: (error: string) => void;
}

export default function TextResumeInput({ onProfileExtracted, onError }: TextResumeInputProps) {
  const [resumeText, setResumeText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<'idle' | 'extracting' | 'success' | 'error'>('idle');

  const handleSubmit = async () => {
    if (!resumeText.trim()) {
      onError?.('Please enter your resume text');
      return;
    }

    setIsProcessing(true);
    setStatus('extracting');

    try {
      // Extract profile data using Groq
      const extractedProfile = await extractProfileFromText(resumeText);

      // Save to localStorage
      const savedProfile = updateProfile(extractedProfile);

      setStatus('success');
      onProfileExtracted?.(savedProfile);
    } catch (error) {
      console.error('Error extracting profile from text:', error);
      setStatus('error');
      const errorMessage = error instanceof Error ? error.message : 'Failed to process resume text';
      onError?.(errorMessage);
    } finally {
      setIsProcessing(false);
    }
  };

  const getStatusMessage = () => {
    switch (status) {
      case 'extracting':
        return 'Extracting profile information...';
      case 'success':
        return 'Resume processed successfully!';
      case 'error':
        return 'Error processing resume';
      default:
        return '';
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'extracting':
        return 'text-blue-600';
      case 'success':
        return 'text-green-600';
      case 'error':
        return 'text-red-600';
      default:
        return '';
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="mb-4">
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Paste Resume Text
          </h3>
          <p className="text-sm text-gray-600">
            Copy and paste your resume content below for instant parsing
          </p>
        </div>

        <div className="space-y-4">
          <textarea
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
            placeholder="Paste your resume text here...

Example:
John Smith
Software Engineer
john.smith@email.com
(555) 123-4567

EXPERIENCE
Senior Developer
TechCorp (2022-Present)
- Led development of web applications
- Worked with React, Node.js, and AWS

SKILLS
JavaScript, React, Node.js, Python, AWS, Docker"
            className="w-full h-64 px-3 py-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            disabled={isProcessing}
          />

          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500">
              {resumeText.length} characters
            </div>

            <button
              onClick={handleSubmit}
              disabled={isProcessing || !resumeText.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProcessing ? (
                <div className="flex items-center">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                  Processing...
                </div>
              ) : (
                'Parse Resume'
              )}
            </button>
          </div>

          {status !== 'idle' && (
            <div className={`text-center text-sm font-medium ${getStatusColor()}`}>
              {getStatusMessage()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}