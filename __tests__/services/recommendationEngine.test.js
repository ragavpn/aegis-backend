import { scoreArticle } from '../../services/recommendationEngine.js';

describe('Recommendation Engine Scoring', () => {
  it('gives discovery boost to a fresh user (no interactions)', () => {
    const article = { modules: ['GEOPOLITICS', 'TECHNOLOGY'] };
    const interactions = [];
    
    // Both modules should trigger discovery boost (+1 each)
    const score = scoreArticle(article, interactions);
    expect(score).toBe(2);
  });

  it('rewards heavy preference for a module (likes + duration)', () => {
    const article = { modules: ['FINANCE'] };
    const interactions = [
      {
        liked: true,
        read_duration_seconds: 150,
        articles: { modules: ['FINANCE'] }
      },
      {
        liked: true,
        read_duration_seconds: 200,
        articles: { modules: ['FINANCE'] }
      }
    ];
    
    const score = scoreArticle(article, interactions);
    // Breakdown for FINANCE:
    // count: 2, likes: 2, dislikes: 0, totalDuration: 350
    // totalDuration > 30 -> +3
    // likes (2 * 5) -> +10
    // dislikes (0 * 10) -> 0
    // avgDuration: 175. durationNorm = 175 / 300 = 0.58333. norm * 2 = 1.1666
    // Expected score: 3 + 10 + 1.1666... = 14.1666...
    expect(score).toBeCloseTo(14.166);
  });

  it('applies dislike penalty properly', () => {
    const article = { modules: ['DEFENCE'] };
    const interactions = [
      {
        liked: false,
        read_duration_seconds: 10,
        articles: { modules: ['DEFENCE'] }
      }
    ];

    const score = scoreArticle(article, interactions);
    // Breakdown for DEFENCE:
    // count: 1, likes: 0, dislikes: 1, totalDuration: 10
    // totalDuration > 30 -> 0
    // likes (0 * 5) -> 0
    // dislikes (1 * 10) -> -10
    // avgDuration: 10. durationNorm = 10 / 300 = 0.0333... norm * 2 = 0.0666...
    // Expected score: -10 + 0.0666 = -9.9333...
    expect(score).toBeCloseTo(-9.933);
  });

  it('gives discovery boost for an unseen module even if other modules exist', () => {
    const article = { modules: ['TRADE', 'CLIMATE'] };
    // User has only interacted with TRADE
    const interactions = [
      {
        liked: true,
        read_duration_seconds: 300,
        articles: { modules: ['TRADE'] }
      }
    ];

    const score = scoreArticle(article, interactions);
    // TRADE: count: 1, likes: 1, duration: 300
    // >30s -> +3. likes -> +5. avg=300 (norm=1) -> +2. Total TRADE = 10.
    // CLIMATE: unseen -> +1.
    // Total score = 11.
    expect(score).toBe(11);
  });

  it('handles mixed signals (some likes, some dislikes)', () => {
    const article = { modules: ['ENERGY'] };
    const interactions = [
      {
        liked: true,
        read_duration_seconds: 100,
        articles: { modules: ['ENERGY'] }
      },
      {
        liked: false,
        read_duration_seconds: 20,
        articles: { modules: ['ENERGY'] }
      }
    ];

    const score = scoreArticle(article, interactions);
    // ENERGY: count: 2, likes: 1, dislikes: 1, totalDuration: 120
    // >30s -> +3
    // likes (1*5) -> +5
    // dislikes (1*10) -> -10
    // avg = 60. norm = 60/300 = 0.2. norm*2 = 0.4
    // Total = 3 + 5 - 10 + 0.4 = -1.6
    expect(score).toBeCloseTo(-1.6);
  });
});
