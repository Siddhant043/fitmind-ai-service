import type { WorkoutPlanGenerationRequest } from './workout-plan.types.js'

export const WORKOUT_PLAN_SYSTEM_PROMPT = `You are an expert strength and conditioning coach designing personalised workout programmes.

Your task is to generate 2–3 distinct workout plan options tailored to the user's profile.

Rules:
- Use ONLY exercise_id values from the provided allowed exercise catalog — never invent IDs
- Each plan must have 1–7 training days with 3–8 exercises per day
- sets: 2–5, rep_range: e.g. "8-12", "12-15", "15-20" for conditioning
- rest_sec: 60–180 seconds between sets
- rpe_target: 6–9 (optional)
- daysPerWeek must equal the number of days in the plan
- goal must match the user's fitness goal
- tags: 2–4 short labels e.g. "Beginner", "Hypertrophy", "Barbell", "Full Body"
- Vary split styles across the 2–3 plans (e.g. full body vs upper/lower vs push/pull/legs)
- Match volume to activity level: sedentary/light → max 3 days; very_active → up to 6 days
- Reference macro targets in descriptions when available (coaching tone, 1–2 sentences)

Always use the generate_workout_plans tool to return your answer.`

export function buildWorkoutPlanUserPrompt(input: WorkoutPlanGenerationRequest): string {
  const { profile, allowedExercises, maxPlans } = input

  const activityLabels: Record<string, string> = {
    sedentary: 'sedentary (desk job, little exercise)',
    light: 'lightly active (1–3 days/week)',
    moderate: 'moderately active (3–5 days/week)',
    active: 'very active (6–7 days/week)',
    very_active: 'extra active (physical job + hard training)',
  }

  const goalLabels: Record<string, string> = {
    bulk: 'muscle gain',
    cut: 'fat loss',
    maintain: 'general fitness / maintenance',
    recomposition: 'body recomposition',
  }

  const exerciseList = allowedExercises
    .slice(0, 80)
    .map((e) => `- ${e.id}: ${e.name} (${e.muscleGroup}${e.equipment ? `, ${e.equipment}` : ''})`)
    .join('\n')

  const macroLine = profile.macroTargets
    ? `Daily targets: ${profile.macroTargets.calories} kcal, ${profile.macroTargets.protein_g}g protein`
    : 'Macro targets: not yet calculated'

  return `Design ${maxPlans} personalised workout plan options for this user:

Profile:
- Sex: ${profile.sex}
- Age: ${profile.ageYears} years
- Weight: ${profile.weightKg} kg, Height: ${profile.heightCm} cm
- Activity: ${activityLabels[profile.activityLevel] ?? profile.activityLevel}
- Goal: ${goalLabels[profile.goal] ?? profile.goal}
- Diet: ${profile.dietaryPref ?? 'no restriction'}
- ${macroLine}

Allowed exercises (use ONLY these exercise_id values):
${exerciseList}

Generate ${maxPlans} distinct plans using the generate_workout_plans tool.`
}
