import { Job, ATSCompany } from '@/types/job';

// Greenhouse API integration
export async function fetchGreenhouseJobs(companyId: string): Promise<Job[]> {
  try {
    const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${companyId}/jobs`);

    if (!response.ok) {
      throw new Error(`Greenhouse API error: ${response.status}`);
    }

    const data = await response.json();

    return data.jobs?.map((job: any) => ({
      id: job.id.toString(),
      title: job.title,
      company: job.company?.name || companyId,
      location: job.location?.name || 'Not specified',
      description: job.content || 'No description available',
      requirements: extractRequirements(job.content || ''),
      salaryRange: undefined, // Greenhouse doesn't typically expose salary in public API
      employmentType: 'full-time', // Default assumption
      remote: job.location?.name?.toLowerCase().includes('remote') || false,
      atsUrl: job.absolute_url,
      atsProvider: 'greenhouse' as const,
      postedDate: job.updated_at?.split('T')[0] || new Date().toISOString().split('T')[0]
    })) || [];
  } catch (error) {
    console.error('Error fetching Greenhouse jobs:', error);
    return [];
  }
}

// Lever API integration
export async function fetchLeverJobs(companyId: string): Promise<Job[]> {
  try {
    const response = await fetch(`https://api.lever.co/v0/postings/${companyId}?mode=json`);

    if (!response.ok) {
      throw new Error(`Lever API error: ${response.status}`);
    }

    const data = await response.json();

    return data.map((job: any) => ({
      id: job.id,
      title: job.text,
      company: job.categories?.team || companyId,
      location: job.categories?.location || 'Not specified',
      description: job.description || job.descriptionPlain || 'No description available',
      requirements: extractRequirements(job.description || job.descriptionPlain || ''),
      salaryRange: undefined,
      employmentType: job.categories?.commitment?.toLowerCase().replace(' ', '-') || 'full-time',
      remote: job.categories?.location?.toLowerCase().includes('remote') ||
             job.workplaceType?.toLowerCase().includes('remote') || false,
      atsUrl: job.hostedUrl || job.applyUrl,
      atsProvider: 'lever' as const,
      postedDate: new Date(job.createdAt).toISOString().split('T')[0]
    }));
  } catch (error) {
    console.error('Error fetching Lever jobs:', error);
    return [];
  }
}

// Ashby API integration
export async function fetchAshbyJobs(jobsPageName: string): Promise<Job[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${jobsPageName}?includeCompensation=true`;
  console.log(`🔍 Fetching Ashby jobs for ${jobsPageName}:`, url);

  try {
    const response = await fetch(url);
    console.log(`📡 ${jobsPageName} response status:`, response.status, response.statusText);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => null);
      console.error(`❌ Ashby API error for ${jobsPageName}:`, response.status, response.statusText);
      console.error(`❌ Failed URL:`, url);
      if (errorBody !== null) {
        console.log(`📝 ${jobsPageName} error body:`, errorBody);
      } else {
        console.log(`📝 ${jobsPageName} error body: <unavailable>`);
      }
      return [];
    }

    const data = await response.json();
    console.log(`📊 ${jobsPageName} response data:`, {
      hasJobs: !!data.jobs,
      jobCount: data.jobs?.length || 0,
      hasJobPostings: !!data.jobPostings,
      jobPostingsCount: data.jobPostings?.length || 0,
      dataKeys: Object.keys(data)
    });

    // Handle both possible response formats
    const jobs = data.jobs || data.jobPostings || [];

    if (jobs.length === 0) {
      console.warn(`⚠️ No jobs found for ${jobsPageName}`);
      return [];
    }

    const mappedJobs = jobs.map((job: any) => {
      const rawDate = job.publishedDate || job.updatedAt || job.createdAt;
      const parsedDate = rawDate ? new Date(rawDate) : new Date();
      const safeDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;

      return {
        id: job.id,
        title: job.title,
        company: job.departmentName || jobsPageName,
        location: job.locationName || 'Not specified',
        description: job.descriptionPlain || job.description || 'No description available',
        requirements: extractRequirements(job.descriptionPlain || job.description || ''),
        salaryRange: job.compensationTierSummary || undefined,
        employmentType: job.employmentType?.toLowerCase().replace(' ', '-') || 'full-time',
        remote: job.locationName?.toLowerCase().includes('remote') ||
               job.isRemote || false,
        atsUrl: job.jobUrl || job.applyUrl,
        atsProvider: 'ashby' as const,
        postedDate: safeDate.toISOString().split('T')[0]
      };
    });

    console.log(`✅ Successfully mapped ${mappedJobs.length} jobs for ${jobsPageName}`);
    return mappedJobs;
  } catch (error) {
    console.error(`❌ Error fetching Ashby jobs for ${jobsPageName}:`, error);
    return [];
  }
}

// Generic ATS job fetcher
export async function fetchJobsFromATS(company: ATSCompany): Promise<Job[]> {
  switch (company.atsProvider) {
    case 'greenhouse':
      return fetchGreenhouseJobs(company.companyId);
    case 'lever':
      return fetchLeverJobs(company.companyId);
    case 'ashby':
      return fetchAshbyJobs(company.companyId);
    default:
      console.warn(`Unknown ATS provider: ${company.atsProvider}`);
      return [];
  }
}

// Fetch jobs from multiple companies
export async function fetchAllJobs(companies: ATSCompany[]): Promise<Job[]> {
  const jobPromises = companies.map(company =>
    fetchJobsFromATS(company).catch(error => {
      console.error(`Failed to fetch jobs from ${company.name}:`, error);
      return [];
    })
  );

  const jobArrays = await Promise.all(jobPromises);
  return jobArrays.flat();
}

// Utility function to extract requirements from job description
function extractRequirements(description: string): string[] {
  const requirements: string[] = [];

  // Common patterns for requirements
  const patterns = [
    /(?:requirements?|qualifications?|you (?:have|bring)|skills?)[:\s]*([^\.]+)/gi,
    /(?:experience (?:with|in)|proficiency (?:with|in)|knowledge of)[:\s]*([^\.]+)/gi,
    /(?:\d+\+?\s*years?)[^\.]+/gi,
    /(?:bachelor|master|phd|degree)[^\.]+/gi
  ];

  patterns.forEach(pattern => {
    const matches = description.match(pattern);
    if (matches) {
      matches.forEach(match => {
        const cleaned = match.replace(/^[^a-zA-Z]*/, '').trim();
        if (cleaned.length > 10 && cleaned.length < 200) {
          requirements.push(cleaned);
        }
      });
    }
  });

  // Extract bullet points
  const bulletPattern = /[•\-\*]\s*([^\n\r]+)/g;
  let match;
  while ((match = bulletPattern.exec(description)) !== null) {
    const requirement = match[1].trim();
    if (requirement.length > 10 && requirement.length < 200) {
      requirements.push(requirement);
    }
  }

  return requirements.slice(0, 8); // Limit to 8 requirements
}

// Job application automation (placeholder for Playwright integration)
export async function applyToJob(job: Job, profileData: any): Promise<boolean> {
  try {
    console.log(`Would apply to ${job.title} at ${job.company}`);
    console.log(`ATS URL: ${job.atsUrl}`);

    // This would use Playwright to automate the application process
    // Implementation would depend on each ATS provider's form structure

    return true; // Placeholder success
  } catch (error) {
    console.error('Error applying to job:', error);
    return false;
  }
}
