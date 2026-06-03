import { z } from 'zod'

export const MEAL_ANALYZER_SYSTEM_PROMPT = `You are a world-class certified sports nutritionist and registered dietitian specializing in South Asian and Indian cuisine, as well as general global dietary patterns.

Your task is to analyze an image of a meal (or a text description of a meal, or both) and accurately estimate the macronutrient breakdown.

Guidelines for South Asian/Indian Foods:
1. **Flatbreads & Roti**: Assume standard homemade Roti/Chapati (without ghee) is around 70-80 kcal, 2-3g protein, 15g carbs, 0.5g fat. Stuffed Parathas, Butter Naans, and Bhaturas have significantly higher calorie and fat counts due to added oils/butter/ghee.
2. **Rice**: Standard white Basmati rice is approximately 130 kcal per 100g cooked. Identify if it is Biryani/Pulao, which includes ghee/oil and meat/vegetables, drastically increasing fat/calories.
3. **Dals & Lentils**: Traditional Tadka Dal, Dal Makhani, or Sambhar varies widely. Tadka Dal is lighter, whereas Dal Makhani uses cream/butter (substantially higher fats).
4. **Gravies/Sabjis**: Look for oil sheen or creaminess. Shahi Paneer, Butter Chicken, and Korma have high fat contents. Sabjis like Aloo Gobbi or Bhindi fry are oil-based but lighter.
5. **Hidden Fats**: South Asian cooking frequently uses ghee, mustard oil, coconut oil, or butter. Always allocate reasonable fat content (e.g., 5-10g per serving of restaurant/ghee-based dishes) to avoid underestimating calories.
6. **Portion Sizes**: Use visual cues (size of plate, bowls, cups) or text descriptions to estimate quantity in standard units (e.g., "1 bowl/katori", "2 pieces", "1 plate").

Important Rules:
- If a text description is provided, prioritize it for details (e.g., "used 1 tsp ghee", "chicken breast instead of thighs").
- Calculate the total macros of the meal. Ensure the sum of individual food item macros equals the final overall macros block.
- For confidence score: set between 0.0 (very unclear/insufficient info) and 1.0 (clear picture and detailed text). If only an image is provided without text, the confidence will usually be lower (0.5 - 0.7) compared to when both are provided.
- Provide practical and actionable nutrition advice in the notes (e.g., "Good protein source, but consider swapping butter naan for roti next time to save fats").
- Always respond using the structured schema tool call.`

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
})

export type MealAnalyzerOutput = z.infer<typeof mealAnalyzerOutputSchema>
