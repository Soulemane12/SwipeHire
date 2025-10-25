import { Profile, ProfileCompletionStatus } from '@/types/profile';

const STORAGE_KEY = 'swipehire_profile';

export function getProfile(): Profile {
  if (typeof window === 'undefined') return {};

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.error('Error reading profile from localStorage:', error);
    return {};
  }
}

export function saveProfile(profile: Profile): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch (error) {
    console.error('Error saving profile to localStorage:', error);
  }
}

export function updateProfile(updates: Partial<Profile>): Profile {
  const currentProfile = getProfile();
  const updatedProfile = { ...currentProfile, ...updates };
  saveProfile(updatedProfile);
  return updatedProfile;
}

export function clearProfile(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Error clearing profile from localStorage:', error);
  }
}

export function getProfileCompletionStatus(profile: Profile): ProfileCompletionStatus {
  const criticalFields = ['name', 'email'];
  const optionalFields = ['phone', 'skills', 'experience'];

  const missingCritical = criticalFields.filter(field => !profile[field as keyof Profile]);
  const missingOptional = optionalFields.filter(field => {
    const value = profile[field as keyof Profile];
    return !value || (Array.isArray(value) && value.length === 0);
  });

  const allMissing = [...missingCritical, ...missingOptional];

  return {
    isComplete: missingCritical.length === 0,
    missingFields: allMissing,
    criticalFields: missingCritical
  };
}