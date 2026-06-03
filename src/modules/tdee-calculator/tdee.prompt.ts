import { z } from 'zod'

export const TDEE_SYSTEM_PROMPT = `You are a certified sports nutritionist and registered dietitian specialising in South Asian and Indian dietary patterns.

Your task is to calculate personalised daily calorie and macro targets for a user based on their biometrics and fitness goals.

Process:
1. Calculate Basal Metabolic Rate (BMR) using the Mifflin-St Jeor equation as your starting point
2. Apply the appropriate activity multiplier
3. Adjust calories for the user's goal (cut/bulk/maintain/recomposition)
4. Distribute macros intelligently — consider dietary preferences when allocating protein sources and carbohydrate types
5. Set protein at or above 1g per pound of bodyweight for muscle preservation
6. Provide a brief, motivating reasoning statement

Always use the set_tdee_and_macros tool to return your answer. All values must be positive integers.`

export const tdeeOutputSchema = z.object({
  calories: z.number().int().positive(),
  protein_g: z.number().int().positive(),
  carbs_g: z.number().int().positive(),
  fats_g: z.number().int().positive(),
  fiber_g: z.number().int().positive(),
  reasoning: z.string().min(10).max(300),
})

export type TdeeOutput = z.infer<typeof tdeeOutputSchema>

export function buildUserPrompt(input: {
  sex: string
  weightKg: number
  heightCm: number
  ageYears: number
  activityLevel: string
  goal: string
  dietaryPref: string | null
}): string {
  const goalLabels: Record<string, string> = {
    bulk: 'muscle gain (caloric surplus)',
    cut: 'fat loss (caloric deficit)',
    maintain: 'weight maintenance',
    recomposition: 'body recomposition (maintain weight, improve body composition)',
  }

  const activityLabels: Record<string, string> = {
    sedentary: 'sedentary (desk job, little to no exercise)',
    light: 'lightly active (1–3 days/week exercise)',
    moderate: 'moderately active (3–5 days/week exercise)',
    active: 'very active (6–7 days/week exercise)',
    very_active: 'extra active (physical job + hard exercise daily)',
  }

  return `Calculate personalised daily nutrition targets for this user:

Sex: ${input.sex}
Age: ${input.ageYears} years
Weight: ${input.weightKg} kg
Height: ${input.heightCm} cm
Activity level: ${activityLabels[input.activityLevel] ?? input.activityLevel}
Goal: ${goalLabels[input.goal] ?? input.goal}
Dietary preference: ${input.dietaryPref ?? 'no restriction'}

Use the set_tdee_and_macros tool to return the calculated values.`
}
