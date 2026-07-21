import {
  buildIdToDeviceKeysMap,
  normalizeOptionalString,
  normalizeStringList,
  normalizeTrackedDevices
} from './electrical-config.util';

describe('electrical-config.util', () => {
  describe('normalizeOptionalString', () => {
    it('trims a non-empty string', () => {
      expect(normalizeOptionalString('  house  ')).toBe('house');
    });

    it('returns null for empty or whitespace-only strings', () => {
      expect(normalizeOptionalString('')).toBeNull();
      expect(normalizeOptionalString('   ')).toBeNull();
    });

    it('returns null for non-string values', () => {
      expect(normalizeOptionalString(42)).toBeNull();
      expect(normalizeOptionalString(null)).toBeNull();
      expect(normalizeOptionalString(undefined)).toBeNull();
      expect(normalizeOptionalString({})).toBeNull();
    });
  });

  describe('normalizeStringList', () => {
    it('returns an empty array for non-arrays', () => {
      expect(normalizeStringList(null)).toEqual([]);
      expect(normalizeStringList('house')).toEqual([]);
    });

    it('trims, drops empties and non-strings, dedupes, and sorts', () => {
      expect(normalizeStringList([' b ', 'a', 'b', '', 3, null, 'a'])).toEqual(['a', 'b']);
    });
  });

  describe('normalizeTrackedDevices', () => {
    it('returns an empty array for non-arrays', () => {
      expect(normalizeTrackedDevices(undefined)).toEqual([]);
    });

    it('drops only items without a usable id and skips non-objects', () => {
      const result = normalizeTrackedDevices([
        'plain-string',
        { source: 'x' },
        { id: '   ' },
        { id: 'a', source: 'x' }
      ]);
      expect(result).toEqual([{ id: 'a', source: 'x', key: 'a||x' }]);
    });

    it('defaults a missing or blank source to "default" and keeps the item', () => {
      const result = normalizeTrackedDevices([
        { id: 'a' },
        { id: 'b', source: '   ' }
      ]);
      expect(result).toEqual([
        { id: 'a', source: 'default', key: 'a||default' },
        { id: 'b', source: 'default', key: 'b||default' }
      ]);
    });

    it('synthesizes a key from id and source when key is absent', () => {
      expect(normalizeTrackedDevices([{ id: 'bat', source: 'n2k' }])).toEqual([
        { id: 'bat', source: 'n2k', key: 'bat||n2k' }
      ]);
    });

    it('honors an explicit key and dedupes by key, sorted', () => {
      const result = normalizeTrackedDevices([
        { id: 'b', source: 's', key: 'z' },
        { id: 'a', source: 's', key: 'a' },
        { id: 'b', source: 's', key: 'z' }
      ]);
      expect(result).toEqual([
        { id: 'a', source: 's', key: 'a' },
        { id: 'b', source: 's', key: 'z' }
      ]);
    });
  });

  describe('buildIdToDeviceKeysMap', () => {
    it('groups device keys under their id', () => {
      const map = buildIdToDeviceKeysMap([
        { id: 'a', source: 's1', key: 'a||s1' },
        { id: 'a', source: 's2', key: 'a||s2' },
        { id: 'b', source: 's1', key: 'b||s1' }
      ]);
      expect(map.get('a')).toEqual(['a||s1', 'a||s2']);
      expect(map.get('b')).toEqual(['b||s1']);
      expect(map.size).toBe(2);
    });

    it('returns an empty map for no devices', () => {
      expect(buildIdToDeviceKeysMap([]).size).toBe(0);
    });
  });
});
