'use client';

import { useState, useRef } from 'react';
import { extractProfileFromText } from '@/services/groq';
import { updateProfile } from '@/utils/profile';
import { Profile } from '@/types/profile';

interface ResumeUploaderProps {
  onProfileExtracted?: (profile: Profile) => void;
  onError?: (error: string) => void;
}

export default function ResumeUploader({ onProfileExtracted, onError }: ResumeUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'parsing' | 'extracting' | 'success' | 'error'>('idle');
  const [extractedText, setExtractedText] = useState<string>('');
  const [pdfReady, setPdfReady] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadStatus('parsing');

    try {
      let text = '';

      if (file.type === 'application/pdf') {
        text = await parsePDF(file);
      } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                 file.type === 'application/msword') {
        text = await parseDocx(file);
      } else if (file.type === 'text/plain') {
        text = await parseTextFile(file);
      } else {
        throw new Error('Unsupported file type. Please upload a PDF, DOCX, or TXT file.');
      }

      if (!text.trim()) {
        throw new Error('No text content found in the file. Please check your file and try again.');
      }

      setExtractedText(text);
      setUploadStatus('extracting');

      // Extract profile data using Groq
      const extractedProfile = await extractProfileFromText(text);

      // Save to localStorage
      const savedProfile = updateProfile(extractedProfile);

      setUploadStatus('success');
      onProfileExtracted?.(savedProfile);

    } catch (error) {
      console.error('Error processing resume:', error);
      setUploadStatus('error');
      const errorMessage = error instanceof Error ? error.message : 'Failed to process resume';
      onError?.(errorMessage);
    } finally {
      setIsUploading(false);
    }
  };

  const parsePDF = async (file: File): Promise<string> => {
    try {
      // Dynamic import of PDF.js only when needed
      const pdfjsLib = await import('pdfjs-dist');

      // Configure worker
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

      // Read file as array buffer
      const arrayBuffer = await file.arrayBuffer();

      // Load PDF document
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;

      let fullText = '';

      // Extract text from each page
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();

        // Combine text items into a single string
        const pageText = textContent.items
          .map((item: any) => {
            // Handle different text item types
            if (typeof item === 'string') {
              return item;
            }
            return item.str || '';
          })
          .join(' ');

        fullText += pageText + '\n';
      }

      const text = fullText.trim();
      if (!text) {
        throw new Error('No text content found in the PDF. The file might be an image-based PDF or corrupted.');
      }

      // Mark PDF as ready for UI
      setPdfReady(true);
      return text;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to parse PDF file';
      throw new Error(errorMessage);
    }
  };

  const parseDocx = async (file: File): Promise<string> => {
    return new Promise(async (resolve, reject) => {
      try {
        // Only import mammoth when actually needed (client-side)
        if (typeof window === 'undefined') {
          reject(new Error('DOCX parsing only available in browser'));
          return;
        }

        const mammoth = await import('mammoth');

        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const arrayBuffer = e.target?.result as ArrayBuffer;

            // Use mammoth.js to extract text from DOCX
            const result = await mammoth.extractRawText({ arrayBuffer });
            resolve(result.value);
          } catch (error) {
            console.error('DOCX parsing error:', error);
            reject(new Error('Failed to parse DOCX file'));
          }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(file);
      } catch (error) {
        console.error('Failed to load mammoth.js:', error);
        reject(new Error('Failed to load DOCX parser'));
      }
    });
  };

  const parseTextFile = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        resolve(text);
      };
      reader.onerror = () => reject(new Error('Failed to read text file'));
      reader.readAsText(file);
    });
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const getStatusMessage = () => {
    switch (uploadStatus) {
      case 'parsing':
        return 'Parsing document...';
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
    switch (uploadStatus) {
      case 'parsing':
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
    <div className="w-full max-w-md mx-auto">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.doc,.txt"
        onChange={handleFileSelect}
        className="hidden"
        disabled={isUploading}
      />

      <div
        onClick={triggerFileSelect}
        className={`
          border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
          ${isUploading
            ? 'border-gray-300 bg-gray-50 cursor-not-allowed'
            : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'
          }
        `}
      >
        <div className="flex flex-col items-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
            {isUploading ? (
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            )}
          </div>

          <div>
            <p className="text-lg font-medium text-gray-900">
              {isUploading ? 'Processing...' : 'Upload Resume'}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              {isUploading ? getStatusMessage() : 'PDF, DOCX, or TXT files'}
            </p>
          </div>

          {!isUploading && (
            <button
              type="button"
              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Choose File
            </button>
          )}
        </div>
      </div>

      {uploadStatus !== 'idle' && (
        <div className={`mt-4 text-center text-sm font-medium ${getStatusColor()}`}>
          {getStatusMessage()}
        </div>
      )}

      {extractedText && process.env.NODE_ENV === 'development' && (
        <details className="mt-4">
          <summary className="text-sm text-gray-600 cursor-pointer">
            View extracted text (debug)
          </summary>
          <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-auto max-h-32">
            {extractedText}
          </pre>
        </details>
      )}
    </div>
  );
}