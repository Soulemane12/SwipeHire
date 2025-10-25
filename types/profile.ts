export interface ExperienceItem {
  company: string;
  position: string;
  startDate: string;
  endDate: string;
  description: string;
  location?: string;
}

export interface EducationItem {
  institution: string;
  degree: string;
  field: string;
  startDate: string;
  endDate: string;
  gpa?: string;
}

export interface Profile {
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  summary?: string;
  skills?: string[];
  experience?: ExperienceItem[];
  education?: EducationItem[];
  languages?: string[];
  certifications?: string[];
  linkedinUrl?: string;
  portfolioUrl?: string;
  githubUrl?: string;
  workAuth?: string;
  coverLetter?: string;
  resumePath?: string;
  willingToRelocate?: boolean;
  understandsAnchorDays?: boolean;
  requiresSponsorship?: boolean;
}

export interface ProfileCompletionStatus {
  isComplete: boolean;
  missingFields: string[];
  criticalFields: string[];
}
