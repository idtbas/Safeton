import { describe, expect, it } from 'vitest';
import { assessDevice, assessViewport, installPlatform, type DeviceEnv } from './platform';

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipadMobile:
    'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  androidPhone:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 15; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  winChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  winEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
};

const env = (userAgent: string, over: Partial<DeviceEnv> = {}): DeviceEnv => ({
  userAgent,
  uaMobile: null,
  maxTouchPoints: 0,
  screenW: 1920,
  screenH: 1080,
  ...over,
});

describe('device requirements', () => {
  it('blocks phones, also when they request the desktop site', () => {
    expect(assessDevice(env(UA.iphone, { screenW: 393, screenH: 852 }))).toEqual({
      ok: false,
      reason: 'phone',
    });
    expect(assessDevice(env(UA.androidPhone, { uaMobile: true }))).toEqual({ ok: false, reason: 'phone' });
    // iPhone "Request Desktop Website" reports a Mac user agent but keeps its small screen.
    expect(assessDevice(env(UA.macSafari, { maxTouchPoints: 5, screenW: 393, screenH: 852 }))).toEqual({
      ok: false,
      reason: 'screen-too-small',
    });
  });

  it('blocks tablets in mobile mode and accepts them in desktop mode', () => {
    expect(assessDevice(env(UA.ipadMobile, { maxTouchPoints: 5, screenW: 820, screenH: 1180 }))).toEqual({
      ok: false,
      reason: 'tablet-mobile-mode',
    });
    expect(assessDevice(env(UA.androidTablet, { maxTouchPoints: 10, screenW: 1280, screenH: 800 }))).toEqual({
      ok: false,
      reason: 'tablet-mobile-mode',
    });
    expect(assessDevice(env(UA.macSafari, { maxTouchPoints: 5, screenW: 820, screenH: 1180 }))).toEqual({
      ok: true,
      tablet: true,
    });
  });

  it('accepts desktop computers with a large enough screen', () => {
    expect(assessDevice(env(UA.winChrome))).toEqual({ ok: true, tablet: false });
    expect(assessDevice(env(UA.linuxFirefox, { screenW: 1366, screenH: 768 }))).toEqual({
      ok: true,
      tablet: false,
    });
    expect(assessDevice(env(UA.winChrome, { screenW: 1280, screenH: 600 }))).toEqual({
      ok: false,
      reason: 'screen-too-small',
    });
  });

  it('asks for a larger window or landscape orientation while running', () => {
    expect(assessViewport(1440, 900, false)).toBeNull();
    expect(assessViewport(1024, 600, true)).toBeNull();
    expect(assessViewport(900, 700, false)).toBe('enlarge');
    expect(assessViewport(820, 1180, true)).toBe('rotate');
    expect(assessViewport(820, 1180, false)).toBe('enlarge');
  });

  it('selects the installation path per browser', () => {
    expect(installPlatform(UA.winChrome, 0)).toBe('chromium');
    expect(installPlatform(UA.winEdge, 0)).toBe('chromium');
    expect(installPlatform(UA.macSafari, 0)).toBe('safari-mac');
    expect(installPlatform(UA.macSafari, 5)).toBe('ipados');
    expect(installPlatform(UA.linuxFirefox, 0)).toBe('firefox');
  });
});
