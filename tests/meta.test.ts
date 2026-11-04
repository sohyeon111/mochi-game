import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../src/app/meta';

describe('앱 기본 설정', () => {
  it('앱 이름이 Mochi Game이다', () => {
    expect(APP_NAME).toBe('Mochi Game');
  });
});
