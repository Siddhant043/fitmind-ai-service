import { describe, it, expect } from 'vitest'
import { buildMealAnalyzerSystemPrompt } from '../meal-analyzer.prompt.js'

describe('buildMealAnalyzerSystemPrompt', () => {
  const baseContext = {
    goal: 'cut',
    tdee: 2200,
    macroTargets: { calories: 2000, protein_g: 150, carbs_g: 200, fats_g: 65 },
    todayCalories: 800,
    todayProteinG: 40,
    activePlanName: 'PPL',
    countryCode: null as string | null,
    dietaryPref: null as string | null,
  }

  it('includes South Asian guidelines for IN countryCode', () => {
    const prompt = buildMealAnalyzerSystemPrompt({ ...baseContext, countryCode: 'IN' })
    expect(prompt).toContain('South Asian and Indian cuisine')
    expect(prompt).toContain('Roti/Chapati')
    expect(prompt).toContain('Country: India (IN)')
  })

  it('includes North American guidelines for US countryCode', () => {
    const prompt = buildMealAnalyzerSystemPrompt({ ...baseContext, countryCode: 'US' })
    expect(prompt).toContain('North American cuisine')
    expect(prompt).toContain('Burgers & Sandwiches')
    expect(prompt).not.toContain('Roti/Chapati')
    expect(prompt).toContain('Country: United States (US)')
  })

  it('uses neutral global guidelines when countryCode is null', () => {
    const prompt = buildMealAnalyzerSystemPrompt(null)
    expect(prompt).toContain('expertise across global cuisines')
    expect(prompt).toContain('cuisine-agnostic estimation principles')
    expect(prompt).not.toContain('Roti/Chapati')
    expect(prompt).not.toContain('South Asian and Indian cuisine')
  })

  it('includes dietary preference in user context block', () => {
    const prompt = buildMealAnalyzerSystemPrompt({
      ...baseContext,
      countryCode: 'IN',
      dietaryPref: 'vegan',
    })
    expect(prompt).toContain('Dietary preference: vegan')
  })
})
