export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  requirements: string[];
  salaryRange?: string;
  employmentType: 'full-time' | 'part-time' | 'contract' | 'internship';
  remote: boolean;
  atsUrl: string;
  atsProvider: 'greenhouse' | 'lever' | 'ashby';
  postedDate: string;
  matchScore?: number;
}

export interface JobSwipeData {
  jobId: string;
  action: 'applied' | 'skipped';
  timestamp: string;
}

export interface JobFilters {
  location?: string;
  remote?: boolean;
  employmentType?: string[];
  salaryMin?: number;
  salaryMax?: number;
}

export interface ATSCompany {
  name: string;
  atsProvider: 'greenhouse' | 'lever' | 'ashby';
  companyId: string;
  baseUrl: string;
}