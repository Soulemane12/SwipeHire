import { Job } from '@/types/job';
import { Profile } from '@/types/profile';

export interface MatchScore {
  overall: number;
  skillsMatch: number;
  experienceMatch: number;
  locationMatch: number;
  titleMatch: number;
}

export function calculateJobMatch(job: Job, profile: Profile): MatchScore {
  const skillsMatch = calculateSkillsMatch(job, profile);
  const experienceMatch = calculateExperienceMatch(job, profile);
  const locationMatch = calculateLocationMatch(job, profile);
  const titleMatch = calculateTitleMatch(job, profile);

  // Weighted average of different match factors
  const overall = Math.round(
    (skillsMatch * 0.4) +
    (experienceMatch * 0.3) +
    (titleMatch * 0.2) +
    (locationMatch * 0.1)
  );

  return {
    overall: Math.min(100, Math.max(0, overall)),
    skillsMatch,
    experienceMatch,
    locationMatch,
    titleMatch
  };
}

function calculateSkillsMatch(job: Job, profile: Profile): number {
  if (!profile.skills || profile.skills.length === 0) return 0;

  const profileSkills = profile.skills.map(skill => skill.toLowerCase());
  const jobText = (job.title + ' ' + job.description + ' ' + job.requirements.join(' ')).toLowerCase();

  let matchedSkills = 0;
  let totalSkills = profileSkills.length;

  profileSkills.forEach(skill => {
    if (jobText.includes(skill)) {
      matchedSkills++;
    }
  });

  // Check for programming languages specifically
  const programmingLanguages = ['javascript', 'typescript', 'python', 'java', 'react', 'node', 'vue', 'angular'];
  const profileLangs = profileSkills.filter(skill =>
    programmingLanguages.some(lang => skill.includes(lang))
  );
  const jobLangs = programmingLanguages.filter(lang => jobText.includes(lang));

  if (profileLangs.length > 0 && jobLangs.length > 0) {
    const langMatch = profileLangs.filter(lang =>
      jobLangs.some(jobLang => lang.includes(jobLang) || jobLang.includes(lang))
    ).length;
    matchedSkills += langMatch * 2; // Boost for programming language matches
  }

  return Math.min(100, (matchedSkills / totalSkills) * 100);
}

function calculateExperienceMatch(job: Job, profile: Profile): number {
  if (!profile.experience || profile.experience.length === 0) return 30; // Base score for no experience

  const totalExperience = calculateTotalExperience(profile);
  const jobTitle = job.title.toLowerCase();

  // Extract experience requirements from job description
  const experienceRequirement = extractExperienceRequirement(job.description + ' ' + job.requirements.join(' '));

  // Calculate experience match
  let experienceScore = 50; // Base score

  if (experienceRequirement > 0) {
    const experienceRatio = totalExperience / experienceRequirement;
    if (experienceRatio >= 1) {
      experienceScore = 90; // Meets or exceeds requirement
    } else if (experienceRatio >= 0.7) {
      experienceScore = 75; // Close to requirement
    } else if (experienceRatio >= 0.5) {
      experienceScore = 60; // Somewhat close
    } else {
      experienceScore = 40; // Below requirement
    }
  }

  // Boost for relevant titles
  const relevantTitles = ['engineer', 'developer', 'programmer', 'architect', 'lead', 'senior', 'junior'];
  const hasRelevantTitle = profile.experience.some(exp =>
    relevantTitles.some(title => exp.position.toLowerCase().includes(title))
  );

  if (hasRelevantTitle && relevantTitles.some(title => jobTitle.includes(title))) {
    experienceScore += 10;
  }

  return Math.min(100, experienceScore);
}

function calculateLocationMatch(job: Job, profile: Profile): number {
  if (job.remote) return 100; // Remote jobs always match

  if (!profile.location) return 50; // Neutral if no location specified

  const profileLocation = profile.location.toLowerCase();
  const jobLocation = job.location.toLowerCase();

  // Exact match
  if (profileLocation === jobLocation) return 100;

  // City match
  const profileCity = profileLocation.split(',')[0].trim();
  const jobCity = jobLocation.split(',')[0].trim();
  if (profileCity === jobCity) return 90;

  // State/region match
  const profileRegion = profileLocation.split(',').slice(-1)[0].trim();
  const jobRegion = jobLocation.split(',').slice(-1)[0].trim();
  if (profileRegion === jobRegion) return 70;

  return 30; // Different location
}

function calculateTitleMatch(job: Job, profile: Profile): number {
  if (!profile.experience || profile.experience.length === 0) return 50;

  const jobTitle = job.title.toLowerCase();
  const experienceTitles = profile.experience.map(exp => exp.position.toLowerCase());

  // Check for exact title matches
  for (const title of experienceTitles) {
    if (title === jobTitle) return 100;
  }

  // Check for similar titles
  const jobTitleWords = jobTitle.split(' ');
  const titleKeywords = ['engineer', 'developer', 'programmer', 'architect', 'lead', 'senior', 'junior', 'frontend', 'backend', 'fullstack', 'full-stack'];

  let matchScore = 0;
  for (const title of experienceTitles) {
    for (const word of jobTitleWords) {
      if (title.includes(word) && word.length > 2) {
        matchScore += 20;
      }
    }

    for (const keyword of titleKeywords) {
      if (title.includes(keyword) && jobTitle.includes(keyword)) {
        matchScore += 15;
      }
    }
  }

  return Math.min(100, matchScore);
}

function calculateTotalExperience(profile: Profile): number {
  if (!profile.experience || profile.experience.length === 0) return 0;

  let totalMonths = 0;

  profile.experience.forEach(exp => {
    const startDate = parseDate(exp.startDate);
    const endDate = exp.endDate.toLowerCase() === 'present' ? new Date() : parseDate(exp.endDate);

    if (startDate && endDate) {
      const months = (endDate.getFullYear() - startDate.getFullYear()) * 12 +
        (endDate.getMonth() - startDate.getMonth());
      totalMonths += months;
    }
  });

  return totalMonths / 12; // Convert to years
}

function parseDate(dateString: string): Date | null {
  try {
    // Handle "Month Year" format
    const parts = dateString.trim().split(' ');
    if (parts.length === 2) {
      const month = parts[0];
      const year = parseInt(parts[1]);
      const monthIndex = new Date(Date.parse(month + ' 1, 2000')).getMonth();
      return new Date(year, monthIndex);
    }
    return new Date(dateString);
  } catch {
    return null;
  }
}

function extractExperienceRequirement(text: string): number {
  const patterns = [
    /(\d+)\+?\s*years?\s*(?:of\s*)?experience/gi,
    /(\d+)\+?\s*years?\s*(?:of\s*)?(?:professional\s*)?experience/gi,
    /minimum\s*(?:of\s*)?(\d+)\s*years?/gi,
    /(\d+)\+?\s*years?\s*(?:in|with)/gi
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const numbers = match.map(m => {
        const num = m.match(/\d+/);
        return num ? parseInt(num[0]) : 0;
      });
      return Math.max(...numbers);
    }
  }

  return 0; // No experience requirement found
}

export function enhanceJobsWithMatches(jobs: Job[], profile: Profile): Job[] {
  return jobs.map(job => ({
    ...job,
    matchScore: calculateJobMatch(job, profile).overall
  })).sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
}