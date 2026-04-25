import { normaliseEntities, getGraphContext } from '../../services/graphService.js';

// Mock the Neo4j client
jest.mock('../../db/neo4jClient.js', () => {
  return {
    getSession: jest.fn(() => ({
      run: jest.fn(),
      close: jest.fn()
    }))
  };
});

import { getSession } from '../../db/neo4jClient.js';

describe('Graph Service', () => {
  describe('normaliseEntities', () => {
    it('normalizes known aliases to standard entity names', () => {
      const edges = [
        { source: 'The Russian Federation', target: 'US', relationship: 'ATTACKED' },
        { source: 'Beijing', target: 'London', relationship: 'AGREED_WITH' }
      ];

      const result = normaliseEntities(edges);

      expect(result[0].source).toBe('Russia');
      expect(result[0].target).toBe('USA');
      
      expect(result[1].source).toBe('China');
      expect(result[1].target).toBe('United Kingdom');
    });

    it('keeps original names if not in lookup map, but retains original case', () => {
      const edges = [
        { source: '  Unknown Entity  ', target: 'another entity', relationship: 'SAW' }
      ];

      const result = normaliseEntities(edges);

      expect(result[0].source).toBe('Unknown Entity');
      expect(result[0].target).toBe('another entity');
    });
  });

  describe('getGraphContext', () => {
    let mockSession;

    beforeEach(() => {
      mockSession = getSession();
      mockSession.run.mockClear();
      mockSession.close.mockClear();
    });

    it('returns empty string if no entity names provided', async () => {
      const result = await getGraphContext([]);
      expect(result).toBe('');
      expect(mockSession.run).not.toHaveBeenCalled();
    });

    it('formats Neo4j results into a readable context string', async () => {
      // Mock the Neo4j result
      mockSession.run.mockResolvedValueOnce({
        records: [
          {
            get: (key) => {
              const data = {
                source: 'Russia',
                relationships: ['INVADED', 'SANCTIONED_BY'],
                target: 'USA'
              };
              return data[key];
            }
          },
          {
            get: (key) => {
              const data = {
                source: 'China',
                relationships: ['ALLIED_WITH'],
                target: 'Russia'
              };
              return data[key];
            }
          }
        ]
      });

      const result = await getGraphContext(['Russia']);
      
      expect(mockSession.run).toHaveBeenCalledTimes(1);
      expect(mockSession.close).toHaveBeenCalledTimes(1);
      
      expect(result).toContain('Relevant graph context (causal chains):');
      expect(result).toContain('- Russia -> INVADED -> SANCTIONED_BY -> USA');
      expect(result).toContain('- China -> ALLIED_WITH -> Russia');
    });

    it('returns fallback string if no records found', async () => {
      mockSession.run.mockResolvedValueOnce({ records: [] });
      
      const result = await getGraphContext(['Unknown']);
      expect(result).toBe('No relevant graph context found.');
    });

    it('returns empty string and logs error if Neo4j query fails', async () => {
      mockSession.run.mockRejectedValueOnce(new Error('DB Error'));
      
      const result = await getGraphContext(['Russia']);
      
      expect(result).toBe('');
      expect(mockSession.close).toHaveBeenCalledTimes(1);
    });
  });
});
