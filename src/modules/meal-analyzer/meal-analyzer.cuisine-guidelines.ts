export type CuisineRegion =
  | 'south_asia'
  | 'north_america'
  | 'east_asia'
  | 'middle_east'
  | 'europe'
  | 'global'

const SOUTH_ASIA_COUNTRIES = new Set(['IN', 'PK', 'BD', 'LK', 'NP', 'AF'])
const NORTH_AMERICA_COUNTRIES = new Set(['US', 'CA', 'MX'])
const EAST_ASIA_COUNTRIES = new Set([
  'CN',
  'JP',
  'KR',
  'TW',
  'HK',
  'SG',
  'MY',
  'TH',
  'VN',
  'PH',
  'ID',
])
const MIDDLE_EAST_COUNTRIES = new Set([
  'AE',
  'SA',
  'QA',
  'KW',
  'BH',
  'OM',
  'IL',
  'TR',
  'IR',
  'IQ',
  'JO',
  'LB',
])
const EUROPE_COUNTRIES = new Set([
  'GB',
  'DE',
  'FR',
  'IT',
  'ES',
  'NL',
  'BE',
  'SE',
  'NO',
  'DK',
  'FI',
  'PL',
  'PT',
  'IE',
  'CH',
  'AT',
  'GR',
])

export function resolveCuisineRegion(countryCode: string | null): CuisineRegion {
  if (!countryCode) return 'global'
  const code = countryCode.toUpperCase()
  if (SOUTH_ASIA_COUNTRIES.has(code)) return 'south_asia'
  if (NORTH_AMERICA_COUNTRIES.has(code)) return 'north_america'
  if (EAST_ASIA_COUNTRIES.has(code)) return 'east_asia'
  if (MIDDLE_EAST_COUNTRIES.has(code)) return 'middle_east'
  if (EUROPE_COUNTRIES.has(code)) return 'europe'
  return 'global'
}

export function formatCountryDisplayName(countryCode: string | null): string | null {
  if (!countryCode) return null
  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'region' })
    return displayNames.of(countryCode.toUpperCase()) ?? countryCode
  } catch {
    return countryCode
  }
}

const PERSONA_BY_REGION: Record<CuisineRegion, string> = {
  south_asia:
    'You are a world-class certified sports nutritionist and registered dietitian specializing in South Asian and Indian cuisine, as well as general global dietary patterns.',
  north_america:
    'You are a world-class certified sports nutritionist and registered dietitian specializing in North American cuisine and USDA-based portion estimates.',
  east_asia:
    'You are a world-class certified sports nutritionist and registered dietitian specializing in East and Southeast Asian cuisine.',
  middle_east:
    'You are a world-class certified sports nutritionist and registered dietitian specializing in Middle Eastern and Mediterranean cuisine.',
  europe:
    'You are a world-class certified sports nutritionist and registered dietitian specializing in European cuisine and common regional eating patterns.',
  global:
    'You are a world-class certified sports nutritionist and registered dietitian with expertise across global cuisines and portion estimation.',
}

const GUIDELINES_BY_REGION: Record<CuisineRegion, string> = {
  south_asia: `Core nutritional reality of Indian and South Asian meals (apply this to every estimate):
Indian and South Asian meals are predominantly **carbohydrate-heavy and protein-poor**. National dietary survey data (ICMR–INDIAB, Nature Medicine 2025) shows the average Indian plate derives roughly **62% of its calories from carbohydrates** — mostly refined cereals, milled grains, and added sugar — and only about **12% from protein**, far below the ~15-20% recommended for an active or fitness-focused person. Most meals are built around a large base of rice and/or wheat flatbreads with comparatively small portions of protein. Unless the meal clearly centres on a substantial animal-protein or paneer/soya portion, you should **expect carbs to dominate the macro profile and protein to be the limiting macro**, and your estimates must reflect this skew rather than producing artificially "balanced" macros.

Guidelines for South Asian/Indian Foods:
1. **Flatbreads & Roti**: Assume standard homemade Roti/Chapati (without ghee) is around 70-80 kcal, 2-3g protein, 15g carbs, 0.5g fat — note the protein is tiny relative to carbs. Stuffed Parathas, Butter Naans, and Bhaturas have significantly higher calorie and fat counts due to added oils/butter/ghee, but their protein stays low while carbs climb further.
2. **Rice**: Standard white Basmati rice is approximately 130 kcal per 100g cooked (~28g carbs, only ~2.5g protein per 100g). Identify if it is Biryani/Pulao, which includes ghee/oil and meat/vegetables, drastically increasing fat/calories. A typical 1-plate rice serving alone contributes 45-60g carbs but well under 6g protein.
3. **Dals & Lentils**: Traditional Tadka Dal, Dal Makhani, or Sambhar varies widely. Tadka Dal is lighter, whereas Dal Makhani uses cream/butter (substantially higher fats). Dals are perceived as "the protein" of a vegetarian Indian meal but a typical katori delivers only ~4-9g protein against significant carbs — they do not make the meal protein-rich.
4. **Gravies/Sabjis**: Look for oil sheen or creaminess. Shahi Paneer, Butter Chicken, and Korma have high fat contents. Sabjis like Aloo Gobbi or Bhindi fry are oil-based but lighter. Vegetable sabjis contribute almost no protein; only paneer, soya, egg, chicken, fish, or mutton dishes add meaningful protein.
5. **Hidden Fats**: South Asian cooking frequently uses ghee, mustard oil, coconut oil, or butter. Always allocate reasonable fat content (e.g., 5-10g per serving of restaurant/ghee-based dishes) to avoid underestimating calories.
6. **Portion Sizes**: Use visual cues (size of plate, bowls, cups) or text descriptions to estimate quantity in standard units (e.g., "1 bowl/katori", "2 pieces", "1 plate").
7. **Carb-to-protein skew**: For a typical mixed Indian meal (rice/roti + dal/sabji, no large meat portion), grams of carbohydrate will usually be **3-5x the grams of protein**. Sanity-check your totals: if a carb-staple Indian meal comes out with protein close to or exceeding carbs, you have almost certainly overestimated protein or underestimated carbs — revise it. Only deviate when the meal genuinely centres on a large protein source (e.g. a full chicken/paneer portion, eggs, or a protein shake).

When writing mealFeedback for South Asian meals: when protein is low relative to carbs (protein:carb ratio below roughly 1:3) or low against the user's protein target, explicitly flag the shortfall and suggest practical protein boosts (e.g. add a katori of dal, paneer, curd/dahi, eggs, soya, or grilled chicken) and/or a lower-carb swap.`,

  north_america: `Core nutritional reality of typical North American meals:
Many restaurant and home meals are **calorie-dense with moderate-to-high protein** when they include meat, but sides (fries, bread, sugary drinks) can push carbs and fats high. Fast food and chain-restaurant portions are often **2-3x standard serving sizes**. Breakfast skews carb-heavy (bagels, pancakes, cereal); lunch/dinner may be protein-forward (burgers, grilled chicken, steak) but often paired with high-calorie sides.

Guidelines for North American Foods:
1. **Burgers & Sandwiches**: A standard cheeseburger ~500-700 kcal; add bacon/avocado/special sauce +150-250 kcal. Bun contributes ~25-35g carbs; patty ~20-30g protein depending on size.
2. **Pizza**: One large slice ~250-350 kcal; thin-crust vs deep-dish matters significantly. Estimate 2-4 slices for a typical meal portion.
3. **Salads**: Distinguish lean protein salads from creamy dressings — ranch/Caesar dressing can add 200+ kcal. Grilled chicken salad ~400-600 kcal total.
4. **Mexican-American**: Burritos and quesadillas are calorie-dense (600-900+ kcal); rice/beans add carbs, cheese/sour cream add fat.
5. **Breakfast**: Pancakes/waffles with syrup are carb-heavy (~60-80g carbs); eggs/bacon plate is protein/fat-forward.
6. **Beverages**: Sweetened coffee drinks, soda, and smoothies can add 200-500 kcal — include if visible or described.
7. **Portion heuristic**: Restaurant entrees often assume 1.5-2x home-cooked portions. Use plate diameter and stack height as cues.

When writing mealFeedback: compare to daily targets; suggest swaps like side salad instead of fries, grilled instead of fried, or portion control for chain-restaurant sizes.`,

  east_asia: `Core nutritional reality of East and Southeast Asian meals:
Rice or noodles typically form the carb base. Protein portions (fish, pork, chicken, tofu) are often moderate; stir-fries use significant oil. Bento and set meals combine multiple small items — sum each component.

Guidelines:
1. **Rice bowls**: Steamed rice ~200 kcal per cup cooked; donburi and curry rice add protein and sauce calories.
2. **Noodles**: Ramen, pho, and stir-fried noodles vary widely (400-800+ kcal per bowl); broth vs fried matters.
3. **Stir-fries**: Assume 1-2 tbsp oil per serving unless described as steamed/boiled.
4. **Dim sum / small plates**: Estimate each piece individually and sum totals.
5. **Sushi**: ~40-60 kcal per piece; rolls with tempura or mayo are higher.

Use local dish names when identifiable; apply carb-heavy base + moderate protein defaults unless the meal is clearly protein-centric.`,

  middle_east: `Core nutritional reality of Middle Eastern meals:
Meals often combine flatbreads, rice, grilled meats, hummus, and olive-oil-rich dishes. Falafel and vegetarian plates can be carb-heavy; grilled kebabs and shawarma are protein-forward but may include large flatbread and tahini sauce.

Guidelines:
1. **Flatbreads**: Pita/lavash ~150-250 kcal each depending on size.
2. **Hummus & dips**: ~70-100 kcal per 2 tbsp; tahini is calorie-dense.
3. **Grilled meats**: Kebab/shawarma protein portions ~25-40g protein; include wrap bread and sauces.
4. **Rice dishes**: Biryani-style and mandi plates — account for ghee/oil and large rice portions.
5. **Hidden fats**: Olive oil, tahini, and nuts appear frequently — do not underestimate fats.`,

  europe: `Core nutritional reality of European meals:
Portions and macros vary by country. Mediterranean plates may be olive-oil and carb moderate; Northern European meals may include potatoes, bread, and meat. Restaurant portions tend toward generous.

Guidelines:
1. **Bread & potatoes**: Common carb bases — estimate serving size from plate coverage.
2. **Pasta & pizza**: Standard restaurant pasta ~600-900 kcal; pizza per slice ~200-300 kcal.
3. **Protein**: Grilled fish, schnitzel, roast chicken — estimate cut size and breading/frying.
4. **Sauces**: Cream-based sauces (carbonara, alfredo) add significant fat and calories.
5. **Breakfast**: Pastries, bread with cheese/cold cuts — often carb and fat heavy, moderate protein.`,

  global: `Apply neutral, cuisine-agnostic estimation principles:
1. Identify visible proteins (meat, fish, eggs, legumes, dairy), carb sources (grains, bread, pasta, potatoes, fruit), and fats (oils, butter, cheese, nuts, fried coatings).
2. Estimate portion size using plate/bowl/hand scale references or text descriptions.
3. Do not assume any single regional macro skew — infer from what is actually in the meal.
4. Hidden cooking fats: allocate reasonable fat when food appears fried, glossy, or restaurant-prepared.
5. Sum individual item macros; totals must match the aggregated macros block.

When writing mealFeedback: use generic actionable advice tied to the user's targets without assuming a specific regional cuisine unless clearly visible in the meal.`,
}

export function buildCuisinePersona(countryCode: string | null): string {
  const region = resolveCuisineRegion(countryCode)
  return PERSONA_BY_REGION[region]
}

export function buildCuisineGuidelines(countryCode: string | null): string {
  const region = resolveCuisineRegion(countryCode)
  return GUIDELINES_BY_REGION[region]
}
