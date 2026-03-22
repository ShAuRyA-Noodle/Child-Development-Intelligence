// Intervention mapping service (ported from process_data.py lines 424-534)

const DQ_DELAY_THRESHOLD = 75;
const DQ_CONCERN_THRESHOLD = 85;

export interface InterventionActivity {
  domain: string;
  activityName: string;
  frequency: string;
  durationMinutes: number;
  caregiverFormat: string;
  priority: number;
  rationale: string;
}

export interface InterventionInput {
  lcDq: number | null;
  gmDq: number | null;
  fmDq: number | null;
  cogDq: number | null;
  seDq: number | null;
  behaviourRiskLevel: string | null;
  behaviourConcerns: string | null;
  behaviourScore: number;
  nutritionRisk: string | null;
  nutritionScore: number;
}

export function mapInterventions(input: InterventionInput): InterventionActivity[] {
  const plans: InterventionActivity[] = [];

  // Speech/Language intervention
  if (input.lcDq !== null && input.lcDq < DQ_CONCERN_THRESHOLD) {
    const intensity = input.lcDq < DQ_DELAY_THRESHOLD ? 'intensive' : 'moderate';
    plans.push({
      domain: 'Speech & Language',
      activityName: 'Structured speech stimulation with picture cards and story narration',
      frequency: intensity === 'intensive' ? 'Daily' : '3x/week',
      durationMinutes: intensity === 'intensive' ? 15 : 10,
      caregiverFormat: 'audio',
      priority: intensity === 'intensive' ? 1 : 2,
      rationale: `LC DQ=${Math.round(input.lcDq)} (below ${DQ_CONCERN_THRESHOLD})`,
    });
  }

  // Gross Motor intervention
  if (input.gmDq !== null && input.gmDq < DQ_CONCERN_THRESHOLD) {
    const intensity = input.gmDq < DQ_DELAY_THRESHOLD ? 'intensive' : 'moderate';
    plans.push({
      domain: 'Gross Motor',
      activityName: 'Structured physical movement exercises — crawling, climbing, balancing',
      frequency: intensity === 'intensive' ? 'Daily' : '3x/week',
      durationMinutes: intensity === 'intensive' ? 20 : 15,
      caregiverFormat: 'visual',
      priority: intensity === 'intensive' ? 1 : 2,
      rationale: `GM DQ=${Math.round(input.gmDq)} (below ${DQ_CONCERN_THRESHOLD})`,
    });
  }

  // Fine Motor intervention
  if (input.fmDq !== null && input.fmDq < DQ_CONCERN_THRESHOLD) {
    const intensity = input.fmDq < DQ_DELAY_THRESHOLD ? 'intensive' : 'moderate';
    plans.push({
      domain: 'Fine Motor',
      activityName: 'Bead threading, clay molding, crayon coloring, and buttoning exercises',
      frequency: intensity === 'intensive' ? 'Daily' : '4x/week',
      durationMinutes: 15,
      caregiverFormat: 'visual',
      priority: intensity === 'intensive' ? 1 : 2,
      rationale: `FM DQ=${Math.round(input.fmDq)} (below ${DQ_CONCERN_THRESHOLD})`,
    });
  }

  // Cognitive intervention
  if (input.cogDq !== null && input.cogDq < DQ_CONCERN_THRESHOLD) {
    const intensity = input.cogDq < DQ_DELAY_THRESHOLD ? 'intensive' : 'moderate';
    plans.push({
      domain: 'Cognitive',
      activityName: 'Pattern recognition games, shape sorting, problem-solving puzzles',
      frequency: intensity === 'intensive' ? 'Daily' : '3x/week',
      durationMinutes: intensity === 'intensive' ? 15 : 10,
      caregiverFormat: 'visual',
      priority: intensity === 'intensive' ? 1 : 2,
      rationale: `COG DQ=${Math.round(input.cogDq)} (below ${DQ_CONCERN_THRESHOLD})`,
    });
  }

  // Socio-emotional intervention
  if (input.seDq !== null && input.seDq < DQ_CONCERN_THRESHOLD) {
    const intensity = input.seDq < DQ_DELAY_THRESHOLD ? 'intensive' : 'moderate';
    plans.push({
      domain: 'Socio-Emotional',
      activityName: 'Group play activities, emotion-naming games, turn-taking exercises',
      frequency: intensity === 'intensive' ? '3x/week' : '2x/week',
      durationMinutes: 15,
      caregiverFormat: 'audio',
      priority: intensity === 'intensive' ? 1 : 3,
      rationale: `SE DQ=${Math.round(input.seDq)} (below ${DQ_CONCERN_THRESHOLD})`,
    });
  }

  // Behavioral intervention
  if (input.behaviourRiskLevel === 'High' || input.behaviourRiskLevel === 'Moderate') {
    let concern = input.behaviourConcerns ?? 'General behavioral regulation';
    if (concern === 'Unknown' || concern === 'None' || concern === '') {
      concern = 'General behavioral regulation';
    }
    plans.push({
      domain: 'Behavioral',
      activityName: `Targeted behavioral intervention for ${concern.toLowerCase()} — positive reinforcement and caregiver guidance`,
      frequency: input.behaviourRiskLevel === 'High' ? 'Daily' : '3x/week',
      durationMinutes: 10,
      caregiverFormat: 'audio',
      priority: 2,
      rationale: `Behaviour score=${input.behaviourScore}, risk=${input.behaviourRiskLevel}`,
    });
  }

  // Nutrition intervention
  if (input.nutritionRisk === 'High' || input.nutritionRisk === 'Medium') {
    plans.push({
      domain: 'Nutrition',
      activityName: 'Supplementary feeding program + growth monitoring + caregiver nutrition counseling',
      frequency: input.nutritionRisk === 'High' ? 'Daily' : '3x/week',
      durationMinutes: 0, // ongoing
      caregiverFormat: 'visual',
      priority: input.nutritionRisk === 'High' ? 1 : 2,
      rationale: `Nutrition score=${input.nutritionScore}, risk=${input.nutritionRisk}`,
    });
  }

  // Sort by priority
  plans.sort((a, b) => a.priority - b.priority);

  // Cap at 5 activities per child
  return plans.slice(0, 5);
}
