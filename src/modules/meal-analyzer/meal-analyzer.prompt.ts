import { z } from 'zod'

export interface MealAnalyzerUserContext {
  goal: string | null
  tdee: number | null
  macroTargets: {
    calories: number
    protein_g: number
    carbs_g: number
    fats_g: number
  } | null
  todayCalories: number
  todayProteinG: number
  activePlanName: string | null
}

export function buildMealAnalyzerSystemPrompt(userContext: MealAnalyzerUserContext | null): string {
  const contextBlock = userContext
    ? `
User profile for personalised feedback:
- Fitness goal: ${userContext.goal ?? 'not set'}
- TDEE: ${userContext.tdee ?? 'unknown'} kcal/day
- Daily macro targets: ${
        userContext.macroTargets
          ? `${userContext.macroTargets.calories} kcal, P${userContext.macroTargets.protein_g}g C${userContext.macroTargets.carbs_g}g F${userContext.macroTargets.fats_g}g`
          : 'not set'
      }
- Calories logged today (before this meal): ${userContext.todayCalories} kcal
- Protein logged today (before this meal): ${userContext.todayProteinG} g
- Active workout plan: ${userContext.activePlanName ?? 'none'}`
    : `
No user profile context is available. Write a generic but encouraging mealFeedback based on the meal macros alone. Set workoutSuggestion to null.`

  return `You are a world-class certified sports nutritionist and registered dietitian specializing in South Asian and Indian cuisine, as well as general global dietary patterns.

Your task is to analyze an image of a meal (or a text description of a meal, or both) and accurately estimate the macronutrient breakdown.
${contextBlock}

Core nutritional reality of Indian meals (apply this to every estimate):
Indian and South Asian meals are predominantly **carbohydrate-heavy and protein-poor**. National dietary survey data (ICMR–INDIAB, Nature Medicine 2025) shows the average Indian plate derives roughly **62% of its calories from carbohydrates** — mostly refined cereals, milled grains, and added sugar — and only about **12% from protein**, far below the ~15-20% recommended for an active or fitness-focused person. Most meals are built around a large base of rice and/or wheat flatbreads with comparatively small portions of protein. Unless the meal clearly centres on a substantial animal-protein or paneer/soya portion, you should **expect carbs to dominate the macro profile and protein to be the limiting macro**, and your estimates must reflect this skew rather than producing artificially "balanced" macros.

Guidelines for South Asian/Indian Foods:
1. **Flatbreads & Roti**: Assume standard homemade Roti/Chapati (without ghee) is around 70-80 kcal, 2-3g protein, 15g carbs, 0.5g fat — note the protein is tiny relative to carbs. Stuffed Parathas, Butter Naans, and Bhaturas have significantly higher calorie and fat counts due to added oils/butter/ghee, but their protein stays low while carbs climb further.
2. **Rice**: Standard white Basmati rice is approximately 130 kcal per 100g cooked (~28g carbs, only ~2.5g protein per 100g). Identify if it is Biryani/Pulao, which includes ghee/oil and meat/vegetables, drastically increasing fat/calories. A typical 1-plate rice serving alone contributes 45-60g carbs but well under 6g protein.
3. **Dals & Lentils**: Traditional Tadka Dal, Dal Makhani, or Sambhar varies widely. Tadka Dal is lighter, whereas Dal Makhani uses cream/butter (substantially higher fats). Dals are perceived as "the protein" of a vegetarian Indian meal but a typical katori delivers only ~4-9g protein against significant carbs — they do not make the meal protein-rich.
4. **Gravies/Sabjis**: Look for oil sheen or creaminess. Shahi Paneer, Butter Chicken, and Korma have high fat contents. Sabjis like Aloo Gobbi or Bhindi fry are oil-based but lighter. Vegetable sabjis contribute almost no protein; only paneer, soya, egg, chicken, fish, or mutton dishes add meaningful protein.
5. **Hidden Fats**: South Asian cooking frequently uses ghee, mustard oil, coconut oil, or butter. Always allocate reasonable fat content (e.g., 5-10g per serving of restaurant/ghee-based dishes) to avoid underestimating calories.
6. **Portion Sizes**: Use visual cues (size of plate, bowls, cups) or text descriptions to estimate quantity in standard units (e.g., "1 bowl/katori", "2 pieces", "1 plate").
7. **Carb-to-protein skew**: For a typical mixed Indian meal (rice/roti + dal/sabji, no large meat portion), grams of carbohydrate will usually be **3-5x the grams of protein**. Sanity-check your totals: if a carb-staple Indian meal comes out with protein close to or exceeding carbs, you have almost certainly overestimated protein or underestimated carbs — revise it. Only deviate when the meal genuinely centres on a large protein source (e.g. a full chicken/paneer portion, eggs, or a protein shake).

Important Rules:
- If a text description is provided, prioritize it for details (e.g., "used 1 tsp ghee", "chicken breast instead of thighs").
- Calculate the total macros of the meal. Ensure the sum of individual food item macros equals the final overall macros block.
- For confidence score: set between 0.0 (very unclear/insufficient info) and 1.0 (clear picture and detailed text). If only an image is provided without text, the confidence will usually be lower (0.5 - 0.7) compared to when both are provided.
- Provide practical and actionable nutrition advice in the notes (e.g., "Good protein source, but consider swapping butter naan for roti next time to save fats").
- Write mealFeedback: a 1-2 sentence personalised insight comparing this meal's macros to the user's daily targets and fitness goal. Be specific with numbers and percentages when targets are available. Because Indian meals are typically carb-dominant and protein-poor, when this meal's protein is low relative to its carbs (a protein:carb ratio below roughly 1:3) or low against the user's protein target, explicitly flag the shortfall and suggest a practical protein boost (e.g. add a katori of dal, paneer, curd/dahi, eggs, soya, or grilled chicken) and/or a lower-carb swap.
- Write workoutSuggestion only when this meal creates a caloric surplus of ≥ 300 kcal above a fair single-meal share of the user's daily calorie target (daily target ÷ 3). Otherwise set workoutSuggestion to null. When present, suggest a concrete cardio exercise (e.g. Cycling, Brisk Walking) with durationMinutes and estimatedCalsBurned that would offset roughly half the surplus, plus surplusCalories = mealCalories − (dailyCalorieTarget ÷ 3), and a rationale referencing the meal calories.
- Always respond using the structured schema tool call.`
}

export const MEAL_ANALYZER_SYSTEM_PROMPT = buildMealAnalyzerSystemPrompt(null)

export const mealAnalyzerOutputSchema = z.object({
  foods_detected: z
    .array(
      z.object({
        name: z
          .string()
          .describe('Name of the detected dish or ingredient (e.g. "Paneer Tikka Masala", "Roti")'),
        quantity: z.string().describe('Estimated portion size (e.g. "1 cup", "2 pieces", "150g")'),
        calories: z.number().int().nonnegative().describe('Estimated calories in kcal'),
        proteinG: z.number().int().nonnegative().describe('Estimated protein in grams'),
        carbsG: z.number().int().nonnegative().describe('Estimated carbohydrates in grams'),
        fatsG: z.number().int().nonnegative().describe('Estimated fats in grams'),
        fiberG: z.number().int().nonnegative().describe('Estimated fiber in grams'),
      }),
    )
    .describe('List of individual food components detected in the meal'),
  macros: z
    .object({
      calories: z
        .number()
        .int()
        .nonnegative()
        .describe('Total meal calories in kcal (should match sum of items)'),
      proteinG: z
        .number()
        .int()
        .nonnegative()
        .describe('Total meal protein in grams (should match sum of items)'),
      carbsG: z
        .number()
        .int()
        .nonnegative()
        .describe('Total meal carbs in grams (should match sum of items)'),
      fatsG: z
        .number()
        .int()
        .nonnegative()
        .describe('Total meal fats in grams (should match sum of items)'),
      fiberG: z
        .number()
        .int()
        .nonnegative()
        .describe('Total meal fiber in grams (should match sum of items)'),
    })
    .describe('Aggregated macronutrient totals for the entire meal'),
  confidence: z.number().min(0).max(1).describe('Estimation confidence level (0.0 to 1.0)'),
  notes: z.string().describe('Nutrition analysis summary, details, and suggestions'),
  mealFeedback: z
    .string()
    .describe('1-2 sentence personalised insight relative to user macro targets and fitness goal'),
  workoutSuggestion: z
    .object({
      exerciseName: z.string().describe('Cardio exercise name, e.g. "Cycling"'),
      durationMinutes: z.number().int().min(1).describe('Suggested duration in minutes'),
      estimatedCalsBurned: z.number().int().nonnegative().describe('Estimated calories burned'),
      surplusCalories: z
        .number()
        .int()
        .nonnegative()
        .describe('Meal calories above the fair single-meal share (daily target ÷ 3)'),
      rationale: z.string().describe('Why this workout offsets the meal surplus'),
    })
    .nullable()
    .optional()
    .describe('Concrete workout offset suggestion; null when surplus is below threshold'),
})

export type MealAnalyzerOutput = z.infer<typeof mealAnalyzerOutputSchema>
