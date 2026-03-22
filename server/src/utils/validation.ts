import { z } from 'zod';

// ─── Auth Schemas ───────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  username: z.string().min(1, 'Username is required').max(100),
  password: z.string().min(1, 'Password is required').max(255),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

// ─── Child Schemas ──────────────────────────────────────────────────────────────

export const childCreateSchema = z.object({
  childId: z.string().min(1).max(50),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  gender: z.enum(['M', 'F', 'O']).optional(),
  dob: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date format'),
  birthWeightKg: z.number().min(0).max(10).optional(),
  birthStatus: z.string().max(50).optional(),
  caregiverId: z.string().uuid().optional(),
  awcId: z.number().int().positive().optional(),
  // Demographic fields for bias auditing
  socialCategory: z.enum(['General', 'OBC', 'SC', 'ST', 'Other']).optional(),
  maternalEducation: z.string().max(50).optional(),
  paternalEducation: z.string().max(50).optional(),
  householdIncomeBand: z.enum(['BPL', 'LIG', 'MIG', 'HIG']).optional(),
  rationCardType: z.enum(['AAY', 'PHH', 'NPHH', 'None']).optional(),
});
export type ChildCreateInput = z.infer<typeof childCreateSchema>;

export const childUpdateSchema = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  gender: z.enum(['M', 'F', 'O']).optional(),
  dob: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date format').optional(),
  birthWeightKg: z.number().min(0).max(10).optional(),
  birthStatus: z.string().max(50).optional(),
  caregiverId: z.string().uuid().optional(),
  awcId: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
  // Demographic fields for bias auditing
  socialCategory: z.enum(['General', 'OBC', 'SC', 'ST', 'Other']).optional(),
  maternalEducation: z.string().max(50).optional(),
  paternalEducation: z.string().max(50).optional(),
  householdIncomeBand: z.enum(['BPL', 'LIG', 'MIG', 'HIG']).optional(),
  rationCardType: z.enum(['AAY', 'PHH', 'NPHH', 'None']).optional(),
});
export type ChildUpdateInput = z.infer<typeof childUpdateSchema>;

// ─── Assessment Schemas ─────────────────────────────────────────────────────────

export const assessmentCreateSchema = z.object({
  childId: z.string().min(1).max(50),
  assessmentDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date format'),
  assessmentCycle: z.string().max(50).optional(),
  ageAtAssessmentMonths: z.number().int().min(0).max(120),
  heightCm: z.number().min(0).max(200).optional(),
  weightKg: z.number().min(0).max(50).optional(),
  muacCm: z.number().min(0).max(30).optional(),
  gmDq: z.number().min(0).max(200).optional(),
  fmDq: z.number().min(0).max(200).optional(),
  lcDq: z.number().min(0).max(200).optional(),
  cogDq: z.number().min(0).max(200).optional(),
  seDq: z.number().min(0).max(200).optional(),
  compositeDq: z.number().min(0).max(200).optional(),
  gmDelay: z.number().int().min(0).max(1).default(0),
  fmDelay: z.number().int().min(0).max(1).default(0),
  lcDelay: z.number().int().min(0).max(1).default(0),
  cogDelay: z.number().int().min(0).max(1).default(0),
  seDelay: z.number().int().min(0).max(1).default(0),
  numDelays: z.number().int().min(0).max(5).default(0),
  autismRisk: z.enum(['High', 'Moderate', 'Low']).optional(),
  adhdRisk: z.enum(['High', 'Moderate', 'Low']).optional(),
  behaviorRisk: z.enum(['High', 'Moderate', 'Low']).optional(),
  behaviourScore: z.number().int().min(0).default(0),
  underweight: z.number().int().min(0).max(1).default(0),
  stunting: z.number().int().min(0).max(1).default(0),
  wasting: z.number().int().min(0).max(1).default(0),
  anemia: z.number().int().min(0).max(1).default(0),
  nutritionScore: z.number().int().min(0).default(0),
  nutritionRisk: z.enum(['High', 'Medium', 'Low']).optional(),
  clinicalObservations: z.string().optional(),
  // v2 environmental risk factors
  homeStimulationScore: z.number().int().min(0).max(5).default(5),
  parentMentalHealthScore: z.number().int().min(0).max(5).default(5),
  caregiverEngagement: z.enum(['High', 'Medium', 'Low']).optional(),
});
export type AssessmentCreateInput = z.infer<typeof assessmentCreateSchema>;

// ─── Alert Schemas ──────────────────────────────────────────────────────────────

export const alertUpdateSchema = z.object({
  status: z.enum(['acknowledged', 'resolved']),
});
export type AlertUpdateInput = z.infer<typeof alertUpdateSchema>;

// ─── Intervention Schemas ───────────────────────────────────────────────────────

export const interventionCreateSchema = z.object({
  childId: z.string().min(1).max(50),
  assessmentId: z.string().uuid().optional(),
  status: z.string().max(50).default('Draft'),
  startDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date format').optional(),
  endDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date format').optional(),
  activities: z.array(z.object({
    domain: z.string().max(100),
    activityName: z.string().max(255),
    frequency: z.string().max(100).optional(),
    durationMinutes: z.number().int().min(0).optional(),
    caregiverFormat: z.string().max(100).optional(),
    priority: z.number().int().min(1).max(10).default(1),
    rationale: z.string().optional(),
  })).optional(),
});
export type InterventionCreateInput = z.infer<typeof interventionCreateSchema>;

export const interventionUpdateSchema = z.object({
  status: z.string().max(50).optional(),
  startDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date format').optional(),
  endDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date format').optional(),
});
export type InterventionUpdateInput = z.infer<typeof interventionUpdateSchema>;

export const complianceCreateSchema = z.object({
  activityDate: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date format'),
  completed: z.boolean(),
  duration: z.number().int().min(0).optional(),
  notes: z.string().optional(),
});
export type ComplianceCreateInput = z.infer<typeof complianceCreateSchema>;

// ─── Sync Schemas ───────────────────────────────────────────────────────────────

export const syncMutationSchema = z.object({
  mutations: z.array(z.object({
    mutationId: z.string().uuid(),
    childId: z.string().max(50).optional(),
    tableName: z.string().max(100),
    operation: z.enum(['INSERT', 'UPDATE', 'DELETE']),
    payload: z.record(z.unknown()),
    clientTs: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid timestamp'),
  })),
  lastSyncTs: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid timestamp').optional(),
});
export type SyncMutationInput = z.infer<typeof syncMutationSchema>;

export const syncPullSchema = z.object({
  since: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid timestamp'),
  tables: z.array(z.string()).optional(),
});
export type SyncPullInput = z.infer<typeof syncPullSchema>;
