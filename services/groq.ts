import Groq from 'groq-sdk';
import { Profile } from '@/types/profile';

const groq = new Groq({
  apiKey: process.env.NEXT_PUBLIC_GROQ_API_KEY,
  dangerouslyAllowBrowser: true
});

// JSON Schema for structured outputs
const profileSchema = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description: "Full name of the person"
    },
    email: {
      type: "string",
      description: "Email address"
    },
    phone: {
      type: "string",
      description: "Phone number"
    },
    location: {
      type: "string",
      description: "Location (city, state/country)"
    },
    summary: {
      type: "string",
      description: "Brief professional summary"
    },
    skills: {
      type: "array",
      items: { type: "string" },
      description: "List of skills and technologies"
    },
    experience: {
      type: "array",
      items: {
        type: "object",
        properties: {
          company: { type: "string", description: "Company name" },
          position: { type: "string", description: "Job title/position" },
          startDate: { type: "string", description: "Start date (Month Year format)" },
          endDate: { type: "string", description: "End date (Month Year or Present)" },
          description: { type: "string", description: "Role description and achievements" },
          location: { type: "string", description: "Work location" }
        },
        required: ["company", "position", "startDate", "endDate", "description"],
        additionalProperties: false
      }
    },
    education: {
      type: "array",
      items: {
        type: "object",
        properties: {
          institution: { type: "string", description: "Educational institution name" },
          degree: { type: "string", description: "Degree type" },
          field: { type: "string", description: "Field of study" },
          startDate: { type: "string", description: "Start date (Month Year format)" },
          endDate: { type: "string", description: "End date (Month Year format)" },
          gpa: { type: "string", description: "GPA if mentioned" }
        },
        required: ["institution", "degree", "field", "startDate", "endDate"],
        additionalProperties: false
      }
    },
    languages: {
      type: "array",
      items: { type: "string" },
      description: "Languages spoken"
    },
    certifications: {
      type: "array",
      items: { type: "string" },
      description: "Professional certifications"
    },
    linkedinUrl: {
      type: "string",
      description: "LinkedIn profile URL"
    },
    portfolioUrl: {
      type: "string",
      description: "Portfolio or personal website URL"
    }
  },
  required: [],
  additionalProperties: false
};

export async function extractProfileFromText(resumeText: string): Promise<Profile> {
  try {
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `You are a resume parsing expert. Extract structured profile information from resume text and return ONLY valid JSON.

IMPORTANT: Your response must be valid JSON only. No additional text, explanations, or markdown formatting.

JSON Schema Format:
{
  "name": "string",
  "email": "string",
  "phone": "string",
  "location": "string",
  "summary": "string",
  "skills": ["skill1", "skill2"],
  "experience": [
    {
      "company": "string",
      "position": "string",
      "startDate": "Month Year",
      "endDate": "Month Year or Present",
      "description": "string",
      "location": "string"
    }
  ],
  "education": [
    {
      "institution": "string",
      "degree": "string",
      "field": "string",
      "startDate": "Month Year",
      "endDate": "Month Year",
      "gpa": "string"
    }
  ],
  "languages": ["language1"],
  "certifications": ["cert1"],
  "linkedinUrl": "string",
  "portfolioUrl": "string"
}

Rules:
- Extract only information clearly present in the text
- Use empty string for missing text fields, empty arrays for missing list fields
- For dates, use "Month Year" format (e.g., "January 2023")
- Skills should be individual technologies/competencies
- Return valid JSON only - no markdown, no explanations`
        },
        {
          role: "user",
          content: `Extract profile information from this resume text and return ONLY valid JSON:\n\n${resumeText}`
        }
      ],
      response_format: {
        type: "json_object"
      },
      temperature: 0.1,
      max_completion_tokens: 2000
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from Groq');
    }

    try {
      const parsedProfile = JSON.parse(content);
      return parsedProfile;
    } catch (parseError) {
      console.error('Failed to parse Groq response as JSON:', parseError);
      console.error('Raw response:', content);
      throw new Error('Invalid JSON response from Groq');
    }

  } catch (error) {
    console.error('Error extracting profile from text:', error);
    throw error;
  }
}

export async function enhanceProfileWithAI(existingProfile: Profile, additionalText: string): Promise<Profile> {
  try {
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `You are a profile enhancement expert. Merge and improve profile data while preserving existing information. Return ONLY valid JSON.

IMPORTANT: Your response must be valid JSON only. No additional text, explanations, or markdown formatting.

Rules:
- Keep all existing information intact
- Add new information from the additional text
- Merge similar items (like skills) without duplicating
- Enhance descriptions with additional details
- Use empty string for missing text fields, empty arrays for missing list fields
- Return valid JSON only - no markdown, no explanations`
        },
        {
          role: "user",
          content: `Enhance this existing profile with additional information and return ONLY valid JSON:

Existing Profile:
${JSON.stringify(existingProfile, null, 2)}

Additional Text:
${additionalText}

Return the enhanced profile with the same JSON structure.`
        }
      ],
      response_format: {
        type: "json_object"
      },
      temperature: 0.1,
      max_completion_tokens: 2000
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from Groq');
    }

    try {
      const enhancedProfile = JSON.parse(content);
      return enhancedProfile;
    } catch (parseError) {
      console.error('Failed to parse Groq enhancement response:', parseError);
      // Return original profile if enhancement fails
      return existingProfile;
    }

  } catch (error) {
    console.error('Error enhancing profile:', error);
    // Return original profile if enhancement fails
    return existingProfile;
  }
}